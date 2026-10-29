import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(root, "modules/local-face-attention/ios/LocalFaceAttentionModule.swift");
const trackingPath = path.join(root, "modules/local-face-attention/ios/LocalObjectTrackingSession.swift");
const bridgePath = path.join(root, "modules/local-face-attention/index.ts");
const nativeModule = readFileSync(modulePath, "utf8");
const trackingSource = readFileSync(trackingPath, "utf8");
const bridge = readFileSync(bridgePath, "utf8");
const startResultBlock = nativeModule.match(/\/\/ BEGIN LOCAL OBJECT TRACKING START RESULT\n([\s\S]*?)\n\/\/ END LOCAL OBJECT TRACKING START RESULT/)?.[1];
assert.ok(startResultBlock, "the native seed result contract must be inline and marked");

assert.match(nativeModule, /Events\([^\n]*"onObjectPreview", "onObjectTrack"/);
assert.match(nativeModule, /AsyncFunction\("startObjectSelection"\)/);
assert.match(nativeModule, /AsyncFunction\("startObjectTracking"\)/);
assert.match(nativeModule, /AsyncFunction\("stopObjectTracking"\)/);
assert.match(nativeModule, /"objectTrackingSupported": objectTrackingSupported\(\)/);
const selectionBody = nativeModule.match(/AsyncFunction\("startObjectSelection"\)([\s\S]*?)AsyncFunction\("startObjectTracking"\)/)?.[1];
assert.ok(selectionBody, "selection should have a bounded native body");
assert.match(selectionBody, /attentionRequested, self\.session\.isRunning, self\.pending == nil, self\.facing == "front"/);
assert.match(selectionBody, /systemUptime \+ 15/);
assert.doesNotMatch(selectionBody, /configure\(|startRunning\(/, "selection must use the existing camera lease");
assert.match(nativeModule, /timestampSeconds - lastObjectPreviewAt >= 0\.25/);
assert.match(nativeModule, /CVPixelBufferGetWidth\(previewBuffer\).*512/s);
assert.match(nativeModule, /if recentObjectFrames\.count > 4/);
assert.match(nativeModule, /now - frame\.timestampSeconds > 1/);
assert.match(nativeModule, /now - frame\.timestampSeconds <= 0\.5/);
assert.match(nativeModule, /frame\.orientation == self\.objectStreamOrientation/);
assert.match(nativeModule, /LocalObjectTrackingSession\.start\(pixelBuffer: frame\.pixelBuffer, selectedRect: rect\)/);
assert.match(nativeModule, /trackingSession\.step\(pixelBuffer: trackingBuffer\)/);
assert.match(nativeModule, /case \.failure\(let failure\):\s*loseObjectTracking\(reason: failure\.lossReason/s);
assert.doesNotMatch(nativeModule, /VNTrackObjectRequest|VNSequenceRequestHandler|lastTrackedObjectRect/,
  "the camera adapter must not keep a duplicate Vision request or last-rectangle policy");
assert.doesNotMatch(nativeModule, /LocalObjectTrackingGeometry/,
  "geometry and transition policy must stay inside the shared Vision session");
assert.match(nativeModule, /ProcessInfo\.processInfo\.systemUptime \+ 10/);
assert.match(nativeModule, /frameGap > 0, frameGap <= 0\.5/);
assert.match(nativeModule, /reason: "orientation_changed"/);
assert.match(nativeModule, /invalidateObjectFlow\(reason: "still_capture"\)/);
assert.match(nativeModule, /reason: "camera_stopped"/);
assert.match(trackingSource, /VNTrackObjectRequest\(detectedObjectObservation: observation\)/);
assert.match(trackingSource, /request\.trackingLevel = \.accurate/);
assert.match(trackingSource, /VNSequenceRequestHandler\(\)/);
assert.match(trackingSource, /sequenceHandler\.perform\(\[request\], on: pixelBuffer, orientation: \.up\)/);
assert.match(trackingSource, /request\.inputObservation = tracked/);
assert.match(trackingSource, /not calibrated evidence that a tracked rectangle is the same object/);
assert.match(trackingSource, /case \.sessionEnded/);
assert.match(trackingSource, /isTerminal = true/);
assert.match(trackingSource, /return centerStep <= maximumCenterStep/);
assert.doesNotMatch(trackingSource, /usesCPUOnly/,
  "the shared session must retain Vision's default compute configuration");
const trackingBody = nativeModule.match(/AsyncFunction\("startObjectTracking"\)([\s\S]*?)AsyncFunction\("stopObjectTracking"\)/)?.[1];
assert.ok(trackingBody, "native object seed should have an independently classifiable result");
assert.match(trackingBody, /selectionUnavailable\)\.bridgeValue/);
assert.match(trackingBody, /selectionStale\)\.bridgeValue/);
assert.match(trackingBody, /selectionInvalid\)\.bridgeValue/);
assert.equal((trackingBody.match(/trackingFailed\)\.bridgeValue/g) ?? []).length, 1,
  "the typed seed failure maps to the existing tracking-failed bridge reason");
assert.match(trackingBody, /LocalObjectTrackingStartResult\.accepted\.bridgeValue/);
const stopBody = nativeModule.match(/AsyncFunction\("stopObjectTracking"\)([\s\S]*?)AsyncFunction\("captureStill"\)/)?.[1];
assert.ok(stopBody);
assert.match(stopBody, /invalidateObjectFlow\(reason: "stopped"\)/);
assert.doesNotMatch(stopBody, /session\.stopRunning\(/, "ending an object lease must leave the shared camera running");

assert.match(bridge, /export type LocalObjectPreviewEvent/);
assert.match(bridge, /export type LocalObjectTrackEvent/);
assert.match(bridge, /export type LocalObjectTrackingStartResult/);
assert.match(bridge, /LocalObjectTrackingStartResult \| boolean/);
assert.match(bridge, /objectTrackingSupported: status\.objectTrackingSupported \?\? false/);
assert.match(bridge, /startLocalObjectSelection/);
assert.match(bridge, /startLocalObjectTracking/);
assert.match(bridge, /stopLocalObjectTracking/);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "looi-local-object-tracking-"));
try {
  const runnerPath = path.join(tempDir, "main.swift");
  const executablePath = path.join(tempDir, "geometry-test");
  const fixtures = `
let result = LocalObjectTrackingStartResult.accepted.bridgeValue
guard result["accepted"] as? Bool == true, result["reason"] == nil
else { fatalError("Accepted seed response must be discriminated") }

let expectedFailures: [(LocalObjectTrackingStartFailure, String)] = [
  (.selectionStale, "selection-stale"),
  (.selectionUnavailable, "selection-unavailable"),
  (.selectionInvalid, "selection-invalid"),
  (.trackingFailed, "tracking-failed"),
]
for (failure, reason) in expectedFailures {
  let rejected = LocalObjectTrackingStartResult.rejected(failure).bridgeValue
  guard rejected["accepted"] as? Bool == false, rejected["reason"] as? String == reason
  else { fatalError("Rejected seed response lost its distinct reason: \\(reason)") }
}

let expectedTrackingReasons: [(LocalObjectTrackingFailure, String)] = [
  (.trackingError, "tracking_error"),
  (.resultUnavailable, "result_unavailable"),
  (.lowConfidence, "low_confidence"),
  (.outOfBounds, "out_of_bounds"),
  (.implausibleJump, "implausible_jump"),
  (.sessionEnded, "session_ended"),
]
for (failure, reason) in expectedTrackingReasons {
  guard failure.lossReason == reason else { fatalError("Tracking failure reason changed: \\(reason)") }
}

func close(_ first: Double, _ second: Double) -> Bool { abs(first - second) < 0.00001 }

guard let selected = LocalObjectNormalizedRect(left: 0.1, top: 0.2, right: 0.4, bottom: 0.6),
      let vision = LocalObjectTrackingGeometry.visionRect(from: selected),
      close(Double(vision.minX), 0.1), close(Double(vision.minY), 0.4),
      close(Double(vision.width), 0.3), close(Double(vision.height), 0.4),
      let roundTrip = LocalObjectTrackingGeometry.topLeftRect(from: vision),
      close(roundTrip.left, selected.left), close(roundTrip.top, selected.top),
      close(roundTrip.right, selected.right), close(roundTrip.bottom, selected.bottom)
else { fatalError("Top-left UI rectangles must convert to Vision coordinates and back") }

guard LocalObjectNormalizedRect(left: -0.01, top: 0.1, right: 0.3, bottom: 0.4) == nil,
      LocalObjectNormalizedRect(left: 0.4, top: 0.1, right: 0.3, bottom: 0.4) == nil,
      LocalObjectNormalizedRect(left: 0.1, top: .nan, right: 0.3, bottom: 0.4) == nil,
      LocalObjectNormalizedRect(left: 0.1, top: 0.1, right: 0.105, bottom: 0.4) == nil
else { fatalError("Malformed, non-finite, or too-small selections must be rejected") }

guard let base = LocalObjectNormalizedRect(left: 0.30, top: 0.30, right: 0.50, bottom: 0.55),
      let moved = LocalObjectNormalizedRect(left: 0.34, top: 0.31, right: 0.64, bottom: 0.685),
      LocalObjectTrackingGeometry.isPlausibleTransition(from: base, to: moved),
      !LocalObjectTrackingGeometry.isPlausibleTransition(
        from: base,
        to: LocalObjectNormalizedRect(left: 0.60, top: 0.30, right: 0.80, bottom: 0.55)!
      ),
      LocalObjectTrackingGeometry.isAcceptableConfidence(0.25),
      !LocalObjectTrackingGeometry.isAcceptableConfidence(0.249),
      !LocalObjectTrackingGeometry.isAcceptableConfidence(.nan)
else { fatalError("Continuity and confidence guards must accept only plausible bounded tracks") }

print("Local object geometry fixtures passed")
`;
  writeFileSync(runnerPath, `import Foundation\nimport CoreGraphics\n\n${startResultBlock}\n\n${fixtures}`);
  execFileSync("swiftc", [
    "-module-cache-path", path.join(tempDir, "module-cache"), trackingPath, runnerPath,
    "-framework", "Vision", "-framework", "CoreVideo", "-framework", "CoreGraphics",
    "-o", executablePath,
  ], {
    stdio: "pipe",
  });
  const output = execFileSync(executablePath, { encoding: "utf8" });
  assert.match(output, /geometry fixtures passed/);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Local object-tracking bridge and native geometry checks passed");
