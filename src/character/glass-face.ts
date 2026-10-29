import type { FaceExpression } from "./face-expression";
import type { FacePaletteId } from "../store/user";

export type GlassEyePose = {
  scaleX: number;
  scaleY: number;
  offsetY: number;
  rotation: number;
  round: number;
  bean: number;
  arc: number;
  wedge: number;
  tender: number;
  upper: number;
  close: number;
  rest: number;
};
type Point = readonly [number, number];
// Four corresponding cubic segments keep the approved moon contour exact at
// rest, and let every existing emotion morph the same piece of glass.
const SHAPES: Record<
  "pillow" | "round" | "bean" | "arc" | "wedge" | "tender",
  readonly Point[]
> = {
  pillow: [
    [0, -34],
    [19, -34],
    [32, -21],
    [33, -2],
    [34, 19],
    [23, 33],
    [2, 34],
    [-18, 35],
    [-32, 24],
    [-33, 4],
    [-35, -17],
    [-22, -33],
    [0, -34],
  ],
  round: [
    [0, -34],
    [18.78, -34],
    [34, -18.78],
    [34, 0],
    [34, 18.78],
    [18.78, 34],
    [0, 34],
    [-18.78, 34],
    [-34, 18.78],
    [-34, 0],
    [-34, -18.78],
    [-18.78, -34],
    [0, -34],
  ],
  bean: [
    [-3, -34],
    [18, -35],
    [29, -17],
    [31, 3],
    [33, 24],
    [16, 35],
    [-4, 34],
    [-24, 33],
    [-34, 17],
    [-32, -3],
    [-30, -24],
    [-22, -33],
    [-3, -34],
  ],
  arc: [
    [0, -24],
    [18, -24],
    [28, -15],
    [32, 0],
    [35, 14],
    [14, -5],
    [0, -5],
    [-14, -5],
    [-35, 14],
    [-32, 0],
    [-28, -15],
    [-18, -24],
    [0, -24],
  ],
  wedge: [
    [-2, -19],
    [14, -17],
    [30, -10],
    [33, 2],
    [35, 23],
    [19, 33],
    [0, 33],
    [-21, 33],
    [-34, 20],
    [-33, 0],
    [-32, -13],
    [-18, -22],
    [-2, -19],
  ],
  tender: [
    [0, -30],
    [18, -36],
    [31, -22],
    [33, -1],
    [34, 20],
    [21, 33],
    [0, 33],
    [-20, 33],
    [-33, 20],
    [-33, 3],
    [-33, -14],
    [-19, -24],
    [0, -30],
  ],
};

// Uniformly scale the selected 360×166 study to the existing y=216 scene
// contact. Keeping these proportions shared also keeps captions out of layout.
export const GLASS_FACE_LAYOUT = {
  eyeWidth: 124,
  eyeHeight: (124 * 68) / 66,
  eyeGap: (124 * 44) / 66,
  eyeCenterY: 216 - (124 * 44.05) / 66,
  mouthWidth: (124 * 19) / 66,
} as const;
function clamp(n: number, lo: number, hi: number) {
  "worklet";
  return Math.max(lo, Math.min(hi, n));
}

/** Adapter only: the existing presentation resolver still owns every emotion. */
export function getGlassEyePose(
  face: FaceExpression,
  side: "left" | "right",
  rotationOffset = 0,
): GlassEyePose {
  const left = side === "left",
    rawY = left ? face.leftEyeScaleY : face.rightEyeScaleY;
  const p: GlassEyePose = {
    scaleX: clamp(
      1 + ((left ? face.leftEyeScaleX : face.rightEyeScaleX) - 1) * 0.55,
      0.86,
      1.12,
    ),
    scaleY: clamp(1 + (rawY - 1) * 0.4, 0.86, 1.12),
    offsetY: left ? face.leftEyeOffsetY : face.rightEyeOffsetY,
    rotation:
      (left ? face.leftEyeRotation : face.rightEyeRotation) + rotationOffset,
    round: 0,
    bean: 0,
    arc: 0,
    wedge: 0,
    tender: 0,
    upper: (left ? face.leftLid : face.rightLid) * 0.4,
    close: 0,
    rest: 0,
  };
  switch (face.emotion) {
    case "sleeping":
      p.close = 1;
      p.rest = 1;
      p.scaleY = 1;
      p.upper = 0;
      break;
    case "petted":
      p.close = 1;
      p.rest = -1;
      p.scaleY = 1;
      p.upper = 0;
      break;
    case "happy":
    case "excited":
    case "pleased":
    case "victory":
      p.arc = 1;
      p.scaleY = 1;
      p.upper = 0;
      break;
    case "clarified":
      p.arc = 0.25;
      p.scaleY = 1;
      break;
    case "startled":
      p.round = 1;
      break;
    case "curious":
    case "repairing":
      p.round = left ? 0.75 : 0;
      p.bean = left ? 0 : 0.9;
      break;
    case "thoughtful":
      p.wedge = left ? 0.4 : 0.85;
      break;
    case "annoyed":
    case "angry":
      p.wedge = 1;
      break;
    case "concerned":
    case "sad":
      p.tender = 0.85;
      p.scaleY = 0.98;
      break;
    case "attentive":
      p.scaleX = 1;
      p.scaleY = 1;
      break;
    case "listening":
    case "expectant":
      p.round = 0.1;
      break;
    case "reading":
      p.wedge = 0.2;
      break;
    case "drinking":
    case "snacking":
      p.arc = face.eyeSmile * 0.55;
      break;
  }
  return p;
}

export function glassEyePoints(
  p: GlassEyePose,
  side: "left" | "right",
): Point[] {
  "worklet";
  const keys = ["round", "bean", "arc", "wedge", "tender"] as const;
  let sum = 0;
  for (const key of keys) sum += p[key];
  const denominator = Math.max(1, sum),
    base = Math.max(0, 1 - sum),
    points: Point[] = [];
  for (let i = 0; i < 13; i++) {
    let x = SHAPES.pillow[i][0] * base,
      y = SHAPES.pillow[i][1] * base;
    for (const key of keys) {
      const mirror = side === "right" && (key === "bean" || key === "tender");
      const point = SHAPES[key][mirror ? 12 - i : i];
      x += point[0] * (mirror ? -1 : 1) * p[key];
      y += point[1] * p[key];
    }
    points.push([x / denominator / 66, y / denominator / 68]);
  }
  return points;
}
function number(n: number) {
  "worklet";
  return Math.round(n * 1000) / 1000;
}
export function glassContour(
  points: readonly Point[],
  width: number,
  height: number,
  dx = 0,
  dy = 0,
): string {
  "worklet";
  let d = `M${number(points[0][0] * width + dx)},${number(points[0][1] * height + dy)}`;
  for (let i = 1; i < points.length; i += 3) {
    d += `C${number(points[i][0] * width + dx)},${number(points[i][1] * height + dy)} ${number(points[i + 1][0] * width + dx)},${number(points[i + 1][1] * height + dy)} ${number(points[i + 2][0] * width + dx)},${number(points[i + 2][1] * height + dy)}`;
  }
  return d + "Z";
}
export function getGlassEyeGeometry(
  p: GlassEyePose,
  side: "left" | "right",
  width: number,
  height: number,
  blink: number,
  gazeX = 0,
  gazeY = 0,
) {
  "worklet";
  const w = width * p.scaleX,
    h = height * p.scaleY,
    points = glassEyePoints(p, side);
  const close = Math.max(p.close, 1 - clamp(blink, 0, 1)),
    upper = Math.max(p.upper, close * 0.5),
    lower = close * 0.5;
  const top = -h * 0.58 + h * upper,
    bottom = h * 0.58 - h * lower;
  const upperEdge = `M${-w * 0.56},${top}Q0,${top + h * 0.2 * upper} ${w * 0.56},${top}`;
  const lowerEdge = `M${-w * 0.56},${bottom}Q0,${bottom - h * 1.36 * lower} ${w * 0.56},${bottom}`;
  const bow = p.rest === 0 ? (2 * width) / 142 : (p.rest * 12 * width) / 142;
  // Light rises from the bottom. The selected attention target can move it
  // gently inside the stable shell, without a separate bright central pupil.
  const coreX = (-w * 2) / 66 + clamp(gazeX, -1, 1) * width * 0.06,
    coreY = h * (35 / 68 - p.arc * 0.12) + clamp(gazeY, -1, 1) * height * 0.045;
  const ellipse = (rx: number, ry: number, x: number, y: number) => {
    const k = 0.552285;
    return glassContour(
      [
        [0, -1],
        [k, -1],
        [1, -k],
        [1, 0],
        [1, k],
        [k, 1],
        [0, 1],
        [-k, 1],
        [-1, k],
        [-1, 0],
        [-1, -k],
        [-k, -1],
        [0, -1],
      ],
      rx,
      ry,
      x,
      y,
    );
  };
  return {
    outline: glassContour(points, w, h),
    core: ellipse((w * 22) / 66, (h * 15) / 68, coreX, coreY),
    coreGlow: ellipse(w * 0.48, h * 0.3, coreX * 0.6, coreY),
    lightX: -w * 0.02 + clamp(gazeX, -1, 1) * width * 0.06,
    lightY: h * 0.44 + clamp(gazeY, -1, 1) * height * 0.045,
    aperture: `M${-w},${top}L${-w * 0.56},${top}Q0,${top + h * 0.2 * upper} ${w * 0.56},${top}L${w},${top}L${w},${bottom}L${w * 0.56},${bottom}Q0,${bottom - h * 1.36 * lower} ${-w * 0.56},${bottom}L${-w},${bottom}Z`,
    upperEdge,
    lowerEdge,
    closed: `M${-w * 0.36},1C${-w * 0.15},${1 + bow} ${w * 0.15},${1 + bow} ${w * 0.36},1`,
    bodyOpacity: clamp(1 - Math.max(0, (close - 0.62) / 0.32), 0, 1),
    lineOpacity: clamp((close - 0.6) / 0.32, 0, 1),
    glowOpacity: Math.pow(1 - close, 1.4),
    upperOpacity:
      Math.min(1, upper / 0.11) * clamp(1 - (close - 0.62) / 0.3, 0, 1),
    lowerOpacity:
      Math.min(1, lower / 0.11) * clamp(1 - (close - 0.62) / 0.3, 0, 1),
  };
}

export type GlassMouthPose = {
  width: number;
  curve: number;
  open: number;
  round: number;
  visible: number;
};
export function getGlassMouthPath(
  p: GlassMouthPose,
  pulse: number,
  mouthX = 1,
  mouthY = 1,
) {
  "worklet";
  const w = p.width * 0.5 * mouthX,
    k = (p.width / 19) * mouthY,
    opening = (p.open + clamp(pulse, 0, 1) * 0.38) * mouthY,
    radiusY = p.width * 0.5 * mouthY,
    round = clamp(p.round, 0, 1),
    curve = p.curve,
    corner = -2.05 * k * curve,
    top = -0.175 * k * curve - opening * 10,
    bottom =
      (Math.abs(curve) < 0.01 ? 0.8 * k : 2.05 * k * curve) + opening * 20,
    topShoulder = -0.8 * k * curve - opening * 5,
    bottomShoulder = 1.15 * k * curve + opening * 12,
    circle = 0.552285;
  const mix = (a: number, b: number) => a + (b - a) * round;
  return glassContour(
    [
      [-w, mix(corner, 0)],
      [mix((-6.75 / 9.5) * w, -w), mix(topShoulder, -radiusY * circle)],
      [mix((-3.375 / 9.5) * w, -w * circle), mix(top, -radiusY)],
      [0, mix(top, -radiusY)],
      [mix((3.375 / 9.5) * w, w * circle), mix(top, -radiusY)],
      [mix((6.75 / 9.5) * w, w), mix(topShoulder, -radiusY * circle)],
      [w, mix(corner, 0)],
      [mix((8 / 9.5) * w, w), mix(bottomShoulder, radiusY * circle)],
      [mix((4.5 / 9.5) * w, w * circle), mix(bottom, radiusY)],
      [0, mix(bottom, radiusY)],
      [mix((-4.5 / 9.5) * w, -w * circle), mix(bottom, radiusY)],
      [mix((-8 / 9.5) * w, -w), mix(bottomShoulder, radiusY * circle)],
      [-w, mix(corner, 0)],
    ],
    1,
    1,
  );
}

export const GLASS_PALETTES = {
  cyan: {
    moon: ["#d6fff0", "#96e8c8", "#4da58f", "#1b4a48", "#0c242b"],
    mouth: ["#b3efd7", "#67b99d"],
    shell: ["#e8ffd2", "#74cfa5", "#287669", "#4d9fa5", "#285070"],
    caustic: "#e4ffad",
    glow: "#5affb5",
    core: "#fffff3",
    coreMid: "#d4ffe1",
    rim: "#b3f6ba",
    jelly: ["#86ecc9", "#3daf95", "#1b5b58"],
  },
  rose: {
    moon: ["#ffe4f3", "#eda7ce", "#a35f91", "#4c294a", "#261a2b"],
    mouth: ["#f4c0de", "#bf759f"],
    shell: ["#ffe7f0", "#eb9cc9", "#893d75", "#bd7cb8", "#4d4e88"],
    caustic: "#ffcfe6",
    glow: "#ff8bd1",
    core: "#fffaf2",
    coreMid: "#ffe1f0",
    rim: "#ffcfeb",
    jelly: ["#ffa6d4", "#d660ab", "#772a64"],
  },
  lime: {
    moon: ["#f1ffda", "#d1eaa3", "#91a65c", "#3e4b28", "#202a1b"],
    mouth: ["#dbeeb7", "#9dbb6b"],
    shell: ["#f1ffd2", "#b6e781", "#4d8b56", "#5ca99b", "#345c87"],
    caustic: "#eaff9f",
    glow: "#b5ff73",
    core: "#ffffeb",
    coreMid: "#e1ffcb",
    rim: "#d1ffb0",
    jelly: ["#cbf386", "#80c048", "#3a6a22"],
  },
  amber: {
    moon: ["#fff1d0", "#f0cd95", "#b38d4e", "#514128", "#29241c"],
    mouth: ["#f3d5a7", "#bd955a"],
    shell: ["#fff0bd", "#ffc967", "#b16622", "#edb154", "#9c5540"],
    caustic: "#ffe59f",
    glow: "#ffb454",
    core: "#ffffec",
    coreMid: "#fff1cc",
    rim: "#ffe6a4",
    jelly: ["#ffcb62", "#e8952b", "#94500f"],
  },
  violet: {
    moon: ["#eee6ff", "#c8b9eb", "#8a78ac", "#3d3553", "#211d30"],
    mouth: ["#d8cbed", "#9d8abd"],
    shell: ["#f4eaff", "#c9aff8", "#665294", "#8f9fcc", "#3d4b84"],
    caustic: "#e9dcff",
    glow: "#b99aff",
    core: "#fffcf5",
    coreMid: "#ece1ff",
    rim: "#dfcfff",
    jelly: ["#cbb2ff", "#8d6cdb", "#45327e"],
  },
} as const satisfies Record<FacePaletteId, object>;
