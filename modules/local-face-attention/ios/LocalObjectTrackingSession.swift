import Foundation
import CoreGraphics
import CoreVideo
import Vision

enum LocalObjectTrackingFailure: Error, Equatable {
  case trackingError
  case resultUnavailable
  case lowConfidence
  case outOfBounds
  case implausibleJump
  case sessionEnded

  var lossReason: String {
    switch self {
    case .trackingError: return "tracking_error"
    case .resultUnavailable: return "result_unavailable"
    case .lowConfidence: return "low_confidence"
    case .outOfBounds: return "out_of_bounds"
    case .implausibleJump: return "implausible_jump"
    case .sessionEnded: return "session_ended"
    }
  }
}

struct LocalObjectTrackingSample: Equatable {
  let rect: LocalObjectNormalizedRect
  let confidence: Double
}

/// One explicitly seeded Vision sequence. Call `step` serially; a failed step
/// ends this session and never starts a replacement request automatically.
final class LocalObjectTrackingSession {
  private let request: VNTrackObjectRequest
  private let sequenceHandler: VNSequenceRequestHandler
  private var isTerminal = false
  private(set) var acceptedSample: LocalObjectTrackingSample

  private init(
    request: VNTrackObjectRequest,
    sequenceHandler: VNSequenceRequestHandler,
    acceptedSample: LocalObjectTrackingSample
  ) {
    self.request = request
    self.sequenceHandler = sequenceHandler
    self.acceptedSample = acceptedSample
  }

  static func start(
    pixelBuffer: CVPixelBuffer,
    selectedRect: LocalObjectNormalizedRect
  ) -> Result<LocalObjectTrackingSession, LocalObjectTrackingFailure> {
    guard let visionRect = LocalObjectTrackingGeometry.visionRect(from: selectedRect) else {
      return .failure(.outOfBounds)
    }

    let observation = VNDetectedObjectObservation(boundingBox: visionRect)
    let request = VNTrackObjectRequest(detectedObjectObservation: observation)
    request.trackingLevel = .accurate
    let sequenceHandler = VNSequenceRequestHandler()

    do {
      try sequenceHandler.perform([request], on: pixelBuffer, orientation: .up)
    } catch {
      return .failure(.trackingError)
    }

    guard let tracked = request.results?.first as? VNDetectedObjectObservation else {
      return .failure(.resultUnavailable)
    }
    guard LocalObjectTrackingGeometry.isAcceptableConfidence(Double(tracked.confidence)) else {
      return .failure(.lowConfidence)
    }
    guard let trackedRect = LocalObjectTrackingGeometry.topLeftRect(from: tracked.boundingBox) else {
      return .failure(.outOfBounds)
    }
    guard LocalObjectTrackingGeometry.isPlausibleTransition(from: selectedRect, to: trackedRect) else {
      return .failure(.implausibleJump)
    }

    request.inputObservation = tracked
    return .success(LocalObjectTrackingSession(
      request: request,
      sequenceHandler: sequenceHandler,
      acceptedSample: LocalObjectTrackingSample(
        rect: trackedRect,
        confidence: Double(tracked.confidence)
      )
    ))
  }

  func step(pixelBuffer: CVPixelBuffer) -> Result<LocalObjectTrackingSample, LocalObjectTrackingFailure> {
    guard !isTerminal else { return .failure(.sessionEnded) }

    do {
      try sequenceHandler.perform([request], on: pixelBuffer, orientation: .up)
    } catch {
      return fail(.trackingError)
    }

    guard let tracked = request.results?.first as? VNDetectedObjectObservation else {
      return fail(.resultUnavailable)
    }
    guard LocalObjectTrackingGeometry.isAcceptableConfidence(Double(tracked.confidence)) else {
      return fail(.lowConfidence)
    }
    guard let currentRect = LocalObjectTrackingGeometry.topLeftRect(from: tracked.boundingBox) else {
      return fail(.outOfBounds)
    }
    guard LocalObjectTrackingGeometry.isPlausibleTransition(from: acceptedSample.rect, to: currentRect) else {
      return fail(.implausibleJump)
    }

    let sample = LocalObjectTrackingSample(rect: currentRect, confidence: Double(tracked.confidence))
    request.inputObservation = tracked
    acceptedSample = sample
    return .success(sample)
  }

  private func fail(_ failure: LocalObjectTrackingFailure) -> Result<LocalObjectTrackingSample, LocalObjectTrackingFailure> {
    isTerminal = true
    return .failure(failure)
  }
}

struct LocalObjectNormalizedRect: Equatable {
  let left: Double
  let top: Double
  let right: Double
  let bottom: Double

  init?(dictionary: [String: Double]) {
    guard let left = dictionary["left"], let top = dictionary["top"],
          let right = dictionary["right"], let bottom = dictionary["bottom"]
    else { return nil }
    self.init(left: left, top: top, right: right, bottom: bottom)
  }

  init?(left: Double, top: Double, right: Double, bottom: Double) {
    guard LocalObjectTrackingGeometry.isValidBounds(left: left, top: top, right: right, bottom: bottom) else { return nil }
    self.left = left
    self.top = top
    self.right = right
    self.bottom = bottom
  }

  var width: Double { right - left }
  var height: Double { bottom - top }
  var centerX: Double { (left + right) / 2 }
  var centerY: Double { (top + bottom) / 2 }
  var dictionary: [String: Double] { ["left": left, "top": top, "right": right, "bottom": bottom] }
}

/// Conservative coordinate and continuity guards. These limits are engineering
/// bounds, not calibrated evidence that a tracked rectangle is the same object.
enum LocalObjectTrackingGeometry {
  static let minimumConfidence = 0.25
  private static let minimumSide = 0.008
  private static let maximumCenterStep = 0.18

  static func isValidBounds(left: Double, top: Double, right: Double, bottom: Double) -> Bool {
    [left, top, right, bottom].allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 } &&
      right - left >= minimumSide && bottom - top >= minimumSide
  }

  static func visionRect(from rect: LocalObjectNormalizedRect) -> CGRect? {
    guard isValidBounds(left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom) else { return nil }
    return CGRect(x: rect.left, y: 1 - rect.bottom, width: rect.width, height: rect.height)
  }

  static func topLeftRect(from visionRect: CGRect) -> LocalObjectNormalizedRect? {
    LocalObjectNormalizedRect(
      left: Double(visionRect.minX),
      top: Double(1 - visionRect.maxY),
      right: Double(visionRect.maxX),
      bottom: Double(1 - visionRect.minY)
    )
  }

  static func isAcceptableConfidence(_ confidence: Double) -> Bool {
    confidence.isFinite && confidence >= minimumConfidence && confidence <= 1
  }

  static func isPlausibleTransition(from previous: LocalObjectNormalizedRect, to current: LocalObjectNormalizedRect) -> Bool {
    guard isValidBounds(left: previous.left, top: previous.top, right: previous.right, bottom: previous.bottom),
          isValidBounds(left: current.left, top: current.top, right: current.right, bottom: current.bottom)
    else { return false }
    let centerStep = hypot(current.centerX - previous.centerX, current.centerY - previous.centerY)
    let widthScale = current.width / previous.width
    let heightScale = current.height / previous.height
    return centerStep <= maximumCenterStep &&
      widthScale >= 0.5 && widthScale <= 2 &&
      heightScale >= 0.5 && heightScale <= 2
  }
}
