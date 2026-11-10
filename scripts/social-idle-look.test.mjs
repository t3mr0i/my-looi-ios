import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";

// Idle autonomy's camera hook in social attention: it keeps the camera looking
// while requested, never arms camera-driven motion and releases cleanly.
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
  use.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return use;
}

function createHarness({ cameraAttentionEnabled = true } = {}) {
  const clock = new VirtualClock();
  const events = new Map();
  const motion = [];
  let startCalls = 0;
  let stopCalls = 0;
  const native = {
    addListener(name, callback) {
      const callbacks = events.get(name) ?? new Set();
      callbacks.add(callback);
      events.set(name, callbacks);
      return { remove: () => callbacks.delete(callback) };
    },
    async start() { startCalls += 1; return { running: true, signalAnalysisSupported: false, objectTrackingSupported: false, permissionGranted: true, lensFacing: "front" }; },
    async stop() { stopCalls += 1; return { running: false }; },
  };
  const userStore = createStore({ preferences: { cameraAttentionEnabled }, robotSleeping: false });
  const conversationStore = createStore({ isUserSpeaking: false, isProcessing: false, isSpeaking: false });
  const module = loadTypeScript("src/core/social-attention.ts", {
    zustand: { create: (initializer) => createStore(initializer()) },
    "../../modules/local-face-attention": { getLocalFaceAttentionModule: () => native, setLocalInteractionSignalsEnabled: async () => false },
    "../device-tools/looi-robot": {
      getLooiRobotRuntimeState: () => ({ connected: true, driveControlReady: true, motionActive: false }),
      performLooiSocialAttentionPivot: async (...args) => { motion.push(["pivot", ...args]); return { completed: true }; },
      setLooiHead: async (...args) => { motion.push(["head", args[0]]); return { completed: true }; },
    },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../store/conversation": { useConversationStore: conversationStore },
    "../store/user": { useUserStore: userStore },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "./ambient-motion": {
      getAmbientMotionControllerState: () => ({ actionInFlight: false, currentAction: null }),
      holdAmbientHeadMotionFor() {},
      holdAmbientMotionFor() {},
    },
    "./main-screen-presence": { isMainScreenFocused: () => true, subscribeMainScreenFocused: () => () => {} },
    "./face-target-tracking": {
      createFaceTargetTracker: () => ({ update: (faces) => faces.map((face, index) => ({ ...face, id: `face-${index}` })), reset() {} }),
    },
  }, clock.globals());
  return {
    module, clock, conversationStore, userStore, motion,
    get startCalls() { return startCalls; },
    get stopCalls() { return stopCalls; },
    frame(centerX, centerY = 0.5) {
      const face = { left: centerX - 0.1, right: centerX + 0.1, top: centerY - 0.15, bottom: centerY + 0.15, centerX, centerY, width: 0.2, height: 0.3 };
      for (const callback of events.get("onFaceFrame") ?? []) callback({ timestampMs: clock.now, faceCount: 1, primary: face, faces: [face] });
    },
  };
}

{
  const h = createHarness();
  h.module.startSocialAttentionController("test");
  h.module.setSocialIdleLookRequested(true);
  await h.clock.advanceTo(h.clock.now + 100);
  let state = h.module.getSocialAttentionControllerState();
  assert.deepEqual([state.attentionActive, state.nativeStarted, state.motionArmed, state.idleLookRequested], [true, true, false, true]);
  assert.equal(h.startCalls, 1);

  // A face far off to one side, frame after frame: no camera-driven head or body motion.
  for (let index = 0; index < 20; index += 1) { h.frame(0.05, 0.1); await h.clock.advanceTo(h.clock.now + 120); }
  assert.deepEqual(h.motion, [], "idle looking never moves the robot by itself");
  assert.equal(h.module.getSocialAttentionControllerState().faceVisible, true, "faces are still seen");

  // Repeated requests are idempotent and the release grace does not stop a requested camera.
  h.module.setSocialIdleLookRequested(true);
  h.conversationStore.setState({ isSpeaking: true });
  h.conversationStore.setState({ isSpeaking: false });
  await h.clock.advanceTo(h.clock.now + 30_000);
  assert.equal(h.startCalls, 1);
  assert.equal(h.stopCalls, 0, "a requested camera stays on after the conversation grace");

  h.module.setSocialIdleLookRequested(false);
  await h.clock.advanceTo(h.clock.now + 100);
  state = h.module.getSocialAttentionControllerState();
  assert.deepEqual([state.attentionActive, state.nativeStarted, h.stopCalls], [false, false, 1], "released at once");
  await h.module.stopSocialAttentionController("test");
}

{
  // Motion armed by an earlier conversation is dropped when only idle looking keeps the camera.
  const h = createHarness();
  h.module.startSocialAttentionController("test");
  h.conversationStore.setState({ isSpeaking: true });
  await h.clock.advanceTo(h.clock.now + 100);
  assert.equal(h.module.getSocialAttentionControllerState().motionArmed, true);
  h.conversationStore.setState({ isSpeaking: false });
  h.module.setSocialIdleLookRequested(true);
  assert.equal(h.module.getSocialAttentionControllerState().motionArmed, false);
  await h.clock.advanceTo(h.clock.now + 10_000);
  for (let index = 0; index < 20; index += 1) { h.frame(0.05); await h.clock.advanceTo(h.clock.now + 120); }
  assert.deepEqual(h.motion, []);
  await h.module.stopSocialAttentionController("test");
  assert.equal(h.module.getSocialAttentionControllerState().idleLookRequested, false);
}

{
  // Without the user's camera opt-in nothing starts.
  const h = createHarness({ cameraAttentionEnabled: false });
  h.module.startSocialAttentionController("test");
  h.module.setSocialIdleLookRequested(true);
  await h.clock.advanceTo(h.clock.now + 1_000);
  assert.equal(h.startCalls, 0);
  assert.equal(h.module.getSocialAttentionControllerState().attentionActive, false);
  await h.module.stopSocialAttentionController("test");
}

console.log("Social attention idle look: camera without motion, survives conversation grace, releases, respects opt-in PASS");
