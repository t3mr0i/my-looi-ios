import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function load(file, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const names = Object.keys(globals);
  new Function("require", "module", "exports", ...names, output)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

// Two clients racing a native asynchronous start must never acquire two mics.
const { createCaptureController } = load("src/voice/capture-owner.ts");
let releaseStart;
let starts = 0;
let stops = 0;
let failStart = false;
let failStop = false;
const driver = {
  async start() {
    starts++;
    if (failStart) throw new Error("capture failed");
    if (starts === 1) await new Promise((resolve) => { releaseStart = resolve; });
    return { running: true };
  },
  async stop() { stops++; if (failStop) throw new Error("teardown failed"); return { running: false }; },
  async status() { return { running: true }; },
};
const capture = createCaptureController(driver);
const first = capture.start("conversation");
const competing = capture.start("capture-only");
const rejected = assert.rejects(competing, /already in use/);
await Promise.resolve();
releaseStart();
assert.deepEqual(await first, { running: true });
await rejected;
assert.equal(starts, 1);
await capture.stop("capture-only");
assert.equal(stops, 0, "A different adapter cannot stop the active capture");
failStop = true;
await assert.rejects(capture.stop("conversation"), /teardown failed/);
await assert.rejects(capture.start("capture-only"), /already in use/);
failStop = false;
await capture.stop("conversation");

await capture.reserve("conversation");
await assert.rejects(capture.start("capture-only"), /already in use/);
await capture.stop("conversation");
await capture.start("capture-only");
await capture.stop("capture-only");
failStart = true;
await assert.rejects(capture.start("capture-only"), /capture failed/);
failStart = false;
assert.deepEqual(await capture.start("conversation"), { running: true });
await capture.stop("conversation");

// The camera permission gate respects permanent denials and checks revocation.
let permission = { granted: true, canAskAgain: true };
let requests = 0;
const { requestCameraAccess } = load("src/permissions/camera.ts", {
  "expo-camera": { Camera: {
    async getCameraPermissionsAsync() { return permission; },
    async requestCameraPermissionsAsync() { requests++; return { granted: true }; },
  } },
});
assert.equal(await requestCameraAccess(), true);
assert.equal(requests, 0);
permission = { granted: false, canAskAgain: false };
assert.equal(await requestCameraAccess(), false);
assert.equal(requests, 0);
permission = { granted: false, canAskAgain: true };
assert.equal(await requestCameraAccess(), true);
assert.equal(requests, 1);

// The compatibility capture adapter forwards data once, not once per native
// subscription, and notifies every subscriber when capture fails.
const nativeListeners = {};
let adapterStops = 0;
const nativeStatus = { supported: true, captureRunning: false, captureSampleRate: 16000,
  audioSource: "VOICE_PROCESSING_IO", audioSessionId: null, aecAvailable: true,
  aecEnabled: false, captureChunks: 0, captureFrames: 0 };
const rawAudio = {
  async getStatus() { return { ...nativeStatus }; },
  addListener(event, listener) { nativeListeners[event] = listener; return { remove() {} }; },
};
const localCapture = load("modules/local-realtime-audio-capture/index.ts", {
  "react-native": { Platform: { OS: "ios" } },
  expo: { requireNativeModule() { throw new Error("iOS must use the shared PCM adapter"); } },
  "./realtime-pcm": {
    getRealtimePcmAudioModule: () => rawAudio,
    async startPcmCapture(owner) {
      assert.equal(owner, "capture-only");
      nativeStatus.captureRunning = true; nativeStatus.aecEnabled = true;
      return { ...nativeStatus };
    },
    async stopPcmCapture(owner) {
      assert.equal(owner, "capture-only"); adapterStops++;
      nativeStatus.captureRunning = false;
      return { ...nativeStatus };
    },
  },
}).getLocalRealtimeAudioCaptureModule();
let delivered = 0;
let errors = 0;
const subscription = localCapture.addListener("onAudioData", () => delivered++);
localCapture.addListener("onAudioData", () => delivered++);
localCapture.addListener("onCaptureError", () => errors++);
localCapture.addListener("onCaptureError", () => errors++);
assert.equal((await localCapture.start()).running, true);
nativeStatus.captureFrames = 640; nativeStatus.captureChunks = 1;
nativeListeners.onAudioData({ frames: 640 });
assert.equal(delivered, 2);
assert.equal((await localCapture.getStatus()).framesCaptured, 640);
subscription.remove();
nativeListeners.onCaptureError({ stage: "interruption", message: "phone call" });
await Promise.resolve();
assert.equal(errors, 2);
assert.equal(adapterStops, 1);
nativeListeners.onAudioData({ frames: 640 });
assert.equal(delivered, 2, "No audio is forwarded after teardown");
assert.equal((await localCapture.getStatus()).running, false);

// iOS simulators and stale development clients follow the same opt-in rule as
// Android emulators. A physical iPhone retains normal hands-free behavior.
for (const [native, expected] of [[{ isSimulator: true }, false], [null, false], [{ isSimulator: false }, true]]) {
  const profile = load("src/core/runtime-profile.ts", {
    "react-native": { Platform: { OS: "ios", constants: {} } },
    expo: { requireOptionalNativeModule: () => native },
  }, { process: { env: {} } }).getRuntimeProfile();
  assert.equal(profile.allowsWakewordAutostart, expected);
}

// iOS diagnosis records real RSS without converting missing Android metrics to
// zero, and foreground restoration must not count suspended time as a JS stall.
const records = [];
const timers = new Map();
let clock = 1000;
let onStateChange;
let removed = 0;
const appState = {
  currentState: "active",
  addEventListener(_, callback) { onStateChange = callback; return { remove() { removed++; } }; },
};
const monitor = load("src/diagnostics/performance-monitor.ts", {
  "react-native": { Platform: { OS: "ios" }, AppState: appState },
  "../../modules/diagnostic-archive": {
    async getDiagnosticPerformanceSnapshot() {
      return { platform: "ios", pid: 42, pssKb: null, rssKb: 8192 };
    },
    async getPreviousProcessExitReasons() { throw new Error("Android-only API must not be called"); },
  },
  "./diagnostic-log": { recordDiagnosticEvent: (category, event, details) => records.push({ category, event, details }) },
}, {
  setInterval(callback, interval) { timers.set(interval, callback); return interval; },
  clearInterval(id) { timers.delete(id); },
  Date: { now: () => clock },
});
monitor.startPerformanceMonitor();
monitor.startPerformanceMonitor();
await Promise.resolve();
assert.equal(timers.size, 2);
const snapshot = records.find((record) => record.event === "memory-snapshot");
assert.equal(snapshot.details.rssMb, 8);
assert.equal(snapshot.details.pssMb, null);
assert.equal(snapshot.details.javaHeapUsedMb, null);
appState.currentState = "background";
onStateChange();
clock += 10000;
timers.get(250)();
appState.currentState = "active";
onStateChange();
clock += 250;
timers.get(250)();
assert.equal(records.filter((record) => record.event === "js-event-loop-stall").length, 0);
clock += 1000;
timers.get(250)();
assert.equal(records.filter((record) => record.event === "js-event-loop-stall").length, 1);
monitor.stopPerformanceMonitor();
assert.equal(timers.size, 0);
assert.equal(removed, 1);
// A background transition while bootstrap awaits a native operation must run
// teardown after it, without starting camera/idle movement in the background.
let releaseVoiceStart;
let holdVoiceStart = true;
let holdAudioActivation = false;
let releaseAudioActivation;
const bootEvents = [];
const bootState = { currentState: "active" };
const feeder = {
  diagnosticStatus: {},
  setAppCaptureAllowed(value) { bootEvents.push(["captureAllowed", value]); },
  async stop() { bootEvents.push(["captureStop"]); },
};
const user = { robotSleeping: false, preferences: {}, setVoiceState() {} };
const bootstrap = load("src/core/app-bootstrap.ts", {
  "react-native": { AppState: bootState },
  "./perceiver-manager": { perceiverManager: {
    register() { bootEvents.push(["register"]); },
    async start() { if (holdVoiceStart) await new Promise((resolve) => { releaseVoiceStart = resolve; }); },
    async stopAll() { bootEvents.push(["voiceStop"]); },
    getRegisteredNames: () => ["voice"],
  } },
  "../perceivers/voice-runtime": { voiceRuntime: { async sync() { bootEvents.push(["voiceSync"]); } } },
  "../store/user": { useUserStore: { getState: () => user }, isRealtimeConversationMode: () => false },
  "../store/conversation": { useConversationStore: { getState: () => ({}) } },
  "./runtime-profile": { getRuntimeProfile: () => ({ allowsWakewordAutostart: false }) },
  "../voice/lazy-services": { getLoadedSttModule: () => null, getLoadedTtsModule: () => null },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../diagnostics/performance-monitor": { async recordPerformanceSnapshot() {} },
  "expo-audio": { async setIsAudioActiveAsync(value) {
    bootEvents.push(["audioActive", value]);
    if (value && holdAudioActivation) await new Promise((resolve) => { releaseAudioActivation = resolve; });
  } },
  "./main-screen-presence": { isMainScreenFocused: () => false },
  "../device-tools/looi-robot-autoconnect": {
    async suspendLooiRobotAutoConnection() { bootEvents.push(["bleStop"]); },
    async resumeLooiRobotAutoConnection() { bootEvents.push(["bleResume"]); },
  },
  "../voice/retired-experimental-voice-assets": { async removeRetiredExperimentalVoiceAssets() {} },
  "./legacy-network-credentials-retirement": { async retireLegacyNetworkCredentials() {} },
  "./ambient-motion": { startAmbientMotionController() { bootEvents.push(["ambientStart"]); }, stopAmbientMotionController() {} },
  "./social-attention": { startSocialAttentionController() { bootEvents.push(["cameraStart"]); }, async stopSocialAttentionController() {} },
  "../voice/kws-audio-feeder": { kwsAudioFeeder: feeder },
  "../voice/wakeword": { wakewordService: { isListening: false } },
  "../voice/realtime-conversation": { realtimeConversationService: { isActive: false } },
}, { process: { env: {} } });
const boot = bootstrap.bootstrapApp();
assert.equal(bootstrap.bootstrapApp(), boot, "Bootstrap must be coalesced");
for (let index = 0; index < 10 && !releaseVoiceStart; index++) await Promise.resolve();
assert.equal(typeof releaseVoiceStart, "function");
bootState.currentState = "background";
const paused = bootstrap.pauseAppRuntime();
releaseVoiceStart();
await Promise.all([boot, paused]);
assert.equal(bootEvents.filter(([event]) => event === "register").length, 1);
assert.equal(bootEvents.some(([event]) => event === "ambientStart" || event === "cameraStart" || event === "voiceSync"), false);
assert.ok(bootEvents.some(([event]) => event === "captureStop"));
assert.ok(bootEvents.some(([event]) => event === "bleStop"));
assert.deepEqual(bootEvents.at(-1), ["audioActive", false]);

// Resuming is another asynchronous startup. A second background/sleep event
// must prevent camera, movement, capture re-enable and BLE reconnect at each
// await boundary, including while audio activation itself is pending.
bootEvents.length = 0;
bootState.currentState = "active";
releaseVoiceStart = null;
const resuming = bootstrap.resumeAppRuntime();
for (let index = 0; index < 30 && !releaseVoiceStart; index++) await Promise.resolve();
assert.equal(typeof releaseVoiceStart, "function");
bootState.currentState = "background";
const pausedAgain = bootstrap.pauseAppRuntime();
releaseVoiceStart();
await Promise.all([resuming, pausedAgain]);
assert.equal(bootEvents.some(([event]) => event === "ambientStart" || event === "cameraStart"), false);
assert.deepEqual(bootEvents.at(-1), ["audioActive", false]);

bootEvents.length = 0;
bootState.currentState = "active";
holdAudioActivation = true;
const activatingAudio = bootstrap.resumeAppRuntime();
for (let index = 0; index < 30 && !releaseAudioActivation; index++) await Promise.resolve();
assert.equal(typeof releaseAudioActivation, "function");
user.robotSleeping = true;
const sleeping = bootstrap.pauseAppRuntime("sleep");
releaseAudioActivation();
await Promise.all([activatingAudio, sleeping]);
assert.equal(bootEvents.some(([event, value]) => event === "captureAllowed" && value === true), false);
assert.ok(bootEvents.some(([event]) => event === "captureStop"));
assert.deepEqual(bootEvents.at(-1), ["audioActive", false], "an interrupted audio activation must still be deactivated");

// Fast inactive->active transitions (for example a permission sheet) must not
// skip the pause and leave the synchronously suspended BLE runtime stranded.
user.robotSleeping = false;
holdAudioActivation = false;
holdVoiceStart = false;
await bootstrap.resumeAppRuntime();
bootEvents.length = 0;
bootState.currentState = "inactive";
const fastPause = bootstrap.pauseAppRuntime();
bootState.currentState = "active";
const fastResume = bootstrap.resumeAppRuntime();
await Promise.all([fastPause, fastResume]);
assert.ok(bootEvents.findIndex(([event]) => event === "bleStop") >= 0);
assert.ok(bootEvents.findIndex(([event]) => event === "bleResume") > bootEvents.findIndex(([event]) => event === "bleStop"));
assert.deepEqual(bootEvents.filter(([event]) => event === "audioActive"), [["audioActive", false], ["audioActive", true]]);
console.log("iOS runtime behavior: audio ownership, permissions, simulator, diagnosis and lifecycle passed");
