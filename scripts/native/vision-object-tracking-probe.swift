import CoreVideo
import Foundation
import Vision

private struct PixelBox {
  var x: Int
  var y: Int
  var width: Int
  var height: Int

  var right: Int { x + width }
  var bottom: Int { y + height }
}

private struct FrameFixture {
  let target: PixelBox?
  let occlusion: PixelBox?
  let distractor: PixelBox?
  let fullyOccluded: Bool
}

private struct ScenarioFixture {
  let id: String
  let frames: [FrameFixture]
}

private let frameWidth = 320
private let frameHeight = 240
private let fixtureSourceVersion = "procedural-object-fixtures-v1"

private func clipped(_ box: PixelBox) -> PixelBox? {
  let left = max(0, min(frameWidth, box.x))
  let top = max(0, min(frameHeight, box.y))
  let right = max(left, min(frameWidth, box.right))
  let bottom = max(top, min(frameHeight, box.bottom))
  guard right > left, bottom > top else { return nil }
  return PixelBox(x: left, y: top, width: right - left, height: bottom - top)
}

private func normalized(_ box: PixelBox) -> LocalObjectNormalizedRect {
  LocalObjectNormalizedRect(
    left: Double(box.x) / Double(frameWidth),
    top: Double(box.y) / Double(frameHeight),
    right: Double(box.right) / Double(frameWidth),
    bottom: Double(box.bottom) / Double(frameHeight)
  )!
}

private func paint(_ box: PixelBox, into bytes: UnsafeMutablePointer<UInt8>, stride: Int, seed: UInt8) {
  guard let visible = clipped(box) else { return }
  for y in visible.y..<visible.bottom {
    for x in visible.x..<visible.right {
      let lx = x - box.x
      let ly = y - box.y
      let checker = ((lx / 7) + (ly / 7)) & 1
      let hash = (lx &* 1_103_515_245 &+ ly &* 12_345 &+ (lx ^ (ly &* 31))) & 0x7fff_ffff
      let texture = UInt8((hash % 100) + Int(seed))
      let offset = y * stride + x * 4
      bytes[offset] = checker == 0 ? UInt8(38) : UInt8(220) // B
      bytes[offset + 1] = UInt8((Int(texture) + (checker == 0 ? 0 : 60)) % 256) // G
      bytes[offset + 2] = checker == 0 ? UInt8(235) : UInt8(32) // R
      bytes[offset + 3] = 255
    }
  }
}

private func paintOcclusion(_ box: PixelBox, into bytes: UnsafeMutablePointer<UInt8>, stride: Int) {
  guard let visible = clipped(box) else { return }
  for y in visible.y..<visible.bottom {
    for x in visible.x..<visible.right {
      let offset = y * stride + x * 4
      bytes[offset] = 80
      bytes[offset + 1] = 80
      bytes[offset + 2] = 80
      bytes[offset + 3] = 255
    }
  }
}

private func makePixelBuffer(_ fixture: FrameFixture) -> CVPixelBuffer {
  var maybeBuffer: CVPixelBuffer?
  let status = CVPixelBufferCreate(
    kCFAllocatorDefault, frameWidth, frameHeight, kCVPixelFormatType_32BGRA, nil, &maybeBuffer
  )
  precondition(status == kCVReturnSuccess, "CVPixelBufferCreate failed: \(status)")
  let buffer = maybeBuffer!
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  let bytes = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
  let stride = CVPixelBufferGetBytesPerRow(buffer)
  for y in 0..<frameHeight {
    for x in 0..<frameWidth {
      let offset = y * stride + x * 4
      bytes[offset] = 42
      bytes[offset + 1] = 48
      bytes[offset + 2] = 52
      bytes[offset + 3] = 255
    }
  }
  if let target = fixture.target { paint(target, into: bytes, stride: stride, seed: 70) }
  if let distractor = fixture.distractor { paint(distractor, into: bytes, stride: stride, seed: 77) }
  if let occlusion = fixture.occlusion { paintOcclusion(occlusion, into: bytes, stride: stride) }
  return buffer
}

private func rectJSON(_ rect: LocalObjectNormalizedRect?) -> Any {
  guard let rect else { return NSNull() }
  return ["left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom,
          "width": rect.width, "height": rect.height,
          "centerX": rect.centerX, "centerY": rect.centerY]
}

private func overlap(_ a: LocalObjectNormalizedRect, _ b: LocalObjectNormalizedRect) -> Double {
  let left = max(a.left, b.left)
  let top = max(a.top, b.top)
  let right = min(a.right, b.right)
  let bottom = min(a.bottom, b.bottom)
  let intersection = max(0, right - left) * max(0, bottom - top)
  let union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

private func pixelCenterError(_ a: LocalObjectNormalizedRect, _ b: LocalObjectNormalizedRect) -> Double {
  hypot((a.centerX - b.centerX) * Double(frameWidth), (a.centerY - b.centerY) * Double(frameHeight))
}

private func expectedRect(_ box: PixelBox?) -> LocalObjectNormalizedRect? {
  guard let visible = box.flatMap(clipped) else { return nil }
  return normalized(visible)
}

private func scenarios() -> [ScenarioFixture] {
  let start = PixelBox(x: 96, y: 72, width: 92, height: 92)
  return [
    ScenarioFixture(id: "translation", frames: (1...5).map { i in
      FrameFixture(target: PixelBox(x: start.x + i * 8, y: start.y + i * 3, width: start.width, height: start.height), occlusion: nil, distractor: nil, fullyOccluded: false)
    }),
    ScenarioFixture(id: "scale", frames: (1...5).map { i in
      let side = start.width + i * 8
      return FrameFixture(target: PixelBox(x: start.x - i * 4, y: start.y - i * 4, width: side, height: side), occlusion: nil, distractor: nil, fullyOccluded: false)
    }),
    ScenarioFixture(id: "partial-occlusion", frames: (1...5).map { i in
      let target = PixelBox(x: start.x + i * 5, y: start.y + i * 2, width: start.width, height: start.height)
      let occluder = PixelBox(x: target.x + 50, y: target.y + 4, width: 28, height: 70)
      return FrameFixture(target: target, occlusion: occluder, distractor: nil, fullyOccluded: false)
    }),
    ScenarioFixture(id: "full-occlusion", frames: (1...4).map { i in
      let target = PixelBox(x: start.x + i * 3, y: start.y, width: start.width, height: start.height)
      let cover = PixelBox(x: target.x, y: target.y, width: target.width, height: target.height)
      return FrameFixture(target: target, occlusion: cover, distractor: nil, fullyOccluded: true)
    }),
    ScenarioFixture(id: "similar-distractor", frames: (1...6).map { i in
      let target = PixelBox(x: start.x + i * 6, y: start.y + i * 2, width: start.width, height: start.height)
      let distractor = PixelBox(x: start.x - i * 4, y: start.y + 3, width: start.width, height: start.height)
      return FrameFixture(target: target, occlusion: nil, distractor: distractor, fullyOccluded: false)
    }),
    ScenarioFixture(id: "exits-image", frames: (1...7).map { i in
      FrameFixture(target: PixelBox(x: start.x + i * 32, y: start.y, width: start.width, height: start.height), occlusion: nil, distractor: nil, fullyOccluded: false)
    }),
  ]
}

private func failureName(_ failure: LocalObjectTrackingFailure) -> String { failure.lossReason }

private func runScenario(_ fixture: ScenarioFixture) -> [String: Any] {
  let seed = PixelBox(x: 96, y: 72, width: 92, height: 92)
  let seedFrame = makePixelBuffer(FrameFixture(target: seed, occlusion: nil, distractor: nil, fullyOccluded: false))
  let startedAt = DispatchTime.now().uptimeNanoseconds
  let startResult = LocalObjectTrackingSession.start(pixelBuffer: seedFrame, selectedRect: normalized(seed))
  let startElapsedMs = Double(DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000

  var frames: [[String: Any]] = []
  switch startResult {
  case .failure(let failure):
    return ["id": fixture.id, "seedRect": rectJSON(normalized(seed)), "start": ["status": "lost", "lossReason": failureName(failure), "elapsedMs": startElapsedMs], "frames": frames, "postLoss": NSNull()]
  case .success(let session):
    let accepted = session.acceptedSample
    frames.append([
      "index": 0, "phase": "seed", "expectedRect": rectJSON(normalized(seed)),
      "accepted": true, "observedRect": rectJSON(accepted.rect), "confidence": accepted.confidence,
      "iou": overlap(accepted.rect, normalized(seed)), "centerErrorPx": pixelCenterError(accepted.rect, normalized(seed)),
      "fullyOccluded": false, "acceptedWhileFullyOccluded": false,
      "distractorIoU": NSNull(), "associatedMoreWithDistractor": false, "elapsedMs": startElapsedMs,
    ])

    var terminal = false
    var postLoss: Any = NSNull()
    for (offset, frameFixture) in fixture.frames.enumerated() {
      let pixelBuffer = makePixelBuffer(frameFixture)
      let started = DispatchTime.now().uptimeNanoseconds
      let result = session.step(pixelBuffer: pixelBuffer)
      let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
      let truth = expectedRect(frameFixture.target)
      let distractor = expectedRect(frameFixture.distractor)
      switch result {
      case .success(let sample):
        let iou = truth.map { overlap(sample.rect, $0) }
        let distractorIou = distractor.map { overlap(sample.rect, $0) }
        let associatedMore = (distractorIou ?? 0) > (iou ?? 0)
        frames.append([
          "index": offset + 1, "phase": "tracked", "expectedRect": rectJSON(truth),
          "accepted": true, "observedRect": rectJSON(sample.rect), "confidence": sample.confidence,
          "iou": iou ?? NSNull(), "centerErrorPx": truth.map { pixelCenterError(sample.rect, $0) } ?? NSNull(),
          "fullyOccluded": frameFixture.fullyOccluded,
          "acceptedWhileFullyOccluded": frameFixture.fullyOccluded,
          "distractorRect": rectJSON(distractor), "distractorIoU": distractorIou ?? NSNull(),
          "associatedMoreWithDistractor": associatedMore, "elapsedMs": elapsed,
        ])
      case .failure(let failure):
        terminal = true
        frames.append([
          "index": offset + 1, "phase": "lost", "expectedRect": rectJSON(truth),
          "accepted": false, "observedRect": NSNull(), "confidence": NSNull(), "iou": NSNull(), "centerErrorPx": NSNull(),
          "fullyOccluded": frameFixture.fullyOccluded, "acceptedWhileFullyOccluded": false,
          "distractorRect": rectJSON(distractor), "distractorIoU": NSNull(),
          "associatedMoreWithDistractor": false, "lossReason": failureName(failure), "elapsedMs": elapsed,
        ])
        let repeatStarted = DispatchTime.now().uptimeNanoseconds
        let repeated = session.step(pixelBuffer: pixelBuffer)
        let repeatElapsed = Double(DispatchTime.now().uptimeNanoseconds - repeatStarted) / 1_000_000
        if case .failure(let repeatedFailure) = repeated {
          postLoss = ["status": "lost", "lossReason": failureName(repeatedFailure), "elapsedMs": repeatElapsed]
        } else {
          postLoss = ["status": "accepted-after-loss", "elapsedMs": repeatElapsed]
        }
        break
      }
    }
    return ["id": fixture.id, "seedRect": rectJSON(normalized(seed)), "start": ["status": "accepted", "elapsedMs": startElapsedMs], "frames": frames,
            "endedAfterLoss": terminal, "postLoss": postLoss]
  }
}

let revision = VNTrackObjectRequest.currentRevision
let supportedRevisions = VNTrackObjectRequest.supportedRevisions.sorted()
let report: [String: Any] = [
  "metadata": [
    "measurementOnly": true,
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "visionTrackingRevision": revision,
    "supportedVisionTrackingRevisions": supportedRevisions,
    "frameWidth": frameWidth,
    "frameHeight": frameHeight,
    "pixelFormat": "32BGRA",
    "orientation": "up",
    "trackingLevel": "accurate",
    "computeDevice": "framework-default",
    "fixtureSourceVersion": fixtureSourceVersion,
    "tracker": "LocalObjectTrackingSession.start/step",
    "passClaim": "none; successful process means measurements were collected",
  ],
  "scenarios": scenarios().map(runScenario),
]
let output = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(output)
