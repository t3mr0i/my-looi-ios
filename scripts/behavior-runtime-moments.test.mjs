import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function store(initial) {
  let state = initial;
  const listeners = new Set();
  const use = (select = (s) => s) => select(state);
  use.getState = () => state;
  use.setState = (patch) => { const old = state; state = { ...state, ...patch }; for (const f of listeners) f(state, old); };
  use.subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
  return use;
}

const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
function fakeClock(startAt = 1_000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { dueAt: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { return this.setTimeout(callback, delay); },
    clearInterval(id) { this.clearTimeout(id); },
    async advance(duration) {
      const target = now + duration;
      let count = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.dueAt <= target)
          .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++count < 2_000, "fake clock remains bounded");
        const [id, timer] = next;
        timers.delete(id);
        now = timer.dueAt;
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}
const engineModule = createTypeScriptTreeLoader()("src/behavior/behavior-engine.ts");
const events = loadTypeScript("src/behavior/behavior-events.ts");
const mutation = loadTypeScript("src/memory/memory-mutation.ts");
const user = store({ preferences: { language: "en", listeningLanguage: "en", ambientMotionLevel: "normal", cameraAttentionEnabled: true, robotName: "LOOI" }, robotSleeping: false });
let cleared = 0;
const conversation = store({ clearInputAttention() {}, isUserSpeaking: false, isSpeaking: false, clearSession() { cleared++; } });
const reactions = store({ mood: null, reactionId: 0 });
const storage = new Map();
const clock = fakeClock();
let now = clock.now();
let motorCalls = 0;
let stopCalls = 0;
let poll;
const runtime = loadTypeScript("src/behavior/behavior-runtime.ts", {
  "react-native": {
    AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  },
  zustand: { create: (init) => store(init()) },
  "react-native-mmkv": { createMMKV: () => ({ getString: (key) => storage.get(key), set: (key, value) => storage.set(key, value) }) },
  "./behavior-engine": engineModule,
  "./game-face-feedback": loadTypeScript("src/behavior/game-face-feedback.ts"),
  "./listening-opportunity": loadTypeScript("src/behavior/listening-opportunity.ts"),
  "./behavior-face-feedback": loadTypeScript("src/behavior/behavior-face-feedback.ts"),
  "./behavior-expression": loadTypeScript("src/behavior/behavior-expression.ts", {}, clock),
  "../core/interaction-start-signal": loadTypeScript("src/core/interaction-start-signal.ts"),
  "./behavior-events": events,
  "../memory/memory-mutation": mutation,
  "../memory/memory-service": { stopConversationForMemoryChange: async () => { stopCalls++; events.endBehaviorSession("live"); conversation.getState().clearSession(); } },
  "../openai/decisions": { requestDecisions: async (input) => ({
    answers: input.questions.map((q) => ({ type: "choice", name: q.name, choice: q.name === "cue" ? "curious" : q.name === "attention" ? "keep_target" : "wait", confidence: 0.99 })),
    usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-runtime",
  }) },
  "../store/user": { useUserStore: user }, "../store/conversation": { useConversationStore: conversation },
  "../core/main-screen-presence": { isMainScreenFocused: () => true, subscribeMainScreenFocused: () => () => {} },
  "../core/ambient-motion": { configureAmbientBehaviorPolicy() {}, holdAmbientMotionFor() {}, holdAmbientHeadMotionFor() {} },
  "../core/social-attention": { configureSocialBehaviorPolicy() {}, getSocialAttentionControllerState: () => ({ faces: [] }), holdSocialAttentionMotionFor() {} },
  "../device-tools/looi-robot": {
    cancelLooiHeadMotion() {}, getLooiRobotRuntimeState: () => ({ connected: true, motionActive: false, stopGeneration: 0, safety: {} }),
    performLooiBehaviorHeadGesture: async () => { motorCalls++; }, subscribeLooiRobotRuntimeState: () => () => {},
  },
  "../character/character-reaction": { clearCharacterReaction() {}, triggerCharacterReaction: () => 1, useCharacterReactionStore: reactions },
  "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
}, {
  performance: { now: clock.now },
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
  setInterval(callback, delay) { poll = callback; return clock.setInterval(callback, delay); },
  clearInterval(id) { clock.clearInterval(id); poll = null; },
});
runtime.updateBehaviorSettings({ mode: "active", candidateScoring: false });
const uninstall = runtime.installBehaviorRuntime();
events.beginBehaviorSession("live", () => {});
const event = (type, fields = {}) => events.publishBehaviorEvent({ type, sessionId: "live", ...fields });
function speechStart() { conversation.setState({ isUserSpeaking: true }); event("user-speech-start"); }
function speechEnd() { conversation.setState({ isUserSpeaking: false }); event("user-speech-end"); }
function audibleStart() { event("assistant-start"); conversation.setState({ isSpeaking: true }); user.setState({ voiceState: "speaking" }); }
function audibleEnd(text) { conversation.setState({ isSpeaking: false }); user.setState({ voiceState: "listening" }); event("assistant-end", { text }); }
async function turn(text) { await clock.advance(1_100); now = clock.now(); speechStart(); speechEnd(); event("user-turn", { text }); await flush(); }
async function reply(text) { await clock.advance(1_100); now = clock.now(); audibleStart(); audibleEnd(text); await flush(); }

// Long real speech and processing retain their local face ownership without
// introducing head commands or interpreting what the person is saying.
speechStart();
await clock.advance(12_000); poll(); await flush();
assert.equal(runtime.useBehaviorStore.getState().presentation?.mood, "attentive", "a long spoken turn stays visibly attentive");
assert.equal(motorCalls, 0);
conversation.setState({ isUserSpeaking: false });
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "an expired listening cue ends when the live speech signal ends");
event("user-speech-end");
conversation.setState({ isProcessing: true });
await clock.advance(12_000); poll(); await flush();
assert.equal(runtime.useBehaviorStore.getState().presentation?.mood, "thoughtful", "a genuinely pending reply retains its local thinking gaze");
assert.equal(motorCalls, 0, "long-state presentation never starts a motor command");
conversation.setState({ isProcessing: false });
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "finishing processing releases the extended cue");
event("interrupt", { reason: "long-moment-test-end" });
speechStart(); await clock.advance(12_000); poll(); await flush();
assert.equal(runtime.useBehaviorStore.getState().presentation?.mood, "attentive");
event("interrupt", { reason: "emergency-stop" });
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "STOP discards even an extended active-listening presentation");
conversation.setState({ isUserSpeaking: false });
assert.equal(motorCalls, 0);
speechStart(); await clock.advance(12_000); poll(); await flush();
user.setState({ robotSleeping: true });
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "sleep clears the extended listening presentation");
conversation.setState({ isUserSpeaking: false });
user.setState({ robotSleeping: false }); poll();
assert.notEqual(runtime.useBehaviorStore.getState().presentation?.mood, "attentive", "wake does not revive an old speech cue");

speechStart();
assert.equal(runtime.useBehaviorStore.getState().presentation.mood, "attentive");
assert.equal(motorCalls, 0);
speechEnd();
assert.equal(runtime.useBehaviorStore.getState().presentation.mood, "thoughtful", "speech-end updates the local expression without waiting for cloud semantics");
event("user-turn", { text: "Why did the rocket fall?" }); await flush();
assert.equal(motorCalls, 0, "input-side Decisions cue remains display-only through the actual runtime");
await reply("We can try a wider foot.");
assert.equal(motorCalls, 0, "the physical response waits through the eye preparation phase");
assert.equal(runtime.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
await clock.advance(150);
assert.equal(motorCalls, 1, "the actual runtime starts one physical cue after its bounded preparation phase");
assert.equal(runtime.useBehaviorStore.getState().presentation.expressionPhase, "settle", "the completed mock head accent reaches the settle phase");
await clock.advance(220);
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "the expression returns to the normal moment after settling");

const beforeRepairMotors = motorCalls;
event("correction", { correctedReference: "the other rocket" });
assert.equal(runtime.useBehaviorStore.getState().feedback.mood, "repairing", "committed correction gets immediate local visual feedback");
assert.equal(motorCalls, beforeRepairMotors, "repair feedback never commands the head or wheels");
await clock.advance(951);
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "repair display expires without waiting for a cloud response");
poll();
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "polling cannot replay expired repair feedback");
await turn("That is what I meant.");
assert.equal(runtime.useBehaviorStore.getState().feedback.mood, "clarified", "the next committed clarification gently returns to attention");
conversation.setState({ isSpeaking: true }); event("assistant-start");
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "actual speech discards feedback rather than pausing it");
conversation.setState({ isSpeaking: false }); event("assistant-end", { text: "The blue rocket." });
await clock.advance(900);
assert.equal(runtime.useBehaviorStore.getState().feedback, null);

// The game face is driven by the actual local result and heard output edge.
event("game-command", { action: "start" });
const beforeGameMotors = motorCalls;
audibleStart();
assert.equal(runtime.useBehaviorStore.getState().feedback, null);
audibleEnd("Guess a number from one to three."); await flush();
assert.equal(runtime.useBehaviorStore.getState().feedback.mood, "expectant");
assert.equal(runtime.useBehaviorStore.getState().feedback.kind, "game");
assert.equal(motorCalls, beforeGameMotors, "a local game beat does not add a model-selected head cue");
await clock.advance(15_001);
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "waiting quietly settles without another model call");
poll(); assert.equal(runtime.useBehaviorStore.getState().feedback, null);
const answer = runtime.useBehaviorStore.getState().state.game.secretAnswer;
await turn(String(answer % 3 + 1));
audibleStart();
audibleEnd("Try another number."); await flush();
assert.equal(runtime.useBehaviorStore.getState().feedback.mood, "expectant", "a wrong guess gets the same non-revealing waiting face");
await turn(String(answer));
assert.equal(runtime.useBehaviorStore.getState().state.game.status, "won");
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "a correct guess cannot celebrate ahead of audible feedback");
audibleStart();
assert.equal(runtime.useBehaviorStore.getState().feedback, null);
audibleEnd("That was the right number!"); await flush();
assert.equal(runtime.useBehaviorStore.getState().feedback.mood, "victory");
assert.equal(motorCalls, beforeGameMotors);
await clock.advance(1_101);
assert.equal(runtime.useBehaviorStore.getState().feedback, null, "one bounded success accent returns to the conversation");
audibleStart(); audibleEnd("We can talk now."); await flush();
assert.notEqual(runtime.useBehaviorStore.getState().feedback?.mood, "victory", "a later answer cannot replay the win");
event("game-command", { action: "stop" });
event("interrupt", { reason: "game-face-test-ended" });

await turn("We built the paper rocket Gerda together.");
assert.equal(events.performBehaviorCompanionAction({ type: "propose_experience", title: "Gerda", detail: "Our rocket fell over.", outcome: "We proposed a wider foot.", motif: "happy_bob", evidence: "We built the paper rocket Gerda together" }, "live").status, "proposed");
await reply("Should I remember Gerda and our wider-foot idea?");
await turn("Yes");
assert.equal(runtime.useBehaviorStore.getState().state.companion.episodes.length, 1);
const id = runtime.useBehaviorStore.getState().state.companion.episodes[0].id;
const ritualEvidence = "For Gerda, use a nod and say Mission Gerda!";
await turn(ritualEvidence);
const ritualProposal = events.performBehaviorCompanionAction({ type: "set_episode_ritual", id, mode: "active", motif: "nod", phrase: "Mission Gerda!", evidence: ritualEvidence }, "live");
assert.equal(ritualProposal.status, "personal_ritual_pending");
assert.equal(events.requiresBehaviorTurnCommit("live"), true, "a personal ritual waits for a committed confirmation turn");
await reply(ritualProposal.confirmationQuestion);
await turn("Yes");
assert.equal(runtime.useBehaviorStore.getState().state.companion.episodes[0].ritualPreference.mode, "active");
assert.equal(events.requiresBehaviorTurnCommit("live"), false);
await turn("Tell me what happened with Gerda.");
const ritualOffer = events.performBehaviorCompanionAction({ type: "recall_experience", id }, "live");
assert.equal(ritualOffer.status, "personal_ritual_offered");
const beforePersonalCue = motorCalls;
await reply("Mission Gerda!");
assert.equal(motorCalls, beforePersonalCue, "the chosen ritual waits through preparation after its phrase is heard");
assert.equal(runtime.useBehaviorStore.getState().presentation.gesture, "nod", "the personal choice wins over the runtime decider's curious suggestion");
assert.equal(runtime.useBehaviorStore.getState().presentation.expressionPhase, "prepare");
await runtime.disableBehaviorPersonalRitual(id);
await clock.advance(500);
assert.equal(motorCalls, beforePersonalCue, "settings silence during preparation prevents the old personal head cue from starting");
assert.equal(runtime.useBehaviorStore.getState().presentation, null, "settings silence clears the old expression");
assert.equal(stopCalls, 1, "settings silence closes the cached conversation before changing the ritual");
assert.equal(cleared, 1);
assert.equal(runtime.useBehaviorStore.getState().state.sessionId, null);
assert.equal(runtime.useBehaviorStore.getState().state.companion.episodes.length, 1, "silencing a ritual preserves the shared episode");
assert.equal(JSON.parse(storage.get("state")).companion.episodes[0].ritualPreference.mode, "silent", "settings silence persists immediately");
assert.equal(mutation.isLocalMemoryMutationInProgress(), false);
events.beginBehaviorSession("live", () => {});
await turn("Forget Gerda");
assert.equal(events.performBehaviorCompanionAction({ type: "forget_experience", id }, "live").status, "forget_pending");
await reply("Should I forget Gerda?");
await turn("Yes"); await flush();
assert.equal(runtime.useBehaviorStore.getState().state.companion.episodes.length, 0);
assert.equal(stopCalls, 2, "spoken forgetting uses the memory mutation barrier to close the cached conversation");
assert.equal(cleared, 2);
assert.equal(runtime.useBehaviorStore.getState().state.sessionId, null);
assert.equal(JSON.parse(storage.get("state")).companion.episodes.length, 0, "spoken deletion is persisted immediately");
assert.equal(mutation.isLocalMemoryMutationInProgress(), false);
assert.equal(runtime.useBehaviorStore.getState().presentation, null);
poll(); uninstall();
console.log("Actual behavior runtime: local phases, heard-output motor beat, personal ritual preparation cancellation and memory mutation barrier PASS");
