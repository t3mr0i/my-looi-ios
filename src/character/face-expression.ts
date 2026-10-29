import type { CharacterMood } from "./character-reaction";
import type { VoiceState } from "../store/user";
import type { CharacterActionFrame } from "./character-action";
import { getCharacterScene } from "./character-scene-catalog";

export type MouthShape = "none" | "line" | "smile" | "frown" | "dot";

export type FaceEmotion =
  | "listening"
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "repairing"
  | "clarified"
  | "petted"
  | "expectant"
  | "concerned"
  | "sad"
  | "attentive"
  | "thoughtful"
  | "startled"
  | "pleased"
  | "annoyed"
  | "angry"
  | "victory"
  | "drinking"
  | "snacking"
  | "reading"
  | "sleeping";

export type FaceExpression = {
  leftEyeScaleX: number;
  leftEyeScaleY: number;
  rightEyeScaleX: number;
  rightEyeScaleY: number;
  leftEyeOffsetY: number;
  rightEyeOffsetY: number;
  leftEyeRotation: number;
  rightEyeRotation: number;
  mouth: MouthShape;
  mouthWidth: number;
  emotion: FaceEmotion;
  /** Whole-face rotation in degrees. */
  headTilt: number;
  /** Vertical face movement in logical face-space pixels. */
  lift: number;
  /** Rounded lower-lid crescent, from 0 (off) to 1 (strong). */
  eyeSmile: number;
  /** Upper-lid coverage for each eye, from 0 (open) to 1 (closed). */
  leftLid: number;
  rightLid: number;
};

type FaceShape = Omit<FaceExpression, "emotion" | "headTilt" | "lift" | "eyeSmile" | "leftLid" | "rightLid">;

const neutralShape: FaceShape = {
  leftEyeScaleX: 1,
  leftEyeScaleY: 1,
  rightEyeScaleX: 1,
  rightEyeScaleY: 1,
  leftEyeOffsetY: 0,
  rightEyeOffsetY: 0,
  leftEyeRotation: 0,
  rightEyeRotation: 0,
  mouth: "none",
  mouthWidth: 0,
};

function makeExpression(
  emotion: FaceEmotion,
  shape: Partial<FaceShape> = {},
  motion: Partial<Pick<FaceExpression, "headTilt" | "lift" | "eyeSmile" | "leftLid" | "rightLid">> = {}
): FaceExpression {
  return {
    ...neutralShape,
    ...shape,
    emotion,
    headTilt: motion.headTilt ?? 0,
    lift: motion.lift ?? 0,
    eyeSmile: clampUnit(motion.eyeSmile ?? 0),
    leftLid: clampUnit(motion.leftLid ?? 0),
    rightLid: clampUnit(motion.rightLid ?? 0),
  };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Bound matches by Unicode letters and digits. This keeps "leider" from
// matching inside "Kleider" while still supporting Russian and Ukrainian.
function containsToken(text: string, alternatives: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${alternatives})(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);
}

const EXCITED_WORDS = String.raw`ура|круто|супер|отличн\p{L}*|здорово|класс\p{L}*|класно|wow|awesome|great|amazing|yay|чудов\p{L}*|fantastisch|großartig|klasse|wahnsinn|mega|spitze|genial|juhu|hurra|toll|super|prima`;
const CONCERNED_WORDS = String.raw`жаль|извини\p{L}*|прости\p{L}*|осторож\p{L}*|неприят\p{L}*|плохо|sorry|careful|unfortunately|шкода|вибач\p{L}*|обереж\p{L}*|leider|schade|entschuldig\p{L}*|vorsicht\p{L}*|vorsichtig|unangenehm|schlecht|traurig|besorgt|pass\s+auf|oh\s+nein|tut\s+mir\s+leid`;
const CURIOUS_WORDS = String.raw`интерес\p{L}*|думаю|может\s+быть|как\s+думаешь|hmm+|maybe|wonder\p{L}*|цікав\p{L}*|гадаю|interesting|i\s+think|what\s+do\s+you\s+think|i\s+wonder|interessant|ich\s+denke|vielleicht|was\s+meinst\s+du|spannend|ich\s+frage\s+mich`;
const HAPPY_WORDS = String.raw`рад\p{L}*|прият\p{L}*|хорош\p{L}*|люб\p{L}*|happy|glad|nice|радий|приєм\p{L}*|добре|glücklich|gluecklich|froh|zufrieden|freu\p{L}*\s+mich|freut\s+mich|freue\s+mich|schön|schoen|wunderbar|liebe\p{L}*|mag\s+ich`;

const NEGATION = String.raw`(?:nicht(?:\s+(?:wirklich|so|besonders|gerade|mehr|allzu))?|gar\s+nicht|überhaupt\s+nicht|keineswegs|kein\p{L}*|not(?:\s+(?:really|very|particularly|so|that))?|never|не(?:\s+(?:очень|дуже))?)\s+(?:sehr\s+|very\s+|really\s+)?`;
const NEGATED_HAPPY = `${NEGATION}(?:glücklich|gluecklich|froh|zufrieden|schön|schoen|wunderbar|happy|glad|nice|рад\\p{L}*|радий|весел\\p{L}*|щаслив\\p{L}*)`;
const NEGATED_EXCITED = `${NEGATION}(?:${EXCITED_WORDS})`;

type SpeakingEmotion = "neutral" | "happy" | "excited" | "curious" | "concerned";

function inferSpeakingMood(text: string): SpeakingEmotion {
  const normalized = text.toLocaleLowerCase();
  if (!normalized.trim()) return "neutral";

  const negatesJoy = containsToken(normalized, NEGATED_HAPPY);
  const negatesExcitement = containsToken(normalized, NEGATED_EXCITED);
  if (containsToken(normalized, CONCERNED_WORDS)) return "concerned";
  if ((!negatesExcitement && containsToken(normalized, EXCITED_WORDS)) || (!negatesJoy && !negatesExcitement && /!{2,}/u.test(normalized))) return "excited";
  if (containsToken(normalized, CURIOUS_WORDS) || normalized.includes("?")) return "curious";
  if (!negatesJoy && containsToken(normalized, HAPPY_WORDS)) return "happy";
  return "neutral";
}

function getSpeakingExpression(mood: ReturnType<typeof inferSpeakingMood>): FaceExpression {
  switch (mood) {
    case "excited":
      return makeExpression("excited", {
        leftEyeScaleX: 1.08, leftEyeScaleY: 0.9, rightEyeScaleX: 1.08, rightEyeScaleY: 0.9,
        mouth: "smile", mouthWidth: 38,
      }, { lift: 4, eyeSmile: 0.82 });
    case "curious":
      return makeExpression("curious", {
        leftEyeScaleX: 1.04, leftEyeScaleY: 1.04, rightEyeScaleX: 0.9, rightEyeScaleY: 0.9,
        leftEyeOffsetY: -3, rightEyeOffsetY: 3, mouth: "line", mouthWidth: 28,
      }, { headTilt: -9, lift: 2, leftLid: 0.04, rightLid: 0.18 });
    case "concerned":
      return makeExpression("concerned", {
        leftEyeScaleY: 0.83, rightEyeScaleY: 0.83,
        leftEyeOffsetY: 3, rightEyeOffsetY: 3,
        leftEyeRotation: -5, rightEyeRotation: 5, mouth: "frown", mouthWidth: 22,
      }, { headTilt: 3, lift: -1, leftLid: 0.16, rightLid: 0.16 });
    case "happy":
      return makeExpression("happy", {
        leftEyeScaleX: 1.03, leftEyeScaleY: 0.78, rightEyeScaleX: 1.03, rightEyeScaleY: 0.78,
        mouth: "smile", mouthWidth: 34,
      }, { lift: 3, eyeSmile: 0.76 });
    default:
      return makeExpression("neutral", {
        leftEyeScaleX: 1.02, leftEyeScaleY: 1, rightEyeScaleX: 1.02, rightEyeScaleY: 1,
        mouth: "line", mouthWidth: 28,
      });
  }
}

function getCharacterExpression(mood: CharacterMood): FaceExpression {
  switch (mood) {
    case "listening":
      // A small neutral attention accent; no smile or agreement signal.
      return makeExpression("listening", {
        leftEyeScaleX: 1.03, rightEyeScaleX: 1.03,
        leftEyeScaleY: 1.06, rightEyeScaleY: 1.02,
        leftEyeOffsetY: -1, rightEyeOffsetY: -1,
        mouth: "line", mouthWidth: 16,
      }, { headTilt: -2, lift: 1, leftLid: 0.02, rightLid: 0.04 });
    case "petted":
      return makeExpression("petted", {
        leftEyeScaleX: 1.04, rightEyeScaleX: 1.04,
        leftEyeScaleY: 0.38, rightEyeScaleY: 0.38, mouth: "smile", mouthWidth: 28,
      }, { headTilt: 2, eyeSmile: 0.9, leftLid: 0.08, rightLid: 0.08 });
    case "expectant":
      return makeExpression("expectant", {
        leftEyeScaleX: 1.02, rightEyeScaleX: 1.02,
        leftEyeScaleY: 1.08, rightEyeScaleY: 1.08, mouth: "line", mouthWidth: 16,
      }, { lift: 1, leftLid: 0.02, rightLid: 0.02 });
    case "repairing":
      return makeExpression("repairing", {
        leftEyeScaleX: 1.03, leftEyeScaleY: 1.08, rightEyeScaleX: 0.95, rightEyeScaleY: 0.92,
        leftEyeOffsetY: -2, rightEyeOffsetY: 1, mouth: "line", mouthWidth: 16,
      }, { headTilt: -3, leftLid: 0.02, rightLid: 0.13 });
    case "clarified":
      return makeExpression("clarified", {
        leftEyeScaleY: 0.98, rightEyeScaleY: 0.98, mouth: "smile", mouthWidth: 20,
      }, { eyeSmile: 0.25 });
    case "attentive":
      return makeExpression("attentive", {
        leftEyeScaleX: 1.05, leftEyeScaleY: 1.09, rightEyeScaleX: 1.05, rightEyeScaleY: 1.09,
        leftEyeOffsetY: -1, rightEyeOffsetY: -1,
      }, { lift: 1 });
    case "thoughtful":
      return makeExpression("thoughtful", {
        leftEyeScaleX: 1.02, leftEyeScaleY: 0.9, rightEyeScaleX: 0.94, rightEyeScaleY: 0.8,
        leftEyeOffsetY: -1, rightEyeOffsetY: 2, leftEyeRotation: -2, rightEyeRotation: 2,
        mouth: "line", mouthWidth: 18,
      }, { headTilt: -7, leftLid: 0.13, rightLid: 0.25 });
    case "curious":
      return makeExpression("curious", {
        leftEyeScaleX: 1.04, leftEyeScaleY: 1.08, rightEyeScaleX: 0.96, rightEyeScaleY: 0.96,
        leftEyeOffsetY: -1, rightEyeOffsetY: 1, leftEyeRotation: -1, rightEyeRotation: 1,
        mouth: "line", mouthWidth: 20,
      }, { headTilt: -5, lift: 1, leftLid: 0.06, rightLid: 0.1 });
    case "startled":
      return makeExpression("startled", {
        leftEyeScaleX: 1.14, leftEyeScaleY: 1.38, rightEyeScaleX: 1.14, rightEyeScaleY: 1.38,
        leftEyeOffsetY: -2, rightEyeOffsetY: -2, mouth: "dot", mouthWidth: 11,
      }, { lift: 5 });
    case "pleased":
      return makeExpression("pleased", {
        leftEyeScaleX: 1.04, leftEyeScaleY: 0.68, rightEyeScaleX: 1.04, rightEyeScaleY: 0.68,
        leftEyeOffsetY: 2, rightEyeOffsetY: 2, mouth: "smile", mouthWidth: 36,
      }, { lift: 2, eyeSmile: 1 });
    case "annoyed":
      return makeExpression("annoyed", {
        leftEyeScaleX: 1.02, leftEyeScaleY: 0.58, rightEyeScaleX: 0.92, rightEyeScaleY: 0.52,
        leftEyeOffsetY: 4, rightEyeOffsetY: 5, leftEyeRotation: -5, rightEyeRotation: 5,
        mouth: "line", mouthWidth: 24,
      }, { headTilt: 4, lift: -2, leftLid: 0.48, rightLid: 0.55 });
    case "angry":
      return makeExpression("angry", {
        leftEyeScaleX: 1.06, leftEyeScaleY: 0.48, rightEyeScaleX: 1.06, rightEyeScaleY: 0.48,
        leftEyeOffsetY: 5, rightEyeOffsetY: 5, leftEyeRotation: 10, rightEyeRotation: -10,
        mouth: "line", mouthWidth: 34,
      }, { lift: -2, leftLid: 0.63, rightLid: 0.63 });
    case "victory":
      return makeExpression("victory", {
        leftEyeScaleX: 1.12, leftEyeScaleY: 0.74, rightEyeScaleX: 1.12, rightEyeScaleY: 0.74,
        leftEyeOffsetY: -2, rightEyeOffsetY: -2, leftEyeRotation: -3, rightEyeRotation: 3,
        mouth: "smile", mouthWidth: 40,
      }, { headTilt: 3, lift: 6, eyeSmile: 0.88 });
  }
}

function getVoiceStateExpression(voiceState: VoiceState): FaceExpression {
  switch (voiceState) {
    case "attention":
      return makeExpression("attentive", {
        leftEyeScaleX: 1.08, leftEyeScaleY: 1.08, rightEyeScaleX: 1.08, rightEyeScaleY: 1.08,
      }, { lift: 1 });
    case "listening":
      return makeExpression("attentive", {
        leftEyeScaleX: 1.06, leftEyeScaleY: 1.05, rightEyeScaleX: 1.06, rightEyeScaleY: 1.05,
        leftEyeOffsetY: -2, rightEyeOffsetY: -2, mouth: "line", mouthWidth: 20,
      }, { lift: 1 });
    case "processing":
      return makeExpression("thoughtful", {
        leftEyeScaleX: 0.98, leftEyeScaleY: 0.78, rightEyeScaleX: 0.94, rightEyeScaleY: 0.72,
        leftEyeOffsetY: 2, rightEyeOffsetY: 3,
      }, { headTilt: -5, leftLid: 0.14, rightLid: 0.2 });
    case "verifying":
      return makeExpression("thoughtful", {
        leftEyeScaleY: 0.9, rightEyeScaleY: 0.84, mouth: "line", mouthWidth: 18,
      }, { leftLid: 0.1, rightLid: 0.15 });
    case "sleeping":
      return makeExpression("sleeping", {
        leftEyeScaleX: 1.08, leftEyeScaleY: 0.12, rightEyeScaleX: 1.08, rightEyeScaleY: 0.12,
      }, { headTilt: -2, leftLid: 1, rightLid: 1 });
    default:
      return makeExpression("neutral");
  }
}

/**
 * Resolve the face independently of React so the geometry and text inference
 * stay deterministic. Callers decide when a character reaction may override
 * the active voice state, then pass either that mood or null here.
 */
export function resolveFaceExpression(
  voiceState: VoiceState,
  streamingText: string,
  characterMood: CharacterMood | null
): FaceExpression {
  if (characterMood) return getCharacterExpression(characterMood);
  if (voiceState === "speaking") return getSpeakingExpression(inferSpeakingMood(streamingText));
  return getVoiceStateExpression(voiceState);
}

export function getCharacterActionExpression(action: CharacterActionFrame): FaceExpression {
  const scene = getCharacterScene(action.kind);
  const target = () => scene.id === "sadness" ? makeExpression("sad", {
    leftEyeScaleX: 0.94, rightEyeScaleX: 0.94, leftEyeScaleY: 0.78, rightEyeScaleY: 0.78,
    leftEyeRotation: -10, rightEyeRotation: 10, leftEyeOffsetY: 5, rightEyeOffsetY: 5,
    mouth: "frown", mouthWidth: 30,
  }, { lift: -3, leftLid: 0.25, rightLid: 0.25 })
    : scene.mood === "concerned" ? getSpeakingExpression("concerned") : getCharacterExpression(scene.mood);
  // A sad or frustrated situation never turns into a generic celebration.
  if (action.phase === "enjoy" || action.phase === "put-away") return target();
  if (action.phase === "reveal") return ["concerned", "angry", "annoyed"].includes(scene.mood) ? target() : getCharacterExpression("curious");
  if (scene.motion === "read") return makeExpression("reading", {
    leftEyeScaleY: 0.82, rightEyeScaleY: 0.82, leftEyeOffsetY: 5, rightEyeOffsetY: 5,
    mouth: "line", mouthWidth: 16,
  }, { leftLid: 0.12, rightLid: 0.12 });
  if (scene.motion === "bite") return makeExpression("snacking", {
    leftEyeScaleY: 0.65, rightEyeScaleY: 0.65, mouth: "dot", mouthWidth: 9,
  }, { headTilt: 2, eyeSmile: 0.6 });
  if (scene.motion === "sip" || scene.motion === "coffee") return makeExpression("drinking", {
    leftEyeScaleY: 0.72, rightEyeScaleY: 0.72, mouth: "dot", mouthWidth: 9,
  }, { headTilt: scene.motion === "coffee" ? -3 : 0, eyeSmile: 0.45, leftLid: 0.08, rightLid: 0.08 });
  return target();
}

export type FacePresentationSource = "sleep" | "speech" | "pipeline" | "action" | "reaction" | "behavior" | "input" | "ready" | "voice";

export type FacePresentationInput = {
  robotSleeping: boolean;
  voiceState: VoiceState;
  assistantSpeaking?: boolean;
  streamingText: string;
  characterMood: CharacterMood | null;
  behaviorMood: CharacterMood | null;
  /** Brief feedback from a committed local correction; never a confidence guess. */
  feedbackMood?: "repairing" | "clarified" | null;
  action?: CharacterActionFrame | null;
  /** Fresh input energy only; never a recognized meaning or confirmation. */
  inputAttention?: boolean;
};

export type FacePresentation = {
  expression: FaceExpression;
  source: FacePresentationSource;
  characterReactionVisible: boolean;
};

/**
 * Resolve which source owns the face at the current moment. Hardware sleep,
 * actual speech, and pipeline work outrank transient character reactions so
 * stale reactions cannot mask the robot's live state.
 */
export function resolveFacePresentation(input: FacePresentationInput): FacePresentation {
  const { robotSleeping, voiceState, streamingText, characterMood, behaviorMood } = input;

  if (robotSleeping) {
    return {
      expression: getVoiceStateExpression("sleeping"),
      source: "sleep",
      characterReactionVisible: false,
    };
  }

  if (input.assistantSpeaking === true || voiceState === "speaking") {
    return {
      expression: getSpeakingExpression(inferSpeakingMood(streamingText)),
      source: "speech",
      characterReactionVisible: false,
    };
  }

  if (input.feedbackMood) {
    return { expression: getCharacterExpression(input.feedbackMood), source: "behavior", characterReactionVisible: false };
  }

  if (voiceState === "processing" || voiceState === "verifying") {
    return {
      expression: getVoiceStateExpression(voiceState),
      source: "pipeline",
      characterReactionVisible: false,
    };
  }

  // In awake idle, attention, and listening, short-lived reactions can be
  // shown. The UI owns their lifetime; this policy only selects a source.
  if (input.action) return { expression: getCharacterActionExpression(input.action), source: "action", characterReactionVisible: false };

  if (characterMood) {
    return {
      expression: getCharacterExpression(characterMood),
      source: "reaction",
      characterReactionVisible: true,
    };
  }

  if (behaviorMood) {
    return {
      expression: getCharacterExpression(behaviorMood),
      source: "behavior",
      characterReactionVisible: false,
    };
  }

  if (voiceState === "listening" && input.inputAttention) {
    return { expression: getCharacterExpression("listening"), source: "input", characterReactionVisible: false };
  }

  if (voiceState === "sleeping") {
    // Voice-state sleeping can mean awake but waiting. Only robotSleeping
    // drives the closed-eye sleep face in the presentation policy.
    return {
      expression: makeExpression("neutral"),
      source: "ready",
      characterReactionVisible: false,
    };
  }

  return {
    expression: getVoiceStateExpression(voiceState),
    source: "voice",
    characterReactionVisible: false,
  };
}
