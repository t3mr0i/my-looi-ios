import Foundation
import AVFoundation
import UIKit
import ImageIO

public func looiError(_ message: String) -> NSError {
  NSError(domain: "MyLOOI", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

/// Audio-session changes must be shared by capture, playback and route modules.
public final class LooiAudioSession {
  public static let shared = LooiAudioSession()
  private let lock = NSRecursiveLock()
  private var previous: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
  private var isActive = false
  public var active: Bool {
    lock.lock(); defer { lock.unlock() }; return isActive
  }

  public func activate() throws {
    lock.lock(); defer { lock.unlock() }
    let session = AVAudioSession.sharedInstance()
    if isActive && session.category == .playAndRecord && session.mode == .voiceChat { return }
    if previous == nil { previous = (session.category, session.mode, session.categoryOptions) }
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setPreferredSampleRate(48000)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    // Respect a selected wired/Bluetooth route; only force speaker for the receiver.
    if session.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) {
      try session.overrideOutputAudioPort(.speaker)
    }
    isActive = true
  }

  public func deactivate() throws {
    lock.lock(); defer { lock.unlock() }
    guard isActive else { return }
    let session = AVAudioSession.sharedInstance()
    try session.overrideOutputAudioPort(.none)
    try session.setActive(false, options: .notifyOthersOnDeactivation)
    if let old = previous { try session.setCategory(old.0, mode: old.1, options: old.2) }
    previous = nil
    isActive = false
  }
}

public enum LooiAppleUI {
  public static func presenter() throws -> UIViewController {
    guard Thread.isMainThread else { throw looiError("Presentation requires the main thread") }
    guard var vc = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
      .filter({ $0.activationState == .foregroundActive })
      .flatMap({ $0.windows }).first(where: { $0.isKeyWindow })?.rootViewController
    else { throw looiError("No foreground window is available") }
    while let next = vc.presentedViewController { vc = next }
    return vc
  }
}

public enum LooiImage {
  /// Decode a bounded, orientation-correct thumbnail. Never persist the source.
  public static func jpeg(_ data: Data, maxDimension: Int = 2048, quality: CGFloat = 0.9) throws -> (Data, Int, Int) {
    guard data.count <= 64 * 1024 * 1024,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxDimension,
        kCGImageSourceShouldCacheImmediately: true
      ] as CFDictionary),
      let encoded = UIImage(cgImage: image).jpegData(compressionQuality: quality)
    else { throw looiError("The selected image could not be decoded") }
    return (encoded, image.width, image.height)
  }
}
