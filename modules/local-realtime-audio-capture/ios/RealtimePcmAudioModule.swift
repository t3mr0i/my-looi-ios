import Foundation
import AVFoundation
import ExpoModulesCore
import LooiAppleRuntime

public final class RealtimePcmAudioModule: Module {
  private let worker = DispatchQueue(label: "mylooi.pcm", qos: .userInitiated)
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
  private var converter: AVAudioConverter?
  private let ingressLock = NSLock()
  private var ingressGeneration: Int?
  private var queuedCaptureSeconds = 0.0
  private var failedIngressGeneration: Int?

  private var capturing = false
  private var voiceProcessingEnabled = false
  private var tapInstalled = false
  private var captureGeneration = 0
  private var chunks = 0
  private var capturedFrames = 0
  private var playbackGeneration = 0
  // Stable output owner survives the player's drain/error generation change.
  // Protected by ingressLock when read by notification callbacks.
  private var outputOnlyGeneration: Int?
  private var playing = false
  private var finishing = false
  private var completedFrames: Int64 = 0
  private struct PlaybackSegment {
    let id: Int
    let start: Int64
    let frames: Int64
    var completed = false
  }
  private var segments: [PlaybackSegment] = []
  private var nextSegmentId = 0
  private var nextPlaybackFrame: Int64 = 0
  private var pending = 0
  private var lastPlayedMs = 0
  private var interruptionObserver: NSObjectProtocol?
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RealtimePcmAudio")
    Events("onAudioData", "onCaptureError", "onPlaybackDrained", "onPlaybackError", "onPlaybackStarted")
    OnCreate {
      self.engine.attach(self.player)
      self.engine.connect(self.player, to: self.engine.mainMixerNode, format: self.playbackFormat)
      self.interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
      ) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          raw == AVAudioSession.InterruptionType.began.rawValue else { return }
        self?.captureFailure("interruption", "Audio was interrupted; restart the conversation when ready")
      }
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange, object: self.engine, queue: nil
      ) { [weak self] _ in
        guard let self else { return }
        self.ingressLock.lock()
        let generation = self.ingressGeneration
        let outputGeneration = self.outputOnlyGeneration
        self.ingressLock.unlock()
        self.worker.async { [weak self] in
          guard let self, !self.engine.isRunning else { return }
          if let generation {
            self.failCapture("route-change", "Audio configuration changed; restart the conversation", generation: generation)
          } else if let outputGeneration, self.outputOnlyGeneration == outputGeneration {
            self.playbackFailure("Audio output configuration changed")
          }
        }
      }
    }
    AsyncFunction("startCapture") { () -> [String: Any] in
      try self.worker.sync { try self.startCapture(); return self.status() }
    }
    AsyncFunction("stopCapture") { () -> [String: Any] in
      self.worker.sync { self.stopCapture(); return self.status() }
    }
    AsyncFunction("getStatus") { self.worker.sync { self.status() } }
    Function("getMonotonicTimeMs") { self.monotonicMs() }
    Function("beginPlayback") { self.worker.sync { self.beginPlayback(); return self.playbackGeneration } }
    AsyncFunction("beginOutputPlayback") { () throws -> Int in
      try self.worker.sync { try self.beginOutputPlayback(); return self.playbackGeneration }
    }
    AsyncFunction("stopOutputPlayback") { (generation: Int) in
      self.worker.sync { self.stopOutputPlayback(generation) }
    }
    Function("enqueuePlayback") { (base64: String) in self.worker.sync { self.enqueue(base64) } }
    Function("finishPlayback") { self.worker.sync { self.finishing = true; self.drainIfReady() } }
    Function("getPlayedDurationMs") { self.worker.sync { self.playedDuration() } }
    Function("stopPlayback") { () -> [String: Int] in
      self.worker.sync { let ms = self.stopPlayback(); return ["playedDurationMs": ms] }
    }
    OnAppEntersBackground {
      self.captureFailure("background", "The application entered the background")
    }
    OnDestroy {
      if let token = self.interruptionObserver { NotificationCenter.default.removeObserver(token) }
      if let token = self.routeObserver { NotificationCenter.default.removeObserver(token) }
      self.worker.sync { self.stopCapture() }
    }
  }

  private func startCapture() throws {
    if capturing { return }
    if let outputGeneration = outputOnlyGeneration { stopOutputPlayback(outputGeneration) }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
      throw looiError("Microphone permission is required")
    }
    try LooiAudioSession.shared.activate()
    engine.stop()
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    voiceProcessingEnabled = true
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
      let converter = AVAudioConverter(from: format, to: output)
    else { throw looiError("No usable microphone format is available") }
    self.converter = converter
    captureGeneration += 1
    let generation = captureGeneration
    chunks = 0
    capturedFrames = 0
    capturing = true
    ingressLock.lock(); ingressGeneration = generation; failedIngressGeneration = nil; ingressLock.unlock()
    input.installTap(onBus: 0, bufferSize: 960, format: format) { [weak self] buffer, when in
      guard let self, buffer.frameLength > 0 else { return }
      let duration = Double(buffer.frameLength) / buffer.format.sampleRate
      let captureStartMs = when.isHostTimeValid
        ? AVAudioTime.seconds(forHostTime: when.hostTime) * 1000
        : self.monotonicMs() - duration * 1000
      self.ingressLock.lock()
      guard self.ingressGeneration == generation, self.failedIngressGeneration != generation else {
        self.ingressLock.unlock(); return
      }
      guard self.queuedCaptureSeconds + duration <= 0.5 else {
        self.failedIngressGeneration = generation
        self.ingressLock.unlock()
        self.worker.async { [weak self] in
          self?.failCapture("capture-backlog", "Microphone processing exceeded its latency budget", generation: generation)
        }
        return
      }
      self.queuedCaptureSeconds += duration
      self.ingressLock.unlock()
      // AVAudioEngine reuses this storage. Copy only after admission to a
      // bounded half-second queue, not into an unlimited stream of work items.
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
        self.releaseIngress(duration)
        self.worker.async { [weak self] in
          self?.failCapture("allocation", "Microphone buffer allocation failed", generation: generation)
        }
        return
      }
      copy.frameLength = buffer.frameLength
      let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
      let target = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
      for index in 0..<source.count {
        if let src = source[index].mData, let dst = target[index].mData {
          memcpy(dst, src, Int(source[index].mDataByteSize))
        }
      }
      self.worker.async { [weak self] in
        guard let self else { return }
        defer { self.releaseIngress(duration) }
        self.emitCapture(copy, generation: generation, captureStartMs: captureStartMs,
          captureDurationMs: duration * 1000, captureTimeSource: when.isHostTimeValid ? "audio-host-time" : "tap-receipt-estimate")
      }
    }
    tapInstalled = true
    do { engine.prepare(); try engine.start() }
    catch { stopCapture(); throw error }
  }

  private func monotonicMs() -> Double {
    AVAudioTime.seconds(forHostTime: mach_absolute_time()) * 1000
  }

  private func emitCapture(_ input: AVAudioPCMBuffer, generation: Int, captureStartMs: Double,
    captureDurationMs: Double, captureTimeSource: String) {
    guard capturing, generation == captureGeneration, let converter else { return }
    let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 16000 / input.format.sampleRate) + 64)
    guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, state in
      if consumed { state.pointee = .noDataNow; return nil }
      consumed = true; state.pointee = .haveData; return input
    }
    if let error { failCapture("convert", error.localizedDescription, generation: generation); return }
    guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
    let frames = Int(output.frameLength)
    let data = Data(bytes: samples, count: frames * 2)
    var energy = 0.0
    for index in 0..<frames { let value = Double(samples[index]) / 32768; energy += value * value }
    chunks += 1
    capturedFrames += frames
    sendEvent("onAudioData", ["pcm16Base64": data.base64EncodedString(), "sampleRate": 16000,
      "frames": frames, "rms": sqrt(energy / Double(frames)), "sequence": chunks,
      "timestampMs": ProcessInfo.processInfo.systemUptime * 1000,
      "captureStartMs": captureStartMs, "captureDurationMs": captureDurationMs,
      "nativeEmittedAtMs": monotonicMs(), "captureTimeSource": captureTimeSource])
  }

  private func stopCapture() {
    if let outputGeneration = outputOnlyGeneration { stopOutputPlayback(outputGeneration) }
    _ = stopPlayback()
    ingressLock.lock(); ingressGeneration = nil; ingressLock.unlock()
    capturing = false; captureGeneration += 1
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine.stop()
    converter = nil
  }

  private func releaseIngress(_ duration: Double) {
    ingressLock.lock(); queuedCaptureSeconds = max(0, queuedCaptureSeconds - duration); ingressLock.unlock()
  }

  private func captureFailure(_ stage: String, _ message: String) {
    ingressLock.lock()
    let generation = ingressGeneration
    let outputGeneration = outputOnlyGeneration
    ingressLock.unlock()
    worker.async { [weak self] in
      guard let self else { return }
      if let generation { self.failCapture(stage, message, generation: generation) }
      else if let outputGeneration, self.outputOnlyGeneration == outputGeneration { self.playbackFailure(message) }
    }
  }

  // Only invoked on the worker. Old route/converter callbacks must not tear
  // down a newer capture that has started since they were queued.
  private func failCapture(_ stage: String, _ message: String, generation: Int) {
    guard capturing, captureGeneration == generation else { return }
    stopCapture()
    sendEvent("onCaptureError", ["stage": stage, "message": message])
  }

  private func beginPlayback() {
    _ = stopPlayback()
    segments = []; nextSegmentId = 0; nextPlaybackFrame = 0
    completedFrames = 0; pending = 0; lastPlayedMs = 0
    finishing = false; playing = true
  }

  private func beginOutputPlayback() throws {
    guard !capturing, !tapInstalled else { throw looiError("Microphone capture must be released before cloud speech") }
    if let outputGeneration = outputOnlyGeneration { stopOutputPlayback(outputGeneration) }
    engine.stop()
    if voiceProcessingEnabled {
      try engine.inputNode.setVoiceProcessingEnabled(false)
      voiceProcessingEnabled = false
    }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [])
    try session.setActive(true)
    do {
      engine.prepare()
      try engine.start()
    } catch {
      engine.stop()
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      throw error
    }
    beginPlayback()
    ingressLock.lock(); outputOnlyGeneration = playbackGeneration; ingressLock.unlock()
  }

  private func stopOutputPlayback(_ generation: Int) {
    guard outputOnlyGeneration == generation else { return }
    ingressLock.lock(); outputOnlyGeneration = nil; ingressLock.unlock()
    _ = stopPlayback()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func playerFrame() -> Int64 {
    guard let render = player.lastRenderTime, let time = player.playerTime(forNodeTime: render) else { return 0 }
    return max(0, time.sampleTime)
  }

  private func enqueue(_ base64: String) {
    guard playing else { return }
    guard let data = Data(base64Encoded: base64), data.count % 2 == 0,
      data.count <= 24000 * 2 * 5 else {
      playbackFailure("Invalid PCM24 playback buffer"); return
    }
    let frames = data.count / 2
    if frames == 0 { return }
    let queuedFrames = segments.reduce(Int64(0)) { $0 + ($1.completed ? 0 : $1.frames) }
    guard queuedFrames + Int64(frames) <= 24000 * 30 else {
      playbackFailure("PCM playback queue exceeded 30 seconds"); return
    }
    guard engine.isRunning,
      let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)) else {
      playbackFailure("Audio capture engine is not running"); return
    }
    buffer.frameLength = AVAudioFrameCount(frames)
    data.withUnsafeBytes { raw in
      let bytes = raw.bindMemory(to: UInt8.self)
      for index in 0..<frames {
        let bits = UInt16(bytes[index * 2]) | UInt16(bytes[index * 2 + 1]) << 8
        buffer.floatChannelData![0][index] = Float(Int16(bitPattern: bits)) / 32768
      }
    }
    let now = playerFrame()
    let start = nextSegmentId == 0 ? 0 : max(now + 240, nextPlaybackFrame)
    nextPlaybackFrame = start + Int64(frames)
    let segmentId = nextSegmentId
    nextSegmentId += 1
    segments.append(PlaybackSegment(id: segmentId, start: start, frames: Int64(frames)))
    pending += 1
    let generation = playbackGeneration
    player.scheduleBuffer(buffer, at: AVAudioTime(sampleTime: start, atRate: 24000),
      options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.worker.async { [weak self] in
        guard let self, generation == self.playbackGeneration else { return }
        if let index = self.segments.firstIndex(where: { $0.id == segmentId }) {
          self.segments[index].completed = true
        }
        while let first = self.segments.first, first.completed {
          self.completedFrames += first.frames
          self.segments.removeFirst()
        }
        self.pending -= 1
        self.drainIfReady()
      }
    }
    if !player.isPlaying {
      player.play()
      reportPlaybackStart(generation: generation, attempt: 0)
    }
  }

  // A render-clock estimate is distinct from an acoustic measurement at the
  // speaker. Keep its clock and route latency explicit in diagnostic metadata.
  private func reportPlaybackStart(generation: Int, attempt: Int) {
    guard playing, generation == playbackGeneration else { return }
    if let render = player.lastRenderTime, render.isHostTimeValid,
      let time = player.playerTime(forNodeTime: render), time.isSampleTimeValid, time.sampleRate > 0,
      time.sampleTime > 0 {
      let renderStartMs = AVAudioTime.seconds(forHostTime: render.hostTime) * 1000
        - Double(time.sampleTime) / time.sampleRate * 1000
      let session = AVAudioSession.sharedInstance()
      sendEvent("onPlaybackStarted", ["generation": generation, "renderStartMs": renderStartMs,
        "estimatedAudibleStartMs": renderStartMs + (session.outputLatency + session.ioBufferDuration) * 1000,
        "outputLatencyMs": session.outputLatency * 1000, "ioBufferDurationMs": session.ioBufferDuration * 1000])
      return
    }
    guard attempt < 100 else { return }
    worker.asyncAfter(deadline: .now() + .milliseconds(10)) { [weak self] in
      self?.reportPlaybackStart(generation: generation, attempt: attempt + 1)
    }
  }

  private func playedDuration() -> Int {
    guard playing else { return lastPlayedMs }
    let session = AVAudioSession.sharedInstance()
    let now = max(0, playerFrame() - Int64((session.outputLatency + session.ioBufferDuration) * 24000))
    let frames = segments.reduce(completedFrames) { total, segment in
      total + (segment.completed ? segment.frames : min(segment.frames, max(0, now - segment.start)))
    }
    lastPlayedMs = max(lastPlayedMs, Int(frames * 1000 / 24000))
    return lastPlayedMs
  }

  @discardableResult private func stopPlayback() -> Int {
    lastPlayedMs = playedDuration()
    playbackGeneration += 1
    playing = false; finishing = false; player.stop(); pending = 0
    return lastPlayedMs
  }

  private func playbackFailure(_ message: String) {
    let generation = playbackGeneration
    if let outputGeneration = outputOnlyGeneration { stopOutputPlayback(outputGeneration) }
    else { _ = stopPlayback() }
    sendEvent("onPlaybackError", ["message": message, "generation": generation])
  }

  private func drainIfReady() {
    guard playing, finishing, pending == 0 else { return }
    let generation = playbackGeneration
    let ms = playedDuration()
    if let outputGeneration = outputOnlyGeneration { stopOutputPlayback(outputGeneration) }
    else { _ = stopPlayback() }
    sendEvent("onPlaybackDrained", ["playedDurationMs": ms, "generation": generation])
  }

  private func status() -> [String: Any] {
    ["supported": true, "captureRunning": capturing, "captureSampleRate": 16000,
     "audioSource": "VOICE_PROCESSING_IO", "audioSessionId": NSNull(),
     "aecAvailable": true, "aecEnabled": capturing && engine.inputNode.isVoiceProcessingEnabled,
     "noiseSuppressorExplicit": false, "captureChunks": chunks, "captureFrames": capturedFrames, "playbackRunning": playing,
     "playbackSampleRate": 24000, "playedDurationMs": playedDuration(), "playbackQueuedChunks": pending]
  }
}
