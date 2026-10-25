import Foundation
import AVFoundation
import Vision
import UIKit
import ImageIO
import ExpoModulesCore
import LooiAppleRuntime

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

  private lazy var nativeDelegate = LocalFaceAttentionModuleDelegate(self)

  public func definition() -> ModuleDefinition {
    Name("LocalFaceAttention")
    Events("onFaceFrame", "onFaceAttentionError")
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
    AsyncFunction("captureStill") { (facing: String, promise: Promise) in
      self.worker.async {
        guard self.pending == nil else { promise.reject("ERR_CAMERA_BUSY", "A photo is already being captured"); return }
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
    if previousOrientation != connection.videoOrientation { return }
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastAnalysis >= 0.12 else { return }
    lastAnalysis = now
    do {
      let request = VNDetectFaceRectanglesRequest()
      try VNImageRequestHandler(cmSampleBuffer: sample, orientation: .up, options: [:]).perform([request])
      let faces = request.results ?? []
      frames += 1
      let boundedFaces = faces.sorted {
        $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height
      }.prefix(5).map { face -> [String: CGFloat] in
        let r = face.boundingBox
        return ["left": r.minX, "top": 1 - r.maxY, "right": r.maxX, "bottom": 1 - r.minY,
          "centerX": r.midX, "centerY": 1 - r.midY, "width": r.width, "height": r.height]
      }
      let primary: Any = boundedFaces.first.map { $0 as Any } ?? NSNull()
      sendEvent("onFaceFrame", ["timestampMs": now * 1000, "faceCount": faces.count,
        "primary": primary, "faces": Array(boundedFaces)])
    } catch { sendEvent("onFaceAttentionError", ["stage": "analysis", "message": error.localizedDescription]) }
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
    if let item = pending { pending = nil; item.promise.reject("ERR_CANCELLED", "Camera capture was cancelled") }
    if session.isRunning { session.stopRunning() }
  }
  private func status() -> [String: Any] {
    ["supported": true, "running": session.isRunning,
      "permissionGranted": AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
      "cameraId": camera?.uniqueID as Any? ?? NSNull(), "lensFacing": facing, "framesAnalyzed": frames]
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
