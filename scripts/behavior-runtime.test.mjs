import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => { for (let index = 0; index < 40; index += 1) await Promise.resolve(); };
async function advance(runtime, durationMs) {
  const elapsed = durationMs + 100;
  runtime.advanceNow(elapsed);
  await delay(40);
  await flush();
}

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  const store = (selector = (value) => value) => selector(state);
  store.getState = () => state;
  store.setState = (patch) => {
    const previous = state;
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const listener of listeners) listener(state, previous);
  };
  store.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return store;
}

function makeRuntime(savedBehaviorSettings = undefined) {
  let now = 1_000;
  let focused = true;
  let appStateListener = null;
  let intervalCallback = null;
  let intervalDelay = null;
  let nextReactionId = 1;
  let adapter = null;
  let ambientPolicy = null;
  let socialPolicy = null;
  let resetLearningCalls = 0;
  let inspectVisualCalls = 0;
  let movementCalls = 0;
  let friendlyStrokeCalls = 0;
  let clearReactionCalls = 0;
  const storageValues = new Map();
  if (savedBehaviorSettings !== undefined) storageValues.set("settings", savedBehaviorSettings);
  const focusListeners = new Set();
  const userListeners = new Set();
  const conversationListeners = new Set();
  const robotListeners = new Set();
  const cancelledHeadMotions = [];
  const events = [];
  const gesturePromises = [];
  let currentCheck = null;

  const userState = {
    preferences: {
      language: "en",
      listeningLanguage: "en",
      ambientMotionLevel: "normal",
      cameraAttentionEnabled: true,
      robotName: "LOOI",
    },
    robotSleeping: false,
  };
  const conversationState = { isUserSpeaking: false, isSpeaking: false, inputAttentionClears: 0, clearInputAttention() { this.inputAttentionClears++; } };
  const robotState = {
    connected: true,
    motionActive: false,
    stopGeneration: 0,
    safety: { lastSafetyStopReason: null },
  };
  const userStore = {
    getState: () => userState,
    subscribe: (listener) => { userListeners.add(listener); return () => userListeners.delete(listener); },
  };
  const conversationStore = {
    getState: () => conversationState,
    subscribe: (listener) => { conversationListeners.add(listener); return () => conversationListeners.delete(listener); },
  };
  const reactionStore = createStore({ mood: null, reactionId: 0 });

  const engineState = {
    sessionId: "session-1",
    lifecycleGeneration: 1,
    posture: "settle",
    cue: null,
    attentionPolicy: "release",
    selectedFaceId: null,
    companion: { episodes: [], scene: { status: "idle", id: null, signal: null } },
  };
  const engineDependencies = {};
  const engine = {
    configure(settings) { this.settings = settings; },
    setEnvironment(environment) { this.environment = { ...this.environment, ...environment }; },
    dispatch(event) {
      events.push(event);
      if (["session-start", "session-end", "user-speech-start", "user-turn", "assistant-end", "interrupt", "correction", "intention", "game-command"].includes(event.type)) engineState.lifecycleGeneration += 1;
      if (event.type === "session-start") engineState.sessionId = event.sessionId;
      if (event.type === "session-end") engineState.sessionId = null;
    },
    inspectVisual() { inspectVisualCalls += 1; return Promise.resolve("use the requested view"); },
    getState: () => engineState,
    getConversationContext() { return this.settings.mode === "active" ? "A short pending task" : ""; },
    getPersonalityContext: () => JSON.stringify({ tone: "default", familiarInterests: [] }),
    acceptPersonalityTurn() {},
    notePersonalitySpeech() {},
    noteFriendlyStroke() { friendlyStrokeCalls += 1; return { durationMs: 1300 }; },
    serialize: () => JSON.stringify({ engineState }),
    restore() {},
    resetLearning() { resetLearningCalls += 1; },
    tick() {},
    companionAction() { return { ok: false, status: "session-inactive" }; },
    forgetExperience() {},
    dispose() {},
    subscribe: () => () => undefined,
  };

  const AppState = {
    currentState: "active",
    addEventListener: (_event, listener) => { appStateListener = listener; return { remove() { appStateListener = null; } }; },
  };
  const zustand = {
    create: (initializer) => createStore(initializer((patch) => {}, () => {})),
  };
  const dependencies = {
    "react-native": { AppState },
    zustand,
    "react-native-mmkv": {
      createMMKV: () => ({
        getString: (key) => storageValues.get(key),
        set: (key, value) => storageValues.set(key, value),
      }),
    },
    "../core/interaction-start-signal": loadTypeScript("src/core/interaction-start-signal.ts"),
    "../memory/memory-mutation": loadTypeScript("src/memory/memory-mutation.ts"),
    "../memory/memory-service": { stopConversationForMemoryChange: async () => {} },
    "./behavior-engine": {
      createBehaviorEngine: (deps) => { Object.assign(engineDependencies, deps); return engine; },
    },
    "./game-face-feedback": loadTypeScript("src/behavior/game-face-feedback.ts"),
  "./listening-opportunity": loadTypeScript("src/behavior/listening-opportunity.ts"),
  "./behavior-face-feedback": loadTypeScript("src/behavior/behavior-face-feedback.ts"),
  "./behavior-expression": loadTypeScript("src/behavior/behavior-expression.ts", {}, {
      performance: { now: () => now },
    }),
    "./behavior-events": {
      registerBehaviorAdapter: (next) => { adapter = next; return () => { if (adapter === next) adapter = null; }; },
      refreshBehaviorContext() {},
    },
    "../openai/decisions": { requestDecisions: async () => { throw new Error("the mock engine must not call the provider"); } },
    "../store/user": { useUserStore: userStore },
    "../store/conversation": { useConversationStore: conversationStore },
    "../core/main-screen-presence": {
      isMainScreenFocused: () => focused,
      subscribeMainScreenFocused: (listener) => { focusListeners.add(listener); return () => focusListeners.delete(listener); },
    },
    "../core/ambient-motion": {
      configureAmbientBehaviorPolicy: (policy) => { ambientPolicy = policy; },
      holdAmbientMotionFor() {},
      holdAmbientHeadMotionFor() {},
    },
    "../core/social-attention": {
      configureSocialBehaviorPolicy: (policy) => { socialPolicy = policy; },
      getSocialAttentionControllerState: () => ({ faces: [] }),
      holdSocialAttentionMotionFor() {},
    },
    "../device-tools/looi-robot": {
      cancelLooiHeadMotion: (reason) => cancelledHeadMotions.push(reason),
      getLooiRobotRuntimeState: () => robotState,
      performLooiBehaviorHeadGesture: (_gesture, isCurrent) => {
        movementCalls += 1;
        currentCheck = isCurrent;
        const pending = deferred(); gesturePromises.push(pending);
        return pending.promise;
      },
      subscribeLooiRobotRuntimeState: (listener) => { robotListeners.add(listener); return () => robotListeners.delete(listener); },
    },
    "../character/character-reaction": {
      clearCharacterReaction: () => { clearReactionCalls += 1; reactionStore.setState({ mood: null }); },
      triggerCharacterReaction: (mood) => {
        const reactionId = nextReactionId++;
        reactionStore.setState({ mood, reactionId });
        return reactionId;
      },
      useCharacterReactionStore: reactionStore,
    },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
  };
  const runtime = loadTypeScript("src/behavior/behavior-runtime.ts", dependencies, {
    performance: { now: () => now },
    setInterval: (callback, delay) => { intervalCallback = callback; intervalDelay = delay; return 1; },
    clearInterval: () => { intervalCallback = null; },
  });

  return {
    runtime, engine, engineDependencies, events, storageValues, userState, conversationState,
    robotState, reactionStore, cancelledHeadMotions, focusListeners, userListeners,
    conversationListeners, robotListeners, getAdapter: () => adapter,
    getState: () => runtime.useBehaviorStore.getState(),
    getMetrics: () => ({ movementCalls, clearReactionCalls, inspectVisualCalls, resetLearningCalls, friendlyStrokeCalls }),
    getPolicy: () => ({ ambientPolicy, socialPolicy }),
    getPoll: () => ({ callback: intervalCallback, delay: intervalDelay }),
    getCurrentCheck: () => currentCheck,
    setNow: (value) => { now = value; },
    advanceNow: (duration) => { now += duration; },
    setFocused: (value) => { focused = value; for (const listener of focusListeners) listener(value); },
    setSafetyStop: (reason) => { robotState.stopGeneration += 1; robotState.safety.lastSafetyStopReason = reason; for (const listener of robotListeners) listener(); },
    finishGesture: (index = gesturePromises.length - 1, completed = false) => gesturePromises[index].resolve({ completed }),
    getAppStateListener: () => appStateListener,
  };
}

const runtime = makeRuntime();
assert.equal(runtime.getState().settings.mode, "active", "adaptive behavior defaults to Active when no preference has been saved");
const uninstall = runtime.runtime.installBehaviorRuntime();
const adapter = runtime.getAdapter();
assert.ok(adapter, "install registers the voice/runtime adapter");
assert.equal(runtime.getPoll().delay, 400, "face evidence is polled at a bounded 400 ms interval");
assert.deepEqual(runtime.runtime.recordFriendlyStroke(), { durationMs: 1300 }, "genuine local input reaches the existing persistent engine");
assert.equal(runtime.getMetrics().friendlyStrokeCalls, 1);
runtime.setFocused(false);
assert.equal(runtime.runtime.recordFriendlyStroke(), null);
runtime.setFocused(true);
for (const key of ["isUserSpeaking", "isSpeaking", "isProcessing"]) {
  runtime.conversationState[key] = true;
  assert.equal(runtime.runtime.recordFriendlyStroke(), null, `${key} takes priority over affection`);
  runtime.conversationState[key] = false;
}
runtime.runtime.useBehaviorStore.setState({ feedback: { kind: "repair" } });
assert.equal(runtime.runtime.recordFriendlyStroke(), null);
runtime.runtime.useBehaviorStore.setState({ feedback: null });
assert.equal(runtime.getMetrics().friendlyStrokeCalls, 1, "rejected local inputs cannot create bond history");

const savedOff = makeRuntime(JSON.stringify({ mode: "off", dailyBudgetUsd: 3, visualEnabled: true, candidateScoring: false, curiosityEnabled: true }));
assert.deepEqual(savedOff.getState().settings, { mode: "off", dailyBudgetUsd: 3, visualEnabled: true, candidateScoring: false, curiosityEnabled: true }, "a previously saved preference and separate feature grants are preserved");

for (const mode of ["off", "shadow"]) {
  runtime.runtime.updateBehaviorSettings({ mode });
  await runtime.engineDependencies.executeCue({ id: `cue-${mode}`, generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased" });
  assert.equal(runtime.getMetrics().movementCalls, 0, `${mode} mode cannot start a head gesture`);
  assert.equal(runtime.reactionStore.getState().mood, null, `${mode} mode cannot trigger a visible reaction`);
  assert.equal(runtime.getState().presentation, null, `${mode} mode does not publish a visible cue`);
}

runtime.runtime.updateBehaviorSettings({ mode: "active" });
assert.equal(adapter.getContext(), "A short pending task", "active mode shares bounded local conversation context");
await runtime.engineDependencies.executeCue({ id: "input-display-only", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased", presentationOnly: true });
assert.equal(runtime.getMetrics().movementCalls, 0, "input-side expression reserves the physical beat for the heard outcome");
assert.equal(runtime.reactionStore.getState().mood, null, "input expression does not create a competing character timer");
assert.equal(runtime.getState().presentation.id, "input-display-only");
await runtime.engineDependencies.executeCue({ id: "expired-before-start", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 999, gesture: "curious", mood: "pleased" });
assert.equal(runtime.getMetrics().movementCalls, 0, "an expired cue cannot start a new head macro");
runtime.runtime.updateBehaviorSettings({ mode: "shadow" });
assert.equal(adapter.getContext(), "", "shadow mode excludes adaptive task context when no character preference is saved");
assert.equal(await adapter.inspectVisual("image", "look", "session-1"), "", "shadow mode does not supply visual advice");
assert.equal(runtime.getMetrics().inspectVisualCalls, 0);
runtime.runtime.updateBehaviorSettings({ mode: "active", visualEnabled: true });
assert.equal(await adapter.inspectVisual("image", "look", "session-1"), "use the requested view");
assert.equal(runtime.getMetrics().inspectVisualCalls, 1, "visual advice is opt-in");

runtime.userState.robotSleeping = true;
await runtime.engineDependencies.executeCue({ id: "sleeping-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased" });
assert.equal(runtime.getMetrics().movementCalls, 0, "sleep state blocks cue start");
runtime.userState.robotSleeping = false;
runtime.setFocused(false);
await runtime.engineDependencies.executeCue({ id: "unfocused-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased" });
assert.equal(runtime.getMetrics().movementCalls, 0, "route focus blocks cue start");
runtime.setFocused(true);

const activeCue = runtime.engineDependencies.executeCue({ id: "running-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased" });
assert.equal(runtime.getState().presentation.expressionPhase, "prepare", "the actual runtime publishes the expression preparation phase first");
assert.equal(runtime.getMetrics().movementCalls, 0, "eye preparation precedes the physical head accent");
await advance(runtime, 150);
assert.equal(runtime.getMetrics().movementCalls, 1);
assert.equal(runtime.getState().presentation.expressionPhase, "accent", "the visible phase changes when the guarded head accent starts");
assert.equal(runtime.getCurrentCheck()(), true, "a currently valid active cue may continue");

// A user reaction that supersedes a behavior reaction remains owned by the user.
runtime.reactionStore.setState({ mood: "angry", reactionId: 9_999 });
adapter.dispatch({ type: "user-speech-start", sessionId: "session-1" });
assert.equal(runtime.getCurrentCheck()(), false, "a new user turn invalidates the running cue");
assert.ok(runtime.cancelledHeadMotions.includes("behavior-user-speech-start"), "a new turn cancels the active head generation");
assert.equal(runtime.getMetrics().clearReactionCalls, 0, "interrupt does not clear a newer manual reaction");
assert.equal(runtime.reactionStore.getState().mood, "angry");
runtime.finishGesture(0, false);
await activeCue;

const stoppedCue = runtime.engineDependencies.executeCue({ id: "stopped-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: null });
assert.equal(runtime.getState().presentation.expressionPhase, "prepare");
await advance(runtime, 150);
assert.equal(runtime.getMetrics().movementCalls, 2);
runtime.reactionStore.setState({ mood: "victory", reactionId: 10_000 });
runtime.setSafetyStop("dance-start");
assert.equal(runtime.getCurrentCheck()(), false, "a stopGeneration update still invalidates the current cue guard during dance preparation");
assert.ok(runtime.cancelledHeadMotions.includes("behavior-robot-stop"), "STOP cancels the active head generation");
assert.equal(runtime.reactionStore.getState().mood, "victory", "dance preparation invalidates the old cue but preserves its direct victory expression");
assert.equal(runtime.reactionStore.getState().reactionId, 10_000, "internal dance preparation preserves the direct reaction identity");
runtime.reactionStore.setState({ mood: "annoyed", reactionId: 10_001 });
runtime.setSafetyStop("cliff");
assert.ok(runtime.conversationState.inputAttentionClears >= 2, "robot STOP also discards early input attention");
assert.equal(runtime.reactionStore.getState().mood, null, "STOP clears a still-current visual reaction even when a tap started it");
assert.equal(runtime.reactionStore.getState().reactionId, 10_001, "visual STOP cleanup preserves the replacement identity for later ownership checks");
assert.equal(runtime.getMetrics().clearReactionCalls, 1, "STOP clears one current reaction without broad ordinary-cue cleanup");
runtime.finishGesture(1, false);
await stoppedCue;

// stopLooiMotion() uses the existing "explicit" default reason for direct STOP calls.
runtime.reactionStore.setState({ mood: "annoyed", reactionId: 10_002 });
runtime.setSafetyStop("explicit");
assert.equal(runtime.reactionStore.getState().mood, null, "the default explicit STOP clears a direct tap reaction");
assert.equal(runtime.reactionStore.getState().reactionId, 10_002, "default STOP keeps the cleared reaction's identity");
assert.equal(runtime.getMetrics().clearReactionCalls, 2);

const repeatedStopCue = runtime.engineDependencies.executeCue({ id: "repeated-stop-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: null });
assert.equal(runtime.getState().presentation.expressionPhase, "prepare");
await advance(runtime, 150);
assert.equal(runtime.getMetrics().movementCalls, 3);
runtime.setSafetyStop("cliff-stop");
assert.equal(runtime.getCurrentCheck()(), false, "a repeated same-reason STOP still invalidates a later cue");
runtime.finishGesture(2, false);
await repeatedStopCue;

const settlingCue = runtime.engineDependencies.executeCue({ id: "settling-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 3_000, gesture: "thinking", mood: null });
assert.equal(runtime.getState().presentation.expressionPhase, "prepare");
await advance(runtime, 150);
assert.equal(runtime.getMetrics().movementCalls, 4);
runtime.finishGesture(3, true);
await flush();
assert.equal(runtime.getState().presentation.expressionPhase, "settle", "a completed head accent enters the visible settle phase");
await advance(runtime, 220);
await settlingCue;
assert.equal(runtime.getState().presentation, null, "settle returns the face to its normal moment presentation");

runtime.runtime.updateBehaviorSettings({ dailyBudgetUsd: 3 });
await runtime.runtime.resetBehaviorLearning();
assert.equal(runtime.getMetrics().resetLearningCalls, 1);
assert.deepEqual(JSON.parse(runtime.storageValues.get("settings")), {
  mode: "active",
  dailyBudgetUsd: 3,
  visualEnabled: true,
  candidateScoring: true,
  curiosityEnabled: false,
}, "learning reset preserves separately persisted settings and budget selection");

// An armed scene's silent-attending phase cannot overwrite actual speech. Both
// the live conversation flag and the engine's speaking moment protect priority.
const engineState = runtime.engine.getState();
engineState.companion.scene = { status: "armed", id: "armed-test-scene", signal: "voice", deadline: 5_000 };
engineState.moment = { phase: "attending", changedAt: 1_000, userText: "", assistantText: "" };
runtime.conversationState.isSpeaking = true;
runtime.getPoll().callback();
assert.equal(runtime.getState().presentation, null, "a real speaking conversation keeps an armed scene from recreating an attending expression");
runtime.conversationState.isSpeaking = false;
engineState.moment = { ...engineState.moment, phase: "speaking" };
runtime.getPoll().callback();
assert.equal(runtime.getState().presentation, null, "the engine's speaking phase also outranks the armed-scene fallback");

uninstall();
assert.equal(runtime.getPoll().callback, null, "uninstall clears the face-evidence timer");
console.log("Behavior runtime adapter safety and settings checks passed.");
