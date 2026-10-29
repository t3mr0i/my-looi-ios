import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function store(initial) {
  let state = initial;
  const listeners = new Set();
  const use = (select = (s) => s) => select(state);
  use.getState = () => state;
  use.setState = (patch) => { const previous = state; state = { ...state, ...patch }; for (const listener of listeners) listener(state, previous); };
  use.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return use;
}
let now = 1_000;
class ClockDate extends Date { static now() { return Date.UTC(2026, 9, 26) + now; } }
const events = loadTypeScript("src/behavior/behavior-events.ts");
const user = store({ preferences: { language: "en", listeningLanguage: "en", ambientMotionLevel: "off", cameraAttentionEnabled: true, robotName: "LOOI" }, robotSleeping: false });
const conversation = store({ clearInputAttention() {}, isUserSpeaking: false, isSpeaking: false, isProcessing: false });
let poll;
let signalListener = null;
let focused = true;
let support = true;
let acceptResponse = true;
const responses = [];
const nativeLeases = [];
const appState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
const engine = createTypeScriptTreeLoader()("src/behavior/behavior-engine.ts");
const storage = new Map();
const runtime = loadTypeScript("src/behavior/behavior-runtime.ts", {
  "react-native": { AppState: appState },
  zustand: { create: (init) => store(init()) },
  "react-native-mmkv": { createMMKV: () => ({ getString: (key) => storage.get(key), set: (key, value) => storage.set(key, value) }) },
  "./behavior-engine": engine,
  "./game-face-feedback": loadTypeScript("src/behavior/game-face-feedback.ts"),
  "./listening-opportunity": loadTypeScript("src/behavior/listening-opportunity.ts"),
  "./behavior-face-feedback": loadTypeScript("src/behavior/behavior-face-feedback.ts"),
  "./behavior-expression": loadTypeScript("src/behavior/behavior-expression.ts"),
  "./behavior-events": events,
  "../core/interaction-start-signal": loadTypeScript("src/core/interaction-start-signal.ts"),
  "../memory/memory-mutation": loadTypeScript("src/memory/memory-mutation.ts"),
  "../memory/memory-service": { stopConversationForMemoryChange: async () => {} },
  "../openai/decisions": { requestDecisions: async (input) => ({
    answers: input.questions.map((q) => ({ type: "choice", name: q.name, choice: q.name === "visual" ? "use_view" : q.name === "attention" ? "keep_target" : "wait", confidence: 0.99 })),
    usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-scene",
  }) },
  "../store/user": { useUserStore: user }, "../store/conversation": { useConversationStore: conversation },
  "../core/main-screen-presence": { isMainScreenFocused: () => focused, subscribeMainScreenFocused: () => () => {} },
  "../core/ambient-motion": { configureAmbientBehaviorPolicy() {}, holdAmbientMotionFor() {}, holdAmbientHeadMotionFor() {} },
  "../core/social-attention": {
    configureSocialBehaviorPolicy() {}, holdSocialAttentionMotionFor() {},
    getSocialAttentionControllerState: () => ({ faces: [], interactionSignalsSupported: support }),
    setSocialInteractionSignalRequest(listener) { signalListener = listener; nativeLeases.push(!!listener); },
  },
  "../device-tools/looi-robot": {
    cancelLooiHeadMotion() {}, getLooiRobotRuntimeState: () => ({ connected: true, motionActive: false, stopGeneration: 0, safety: {} }),
    performLooiBehaviorHeadGesture: async () => { assert.fail("Shared scene does not invent a physical launch"); }, subscribeLooiRobotRuntimeState: () => () => {},
  },
  "../character/character-reaction": { clearCharacterReaction() {}, triggerCharacterReaction: () => 1, useCharacterReactionStore: store({ mood: null, reactionId: 0 }) },
  "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
}, { Date: ClockDate, performance: { now: () => now }, setInterval(callback) { poll = callback; return 1; }, clearInterval() {} });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
runtime.updateBehaviorSettings({ mode: "active", visualEnabled: true, curiosityEnabled: false, candidateScoring: false });
const uninstall = runtime.installBehaviorRuntime();
events.beginBehaviorSession("scene", () => {}, (request) => { responses.push(request); return acceptResponse; });
const event = (type, fields = {}) => events.publishBehaviorEvent({ type, sessionId: "scene", ...fields });
const act = (action) => events.performBehaviorCompanionAction(action, "scene");
const snapshot = () => runtime.useBehaviorStore.getState().state.companion;
async function turn(text) {
  now += 1_100;
  conversation.setState({ isUserSpeaking: true }); event("user-speech-start");
  conversation.setState({ isUserSpeaking: false }); event("user-speech-end");
  event("user-turn", { text }); await flush();
}
async function reply(text) { now += 1_100; event("assistant-start"); event("assistant-end", { text }); await flush(); }
async function view(text) {
  await turn(text); now += 1_100;
  assert.match(await events.inspectBehaviorVisual("data:image/jpeg;base64,AA==", text, "scene"), /usable/u);
}
await turn("We built Gerda together, and the paper rocket fell over.");
assert.equal(act({ type: "propose_experience", title: "Gerda", detail: "Our paper rocket fell over.", outcome: "We wanted a wider base.", motif: "happy_bob", evidence: "We built Gerda together" }).status, "proposed");
await reply("Should I remember Gerda?"); await turn("Yes");
const id = snapshot().episodes[0].id;
await view("Look at Gerda and remember its red paper body and narrow base.");
assert.equal(act({ type: "propose_visual_memory", id, description: "A red paper rocket with a narrow base.", evidence: "Look at Gerda and remember its red paper body and narrow base" }).status, "visual_memory_pending");
assert.equal(snapshot().episodes[0].visualMemory, undefined);
await reply(snapshot().pendingExperience.question); await turn("Yes");
assert.match(snapshot().episodes[0].visualMemory.description, /narrow base/u);

async function compareAndArm(signal = "open_palm") {
  await view("Look at Gerda now and compare it with the previous description.");
  assert.equal(act({ type: "compare_shared_object", id, observedDescription: "A red paper rocket with a wide base.", change: "The base looks wider.", match: "different" }).status, "comparison_pending");
  assert.equal(snapshot().scene.status, "awaiting_confirmation");
  assert.equal(act({ type: "prepare_shared_ritual", id, signal, evidence: "Gerda" }).ok, false);
  await reply(snapshot().pendingExperience.question); await turn("Yes");
  assert.equal(snapshot().scene.status, "ready");
  assert.match(snapshot().episodes[0].visualMemory.description, /wide base/u);
  await turn(signal === "voice" ? "For Gerda, wait until I say start." : "For Gerda, wait for my open palm.");
  const evidence = signal === "voice" ? "For Gerda, wait until I say start" : "For Gerda, wait for my open palm";
  const result = act({ type: "prepare_shared_ritual", id, signal, evidence });
  assert.equal(result.status, "ritual_armed");
  assert.equal(events.requiresBehaviorTurnCommit("scene"), true);
  return snapshot().scene.id;
}
function frame(palm, listener = signalListener) {
  now += 120;
  listener?.({ timestampMs: now, interactionHandCount: palm ? 1 : 0, interactionSignal: palm ? { kind: "open_palm", confidence: 0.95, handCount: 1 } : null });
}
function openPalm(listener = signalListener) { for (let i = 0; i < 3; i++) frame(false, listener); for (let i = 0; i < 7; i++) frame(true, listener); }
await view("Look at Gerda now and compare it with the previous description.");
assert.equal(act({ type: "compare_shared_object", id, observedDescription: "A red paper rocket with a wide base.", change: "The base looks wider.", match: "different" }).status, "comparison_pending");
await reply("Gerda is on the table. What should we build next?"); await turn("Yes");
assert.equal(snapshot().scene.status, "closed", "yes to an unrelated title-containing question cannot confirm a comparison");
assert.match(snapshot().episodes[0].visualMemory.description, /narrow base/u);
const firstScene = await compareAndArm();
assert.equal(typeof signalListener, "function");
for (let i = 0; i < 10; i++) frame(true);
assert.equal(responses.length, 0, "a hand already visible at arming is not a start");
const oldListener = signalListener;
openPalm();
assert.equal(snapshot().scene.status, "started");
assert.deepEqual(responses, [{ kind: "shared-countdown", id: firstScene, episodeTitle: "Gerda" }]);
assert.equal(signalListener, null, "hand analysis is released immediately after the one-shot start");
assert.equal(events.requiresBehaviorTurnCommit("scene"), false);
openPalm(oldListener); assert.equal(responses.length, 1, "late frames cannot start a second response");

await compareAndArm("voice");
assert.equal(signalListener, null, "voice ritual does not open a hand-analysis lease");
await turn("Start");
assert.equal(snapshot().scene.status, "started");
assert.equal(snapshot().scene.startedBy.kind, "voice");
assert.equal(responses.length, 1, "voice uses the normal committed-transcript response path");

await compareAndArm("voice"); await turn("Yes");
assert.equal(snapshot().scene.status, "closed", "ordinary agreement is not the agreed spoken start command");
assert.equal(responses.length, 1);

await compareAndArm(); const expiredListener = signalListener;
now += 20_001; poll(); await flush(); openPalm(expiredListener);
assert.equal(snapshot().scene.status, "closed"); assert.equal(responses.length, 1);
assert.equal(signalListener, null);

await compareAndArm(); const privateListener = signalListener;
user.setState({ preferences: { ...user.getState().preferences, cameraAttentionEnabled: false } });
openPalm(privateListener);
assert.equal(snapshot().scene.status, "closed"); assert.equal(signalListener, null); assert.equal(responses.length, 1);
user.setState({ preferences: { ...user.getState().preferences, cameraAttentionEnabled: true } });

await compareAndArm(); event("interrupt", { reason: "STOP" }); openPalm(oldListener);
assert.equal(snapshot().scene.status, "closed"); assert.equal(responses.length, 1);
await compareAndArm(); acceptResponse = false; openPalm();
assert.equal(snapshot().scene.status, "closed", "unavailable voice callback closes the attempt instead of claiming a launch");
assert.equal(responses.length, 2);
assert.equal(signalListener, null);
assert.ok(nativeLeases.includes(true) && nativeLeases.at(-1) === false);
const serialized = runtime.behaviorEngine.serialize();
assert.equal(JSON.stringify(JSON.parse(serialized).companion).includes("startedBy"), false, "transient start permission is not persisted");
user.setState({ preferences: { ...user.getState().preferences, language: "de" } });
await view("Schau dir Gerda an und vergleiche sie mit der gespeicherten Beschreibung.");
assert.equal(act({ type: "compare_shared_object", id, observedDescription: "Eine rote Papierrakete mit breitem Fuß.", change: "Der Fuß ist breiter.", match: "different" }).status, "comparison_pending");
assert.match(snapshot().pendingExperience.question, /(?:Ist|Stimmt|Bestätigst|Hat)/u, "configured response language reaches the local confirmation template");
await turn("Nein");
const activityEvidence = "Lass uns einen gemeinsamen Versuch mit Gerda beginnen";
await turn(activityEvidence);
const activityProposal = act({ type: "manage_shared_activity", operation: "begin", id, evidence: activityEvidence });
assert.equal(activityProposal.status, "pending_confirmation");
assert.equal(events.requiresBehaviorTurnCommit("scene"), true, "activity confirmations wait for the committed user transcript");
await reply(activityProposal.confirmationQuestion);
await turn("Ja");
assert.equal(runtime.behaviorEngine.getState().pendingIntention.activity.confirmedAt !== null, true);
assert.equal(events.requiresBehaviorTurnCommit("scene"), false, "accepted activity confirmation restores ordinary response mode");
uninstall(); runtime.behaviorEngine.dispose();
console.log("Gerda actual engine/runtime: confirmed text baseline, provisional difference, explicit voice/palm ritual, one shot, expiry, STOP, privacy and unavailable response PASS");
