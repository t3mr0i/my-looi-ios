import Foundation
import AVFoundation
import CoreImage
import Vision
import UIKit
import ImageIO
import ExpoModulesCore
import LooiAppleRuntime

private struct LocalObjectPreviewFrame {
  let requestId: String
  let frameId: String
  let timestampSeconds: TimeInterval
  let orientation: AVCaptureVideoOrientation
  let pixelBuffer: CVPixelBuffer
}

// BEGIN LOCAL OBJECT TRACKING START RESULT
enum LocalObjectTrackingStartFailure: String {
  case selectionStale = "selection-stale"
  case selectionUnavailable = "selection-unavailable"
  case selectionInvalid = "selection-invalid"
  case trackingFailed = "tracking-failed"
}

enum LocalObjectTrackingStartResult {
  case accepted
  case rejected(LocalObjectTrackingStartFailure)

  var bridgeValue: [String: Any] {
    switch self {
    case .accepted:
      return ["accepted": true]
    case .rejected(let reason):
      return ["accepted": false, "reason": reason.rawValue]
    }
  }
}
// END LOCAL OBJECT TRACKING START RESULT

public final class LocalFaceAttentionModule: Module {
  private let worker = DispatchQueue(label: "mylooi.camera", qos: .userInitiated)
  private let session = AVCaptureSession()
  private let video = AVCaptureVideoDataOutput()
  private let photo = AVCapturePhotoOutput()
  private var camera: AVCaptureDevice?
  private var frames = 0
  private var lastAnalysis = 0.0
  private var lastOrientation: AVCaptureVideoOrientation = .landscapeRight
  private var pending: (promise: Promise, id: Int64, restoreRunning: Bool, restoreFacing: String)?
  private var facing = "front"
  private var attentionRequested = false
  private var interactionSignalsEnabled = false
  private let objectImageContext = CIContext(options: [.useSoftwareRenderer: false])
  private var objectSelectionRequestId: String?
  private var objectSelectionDeadline: TimeInterval?
  private var objectStreamOrientation: AVCaptureVideoOrientation?
  private var objectDeviceOrientation: UIDeviceOrientation?
  private var lastObjectPreviewAt: TimeInterval = 0
  private var recentObjectFrames: [LocalObjectPreviewFrame] = []
  private var objectTrackRequestId: String?
  private var objectTrackingSession: LocalObjectTrackingSession?
  private var objectTrackDeadline: TimeInterval?
  private var lastObjectFrameAt: TimeInterval?
  private var objectTrackingBufferSize: (width: Int, height: Int)?
  private var objectFlowGeneration = 0

  private lazy var nativeDelegate = LocalFaceAttentionModuleDelegate(self)

  public func definition() -> ModuleDefinition {
    Name("LocalFaceAttention")
    Events("onFaceFrame", "onFaceAttentionError", "onObjectPreview", "onObjectTrack")
    AsyncFunction("start") { () -> [String: Any] in
      try self.worker.sync {
        self.attentionRequested = true
        if self.pending != nil { return self.status() }
        do {
          try self.configure("front")
          if !self.session.isRunning { self.session.startRunning() }
          return self.status()
        } catch { self.attentionRequested = false; throw error }
      }
    }
    AsyncFunction("stop") { () -> [String: Any] in
      self.worker.sync { self.stop(); return self.status() }
    }
    AsyncFunction("getStatus") { self.worker.sync { self.status() } }
    AsyncFunction("setInteractionSignalsEnabled") { (enabled: Bool) -> Bool in
      self.worker.sync {
        guard self.signalAnalysisSupported() else {
          self.interactionSignalsEnabled = false
          return false
        }
        self.interactionSignalsEnabled = enabled
        return true
      }
    }
    AsyncFunction("startObjectSelection") { (requestId: String) -> Bool in
      self.worker.sync {
        guard !requestId.isEmpty, requestId.count <= 128,
              self.attentionRequested, self.session.isRunning, self.pending == nil, self.facing == "front",
              self.objectTrackingSupported()
        else { return false }

        self.invalidateObjectFlow(reason: "replaced")
        self.objectSelectionRequestId = requestId
        self.objectSelectionDeadline = ProcessInfo.processInfo.systemUptime + 15
        self.objectStreamOrientation = self.lastOrientation
        self.objectDeviceOrientation = self.currentPhysicalOrientation()
        self.lastObjectPreviewAt = 0
        self.recentObjectFrames.removeAll(keepingCapacity: true)
        let generation = self.objectFlowGeneration
        self.worker.asyncAfter(deadline: .now() + 15) {
          guard self.objectFlowGeneration == generation,
                self.objectSelectionRequestId == requestId,
                let deadline = self.objectSelectionDeadline,
                ProcessInfo.processInfo.systemUptime >= deadline
          else { return }
          self.invalidateObjectFlow(reason: "selection_timeout")
        }
        return true
      }
    }
    AsyncFunction("startObjectTracking") { (requestId: String, frameId: String, rawRect: [String: Double]) -> [String: Any] in
      self.worker.sync {
        self.pruneRecentObjectFrames(at: ProcessInfo.processInfo.systemUptime)
        let now = ProcessInfo.processInfo.systemUptime
        guard !requestId.isEmpty, requestId.count <= 128,
              self.attentionRequested, self.session.isRunning, self.pending == nil, self.facing == "front",
              self.objectSelectionRequestId == requestId,
              self.objectTrackRequestId == nil,
              let deadline = self.objectSelectionDeadline,
              now < deadline
        else { return LocalObjectTrackingStartResult.rejected(.selectionUnavailable).bridgeValue }

        guard let frame = self.recentObjectFrames.first(where: { $0.requestId == requestId && $0.frameId == frameId }),
              frame.orientation == self.objectStreamOrientation,
              now - frame.timestampSeconds >= 0,
              now - frame.timestampSeconds <= 0.5
        else { return LocalObjectTrackingStartResult.rejected(.selectionStale).bridgeValue }

        guard let rect = LocalObjectNormalizedRect(dictionary: rawRect)
        else { return LocalObjectTrackingStartResult.rejected(.selectionInvalid).bridgeValue }

        let trackingSession: LocalObjectTrackingSession
        switch LocalObjectTrackingSession.start(pixelBuffer: frame.pixelBuffer, selectedRect: rect) {
        case .failure:
          return LocalObjectTrackingStartResult.rejected(.trackingFailed).bridgeValue
        case .success(let startedSession):
          trackingSession = startedSession
        }

        self.objectSelectionRequestId = nil
        self.objectSelectionDeadline = nil
        self.objectTrackRequestId = requestId
        self.objectTrackingSession = trackingSession
        self.objectTrackDeadline = ProcessInfo.processInfo.systemUptime + 10
        self.lastObjectFrameAt = frame.timestampSeconds
        self.objectTrackingBufferSize = (CVPixelBufferGetWidth(frame.pixelBuffer), CVPixelBufferGetHeight(frame.pixelBuffer))
        self.objectFlowGeneration += 1
        let generation = self.objectFlowGeneration
        self.recentObjectFrames.removeAll(keepingCapacity: false)
        let acceptedSample = trackingSession.acceptedSample
        self.sendObjectTrack(status: "tracking", requestId: requestId, rect: acceptedSample.rect,
          confidence: acceptedSample.confidence, reason: nil, at: ProcessInfo.processInfo.systemUptime)
        self.worker.asyncAfter(deadline: .now() + 10) {
          guard self.objectFlowGeneration == generation,
                self.objectTrackRequestId == requestId,
                let deadline = self.objectTrackDeadline,
                ProcessInfo.processInfo.systemUptime >= deadline
          else { return }
          self.invalidateObjectFlow(reason: "tracking_timeout")
        }
        return LocalObjectTrackingStartResult.accepted.bridgeValue
      }
    }
    AsyncFunction("stopObjectTracking") { (requestId: String) in
      self.worker.sync {
        guard self.objectSelectionRequestId == requestId || self.objectTrackRequestId == requestId else { return }
        self.invalidateObjectFlow(reason: "stopped")
      }
    }
    AsyncFunction("captureStill") { (facing: String, promise: Promise) in
      self.worker.async {
        guard self.pending == nil else { promise.reject("ERR_CAMERA_BUSY", "A photo is already being captured"); return }
        self.invalidateObjectFlow(reason: "still_capture")
        let restoreRunning = self.session.isRunning
        let restoreFacing = self.facing
        do {
          guard facing == "front" || facing == "back" else { throw looiError("Unknown camera facing") }
          try self.configure(facing)
          if !self.session.isRunning { self.session.startRunning() }
          guard self.session.isRunning else { throw looiError("The requested camera could not start") }
          let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
          settings.photoQualityPrioritization = .quality
          settings.maxPhotoDimensions = self.photo.maxPhotoDimensions
          settings.flashMode = .off
          self.pending = (promise, settings.uniqueID, restoreRunning, restoreFacing)
          let id = settings.uniqueID
          // Allow autoexposure/autofocus to settle after switching cameras.
          self.worker.asyncAfter(deadline: .now() + 0.65) {
            guard self.pending?.id == id, self.session.isRunning else { return }
            if let connection = self.photo.connection(with: .video) { self.configureConnection(connection) }
            self.photo.capturePhoto(with: settings, delegate: self.nativeDelegate)
          }
          self.worker.asyncAfter(deadline: .now() + 8) {
            guard self.pending?.id == id else { return }
            self.complete(nil, error: looiError("Camera capture timed out"))
          }
        } catch {
          if !restoreRunning { self.session.stopRunning() }
          else { try? self.configure(restoreFacing) }
          promise.reject(error)
        }
      }
    }
    OnAppEntersBackground { self.worker.async { self.stop() } }
    OnDestroy { self.worker.sync { self.stop() } }
  }

  private func orientation() -> AVCaptureVideoOrientation {
    switch UIDevice.current.orientation {
    case .landscapeRight: lastOrientation = .landscapeLeft
    case .landscapeLeft: lastOrientation = .landscapeRight
    default: break
    }
    return lastOrientation
  }
  private func configureConnection(_ connection: AVCaptureConnection) {
    let requested = orientation()
    if connection.isVideoOrientationSupported && connection.videoOrientation != requested {
      connection.videoOrientation = requested
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = false
    }
  }
  private func configure(_ requested: String) throws {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { throw looiError("Camera permission is required") }
    if camera != nil && facing == requested { return }
    if camera != nil && facing != requested { invalidateObjectFlow(reason: "camera_changed") }
    let position: AVCaptureDevice.Position = requested == "back" ? .back : .front
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    else { throw looiError("The requested camera is not available") }
    let input = try AVCaptureDeviceInput(device: device)
    let oldInputs = session.inputs
    let oldPreset = session.sessionPreset
    let hadVideo = session.outputs.contains(video)
    let hadPhoto = session.outputs.contains(photo)
    let oldDimensions = photo.maxPhotoDimensions
    var committed = false
    session.beginConfiguration()
    defer {
      if !committed {
        for current in session.inputs { session.removeInput(current) }
        for old in oldInputs where session.canAddInput(old) { session.addInput(old) }
        if !hadVideo && session.outputs.contains(video) { session.removeOutput(video) }
        if !hadPhoto && session.outputs.contains(photo) { session.removeOutput(photo) }
        if session.canSetSessionPreset(oldPreset) { session.sessionPreset = oldPreset }
        if hadPhoto && oldDimensions.width > 0 { photo.maxPhotoDimensions = oldDimensions }
      }
      session.commitConfiguration()
    }
    if session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }
    for old in oldInputs { session.removeInput(old) }
    guard session.canAddInput(input) else {
      throw looiError("The camera input cannot be configured")
    }
    session.addInput(input)
    if !session.outputs.contains(video) {
      video.alwaysDiscardsLateVideoFrames = true
      video.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
      video.setSampleBufferDelegate(nativeDelegate, queue: worker)
      guard session.canAddOutput(video) else { throw looiError("Camera analysis output is unavailable") }
      session.addOutput(video)
    }
    if !session.outputs.contains(photo) {
      guard session.canAddOutput(photo) else { throw looiError("Camera photo output is unavailable") }
      session.addOutput(photo); photo.maxPhotoQualityPrioritization = .quality
    }
    let dimensions = device.activeFormat.supportedMaxPhotoDimensions
    let bounded = dimensions.filter { Int64($0.width) * Int64($0.height) <= 8_500_000 }
    if let maximum = (bounded.isEmpty ? dimensions : bounded).max(by: {
      Int64($0.width) * Int64($0.height) < Int64($1.width) * Int64($1.height)
    }) { photo.maxPhotoDimensions = maximum }
    if device.isFocusModeSupported(.continuousAutoFocus) {
      try device.lockForConfiguration(); device.focusMode = .continuousAutoFocus; device.unlockForConfiguration()
    }
    camera = device; facing = requested
    committed = true
  }
  public func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard session.isRunning, facing == "front", pending == nil else { return }
    let previousOrientation = connection.videoOrientation
    configureConnection(connection)
    if previousOrientation != connection.videoOrientation {
      if objectSelectionRequestId != nil || objectTrackRequestId != nil {
        invalidateObjectFlow(reason: "orientation_changed")
      }
      return
    }
    if let expected = objectStreamOrientation, expected != connection.videoOrientation {
      invalidateObjectFlow(reason: "orientation_changed")
    }
    if let current = currentPhysicalOrientation() {
      if let expected = objectDeviceOrientation, expected != current {
        invalidateObjectFlow(reason: "orientation_changed")
      } else if objectStreamOrientation != nil, objectDeviceOrientation == nil {
        objectDeviceOrientation = current
      }
    }
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastAnalysis >= 0.12 else { return }
    lastAnalysis = now
    do {
      let faceRequest = VNDetectFaceRectanglesRequest()
      var requests: [VNRequest] = [faceRequest]
      var handPoseRequest: VNDetectHumanHandPoseRequest?
      if interactionSignalsEnabled && signalAnalysisSupported() {
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 2
        handPoseRequest = request
        requests.append(request)
      }
      try VNImageRequestHandler(cmSampleBuffer: sample, orientation: .up, options: [:]).perform(requests)
      let faces = faceRequest.results ?? []
      frames += 1
      let boundedFaces = faces.sorted {
        $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height
      }.prefix(5).map { face -> [String: CGFloat] in
        let r = face.boundingBox
        return ["left": r.minX, "top": 1 - r.maxY, "right": r.maxX, "bottom": 1 - r.minY,
          "centerX": r.midX, "centerY": 1 - r.midY, "width": r.width, "height": r.height]
      }
      let primary: Any = boundedFaces.first.map { $0 as Any } ?? NSNull()
      var event: [String: Any] = ["timestampMs": now * 1000, "faceCount": faces.count,
        "primary": primary, "faces": Array(boundedFaces)]
      if let handPoseRequest {
        let hands = handPoseRequest.results ?? []
        event["interactionHandCount"] = hands.count
        event["interactionSignal"] = interactionSignal(from: hands) ?? NSNull()
      }
      sendEvent("onFaceFrame", event)
      processObjectFrame(sample, timestampSeconds: now, orientation: connection.videoOrientation)
    } catch { sendEvent("onFaceAttentionError", ["stage": "analysis", "message": error.localizedDescription]) }
  }

  private func interactionSignal(from hands: [VNHumanHandPoseObservation]) -> [String: Any]? {
    let bestConfidence = hands.compactMap { hand -> Double? in
      var points: [LocalHandLandmark: LocalHandPosePoint] = [:]
      let joints: [(LocalHandLandmark, VNHumanHandPoseObservation.JointName)] = [
        (.wrist, .wrist),
        (.indexMCP, .indexMCP), (.indexPIP, .indexPIP), (.indexTip, .indexTip),
        (.middleMCP, .middleMCP), (.middlePIP, .middlePIP), (.middleTip, .middleTip),
        (.ringMCP, .ringMCP), (.ringPIP, .ringPIP), (.ringTip, .ringTip),
        (.littleMCP, .littleMCP), (.littlePIP, .littlePIP), (.littleTip, .littleTip),
      ]
      for (landmark, joint) in joints {
        guard let recognized = try? hand.recognizedPoint(joint) else { continue }
        points[landmark] = LocalHandPosePoint(
          x: Double(recognized.location.x), y: Double(recognized.location.y),
          confidence: Double(recognized.confidence))
      }
      return LocalOpenPalmClassifier.confidence(for: points)
    }.max()
    guard let bestConfidence else { return nil }
    return ["kind": "open_palm", "confidence": bestConfidence, "handCount": hands.count]
  }

  private func processObjectFrame(
    _ sample: CMSampleBuffer,
    timestampSeconds: TimeInterval,
    orientation: AVCaptureVideoOrientation
  ) {
    if let requestId = objectSelectionRequestId {
      guard let deadline = objectSelectionDeadline,
            ProcessInfo.processInfo.systemUptime < deadline
      else {
        invalidateObjectFlow(reason: "selection_timeout")
        return
      }
      guard timestampSeconds - lastObjectPreviewAt >= 0.25,
            let source = CMSampleBufferGetImageBuffer(sample),
            let previewBuffer = downscaledObjectBuffer(from: source),
            let cgImage = objectImageContext.createCGImage(
              CIImage(cvPixelBuffer: previewBuffer),
              from: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(previewBuffer), height: CVPixelBufferGetHeight(previewBuffer))
            ),
            let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.72)
      else { return }

      let now = timestampSeconds
      let frameId = UUID().uuidString
      recentObjectFrames.append(LocalObjectPreviewFrame(
        requestId: requestId,
        frameId: frameId,
        timestampSeconds: now,
        orientation: orientation,
        pixelBuffer: previewBuffer
      ))
      lastObjectPreviewAt = now
      pruneRecentObjectFrames(at: now)
      sendEvent("onObjectPreview", [
        "requestId": requestId,
        "frameId": frameId,
        "timestampMs": now * 1000,
        "cameraFacing": "front",
        "width": CVPixelBufferGetWidth(previewBuffer),
        "height": CVPixelBufferGetHeight(previewBuffer),
        "dataUrl": "data:image/jpeg;base64,\(jpeg.base64EncodedString())",
      ])
      return
    }

    guard let requestId = objectTrackRequestId,
          let deadline = objectTrackDeadline,
          let previousFrameAt = lastObjectFrameAt
    else { return }
    guard ProcessInfo.processInfo.systemUptime < deadline else {
      invalidateObjectFlow(reason: "tracking_timeout")
      return
    }
    let frameGap = timestampSeconds - previousFrameAt
    guard frameGap > 0, frameGap <= 0.5 else {
      loseObjectTracking(reason: "frame_gap", at: timestampSeconds)
      return
    }
    guard let source = CMSampleBufferGetImageBuffer(sample),
          let trackingBuffer = downscaledObjectBuffer(from: source),
          let trackingSession = objectTrackingSession
    else {
      loseObjectTracking(reason: "frame_unavailable", at: timestampSeconds)
      return
    }
    guard let expectedSize = objectTrackingBufferSize,
          CVPixelBufferGetWidth(trackingBuffer) == expectedSize.width,
          CVPixelBufferGetHeight(trackingBuffer) == expectedSize.height
    else {
      loseObjectTracking(reason: "frame_size_changed", at: timestampSeconds)
      return
    }

    switch trackingSession.step(pixelBuffer: trackingBuffer) {
    case .failure(let failure):
      loseObjectTracking(reason: failure.lossReason, at: timestampSeconds)
    case .success(let acceptedSample):
      lastObjectFrameAt = timestampSeconds
      sendObjectTrack(status: "tracking", requestId: requestId, rect: acceptedSample.rect,
        confidence: acceptedSample.confidence, reason: nil, at: timestampSeconds)
    }
  }

  private func downscaledObjectBuffer(from source: CVPixelBuffer) -> CVPixelBuffer? {
    let sourceWidth = CVPixelBufferGetWidth(source)
    let sourceHeight = CVPixelBufferGetHeight(source)
    guard sourceWidth > 0, sourceHeight > 0 else { return nil }
    let scale = min(1, 512 / Double(max(sourceWidth, sourceHeight)))
    let width = max(1, Int((Double(sourceWidth) * scale).rounded()))
    let height = max(1, Int((Double(sourceHeight) * scale).rounded()))
    var output: CVPixelBuffer?
    let attributes: [String: Any] = [
      kCVPixelBufferCGImageCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
    guard CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &output
    ) == kCVReturnSuccess,
      let output
    else { return nil }

    let sourceImage = CIImage(cvPixelBuffer: source)
    let extent = sourceImage.extent
    let normalized = sourceImage.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
    let scaled = normalized.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    objectImageContext.render(scaled, to: output, bounds: bounds, colorSpace: CGColorSpaceCreateDeviceRGB())
    return output
  }

  private func pruneRecentObjectFrames(at now: TimeInterval) {
    recentObjectFrames.removeAll { frame in
      frame.requestId != objectSelectionRequestId || now - frame.timestampSeconds < 0 || now - frame.timestampSeconds > 1
    }
    if recentObjectFrames.count > 4 {
      recentObjectFrames.removeFirst(recentObjectFrames.count - 4)
    }
  }

  private func sendObjectTrack(
    status: String,
    requestId: String,
    rect: LocalObjectNormalizedRect?,
    confidence: Double?,
    reason: String?,
    at timestampSeconds: TimeInterval
  ) {
    var event: [String: Any] = [
      "requestId": requestId,
      "trackId": requestId,
      "timestampMs": timestampSeconds * 1000,
      "status": status,
      "rect": rect.map { $0.dictionary } as Any? ?? NSNull(),
      "confidence": confidence as Any? ?? NSNull(),
    ]
    if let reason { event["reason"] = reason }
    sendEvent("onObjectTrack", event)
  }

  private func loseObjectTracking(reason: String, at timestampSeconds: TimeInterval) {
    guard let requestId = objectTrackRequestId else { return }
    objectFlowGeneration += 1
    clearObjectFlow()
    sendObjectTrack(status: "lost", requestId: requestId, rect: nil, confidence: nil,
      reason: reason, at: timestampSeconds)
  }

  private func invalidateObjectFlow(reason: String) {
    let requestId = objectTrackRequestId ?? objectSelectionRequestId
    objectFlowGeneration += 1
    clearObjectFlow()
    if let requestId {
      sendObjectTrack(status: "ended", requestId: requestId, rect: nil, confidence: nil,
        reason: reason, at: ProcessInfo.processInfo.systemUptime)
    }
  }

  private func clearObjectFlow() {
    objectSelectionRequestId = nil
    objectSelectionDeadline = nil
    objectStreamOrientation = nil
    objectDeviceOrientation = nil
    lastObjectPreviewAt = 0
    recentObjectFrames.removeAll(keepingCapacity: false)
    objectTrackRequestId = nil
    objectTrackingSession = nil
    objectTrackDeadline = nil
    lastObjectFrameAt = nil
    objectTrackingBufferSize = nil
  }

  private func objectTrackingSupported() -> Bool {
    if #available(iOS 11.0, *) { return true }
    return false
  }
  private func currentPhysicalOrientation() -> UIDeviceOrientation? {
    switch UIDevice.current.orientation {
    case .portrait, .portraitUpsideDown, .landscapeLeft, .landscapeRight: return UIDevice.current.orientation
    default: return nil
    }
  }
  public func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    worker.async {
      guard self.pending?.id == photo.resolvedSettings.uniqueID else { return }
      do {
        if let error { throw error }
        guard let data = photo.fileDataRepresentation() else { throw looiError("Camera returned no photo") }
        let (jpeg, width, height) = try LooiImage.jpeg(data, maxDimension: 3264, quality: 0.95)
        self.complete(["mimeType": "image/jpeg", "base64": jpeg.base64EncodedString(),
          "width": width, "height": height, "timestampMs": Date().timeIntervalSince1970 * 1000,
          "cameraFacing": self.facing, "cameraId": self.camera?.uniqueID ?? "",
          "autofocusMode": Int(self.camera?.focusMode.rawValue ?? 0),
          "flashAvailable": self.camera?.hasFlash ?? false,
          "aeState": NSNull(), "awbState": NSNull(), "afState": NSNull(),
          "exposureTimeMs": self.camera.map { CMTimeGetSeconds($0.exposureDuration) * 1000 } ?? 0,
          "sensitivityIso": self.camera?.iso ?? 0, "lowLightLikely": (self.camera?.iso ?? 0) > 800], error: nil)
      } catch { self.complete(nil, error: error) }
    }
  }
  public func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor settings: AVCaptureResolvedPhotoSettings, error: Error?) {
    guard let error else { return }
    worker.async {
      guard self.pending?.id == settings.uniqueID else { return }
      self.complete(nil, error: error)
    }
  }
  private func complete(_ result: [String: Any]?, error: Error?) {
    guard let item = pending else { return }
    pending = nil
    if attentionRequested {
      do { try configure("front"); if !session.isRunning { session.startRunning() } }
      catch {
        session.stopRunning()
        sendEvent("onFaceAttentionError", ["stage": "restore", "message": error.localizedDescription])
      }
    } else { session.stopRunning() }
    if let error { item.promise.reject(error) }
    else { item.promise.resolve(result ?? [:]) }
  }
  private func stop() {
    attentionRequested = false
    interactionSignalsEnabled = false
    invalidateObjectFlow(reason: "camera_stopped")
    if let item = pending { pending = nil; item.promise.reject("ERR_CANCELLED", "Camera capture was cancelled") }
    if session.isRunning { session.stopRunning() }
  }
  private func signalAnalysisSupported() -> Bool {
    if #available(iOS 14.0, *) { return true }
    return false
  }
  private func status() -> [String: Any] {
    ["supported": true, "running": session.isRunning,
      "permissionGranted": AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
      "cameraId": camera?.uniqueID as Any? ?? NSNull(), "lensFacing": facing, "framesAnalyzed": frames,
      "signalAnalysisSupported": signalAnalysisSupported(), "objectTrackingSupported": objectTrackingSupported()]
  }
}

private final class LocalFaceAttentionModuleDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
  weak var owner: LocalFaceAttentionModule?
  init(_ owner: LocalFaceAttentionModule) { self.owner = owner; super.init() }
  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    owner?.captureOutput(output, didOutput: sample, from: connection)
  }
  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    owner?.photoOutput(output, didFinishProcessingPhoto: photo, error: error)
  }
  func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor settings: AVCaptureResolvedPhotoSettings, error: Error?) {
    owner?.photoOutput(output, didFinishCaptureFor: settings, error: error)
  }

}

// BEGIN LOCAL OPEN PALM CLASSIFIER
enum LocalHandLandmark: Hashable {
  case wrist
  case indexMCP, indexPIP, indexTip
  case middleMCP, middlePIP, middleTip
  case ringMCP, ringPIP, ringTip
  case littleMCP, littlePIP, littleTip
}

struct LocalHandPosePoint {
  let x: Double
  let y: Double
  let confidence: Double
}

/// Classifies only a clearly extended four-finger palm. Vision's raw points stay
/// in memory for this call and are never returned or persisted.
enum LocalOpenPalmClassifier {
  private static let minimumJointConfidence = 0.60
  private static let minimumExtensionDistance = 0.015
  private static let minimumExtensionRatio = 1.08
  private static let minimumStraightFingerAngleDegrees = 145.0

  private static let fingers: [(mcp: LocalHandLandmark, pip: LocalHandLandmark, tip: LocalHandLandmark)] = [
    (.indexMCP, .indexPIP, .indexTip),
    (.middleMCP, .middlePIP, .middleTip),
    (.ringMCP, .ringPIP, .ringTip),
    (.littleMCP, .littlePIP, .littleTip),
  ]

  /// Returns the minimum confidence of the wrist and the four MCP/PIP/tip
  /// triplets when every finger is clearly extended; otherwise returns nil.
  static func confidence(for points: [LocalHandLandmark: LocalHandPosePoint]) -> Double? {
    guard let wrist = points[.wrist], isUsable(wrist) else { return nil }

    var required = [wrist]
    for finger in fingers {
      guard let mcp = points[finger.mcp],
            let pip = points[finger.pip],
            let tip = points[finger.tip],
            isUsable(mcp), isUsable(pip), isUsable(tip),
            isClearlyExtended(wrist: wrist, mcp: mcp, pip: pip, tip: tip)
      else { return nil }
      required.append(contentsOf: [mcp, pip, tip])
    }

    return required.map(\.confidence).min()
  }

  private static func isUsable(_ point: LocalHandPosePoint) -> Bool {
    point.x.isFinite && point.y.isFinite && point.confidence.isFinite &&
      point.confidence >= minimumJointConfidence && point.confidence <= 1
  }

  private static func isClearlyExtended(
    wrist: LocalHandPosePoint,
    mcp: LocalHandPosePoint,
    pip: LocalHandPosePoint,
    tip: LocalHandPosePoint
  ) -> Bool {
    let wristToPIP = distance(wrist, pip)
    let wristToTip = distance(wrist, tip)
    guard wristToPIP > 0,
          wristToTip - wristToPIP >= minimumExtensionDistance,
          wristToTip / wristToPIP >= minimumExtensionRatio
    else { return false }

    let pipToMCP = (x: mcp.x - pip.x, y: mcp.y - pip.y)
    let pipToTip = (x: tip.x - pip.x, y: tip.y - pip.y)
    let firstLength = hypot(pipToMCP.x, pipToMCP.y)
    let secondLength = hypot(pipToTip.x, pipToTip.y)
    guard firstLength > 0, secondLength > 0 else { return false }

    let rawCosine = (pipToMCP.x * pipToTip.x + pipToMCP.y * pipToTip.y) / (firstLength * secondLength)
    let cosine = min(1, max(-1, rawCosine))
    let angleDegrees = acos(cosine) * 180 / .pi
    return angleDegrees >= minimumStraightFingerAngleDegrees
  }

  private static func distance(_ first: LocalHandPosePoint, _ second: LocalHandPosePoint) -> Double {
    hypot(first.x - second.x, first.y - second.y)
  }
}
// END LOCAL OPEN PALM CLASSIFIER
