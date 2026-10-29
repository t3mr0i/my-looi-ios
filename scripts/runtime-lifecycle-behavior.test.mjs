import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function harness() {
  const events = [];
  const state = { currentState: "active" };
  const userState = { robotSleeping: false };
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
    mediaOwner: null,
    get isMediaExternallyOwned() { return this.mediaOwner !== null; },
    blockForExternalMedia(owner) { if (this.mediaOwner && this.mediaOwner !== owner) throw new Error("busy"); this.mediaOwner = owner; },
    releaseExternalMedia(owner) { if (this.mediaOwner === owner) this.mediaOwner = null; },
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
      useUserStore: { getState: () => ({ robotSleeping: userState.robotSleeping, preferences: {}, setVoiceState() {} }) },
      isManagedConversationMode: () => false,
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
  return { app, state, userState, failures, events, hooks, voice, capturing: () => capturing };
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

test("robot media transfer releases capture and camera while retaining BLE", async () => {
  const h = harness();
  await h.app.bootstrapApp(); h.events.length = 0;
  await h.app.acquireExternalMediaOwnership("reachy-media", new AbortController().signal);
  assert.equal(h.voice.isMediaExternallyOwned, true);
  assert.ok(h.events.includes("cameraStop"));
  assert.ok(h.events.includes("captureStop"));
  assert.ok(h.events.includes("voiceStop"));
  assert.ok(h.events.includes("audioActive:false"));
  assert.equal(h.events.includes("bleStop"), false, "external app retains its existing BLE execution path");
  h.events.length = 0;
  await h.app.syncVoiceRuntime();
  assert.equal(h.events.includes("loadCapture"), false, "settings synchronization cannot steal external capture");
  await h.app.releaseExternalMediaOwnership("reachy-media");
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.ok(h.events.includes("audioActive:true"));
});

test("failed camera release refuses external media instead of creating a second owner", async () => {
  const h = harness(); await h.app.bootstrapApp();
  h.failures.add("cameraStop");
  await assert.rejects(h.app.acquireExternalMediaOwnership("failed-media", new AbortController().signal), /could not be released/);
  assert.equal(h.voice.isMediaExternallyOwned, false);
});

test("external media release in background does not reactivate normal audio", async () => {
  const h = harness(); await h.app.bootstrapApp();
  await h.app.acquireExternalMediaOwnership("background-media", new AbortController().signal);
  h.state.currentState = "background";
  await h.app.pauseAppRuntime(); h.events.length = 0;
  await h.app.releaseExternalMediaOwnership("background-media");
  assert.equal(h.events.includes("audioActive:true"), false);
});

test("synchronous external-media admission prevents cold-start capture before robot-app mount", async () => {
  const h = harness();
  const owner = "debug-robot-app";
  const ownership = h.app.acquireExternalMediaOwnership(owner, new AbortController().signal);
  assert.equal(h.voice.isMediaExternallyOwned, true, "ownership is admitted synchronously before bootstrap starts");
  const bootstrap = h.app.bootstrapApp();
  await Promise.all([ownership, bootstrap]);

  assert.equal(h.voice.isMediaExternallyOwned, true);
  assert.equal(h.events.includes("audioActive:true"), false, "cold bootstrap must not activate app audio under the external owner");
  assert.ok(h.events.includes("audioActive:false"));
  assert.ok(h.events.includes("captureStop"));
  assert.ok(h.events.includes("cameraStop"));
  assert.ok(h.events.includes("voiceStop"));
  assert.equal(h.events.includes("bleStop"), false, "media ownership leaves the mock robot's BLE path alone");

  h.events.length = 0;
  h.hooks.syncGate = deferred(); h.hooks.syncGate.resolve();
  await h.app.releaseExternalMediaOwnership(owner);
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.ok(h.events.includes("audioActive:true"), "release in the awake foreground restores audio");
  assert.ok(h.events.includes("syncFinished"), "release restarts the voice runtime after bootstrap");
  assert.equal(h.capturing(), true);
  assert.equal(h.events.includes("bleStop"), false);
});

test("aborted queued media admission releases its owner gate so a later bootstrap can capture", async () => {
  const h = harness();
  h.hooks.cameraGate = deferred();
  const controller = new AbortController();
  const ownership = h.app.acquireExternalMediaOwnership("cancelled-robot-app", controller.signal, { allowWhileSleeping: true });
  assert.equal(h.voice.isMediaExternallyOwned, true, "the owner gate closes synchronously");
  await h.hooks.cameraStarted.promise;
  controller.abort();
  h.hooks.cameraGate.resolve();
  await assert.rejects(ownership, /cancelled/u);
  assert.equal(h.voice.isMediaExternallyOwned, false, "failed admission releases its owner gate");

  h.events.length = 0;
  h.hooks.syncGate = deferred(); h.hooks.syncGate.resolve();
  await h.app.bootstrapApp();
  assert.ok(h.events.includes("audioActive:true"), "a later awake bootstrap restores app audio");
  assert.ok(h.events.includes("syncFinished"), "a later bootstrap can restart voice capture");
  assert.equal(h.capturing(), true, "capture is not left stuck behind the cancelled owner");
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.equal(h.events.includes("bleStop"), false);
});

test("normal robot-app media ownership remains blocked while LOOI is sleeping", async () => {
  const h = harness();
  h.userState.robotSleeping = true;
  await assert.rejects(h.app.acquireExternalMediaOwnership("reachy-media", new AbortController().signal), /suspended/u);
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.deepEqual(h.events, [], "the default lease does not begin teardown while sleeping");
});

test("debug sleep override still refuses an acquisition outside the foreground", async () => {
  const h = harness();
  h.userState.robotSleeping = true;
  h.state.currentState = "background";
  await assert.rejects(h.app.acquireExternalMediaOwnership("debug-robot-app", new AbortController().signal, { allowWhileSleeping: true }), /suspended/u);
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.deepEqual(h.events, []);
});

test("debug media lease may be acquired while LOOI sleeps without activating capture", async () => {
  const h = harness();
  h.userState.robotSleeping = true;
  await h.app.bootstrapApp();
  const owner = "debug-robot-app";
  await h.app.acquireExternalMediaOwnership(owner, new AbortController().signal, { allowWhileSleeping: true });
  assert.equal(h.voice.isMediaExternallyOwned, true);
  assert.ok(h.events.includes("captureStop"));
  assert.ok(h.events.includes("cameraStop"));
  assert.ok(h.events.includes("audioActive:false"));
  assert.equal(h.events.includes("audioActive:true"), false);
  assert.equal(h.events.includes("bleStop"), false);
  assert.equal(h.capturing(), false);
});

test("releasing a debug media lease while sleeping does not reactivate audio or capture", async () => {
  const h = harness();
  await h.app.bootstrapApp();
  await h.app.acquireExternalMediaOwnership("debug-robot-app", new AbortController().signal, { allowWhileSleeping: true });
  h.userState.robotSleeping = true;
  await h.app.pauseAppRuntime("sleep");
  h.events.length = 0;
  await h.app.releaseExternalMediaOwnership("debug-robot-app");
  assert.equal(h.voice.isMediaExternallyOwned, false);
  assert.equal(h.events.includes("audioActive:true"), false);
  assert.equal(h.events.includes("captureAllowed:true"), false);
  assert.equal(h.capturing(), false);
});

test("waking while a debug media lease remains owned keeps normal capture disabled", async () => {
  const h = harness();
  await h.app.bootstrapApp();
  const owner = "debug-robot-app";
  await h.app.acquireExternalMediaOwnership(owner, new AbortController().signal, { allowWhileSleeping: true });
  h.userState.robotSleeping = true;
  await h.app.pauseAppRuntime("sleep");

  h.events.length = 0;
  h.userState.robotSleeping = false;
  await h.app.resumeAppRuntime();
  assert.equal(h.voice.isMediaExternallyOwned, true);
  assert.equal(h.events.includes("audioActive:true"), false);
  assert.equal(h.events.includes("captureAllowed:true"), false);
  assert.equal(h.events.includes("syncFinished"), false);
  assert.equal(h.capturing(), false);

  h.hooks.syncGate = deferred(); h.hooks.syncGate.resolve();
  await h.app.releaseExternalMediaOwnership(owner);
  assert.ok(h.events.includes("audioActive:true"), "normal runtime resumes after the debug owner releases while awake");
  assert.ok(h.events.includes("syncFinished"));
  assert.equal(h.capturing(), true);
});
