import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { normalizeRobotBridgeDeviceUrl } = loadTypeScript("src/robot-bridge/device-connection.ts", { "./gateway": {} });
const appMediaServices = loadTypeScript("src/robot-bridge/app-media-services.ts");
const actionProfile = loadTypeScript("src/robot-bridge/action-profile.ts", { "./types": loadTypeScript("src/robot-bridge/types.ts") });

let saved = null, stateHandler, userHandler, robotHandler, snapshotHandler;
let savedActions = null;
let writeBarrier = null, autoConnectCentral = true, secureWrites = 0;
const deviceOptions = [], centralHosts = [], gatewayOptions = [];
const diagnostics = [];
let connects = 0, closes = 0, physicalStops = 0, entered = 0, exited = 0, interactions = 0;
let robotState = { stopGeneration: 0, safety: { lastSafetyStopReason: null } };
const userState = { robotSleeping: false };
const AppState = { currentState: "active", addEventListener(_event, listener) { stateHandler = listener; return { remove() {} }; } };
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
let backend, active = true;
let nativeMediaStatus = {
  phase: "idle", owner: null, request: null,
  camera: { supported: true, available: null, permission: "prompt" },
  microphone: { supported: true, available: null, permission: "prompt" },
  speaker: { supported: true, available: true },
};
const core = {
  subscribe(fn) { snapshotHandler = fn; return () => {}; },
  async setActive(next) { if (active === next) return; active = next; if (!next) { await this.stop("suspended"); snapshotHandler({ sessionId: null }); } },
  stop(reason) { return backend.stop(reason); },
  async dispose() { await this.stop("disposed"); },
};
const runtime = loadTypeScript("src/robot-bridge/runtime.ts", {
  "react-native": { AppState },
  "expo-secure-store": {
    getItemAsync: async key => key === "looi-robot-app-actions-v1" ? savedActions : saved,
    setItemAsync: async (key, value) => { if (writeBarrier) await writeBarrier; secureWrites++; if (key === "looi-robot-app-actions-v1") savedActions = value; else saved = value; },
    deleteItemAsync: async () => { saved = null; },
  },
  "./action-profile": actionProfile,
  "./core": { createRobotCore(value) { backend = value; return core; } },
  "./looi-backend": { createLooiBackend: () => ({ stop: async (reason) => {
    physicalStops++;
    if (reason.startsWith("robot-bridge:")) {
      robotState = { stopGeneration: robotState.stopGeneration + 1, safety: { lastSafetyStopReason: reason } };
      robotHandler?.();
    }
  } }) },
  "./device-connection": { normalizeRobotBridgeDeviceUrl, connectRobotBridgeDevice(_core, options) {
    connects++; deviceOptions.push(options); options.onStatus?.("connected");
    return { async close() { closes++; await core.stop("disconnected"); snapshotHandler({ sessionId: null }); } };
  } },
  "./gateway": { createRobotGateway: (_core, options) => { gatewayOptions.push(options); return { close: async () => {}, handleMessage: async () => [] }; } },
  "./app-media-services": appMediaServices,
  "../store/user": { useUserStore: { getState: () => userState, subscribe(fn) { userHandler = fn; return () => {}; } } },
  "../voice/driving-control-session": { enterDrivingControlSession() { entered++; }, exitDrivingControlSession() { exited++; } },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent(category, event, details = {}) { diagnostics.push({ category, event, details }); } },
  "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => robotState, subscribeLooiRobotRuntimeState(fn) { robotHandler = fn; return () => {}; } },
  "../core/robot-inactivity": { markRobotInteraction() { interactions++; } },
  "./media-broker": { createMediaBroker: () => ({ inspect: async () => nativeMediaStatus, subscribe: () => () => {}, stopAll: async () => {} }) },
  "./native-media": { createNativeMediaBackend: () => ({}) },
  "../core/app-bootstrap": { acquireExternalMediaOwnership: async () => {}, releaseExternalMediaOwnership: async () => {} },
  "expo/fetch": { fetch: async () => { throw new Error("Tests must not contact Central"); } },
  "./native-central": { createNativeCentralHost(options) {
    const host = { options, starts: 0, stops: 0, stopBarrier: null,
      async start() { this.starts++; options.onStatus("universal", { state: autoConnectCentral ? "connected" : "connecting", peerId: autoConnectCentral ? "native-peer" : null, sessionId: null, reconnectAttempt: 0 }); },
      async stop() { this.stops++; if (this.stopBarrier) await this.stopBarrier; options.onStatus("universal", { state: "stopped", peerId: null, sessionId: null, reconnectAttempt: 0 }); },
    };
    centralHosts.push(host); return host;
  } },
}, { setInterval: () => 1, clearInterval() {} });

const uninstall = runtime.installRobotBridgeRuntime();
await flush();
assert.equal(connects, 0); assert.equal(physicalStops, 0, "disabled bridge must not touch existing robot activity");
await runtime.configureRobotBridge({ url: "ws://127.0.0.1:8000/device", token: "b".repeat(48), allowApproximation: true });
await flush(); assert.equal(connects, 1);
snapshotHandler({ sessionId: "external-app" }); assert.equal(entered, 1);
const completedCommand = { sessionId: "external-app", lastResult: { sessionId: "external-app", commandId: 1, status: "adapted" } };
snapshotHandler(completedCommand); snapshotHandler(completedCommand);
assert.equal(interactions, 1, "completed external commands count as activity; repeated state updates do not");
AppState.currentState = "background"; stateHandler(); await flush();
assert.equal(closes, 1); assert.ok(physicalStops > 0); assert.ok(exited > 0);
AppState.currentState = "active"; stateHandler(); await flush(); assert.equal(connects, 2);
snapshotHandler({ sessionId: "new-app" });
robotState = { stopGeneration: 1, safety: { lastSafetyStopReason: "manual-stop" } }; robotHandler(); await flush();
assert.equal(closes, 2, "local STOP revokes an external app instead of letting playback resume");
const priorStops = physicalStops;
await runtime.configureRobotBridge(null); await flush();
uninstall(); await flush(); assert.equal(physicalStops, priorStops);
assert.equal(saved, null);
await assert.rejects(runtime.configureRobotBridge({ url: "https://example.com/device", token: "b".repeat(48), allowApproximation: true }));
const uninstallMedia = runtime.installRobotBridgeRuntime();
const mediaConfig = { url: "ws://127.0.0.1:8000/device", token: "b".repeat(48), allowApproximation: true,
  media: { camera: true, microphone: true, speaker: true } };
await runtime.configureRobotBridge(mediaConfig); await flush();
assert.equal(backend.capabilities.media.camera, true, "explicit consent with a pending OS permission can advertise camera startup");
assert.equal(backend.capabilities.media.speaker, true);
assert.equal(backend.capabilities.media.volume, true, "opted-in WebRTC speaker gain is exposed to app adapters");
nativeMediaStatus = { ...nativeMediaStatus, speaker: { supported: true, available: false } };
await runtime.configureRobotBridge(mediaConfig); await flush();
assert.equal(backend.capabilities.media.speaker, false, "an absent speaker route cannot be advertised as usable");
nativeMediaStatus = { ...nativeMediaStatus, speaker: { supported: false, available: null } };
await runtime.configureRobotBridge(mediaConfig); await flush();
assert.equal(backend.capabilities.media.speaker, false);
await runtime.configureRobotBridge({ ...mediaConfig, media: { camera: false, microphone: false, speaker: false } }); await flush();
assert.deepEqual(backend.capabilities.media, { camera: false, microphone: false, speaker: false, volume: false }, "native support never overrides opt-out");
await runtime.configureRobotBridge(null); await flush(); uninstallMedia();
const central = { enabled: true, url: "https://central.example.test", token: "hf_native_fixture", robotName: "LOOI", protocols: ["reachy"] };
const cloudConfig = { url: "", token: "", allowApproximation: true, central };
await assert.rejects(runtime.configureRobotBridge({ ...cloudConfig, central: { ...central, enabled: false } }), /Connect Hugging Face/);
await assert.rejects(runtime.configureRobotBridge({ ...cloudConfig, token: "b".repeat(48) }), /pairing token/);
await assert.rejects(runtime.configureRobotBridge({ ...cloudConfig, central: { ...central, url: "http://central.example.test" } }), /HTTPS/);
const uninstallCentral = runtime.installRobotBridgeRuntime();
await flush();
const beforeNative = connects;
saved = JSON.stringify(cloudConfig);
assert.deepEqual((await runtime.loadRobotBridgeConfiguration()).central.protocols, ["reachy", "microduck"], "a persisted legacy family selection migrates to universal support on read");
saved = null;
await runtime.configureRobotBridge(cloudConfig); await flush();
assert.equal(connects, beforeNative, "direct Central needs no companion socket");
assert.equal(centralHosts.length, 1);
assert.equal(centralHosts[0].starts, 1);
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "connected");
assert.equal(runtime.getRobotBridgeRuntimeStatus().companionConnected, false);
assert.deepEqual((await runtime.loadRobotBridgeConfiguration()).central.protocols, ["reachy", "microduck"], "a legacy one-family configuration migrates to universal support");
assert.equal(centralHosts[0].options.config.protocols.length, 2);
assert.equal(runtime.getRobotBridgeRuntimeStatus().central.universal.peerId, "native-peer");
const gatewayCountBefore = gatewayOptions.length;
centralHosts[0].options.openGateway("universal", "native-session");
assert.equal(gatewayOptions.length, gatewayCountBefore + 1);
assert.equal(gatewayOptions.at(-1).protocol, "universal", "all apps enter the shared universal gateway");
assert.equal(gatewayOptions.at(-1).media.videoInfo().available, false, "an opted-out app cannot observe a camera from another owner");
const writesBeforeReuse = secureWrites;
const hostsBeforeReuse = centralHosts.length;
assert.equal(await runtime.prepareRobotAppConnection(), true);
assert.equal(await runtime.prepareRobotAppConnection(), true, "different hosted apps can reuse the same prepared connection");
assert.equal(secureWrites, writesBeforeReuse, "launching on a connected universal producer does not rewrite settings");
assert.equal(centralHosts.length, hostsBeforeReuse, "hosted apps reuse one registered producer regardless of app origin");
assert.deepEqual(centralHosts[0].options.media, { camera: false, microphone: false, speaker: false });
centralHosts[0].options.onStatus("universal", { state: "reconnecting", peerId: null, sessionId: null, reconnectAttempt: 1 });
centralHosts[0].options.onError("universal", new Error("Pollen Central /events returned HTTP 401"));
assert.match(runtime.getRobotBridgeRuntimeStatus().message, /Hugging Face sign-in failed/);
assert.equal(runtime.getRobotBridgeRuntimeStatus().message.includes(central.token), false);
centralHosts[0].options.onStatus("universal", { state: "connected", peerId: "native-peer", sessionId: null, reconnectAttempt: 1 });
assert.equal(runtime.getRobotBridgeRuntimeStatus().message, null, "a successful native reconnect clears the failed sign-in message");
const releasesBeforeBackground = diagnostics.filter(event => event.event === "robot-bridge-release").length;
AppState.currentState = "background"; stateHandler(); await flush();
assert.equal(centralHosts[0].stops, 1);
assert.deepEqual(diagnostics.filter(event => event.event === "robot-bridge-release").slice(releasesBeforeBackground).map(event => event.details), [
  { cause: "app-state-change", appState: "background", ownsDriving: false, centralSessionPending: false },
]);
centralHosts[0].options.onStatus("universal", { state: "connected", peerId: "stale-peer", sessionId: null, reconnectAttempt: 0 });
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "disabled", "a late Central callback cannot reopen suspended apps");
assert.deepEqual(runtime.getRobotBridgeRuntimeStatus().central, {});
AppState.currentState = "active"; stateHandler(); await flush();
assert.equal(centralHosts.length, 2, "foreground restoration creates a fresh producer");
const pendingCentralHost = centralHosts.at(-1);
robotState = { stopGeneration: 2, safety: { lastSafetyStopReason: "manual-stop" } }; robotHandler(); await flush();
assert.equal(pendingCentralHost.stops, 0, "an idle Central producer is not an active robot session");
pendingCentralHost.options.onStatus("universal", { state: "connected", peerId: "native-peer", sessionId: "pending-native-peer", reconnectAttempt: 0 });
robotState = { stopGeneration: 3, safety: { lastSafetyStopReason: "manual-stop" } }; robotHandler(); await flush();
assert.equal(pendingCentralHost.stops, 1, "local STOP revokes an accepted Central session before its asynchronous peer factory opens the core gateway");
assert.deepEqual(diagnostics.filter(event => event.event === "robot-bridge-external-stop-observed").at(-1)?.details, {
  stopSource: "manual-or-voice", ownsDriving: false, centralSessionPending: true,
});
assert.equal(diagnostics.filter(event => event.event === "robot-bridge-release").at(-1)?.details.cause, "external-robot-stop");
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "disabled");
await runtime.configureRobotBridge({ ...cloudConfig, url: "ws://127.0.0.1:8000/device", token: "b".repeat(48) }); await flush();
const companion = deviceOptions.at(-1);
assert.equal(companion.central.enabled, false, "the paired relay must not register a duplicate producer");
assert.equal(JSON.stringify(companion.central).includes(central.token), false, "native HF credentials are not sent to the paired companion");
assert.equal(runtime.getRobotBridgeRuntimeStatus().companionConnected, true);
snapshotHandler({ sessionId: "native-central-app" });
const currentHost = centralHosts.at(-1);
robotState = { stopGeneration: 4, safety: { lastSafetyStopReason: "manual-stop" } }; robotHandler(); await flush();
assert.equal(currentHost.stops, 1, "local STOP revokes the native producer and its session");
assert.equal(runtime.getRobotBridgeRuntimeStatus().companionConnected, false);
const optInMedia = { camera: true, microphone: false, speaker: true, cameraFacing: "user" };
await runtime.configureRobotBridge({ ...cloudConfig, media: optInMedia, central: { ...central, protocols: ["reachy", "microduck"] } }); await flush();
assert.deepEqual((await runtime.loadRobotBridgeConfiguration()).central.protocols, ["reachy", "microduck"], "legacy multi-family settings migrate to the universal configuration");
assert.deepEqual(centralHosts.at(-1).options.media, optInMedia, "saved camera/audio consent reaches the active Central producer unchanged");
const priorUniversalHost = centralHosts.at(-1);
let finishPriorStop;
priorUniversalHost.stopBarrier = new Promise(resolve => { finishPriorStop = resolve; });
const hostCountBeforeRestart = centralHosts.length;
await runtime.configureRobotBridge({ ...cloudConfig, media: optInMedia, allowApproximation: false });
await flush();
assert.equal(priorUniversalHost.stops, 1);
assert.equal(centralHosts.length, hostCountBeforeRestart, "the replacement producer waits for the previous producer to close");
finishPriorStop(); await flush();
assert.equal(centralHosts.length, hostCountBeforeRestart + 1);
assert.equal(centralHosts.at(-1).options.config.protocols.length, 2);
assert.deepEqual(centralHosts.at(-1).options.media, optInMedia, "reconnecting preserves saved camera/audio opt-ins");
assert.equal(runtime.getRobotBridgeRuntimeStatus().central.universal.state, "connected");
assert.deepEqual((await runtime.loadRobotBridgeConfiguration()).central, { ...central, protocols: ["reachy", "microduck"] }, "the universal connection keeps the saved Central destination and credentials");
assert.deepEqual((await runtime.loadRobotBridgeConfiguration()).media, optInMedia, "the universal connection leaves camera, microphone, speaker, and facing choices intact");
const preparedHostCount = centralHosts.length;
assert.equal(await runtime.prepareRobotAppConnection(), true);
assert.equal(centralHosts.length, preparedHostCount, "opening a hosted app reuses the connected universal producer");
autoConnectCentral = false;
const cancelLaunch = new AbortController();
await runtime.configureRobotBridge({ ...cloudConfig, media: optInMedia }); await flush();
const cancelledLaunch = runtime.prepareRobotAppConnection({ signal: cancelLaunch.signal });
const cancelledAssertion = assert.rejects(cancelledLaunch, /cancelled/);
await flush();
runtime.stopRobotBridge(); cancelLaunch.abort();
await cancelledAssertion;
await runtime.configureRobotBridge({ ...cloudConfig, central: { ...central, protocols: ["reachy"] } }); await flush();
let finishWrite;
writeBarrier = new Promise(resolve => { finishWrite = resolve; });
const stopDuringWrite = new AbortController();
const lateSaveLaunch = runtime.prepareRobotAppConnection({ signal: stopDuringWrite.signal });
const lateSaveAssertion = assert.rejects(lateSaveLaunch, /cancelled/);
await flush();
runtime.stopRobotBridge(); stopDuringWrite.abort();
finishWrite(); writeBarrier = null;
await lateSaveAssertion; await flush();
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "disabled", "a connection preparation write settling after STOP cannot restart Central");
autoConnectCentral = true;
await runtime.configureRobotBridge({ ...cloudConfig, central: { ...central, protocols: ["reachy"] } }); await flush();
const releaseHost = centralHosts.at(-1);
const releasesBeforeUserStop = diagnostics.filter(event => event.event === "robot-bridge-release").length;
releaseHost.options.onStatus("universal", { state: "connected", peerId: "native-peer", sessionId: "release-regression", reconnectAttempt: 0 });
snapshotHandler({ sessionId: "release-regression" });
const stopCallsBeforeUserStop = releaseHost.stops;
runtime.stopRobotBridge(); await flush();
assert.equal(releaseHost.stops, stopCallsBeforeUserStop + 1, "a bridge-owned STOP does not reenter release while a Central session is pending");
const newReleases = diagnostics.filter(event => event.event === "robot-bridge-release").slice(releasesBeforeUserStop);
assert.deepEqual(newReleases.map(event => event.details.cause), ["user-stop"], "the release diagnostic preserves the initiating cause");
assert.deepEqual(newReleases[0].details, {
  cause: "user-stop", appState: "active", ownsDriving: true, centralSessionPending: true,
});
await runtime.configureRobotBridge(null); await flush(); uninstallCentral();
assert.equal(await runtime.prepareRobotAppConnection(), false, "a missing Central connection opens setup without starting an anonymous producer");
const robotAppsSource = await readFile(new URL("../src/ui/RobotAppsScreen.tsx", import.meta.url), "utf8");
assert.match(robotAppsSource, /prepareRobotAppConnection\(/, "hosted apps use the shared connection preparation API");
assert.match(robotAppsSource, /runtime\.central\?\.universal/, "the Apps screen displays the shared Central connection state");
assert.doesNotMatch(robotAppsSource, /prepareRobotAppFamily|selectCentralFamily|setRobotFamily|familyTitle|robotFamily:/, "family selection and filtering stay out of the user workflow");
const robotAppsStrings = await readFile(new URL("../src/i18n/robot-app-strings.ts", import.meta.url), "utf8");
assert.doesNotMatch(robotAppsStrings, /families:|allFamilies:|select at least one robot family|wähle mindestens eine Roboterfamilie|сімейство роботів|семейство роботов/i, "localized setup copy stays family-neutral");
console.log("robot bridge runtime: opt-in, native Central, consent, suspension, local STOP and teardown passed");
