import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";

// One intent per reply: what the model says and how the face and head move.
const load = createTypeScriptTreeLoader();
const definitions = load("src/voice/robot-capability-tool-definitions.ts");
const face = load("src/character/face-expression.ts");
const { createRobotBodyStateStore } = load("src/robot-mind/body-state.ts");
const expression = load("src/robot-mind/expression.ts");

// --- Vocabulary: intent -> face and head ----------------------------------
const expectedFace = {
  neutral: "neutral", happy: "happy", playful: "excited", agreeing: "clarified", curious: "curious",
  thinking: "thoughtful", surprised: "startled", sad: "sad", calm: "neutral",
};
const expectedHead = {
  neutral: null, sad: null, calm: null,
  happy: { gesture: "speaking_soft", at: "speech_start" }, playful: { gesture: "happy_bob", at: "speech_start" },
  agreeing: { gesture: "nod", at: "speech_start" }, thinking: { gesture: "thinking", at: "speech_start" },
  surprised: { gesture: "curious", at: "speech_start" }, curious: { gesture: "curious", at: "speech_end" },
};
for (const intent of definitions.ROBOT_EXPRESSION_INTENTS) {
  assert.equal(face.getExpressionIntentFace(intent).emotion, expectedFace[intent], `${intent} face`);
  assert.deepEqual(definitions.ROBOT_EXPRESSION_VOCABULARY[intent].head, expectedHead[intent], `${intent} head`);
}
assert.deepEqual(Object.keys(expectedFace).sort(), [...definitions.ROBOT_EXPRESSION_INTENTS].sort());
for (const quiet of ["sad", "calm"]) {
  const shape = face.getExpressionIntentFace(quiet);
  assert.equal(shape.eyeSmile, 0, `${quiet} never smiles`);
  assert.notEqual(shape.mouth, "smile");
  assert.ok(shape.lift <= 0, `${quiet} never bounces up`);
}

// The model's intent replaces the text-based speaking face for its reply only.
const base = { robotSleeping: false, voiceState: "speaking", streamingText: "Super, das ist toll!!", characterMood: null, behaviorMood: null, assistantSpeaking: true };
assert.equal(face.resolveFacePresentation(base).expression.emotion, "excited", "fallback: the heard words choose the face");
assert.equal(face.resolveFacePresentation({ ...base, speechIntent: null }).expression.emotion, "excited");
const owned = face.resolveFacePresentation({ ...base, speechIntent: "calm" });
assert.equal(owned.source, "speech");
assert.deepEqual(owned.expression, face.getExpressionIntentFace("calm"), "a model intent suppresses the text expression");
const listening = face.resolveFacePresentation({ ...base, voiceState: "listening", assistantSpeaking: false, speechIntent: "playful" });
assert.notEqual(listening.expression.emotion, "excited", "an intent never shows outside its spoken reply");
assert.equal(face.resolveFacePresentation({ ...base, robotSleeping: true, speechIntent: "happy" }).source, "sleep");
assert.equal(face.inferSpeechTextIntent("Super, das ist toll!!"), "playful");
assert.equal(face.inferSpeechTextIntent("Das tut mir leid."), "calm");
assert.equal(face.inferSpeechTextIntent("Was meinst du?"), "curious");

// --- Conductor ------------------------------------------------------------
function harness({ canMove = true } = {}) {
  const clock = new VirtualClock();
  const bodyState = createRobotBodyStateStore(() => clock.now);
  const conductor = expression.createRobotExpressionConductor({ bodyState, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout });
  const heads = [];
  const h = { clock, bodyState, conductor, heads, canMove };
  conductor.configure({
    canMoveHead: () => h.canMove,
    runHead(gesture, isCurrent) { heads.push({ gesture, isCurrent, at: clock.now }); return Promise.resolve({ completed: true }); },
  });
  h.reply = (id = "resp-1", current = () => true) => ({ sessionId: "voice-1", replyId: id, isCurrent: current });
  h.intent = () => bodyState.getState().expression;
  return h;
}

{
  // A nod on agreement starts with the speech, once, and the reply owns its reaction.
  const h = harness();
  assert.equal(h.conductor.ownsReplyReaction(), false, "nothing is claimed without a model choice");
  assert.equal(h.conductor.expressFromModel("agreeing", h.reply()), true);
  assert.deepEqual([h.intent().intent, h.intent().source], ["agreeing", "model"]);
  assert.equal(h.heads.length, 0, "the head waits for the audio");
  assert.equal(h.conductor.ownsReplyReaction(), true);
  h.conductor.speechStarted();
  h.conductor.speechStarted();
  assert.deepEqual(h.heads.map(({ gesture }) => gesture), ["nod"], "one gesture per reply");
  assert.equal(h.heads[0].isCurrent(), true);
  h.conductor.expressFromModel("happy", h.reply("resp-1b"));
  assert.equal(h.intent().intent, "happy", "a later call in the same reply changes only the face");
  assert.equal(h.heads.length, 1);
  h.conductor.endReply(true, "assistant-end");
  assert.deepEqual([h.intent().intent, h.intent().source], ["neutral", "rest"], "the face returns to neutral when the reply ends");
  assert.equal(h.heads[0].isCurrent(), false, "a start gesture ends with its reply");
  assert.equal(h.conductor.ownsReplyReaction(), true, "the Decisions reaction to this reply stays suppressed");
  await h.clock.advanceTo(h.clock.now + expression.ROBOT_EXPRESSION_REACTION_CLAIM_MS + 1);
  assert.equal(h.conductor.ownsReplyReaction(), false, "the claim covers this reply only");

  // The next reply without a model choice keeps the fallback.
  h.conductor.speechStarted();
  assert.equal(h.conductor.ownsReplyReaction(), false);
  h.conductor.noteSpeechTextIntent("curious");
  assert.deepEqual([h.intent().intent, h.intent().source], ["curious", "speech_text"]);
  h.conductor.endReply(true, "speech-ended");
  assert.equal(h.heads.length, 1, "the fallback adds no head gesture of its own");
  assert.equal(h.intent().source, "rest");
}

{
  // Expression arriving after the audio started still gets its gesture at once.
  const h = harness();
  h.conductor.speechStarted();
  h.conductor.expressFromModel("playful", h.reply());
  assert.deepEqual(h.heads.map(({ gesture }) => gesture), ["happy_bob"]);
  h.conductor.noteSpeechTextIntent("calm");
  assert.equal(h.intent().intent, "playful", "the text fallback never overrides the model");
}

{
  // A question: the curious look comes as LOOI hands the turn back, only if it was heard.
  const h = harness();
  h.conductor.expressFromModel("curious", h.reply());
  h.conductor.speechStarted();
  assert.equal(h.heads.length, 0);
  h.conductor.endReply(true, "assistant-end");
  assert.deepEqual(h.heads.map(({ gesture }) => gesture), ["curious"]);
  assert.equal(h.heads[0].isCurrent(), true, "the closing look survives the reply end");
  h.conductor.interrupt("user-speech-start");
  assert.equal(h.heads[0].isCurrent(), false, "the user speaking cancels the closing look");

  const cut = harness();
  cut.conductor.expressFromModel("curious", cut.reply());
  cut.conductor.speechStarted();
  cut.conductor.interrupt("user-speech-start");
  assert.equal(cut.heads.length, 0, "an interrupted question adds no closing look");
}

{
  // Interruption resets face, gesture and claim.
  const h = harness();
  h.conductor.expressFromModel("thinking", h.reply());
  h.conductor.speechStarted();
  const gesture = h.heads[0];
  h.conductor.interrupt("user-speech-start");
  assert.equal(gesture.isCurrent(), false, "a running gesture stops when the user interrupts");
  assert.deepEqual([h.intent().intent, h.intent().source], ["neutral", "rest"]);
  assert.equal(h.conductor.ownsReplyReaction(), false, "an interrupted reply claims no reaction");
  assert.equal(h.conductor.getModelIntent(), null);
}

{
  // Explicit gestures and motion gates win; calm and sad never move the head.
  const explicit = harness();
  explicit.conductor.notePhysicalAction();
  explicit.conductor.expressFromModel("agreeing", explicit.reply());
  explicit.conductor.speechStarted();
  assert.equal(explicit.heads.length, 0, "a requested nod in this reply is not doubled");
  assert.equal(explicit.intent().intent, "agreeing", "the face still follows the intent");

  const later = harness();
  later.conductor.notePhysicalAction();
  await later.clock.advanceTo(later.clock.now + expression.ROBOT_EXPRESSION_PHYSICAL_ACTION_WINDOW_MS + 1);
  later.conductor.expressFromModel("agreeing", later.reply());
  later.conductor.speechStarted();
  assert.equal(later.heads.length, 1, "an old movement does not silence a later reply");

  const gated = harness({ canMove: false });
  gated.conductor.expressFromModel("happy", gated.reply());
  gated.conductor.speechStarted();
  assert.equal(gated.heads.length, 0, "no head when the robot may not move");

  for (const intent of ["sad", "calm", "neutral"]) {
    const quiet = harness();
    quiet.conductor.expressFromModel(intent, quiet.reply());
    quiet.conductor.speechStarted();
    quiet.conductor.endReply(true, "assistant-end");
    assert.equal(quiet.heads.length, 0, `${intent} stays still`);
  }

  const stale = harness();
  assert.equal(stale.conductor.expressFromModel("happy", stale.reply("old", () => false)), false);
  assert.equal(stale.intent().source, undefined, "a stale reply changes nothing");
}

{
  // A face whose speech never comes is dropped.
  const h = harness();
  h.conductor.expressFromModel("happy", h.reply());
  await h.clock.advanceTo(h.clock.now + expression.ROBOT_EXPRESSION_UNSPOKEN_TIMEOUT_MS + 1);
  assert.deepEqual([h.intent().intent, h.intent().source], ["neutral", "rest"]);
  assert.equal(h.conductor.ownsReplyReaction(), false);
}

// --- Runtime wiring: reply lifecycle, head priority and the Decisions gate --
{
  const bodyState = createRobotBodyStateStore(() => 1_000);
  const conductor = expression.createRobotExpressionConductor({ bodyState });
  let behaviorListener = null;
  let conversationListener = null;
  let cueGate = null;
  const headCalls = [];
  const holds = [];
  const robot = { connected: true, motionActive: false };
  const user = { robotSleeping: false, preferences: { ambientMotionLevel: "subtle" } };
  const conversation = { isSpeaking: false, isUserSpeaking: false, heardSpeechText: null };
  const runtime = loadTypeScript("src/robot-mind/expression-runtime.ts", {
    "react-native": { AppState: { currentState: "active" } },
    "./expression": { robotExpressionConductor: conductor },
    "../behavior/behavior-events": { subscribeBehaviorEvents(listener) { behaviorListener = listener; return () => { behaviorListener = null; }; } },
    "../behavior/behavior-runtime": { configureBehaviorCueGate(gate) { cueGate = gate; } },
    "../character/face-expression": face,
    "../core/ambient-motion": { holdAmbientHeadMotionFor(ms, source) { holds.push([ms, source]); } },
    "../core/main-screen-presence": { isMainScreenFocused: () => true },
    "../device-tools/looi-robot": {
      getLooiRobotRuntimeState: () => robot,
      async performLooiBehaviorHeadGesture(gesture, isCurrent) { headCalls.push({ gesture, current: isCurrent() }); return { completed: true }; },
    },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../store/conversation": { useConversationStore: {
      getState: () => conversation,
      subscribe(listener) { conversationListener = listener; return () => { conversationListener = null; }; },
    } },
    "../store/user": { useUserStore: { getState: () => user } },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
  });
  const setConversation = (patch) => {
    const previous = { ...conversation };
    Object.assign(conversation, patch);
    conversationListener?.({ ...conversation }, previous);
  };
  const uninstall = runtime.installRobotExpressionRuntime();
  assert.equal(typeof cueGate, "function", "the runtime registers the Decisions cue gate");
  const cue = { id: "cue-1", gesture: "nod", presentationOnly: false };
  assert.equal(cueGate(cue), true, "without a model choice the Decisions cue still runs");

  conductor.expressFromModel("agreeing", { sessionId: "s", replyId: "r1", isCurrent: () => true });
  assert.equal(cueGate(cue), false, "the model's reply owns its reaction");
  behaviorListener({ type: "assistant-start", sessionId: "s" });
  await Promise.resolve();
  assert.deepEqual(headCalls, [{ gesture: "nod", current: true }], "the nod uses the shared head writer at behavior priority");
  assert.deepEqual(holds, [[1_500, "model-expression"]], "ambient head motion yields during the gesture");
  behaviorListener({ type: "user-speech-start", sessionId: "s" });
  assert.deepEqual([bodyState.getState().expression.intent, bodyState.getState().expression.source], ["neutral", "rest"], "user speech resets the expression");
  assert.equal(cueGate(cue), true, "and releases the claim");

  // Turn-based speech: the speaking flag starts and ends the reply.
  conductor.expressFromModel("happy", { sessionId: "s", replyId: "budget-1", isCurrent: () => true });
  setConversation({ isSpeaking: true, heardSpeechText: "Hallo!" });
  assert.equal(headCalls.at(-1).gesture, "speaking_soft");
  assert.equal(bodyState.getState().expression.intent, "happy");
  setConversation({ isSpeaking: false, heardSpeechText: null });
  assert.equal(bodyState.getState().expression.source, "rest");

  // The fallback reports what the text-based face shows.
  setConversation({ isSpeaking: true, heardSpeechText: "Das tut mir leid." });
  assert.deepEqual([bodyState.getState().expression.intent, bodyState.getState().expression.source], ["calm", "speech_text"]);
  setConversation({ isSpeaking: false, heardSpeechText: null });

  // A disconnected robot or a sleeping one gets the face only.
  robot.connected = false;
  const before = headCalls.length;
  conductor.expressFromModel("playful", { sessionId: "s", replyId: "r2", isCurrent: () => true });
  behaviorListener({ type: "assistant-start", sessionId: "s" });
  assert.equal(headCalls.length, before);
  behaviorListener({ type: "interrupt", reason: "explicit-stop" });
  assert.equal(bodyState.getState().expression.source, "rest");

  uninstall();
  assert.equal(cueGate, null, "uninstall removes the gate");
  assert.equal(behaviorListener, null);
}

console.log("Robot expression: vocabulary, single owner per reply, fallback and lifecycle PASS");
