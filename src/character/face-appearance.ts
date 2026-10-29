import type { FacePaletteId, FaceStyleId } from "../store/user";
import type { FaceExpression, MouthShape } from "./face-expression";
import { GLASS_FACE_LAYOUT } from "./glass-face";

export type FaceStyleVisual = {
  eyeWidthScale: number;
  eyeHeightScale: number;
  eyeRadius: number;
  eyeGapScale: number;
  mouthWidthScale: number;
  idleMouth: MouthShape;
  idleMouthWidth: number;
  leftEyeRotationOffset: number;
  rightEyeRotationOffset: number;
  decor: "none" | "lashes" | "brows" | "fringe" | "cowboy" | "bandana";
};

export type FacePaletteVisual = {
  eyeColor: string;
  eyeShadowColor: string;
  eyeGlow: string;
  mouthColor: string;
  accentColor: string;
};

export const FACE_STYLES: Record<FaceStyleId, FaceStyleVisual> = {
  classic: {
    eyeWidthScale: 1,
    eyeHeightScale: 1,
    eyeRadius: 999,
    eyeGapScale: 1,
    mouthWidthScale: 1,
    idleMouth: "smile",
    idleMouthWidth: GLASS_FACE_LAYOUT.mouthWidth,
    leftEyeRotationOffset: 0,
    rightEyeRotationOffset: 0,
    decor: "none",
  },
  soft: {
    eyeWidthScale: 1.03,
    eyeHeightScale: 1.1,
    eyeRadius: 999,
    eyeGapScale: 0.94,
    mouthWidthScale: 0.88,
    idleMouth: "smile",
    idleMouthWidth: 28,
    leftEyeRotationOffset: -2,
    rightEyeRotationOffset: 2,
    decor: "lashes",
  },
  playful: {
    eyeWidthScale: 1.08,
    eyeHeightScale: 0.92,
    eyeRadius: 999,
    eyeGapScale: 0.9,
    mouthWidthScale: 1,
    idleMouth: "dot",
    idleMouthWidth: 11,
    leftEyeRotationOffset: -4,
    rightEyeRotationOffset: 5,
    decor: "brows",
  },
  // Legacy `fringe` id is intentionally retained for preference compatibility,
  // but the old hair strokes are replaced by a stylized cap.
  fringe: {
    eyeWidthScale: 0.92,
    eyeHeightScale: 0.84,
    eyeRadius: 42,
    eyeGapScale: 1.04,
    mouthWidthScale: 1.08,
    idleMouth: "smile",
    idleMouthWidth: 40,
    leftEyeRotationOffset: -2,
    rightEyeRotationOffset: 2,
    decor: "fringe",
  },
  sharp: {
    eyeWidthScale: 1.08,
    eyeHeightScale: 0.72,
    eyeRadius: 26,
    eyeGapScale: 1.04,
    mouthWidthScale: 0.88,
    idleMouth: "line",
    idleMouthWidth: 24,
    leftEyeRotationOffset: -5,
    rightEyeRotationOffset: 5,
    decor: "brows",
  },
  cowboy: {
    eyeWidthScale: 0.88,
    eyeHeightScale: 0.72,
    eyeRadius: 30,
    eyeGapScale: 1.08,
    mouthWidthScale: 1.14,
    idleMouth: "smile",
    idleMouthWidth: 44,
    leftEyeRotationOffset: -3,
    rightEyeRotationOffset: 3,
    decor: "cowboy",
  },
  bandana: {
    eyeWidthScale: 0.9,
    eyeHeightScale: 0.86,
    eyeRadius: 38,
    eyeGapScale: 1.02,
    mouthWidthScale: 1.18,
    idleMouth: "line",
    idleMouthWidth: 38,
    leftEyeRotationOffset: -2,
    rightEyeRotationOffset: 2,
    decor: "bandana",
  },
};

export const FACE_PALETTES: Record<FacePaletteId, FacePaletteVisual> = {
  cyan: {
    eyeColor: "#96E8C8",
    eyeShadowColor: "#1B4A48",
    eyeGlow: "rgba(104,227,181,0.20)",
    mouthColor: "#9CE8CA",
    accentColor: "#A0E8CE",
  },
  rose: {
    eyeColor: "#FF8BD1",
    eyeShadowColor: "#8D6BFF",
    eyeGlow: "rgba(255,139,209,0.30)",
    mouthColor: "#FF9BD8",
    accentColor: "#FFC0E6",
  },
  lime: {
    eyeColor: "#9EF06A",
    eyeShadowColor: "#2C9CFF",
    eyeGlow: "rgba(158,240,106,0.28)",
    mouthColor: "#9EF06A",
    accentColor: "#C8FF9F",
  },
  amber: {
    eyeColor: "#FFB454",
    eyeShadowColor: "#FF5F6D",
    eyeGlow: "rgba(255,180,84,0.30)",
    mouthColor: "#FFC15A",
    accentColor: "#FFE09A",
  },
  violet: {
    eyeColor: "#B99AFF",
    eyeShadowColor: "#596BFF",
    eyeGlow: "rgba(185,154,255,0.30)",
    mouthColor: "#CFB8FF",
    accentColor: "#E2D5FF",
  },
};

/** Shared by the live face, settings preview and compatibility checks. */
export function getFaceAppearanceMetrics(
  style: FaceStyleVisual,
  isAvatar = false,
) {
  const unit = isAvatar ? 0.2 : 1;
  const eyeWidth = GLASS_FACE_LAYOUT.eyeWidth * unit * style.eyeWidthScale;
  const eyeHeight = GLASS_FACE_LAYOUT.eyeHeight * unit * style.eyeHeightScale;
  const eyeGap = GLASS_FACE_LAYOUT.eyeGap * unit * style.eyeGapScale;
  const eyeCenterY = isAvatar
    ? 52.98 - (216 - GLASS_FACE_LAYOUT.eyeCenterY) * unit
    : GLASS_FACE_LAYOUT.eyeCenterY;
  const eyeTop = eyeCenterY - eyeHeight / 2;
  const eyeCenterDistance = eyeWidth + eyeGap;
  return {
    eyeWidth,
    eyeHeight,
    eyeGap,
    eyeCenterY,
    eyeTop,
    eyeCenterDistance,
    browGap: eyeCenterDistance - (isAvatar ? 10 : 44),
    lashGap: eyeCenterDistance - (isAvatar ? 5 : 22),
    browTop: eyeTop - 16 * unit,
    lashTop: eyeTop - 4 * unit,
  };
}

export function resolveStyledMouth(
  face: FaceExpression,
  style: FaceStyleVisual,
) {
  const idle =
    face.mouth === "none" &&
    (face.emotion === "neutral" || face.emotion === "attentive");
  return {
    shape: idle ? style.idleMouth : face.mouth,
    width:
      (idle ? style.idleMouthWidth : face.mouthWidth) * style.mouthWidthScale,
  };
}
