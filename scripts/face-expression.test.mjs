import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const loadCharacterModule = createTypeScriptTreeLoader();
import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { resolveFaceExpression, resolveFacePresentation } = loadCharacterModule("src/character/face-expression.ts");

function speaking(text) {
  return resolveFaceExpression("speaking", text, null);
}

function assertExpressionInBounds(expression, label) {
  const finiteFields = [
    "leftEyeScaleX", "leftEyeScaleY", "rightEyeScaleX", "rightEyeScaleY",
    "leftEyeOffsetY", "rightEyeOffsetY", "leftEyeRotation", "rightEyeRotation",
    "mouthWidth", "headTilt", "lift", "eyeSmile", "leftLid", "rightLid",
  ];
  for (const field of finiteFields) {
    assert.equal(Number.isFinite(expression[field]), true, `${label}.${field} is finite`);
  }
  for (const field of ["leftEyeScaleX", "rightEyeScaleX"]) {
    assert.ok(expression[field] >= 0.5 && expression[field] <= 1.5, `${label}.${field} stays readable`);
  }
  for (const field of ["leftEyeScaleY", "rightEyeScaleY"]) {
    assert.ok(expression[field] >= 0.1 && expression[field] <= 1.5, `${label}.${field} stays readable`);
  }
  for (const field of ["leftEyeOffsetY", "rightEyeOffsetY"]) {
    assert.ok(Math.abs(expression[field]) <= 8, `${label}.${field} stays inside the face`);
  }
  for (const field of ["leftEyeRotation", "rightEyeRotation", "headTilt"]) {
    assert.ok(Math.abs(expression[field]) <= 15, `${label}.${field} stays restrained`);
  }
  assert.ok(expression.mouthWidth >= 0 && expression.mouthWidth <= 50, `${label}.mouthWidth stays bounded`);
  assert.ok(expression.lift >= -8 && expression.lift <= 8, `${label}.lift stays bounded`);
  for (const field of ["eyeSmile", "leftLid", "rightLid"]) {
    assert.ok(expression[field] >= 0 && expression[field] <= 1, `${label}.${field} uses the unit interval`);
  }
  assert.ok(["none", "line", "smile", "frown", "dot"].includes(expression.mouth), `${label}.mouth is supported`);
}

// All reaction moods map to their named, stable expression states.
const characterMoods = [
  "listening", "attentive", "thoughtful", "curious", "startled", "pleased", "annoyed", "angry", "victory",
];
for (const mood of characterMoods) {
  const expression = resolveFaceExpression("listening", "", mood);
  assert.equal(expression.emotion, mood, `${mood} keeps its semantic expression`);
  assertExpressionInBounds(expression, mood);
}

const attentive = resolveFaceExpression("attention", "", null);
const listeningAccent = resolveFaceExpression("listening", "", "listening");
assert.equal(listeningAccent.mouth, "line", "the listening accent conveys attention without a smile or a yes");
assert.ok(Math.abs(listeningAccent.headTilt) <= 2 && listeningAccent.eyeSmile === 0);
assert.equal(resolveFacePresentation({ robotSleeping: false, voiceState: "speaking", streamingText: "", characterMood: null, behaviorMood: "listening" }).source, "speech", "audible output owns the face before a listening accent");
assert.equal(resolveFacePresentation({ robotSleeping: false, voiceState: "processing", streamingText: "", characterMood: null, behaviorMood: "listening" }).source, "pipeline", "processing owns the face before a listening accent");
assert.equal(attentive.emotion, "attentive");
const attentiveReaction = resolveFaceExpression("listening", "", "attentive");
assert.equal(attentiveReaction.leftLid, 0, "the attentive expression keeps the full open-eye outline");
assert.equal(attentiveReaction.rightLid, 0, "the attentive expression must not crop the eye at the top");
const sleeping = resolveFaceExpression("sleeping", "", null);
assert.equal(sleeping.emotion, "sleeping");
assert.equal(sleeping.leftLid, 1);
assert.equal(sleeping.rightLid, 1);
assertExpressionInBounds(sleeping, "sleeping");

const happy = speaking("Ich freue mich, dich zu sehen!");
assert.equal(happy.emotion, "happy");
assert.equal(happy.mouth, "smile");
assert.ok(happy.eyeSmile >= 0.7, "joy closes the lower eyes into crescents");
assertExpressionInBounds(happy, "happy speaking");

const curious = speaking("Was meinst du dazu?");
assert.equal(curious.emotion, "curious");
assert.notEqual(curious.leftEyeScaleY, curious.rightEyeScaleY);
assert.ok(Math.abs(curious.headTilt) >= 6, "curiosity tilts the head");
assertExpressionInBounds(curious, "curious speaking");

const surprised = resolveFaceExpression("listening", "", "startled");
assert.equal(surprised.emotion, "startled");
assert.equal(surprised.mouth, "dot");
assert.ok(surprised.leftEyeScaleY >= 1.3 && surprised.rightEyeScaleY >= 1.3, "surprise opens tall eyes");

const curiousReaction = resolveFaceExpression("listening", "", "curious");
assert.equal(curiousReaction.emotion, "curious");
assert.equal(curiousReaction.mouth, "line", "curiosity uses a small thoughtful mouth, not the startled dot");
assert.ok(Math.abs(curiousReaction.leftEyeScaleY - curiousReaction.rightEyeScaleY) > 0.08, "curiosity has a gentle eye asymmetry");
assert.ok(Math.abs(curiousReaction.headTilt) >= 4 && Math.abs(curiousReaction.headTilt) <= 8, "curiosity uses a small head tilt");
assert.notEqual(curiousReaction.leftEyeScaleY, surprised.leftEyeScaleY, "curiosity is distinct from wide-eyed surprise");
assertExpressionInBounds(curiousReaction, "curious reaction");

const angry = resolveFaceExpression("listening", "", "angry");
assert.equal(angry.emotion, "angry");
assert.ok(angry.leftEyeRotation * angry.rightEyeRotation < 0, "anger slants the eyes toward the center");
assert.ok(angry.leftLid > 0.5 && angry.rightLid > 0.5, "anger lowers the upper lids");

// German words are matched as complete Unicode words, not as arbitrary
// substrings, and a negated positive phrase does not become happy or concerned.
assert.equal(speaking("Das ist leider schade.").emotion, "concerned");
assert.equal(speaking("Die Kleider sehen schön aus.").emotion, "happy", "Kleider must not match leider");
assert.equal(speaking("Ich bin nicht glücklich.").emotion, "neutral");
assert.equal(speaking("Ich bin gar nicht wirklich froh!!").emotion, "neutral");
assert.equal(speaking("Das ist nicht schön.").emotion, "neutral", "a negated positive word cannot create a smile");
assert.equal(speaking("Das war nicht wirklich toll!!").emotion, "neutral", "negated enthusiasm and punctuation do not create excitement");
assert.equal(speaking("That is not great.").emotion, "neutral");
assert.equal(speaking("Это не супер.").emotion, "neutral");
assert.equal(speaking("Це не дуже чудово.").emotion, "neutral");
assert.equal(speaking("Das ist nicht meine Frage.").emotion, "neutral", "generic nicht is not a negative mood cue");
assert.equal(speaking("Das ist fantastisch!").emotion, "excited");
assert.equal(speaking("Super, das hat geklappt!").emotion, "excited");
assert.equal(speaking("Die Supernova ist weit entfernt.").emotion, "neutral");
assert.equal(speaking("Das tut mir leid.").emotion, "concerned");
assert.equal(speaking("Vielleicht klappt es.").emotion, "curious");

// Preserve the existing English, Russian, and Ukrainian phrase families.
assert.equal(speaking("Wow, that's awesome!").emotion, "excited");
assert.equal(speaking("Мне жаль, это неприятно.").emotion, "concerned");
assert.equal(speaking("Це цікаво, maybe?").emotion, "curious");
assert.equal(speaking("Я радий, це чудово.").emotion, "excited");
assert.equal(speaking("I'm glad you liked it.").emotion, "happy");

// Character reactions are already caller-filtered, so a provided reaction
// consistently resolves even if the current voice state is otherwise active.
assert.equal(resolveFaceExpression("sleeping", "", "victory").emotion, "victory");

function presentation(overrides = {}) {
  return resolveFacePresentation({
    robotSleeping: false,
    voiceState: "sleeping",
    streamingText: "",
    characterMood: null,
    behaviorMood: null,
    ...overrides,
  });
}

const deepSleep = presentation({ robotSleeping: true, voiceState: "listening", characterMood: "victory", behaviorMood: "attentive" });
assert.equal(deepSleep.expression.emotion, "sleeping", "true robot sleep always closes the face");
assert.equal(deepSleep.source, "sleep");
assert.equal(deepSleep.characterReactionVisible, false);

const awakeReady = presentation();
assert.equal(awakeReady.expression.emotion, "neutral", "awake voice-state sleeping is a quiet ready face");
assert.equal(awakeReady.expression.leftEyeScaleY, 1, "ready eyes remain open");
assert.equal(awakeReady.expression.leftLid, 0, "ready face has no sleeping lid");
assert.equal(awakeReady.source, "ready");

for (const staleMood of ["annoyed", "victory"]) {
  const suppressedAfterSleep = presentation({ robotSleeping: true, characterMood: staleMood });
  assert.equal(suppressedAfterSleep.source, "sleep", `${staleMood} cannot outlive the hardware sleep priority`);
  assert.equal(suppressedAfterSleep.characterReactionVisible, false);
}

const suppressedBySpeech = presentation({
  voiceState: "listening",
  assistantSpeaking: true,
  streamingText: "Wow, that's awesome!",
  characterMood: "annoyed",
  behaviorMood: "attentive",
});
assert.equal(suppressedBySpeech.source, "speech", "actual assistant speech outranks stale reactions and behavior");
assert.equal(suppressedBySpeech.expression.emotion, "excited");
assert.equal(suppressedBySpeech.characterReactionVisible, false);

const speakingVoiceState = presentation({ voiceState: "speaking", behaviorMood: "attentive" });
assert.equal(speakingVoiceState.source, "speech", "speaking voice state keeps the existing compatibility priority");

for (const pipelineState of ["processing", "verifying"]) {
  const pipeline = presentation({ voiceState: pipelineState, characterMood: "angry", behaviorMood: "victory" });
  assert.equal(pipeline.source, "pipeline", `${pipelineState} owns the face while work is in progress`);
  assert.equal(pipeline.characterReactionVisible, false);
}

const attentionCharacterReaction = presentation({ voiceState: "attention", characterMood: "curious", behaviorMood: "victory" });
assert.equal(attentionCharacterReaction.source, "reaction", "character reaction leads behavior during attention");
assert.equal(attentionCharacterReaction.expression.emotion, "curious");
assert.equal(attentionCharacterReaction.characterReactionVisible, true);

const listeningReaction = presentation({ voiceState: "listening", characterMood: "startled", behaviorMood: "pleased" });
assert.equal(listeningReaction.source, "reaction", "character reaction leads behavior during listening");

const behaviorWhileAttentive = presentation({ voiceState: "attention", behaviorMood: "thoughtful" });
assert.equal(behaviorWhileAttentive.source, "behavior", "behavior mood wins over ordinary attention face");
assert.equal(behaviorWhileAttentive.characterReactionVisible, false);

const idleReaction = presentation({ characterMood: "pleased" });
assert.equal(idleReaction.source, "reaction", "an unexpired transient reaction can appear on the awake ready face");

// Expiry is represented by the caller passing null on the next render; the
// pure policy immediately re-evaluates the live voice and behavior state.
const afterReactionExpiry = presentation({ voiceState: "attention", characterMood: null, behaviorMood: "thoughtful" });
assert.equal(afterReactionExpiry.source, "behavior");
assert.equal(afterReactionExpiry.expression.emotion, "thoughtful");

assertExpressionInBounds(deepSleep.expression, "presentation sleep");
assertExpressionInBounds(awakeReady.expression, "presentation ready");
assertExpressionInBounds(attentionCharacterReaction.expression, "presentation reaction");

for (const state of ["sleeping", "attention", "verifying", "listening", "processing", "speaking"]) {
  for (const text of ["", "Great!", "Hm, perhaps?", "Nicht glücklich."]) {
    assertExpressionInBounds(resolveFaceExpression(state, text, null), `${state} / ${text || "empty"}`);
  }
}

console.log("Face expression behavior tests passed");
