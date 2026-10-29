import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { getFaceMotionProfile } = loadTypeScript("src/character/face-motion.ts");
const surprise = getFaceMotionProfile("startled");
const joy = getFaceMotionProfile("pleased");
const angry = getFaceMotionProfile("angry");
const listening = getFaceMotionProfile("listening");
const duration = (profile) => profile.beats.reduce((sum, beat) => sum + beat.durationMs, 0);

assert.ok(surprise.eyeTransitionMs < joy.eyeTransitionMs, "surprise opens faster than a smile grows");
assert.ok(duration(surprise) < 520, "surprise settles within the existing single-tap reaction lifetime");
assert.ok(duration(joy) > duration(surprise), "joy has time to grow and rest");
assert.ok(duration(joy) < 900, "joy settles before the ordinary character reaction expires");
assert.ok(Math.abs(joy.liftPx) < Math.abs(surprise.liftPx), "joy is gentler than the surprise recoil");
assert.ok(angry.beats.every(({ value }) => value >= 0), "displeasure never rebounds into an opposite, playful beat");
assert.ok(angry.beats.every(({ value }, index, beats) => index < 2 || value <= beats[index - 1].value),
  "displeasure settles monotonically after its initial accent");
assert.equal(getFaceMotionProfile("curious").beats.length, 0, "curiosity uses its gaze and tilt rather than a startle");
assert.ok(duration(listening) <= 600 && Math.abs(listening.liftPx) <= 1.5 && Math.abs(listening.tiltDeg) <= 0.5,
  "a listening accent is brief and small, with no physical head trajectory");

for (const emotion of ["neutral", "happy", "excited", "curious", "repairing", "clarified", "petted", "expectant", "concerned", "attentive", "listening", "thoughtful", "startled", "pleased", "annoyed", "angry", "victory", "sleeping"]) {
  const profile = getFaceMotionProfile(emotion);
  for (const field of ["eyeTransitionMs", "mouthTransitionMs", "poseTransitionMs"]) {
    assert.ok(profile[field] > 0 && profile[field] <= 400, `${emotion}: bounded ${field}`);
  }
  if (profile.beats.length) assert.equal(profile.beats.at(-1).value, 0, `${emotion} finishes without residual movement`);
  for (const { value, durationMs } of profile.beats) {
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 1);
    assert.ok(durationMs > 0 && durationMs <= 300);
  }
}
console.log("Face motion profiles: surprise, joy, curiosity and controlled displeasure PASS");

// Crop geometry must preserve material position throughout closure and reopening.
const { getFaceBlinkGeometry } = loadTypeScript("src/character/face-motion.ts");
for (const height of [30, 120, 190]) {
  for (const openness of [0, 0.07, 0.25, 0.5, 0.75, 1]) {
    const { apertureHeight, contentTop } = getFaceBlinkGeometry(height, openness);
    assert.equal(apertureHeight, height * openness);
    const apertureTop = (height - apertureHeight) / 2;
    assert.ok(Math.abs(apertureTop + contentTop) < 1e-10,
      "centering the aperture cannot move the eye material in face space");
    assert.ok(Math.abs((height / 2 - apertureTop) - apertureHeight / 2) < 1e-10,
      "the eye center stays inside every nonempty aperture");
  }
  assert.equal(getFaceBlinkGeometry(height, -1).apertureHeight, 0);
  assert.equal(getFaceBlinkGeometry(height, 2).apertureHeight, height);
}
console.log("Stable eye material and centered blink aperture: PASS");
