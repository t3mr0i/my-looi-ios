package com.superlooi.voskcommand

import android.content.res.AssetManager
import android.os.Process
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Stateful band-limited 24 kHz -> 16 kHz converter for the output-only decoder. */
private class AssistantPcm24To16Resampler {
  private val radius = 24
  private val cutoff = 0.31
  private var pending = ArrayList<Float>()
  private var pendingStartFrame = 0L
  private var sourceFrames = 0L
  private var nextOutputFrame = 0L

  private val weights = Array(2) { phaseIndex ->
    val fraction = phaseIndex * 0.5
    val values = FloatArray(radius * 2 + 1)
    var total = 0.0
    for (tap in -radius..radius) {
      val distance = tap - fraction
      val windowPosition = kotlin.math.abs(distance) / radius
      if (windowPosition > 1.0) continue
      val window = 0.5 + 0.5 * cos(PI * windowPosition)
      val sincArgument = 2.0 * cutoff * distance
      val sinc = if (kotlin.math.abs(sincArgument) < 1e-9) 1.0
      else sin(PI * sincArgument) / (PI * sincArgument)
      val value = (2.0 * cutoff * sinc * window)
      values[tap + radius] = value.toFloat()
      total += value
    }
    if (kotlin.math.abs(total) > 1e-9) {
      for (index in values.indices) values[index] = (values[index] / total).toFloat()
    }
    values
  }

  val audioDurationMs: Double get() = sourceFrames * 1000.0 / 24_000.0

  fun appendPcm16Le(bytes: ByteArray): FloatArray {
    require(bytes.size % 2 == 0) { "Assistant PCM16 payload has an odd byte count" }
    if (bytes.isEmpty()) return FloatArray(0)
    var offset = 0
    while (offset < bytes.size) {
      val bits = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)
      pending.add((bits.toShort().toInt() / 32768.0f))
      offset += 2
    }
    sourceFrames += (bytes.size / 2).toLong()

    val result = ArrayList<Float>()
    while (nextOutputFrame * 1.5 + radius < sourceFrames.toDouble()) {
      result.add(resampledSample(nextOutputFrame))
      nextOutputFrame += 1
    }
    trimHistory()
    return result.toFloatArray()
  }

  fun finish(): FloatArray {
    val targetFrames = (sourceFrames * 2 + 2) / 3
    val result = ArrayList<Float>()
    while (nextOutputFrame < targetFrames) {
      result.add(resampledSample(nextOutputFrame))
      nextOutputFrame += 1
    }
    trimHistory()
    return result.toFloatArray()
  }

  private fun resampledSample(outputFrame: Long): Float {
    val position = outputFrame * 1.5
    val center = floor(position).toLong()
    val phase = if (outputFrame % 2L == 0L) 0 else 1
    var output = 0.0
    for (tap in -radius..radius) {
      val sourceIndex = center + tap
      if (sourceIndex < 0 || sourceIndex >= sourceFrames) continue
      val localIndex = sourceIndex - pendingStartFrame
      if (localIndex < 0 || localIndex >= pending.size) continue
      output += pending[localIndex.toInt()].toDouble() * weights[phase][tap + radius]
    }
    return output.coerceIn(-1.0, 1.0).toFloat()
  }

  private fun trimHistory() {
    val keepFrom = max(0L, floor(nextOutputFrame * 1.5).toLong() - radius)
    val removeCount = min(pending.size.toLong(), keepFrom - pendingStartFrame).toInt()
    if (removeCount <= 0) return
    pending = ArrayList(pending.subList(removeCount, pending.size))
    pendingStartFrame += removeCount
  }
}

class VoskCommandRecognizerModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private val assistantExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread({
      try { Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND) } catch (_: Throwable) {}
      runnable.run()
    }, "looi-vosk-assistant-output").apply { isDaemon = true }
  }
  private val modelLock = Any()
  private val assistantLock = Any()
  private val queuedChunks = AtomicInteger(0)
  private val assistantGeneration = AtomicInteger(0)
  private val assistantQueuedChunks = AtomicInteger(0)
  private val resetGeneration = AtomicInteger(0)
  private val resetCount = AtomicInteger(0)
  private val samplesSinceReset = AtomicLong(0)
  private val emergencySamplesSinceReset = AtomicLong(0)
  private val emergencyArmGeneration = AtomicInteger(0)
  private val sessionCounter = AtomicInteger(0)

  @Volatile private var model: Model? = null
  private var recognizer: Recognizer? = null
  // A second recognizer shares the same acoustic model but has a tiny STOP-only
  // grammar. It is fed before the normal command recognizer so emergency STOP
  // does not wait behind the 5k+ phrase driving grammar.
  private var emergencyRecognizer: Recognizer? = null
  @Volatile private var currentLanguage: String = ""
  @Volatile private var currentAssetDir: String = ""
  private var currentGrammar: String = "[]"
  private var currentEmergencyGrammar: String = "[]"
  private var lastPartial: String = ""
  private var lastEmergencyPartial: String = ""
  private var lastEmergencyUnknownEventAtMs: Long = 0L
  private var lastEmergencyHealthEventAtMs: Long = 0L
  @Volatile private var emergencyArmed: Boolean = false
  private var sequence: Int = 0
  @Volatile private var currentSessionId: Int = 0
  @Volatile private var appliedResetGeneration: Int = 0
  @Volatile private var assistantModelChanging = false
  @Volatile private var assistantResponseId: String? = null
  @Volatile private var assistantOutputLanguage: String = ""
  @Volatile private var assistantEnding = false
  private var assistantQueuedPayloadBytes = 0 // guarded by assistantLock
  private var assistantOutputState: AssistantOutputState? = null // assistantExecutor only

  private data class AssistantOutputState(
    val responseId: String,
    val generation: Int,
    val language: String,
    val model: Model,
    val recognizer: Recognizer,
    val resampler: AssistantPcm24To16Resampler = AssistantPcm24To16Resampler(),
    var lastPartialSignature: String = ""
  )

  private val assistantQueueLimit = 8
  private val assistantPayloadLimit = 65_536
  private val assistantQueuedPayloadByteLimit = 128 * 1024

  override fun definition() = ModuleDefinition {
    Name("VoskCommandRecognizer")

    Events("onCommandResult", "onEmergencyStop", "onEmergencyUnknown", "onEmergencyHealth", "onModelReady", "onRecognizerError", "onRecognizerState", "onAssistantRecognition", "onAssistantRecognitionError")

    // Keep v1.1.36 recognizer lifecycle semantics. prepare() is intentionally
    // not routed through the PCM executor; v1.1.38 adds observability only.
    AsyncFunction("prepare") { language: String, assetDir: String, grammarJson: String, emergencyGrammarJson: String ->
      prepareRecognizer(language, assetDir, grammarJson, emergencyGrammarJson)
    }

    AsyncFunction("beginAssistantOutput") { language: String, responseId: String ->
      beginAssistantOutput(language, responseId)
    }

    Function("feedAssistantPcm24") { responseId: String, pcm24Base64: String ->
      feedAssistantPcm24(responseId, pcm24Base64)
    }

    Function("endAssistantOutput") { responseId: String ->
      endAssistantOutput(responseId)
    }

    Function("cancelAssistantOutput") { responseId: String ->
      cancelAssistantOutput(responseId)
    }

    AsyncFunction("setGrammar") { grammarJson: String ->
      emergencyArmed = false
      emergencyArmGeneration.incrementAndGet()
      currentGrammar = grammarJson
      recognizer?.setGrammar(grammarJson)
      recognizer?.reset()
      emergencyRecognizer?.reset()
      lastPartial = ""
      lastEmergencyPartial = ""
      lastEmergencyUnknownEventAtMs = 0L
      lastEmergencyHealthEventAtMs = 0L
      val generation = resetGeneration.incrementAndGet()
      val count = resetCount.incrementAndGet()
      appliedResetGeneration = generation
      samplesSinceReset.set(0)
      emergencySamplesSinceReset.set(0)
      sendRecognizerState("reset-applied", "set-grammar", generation, count, queuedChunks.get(), 0L, true)
    }

    AsyncFunction("armEmergency") { reason: String ->
      // v1.1.41: a STOP recognizer is a per-motion safety primitive. Invalidate
      // any previously queued emergency PCM immediately, then reset + arm on
      // the same serial native executor. JS awaits this before the first BLE
      // drive write, so the first spoken STOP starts from a clean decoder state.
      emergencyArmed = false
      val armGeneration = emergencyArmGeneration.incrementAndGet()
      val task = executor.submit<Boolean> {
        val started = SystemClock.elapsedRealtime()
        if (emergencyArmGeneration.get() != armGeneration) return@submit false
        val emergency = emergencyRecognizer ?: return@submit false
        emergency.reset()
        lastEmergencyPartial = ""
        lastEmergencyUnknownEventAtMs = 0L
        lastEmergencyHealthEventAtMs = 0L
        emergencySamplesSinceReset.set(0)
        if (emergencyArmGeneration.get() != armGeneration) return@submit false
        emergencyArmed = true
        sendRecognizerState(
          "emergency-armed",
          reason,
          appliedResetGeneration,
          resetCount.get(),
          queuedChunks.get(),
          SystemClock.elapsedRealtime() - started,
          true
        )
        true
      }
      task.get()
    }

    AsyncFunction("disarmEmergency") { reason: String ->
      // Flip the gate before queueing the reset so any PCM arriving during the
      // transition is excluded from the emergency decoder. Generation fencing
      // also rejects emergency PCM that was queued under the previous arm.
      emergencyArmed = false
      emergencyArmGeneration.incrementAndGet()
      val task = executor.submit<Unit> {
        val started = SystemClock.elapsedRealtime()
        emergencyRecognizer?.reset()
        lastEmergencyPartial = ""
        lastEmergencyUnknownEventAtMs = 0L
        lastEmergencyHealthEventAtMs = 0L
        emergencySamplesSinceReset.set(0)
        sendRecognizerState(
          "emergency-disarmed",
          reason,
          appliedResetGeneration,
          resetCount.get(),
          queuedChunks.get(),
          SystemClock.elapsedRealtime() - started,
          true
        )
      }
      task.get()
    }

    Function("feedSamples") { samples: List<Double> ->
      if (samples.isEmpty() || recognizer == null) return@Function
      // Copy on the JS call thread, decode on the same dedicated serial native
      // worker used by v1.1.36. No generation fence/drop logic is used here.
      val pcm = FloatArray(samples.size)
      for (i in samples.indices) {
        pcm[i] = (min(1.0, max(-1.0, samples[i])) * 32767.0).toFloat()
      }
      val feedEmergencyGeneration = if (emergencyArmed) emergencyArmGeneration.get() else 0
      queuedChunks.incrementAndGet()
      executor.execute {
        val started = SystemClock.elapsedRealtime()
        try {
          val active = recognizer ?: return@execute
          val fedSamples = samplesSinceReset.addAndGet(pcm.size.toLong())
          val rms16 = calculateRms(pcm)

          // Emergency decoding is active only for a specific motion arm. The
          // generation captured on the JS/native call thread fences queued PCM
          // from before arm/disarm transitions out of the fresh STOP decoder.
          val emergencyIsCurrent =
            feedEmergencyGeneration != 0 &&
            emergencyArmed &&
            feedEmergencyGeneration == emergencyArmGeneration.get()
          val emergency = if (emergencyIsCurrent) emergencyRecognizer else null
          if (emergency != null) {
            val emergencyFedSamples = emergencySamplesSinceReset.addAndGet(pcm.size.toLong())
            val emergencyStarted = SystemClock.elapsedRealtime()
            val emergencyEndpoint = emergency.acceptWaveForm(pcm, pcm.size)
            val emergencyJson = if (emergencyEndpoint) emergency.result else emergency.partialResult
            val emergencyKey = if (emergencyEndpoint) "text" else "partial"
            val emergencyText = try {
              JSONObject(emergencyJson).optString(emergencyKey, "").trim()
            } catch (_: Throwable) {
              ""
            }
            val emergencyProcessingMs = SystemClock.elapsedRealtime() - emergencyStarted
            val emergencyNow = SystemClock.elapsedRealtime()
            if (emergencyNow - lastEmergencyHealthEventAtMs >= 500L) {
              lastEmergencyHealthEventAtMs = emergencyNow
              sendEvent(
                "onEmergencyHealth",
                mapOf(
                  "armed" to emergencyArmed,
                  "armGeneration" to feedEmergencyGeneration,
                  "partialText" to emergencyText,
                  "endpoint" to emergencyEndpoint,
                  "processingMs" to emergencyProcessingMs,
                  "sessionId" to currentSessionId,
                  "samplesSinceEmergencyReset" to emergencyFedSamples,
                  "queuedChunks" to queuedChunks.get(),
                  "rms16" to rms16
                )
              )
            }
            if (emergencyText == "[unk]") {
              val now = SystemClock.elapsedRealtime()
              // Unknown output is useful to diagnose a spoken STOP that was heard
              // acoustically but rejected by the tiny grammar. Keep it rate-limited
              // so normal motor/background noise cannot flood the JS bridge/log.
              if (now - lastEmergencyUnknownEventAtMs >= 1_000L) {
                lastEmergencyUnknownEventAtMs = now
                sendEvent(
                  "onEmergencyUnknown",
                  mapOf(
                    "text" to emergencyText,
                    "partial" to !emergencyEndpoint,
                    "processingMs" to emergencyProcessingMs,
                    "sessionId" to currentSessionId,
                    "samplesSinceEmergencyReset" to emergencyFedSamples,
                    "queuedChunks" to queuedChunks.get(),
                    "rms16" to rms16
                  )
                )
              }
            } else if (emergencyText.isNotEmpty() &&
              (emergencyEndpoint || emergencyText != lastEmergencyPartial)) {
              lastEmergencyPartial = if (emergencyEndpoint) "" else emergencyText
              sendEvent(
                "onEmergencyStop",
                mapOf(
                  "text" to emergencyText,
                  "partial" to !emergencyEndpoint,
                  "processingMs" to emergencyProcessingMs,
                  "sessionId" to currentSessionId,
                  "samplesSinceEmergencyReset" to emergencyFedSamples,
                  "queuedChunks" to queuedChunks.get(),
                  "rms16" to rms16
                )
              )
            }
          }

          val normalStarted = SystemClock.elapsedRealtime()
          val endpoint = active.acceptWaveForm(pcm, pcm.size)
          val json = if (endpoint) active.result else active.partialResult
          val key = if (endpoint) "text" else "partial"
          val text = try {
            JSONObject(json).optString(key, "").trim()
          } catch (_: Throwable) {
            ""
          }
          val common = mutableMapOf<String, Any>(
            "sessionId" to currentSessionId,
            "resetGeneration" to appliedResetGeneration,
            "samplesSinceReset" to fedSamples,
            "queuedChunks" to queuedChunks.get(),
            "droppedChunks" to 0,
            "endpoint" to endpoint,
            "rms16" to rms16,
            // Keep this metric comparable with prior builds: normal recognizer
            // processing time excludes the new emergency recognizer overhead.
            "processingMs" to (SystemClock.elapsedRealtime() - normalStarted)
          )
          if (endpoint) {
            lastPartial = ""
            sequence += 1
            common["text"] = text
            common["partial"] = false
            common["sequence"] = sequence
            sendEvent("onCommandResult", common)
          } else if (text.isNotEmpty() && text != lastPartial) {
            lastPartial = text
            sequence += 1
            common["text"] = text
            common["partial"] = true
            common["sequence"] = sequence
            sendEvent("onCommandResult", common)
          }
        } catch (error: Throwable) {
          sendError("feed", error)
        } finally {
          queuedChunks.decrementAndGet()
        }
      }
    }

    Function("reset") { reason: String, resetEmergency: Boolean ->
      if (resetEmergency) {
        emergencyArmed = false
        emergencyArmGeneration.incrementAndGet()
      }
      // Normal command resets preserve the tiny emergency recognizer unless the
      // caller explicitly requests an emergency reset. This prevents a STOP
      // spoken immediately after motor start from being erased by the normal
      // post-command reset. The serial executor ordering remains v1.1.36-style.
      val generation = resetGeneration.incrementAndGet()
      val count = resetCount.incrementAndGet()
      sendRecognizerState("reset-requested", reason, generation, count, queuedChunks.get(), 0L, resetEmergency)
      executor.execute {
        val started = SystemClock.elapsedRealtime()
        try {
          recognizer?.reset()
          lastPartial = ""
          appliedResetGeneration = generation
          samplesSinceReset.set(0)
          if (resetEmergency) {
            emergencyRecognizer?.reset()
            lastEmergencyPartial = ""
            lastEmergencyUnknownEventAtMs = 0L
            lastEmergencyHealthEventAtMs = 0L
            emergencySamplesSinceReset.set(0)
          }
          sendRecognizerState(
            "reset-applied",
            reason,
            generation,
            count,
            queuedChunks.get(),
            SystemClock.elapsedRealtime() - started,
            resetEmergency
          )
        } catch (error: Throwable) {
          sendError("reset", error)
        }
      }
      generation
    }

    Function("unload") {
      synchronized(modelLock) { assistantModelChanging = true }
      cancelAssistantOutput(null, force = true, reason = "unload")
      assistantExecutor.execute {
        releaseAssistantOutput()
        executor.execute {
          closeRecognizer()
          synchronized(modelLock) {
            currentLanguage = ""
            currentAssetDir = ""
          }
        }
      }
    }

    Function("getStatus") {
      mapOf(
        "ready" to (recognizer != null),
        "language" to currentLanguage,
        "queuedChunks" to queuedChunks.get(),
        "sessionId" to currentSessionId,
        "resetGeneration" to appliedResetGeneration,
        "resetCount" to resetCount.get(),
        "droppedChunks" to 0,
        "samplesSinceReset" to samplesSinceReset.get(),
        "emergencySamplesSinceReset" to emergencySamplesSinceReset.get(),
        "emergencyArmed" to emergencyArmed,
        "emergencyArmGeneration" to emergencyArmGeneration.get()
      )
    }

    OnDestroy {
      synchronized(modelLock) { assistantModelChanging = true }
      cancelAssistantOutput(null, force = true, reason = "destroy")
      assistantExecutor.execute {
        releaseAssistantOutput()
        executor.execute { closeRecognizer() }
        executor.shutdown()
        assistantExecutor.shutdown()
      }
    }
  }

  private fun languageKey(value: String): String =
    value.trim().lowercase().substringBefore('-').substringBefore('_')

  private fun beginAssistantOutput(language: String, responseId: String): Map<String, Any> {
    val response = responseId.trim()
    val outputGeneration: Int
    val previousGeneration: Int
    synchronized(assistantLock) {
      previousGeneration = assistantGeneration.get()
      outputGeneration = assistantGeneration.incrementAndGet()
      assistantResponseId = response.ifEmpty { null }
      assistantOutputLanguage = language
      assistantEnding = false
    }
    val snapshot = synchronized(modelLock) {
      Triple(model, currentLanguage, assistantModelChanging)
    }
    val loadedModel = snapshot.first
    if (response.isEmpty() || snapshot.third || loadedModel == null || languageKey(language) != languageKey(snapshot.second)) {
      synchronized(assistantLock) {
        if (assistantGeneration.get() == outputGeneration) {
          assistantResponseId = null
          assistantEnding = true
        }
      }
      assistantExecutor.execute { releaseAssistantOutput(previousGeneration) }
      return mapOf("ready" to false, "generation" to outputGeneration)
    }

    val ready = try {
      assistantExecutor.submit<Boolean> {
        if (!isCurrentAssistantOutput(outputGeneration, response)) return@submit false
        releaseAssistantOutput()
        val outputRecognizer = Recognizer(loadedModel, 16000.0f).also {
          it.setWords(true)
          it.setPartialWords(true)
          it.setEndpointerMode(Recognizer.EndpointerMode.SHORT)
          it.setEndpointerDelays(3.0f, 0.26f, 5.0f)
        }
        if (!isCurrentAssistantOutput(outputGeneration, response)) {
          try { outputRecognizer.close() } catch (_: Throwable) {}
          return@submit false
        }
        assistantOutputState = AssistantOutputState(
          responseId = response,
          generation = outputGeneration,
          language = language,
          model = loadedModel,
          recognizer = outputRecognizer
        )
        true
      }.get()
    } catch (error: Throwable) {
      sendAssistantError(response, outputGeneration, language, "begin", error.message ?: "Could not create Vosk output recognizer")
      false
    }
    if (!ready) {
      synchronized(assistantLock) {
        if (assistantGeneration.get() == outputGeneration) {
          assistantResponseId = null
          assistantEnding = true
        }
      }
    }
    return mapOf("ready" to ready, "generation" to outputGeneration)
  }

  private fun feedAssistantPcm24(responseId: String, pcm24Base64: String): Boolean {
    val response = responseId.trim()
    if (response.isEmpty() || pcm24Base64.isEmpty() || pcm24Base64.length > assistantPayloadLimit) return false
    val payloadByteCount = pcm24Base64.length

    val outputGeneration: Int
    val language: String
    synchronized(assistantLock) {
      if (assistantResponseId != response || assistantEnding) return false
      if (assistantQueuedChunks.get() >= assistantQueueLimit ||
        assistantQueuedPayloadBytes + payloadByteCount > assistantQueuedPayloadByteLimit) {
        outputGeneration = assistantGeneration.get()
        language = assistantOutputLanguage
        assistantGeneration.incrementAndGet()
        assistantResponseId = null
        assistantEnding = true
        sendAssistantError(response, outputGeneration, language, "backlog",
          "Assistant output recognition queue exceeded its latency budget")
        assistantExecutor.execute { releaseAssistantOutput(outputGeneration) }
        return false
      }
      assistantQueuedChunks.incrementAndGet()
      assistantQueuedPayloadBytes += payloadByteCount
      outputGeneration = assistantGeneration.get()
      language = assistantOutputLanguage
      // Enqueue while holding the state lock so end/cancel cannot overtake an
      // already admitted chunk when native calls arrive from different threads.
      assistantExecutor.execute {
        try {
          if (!isCurrentAssistantOutput(outputGeneration, response)) return@execute
          val state = assistantOutputState
          if (state == null || state.generation != outputGeneration || state.responseId != response) return@execute
          val bytes = Base64.decode(pcm24Base64, Base64.DEFAULT)
          if (bytes.isEmpty() || bytes.size > 48 * 1024 || bytes.size % 2 != 0) {
            failAssistantOutput(state, "input", "Invalid or unsupported assistant PCM24 payload")
            return@execute
          }
          feedAssistantPcm24Bytes(state, bytes)
        } catch (error: Throwable) {
          val state = assistantOutputState
          if (state != null && state.generation == outputGeneration && state.responseId == response) {
            failAssistantOutput(state, "decode", error.message ?: "Vosk assistant output decode failed")
          }
        } finally {
          assistantQueuedChunks.decrementAndGet()
          synchronized(assistantLock) { assistantQueuedPayloadBytes -= payloadByteCount }
        }
      }
    }
    return true
  }

  private fun endAssistantOutput(responseId: String) {
    val response = responseId.trim()
    val outputGeneration: Int
    synchronized(assistantLock) {
      if (assistantResponseId != response || assistantEnding) return
      outputGeneration = assistantGeneration.get()
      assistantEnding = true
      assistantExecutor.execute {
        if (!isCurrentAssistantGeneration(outputGeneration)) return@execute
        val state = assistantOutputState
        if (state != null && state.generation == outputGeneration && state.responseId == response) {
          try {
            feedAssistantOutputSamples(state, state.resampler.finish())
            feedAssistantOutputSamples(state, FloatArray(12800)) // endpoint flush only; not response time
          } catch (error: Throwable) {
            failAssistantOutput(state, "flush", error.message ?: "Vosk assistant output flush failed")
          } finally {
            releaseAssistantOutput(outputGeneration)
          }
        }
        synchronized(assistantLock) {
          if (assistantGeneration.get() == outputGeneration && assistantResponseId == response) {
            assistantResponseId = null
          }
        }
      }
    }
  }

  private fun cancelAssistantOutput(responseId: String?, force: Boolean = false, reason: String) {
    val oldGeneration: Int
    synchronized(assistantLock) {
      if (!force && assistantResponseId != responseId?.trim()) return
      oldGeneration = assistantGeneration.getAndIncrement()
      assistantResponseId = null
      assistantEnding = true
      assistantExecutor.execute { releaseAssistantOutput(oldGeneration) }
    }
  }

  private fun awaitAssistantOutputRelease() {
    assistantExecutor.submit<Unit> { releaseAssistantOutput() }.get()
  }

  private fun releaseAssistantOutput(expectedGeneration: Int? = null) {
    val state = assistantOutputState ?: return
    if (expectedGeneration != null && state.generation != expectedGeneration) return
    try { state.recognizer.close() } catch (_: Throwable) {}
    assistantOutputState = null
  }

  private fun isCurrentAssistantGeneration(requested: Int): Boolean =
    assistantGeneration.get() == requested

  private fun isCurrentAssistantOutput(requested: Int, responseId: String): Boolean =
    isCurrentAssistantGeneration(requested) && assistantResponseId == responseId

  private fun feedAssistantPcm24Bytes(state: AssistantOutputState, bytes: ByteArray) {
    feedAssistantOutputSamples(state, state.resampler.appendPcm16Le(bytes))
  }

  private fun feedAssistantOutputSamples(state: AssistantOutputState, samples: FloatArray) {
    var offset = 0
    while (offset < samples.size) {
      if (!isCurrentAssistantGeneration(state.generation)) return
      val count = min(1600, samples.size - offset)
      // Vosk's Java float overload carries PCM16 amplitude, not normalized audio.
      val chunk = FloatArray(count) { index ->
        (samples[offset + index] * 32767.0f).coerceIn(-32768.0f, 32767.0f)
      }
      val endpoint = state.recognizer.acceptWaveForm(chunk, chunk.size)
      offset += count
      if (endpoint) {
        emitAssistantWords(state, state.recognizer.result, true)
      } else {
        emitAssistantWords(state, state.recognizer.partialResult, false)
      }
    }
  }

  private fun emitAssistantWords(state: AssistantOutputState, json: String, endpoint: Boolean) {
    if (!isCurrentAssistantGeneration(state.generation)) return
    val words = mutableListOf<Map<String, Any>>()
    try {
      val entries = JSONObject(json).optJSONArray(if (endpoint) "result" else "partial_result")
      if (entries != null) {
        for (index in 0 until entries.length()) {
          val item = entries.optJSONObject(index) ?: continue
          val word = item.optString("word", "").trim()
          val start = item.optDouble("start", Double.NaN)
          val end = item.optDouble("end", Double.NaN)
          val confidence = item.optDouble("conf", Double.NaN)
          if (word.isEmpty() || !start.isFinite() || !end.isFinite() || !confidence.isFinite() ||
            start < 0.0 || end <= start || confidence !in 0.0..1.0) continue
          words.add(mapOf(
            "word" to word,
            // Vosk's frame_offset_ already preserves response-relative time
            // after each endpoint reset.
            "startMs" to (start * 1000.0),
            "endMs" to (end * 1000.0),
            "confidence" to confidence
          ))
        }
      }
    } catch (_: Throwable) {
      // A malformed endpoint is deliberately ignored; partial text is never promoted.
      return
    }
    if (!endpoint) {
      if (words.isEmpty()) return
      val signature = words.joinToString(";") { word ->
        val startBucket = ((word["startMs"] as Double) / 100.0).toLong()
        val endBucket = ((word["endMs"] as Double) / 100.0).toLong()
        val confidenceBucket = (((word["confidence"] as Double) * 20.0).toLong())
        "${word["word"]}|$startBucket|$endBucket|$confidenceBucket"
      }
      if (signature == state.lastPartialSignature) return
      state.lastPartialSignature = signature
    } else {
      state.lastPartialSignature = ""
    }
    sendEvent("onAssistantRecognition", mapOf(
      "responseId" to state.responseId,
      "generation" to state.generation,
      "language" to state.language,
      "words" to words,
      "endpoint" to endpoint,
      "audioDurationMs" to state.resampler.audioDurationMs
    ))
  }

  private fun failAssistantOutput(state: AssistantOutputState, stage: String, message: String) {
    synchronized(assistantLock) {
      if (assistantGeneration.get() != state.generation || assistantResponseId != state.responseId) return
      assistantGeneration.incrementAndGet()
      assistantResponseId = null
      assistantEnding = true
    }
    sendAssistantError(state.responseId, state.generation, state.language, stage, message)
    releaseAssistantOutput(state.generation)
  }

  private fun sendAssistantError(responseId: String, generation: Int, language: String, stage: String, message: String) {
    sendEvent("onAssistantRecognitionError", mapOf(
      "responseId" to responseId,
      "generation" to generation,
      "language" to language,
      "stage" to stage,
      "message" to message
    ))
  }

  private fun prepareRecognizer(language: String, assetDir: String, grammarJson: String, emergencyGrammarJson: String) {
    synchronized(modelLock) { assistantModelChanging = true }
    cancelAssistantOutput(null, force = true, reason = "model-change")
    awaitAssistantOutputRelease()

    val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
    val started = SystemClock.elapsedRealtime()
    val destination = File(context.filesDir, "vosk-command-models/$assetDir")
    val cached = destination.exists() && destination.list()?.isNotEmpty() == true

    if (!cached) {
      destination.parentFile?.mkdirs()
      copyAssetTree(context.assets, assetDir, destination)
    }

    val modelChanged = synchronized(modelLock) {
      currentLanguage != language || currentAssetDir != assetDir || model == null
    }
    if (modelChanged) {
      closeRecognizer()
      val loadedModel = Model(destination.absolutePath)
      synchronized(modelLock) {
        model = loadedModel
        currentLanguage = language
        currentAssetDir = assetDir
      }
    } else {
      recognizer?.close()
      recognizer = null
      emergencyRecognizer?.close()
      emergencyRecognizer = null
    }

    currentGrammar = grammarJson
    currentEmergencyGrammar = emergencyGrammarJson
    val loadedModel = model ?: throw IllegalStateException("Vosk model could not be loaded")
    recognizer = Recognizer(loadedModel, 16000.0f, grammarJson).also {
      it.setWords(true)
      it.setPartialWords(false)
      it.setEndpointerMode(Recognizer.EndpointerMode.SHORT)
      // Restored v1.1.36 command behavior after the v1.1.37 600 ms endpoint
      // experiment regressed repeated driving control on the physical robot.
      it.setEndpointerDelays(3.0f, 0.26f, 5.0f)
    }
    emergencyRecognizer = Recognizer(loadedModel, 16000.0f, emergencyGrammarJson).also {
      it.setWords(false)
      it.setPartialWords(false)
      it.setEndpointerMode(Recognizer.EndpointerMode.SHORT)
      // Endpoint is only a fallback: JS executes emergency STOP on a matching
      // partial. Keep finalization short for cases where only final text appears.
      it.setEndpointerDelays(3.0f, 0.12f, 3.0f)
    }
    lastPartial = ""
    lastEmergencyPartial = ""
    lastEmergencyUnknownEventAtMs = 0L
    lastEmergencyHealthEventAtMs = 0L
    emergencyArmed = false
    emergencyArmGeneration.incrementAndGet()
    sequence = 0
    currentSessionId = sessionCounter.incrementAndGet()
    resetGeneration.set(0)
    resetCount.set(0)
    appliedResetGeneration = 0
    samplesSinceReset.set(0)
    emergencySamplesSinceReset.set(0)
    synchronized(modelLock) { assistantModelChanging = false }

    sendEvent(
      "onModelReady",
      mapOf(
        "language" to language,
        "assetDir" to assetDir,
        "loadMs" to (SystemClock.elapsedRealtime() - started),
        "cached" to cached,
        "sessionId" to currentSessionId,
        "resetGeneration" to appliedResetGeneration
      )
    )
    sendRecognizerState("ready", "prepare", appliedResetGeneration, resetCount.get(), queuedChunks.get(), 0L)
  }

  private fun closeRecognizer() {
    synchronized(modelLock) {
      try { recognizer?.close() } catch (_: Throwable) {}
      recognizer = null
      try { emergencyRecognizer?.close() } catch (_: Throwable) {}
      emergencyRecognizer = null
      try { model?.close() } catch (_: Throwable) {}
      model = null
    }
    lastPartial = ""
    lastEmergencyPartial = ""
    lastEmergencyUnknownEventAtMs = 0L
    lastEmergencyHealthEventAtMs = 0L
    emergencyArmed = false
    emergencyArmGeneration.incrementAndGet()
    emergencySamplesSinceReset.set(0)
  }

  private fun calculateRms(pcm: FloatArray): Double {
    if (pcm.isEmpty()) return 0.0
    var sumSquares = 0.0
    for (sample in pcm) {
      val value = sample.toDouble()
      sumSquares += value * value
    }
    return sqrt(sumSquares / pcm.size.toDouble())
  }

  private fun sendRecognizerState(
    state: String,
    reason: String,
    generation: Int,
    count: Int,
    queueDepth: Int,
    processingMs: Long,
    emergencyReset: Boolean = false
  ) {
    sendEvent(
      "onRecognizerState",
      mapOf(
        "state" to state,
        "reason" to reason,
        "sessionId" to currentSessionId,
        "resetGeneration" to generation,
        "resetCount" to count,
        "queuedChunks" to queueDepth,
        "droppedChunks" to 0,
        "samplesSinceReset" to samplesSinceReset.get(),
        "emergencySamplesSinceReset" to emergencySamplesSinceReset.get(),
        "emergencyArmed" to emergencyArmed,
        "emergencyArmGeneration" to emergencyArmGeneration.get(),
        "emergencyReset" to emergencyReset,
        "processingMs" to processingMs
      )
    )
  }

  private fun copyAssetTree(assetManager: AssetManager, assetPath: String, destination: File) {
    val children = assetManager.list(assetPath) ?: emptyArray()
    if (children.isEmpty()) {
      destination.parentFile?.mkdirs()
      assetManager.open(assetPath).use { input ->
        FileOutputStream(destination).use { output -> input.copyTo(output, 1024 * 1024) }
      }
      return
    }

    destination.mkdirs()
    for (child in children) {
      copyAssetTree(assetManager, "$assetPath/$child", File(destination, child))
    }
  }

  private fun sendError(stage: String, error: Throwable) {
    sendEvent(
      "onRecognizerError",
      mapOf(
        "stage" to stage,
        "message" to (error.message ?: error.javaClass.simpleName)
      )
    )
  }
}
