import { getCharacterActionDuration, getCharacterPropContact, getCharacterPropPose, getCharacterPropSize,
  type CharacterActionKind, type CharacterActionPhase, type CharacterPropPose } from "./character-action";
import { getCharacterScene, type CharacterSceneMotion } from "./character-scene-catalog";

export type CharacterChoreography = {
  kind: CharacterActionKind; motion: CharacterSceneMotion; size: number;
  contact: { x: number; y: number } | null;
  hidden: CharacterPropPose; reveal: CharacterPropPose; use: CharacterPropPose; enjoy: CharacterPropPose;
  still: CharacterPropPose; duration: number; twoHands: boolean;
};
export type CharacterMotionFrame = {
  prop: CharacterPropPose; grip: number; hands: number;
  gazeX: number; gazeY: number; tilt: number; lift: number; squash: number;
  mouthX: number; mouthY: number; liquid: number; bite: number; crumbs: number;
  bookOpen: number; page: number; steam: number;
};

/** Resolve catalog data on JS once. The UI worklet receives only plain numbers. */
export function createCharacterChoreography(kind: CharacterActionKind, phase: CharacterActionPhase): CharacterChoreography {
  const scene = getCharacterScene(kind);
  return { kind, motion: scene.motion, size: getCharacterPropSize(kind), contact: getCharacterPropContact(kind),
    hidden: { ...getCharacterPropPose(kind, "hidden"), x: 116, y: 80, rotation: 24 },
    reveal: getCharacterPropPose(kind, "reveal"), use: getCharacterPropPose(kind, "use"),
    enjoy: getCharacterPropPose(kind, "enjoy"), still: getCharacterPropPose(kind, phase, true),
    duration: getCharacterActionDuration(kind, phase), twoHands: scene.motion === "read" || scene.motion === "offer" };
}
function clamp(value: number) { "worklet"; return Math.max(0, Math.min(1, value)); }
function smooth(value: number) { "worklet"; const t = clamp(value); return t * t * (3 - 2 * t); }
function mix(a: number, b: number, t: number) { "worklet"; return a + (b - a) * t; }
function poseBetween(a: CharacterPropPose, b: CharacterPropPose, t: number): CharacterPropPose {
  "worklet";
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), rotation: mix(a.rotation, b.rotation, t), scale: mix(a.scale, b.scale, t), opacity: mix(a.opacity, b.opacity, t) };
}
function pulse(p: number, center: number, width: number) {
  "worklet";
  const t = clamp(1 - Math.abs(p - center) / width); return Math.sin(t * Math.PI / 2);
}

/** One finite clock couples attention, handling, object change and reaction. */
export function sampleCharacterChoreography(recipe: CharacterChoreography, phase: CharacterActionPhase, progress: number, reducedMotion = false): CharacterMotionFrame {
  "worklet";
  const p = clamp(progress), motion = recipe.motion;
  const consume = motion === "sip" || motion === "coffee" || motion === "bite";
  const quiet = motion === "rest";
  const frame: CharacterMotionFrame = { prop: recipe.reveal, grip: 1, hands: quiet ? 0 : 1,
    gazeX: 0, gazeY: 0, tilt: 0, lift: 0, squash: 1, mouthX: 1, mouthY: 1,
    liquid: 0.8, bite: 0, crumbs: 0, bookOpen: 0.12, page: 0, steam: 0 };
  if (reducedMotion) return { ...frame, prop: recipe.still, bookOpen: 1, liquid: 0.55, hands: quiet ? 0 : 1 };
  if (quiet) return { ...frame, prop: { ...recipe.use, opacity: phase === "reveal" ? smooth(p * 3) : phase === "put-away" ? 1 - smooth(p) : 1 }, hands: 0 };

  if (phase === "reveal") {
    // Look first. Reach next. The object arrives only after that anticipation.
    const reach = smooth((p - 0.23) / 0.77);
    frame.prop = poseBetween(recipe.hidden, recipe.reveal, reach);
    frame.prop.opacity = smooth((p - 0.28) / 0.26);
    frame.prop.y -= Math.sin(reach * Math.PI) * 11;
    frame.hands = smooth(p / 0.3); frame.grip = smooth((p - 0.45) / 0.4);
    frame.gazeX = 0.72 * smooth(p * 5); frame.gazeY = 0.8 * smooth(p * 5);
    frame.tilt = 4 * Math.sin(p * Math.PI); frame.lift = -2 * Math.sin(p * Math.PI);
  } else if (phase === "use") {
    const approach = smooth(p / 0.2), release = smooth((p - 0.78) / 0.22);
    frame.prop = release > 0 ? poseBetween(recipe.use, recipe.enjoy, release) : poseBetween(recipe.reveal, recipe.use, approach);
    frame.gazeX = mix(0.72, 0, approach); frame.gazeY = mix(0.8, 0.5, approach);
    if (consume) {
      const beat = pulse(p, 0.34, 0.11) + pulse(p, 0.63, 0.11);
      const angle = frame.prop.rotation - beat * (motion === "coffee" ? 10 : 5);
      // Rotate about the contact, not the object's center, while using it.
      if (recipe.contact) {
        const dx = (recipe.contact.x - 12) * recipe.size / 24, dy = (recipe.contact.y - 12) * recipe.size / 24;
        const a = frame.prop.rotation * Math.PI / 180, b = angle * Math.PI / 180;
        frame.prop.x += (dx * Math.cos(a) - dy * Math.sin(a) - dx * Math.cos(b) + dy * Math.sin(b)) * frame.prop.scale;
        frame.prop.y += (dx * Math.sin(a) + dy * Math.cos(a) - dx * Math.sin(b) - dy * Math.cos(b)) * frame.prop.scale;
      }
      frame.prop.rotation = angle;
      frame.liquid = 0.8 - smooth((p - 0.3) / 0.1) * 0.24 - smooth((p - 0.59) / 0.1) * 0.26;
      frame.bite = smooth((p - 0.3) / 0.08) * 0.5 + smooth((p - 0.59) / 0.08) * 0.5;
      const crumbA = (p - 0.33) / 0.18, crumbB = (p - 0.62) / 0.18;
      frame.crumbs = crumbB > 0 && crumbB < 1 ? crumbB : crumbA > 0 && crumbA < 1 ? crumbA : 0;
      frame.mouthX = 1 + beat * (motion === "bite" ? 0.7 : -0.12);
      frame.mouthY = 1 - beat * (motion === "bite" ? 0.6 : 0.12);
      frame.squash = 1 - beat * 0.025; frame.tilt = beat * (motion === "coffee" ? -3 : 1.5);
    } else if (motion === "read") {
      const reading = smooth(p / 0.18) * (1 - smooth((p - 0.85) / 0.15));
      frame.bookOpen = 0.12 + 0.88 * smooth(p / 0.18);
      frame.page = smooth((p - 0.43) / 0.24);
      frame.gazeX = Math.sin((p - 0.18) * Math.PI * 5) * 0.3 * reading;
      frame.gazeY = 0.7; frame.tilt = -2 * reading;
    } else if (motion === "offer") {
      const present = Math.sin(p * Math.PI);
      frame.prop.scale += present * 0.12; frame.prop.y -= present * 5;
      frame.gazeX = mix(0.45, 0, smooth(p / 0.3)); frame.tilt = -present * 2;
    } else if (motion === "inspect") {
      const turn = Math.sin(p * Math.PI * 2);
      frame.prop.rotation += turn * 16; frame.gazeX = 0.4 + turn * 0.2;
      frame.tilt = -turn * 3;
    } else if (motion === "cheer") {
      const beat = pulse(p, 0.3, 0.17) + pulse(p, 0.65, 0.17);
      frame.prop.y -= beat * 24; frame.prop.rotation -= beat * 10;
      frame.lift = beat * 5; frame.squash = 1 - beat * 0.03;
    } else {
      frame.prop.rotation += Math.sin(p * Math.PI * 2) * 4;
      frame.gazeX = 0.3 * (1 - smooth(p));
    }
    frame.gazeX = mix(mix(0.72, frame.gazeX, approach), 0.42, release);
    frame.gazeY = mix(mix(0.8, frame.gazeY, approach), 0.4, release);
    frame.steam = p;
  } else if (phase === "enjoy") {
    frame.prop = recipe.enjoy; frame.liquid = 0.3; frame.bite = 1;
    frame.bookOpen = mix(1, 0.12, smooth(p));
    frame.gazeX = 0.42 * (1 - smooth(p / 0.5)); frame.gazeY = 0.4 * (1 - smooth(p / 0.5));
    frame.tilt = -Math.sin(p * Math.PI) * 3;
    frame.lift = Math.sin(p * Math.PI) * 2;
  } else {
    frame.prop = poseBetween(recipe.enjoy, recipe.hidden, smooth(p));
    frame.prop.opacity = 1 - smooth((p - 0.55) / 0.45);
    frame.hands = frame.prop.opacity; frame.liquid = 0.3; frame.bite = 1;
  }
  return frame;
}
