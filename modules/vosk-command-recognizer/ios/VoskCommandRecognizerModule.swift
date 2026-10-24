import Foundation
import ExpoModulesCore

public final class VoskCommandRecognizerModule: Module {
  private let worker = DispatchQueue(label: "mylooi.vosk", qos: .userInitiated)
  private let gate = NSLock()
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

  public func definition() -> ModuleDefinition {
    Name("VoskCommandRecognizer")
    Events("onCommandResult", "onEmergencyStop", "onEmergencyUnknown", "onEmergencyHealth", "onModelReady", "onRecognizerError", "onRecognizerState")
    AsyncFunction("prepare") { (language: String, assetDir: String, grammar: String, emergencyGrammar: String) in
      self.disarm()
      try self.worker.sync {
        guard ["vosk-command-ru", "vosk-command-uk", "vosk-command-en"].contains(assetDir),
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
    Function("reset") { (reason: String, resetEmergency: Bool) -> Int in
      if resetEmergency { self.disarm() }
      return self.worker.sync { self.reset(resetEmergency, reason: reason) }
    }
    Function("getStatus") { self.worker.sync { self.status() } }
    Function("unload") {
      self.disarm()
      self.worker.sync { self.normal = nil; self.emergency = nil; self.model = nil; self.language = "" }
    }
    OnAppEntersBackground { self.disarm() }
    OnDestroy {
      self.disarm()
      self.worker.sync { self.normal = nil; self.emergency = nil; self.model = nil }
    }
  }

  @discardableResult private func disarm() -> Int {
    gate.lock(); defer { gate.unlock() }
    armed = false; armGeneration += 1; return armGeneration
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
