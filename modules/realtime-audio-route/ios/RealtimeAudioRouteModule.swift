import Foundation
import AVFoundation
import ExpoModulesCore
import LooiAppleRuntime

public final class RealtimeAudioRouteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RealtimeAudioRoute")
    AsyncFunction("activateSpeakerRoute") { () -> [String: Any] in
      try LooiAudioSession.shared.activate(); return self.status()
    }
    AsyncFunction("ensureSpeakerRoute") { () -> [String: Any] in
      try LooiAudioSession.shared.activate(); return self.status()
    }
    AsyncFunction("deactivateSpeakerRoute") { () -> [String: Any] in
      try LooiAudioSession.shared.deactivate(); return self.status()
    }
    AsyncFunction("getStatus") { self.status() }
  }
  private func status() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let outputs = session.currentRoute.outputs
    let speaker = outputs.contains { $0.portType == .builtInSpeaker }
    let usable = outputs.contains { $0.portType != .builtInReceiver }
    return ["supported": true, "active": LooiAudioSession.shared.active,
      "sdkInt": 0, "mode": 0, "modeName": session.mode.rawValue,
      "modeMatchesCommunication": session.category == .playAndRecord && session.mode == .voiceChat,
      "modeChangedByModule": LooiAudioSession.shared.active, "routeStrategy": "AVAudioSession",
      "speakerSelected": usable, "speakerphoneOn": speaker, "speakerDeviceAvailable": true,
      "availableCommunicationDeviceTypes": outputs.map { $0.portType.rawValue }.joined(separator: ","),
      "communicationDeviceName": outputs.first?.portName ?? "", "routeOwnershipMismatch": false,
      "activeRouteMismatch": !usable, "deviceMutationSequence": 0, "modeMutationSequence": 0,
      "activeRecordingCount": 0, "voiceCommunicationRecordingCount": 0,
      "recordingConfigSummary": session.mode.rawValue, "primaryClientEffects": "VoiceProcessingIO",
      "primaryStreamEffects": "VoiceProcessingIO", "primaryClientHasAec": true,
      "primaryStreamHasAec": true, "primaryClientHasNs": false, "primaryStreamHasNs": false,
      "primaryClientHasAgc": false, "primaryStreamHasAgc": false,
      "platformAecAvailable": true, "platformNsAvailable": false, "platformAgcAvailable": false,
      "platformPreprocessorCatalog": "VoiceProcessingIO"]
  }
}
