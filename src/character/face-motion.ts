import type { FaceEmotion } from "./face-expression";

export type FaceMotionBeat = { value: number; durationMs: number };
export type FaceMotionProfile = {
  eyeTransitionMs: number;
  mouthTransitionMs: number;
  poseTransitionMs: number;
  liftPx: number;
  tiltDeg: number;
  beats: readonly FaceMotionBeat[];
};

// Local display timings, not physical robot trajectories. Every accent ends at
// zero so a new state can take ownership without a residual bounce or lean.
const quiet: FaceMotionProfile = {
  eyeTransitionMs: 240, mouthTransitionMs: 180, poseTransitionMs: 300,
  liftPx: 0, tiltDeg: 0, beats: [],
};
const surprise: FaceMotionProfile = {
  eyeTransitionMs: 85, mouthTransitionMs: 90, poseTransitionMs: 110,
  liftPx: -6, tiltDeg: -1,
  beats: [
    { value: -0.12, durationMs: 35 },
    { value: 1, durationMs: 70 },
    { value: 1, durationMs: 100 },
    { value: 0, durationMs: 230 },
  ],
};
const joy: FaceMotionProfile = {
  eyeTransitionMs: 320, mouthTransitionMs: 240, poseTransitionMs: 360,
  liftPx: -3, tiltDeg: -0.7,
  beats: [
    { value: 1, durationMs: 240 },
    { value: 1, durationMs: 220 },
    { value: 0, durationMs: 280 },
  ],
};
const displeasure: FaceMotionProfile = {
  eyeTransitionMs: 120, mouthTransitionMs: 110, poseTransitionMs: 170,
  liftPx: 1.5, tiltDeg: 1.4,
  beats: [
    { value: 1, durationMs: 110 },
    { value: 1, durationMs: 100 },
    { value: 0, durationMs: 220 },
  ],
};
const affection: FaceMotionProfile = {
  eyeTransitionMs: 280, mouthTransitionMs: 240, poseTransitionMs: 320,
  liftPx: 0, tiltDeg: 0, beats: [],
};
const listening: FaceMotionProfile = {
  eyeTransitionMs: 180, mouthTransitionMs: 180, poseTransitionMs: 240,
  liftPx: -1.5, tiltDeg: -0.5,
  beats: [{ value: 1, durationMs: 160 }, { value: 0, durationMs: 300 }],
};

export function getFaceMotionProfile(emotion: FaceEmotion): FaceMotionProfile {
  switch (emotion) {
    case "listening": return listening;
    case "petted": return affection;
    case "startled": return surprise;
    case "happy": case "pleased": case "excited": case "victory": return joy;
    case "annoyed": case "angry": return displeasure;
    default: return quiet;
  }
}

/** A centered shutter crops a stable eye instead of flattening its material. */
export function getFaceBlinkGeometry(height: number, openness: number) {
  "worklet";
  const open = Math.max(0, Math.min(1, openness));
  return { apertureHeight: height * open, contentTop: -height * (1 - open) / 2 };
}
