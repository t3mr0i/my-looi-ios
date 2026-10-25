import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

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

function makeRuntime() {
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
  let clearReactionCalls = 0;
  const storageValues = new Map();
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
  const conversationState = { isUserSpeaking: false, isSpeaking: false };
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
    getConversationContext: () => "A short pending task",
    serialize: () => JSON.stringify({ engineState }),
    restore() {},
    resetLearning() { resetLearningCalls += 1; },
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
    "./behavior-engine": {
      createBehaviorEngine: (deps) => { Object.assign(engineDependencies, deps); return engine; },
    },
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
    getMetrics: () => ({ movementCalls, clearReactionCalls, inspectVisualCalls, resetLearningCalls }),
    getPolicy: () => ({ ambientPolicy, socialPolicy }),
    getPoll: () => ({ callback: intervalCallback, delay: intervalDelay }),
    getCurrentCheck: () => currentCheck,
    setNow: (value) => { now = value; },
    setFocused: (value) => { focused = value; for (const listener of focusListeners) listener(value); },
    setSafetyStop: (reason) => { robotState.stopGeneration += 1; robotState.safety.lastSafetyStopReason = reason; for (const listener of robotListeners) listener(); },
    finishGesture: (index = gesturePromises.length - 1, completed = false) => gesturePromises[index].resolve({ completed }),
    getAppStateListener: () => appStateListener,
  };
}

const runtime = makeRuntime();
const uninstall = runtime.runtime.installBehaviorRuntime();
const adapter = runtime.getAdapter();
assert.ok(adapter, "install registers the voice/runtime adapter");
assert.equal(runtime.getPoll().delay, 400, "face evidence is polled at a bounded 400 ms interval");

for (const mode of ["off", "shadow"]) {
  runtime.runtime.updateBehaviorSettings({ mode });
  await runtime.engineDependencies.executeCue({ id: `cue-${mode}`, generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: "pleased" });
  assert.equal(runtime.getMetrics().movementCalls, 0, `${mode} mode cannot start a head gesture`);
  assert.equal(runtime.reactionStore.getState().mood, null, `${mode} mode cannot trigger a visible reaction`);
  assert.equal(runtime.getState().presentation, null, `${mode} mode does not publish a visible cue`);
}

runtime.runtime.updateBehaviorSettings({ mode: "active" });
assert.equal(adapter.getContext(), "A short pending task", "active mode shares bounded local conversation context");
await runtime.engineDependencies.executeCue({ id: "expired-before-start", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 999, gesture: "curious", mood: "pleased" });
assert.equal(runtime.getMetrics().movementCalls, 0, "an expired cue cannot start a new head macro");
runtime.runtime.updateBehaviorSettings({ mode: "shadow" });
assert.equal(adapter.getContext(), "", "shadow mode does not change speech context");
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
assert.equal(runtime.getMetrics().movementCalls, 1);
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
assert.equal(runtime.getMetrics().movementCalls, 2);
runtime.setSafetyStop("cliff-stop");
assert.equal(runtime.getCurrentCheck()(), false, "a STOP state update invalidates the current cue guard");
assert.ok(runtime.cancelledHeadMotions.includes("behavior-robot-stop"), "STOP cancels the active head generation");
runtime.finishGesture(1, false);
await stoppedCue;

const repeatedStopCue = runtime.engineDependencies.executeCue({ id: "repeated-stop-cue", generation: runtime.engine.getState().lifecycleGeneration, expiresAt: 2_000, gesture: "curious", mood: null });
assert.equal(runtime.getMetrics().movementCalls, 3);
runtime.setSafetyStop("cliff-stop");
assert.equal(runtime.getCurrentCheck()(), false, "a repeated same-reason STOP still invalidates a later cue");
runtime.finishGesture(2, false);
await repeatedStopCue;

runtime.runtime.updateBehaviorSettings({ dailyBudgetUsd: 3 });
runtime.runtime.resetBehaviorLearning();
assert.equal(runtime.getMetrics().resetLearningCalls, 1);
assert.deepEqual(JSON.parse(runtime.storageValues.get("settings")), {
  mode: "active",
  dailyBudgetUsd: 3,
  visualEnabled: true,
  candidateScoring: true,
}, "learning reset preserves separately persisted settings and budget selection");

uninstall();
assert.equal(runtime.getPoll().callback, null, "uninstall clears the face-evidence timer");
console.log("Behavior runtime adapter safety and settings checks passed.");
