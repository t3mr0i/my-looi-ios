import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire = require) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports,
    customRequire,
    module,
    file,
    path.dirname(file),
  );
  return module.exports;
}

const calls = [];
const runtime = {
  connected: true,
  motionActive: false,
  safety: { lastMotionBlockReason: null, lastSafetyStopReason: null },
};
const controller = {
  getLooiRobotRuntimeState: () => runtime,
  LOOI_DRIVE_DURATION_LIMITS: { minimumMs: 80, maximumMs: 1_800 },
  async driveLooiForDuration(direction, durationMs, options) {
    calls.push({ kind: "drive", direction, durationMs, current: options.isCurrent() });
    return { ok: true, completed: true, durationMs };
  },
  async setLooiHead(direction, options) {
    calls.push({ kind: "head", direction, current: options.isCurrent() });
    return { ok: true, completed: true };
  },
  async performLooiHeadGesture(name, repetitions, options) {
    calls.push({ kind: "gesture", name, repetitions, current: options.isCurrent() });
    return { ok: true, completed: true };
  },
  async setLooiLight(enabled, options) {
    calls.push({ kind: "light", enabled, current: options.isCurrent() });
    return { ok: true, completed: true };
  },
  async stopLooiMotion(reason) { calls.push({ kind: "stop", reason }); },
};
const robotBridgeRequire = (id) => {
  if (id === "../device-tools/looi-robot") return controller;
  return require(id);
};
const { createLooiBackend, LOOI_SUPPORTED_GESTURES } = compileTs("src/robot-bridge/looi-backend.ts", robotBridgeRequire);
const backend = createLooiBackend();

function context(allowApproximation = false) {
  const abortController = new AbortController();
  return {
    signal: abortController.signal,
    isCurrent: () => !abortController.signal.aborted,
    allowApproximation,
    abortController,
  };
}

function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

assert.equal(backend.id, "looi");
assert.equal(backend.capabilities.locomotion.calibratedVelocity, false);
assert.equal(backend.capabilities.locomotion.lateral, false);
assert.equal(backend.capabilities.locomotion.odometry, false);
assert.equal(backend.capabilities.pose.head, "quantized");
assert.equal(backend.capabilities.pose.antennas, false);
assert.deepEqual(backend.inspect().measuredPose, null, "requested poses must never be reported as measurements");
assert.deepEqual(backend.inspect().measuredVelocity, null, "requested speeds must never be reported as measurements");

const neutralTarget = {
  kind: "target",
  pose: { head: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], antennas: [0, 0], bodyYaw: 0 },
};
assert.equal((await backend.execute(neutralTarget, context())).status, "applied", "neutral optional axes must not be rejected");
assert.deepEqual(calls.at(-1), { kind: "head", direction: "center", current: true });

const strictPitch = await backend.execute({ kind: "target", pose: { head: rotationY(Math.PI / 6) } }, context(false));
assert.equal(strictPitch.status, "unsupported", "strict sessions must reject quantized head pitch");
assert.equal(calls.filter((call) => call.kind === "head").length, 1, "unsupported target poses must not actuate");
const approximatePitch = await backend.execute({ kind: "target", pose: { head: rotationY(Math.PI / 6) } }, context(true));
assert.equal(approximatePitch.status, "adapted");
assert.deepEqual(calls.at(-1), { kind: "head", direction: "down", current: true });

const controllerCallsBeforeVirtualTargets = calls.length;
const virtualAntennas = await backend.execute({ kind: "target", pose: { antennas: [0.2, -0.2] } }, context(true));
assert.equal(virtualAntennas.status, "adapted");
assert.ok(virtualAntennas.limitations.includes("virtual target only; no LOOI actuator"));
assert.equal("applied" in virtualAntennas, false, "virtual-only pose axes must not be reported as physically applied");
assert.equal(calls.length, controllerCallsBeforeVirtualTargets, "virtual-only antenna targets must not call the LOOI controller");
const strictAntennas = await backend.execute({ kind: "target", pose: { antennas: [0.2, -0.2] } }, context(false));
assert.equal(strictAntennas.status, "unsupported", "strict sessions must reject virtual-only pose axes");
assert.equal(calls.length, controllerCallsBeforeVirtualTargets);
const virtualBodyYaw = await backend.execute({ kind: "target", pose: { bodyYaw: 0.3 } }, context(true));
assert.equal(virtualBodyYaw.status, "adapted");
assert.ok(virtualBodyYaw.limitations.includes("virtual target only; no LOOI actuator"));
assert.equal("applied" in virtualBodyYaw, false);
assert.equal(calls.length, controllerCallsBeforeVirtualTargets, "virtual-only body yaw must not call the LOOI controller");
const strictBodyYaw = await backend.execute({ kind: "target", pose: { bodyYaw: 0.3 } }, context(false));
assert.equal(strictBodyYaw.status, "unsupported");
assert.equal(calls.length, controllerCallsBeforeVirtualTargets);
for (const pose of [{ antennas: [0, 0] }, { bodyYaw: 0 }, {}]) {
  const virtualNeutral = await backend.execute({ kind: "target", pose }, context(true));
  assert.equal(virtualNeutral.status, "adapted", "a target with no physical head axis remains virtual, even at neutral values");
  assert.ok(virtualNeutral.limitations.includes("virtual target only; no LOOI actuator"));
  assert.equal("applied" in virtualNeutral, false);
  const strictNeutral = await backend.execute({ kind: "target", pose }, context(false));
  assert.equal(strictNeutral.status, "unsupported", "strict mode must not claim a virtual-only neutral target was actuated");
}
assert.equal(calls.length, controllerCallsBeforeVirtualTargets);

const strictDrive = await backend.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 600 }, context(false));
assert.equal(strictDrive.status, "unsupported", "strict sessions must reject uncalibrated SI velocity");
assert.equal(calls.some((call) => call.kind === "drive"), false);
const approximateDrive = await backend.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 20 }, context(true));
assert.equal(approximateDrive.status, "adapted");
assert.deepEqual(calls.at(-1), { kind: "drive", direction: "forward", durationMs: 80, current: true });
assert.ok(approximateDrive.limitations.some((value) => value.includes("clamped")));

const simultaneous = await backend.execute({ kind: "drive", forward: 0.3, lateral: 0, yawRate: -0.2, durationMs: 1_000 }, context(true));
assert.equal(simultaneous.status, "adapted");
assert.ok(simultaneous.limitations.some((value) => value.includes("magnitudes") && value.includes("ratio")));
assert.deepEqual(calls.slice(-2).map(({ direction, durationMs }) => ({ direction, durationMs })), [
  { direction: "forward", durationMs: 500 },
  { direction: "right", durationMs: 500 },
]);
const lateral = await backend.execute({ kind: "drive", forward: 0, lateral: 0.2, yawRate: 0, durationMs: 500 }, context(true));
assert.equal(lateral.status, "unsupported");

assert.ok(LOOI_SUPPORTED_GESTURES.includes("nod"));
assert.equal((await backend.execute({ kind: "gesture", name: "dance" }, context(true))).status, "unsupported");
assert.equal((await backend.execute({ kind: "gesture", name: "nod" }, context())).status, "applied");
assert.deepEqual(calls.at(-1), { kind: "gesture", name: "nod", repetitions: 1, current: true });
assert.equal((await backend.execute({ kind: "volume", value: 0.5 }, context(true))).status, "unsupported");

// A virtual pose stream must not flood BLE with repeated quantized head
// targets. Use a deterministic clock to verify spacing, refresh, and expiry.
const headWriteTimes = [];
const rateLimitedBackend = createLooiBackend({
  inspect: () => runtime,
  async drive() { return { ok: true, completed: true }; },
  async setHead(direction) { headWriteTimes.push({ direction, at: Date.now() }); return { ok: true, completed: true }; },
  async performHeadGesture() { return { ok: true, completed: true }; },
  async setLight() { return { ok: true, completed: true }; },
  async stop() {},
});
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
let fakeNow = 1_000;
Date.now = () => fakeNow;
globalThis.setTimeout = (callback, ms) => {
  fakeNow += ms;
  queueMicrotask(callback);
  return 0;
};
try {
  const center = { kind: "target", pose: { head: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
  const down = { kind: "target", pose: { head: rotationY(Math.PI / 6) } };
  const up = { kind: "target", pose: { head: rotationY(-Math.PI / 6) } };
  assert.equal((await rateLimitedBackend.execute(center, context())).status, "applied");
  const changed = await rateLimitedBackend.execute(down, context(true));
  assert.equal(changed.status, "adapted");
  assert.ok(changed.limitations.some((value) => value.includes("120ms")));
  assert.ok(headWriteTimes[1].at - headWriteTimes[0].at >= 120, "direction changes must be at least 120 ms apart");

  const coalesced = await rateLimitedBackend.execute(down, context(true));
  assert.equal(coalesced.status, "adapted");
  assert.ok(coalesced.limitations.some((value) => value.includes("coalesced")));
  assert.equal(headWriteTimes.length, 2, "same quantized direction is deduplicated during its refresh window");

  fakeNow += 240;
  await rateLimitedBackend.execute(down, context(true));
  assert.equal(headWriteTimes.length, 3, "same direction is physically refreshed after the coalescing window");

  const expiry = context(true);
  expiry.isCurrent = () => fakeNow < 1_380;
  const expiredWait = await rateLimitedBackend.execute(up, expiry);
  assert.equal(expiredWait.status, "cancelled", "a rate-limited command must cancel when its lease expires");
  assert.equal(headWriteTimes.length, 3, "an expired queued pose must never write later");
} finally {
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
}

let releaseDrive;
let startedDrive;
const startedDrivePromise = new Promise((resolve) => { startedDrive = resolve; });
const cancellableBackend = createLooiBackend({
  inspect: () => runtime,
  drive: async (direction, durationMs, options) => {
  startedDrive();
  await new Promise((resolve) => { releaseDrive = resolve; });
  return { ok: options.isCurrent(), completed: options.isCurrent(), direction, durationMs };
  },
  setHead: controller.setLooiHead,
  performHeadGesture: controller.performLooiHeadGesture,
  setLight: controller.setLooiLight,
  stop: async (reason) => { calls.push({ kind: "stop", reason }); },
});
const pendingContext = context(true);
const pendingExecution = cancellableBackend.execute({ kind: "drive", forward: 0.5, lateral: 0, yawRate: 0, durationMs: 300 }, pendingContext);
await startedDrivePromise;
const stopStartedAt = calls.length;
const pendingStop = cancellableBackend.stop("test-out-of-band-stop");
assert.ok(calls.slice(stopStartedAt).some((call) => call.kind === "stop"), "backend STOP must invoke controller immediately");
releaseDrive();
assert.equal((await pendingExecution).status, "cancelled", "STOP must invalidate an in-flight adapter command");
await pendingStop;

// Exercise the real controller seam: STOP while connection and sensor warm-up
// are pending must invalidate the request before it can write a drive frame.
const sdk = compileTs("packages/looi-sdk/src/index.ts");
const fed9 = compileTs("src/device-tools/fed9-sensors.ts");
let notify = null;
const driveWrites = [];
let releaseConnect;
let connectStarted;
const connectStartedPromise = new Promise((resolve) => { connectStarted = resolve; });
const neverConnect = new Promise((resolve) => { releaseConnect = resolve; });
const diagnostics = { recordDiagnosticEvent() {} };
const controllerRequire = (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  if (id === "../diagnostics/diagnostic-log") return diagnostics;
  if (id === "./fed9-sensors") return fed9;
  return require(id);
};
const looi = compileTs("src/device-tools/looi-robot.ts", controllerRequire);
const pendingTransport = {
  async connect() { connectStarted(); await neverConnect; },
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) { driveWrites.push({ key, payload }); },
};
looi.configureLooiRobotTransport(pendingTransport);
const connectingDrive = looi.driveLooiForDuration("forward", 100);
await connectStartedPromise;
await looi.stopLooiMotion("test-stop-during-connect");
releaseConnect();
await assert.rejects(connectingDrive, /cancelled/i);
assert.equal(driveWrites.some((write) => write.payload === "7707"), false, "STOP during getRobot must prevent the later drive write");
await looi.disconnectLooiRobot();

notify = null;
driveWrites.length = 0;
const warmupTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) { driveWrites.push({ key, payload }); },
};
looi.configureLooiRobotTransport(warmupTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
const warmingDrive = looi.driveLooiForDuration("forward", 100);
await new Promise((resolve) => setTimeout(resolve, 5));
await looi.stopLooiMotion("test-stop-during-safety-wait");
await assert.rejects(warmingDrive, /cancelled/i);
assert.equal(driveWrites.some((write) => write.payload === "7707"), false, "STOP during sensor warm-up must prevent the later drive write");
await looi.disconnectLooiRobot();

notify = null;
driveWrites.length = 0;
let releaseFirstDrive;
let firstDriveStarted;
const firstDriveStartedPromise = new Promise((resolve) => { firstDriveStarted = resolve; });
const pendingFirstDriveWrite = new Promise((resolve) => { releaseFirstDrive = resolve; });
let delayedInitialWrite = false;
const delayedWriteTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key === "drive" && payload === "7707" && !delayedInitialWrite) {
      delayedInitialWrite = true;
      firstDriveStarted();
      await pendingFirstDriveWrite;
    }
  },
};
looi.configureLooiRobotTransport(delayedWriteTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));
const startingWriteDrive = looi.driveLooiForDuration("forward", 100);
await firstDriveStartedPromise;
await looi.stopLooiMotion("test-stop-during-first-drive-write");
releaseFirstDrive();
await assert.rejects(startingWriteDrive, /cancelled/i);
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(driveWrites.filter((write) => write.payload === "7707").length, 1, "cancelled first BLE write must not arm the repeated drive loop");
assert.equal(driveWrites.at(-1).payload, "0000", "a second STOP must follow a drive write that settled after cancellation");
await looi.disconnectLooiRobot();

// A successor's queued first-write reservation is itself cancelable. Expiring
// it while an older BLE frame is still pending must return promptly and leave
// only the already-reserved replacement STOP behind the old frame.
notify = null;
driveWrites.length = 0;
let releaseQueueTestDrive;
let queueTestDriveStarted;
const queueTestDriveStartedPromise = new Promise((resolve) => { queueTestDriveStarted = resolve; });
const queueTestTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key === "drive" && payload === "7707") {
      queueTestDriveStarted();
      await new Promise((resolve) => { releaseQueueTestDrive = resolve; });
    }
  },
};
looi.configureLooiRobotTransport(queueTestTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));
let originalLease = true;
let queuedLease = true;
const originalPendingStart = looi.driveLooiForDuration("forward", 300, { isCurrent: () => originalLease });
await queueTestDriveStartedPromise;
const queuedPendingStart = looi.driveLooiForDuration("back", 300, { isCurrent: () => queuedLease });
await new Promise((resolve) => setTimeout(resolve, 20));
queuedLease = false;
await assert.rejects(queuedPendingStart, /cancelled/i, "a stale queued start must not wait for an older stalled BLE write");
originalLease = false;
releaseQueueTestDrive();
await assert.rejects(originalPendingStart, /cancelled/i);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(driveWrites.filter((write) => write.payload === "86fc").length, 0, "an expired queued successor must never issue its drive frame");
assert.equal(driveWrites.at(-1).payload, "0000", "the preemption STOP remains ordered after the delayed old frame");
await looi.disconnectLooiRobot();

// A same-lane command can replace an already-moving drive with an unsupported
// request. The old physical lease must still STOP promptly even though the
// successor never enters the controller's start path.
notify = null;
driveWrites.length = 0;
let activeDriveStarted;
const activeDriveStartedPromise = new Promise((resolve) => { activeDriveStarted = resolve; });
const activeDriveTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key === "drive" && payload === "7707") activeDriveStarted();
  },
};
looi.configureLooiRobotTransport(activeDriveTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));

const bridgeTypes = compileTs("src/robot-bridge/types.ts");
const bridgeActionProfile = compileTs("src/robot-bridge/action-profile.ts", (id) => id === "./types" ? bridgeTypes : require(id));
const { createRobotCore } = compileTs("src/robot-bridge/core.ts", (id) => id === "./types" ? bridgeTypes : id === "./action-profile" ? bridgeActionProfile : require(id));
const actualControllerRequire = (id) => id === "../device-tools/looi-robot" ? looi : require(id);
const { createLooiBackend: createActualLooiBackend } = compileTs("src/robot-bridge/looi-backend.ts", actualControllerRequire);
const actualCore = createRobotCore(createActualLooiBackend());
const actualSession = actualCore.openSession({ id: "unsupported-replacement", allowApproximation: true });
const activeDriveAt = Date.now();
const activeDrive = actualSession.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 800 });
await activeDriveStartedPromise;
const unsupportedReplacement = await actualSession.execute({ kind: "drive", forward: 0, lateral: 0.2, yawRate: 0, durationMs: 500 });
assert.equal(unsupportedReplacement.status, "unsupported");
assert.equal((await activeDrive).status, "cancelled");
assert.ok(Date.now() - activeDriveAt < 300, "the cancelled drive must not wait for its original bounded duration");
assert.ok(driveWrites.some((write) => write.key === "drive" && write.payload === "0000"), "lease cancellation must issue a physical STOP");
assert.equal(looi.getLooiRobotRuntimeState().motionActive, false);
await actualSession.close();
await actualCore.dispose();
await looi.disconnectLooiRobot();

// A valid successor drive may take ownership before the old 25 ms lease poll
// fires. The old request must observe the changed controller generation and
// leave the successor's BLE loop alone.
notify = null;
driveWrites.length = 0;
let replacedDriveStarted;
const replacedDriveStartedPromise = new Promise((resolve) => { replacedDriveStarted = resolve; });
let successorDriveStarted;
const successorDriveStartedPromise = new Promise((resolve) => { successorDriveStarted = resolve; });
const successorTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key === "drive" && payload === "7707") replacedDriveStarted();
    if (key === "drive" && payload === "86fc") successorDriveStarted();
  },
};
looi.configureLooiRobotTransport(successorTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));
const successorCore = createRobotCore(createActualLooiBackend());
const successorSession = successorCore.openSession({ id: "valid-drive-successor", allowApproximation: true });
const replacedDrive = successorSession.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 800 });
await replacedDriveStartedPromise;
const nextDrive = successorSession.execute({ kind: "drive", forward: -0.4, lateral: 0, yawRate: 0, durationMs: 1_600 });
await successorDriveStartedPromise;
assert.equal((await replacedDrive).status, "cancelled");
await new Promise((resolve) => setTimeout(resolve, 80));
const successorStartIndex = driveWrites.findIndex((write) => write.key === "drive" && write.payload === "86fc");
assert.ok(successorStartIndex >= 0);
assert.equal(driveWrites.slice(successorStartIndex + 1).some((write) => write.key === "drive" && write.payload === "0000"), false, "old cancellation must not STOP a successor generation");
assert.equal((await nextDrive).status, "adapted");
assert.equal(driveWrites.at(-1).payload, "0000", "the successor still ends with its bounded STOP");
await successorSession.close();
await successorCore.dispose();
await looi.disconnectLooiRobot();

// A same-lane successor cannot overtake an initial BLE drive packet that is
// still pending. The stale request must finish with STOP before the successor
// starts, even though core cancellation has already returned to its caller.
notify = null;
driveWrites.length = 0;
let releaseDelayedStart;
let delayedStartIssued;
const delayedStartIssuedPromise = new Promise((resolve) => { delayedStartIssued = resolve; });
let queuedSuccessorStarted;
const queuedSuccessorStartedPromise = new Promise((resolve) => { queuedSuccessorStarted = resolve; });
const orderedDriveEvents = [];
const delayedSuccessorTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key !== "drive") return;
    if (payload === "7707" && !releaseDelayedStart) {
      orderedDriveEvents.push("old-start-issued");
      delayedStartIssued();
      await new Promise((resolve) => { releaseDelayedStart = resolve; });
      orderedDriveEvents.push("old-start-settled");
    } else if (payload === "0000") {
      orderedDriveEvents.push("stop-issued");
    } else if (payload === "86fc") {
      orderedDriveEvents.push("successor-start-issued");
      queuedSuccessorStarted();
    }
  },
};
looi.configureLooiRobotTransport(delayedSuccessorTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));
const orderedCore = createRobotCore(createActualLooiBackend());
const orderedSession = orderedCore.openSession({ id: "pending-write-successor", allowApproximation: true });
const delayedOldDrive = orderedSession.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 300 });
await delayedStartIssuedPromise;
const orderedSuccessor = orderedSession.execute({ kind: "drive", forward: -0.4, lateral: 0, yawRate: 0, durationMs: 300 });
assert.equal((await delayedOldDrive).status, "cancelled");
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(orderedDriveEvents.includes("successor-start-issued"), false, "successor start must wait for the delayed old packet");
releaseDelayedStart();
await queuedSuccessorStartedPromise;
const oldSettledIndex = orderedDriveEvents.indexOf("old-start-settled");
const staleStopIndex = orderedDriveEvents.indexOf("stop-issued");
const successorIndex = orderedDriveEvents.indexOf("successor-start-issued");
assert.ok(oldSettledIndex >= 0 && staleStopIndex > oldSettledIndex && successorIndex > staleStopIndex,
  "the old packet must settle, then receive STOP, before the successor drive frame");
assert.equal((await orderedSuccessor).status, "adapted");
await orderedSession.close();
await orderedCore.dispose();
await looi.disconnectLooiRobot();

// The terminal STOP of a bounded move is also serialized. A successor arriving
// while that write is pending must wait, or its drive frame could be stopped
// by the older command's late cleanup packet.
notify = null;
driveWrites.length = 0;
let releaseDurationStop;
let durationStopStarted;
const durationStopStartedPromise = new Promise((resolve) => { durationStopStarted = resolve; });
let postCleanupSuccessorStarted;
const postCleanupSuccessorStartedPromise = new Promise((resolve) => { postCleanupSuccessorStarted = resolve; });
const cleanupEvents = [];
let blockNextDurationStop = true;
const delayedCleanupTransport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return key === "dockNotify"; },
  async startNotifications(_key, callback) { notify = callback; },
  async write(key, payload) {
    driveWrites.push({ key, payload });
    if (key !== "drive") return;
    if (payload === "0000" && blockNextDurationStop) {
      blockNextDurationStop = false;
      cleanupEvents.push("duration-stop-issued");
      durationStopStarted();
      await new Promise((resolve) => { releaseDurationStop = resolve; });
      cleanupEvents.push("duration-stop-settled");
    } else if (payload === "86fc") {
      cleanupEvents.push("successor-start-issued");
      postCleanupSuccessorStarted();
    }
  },
};
looi.configureLooiRobotTransport(delayedCleanupTransport);
await looi.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
await new Promise((resolve) => setTimeout(resolve, 275));
const cleanupCore = createRobotCore(createActualLooiBackend());
const cleanupSession = cleanupCore.openSession({ id: "pending-duration-cleanup", allowApproximation: true });
const finishingDrive = cleanupSession.execute({ kind: "drive", forward: 0.4, lateral: 0, yawRate: 0, durationMs: 80 });
await durationStopStartedPromise;
const cleanupSuccessor = cleanupSession.execute({ kind: "drive", forward: -0.4, lateral: 0, yawRate: 0, durationMs: 200 });
assert.equal((await finishingDrive).status, "cancelled", "core supersession may return while the old bounded cleanup is pending");
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(cleanupEvents.includes("successor-start-issued"), false, "successor must wait for the in-flight duration STOP");
releaseDurationStop();
await postCleanupSuccessorStartedPromise;
assert.ok(cleanupEvents.indexOf("duration-stop-settled") < cleanupEvents.indexOf("successor-start-issued"),
  "the old duration STOP must settle before a successor drive frame");
assert.equal((await cleanupSuccessor).status, "adapted");
await cleanupSession.close();
await cleanupCore.dispose();
await looi.disconnectLooiRobot();

console.log("LOOI robot bridge behavior tests passed");
