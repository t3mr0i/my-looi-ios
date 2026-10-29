import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(root, "modules/local-face-attention/ios/LocalFaceAttentionModule.swift");
const bridgePath = path.join(root, "modules/local-face-attention/index.ts");
const nativeModule = readFileSync(modulePath, "utf8");
const bridge = readFileSync(bridgePath, "utf8");
const classifierBlock = nativeModule.match(/\/\/ BEGIN LOCAL OPEN PALM CLASSIFIER\n([\s\S]*?)\n\/\/ END LOCAL OPEN PALM CLASSIFIER/)?.[1];
assert.ok(classifierBlock, "the canonical pure classifier block should be marked in the native module");

assert.match(nativeModule, /AsyncFunction\("setInteractionSignalsEnabled"\)/);
assert.match(nativeModule, /if interactionSignalsEnabled && signalAnalysisSupported\(\)\s*\{\s*let request = VNDetectHumanHandPoseRequest\(\)/);
assert.match(nativeModule, /interactionSignalsEnabled = false/);
assert.match(nativeModule, /event\["interactionHandCount"\] = hands\.count/);
assert.match(nativeModule, /event\["interactionSignal"\] = interactionSignal\(from: hands\) \?\? NSNull\(\)/);
const toggleBody = nativeModule.match(/AsyncFunction\("setInteractionSignalsEnabled"\)([\s\S]*?)AsyncFunction\("captureStill"\)/)?.[1];
assert.ok(toggleBody, "the native toggle should have a bounded implementation body");
assert.doesNotMatch(toggleBody, /configure\(|startRunning\(/, "enabling local signals must not start or reconfigure the camera");
assert.match(nativeModule, /guard session\.isRunning, facing == "front", pending == nil else \{ return \}/);
assert.match(bridge, /setInteractionSignalsEnabled\?: \(enabled: boolean\) => Promise<boolean>/);
assert.match(bridge, /if \(!module \|\| typeof setEnabled !== "function"\) return false/);
assert.match(bridge, /signalAnalysisSupported: status\.signalAnalysisSupported \?\? false/);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "looi-local-hand-signal-"));
try {
  const runnerPath = path.join(tempDir, "main.swift");
  const executablePath = path.join(tempDir, "classifier-test");
  const fixtures = `
func point(_ x: Double, _ y: Double, _ confidence: Double = 0.92) -> LocalHandPosePoint {
  LocalHandPosePoint(x: x, y: y, confidence: confidence)
}

func palm(confidence: Double = 0.92) -> [LocalHandLandmark: LocalHandPosePoint] {
  [
    .wrist: point(0.50, 0.10, confidence),
    .indexMCP: point(0.31, 0.45, confidence), .indexPIP: point(0.29, 0.62, confidence), .indexTip: point(0.28, 0.82, confidence),
    .middleMCP: point(0.43, 0.48, confidence), .middlePIP: point(0.42, 0.67, confidence), .middleTip: point(0.42, 0.88, confidence),
    .ringMCP: point(0.56, 0.47, confidence), .ringPIP: point(0.57, 0.66, confidence), .ringTip: point(0.58, 0.86, confidence),
    .littleMCP: point(0.69, 0.42, confidence), .littlePIP: point(0.71, 0.59, confidence), .littleTip: point(0.73, 0.77, confidence),
  ]
}

guard let confidence = LocalOpenPalmClassifier.confidence(for: palm()), confidence > 0.9, confidence <= 1 else {
  fatalError("A clear open palm should be accepted with a bounded confidence")
}

var closed = palm()
closed[.ringPIP] = point(0.57, 0.56)
closed[.ringTip] = point(0.54, 0.49)
guard LocalOpenPalmClassifier.confidence(for: closed) == nil else {
  fatalError("A curled ring finger must reject the open-palm classification")
}

guard LocalOpenPalmClassifier.confidence(for: palm(confidence: 0.59)) == nil else {
  fatalError("Low-confidence landmarks must be rejected")
}

var incomplete = palm()
incomplete.removeValue(forKey: .littleTip)
guard LocalOpenPalmClassifier.confidence(for: incomplete) == nil else {
  fatalError("Missing required finger landmarks must be rejected")
}

print("Local open-palm classifier fixtures passed")
`;
  writeFileSync(runnerPath, `import Foundation\n\n${classifierBlock}\n\n${fixtures}`);
  execFileSync("swiftc", ["-module-cache-path", path.join(tempDir, "module-cache"), runnerPath, "-o", executablePath], {
    stdio: "pipe",
  });
  const output = execFileSync(executablePath, { encoding: "utf8" });
  assert.match(output, /classifier fixtures passed/);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Local hand-signal bridge and classifier checks passed");
