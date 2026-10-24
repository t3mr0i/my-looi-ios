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
  private var capturing = false
  private var tapInstalled = false
  private var captureGeneration = 0
  private var chunks = 0
  private var capturedFrames = 0
  private var playbackGeneration = 0
  private var playing = false
  private var finishing = false
  private var completedFrames: Int64 = 0
  private var segments: [(start: Int64, frames: Int64)] = []
  private var pending = 0
  private var lastPlayedMs = 0
  private var interruptionObserver: NSObjectProtocol?
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RealtimePcmAudio")
    Events("onAudioData", "onCaptureError", "onPlaybackDrained", "onPlaybackError")
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
        self?.worker.async { [weak self] in
          guard let self, self.capturing, !self.engine.isRunning else { return }
          self.captureFailure("route-change", "Audio configuration changed; restart the conversation")
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
    Function("beginPlayback") { self.worker.sync { self.beginPlayback() } }
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
      self.worker.sync { self.stopCapture(); _ = self.stopPlayback() }
    }
  }

  private func startCapture() throws {
    if capturing { return }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
      throw looiError("Microphone permission is required")
    }
    try LooiAudioSession.shared.activate()
    engine.stop()
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
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
    input.installTap(onBus: 0, bufferSize: 960, format: format) { [weak self] buffer, _ in
      // AVAudioEngine reuses the tap's storage after this callback returns.
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return }
      copy.frameLength = buffer.frameLength
      let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
      let target = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
      for index in 0..<source.count {
        if let src = source[index].mData, let dst = target[index].mData {
          memcpy(dst, src, Int(source[index].mDataByteSize))
        }
      }
      self?.worker.async { [weak self] in self?.emitCapture(copy, generation: generation) }
    }
    tapInstalled = true
    do { engine.prepare(); try engine.start() }
    catch { stopCapture(); throw error }
  }

  private func emitCapture(_ input: AVAudioPCMBuffer, generation: Int) {
    guard capturing, generation == captureGeneration, let converter else { return }
    let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 16000 / input.format.sampleRate) + 64)
    guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, state in
      if consumed { state.pointee = .noDataNow; return nil }
      consumed = true; state.pointee = .haveData; return input
    }
    if let error { captureFailure("convert", error.localizedDescription); return }
    guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
    let frames = Int(output.frameLength)
    let data = Data(bytes: samples, count: frames * 2)
    var energy = 0.0
    for index in 0..<frames { let value = Double(samples[index]) / 32768; energy += value * value }
    chunks += 1
    capturedFrames += frames
    sendEvent("onAudioData", ["pcm16Base64": data.base64EncodedString(), "sampleRate": 16000,
      "frames": frames, "rms": sqrt(energy / Double(frames)), "sequence": chunks,
      "timestampMs": ProcessInfo.processInfo.systemUptime * 1000])
  }

  private func stopCapture() {
    capturing = false; captureGeneration += 1
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine.stop()
    converter = nil
  }

  private func captureFailure(_ stage: String, _ message: String) {
    worker.async { [weak self] in
      guard let self, self.capturing else { return }
      self.stopCapture(); _ = self.stopPlayback()
      self.sendEvent("onCaptureError", ["stage": stage, "message": message])
    }
  }

  private func beginPlayback() {
    _ = stopPlayback()
    segments = []; completedFrames = 0; pending = 0; lastPlayedMs = 0
    finishing = false; playing = true
  }

  private func playerFrame() -> Int64 {
    guard let render = player.lastRenderTime, let time = player.playerTime(forNodeTime: render) else { return 0 }
    return max(0, time.sampleTime)
  }

  private func enqueue(_ base64: String) {
    guard playing else { return }
    guard let data = Data(base64Encoded: base64), data.count % 2 == 0,
      data.count <= 24000 * 2 * 5 else {
      sendEvent("onPlaybackError", ["message": "Invalid PCM24 playback buffer"]); return
    }
    let frames = data.count / 2
    if frames == 0 { return }
    let queuedFrames = segments.reduce(Int64(0)) { $0 + $1.frames } - completedFrames
    guard queuedFrames + Int64(frames) <= 24000 * 30 else {
      sendEvent("onPlaybackError", ["message": "PCM playback queue exceeded 30 seconds"]); return
    }
    guard engine.isRunning,
      let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)) else {
      sendEvent("onPlaybackError", ["message": "Audio capture engine is not running"]); return
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
    let start = segments.isEmpty ? 0 : max(now + 240, segments.last.map { $0.start + $0.frames } ?? 0)
    segments.append((start, Int64(frames))); pending += 1
    let generation = playbackGeneration
    player.scheduleBuffer(buffer, at: AVAudioTime(sampleTime: start, atRate: 24000),
      options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.worker.async { [weak self] in
        guard let self, generation == self.playbackGeneration else { return }
        self.completedFrames += Int64(frames); self.pending -= 1; self.drainIfReady()
      }
    }
    if !player.isPlaying { player.play() }
  }

  private func playedDuration() -> Int {
    guard playing else { return lastPlayedMs }
    let session = AVAudioSession.sharedInstance()
    let now = max(0, playerFrame() - Int64((session.outputLatency + session.ioBufferDuration) * 24000))
    let frames = segments.reduce(Int64(0)) { total, segment in
      total + min(segment.frames, max(0, now - segment.start))
    }
    return Int(max(frames, completedFrames) * 1000 / 24000)
  }

  @discardableResult private func stopPlayback() -> Int {
    lastPlayedMs = playedDuration()
    playbackGeneration += 1
    playing = false; finishing = false; player.stop(); pending = 0
    return lastPlayedMs
  }

  private func drainIfReady() {
    guard playing, finishing, pending == 0 else { return }
    let ms = playedDuration(); _ = stopPlayback()
    sendEvent("onPlaybackDrained", ["playedDurationMs": ms])
  }

  private func status() -> [String: Any] {
    ["supported": true, "captureRunning": capturing, "captureSampleRate": 16000,
     "audioSource": "VOICE_PROCESSING_IO", "audioSessionId": NSNull(),
     "aecAvailable": true, "aecEnabled": capturing && engine.inputNode.isVoiceProcessingEnabled,
     "noiseSuppressorExplicit": false, "captureChunks": chunks, "captureFrames": capturedFrames, "playbackRunning": playing,
     "playbackSampleRate": 24000, "playedDurationMs": playedDuration(), "playbackQueuedChunks": pending]
  }
}
