import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  const useStore = (selector = (value) => value) => selector(state);
  useStore.getState = () => state;
  useStore.setState = (patch) => {
    const previous = state;
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const listener of [...listeners]) listener(state, previous);
  };
  useStore.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return useStore;
}

function createHarness({
  trackingSupported = true,
  nativeObjectApi = true,
  permission = async () => true,
  objectSelection = async () => true,
  objectTracking = async () => true,
} = {}) {
  let now = 1_000;
  let focused = true;
  const appListeners = new Set();
  const focusListeners = new Set();
  const robotListeners = new Set();
  const userStore = createStore({ preferences: { cameraAttentionEnabled: true }, robotSleeping: false });
  const conversationStore = createStore({});
  const behaviorStore = createStore({ state: { companion: { scene: { status: "idle" } } } });
  const nativeListeners = new Map();
  const timers = new Map();
  const nativeCalls = [];
  const permissionCalls = [];
  const socialCalls = [];
  const ambientAttentionChanges = [];
  const ambientObjectAttentionLeases = new Map();
  const diagnostics = [];
  const robotSideEffects = [];
  const socialState = { running: true, objectTrackingSupported: trackingSupported, objectAttentionActive: false };
  let socialLease = null;
  let robot = { motionActive: false, stopGeneration: 0 };
  let appState = "active";
  let nextTimer = 0;
  const native = {
    addListener(name, listener) {
      const listeners = nativeListeners.get(name) ?? new Set();
      listeners.add(listener);
      nativeListeners.set(name, listeners);
      return { remove: () => listeners.delete(listener) };
    },
    async startObjectSelection(requestId) {
      nativeCalls.push(["start-selection", requestId]);
      return await objectSelection(requestId);
    },
    async startObjectTracking(requestId, frameId, rect) {
      nativeCalls.push(["start-tracking", requestId, frameId, rect]);
      return await objectTracking(requestId, frameId, rect);
    },
    async stopObjectTracking(requestId) {
      nativeCalls.push(["stop-tracking", requestId]);
    },
  };
  if (!nativeObjectApi) {
    delete native.startObjectSelection;
    delete native.startObjectTracking;
    delete native.stopObjectTracking;
  }

  const dependencies = {
    "react-native": {
      AppState: {
        get currentState() { return appState; },
        addEventListener(name, listener) {
          assert.equal(name, "change");
          appListeners.add(listener);
          return { remove: () => appListeners.delete(listener) };
        },
      },
      Platform: { OS: "ios" },
    },
    zustand: { create: (initializer) => createStore(initializer()) },
    "../../modules/local-face-attention": { getLocalFaceAttentionModule: () => native },
    "./object-attention-policy": loadTypeScript("src/core/object-attention-policy.ts"),
    "./social-attention": {
      async acquireSocialObjectAttention(id, onEnd) {
        socialCalls.push(["acquire", id]);
        if (!socialState.running || !socialState.objectTrackingSupported || socialLease) return false;
        socialLease = { id, onEnd };
        socialState.objectAttentionActive = true;
        return true;
      },
      releaseSocialObjectAttention(id) {
        socialCalls.push(["release", id]);
        if (socialLease?.id !== id) return;
        socialLease = null;
        socialState.objectAttentionActive = false;
      },
      getSocialAttentionControllerState: () => ({ ...socialState }),
    },
    "./main-screen-presence": {
      isMainScreenFocused: () => focused,
      subscribeMainScreenFocused(listener) { focusListeners.add(listener); return () => focusListeners.delete(listener); },
    },
    "./ambient-motion": {
      setAmbientObjectAttentionHeld(id, held) {
        ambientAttentionChanges.push([id, held]);
        if (held) ambientObjectAttentionLeases.set(id, true);
        else ambientObjectAttentionLeases.delete(id);
      },
    },
    "../permissions/camera": { requestCameraAccess: async () => { permissionCalls.push("camera"); return await permission(); } },
    "../store/user": { useUserStore: userStore },
    "../store/conversation": { useConversationStore: conversationStore },
    "../behavior/behavior-runtime": { useBehaviorStore: behaviorStore },
    "../device-tools/looi-robot": {
      getLooiRobotRuntimeState: () => robot,
      subscribeLooiRobotRuntimeState(listener) { robotListeners.add(listener); return () => robotListeners.delete(listener); },
    },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (...args) => diagnostics.push(args) },
  };
  dependencies["./object-activity-reference"] = loadTypeScript("src/core/object-activity-reference.ts");
  dependencies["../behavior/behavior-events"] = loadTypeScript("src/behavior/behavior-events.ts");
  const runtime = loadTypeScript("src/core/object-attention.ts", dependencies, {
    performance: { now: () => now },
    setInterval(callback, intervalMs) {
      const id = ++nextTimer;
      timers.set(id, { callback, intervalMs });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
  });

  return {
    runtime,
    native,
    nativeCalls,
    permissionCalls,
    socialCalls,
    socialState,
    ambientAttentionChanges,
    diagnostics,
    robotSideEffects,
    userStore,
    behaviorStore,
    appListeners,
    focusListeners,
    robotListeners,
    get now() { return now; },
    set now(value) { now = value; },
    get appState() { return appState; },
    set appState(value) { appState = value; for (const listener of [...appListeners]) listener(value); },
    setFocused(value) { focused = value; for (const listener of [...focusListeners]) listener(value); },
    updateRobot(patch) { robot = { ...robot, ...patch }; for (const listener of [...robotListeners]) listener(robot); },
    emit(name, event) { for (const listener of [...(nativeListeners.get(name) ?? [])]) listener(event); },
    emitSocialEnd(reason = "interrupted") { socialLease?.onEnd(reason); },
    runTimers() { for (const timer of [...timers.values()]) timer.callback(); },
    get activeTimerCount() { return timers.size; },
    get nativeListenerCount() { return [...nativeListeners.values()].reduce((count, listeners) => count + listeners.size, 0); },
    get ambientLeaseCount() { return ambientObjectAttentionLeases.size; },
  };
}

async function flushMicrotasks(rounds = 40) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

const selectedRect = { left: 0.2, top: 0.25, right: 0.4, bottom: 0.5 };
function preview(requestId, frameId, timestampMs = 10) {
  return {
    requestId, frameId, timestampMs, cameraFacing: "front", width: 640, height: 480,
    dataUrl: "data:image/jpeg;base64,AA==",
  };
}
function track(requestId, overrides = {}) {
  return {
    requestId,
    trackId: requestId,
    timestampMs: 100,
    status: "tracking",
    rect: { ...selectedRect },
    confidence: 0.95,
    ...overrides,
  };
}
const stateOf = (h) => h.runtime.useObjectAttentionStore.getState();

async function startSelection(h) {
  const started = h.runtime.startObjectAttentionSelection();
  await started;
  assert.equal(stateOf(h).status, "selecting");
  assert.equal(h.permissionCalls.length, 1);
  assert.equal(h.nativeCalls.filter(([kind]) => kind === "start-selection").length, 1);
  return stateOf(h).preview;
}

async function selectFreshPreview(h, frameId = "frame-1") {
  const requestId = h.nativeCalls.find(([kind]) => kind === "start-selection")?.[1];
  assert.ok(requestId);
  h.emit("onObjectPreview", preview(requestId, frameId));
  assert.equal(stateOf(h).preview?.frameId, frameId);
  assert.equal(await h.runtime.selectObjectAttention(frameId, selectedRect), true);
  assert.equal(stateOf(h).status, "tracking");
  return requestId;
}

{
  const h = createHarness();
  assert.equal(stateOf(h).status, "idle", "importing the runtime does not start a camera or controller");
  assert.equal(h.permissionCalls.length, 0);
  assert.equal(h.socialCalls.length, 0);
  assert.equal(h.nativeListenerCount, 0);
  await startSelection(h);
  assert.equal(h.socialCalls[0][0], "acquire", "the camera lease is acquired only after the explicit start action");
  assert.equal(h.ambientLeaseCount, 1, "selection takes an explicit ambient-motion lease");
  const requestId = await selectFreshPreview(h);
  h.emit("onObjectTrack", track(requestId));
  assert.equal(stateOf(h).status, "tracking");
  assert.deepEqual(stateOf(h).rect, selectedRect);
  assert.ok(Math.abs(stateOf(h).gaze.x - 0.625) < 1e-9);
  assert.ok(Math.abs(stateOf(h).gaze.y + 0.36764705882352944) < 1e-9);
  assert.equal(stateOf(h).trackId, requestId);
  assert.equal(h.socialState.objectAttentionActive, true);
  assert.deepEqual(h.robotSideEffects, [], "target following produces no physical motor command");

  h.now += 501;
  h.runTimers();
  assert.equal(stateOf(h).status, "lost", "a quiet camera stream ends the target lease after the receive-time gap");
  assert.equal(stateOf(h).reason, "frame-gap");
  assert.equal(stateOf(h).rect, null);
  assert.equal(stateOf(h).gaze, null, "terminal loss clears the gaze target");
  assert.equal(h.ambientLeaseCount, 0, "terminal loss immediately releases the ambient-motion lease");
  h.emit("onObjectTrack", track(requestId, { timestampMs: 101 }));
  assert.equal(stateOf(h).status, "lost", "late frames cannot reacquire a lost target");
  assert.equal(h.socialState.objectAttentionActive, false);
  assert.deepEqual(h.robotSideEffects, [], "tracking never sends a robot movement command");
}

{
  const h = createHarness();
  await startSelection(h);
  const requestId = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  h.emit("onObjectPreview", preview(requestId, "fresh", 10));
  assert.equal(await h.runtime.selectObjectAttention("fresh", selectedRect), true);
  h.emit("onObjectTrack", track(requestId, { timestampMs: 100 }));
  assert.equal(stateOf(h).status, "tracking");
  h.now += 400;
  h.emit("onObjectTrack", track(requestId, { timestampMs: 100 }));
  assert.equal(stateOf(h).status, "tracking", "a duplicate frame cannot keep the lease alive by itself");
  h.now += 101;
  h.runTimers();
  assert.equal(stateOf(h).status, "lost");
  assert.equal(stateOf(h).reason, "frame-gap");
  assert.equal(h.ambientLeaseCount, 0, "duplicate-frame timeout releases ambient motion");
}

{
  const h = createHarness();
  await startSelection(h);
  const requestId = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  h.emit("onObjectPreview", preview(requestId, "old", 10));
  h.now += 501;
  assert.equal(await h.runtime.selectObjectAttention("old", selectedRect), false);
  assert.equal(stateOf(h).status, "selecting");
  assert.equal(stateOf(h).reason, "selection-stale");
  assert.equal(h.nativeCalls.some(([kind]) => kind === "start-tracking"), false,
    "a stale preview cannot initialize native tracking");
  h.now += 15_000;
  h.runTimers();
  assert.equal(stateOf(h).status, "ended");
  assert.equal(stateOf(h).reason, "selection-timeout", "selection ends even when no further camera frames arrive");
  assert.equal(h.ambientLeaseCount, 0, "selection timeout releases its ambient-motion lease");
}

// A fresh JS receipt can still be too old in the native capture clock. Keep the
// authoritative rejection, without inferring it from whether the image changed.
{
  const h = createHarness();
  await startSelection(h);
  const requestId = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  h.emit("onObjectPreview", preview(requestId, "boundary", 9_000_000));
  h.now += 500;
  assert.equal(await h.runtime.selectObjectAttention("boundary", selectedRect), true,
    "the receive-time boundary does not subtract native timestamps from the JS clock");
  h.runtime.stopObjectAttention();
}

for (const [nativeResult, expectedStatus, expectedReason] of [
  [{ accepted: false, reason: "selection-stale" }, "selecting", "selection-stale"],
  [{ accepted: false, reason: "selection-invalid" }, "selecting", "selection-failed"],
  [{ accepted: false, reason: "tracking-failed" }, "selecting", "selection-failed"],
  [{ accepted: false, reason: "selection-unavailable" }, "error", "selection-unavailable"],
  [false, "selecting", "selection-failed"],
]) {
  let result = nativeResult;
  const h = createHarness({ objectTracking: async () => result });
  await startSelection(h);
  const requestId = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  const originalDeadline = stateOf(h).deadline;
  h.emit("onObjectPreview", preview(requestId, "same-frame", 9_000_000));
  assert.equal(await h.runtime.selectObjectAttention("same-frame", selectedRect), false);
  assert.equal(stateOf(h).status, expectedStatus);
  assert.equal(stateOf(h).reason, expectedReason);
  assert.equal(stateOf(h).gaze, null);
  if (expectedStatus === "selecting") {
    assert.equal(stateOf(h).preview?.frameId, "same-frame", "recovery reason does not depend on a frame ID change");
    assert.equal(stateOf(h).deadline, originalDeadline, "a rejection must not renew the selection window");
    assert.equal(h.ambientLeaseCount, 1);
    h.now += 200;
    h.emit("onObjectPreview", preview(requestId, "retry-frame", 9_000_250));
    assert.equal(stateOf(h).reason, null, "a new preview clears the old runtime rejection");
    result = { accepted: true };
    assert.equal(await h.runtime.selectObjectAttention("retry-frame", selectedRect), true);
    assert.equal(stateOf(h).status, "tracking", "a rejected selection can be deliberately retried from a new frame");
    h.runtime.stopObjectAttention();
  } else {
    assert.equal(stateOf(h).preview, null);
    assert.equal(h.ambientLeaseCount, 0, "unavailable native selection releases camera and motion leases");
    assert.equal(h.socialState.objectAttentionActive, false);
    assert.equal(h.nativeListenerCount, 0);
    assert.equal(h.activeTimerCount, 0);
  }
}

{
  const h = createHarness({ objectTracking: async () => ({ accepted: true }) });
  await startSelection(h);
  await selectFreshPreview(h);
  h.runtime.stopObjectAttention();
}

{
  const gate = deferred();
  const h = createHarness({ objectTracking: () => gate.promise });
  await startSelection(h);
  const oldRequest = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  h.emit("onObjectPreview", preview(oldRequest, "old-selection"));
  const pending = h.runtime.selectObjectAttention("old-selection", selectedRect);
  assert.equal(stateOf(h).status, "starting");
  h.runtime.stopObjectAttention();
  await h.runtime.startObjectAttentionSelection();
  const newRequest = h.nativeCalls.filter(([kind]) => kind === "start-selection").at(-1)[1];
  h.emit("onObjectPreview", preview(newRequest, "new-selection"));
  gate.resolve({ accepted: true });
  assert.equal(await pending, false);
  assert.equal(stateOf(h).status, "selecting");
  assert.equal(stateOf(h).preview?.frameId, "new-selection", "a delayed structured result cannot replace the newer selection");
  assert.deepEqual(h.nativeCalls.at(-1), ["stop-tracking", oldRequest]);
  assert.equal(h.socialState.objectAttentionActive, true, "stopping the old native request preserves the newer camera lease");
  assert.equal(h.ambientLeaseCount, 1);
  h.runtime.stopObjectAttention();
}

{
  const h = createHarness();
  await startSelection(h);
  const requestId = await selectFreshPreview(h);
  assert.equal(stateOf(h).status, "tracking");
  h.now += 10_000;
  h.runTimers();
  assert.equal(stateOf(h).status, "ended", "the ten-second tracking deadline is checked without new frames");
  assert.equal(stateOf(h).reason, "tracking-timeout");
  assert.equal(h.ambientLeaseCount, 0, "tracking timeout releases its ambient-motion lease");
  h.emit("onObjectTrack", track(requestId, { timestampMs: 101 }));
  assert.equal(stateOf(h).status, "ended", "a late event cannot revive an expired session");
}

for (const [name, stop] of [
  ["privacy disabled", (h) => h.userStore.setState({ preferences: { cameraAttentionEnabled: false } })],
  ["app backgrounded", (h) => { h.appState = "background"; }],
  ["main screen blurred", (h) => h.setFocused(false)],
  ["external social owner ended lease", (h) => h.emitSocialEnd("interrupted")],
]) {
  const h = createHarness();
  await startSelection(h);
  await selectFreshPreview(h);
  stop(h);
  assert.equal(stateOf(h).status, "ended", `${name} ends the object lease`);
  assert.equal(stateOf(h).reason, name === "privacy disabled" ? "camera-disabled" : "interrupted");
  assert.equal(stateOf(h).gaze, null);
  assert.equal(h.socialState.objectAttentionActive, false);
  assert.equal(h.ambientLeaseCount, 0, `${name} releases the ambient-motion lease`);
  const staleRequest = h.nativeCalls.find(([kind]) => kind === "start-selection")[1];
  h.emit("onObjectTrack", track(staleRequest, { timestampMs: 101 }));
  assert.equal(stateOf(h).status, "ended", "frames after lifecycle teardown are ignored");
  assert.equal(h.activeTimerCount, 0);
  assert.equal(h.nativeListenerCount, 0);
}

{
  const gate = deferred();
  const entered = deferred();
  const h = createHarness({ objectSelection: async () => { entered.resolve(); return await gate.promise; } });
  const start = h.runtime.startObjectAttentionSelection();
  await entered.promise;
  assert.equal(stateOf(h).status, "selecting");
  assert.equal(h.ambientLeaseCount, 1);
  h.runtime.stopObjectAttention();
  assert.equal(h.ambientLeaseCount, 0, "explicit cancellation releases ambient motion immediately");
  gate.resolve(true);
  await start;
  assert.equal(stateOf(h).status, "ended", "a delayed native start cannot restore a stopped selection");
  assert.deepEqual(h.nativeCalls.at(-1), ["stop-tracking", h.nativeCalls.find(([kind]) => kind === "start-selection")[1]],
    "late native completion is immediately stopped for its own request id");
  assert.equal(h.activeTimerCount, 0);
}

{
  const gate = deferred();
  const h = createHarness({ permission: () => gate.promise });
  const start = h.runtime.startObjectAttentionSelection();
  await flushMicrotasks();
  assert.equal(stateOf(h).status, "preparing");
  h.runtime.stopObjectAttention();
  assert.equal(h.ambientLeaseCount, 0, "a canceled permission prompt owns no ambient-motion lease");
  gate.resolve(true);
  await start;
  assert.equal(h.socialCalls.some(([kind]) => kind === "acquire"), false,
    "cancelling the permission prompt prevents a later camera lease");
  assert.equal(h.nativeCalls.some(([kind]) => kind.startsWith("start-")), false);
  assert.equal(stateOf(h).status, "ended");
}

for (const overrides of [
  { nativeObjectApi: false },
  { trackingSupported: false },
]) {
  const h = createHarness(overrides);
  await h.runtime.startObjectAttentionSelection();
  assert.equal(stateOf(h).status, "unsupported");
  assert.equal(h.ambientLeaseCount, 0, "unsupported paths do not retain ambient motion");
  assert.equal(h.nativeCalls.some(([kind]) => kind === "start-selection" || kind === "start-tracking"), false,
    "legacy or unavailable native tracking is never started");
  assert.equal(h.robotSideEffects.length, 0);
}

console.log("Object attention runtime lifecycle tests passed");
