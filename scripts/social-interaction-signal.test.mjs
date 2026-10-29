import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  const use = (selector = (value) => value) => selector(state);
  use.getState = () => state;
  use.setState = (patch) => {
    const previous = state;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state, previous);
  };
  use.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return use;
}

function createHarness({ cameraAttentionEnabled = true, toggle } = {}) {
  const events = new Map();
  const toggleCalls = [];
  const diagnostics = [];
  let startCalls = 0;
  let stopCalls = 0;
  const native = {
    addListener(name, callback) {
      const callbacks = events.get(name) ?? new Set();
      callbacks.add(callback);
      events.set(name, callbacks);
      return { remove: () => callbacks.delete(callback) };
    },
    async start() {
      startCalls += 1;
      return {
        running: true,
        signalAnalysisSupported: true,
        objectTrackingSupported: true,
        permissionGranted: true,
        lensFacing: "front",
      };
    },
    async stop() {
      stopCalls += 1;
      return { running: false };
    },
    setInteractionSignalsEnabled(enabled) {
      toggleCalls.push(enabled);
      return toggle ? toggle(enabled, toggleCalls.length) : Promise.resolve(true);
    },
  };
  const userStore = createStore({
    preferences: { cameraAttentionEnabled },
    robotSleeping: false,
  });
  const conversationStore = createStore({ isUserSpeaking: false, isProcessing: false, isSpeaking: false });
  const ambientState = { actionInFlight: false, currentAction: null };
  const module = loadTypeScript("src/core/social-attention.ts", {
    zustand: { create: (initializer) => createStore(initializer()) },
    "../../modules/local-face-attention": {
      getLocalFaceAttentionModule: () => native,
      setLocalInteractionSignalsEnabled: (enabled) => native.setInteractionSignalsEnabled(enabled),
    },
    "../device-tools/looi-robot": {
      getLooiRobotRuntimeState: () => ({ connected: false, driveControlReady: false, motionActive: false }),
      performLooiSocialAttentionPivot: async () => ({ completed: true }),
      setLooiHead: async () => ({ completed: true }),
    },
    "../diagnostics/diagnostic-log": {
      recordDiagnosticEvent: (...args) => diagnostics.push(args),
    },
    "../store/conversation": { useConversationStore: conversationStore },
    "../store/user": { useUserStore: userStore },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "./ambient-motion": {
      getAmbientMotionControllerState: () => ambientState,
      holdAmbientHeadMotionFor() {},
      holdAmbientMotionFor() {},
    },
    "./main-screen-presence": {
      isMainScreenFocused: () => true,
      subscribeMainScreenFocused: () => () => {},
    },
    "./face-target-tracking": {
      createFaceTargetTracker: () => ({
        update: (faces) => faces.map((face, index) => ({ ...face, id: `face-${index}` })),
        reset() {},
      }),
    },
  });

  return {
    module,
    native,
    userStore,
    toggleCalls,
    diagnostics,
    get startCalls() { return startCalls; },
    get stopCalls() { return stopCalls; },
    emit(name, event) { for (const callback of events.get(name) ?? []) callback(event); },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

const activeFrame = {
  timestampMs: 100,
  faceCount: 1,
  primary: {
    left: 0.2, top: 0.25, right: 0.5, bottom: 0.8,
    centerX: 0.35, centerY: 0.5, width: 0.3, height: 0.55,
  },
};

{
  const delayedEnable = deferred();
  let delayedOnce = false;
  const harness = createHarness({
    toggle: (enabled) => {
      if (enabled && !delayedOnce) {
        delayedOnce = true;
        return delayedEnable.promise;
      }
      return Promise.resolve(true);
    },
  });
  harness.module.startSocialAttentionController();
  let staleListenerCalls = 0;
  let currentListenerCalls = 0;
  const staleLease = () => { staleListenerCalls += 1; };
  const currentLease = () => { currentListenerCalls += 1; };
  harness.module.setSocialInteractionSignalRequest(staleLease);
  await flushMicrotasks();
  assert.deepEqual(harness.toggleCalls, [true], "the first native enable is pending");

  harness.module.setSocialInteractionSignalRequest(null);
  harness.module.setSocialInteractionSignalRequest(currentLease);
  delayedEnable.resolve(true);
  await flushMicrotasks();

  assert.deepEqual(harness.toggleCalls, [true], "a stale enable completion must not turn off the newer lease");
  harness.emit("onFaceFrame", activeFrame);
  assert.equal(staleListenerCalls, 0);
  assert.equal(currentListenerCalls, 1, "the latest listener owns frames after the delayed enable resolves");
  assert.equal(harness.module.getSocialAttentionControllerState().interactionSignalsSupported, true);

  await harness.module.stopSocialAttentionController("test-cleanup");
  assert.deepEqual(harness.toggleCalls, [true, false], "controller teardown releases the current lease");
}

{
  const delayedDisable = deferred();
  let delayedOnce = false;
  const harness = createHarness({
    toggle: (enabled) => {
      if (!enabled && !delayedOnce) {
        delayedOnce = true;
        return delayedDisable.promise;
      }
      return Promise.resolve(true);
    },
  });
  harness.module.startSocialAttentionController();
  let staleListenerCalls = 0;
  let newListenerCalls = 0;
  harness.module.setSocialInteractionSignalRequest(() => { staleListenerCalls += 1; });
  await flushMicrotasks();
  assert.equal(harness.module.getSocialAttentionControllerState().nativeStarted, true);

  harness.userStore.setState({ preferences: { cameraAttentionEnabled: false } });
  assert.equal(harness.module.getSocialAttentionControllerState().nativeStarted, false,
    "camera-off invalidates the current native lifecycle synchronously");
  assert.deepEqual(harness.toggleCalls, [true, false], "camera-off is waiting on native disable");

  harness.userStore.setState({ preferences: { cameraAttentionEnabled: true } });
  harness.module.setSocialInteractionSignalRequest(() => { newListenerCalls += 1; });
  await flushMicrotasks();
  assert.equal(harness.startCalls, 2, "the new allowed lease starts the camera while the old disable is pending");
  delayedDisable.resolve(true);
  await flushMicrotasks();

  assert.equal(harness.stopCalls, 0, "stale teardown must not stop the camera owned by the new lease");
  assert.equal(harness.module.getSocialAttentionControllerState().nativeStarted, true);
  assert.deepEqual(harness.toggleCalls, [true, false, true], "the reconciler restores the enabled state for the new lease");
  harness.emit("onFaceFrame", activeFrame);
  assert.equal(staleListenerCalls, 0);
  assert.equal(newListenerCalls, 1);

  await harness.module.stopSocialAttentionController("test-cleanup");
  assert.equal(harness.stopCalls, 1);
}

{
  let failedDisable = false;
  const harness = createHarness({
    toggle: (enabled) => {
      if (!enabled && !failedDisable) {
        failedDisable = true;
        return Promise.reject(new Error("native hand toggle failed"));
      }
      return Promise.resolve(true);
    },
  });
  harness.module.startSocialAttentionController();
  harness.module.setSocialInteractionSignalRequest(() => {});
  await flushMicrotasks();
  harness.emit("onFaceFrame", activeFrame);
  assert.equal(harness.module.useSocialAttentionStore.getState().faceVisible, true);

  harness.userStore.setState({ preferences: { cameraAttentionEnabled: false } });
  assert.equal(harness.module.getSocialAttentionControllerState().attentionActive, false,
    "privacy-off invalidates attention synchronously before native promises settle");
  assert.equal(harness.module.getSocialAttentionControllerState().nativeStarted, false);
  assert.equal(harness.module.useSocialAttentionStore.getState().faceVisible, false,
    "privacy-off resets visible tracking synchronously");
  await flushMicrotasks();

  assert.equal(harness.stopCalls, 1, "camera teardown continues even when native signal disable rejects");
  assert.deepEqual(harness.toggleCalls, [true, false]);
  assert.ok(harness.diagnostics.some(([, event]) => event === "social-attention-signal-toggle-failed"));
  await harness.module.stopSocialAttentionController("test-cleanup");
}

{
  const harness = createHarness({ cameraAttentionEnabled: false });
  harness.module.startSocialAttentionController();
  harness.module.setSocialInteractionSignalRequest(() => {});
  await flushMicrotasks();
  assert.equal(harness.startCalls, 0, "hand analysis never starts while Camera Attention is off");
  assert.deepEqual(harness.toggleCalls, [], "no native hand-analysis lease is issued while privacy is off");
  assert.equal(harness.module.getSocialAttentionControllerState().attentionActive, false);
  await harness.module.stopSocialAttentionController("test-cleanup");
}

{
  const harness = createHarness();
  const ended = [];
  harness.module.startSocialAttentionController();
  assert.equal(await harness.module.acquireSocialObjectAttention("object-a", (reason) => ended.push(["a", reason])), true);
  assert.equal(harness.startCalls, 1, "object selection reuses the social camera owner");
  assert.equal(harness.module.getSocialAttentionControllerState().objectAttentionActive, true);
  assert.equal(await harness.module.acquireSocialObjectAttention("object-b", () => {}), false, "one camera target lease at a time");
  harness.module.releaseSocialObjectAttention("old-object");
  assert.equal(harness.module.getSocialAttentionControllerState().objectAttentionActive, true, "a stale release cannot drop a newer target");
  harness.module.setSocialInteractionSignalRequest(() => {});
  assert.deepEqual(ended, [["a", "ritual-preempted"]], "an explicitly agreed hand signal preempts the object lease");
  assert.equal(harness.module.getSocialAttentionControllerState().objectAttentionActive, false);
  assert.equal(await harness.module.acquireSocialObjectAttention("object-b", () => {}), false, "object selection cannot bypass a hand-signal owner");
  harness.module.setSocialInteractionSignalRequest(null);
  assert.equal(await harness.module.acquireSocialObjectAttention("object-b", (reason) => ended.push(["b", reason])), true);
  await harness.module.stopSocialAttentionController("external-media");
  assert.deepEqual(ended.at(-1), ["b", "external-media"], "external camera handoff invalidates the target synchronously");
}

console.log("Social camera leases: hand toggles, object ownership, preemption, stale release and privacy-off PASS");
