import Foundation
import ExpoModulesCore

public final class VoskCommandRecognizerModule: Module {
  private let worker = DispatchQueue(label: "mylooi.vosk", qos: .userInitiated)
  // Assistant output work never shares the microphone / emergency STOP queue.
  private let assistantWorker = DispatchQueue(label: "mylooi.vosk.assistant-output", qos: .utility)
  private let gate = NSLock()
  private let assistantGate = NSLock()
  private var armGeneration = 0
  private var armed = false
  private var queued = 0
  private var model: LooiVoskModel?
  private var normal: LooiVoskDecoder?
  private var emergency: LooiVoskDecoder?
  private var language = ""
  private var sessionId = 0
  private var generation = 0
  private var resetCount = 0
  private var samples = 0
  private var emergencySamples = 0
  private var sequence = 0
  private var lastPartial = ""
  private var lastEmergencyPartial = ""
  private var lastHealth = 0.0
  private var assistantGeneration = 0
  private var assistantResponseId: String?
  private var assistantLanguage = ""
  private var assistantModelChanging = false
  private var assistantQueued = 0
  private var assistantQueuedPayloadBytes = 0
  private var assistantEnding = false
  private var assistantDecoder: LooiVoskAssistantOutputDecoder?
  private var assistantDecoderGeneration = -1
  private let assistantQueueLimit = 8
  private let assistantQueuedPayloadByteLimit = 128 * 1024
  private let assistantPayloadLimit = 65_536

  public func definition() -> ModuleDefinition {
    Name("VoskCommandRecognizer")
    Events("onCommandResult", "onEmergencyStop", "onEmergencyUnknown", "onEmergencyHealth", "onModelReady", "onRecognizerError", "onRecognizerState", "onAssistantRecognition", "onAssistantRecognitionError")
    AsyncFunction("prepare") { (language: String, assetDir: String, grammar: String, emergencyGrammar: String) in
      self.assistantGate.lock(); self.assistantModelChanging = true; self.assistantGate.unlock()
      self.invalidateAssistantOutput(reason: "model-change", force: true)
      self.assistantWorker.sync {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
      }
      self.disarm()
      try self.worker.sync {
        guard ["vosk-command-ru", "vosk-command-uk", "vosk-command-en", "vosk-command-de"].contains(assetDir),
          let url = Bundle.main.url(forResource: assetDir, withExtension: "bundle") else {
          throw self.error("Bundled Vosk model is missing; run the iOS preparation script before building")
        }
        let start = ProcessInfo.processInfo.systemUptime
        self.normal = nil; self.emergency = nil; self.model = nil
        guard let model = LooiVoskModel(path: url.path),
          let normal = LooiVoskDecoder(model: model, grammar: grammar),
          let emergency = LooiVoskDecoder(model: model, grammar: emergencyGrammar) else {
          throw self.error("Vosk model or grammar could not be loaded")
        }
        self.model = model; self.normal = normal; self.emergency = emergency
        self.language = language; self.sessionId += 1; self.generation = 0; self.resetCount = 0
        self.samples = 0; self.emergencySamples = 0; self.sequence = 0
        self.lastPartial = ""; self.lastEmergencyPartial = ""
        self.assistantGate.lock(); self.assistantModelChanging = false; self.assistantGate.unlock()
        self.sendEvent("onModelReady", ["language": language, "assetDir": assetDir,
          "loadMs": (ProcessInfo.processInfo.systemUptime - start) * 1000, "cached": true,
          "sessionId": self.sessionId, "resetGeneration": 0])
      }
    }
    AsyncFunction("setGrammar") { (grammar: String) in
      self.disarm()
      try self.worker.sync {
        guard let model = self.model, let decoder = LooiVoskDecoder(model: model, grammar: grammar) else {
          throw self.error("Vosk is not ready for a grammar change")
        }
        self.normal = decoder; _ = self.reset(true, reason: "set-grammar")
      }
    }
    AsyncFunction("armEmergency") { (reason: String) -> Bool in
      let requested = self.disarm()
      return self.worker.sync {
        guard let emergency = self.emergency else { return false }
        emergency.reset(); self.emergencySamples = 0; self.lastEmergencyPartial = ""; self.lastHealth = 0
        self.gate.lock()
        let current = self.armGeneration == requested
        if current { self.armed = true }
        self.gate.unlock()
        if current { self.emitState("emergency-armed", reason: reason) }
        return current
      }
    }
    AsyncFunction("disarmEmergency") { (reason: String) in
      self.disarm()
      self.worker.sync { self.emergency?.reset(); self.emergencySamples = 0; self.emitState("emergency-disarmed", reason: reason) }
    }
    Function("feedSamples") { (input: [Double]) in
      guard !input.isEmpty, input.count <= 8000, input.allSatisfy({ $0.isFinite }) else { return }
      self.gate.lock()
      let arm = self.armed ? self.armGeneration : -1
      // A bounded native backlog is essential for timely STOP recognition.
      let overloaded = self.queued >= 15
      if !overloaded { self.queued += 1 }
      self.gate.unlock()
      if overloaded {
        self.disarm()
        self.sendEvent("onRecognizerError", ["stage": "backlog", "message": "Vosk audio queue exceeded its latency budget"])
        return
      }
      self.worker.async {
        defer { self.gate.lock(); self.queued -= 1; self.gate.unlock() }
        self.feed(input, arm: arm)
      }
    }
    AsyncFunction("beginAssistantOutput") { (outputLanguage: String, responseId: String) -> [String: Any] in
      self.beginAssistantOutput(language: outputLanguage, responseId: responseId)
    }
    Function("feedAssistantPcm24") { (responseId: String, pcm24Base64: String) -> Bool in
      self.feedAssistantPcm24(responseId: responseId, pcm24Base64: pcm24Base64)
    }
    Function("endAssistantOutput") { (responseId: String) in
      self.endAssistantOutput(responseId: responseId)
    }
    Function("cancelAssistantOutput") { (responseId: String) in
      self.invalidateAssistantOutput(reason: "cancelled", responseId: responseId, force: false)
    }
    Function("reset") { (reason: String, resetEmergency: Bool) -> Int in
      if resetEmergency { self.disarm() }
      return self.worker.sync { self.reset(resetEmergency, reason: reason) }
    }
    Function("getStatus") { self.worker.sync { self.status() } }
    Function("unload") {
      self.assistantGate.lock(); self.assistantModelChanging = true; self.assistantGate.unlock()
      self.invalidateAssistantOutput(reason: "unload", force: true)
      self.disarm()
      self.assistantWorker.sync {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
      }
      self.worker.sync { self.normal = nil; self.emergency = nil; self.model = nil; self.language = "" }
    }
    OnAppEntersBackground {
      self.disarm()
      self.invalidateAssistantOutput(reason: "background", force: true)
    }
    OnDestroy {
      self.assistantGate.lock(); self.assistantModelChanging = true; self.assistantGate.unlock()
      self.invalidateAssistantOutput(reason: "destroy", force: true)
      self.disarm()
      self.assistantWorker.sync {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
      }
      self.worker.sync { self.normal = nil; self.emergency = nil; self.model = nil }
    }
  }

  @discardableResult private func disarm() -> Int {
    gate.lock(); defer { gate.unlock() }
    armed = false; armGeneration += 1; return armGeneration
  }

  private func languageKey(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
      .split(whereSeparator: { $0 == "-" || $0 == "_" })
      .first.map(String.init) ?? ""
  }

  private func beginAssistantOutput(language outputLanguage: String, responseId: String) -> [String: Any] {
    let response = responseId.trimmingCharacters(in: .whitespacesAndNewlines)
    assistantGate.lock()
    let previousGeneration = assistantGeneration
    assistantGeneration += 1
    let modelChanging = assistantModelChanging
    let outputGeneration = assistantGeneration
    assistantResponseId = response.isEmpty ? nil : response
    assistantLanguage = outputLanguage
    assistantEnding = false
    assistantGate.unlock()

    // Snapshot the current model on its owner queue. The output decoder keeps
    // a strong reference, so model replacement cannot free it mid-recognition.
    let snapshot = worker.sync { (model, language) }
    guard !modelChanging, !response.isEmpty, languageKey(outputLanguage) == languageKey(snapshot.1),
      let loadedModel = snapshot.0 else {
      assistantGate.lock()
      if assistantGeneration == outputGeneration {
        assistantResponseId = nil
        assistantEnding = true
      }
      assistantGate.unlock()
      assistantWorker.sync {
        if assistantDecoderGeneration == previousGeneration {
          assistantDecoder = nil
          assistantDecoderGeneration = -1
        }
      }
      return ["ready": false, "generation": outputGeneration]
    }

    let ready = assistantWorker.sync { () -> Bool in
      guard isCurrentAssistantOutput(outputGeneration, responseId: response) else { return false }
      self.assistantDecoder = nil
      self.assistantDecoderGeneration = -1
      guard let decoder = LooiVoskAssistantOutputDecoder(model: loadedModel) else { return false }
      assistantDecoder = decoder
      assistantDecoderGeneration = outputGeneration
      return true
    }
    if !ready {
      assistantGate.lock()
      if assistantGeneration == outputGeneration {
        assistantResponseId = nil
        assistantEnding = true
      }
      assistantGate.unlock()
    }
    return ["ready": ready, "generation": outputGeneration]
  }

  private func feedAssistantPcm24(responseId: String, pcm24Base64: String) -> Bool {
    let response = responseId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !response.isEmpty, !pcm24Base64.isEmpty,
      pcm24Base64.utf8.count <= assistantPayloadLimit else { return false }
    let payloadByteCount = pcm24Base64.utf8.count

    assistantGate.lock()
    guard assistantResponseId == response, !assistantEnding else {
      assistantGate.unlock()
      return false
    }
    if assistantQueued >= assistantQueueLimit ||
      assistantQueuedPayloadBytes + payloadByteCount > assistantQueuedPayloadByteLimit {
      let outputGeneration = assistantGeneration
      let outputLanguage = assistantLanguage
      assistantGeneration += 1
      assistantResponseId = nil
      assistantEnding = true
      assistantGate.unlock()
      sendEvent("onAssistantRecognitionError", ["responseId": response, "generation": outputGeneration,
        "language": outputLanguage, "stage": "backlog",
        "message": "Assistant output recognition queue exceeded its latency budget"])
      assistantWorker.async {
        if self.assistantDecoderGeneration == outputGeneration {
          self.assistantDecoder = nil
          self.assistantDecoderGeneration = -1
        }
      }
      return false
    }
    assistantQueued += 1
    assistantQueuedPayloadBytes += payloadByteCount
    let outputGeneration = assistantGeneration
    let outputLanguage = assistantLanguage
    assistantWorker.async {
      defer {
        self.assistantGate.lock()
        self.assistantQueued -= 1
        self.assistantQueuedPayloadBytes -= payloadByteCount
        self.assistantGate.unlock()
      }
      guard self.isCurrentAssistantOutput(outputGeneration, responseId: response),
        self.assistantDecoderGeneration == outputGeneration,
        let decoder = self.assistantDecoder,
        let data = Data(base64Encoded: pcm24Base64), !data.isEmpty,
        data.count <= 48 * 1024, data.count.isMultiple(of: 2) else {
        if self.isCurrentAssistantOutput(outputGeneration, responseId: response) {
          self.failAssistantOutput(responseId: response, generation: outputGeneration,
            language: outputLanguage, stage: "input",
            message: "Invalid or unsupported assistant PCM24 payload")
        }
        return
      }
      self.emitAssistantResults(decoder.accept(pcm24: data), responseId: response,
        generation: outputGeneration, language: outputLanguage)
    }
    assistantGate.unlock()
    return true
  }

  private func endAssistantOutput(responseId: String) {
    let response = responseId.trimmingCharacters(in: .whitespacesAndNewlines)
    assistantGate.lock()
    guard assistantResponseId == response, !assistantEnding else {
      assistantGate.unlock()
      return
    }
    let outputGeneration = assistantGeneration
    let outputLanguage = assistantLanguage
    assistantEnding = true
    assistantGate.unlock()

    // This closure is ordered after all admitted PCM feeds on assistantWorker.
    assistantWorker.async {
      guard self.isCurrentAssistantGeneration(outputGeneration),
        self.assistantDecoderGeneration == outputGeneration,
        let decoder = self.assistantDecoder else { return }
      self.emitAssistantResults(decoder.finish(), responseId: response,
        generation: outputGeneration, language: outputLanguage)
      if self.isCurrentAssistantGeneration(outputGeneration) {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
        self.assistantGate.lock()
        if self.assistantGeneration == outputGeneration && self.assistantResponseId == response {
          self.assistantResponseId = nil
        }
        self.assistantGate.unlock()
      }
    }
  }

  private func isCurrentAssistantGeneration(_ requestedGeneration: Int) -> Bool {
    assistantGate.lock(); defer { assistantGate.unlock() }
    return assistantGeneration == requestedGeneration
  }

  private func isCurrentAssistantOutput(_ requestedGeneration: Int, responseId: String) -> Bool {
    assistantGate.lock(); defer { assistantGate.unlock() }
    return assistantGeneration == requestedGeneration && assistantResponseId == responseId
  }

  private func invalidateAssistantOutput(reason: String, responseId: String? = nil, force: Bool) {
    assistantGate.lock()
    if !force, let responseId,
      assistantResponseId != responseId.trimmingCharacters(in: .whitespacesAndNewlines) {
      assistantGate.unlock()
      return
    }
    let oldGeneration = assistantGeneration
    assistantGeneration += 1
    assistantResponseId = nil
    assistantEnding = true
    assistantGate.unlock()
    assistantWorker.async {
      if self.assistantDecoderGeneration == oldGeneration {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
      }
    }
  }

  private func emitAssistantResults(_ results: [[String: Any]], responseId: String,
                                    generation: Int, language: String) {
    for result in results {
      guard isCurrentAssistantGeneration(generation) else { return }
      if let message = result["error"] as? String {
        failAssistantOutput(responseId: responseId, generation: generation,
          language: language, stage: "decode", message: message)
        return
      }
      guard let endpoint = result["endpoint"] as? Bool,
        let duration = result["audioDurationMs"] as? Double,
        duration.isFinite, duration >= 0,
        let words = result["words"] as? [[String: Any]] else { continue }
      sendEvent("onAssistantRecognition", ["responseId": responseId, "generation": generation,
        "language": language, "words": words, "endpoint": endpoint, "audioDurationMs": duration])
    }
  }

  private func failAssistantOutput(responseId: String, generation: Int, language: String,
                                   stage: String, message: String) {
    assistantGate.lock()
    let current = assistantGeneration == generation && assistantResponseId == responseId
    if current {
      assistantGeneration += 1
      assistantResponseId = nil
      assistantEnding = true
    }
    assistantGate.unlock()
    guard current else { return }
    sendEvent("onAssistantRecognitionError", ["responseId": responseId, "generation": generation,
      "language": language, "stage": stage, "message": message])
    assistantWorker.async {
      if self.assistantDecoderGeneration == generation {
        self.assistantDecoder = nil
        self.assistantDecoderGeneration = -1
      }
    }
  }

  private func reset(_ emergencyToo: Bool, reason: String) -> Int {
    normal?.reset(); samples = 0; lastPartial = ""; generation += 1; resetCount += 1
    if emergencyToo { emergency?.reset(); emergencySamples = 0; lastEmergencyPartial = "" }
    emitState("reset-applied", reason: reason)
    return generation
  }
  private func feed(_ input: [Double], arm: Int) {
    guard let normal else { return }
    let start = ProcessInfo.processInfo.systemUptime
    let pcm = input.map { NSNumber(value: $0) }
    let rms = sqrt(input.reduce(0) { $0 + $1 * $1 } / Double(input.count)) * 32768
    gate.lock(); let emergencyCurrent = armed && arm == armGeneration; gate.unlock()
    if emergencyCurrent, let emergency {
      emergencySamples += input.count
      let result = emergency.accept(samples: pcm)
      let text = (result["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let endpoint = result["endpoint"] as? Bool ?? false
      var event: [String: Any] = ["text": text, "partial": !endpoint, "sessionId": sessionId,
        "samplesSinceEmergencyReset": emergencySamples, "queuedChunks": queueCount(), "rms16": rms,
        "processingMs": (ProcessInfo.processInfo.systemUptime - start) * 1000]
      if start - lastHealth >= 0.5 {
        lastHealth = start; event["armed"] = true; event["armGeneration"] = arm
        event["partialText"] = text; event["endpoint"] = endpoint
        sendEvent("onEmergencyHealth", event)
      }
      // Recheck the immediate gate after decoding, before publishing stale STOPs.
      gate.lock(); let stillCurrent = armed && arm == armGeneration; gate.unlock()
      if stillCurrent, !text.isEmpty, endpoint || text != lastEmergencyPartial {
        lastEmergencyPartial = endpoint ? "" : text
        sendEvent(text == "[unk]" ? "onEmergencyUnknown" : "onEmergencyStop", event)
      }
    }
    samples += input.count
    let result = normal.accept(samples: pcm)
    if let message = result["error"] as? String { sendEvent("onRecognizerError", ["stage": "feed", "message": message]); return }
    let text = (result["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let endpoint = result["endpoint"] as? Bool ?? false
    if endpoint || (!text.isEmpty && text != lastPartial) {
      sequence += 1; lastPartial = endpoint ? "" : text
      sendEvent("onCommandResult", ["text": text, "partial": !endpoint, "sequence": sequence,
        "sessionId": sessionId, "resetGeneration": generation, "samplesSinceReset": samples,
        "queuedChunks": queueCount(), "droppedChunks": 0, "endpoint": endpoint, "rms16": rms,
        "processingMs": (ProcessInfo.processInfo.systemUptime - start) * 1000])
    }
  }
  private func queueCount() -> Int { gate.lock(); defer { gate.unlock() }; return queued }
  private func status() -> [String: Any] {
    gate.lock(); let isArmed = armed; let arm = armGeneration; gate.unlock()
    return ["ready": normal != nil, "language": language, "queuedChunks": queueCount(),
      "sessionId": sessionId, "resetGeneration": generation, "resetCount": resetCount,
      "droppedChunks": 0, "samplesSinceReset": samples, "emergencySamplesSinceReset": emergencySamples,
      "emergencyArmed": isArmed, "emergencyArmGeneration": arm]
  }
  private func emitState(_ state: String, reason: String) {
    var event = status(); event["state"] = state; event["reason"] = reason
    sendEvent("onRecognizerState", event)
  }
  private func error(_ message: String) -> NSError {
    NSError(domain: "MyLOOI.Vosk", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
