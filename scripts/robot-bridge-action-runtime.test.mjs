import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const saved = new Map();
const calls = [];
const releases = [];
const appState = { currentState: "active", addEventListener(_event, listener) { this.listener = listener; return { remove() {} }; } };
const user = { robotSleeping: false };
const robot = { connected: true, motionActive: false, stopGeneration: 0, safety: { lastMotionBlockReason: null, lastSafetyStopReason: null } };
let writeBarrier = null;
let gestureDelayMs = 0;
let driveDelayMs = 0;
let core;
let centralHost;
let onCoreActivated = null;
const controller = {
  getLooiRobotRuntimeState: () => robot,
  subscribeLooiRobotRuntimeState: () => () => {},
  LOOI_DRIVE_DURATION_LIMITS: { minimumMs: 80, maximumMs: 1_800 },
  async driveLooiForDuration(direction, durationMs, options) {
    calls.push({ kind: "drive", direction, durationMs, current: options.isCurrent() });
    if (driveDelayMs) await new Promise(resolve => setTimeout(resolve, driveDelayMs));
    return { ok: options.isCurrent(), completed: options.isCurrent() };
  },
  async performLooiHeadGesture(name, repetitions, options) {
    calls.push({ kind: "gesture", name, repetitions, current: options.isCurrent() });
    if (gestureDelayMs) await new Promise(resolve => setTimeout(resolve, gestureDelayMs));
    return { ok: options.isCurrent(), completed: options.isCurrent() };
  },
  async setLooiHead(direction, options) { calls.push({ kind: "head", direction, current: options.isCurrent() }); return { ok: true, completed: true }; },
  async setLooiLight(enabled, options) { calls.push({ kind: "light", enabled, current: options.isCurrent() }); return { ok: true, completed: true }; },
  async stopLooiMotion(reason) { calls.push({ kind: "stop", reason }); },
};
const load = createTypeScriptTreeLoader({
  "react-native": { AppState: appState },
  "expo-secure-store": {
    async getItemAsync(key) { return saved.get(key) ?? null; },
    async setItemAsync(key, value) { if (writeBarrier) await writeBarrier; saved.set(key, value); },
    async deleteItemAsync(key) { saved.delete(key); },
  },
  "./core": { createRobotCore(backend, options) {
    core = createRobotCore(backend, options);
    const setActive = core.setActive.bind(core);
    core.setActive = async next => { await setActive(next); if (next) onCoreActivated?.(); };
    return core;
  } },
  "expo/fetch": { fetch() { throw new Error("Tests must not contact Central"); } },
  "./native-central": { createNativeCentralHost(options) {
    centralHost = { options, async start() { options.onStatus("universal", { state: "connected", peerId: "fixture-peer", sessionId: null }); }, async stop() {} };
    return centralHost;
  } },
  "../device-tools/looi-robot": controller,
  "../store/user": { useUserStore: { getState: () => user, subscribe: () => () => {} } },
  "../voice/driving-control-session": { enterDrivingControlSession() {}, exitDrivingControlSession() {} },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent(_category, event, details) { if (event === "robot-bridge-release") releases.push(details.cause); } },
  "../core/robot-inactivity": { markRobotInteraction() {} },
});
const { createRobotCore } = load("src/robot-bridge/core.ts");
const { createRobotGateway } = load("src/robot-bridge/gateway.ts");
const runtime = load("src/robot-bridge/runtime.ts");
const settle = async () => { for (let n = 0; n < 80; n++) await Promise.resolve(); };
const eventually = async (predicate) => { for (let n = 0; n < 600; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail("observable action did not finish"); };
const unicodeAction = "🙂".repeat(200);
const profile = { schemaVersion: 1, mappings: [{ source: "dance", target: "happy_bob" }, { source: "walk", target: "move_forward" }, { source: "Dance Intro.v2", target: "curious" }, { source: unicodeAction, target: "curious" }] };

saved.set("looi-robot-app-actions-v1", "{corrupt JSON");
assert.deepEqual(await runtime.loadRobotAppActionProfile(), { schemaVersion: 1, mappings: [] }, "corrupt preferences safely drop aliases without bricking app connections");

// Saving mappings requires neither a network connection nor touching account data.
const credentials = JSON.stringify({ fixture: "unchanged credentials" });
saved.set("looi-robot-bridge-v1", credentials);
await runtime.configureRobotAppActions(profile);
assert.equal(saved.get("looi-robot-bridge-v1"), credentials);
assert.deepEqual(await runtime.loadRobotAppActionProfile(), profile);
await assert.rejects(runtime.configureRobotAppActions({ schemaVersion: 1, mappings: [{ source: "dance", target: "shell_command" }] }));
assert.deepEqual(await runtime.loadRobotAppActionProfile(), profile, "invalid preferences never replace the saved mapping");
saved.delete("looi-robot-bridge-v1");

let uninstall = runtime.installRobotBridgeRuntime();
await settle();
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "disabled");
const releasesBeforeWrites = releases.length;
await Promise.all([
  runtime.configureRobotAppActions({ schemaVersion: 1, mappings: [{ source: "dance", target: "curious" }] }),
  runtime.configureRobotAppActions(profile),
]);
await settle();
assert.deepEqual(await runtime.loadRobotAppActionProfile(), profile, "concurrent saves preserve the last submitted profile");
assert.deepEqual(releases.slice(releasesBeforeWrites), ["action-profile-change"], "only the final queued profile restarts the runtime");
assert.equal((await runtime.previewRobotAppAction("dance")).status, "adapted");
assert.ok(calls.some(call => call.kind === "gesture" && call.name === "happy_bob" && call.current), "the saved alias reaches the real LOOI controller seam");
assert.equal((await runtime.previewRobotAppAction("Dance Intro.v2")).status, "adapted", "preview preserves the exact upstream action identifier too");
assert.equal((await runtime.previewRobotAppAction("walk")).status, "adapted");
assert.ok(calls.some(call => call.kind === "drive" && call.direction === "forward" && call.durationMs === 300 && call.current));
assert.equal(core.inspect().sessionId, null, "trying an action always releases its controlling session");
assert.equal(core.inspect().active, false, "offline preview does not enable the app connection");

// Both unchanged upstream envelopes use the same saved mapping and controller.
await core.setActive(true);
let gateway = createRobotGateway(core, { protocol: "universal", sessionId: "action-acceptance" });
const skills = await gateway.handleMessage({ jsonrpc: "2.0", id: 1, method: "robot.skills" });
assert.ok(skills.find(message => message.id === 1).result.skills.some(skill => skill.name === "dance"));
const beforeDuck = calls.length;
const duck = await gateway.handleMessage({ jsonrpc: "2.0", id: 2, method: "robot.do", params: { skill: "dance" } });
assert.equal(duck.find(message => message.id === 2).result.accepted, true);
assert.ok(calls.slice(beforeDuck).some(call => call.kind === "gesture" && call.name === "happy_bob"));
const exactDuck = await gateway.handleMessage({ jsonrpc: "2.0", id: 5, method: "robot.do", params: { skill: "Dance Intro.v2" } });
assert.equal(exactDuck.find(message => message.id === 5).result.accepted, true, "app action names keep their original case, spaces and punctuation");
await gateway.close();
gateway = createRobotGateway(core, { protocol: "universal", sessionId: "reachy-action-acceptance" });
const uuid = "b021a557-9a97-44f5-ae56-770747c2aa10";
const beforeReachy = calls.length;
const reachy = await gateway.handleMessage({ type: "task", uuid, timestamp: new Date().toISOString(), req: { move_name: "dance" } });
assert.ok(reachy.some(message => message.type === "task_progress" && message.uuid === uuid && message.finished === false));
await eventually(() => calls.slice(beforeReachy).some(call => call.kind === "gesture" && call.name === "happy_bob"));
await settle();
assert.ok(gateway.stateMessages().some(message => message.type === "task_progress" && message.uuid === uuid && message.finished === true && message.error === null));
const exactUuid = "192c6c75-d8e6-413b-83ec-63491a3b539c";
const exactProgress = await gateway.handleMessage({ type: "task", uuid: exactUuid, timestamp: new Date().toISOString(), req: { move_name: "Dance Intro.v2" } });
await eventually(() => {
  exactProgress.push(...gateway.stateMessages());
  return exactProgress.some(message => message.uuid === exactUuid && message.finished === true);
});
assert.equal(exactProgress.find(message => message.uuid === exactUuid && message.finished === true).error, null);
const unicodeUuid = "e4edcf05-9f03-479f-820d-68e1c0ddda52";
const unicodeProgress = await gateway.handleMessage({ type: "task", uuid: unicodeUuid, timestamp: new Date().toISOString(), req: { move_name: unicodeAction } });
await eventually(() => {
  unicodeProgress.push(...gateway.stateMessages());
  return unicodeProgress.some(message => message.uuid === unicodeUuid && message.finished === true);
});
assert.equal(unicodeProgress.find(message => message.uuid === unicodeUuid && message.finished === true).error, null, "Reachy and the shared profile use the same Unicode name length");

// An actual nod has 810ms of waits plus BLE writes. A 750ms streaming-frame
// lease would falsely cancel this otherwise successful complete action.
gestureDelayMs = 850;
const nod = await gateway.handleMessage({ jsonrpc: "2.0", id: 4, method: "robot.do", params: { skill: "nod" } });
assert.equal(nod.find(message => message.id === 4).result.accepted, true);
await gateway.close();
gateway = createRobotGateway(core, { protocol: "universal", sessionId: "reachy-nod-acceptance" });
const nodUuid = "a0edcde2-e0bd-4b0d-abfa-09eb1709f6b2";
const progress = await gateway.handleMessage({ type: "task", uuid: nodUuid, timestamp: new Date().toISOString(), req: { move_name: "nod" } });
await eventually(() => {
  progress.push(...gateway.stateMessages());
  return progress.some(message => message.type === "task_progress" && message.uuid === nodUuid && message.finished === true);
});
assert.equal(progress.find(message => message.type === "task_progress" && message.uuid === nodUuid && message.finished === true).error, null);
gestureDelayMs = 0;

// Replacing an action mapped to wheels with a head gesture must revoke the
// old lease, even though these are different core execution lanes.
driveDelayMs = 100;
const beforeReplacement = calls.length;
await gateway.handleMessage({ type: "task", uuid: "74569b41-1ad8-4ef9-a825-e4049d1c96b2", timestamp: new Date().toISOString(), req: { move_name: "walk" } });
await settle();
assert.ok(calls.slice(beforeReplacement).some(call => call.kind === "drive"));
await gateway.handleMessage({ type: "task", uuid: "af965eed-0da4-4884-93c4-cff1a557d2db", timestamp: new Date().toISOString(), req: { move_name: "dance" } });
await eventually(() => calls.slice(beforeReplacement).some(call => call.kind === "gesture"));
const replacementCalls = calls.slice(beforeReplacement);
assert.ok(replacementCalls.findIndex(call => call.kind === "stop") < replacementCalls.findIndex(call => call.kind === "gesture"), "replacing across lanes stops the old wheel action before starting the head action");
driveDelayMs = 0;
const beforeUnknown = calls.length;
const unknown = await gateway.handleMessage({ jsonrpc: "2.0", id: 3, method: "robot.do", params: { skill: "not_assigned" } });
assert.equal(unknown.find(message => message.id === 3).result.accepted, false);
assert.equal(calls.length, beforeUnknown);
await assert.rejects(runtime.previewRobotAppAction("dance"), /running app/);
await gateway.close();

// Profile updates stop ownership; a write settling after STOP must not reactivate it.
let finishWrite;
writeBarrier = new Promise(resolve => { finishWrite = resolve; });
const updating = runtime.configureRobotAppActions({ schemaVersion: 1, mappings: [{ source: "dance", target: "curious" }] });
await settle();
runtime.stopRobotBridge();
finishWrite(); writeBarrier = null;
await updating; await settle();
assert.equal(core.inspect().active, false);
assert.equal(runtime.getRobotBridgeRuntimeStatus().phase, "disabled");
assert.equal((await runtime.loadRobotAppActionProfile()).mappings[0].target, "curious");
user.robotSleeping = true;
const beforeSleeping = calls.length;
await assert.rejects(runtime.previewRobotAppAction("dance"), /awake/);
assert.equal(calls.length, beforeSleeping);
user.robotSleeping = false;
robot.connected = false;
await assert.rejects(runtime.previewRobotAppAction("dance"), /Connect LOOI/);
robot.connected = true;

await runtime.configureRobotBridge({ url: "", token: "", allowApproximation: false, central: {
  enabled: true, url: "https://central.example.test", token: "hf_fixture_only", robotName: "LOOI", protocols: ["reachy", "microduck"],
} });
await settle();
const pendingStatus = { state: "connected", peerId: "fixture-peer", sessionId: "accepted-before-native-factory" };
centralHost.options.onStatus("universal", pendingStatus);
await assert.rejects(runtime.previewRobotAppAction("dance"), /running app/, "an accepted Central app owns control even before its gateway exists");
centralHost.options.onStatus("universal", { ...pendingStatus, sessionId: null });
onCoreActivated = () => centralHost.options.onStatus("universal", pendingStatus);
await assert.rejects(runtime.previewRobotAppAction("dance"), /running app/, "preview rechecks ownership after its activation await");
assert.equal(core.inspect().sessionId, null);
onCoreActivated = null;
await runtime.configureRobotBridge(null); await settle();
uninstall(); await settle();

// A cold runtime reload uses the persisted assignment, never the prior in-memory one.
uninstall = runtime.installRobotBridgeRuntime(); await settle();
const beforeReload = calls.length;
assert.equal((await runtime.previewRobotAppAction("dance")).status, "adapted");
assert.ok(calls.slice(beforeReload).some(call => call.kind === "gesture" && call.name === "curious"));
await runtime.configureRobotAppActions({ schemaVersion: 1, mappings: [] }); await settle();
assert.deepEqual(await runtime.loadRobotAppActionProfile(), { schemaVersion: 1, mappings: [] });
const beforeResetPreview = calls.length;
await assert.rejects(runtime.previewRobotAppAction("dance"), /no LOOI assignment/, "resetting saved mappings revokes the previous alias");
assert.equal(calls.length, beforeResetPreview);
uninstall(); await settle();
console.log("robot app actions: persistence, unchanged Reachy/MicroDuck requests, real LOOI controller effects, preview isolation and late-write STOP passed");
