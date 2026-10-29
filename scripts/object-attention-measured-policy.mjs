#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(root, "docs/research/evidence/native-tracking-probe-2026-10-26.json");
const policyPath = path.join(root, "src/core/object-attention-policy.ts");
const helperPath = path.join(root, "modules/local-face-attention/ios/LocalObjectTrackingSession.swift");
const replayPath = fileURLToPath(import.meta.url);
const outputArgument = process.argv[2];

if (!outputArgument) {
  console.error("Usage: node scripts/object-attention-measured-policy.mjs <output-report.json>");
  process.exit(2);
}

const outputPath = path.resolve(outputArgument);
assert.notEqual(outputPath, inputPath, "the output must not overwrite the stored native measurements");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputBytes = readFileSync(inputPath);
const input = JSON.parse(inputBytes.toString("utf8"));
const policySource = readFileSync(policyPath);
const helperSource = readFileSync(helperPath);
const replaySource = readFileSync(replayPath);
const { createObjectAttentionPolicy } = loadTypeScript(policyPath);

assert.equal(input.measurementStatus, "frames-collected", "native input must contain collected measurements");
assert.equal(input.metadata?.measurementOnly, true, "native input must be marked measurement-only");
assert.equal(input.metadata?.passClaim, "none; successful process means measurements were collected");
assert.equal(input.metadata?.tracker, "LocalObjectTrackingSession.start/step");
assert.ok(Array.isArray(input.scenarios) && input.scenarios.length > 0, "native input must contain scenarios");
assert.equal(typeof input.metadata?.sourceHashes?.helperSha256, "string");
assert.equal(typeof input.metadata?.sourceHashes?.probeDriverSha256, "string");

function normalizedRect(value, label) {
  assert.ok(value && typeof value === "object", `${label} must be a rectangle`);
  for (const key of ["left", "top", "right", "bottom"]) {
    assert.equal(typeof value[key], "number", `${label}.${key} must be numeric`);
    assert.ok(Number.isFinite(value[key]), `${label}.${key} must be finite`);
  }
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
}

function validateScenario(scenario) {
  assert.equal(typeof scenario.id, "string");
  assert.equal(scenario.start?.status, "accepted", `${scenario.id} must record a successful native seed`);
  normalizedRect(scenario.seedRect, `${scenario.id}.seedRect`);
  assert.ok(Array.isArray(scenario.frames) && scenario.frames.length > 0, `${scenario.id} needs measured frames`);
  for (let index = 0; index < scenario.frames.length; index += 1) {
    const frame = scenario.frames[index];
    assert.equal(frame.index, index, `${scenario.id} frame indexes must be ordered and contiguous`);
    assert.equal(typeof frame.accepted, "boolean", `${scenario.id} frame ${index} must record native acceptance`);
    assert.equal(typeof frame.elapsedMs, "number", `${scenario.id} frame ${index} needs measured elapsed time`);
    assert.ok(Number.isFinite(frame.elapsedMs) && frame.elapsedMs >= 0);
    if (frame.accepted) {
      assert.equal(typeof frame.confidence, "number", `${scenario.id} accepted frame ${index} needs confidence`);
      assert.ok(Number.isFinite(frame.confidence));
      normalizedRect(frame.observedRect, `${scenario.id}.frames[${index}].observedRect`);
    } else {
      assert.equal(typeof frame.lossReason, "string", `${scenario.id} rejected frame ${index} needs a native loss reason`);
    }
  }
}

function replayScenario(scenario) {
  validateScenario(scenario);
  let policyNow = 10_000;
  let replayTimestampMs = 0;
  const requestId = `measurement-${scenario.id}`;
  const sessionId = `measurement-session-${scenario.id}`;
  const trackId = `measurement-track-${scenario.id}`;
  const policy = createObjectAttentionPolicy(() => policyNow);
  const selecting = policy.begin(requestId, sessionId);
  assert.equal(selecting.status, "selecting", `${scenario.id} must begin an explicit selection`);
  const armed = policy.arm(trackId, normalizedRect(scenario.seedRect, `${scenario.id}.seedRect`));
  assert.equal(armed.status, "tracking", `${scenario.id} must arm the selected track`);

  const frames = scenario.frames.map((frame) => {
    // Advance both replay clocks synthetically. The stored elapsedMs values are
    // measurements of Vision call runtime, not capture timestamps.
    policyNow += 120;
    replayTimestampMs += 120;
    const event = {
      requestId,
      sessionId,
      trackId,
      timestampMs: replayTimestampMs,
      status: frame.accepted ? "tracking" : "lost",
      rect: frame.accepted ? normalizedRect(frame.observedRect, `${scenario.id}.frame[${frame.index}]`) : null,
      confidence: frame.accepted ? frame.confidence : undefined,
      reason: frame.accepted ? undefined : frame.lossReason,
    };
    const state = policy.update(event);
    const acceptedByPolicy = frame.accepted && state.status === "tracking" && state.rect !== null;
    return {
      index: frame.index,
      replayTimestampMs,
      policyNowMs: policyNow,
      native: {
        phase: frame.phase,
        accepted: frame.accepted,
        measuredElapsedMs: frame.elapsedMs,
        confidence: frame.confidence ?? null,
        lossReason: frame.lossReason ?? null,
        fullyOccluded: frame.fullyOccluded ?? false,
        associatedMoreWithDistractor: frame.associatedMoreWithDistractor ?? false,
        iou: frame.iou ?? null,
        distractorIoU: frame.distractorIoU ?? null,
        centerErrorPx: frame.centerErrorPx ?? null,
      },
      policy: {
        accepted: acceptedByPolicy,
        status: state.status,
        reason: state.reason,
        rect: state.rect,
      },
    };
  });

  const finalState = policy.snapshot();
  return {
    id: scenario.id,
    startStatus: selecting.status,
    armedStatus: armed.status,
    frameCount: frames.length,
    nativeTrackingFrameCount: frames.filter((frame) => frame.native.phase !== "seed").length,
    nativeAcceptedFrames: frames.filter((frame) => frame.native.accepted).length,
    policyAcceptedFrames: frames.filter((frame) => frame.policy.accepted).length,
    nativeAcceptedTrackingFrames: frames.filter((frame) => frame.native.phase !== "seed" && frame.native.accepted).length,
    policyAcceptedTrackingFrames: frames.filter((frame) => frame.native.phase !== "seed" && frame.policy.accepted).length,
    nativeAcceptedFullyOccludedFrames: frames.filter((frame) => frame.native.fullyOccluded && frame.native.accepted).length,
    policyAcceptedFullyOccludedFrames: frames.filter((frame) => frame.native.fullyOccluded && frame.policy.accepted).length,
    nativeDistractorAssociatedFrames: frames.filter((frame) => frame.native.associatedMoreWithDistractor).length,
    policyFirstLoss: frames.find((frame, index) => frame.policy.status === "lost"
      && (index === 0 || frames[index - 1].policy.status !== "lost"))?.index ?? null,
    policyFinalStatus: finalState.status,
    policyFinalReason: finalState.reason,
    nativePostLoss: scenario.postLoss ?? null,
    frames,
  };
}

const scenarios = input.scenarios.map(replayScenario);
const report = {
  format: "looi.object-attention-measured-policy-replay.v1",
  result: "replayed",
  qualityPassClaim: "none",
  interpretation: "Stored native measurements were replayed through the current JavaScript policy; this is a policy observation, not a tracker quality grade or live Vision run.",
  input: {
    path: path.relative(root, inputPath),
    measurementStatus: input.measurementStatus,
    measurementOnly: input.metadata.measurementOnly,
    sourceHashesRecordedInMeasurement: input.metadata.sourceHashes,
    storedReportSha256: sha256(inputBytes),
  },
  currentSources: {
    policyPath: path.relative(root, policyPath),
    policySha256: sha256(policySource),
    helperPath: path.relative(root, helperPath),
    helperSha256: sha256(helperSource),
    helperMatchesMeasurement: sha256(helperSource) === input.metadata.sourceHashes.helperSha256,
    replayPath: path.relative(root, replayPath),
    replaySha256: sha256(replaySource),
  },
  replayClock: {
    receiveIntervalMs: 120,
    nativeTimestampIntervalMs: 120,
    timestampSource: "synthetic monotonic replay timestamps; not captured native timestamps",
    latencyClaim: "none; measured elapsedMs is preserved per frame but not used as a timestamp or policy interval",
  },
  scenarioCount: scenarios.length,
  replayedFrameCount: scenarios.reduce((sum, scenario) => sum + scenario.frameCount, 0),
  scenarios,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
const outputBytes = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outputPath, outputBytes);
console.log(`Replayed ${report.replayedFrameCount} stored native frames through the current policy across ${report.scenarioCount} scenarios.`);
console.log(`Report: ${outputPath}`);
console.log(`Stored-input SHA-256: ${report.input.storedReportSha256}`);
console.log(`Output SHA-256: ${sha256(outputBytes)}`);
console.log("No tracker or policy quality pass is claimed.");
