import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function harness() {
  const events = [];
  const state = { currentState: "active" };
  const failures = new Set();
  const hooks = { syncGate: null, syncStarted: deferred(), cameraGate: null, cameraStarted: deferred(), prewarm: null };
  let capturing = false;
  const record = (name) => { events.push(name); if (failures.has(name)) throw new Error(`${name} failed`); };
  const feeder = {
    isRunning: false, diagnosticStatus: {},
    setAppCaptureAllowed(value) { record(`captureAllowed:${value}`); },
    async stop() { capturing = false; record("captureStop"); },
  };
  const voice = {
    async sync() {
      if (!hooks.syncGate) return;
      hooks.syncStarted.resolve();
      await hooks.syncGate.promise;
      capturing = true;
      record("syncFinished");
    },
  };
  const dependencies = {
    "react-native": { AppState: state },
    "./perceiver-manager": { perceiverManager: {
      register() {}, async start() {}, getRegisteredNames: () => ["voice"],
      async stopAll() { capturing = false; record("voiceStop"); },
    } },
    "../perceivers/voice-runtime": { voiceRuntime: voice },
    "../store/user": {
      useUserStore: { getState: () => ({ robotSleeping: false, preferences: {}, setVoiceState() {} }) },
      isRealtimeConversationMode: () => false,
    },
    "./voice-runtime-recovery": { async recoverWakewordRuntime() {} },
    "../voice/lazy-services": { getLoadedSttModule: () => null, getLoadedTtsModule: () => null },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent(_, name, details) { events.push({ name, details }); } },
    "../diagnostics/performance-monitor": { async recordPerformanceSnapshot() {} },
    "expo-audio": { async setIsAudioActiveAsync(value) { record(`audioActive:${value}`); } },
    "./main-screen-presence": { isMainScreenFocused: () => false },
    "../device-tools/looi-robot-autoconnect": {
      async suspendLooiRobotAutoConnection() { record("bleStop"); }, async resumeLooiRobotAutoConnection() {},
    },
    "../voice/retired-experimental-voice-assets": { async removeRetiredExperimentalVoiceAssets() {} },
    "./legacy-network-credentials-retirement": { async retireLegacyNetworkCredentials() {} },
    "./ambient-motion": { startAmbientMotionController() {}, stopAmbientMotionController() { record("ambientStop"); } },
    "./social-attention": { startSocialAttentionController() {}, async stopSocialAttentionController() {
      record("cameraStop"); hooks.cameraStarted.resolve(); await hooks.cameraGate?.promise;
    } },
    "../voice/wakeword": { wakewordService: { isListening: false } },
    "../voice/stt": { sttService: { async initialize() { record("sttInitialize"); } } },
  };
  Object.defineProperty(dependencies, "../voice/kws-audio-feeder", {
    get() { record("loadCapture"); return { kwsAudioFeeder: feeder }; },
  });
  const app = loadTypeScript("src/core/app-bootstrap.ts", dependencies, {
    process: { env: {} }, setTimeout(callback) { hooks.prewarm = callback; return 1; },
  });
  return { app, state, failures, events, hooks, capturing: () => capturing };
}

for (const failingComponent of ["ambientStop", "cameraStop", "loadCapture"]) {
  test(`${failingComponent} failure does not skip the remaining suspend work`, async () => {
    const h = harness();
    await h.app.bootstrapApp();
    h.events.length = 0;
    h.failures.add(failingComponent);
    h.state.currentState = "background";
    await h.app.pauseAppRuntime();
    assert.ok(h.events.includes("bleStop"));
    assert.ok(h.events.includes("voiceStop"));
    assert.ok(h.events.includes("audioActive:false"));
    assert.ok(h.events.some((event) => event?.name === "runtime-component-stop-failed"));
  });
}

test("pending settings synchronization finishes before suspend tears voice down", async () => {
  const h = harness();
  await h.app.bootstrapApp();
  h.events.length = 0;
  h.hooks.syncGate = deferred();
  const sync = h.app.syncVoiceRuntime();
  await h.hooks.syncStarted.promise;
  h.state.currentState = "background";
  const paused = h.app.pauseAppRuntime();
  // Allow independently queued teardown to progress before releasing sync.
  for (let index = 0; index < 40; index++) await Promise.resolve();
  h.hooks.syncGate.resolve();
  await Promise.all([sync, paused]);
  assert.equal(h.capturing(), false);
  assert.ok(h.events.lastIndexOf("voiceStop") > h.events.indexOf("syncFinished"));
});

test("a settings sync requested after suspend cannot restart voice", async () => {
  const h = harness();
  await h.app.bootstrapApp();
  h.events.length = 0;
  h.state.currentState = "background";
  h.hooks.syncGate = deferred(); h.hooks.syncGate.resolve();
  const paused = h.app.pauseAppRuntime();
  await Promise.all([paused, h.app.syncVoiceRuntime()]);
  assert.equal(h.events.includes("syncFinished"), false);
  assert.equal(h.capturing(), false);
});

test("audio deactivation waits for the camera's asynchronous teardown", async () => {
  const h = harness();
  await h.app.bootstrapApp();
  h.events.length = 0;
  h.hooks.cameraGate = deferred();
  h.state.currentState = "background";
  const paused = h.app.pauseAppRuntime();
  await h.hooks.cameraStarted.promise;
  assert.equal(h.events.includes("audioActive:false"), false);
  h.hooks.cameraGate.resolve();
  await paused;
  assert.ok(h.events.includes("audioActive:false"));
});

for (const transition of ["before-timer", "during-import"]) {
  test(`offline STT prewarm skips background work ${transition}`, async () => {
    const h = harness();
    await h.app.bootstrapApp();
    if (transition === "before-timer") h.state.currentState = "background";
    h.hooks.prewarm();
    h.state.currentState = "background";
    for (let index = 0; index < 20; index++) await Promise.resolve();
    assert.equal(h.events.includes("sttInitialize"), false);
  });
}
