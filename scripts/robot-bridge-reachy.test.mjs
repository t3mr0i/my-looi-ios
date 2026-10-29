import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const { createReachyAdapter } = loadTypeScript("src/robot-bridge/reachy-adapter.ts");
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Kept in sync with the original pinned host's `parseSemver` implementation:
// pollen-robotics/reachy_mini@82842fb9713bdec6fae95210dda699a2da72ff7e
// ts/host/src/lib/daemonRelease.ts. It intentionally reads the first three
// numeric components and tolerates the `+looi` build suffix.
function parsePinnedHostSemver(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function makeSession({ head = IDENTITY, antennas = [0, 0], bodyYaw = 0, gestures = [] } = {}) {
  let poseExecution = 0;
  const session = {
    id: "test-session",
    closed: false,
    calls: [],
    applied: [],
    stopCalls: [],
    listeners: new Set(),
    delayNext: null,
    state: {
      schemaVersion: 1,
      backend: "test-looi",
      capabilities: {
        schemaVersion: 1,
        locomotion: { forward: true, lateral: true, yaw: true, simultaneous: true, calibratedVelocity: false, odometry: false },
        pose: { head: "none", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
        gestures: [...gestures], light: true,
        media: { camera: false, microphone: false, speaker: false, volume: false },
      },
      sessionId: "test-session",
      active: true,
      generation: 0,
      virtualPose: { head: [...head], antennas: [...antennas], bodyYaw },
      observed: { connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null },
      lastResult: null,
    },
    inspect() { return structuredClone(this.state); },
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    notify() { for (const listener of [...this.listeners]) listener(this.inspect()); },
    async execute(command, options) {
      const generation = this.state.generation;
      const poseExecutionAtStart = command.kind === "target" || command.kind === "gesture" ? ++poseExecution : null;
      this.calls.push({ command: structuredClone(command), options: options && { ...options } });
      if (this.delayNext) {
        const delayed = this.delayNext;
        this.delayNext = null;
        await delayed.promise;
      }
      if (generation !== this.state.generation || this.closed
        || (poseExecutionAtStart !== null && poseExecutionAtStart !== poseExecution)) {
        return { status: "cancelled", limitations: [], message: "stopped during execution", sessionId: this.id, commandId: this.calls.length };
      }
      this.applied.push(structuredClone(command));
      if (command.kind === "target") this.state.virtualPose = { ...this.state.virtualPose, ...command.pose };
      if (command.kind === "volume") this.state.lastResult = { status: "applied", limitations: [], sessionId: this.id, commandId: this.calls.length, applied: command };
      return { status: "applied", limitations: [], applied: command, sessionId: this.id, commandId: this.calls.length };
    },
    async stop(reason) {
      this.stopCalls.push(reason);
      this.state.generation += 1;
      this.state.observed.moving = false;
      this.notify();
    },
    async close(reason = "test session closed") {
      if (this.closed) return;
      await this.stop(reason);
      this.closed = true;
      this.notify();
    },
  };
  return session;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function enableReachyTargets(adapter) {
  const reply = await adapter.handleMessage({ type: "set_motor_mode", mode: "enabled" });
  assert.equal(reply.motor_mode, "enabled");
  assert.equal(reply.status, "ok");
}
const taskEnvelope = (uuid, req) => ({
  type: "task",
  uuid,
  req,
  timestamp: new Date().toISOString(),
});

async function testStateEnvelopeAndVirtualOrigin() {
  const head = [...IDENTITY];
  head[3] = 0.125;
  head[7] = -0.25;
  const session = makeSession({ head, antennas: [0.1, -0.2], bodyYaw: 0.4 });
  const adapter = createReachyAdapter(session);
  const state = await adapter.handleMessage({ type: "get_state" });
  assert.deepEqual(state.state.head_pose, [head.slice(0, 4), head.slice(4, 8), head.slice(8, 12), head.slice(12, 16)]);
  assert.equal(state.state.pose_origin, "virtual");
  assert.equal(state.state.hardware_motors_available, false);
  assert.equal(state.state.motor_mode, "enabled");
  assert.equal(state.state.motor_mode_origin, "virtual");
  assert.deepEqual(state.state.head_joint_positions, [0.4, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(state.state.imu, null);
  const version = await adapter.handleMessage({ type: "get_version" });
  assert.equal(version.version, "1.13.0+looi");
  assert.equal(version.adapter_version, "0.1.0");
  assert.equal(version.version_origin, "reachy_wire_compatibility");
  assert.equal(version.robot_family, "looi");
  const parsedVersion = parsePinnedHostSemver(version.version);
  assert.deepEqual(parsedVersion, { major: 1, minor: 13, patch: 0 },
    "the original host parser reads 1.13.0 from the +looi wire-version suffix");
  assert.ok(parsedVersion.major > 1 || (parsedVersion.major === 1 && (parsedVersion.minor > 8 || (parsedVersion.minor === 8 && parsedVersion.patch >= 2))),
    "the raw host version gate sees LOOI's Reachy wire protocol as >= 1.8.2");
  const initial = adapter.initialMessages();
  assert.equal(initial[0].type, "daemon_status");
  assert.equal(initial[0].compatibility_origin, "virtual");
  assert.equal(initial[0].version, version.version);
  assert.equal(initial[0].adapter_version, version.adapter_version);
  assert.equal(initial[0].version_origin, version.version_origin);
  assert.equal(initial[0].robot_family, version.robot_family);
  const initialByType = Object.fromEntries(initial.map((message) => [message.type, message]));
  assert.deepEqual(initial.map((message) => message.type), ["daemon_status", "joint_positions", "head_pose"]);
  assert.deepEqual(initialByType.joint_positions.head_joint_positions, [0.4, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(initialByType.joint_positions.antennas_joint_positions, [0.1, -0.2]);
  assert.equal(initialByType.joint_positions.compatibility_origin, "virtual");
  assert.equal(initialByType.joint_positions.hardware_motors_available, false);
  assert.deepEqual(initialByType.head_pose.head_pose, [head.slice(0, 4), head.slice(4, 8), head.slice(8, 12), head.slice(12, 16)]);
  assert.equal(initialByType.head_pose.compatibility_origin, "virtual");
  assert.deepEqual(adapter.pollMessages().map((message) => message.type), ["joint_positions", "head_pose"]);
  assert.deepEqual(adapter.snapshot().state.head_pose, state.state.head_pose);
  const updatedHead = [...head];
  updatedHead[3] = 0.5;
  await enableReachyTargets(adapter);
  await adapter.setTarget({ head: updatedHead });
  const polledHeadPose = adapter.pollMessages().find((message) => message.type === "head_pose");
  assert.deepEqual(polledHeadPose.head_pose, [updatedHead.slice(0, 4), updatedHead.slice(4, 8), updatedHead.slice(8, 12), updatedHead.slice(12, 16)]);
  await adapter.close();
}

async function testVirtualMotorLifecycleAndEnsureAwake() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  const target = [...IDENTITY];
  const modeBeforeWake = await adapter.handleMessage({ type: "get_motor_mode" });
  assert.equal(modeBeforeWake.motor_mode, "enabled");
  assert.equal(modeBeforeWake.motor_mode_origin, "virtual");
  assert.equal(modeBeforeWake.hardware_motors_available, false);

  const stopsBeforeInitialDisable = session.stopCalls.length;
  const initialDisable = await adapter.handleMessage({ type: "set_motor_mode", mode: "disabled" });
  assert.deepEqual([initialDisable.motor_mode, initialDisable.status], ["disabled", "ok"]);
  assert.equal(session.stopCalls.length, stopsBeforeInitialDisable + 1, "explicit disable closes the startup virtual target gate");

  const blockedWireTarget = await adapter.handleMessage({ type: "set_target", head: target });
  assert.match(blockedWireTarget.error, /disabled/);
  const blockedSdkTarget = await adapter.setTarget({ head: target });
  assert.equal(blockedSdkTarget.status, "rejected");
  assert.equal(session.calls.length, 0, "disabled virtual mode gates both wire and SDK target methods");

  const unsupportedGravity = await adapter.handleMessage({ type: "set_motor_mode", mode: "gravity_compensation" });
  assert.equal(unsupportedGravity.compatibility_status, "unsupported");
  assert.equal((await adapter.handleMessage({ type: "get_motor_mode" })).motor_mode, "disabled");
  const unsupportedJointTorque = await adapter.handleMessage({ type: "set_torque", on: false, ids: ["head_1"] });
  assert.equal(unsupportedJointTorque.compatibility_status, "unsupported");

  const enable = await adapter.handleMessage({ type: "set_motor_mode", mode: "enabled" });
  assert.deepEqual([enable.motor_mode, enable.status], ["enabled", "ok"]);
  assert.equal(enable.hardware_motors_available, false);
  assert.equal((await adapter.handleMessage({ type: "get_motor_mode" })).motor_mode, "enabled");
  assert.equal((await adapter.setTarget({ head: target })).status, "applied");

  const stopsBeforeDisable = session.stopCalls.length;
  const disable = await adapter.handleMessage({ type: "set_motor_mode", mode: "disabled" });
  assert.deepEqual([disable.motor_mode, disable.status], ["disabled", "ok"]);
  assert.equal(session.stopCalls.length, stopsBeforeDisable + 1, "disabling stops the backend even with no local motion run");
  const callsAtDisable = session.calls.length;
  assert.equal((await adapter.setTarget({ head: target })).status, "rejected");
  assert.equal(session.calls.length, callsAtDisable);

  // This is an explicit disabled -> wake -> retry lifecycle after the session
  // started with its virtual target gate open for the stock SDK.
  const startupMode = await adapter.handleMessage({ type: "get_motor_mode" });
  assert.equal(startupMode.motor_mode, "disabled");
  const wake = await adapter.handleMessage({ type: "wake_up" });
  assert.deepEqual([wake.status, wake.command, wake.completed, wake.motor_mode], ["ok", "wake_up", true, "enabled"]);
  assert.equal(wake.motor_mode_origin, "virtual");
  assert.equal(wake.hardware_motors_available, false);
  const awakeState = await adapter.handleMessage({ type: "get_state" });
  assert.equal(awakeState.state.motor_mode, "enabled");
  assert.equal(awakeState.state.motor_mode_origin, "virtual");
  assert.equal(awakeState.state.hardware_motors_available, false);
  assert.equal((await adapter.setTarget({ head: target })).status, "applied");
  const safeNeutral = session.applied.filter((command) => command.kind === "target").at(-2).pose;
  assert.ok(safeNeutral.head.every((value, index) => Math.abs(value - IDENTITY[index]) < 1e-12));
  assert.deepEqual(safeNeutral.antennas, [0, 0]);
  assert.equal(safeNeutral.bodyYaw, 0);

  const stopsBeforeSleep = session.stopCalls.length;
  const sleepReply = await adapter.handleMessage({ type: "goto_sleep" });
  assert.deepEqual([sleepReply.status, sleepReply.command, sleepReply.completed], ["ok", "goto_sleep", true]);
  assert.equal(sleepReply.compatibility_status, "adapted");
  assert.ok(sleepReply.limitations.some((limitation) => /no physical motor torque/i.test(limitation)));
  assert.equal(session.stopCalls.length, stopsBeforeSleep + 1, "goto_sleep sends STOP unconditionally after wake has completed");
  assert.equal((await adapter.handleMessage({ type: "get_motor_mode" })).motor_mode, "disabled");
  assert.equal((await adapter.handleMessage({ type: "get_state" })).state.motor_mode, "disabled");
  const callsAtSleep = session.calls.length;
  assert.equal((await adapter.setTarget({ head: target })).status, "rejected");
  assert.equal(session.calls.length, callsAtSleep);
  await adapter.close();
}

async function testRowMajorMatricesAndRadians() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  await enableReachyTargets(adapter);
  const matrix = [...IDENTITY];
  matrix[3] = 0.2;
  matrix[7] = -0.3;
  const reply = await adapter.handleMessage({ type: "set_target", head: matrix }, { sequence: 7, ttlMs: 1000 });
  assert.equal(reply.status, "ok");
  assert.deepEqual(session.calls[0].command.pose.head, matrix, "flat matrix remains row-major");
  assert.equal(session.calls[0].options.sequence, 1, "source sequence is separated from the core's pose-frame sequence");
  assert.equal(session.calls[0].options.ttlMs, 750, "a freshly admitted pose gets a short core lease");
  const callsBeforeStale = session.calls.length;
  const stale = await adapter.handleMessage({ type: "set_target", head: matrix }, { sequence: 6, ttlMs: 1000 });
  assert.match(stale.error, /stale.*sequence/i);
  assert.equal(session.calls.length, callsBeforeStale, "stale source packets never reach the core");

  await adapter.setHeadRpyDeg(0, 0, 90);
  const yawMatrix = session.calls.at(-1).command.pose.head;
  assert.ok(Math.abs(yawMatrix[0]) < 1e-12);
  assert.ok(Math.abs(yawMatrix[1] + 1) < 1e-12);
  assert.ok(Math.abs(yawMatrix[4] - 1) < 1e-12);
  await adapter.setAntennasDeg(180, -90);
  assert.ok(Math.abs(session.calls[2].command.pose.antennas[0] - Math.PI) < 1e-12);
  assert.ok(Math.abs(session.calls[2].command.pose.antennas[1] + Math.PI / 2) < 1e-12);
  await adapter.setBodyYawDeg(90);
  assert.ok(Math.abs(session.calls[3].command.pose.bodyYaw - Math.PI / 2) < 1e-12);
  await adapter.close();
}

async function testPydanticOptionalNullFields() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  await enableReachyTargets(adapter);

  const headTarget = [...IDENTITY];
  headTarget[3] = 0.15;
  const sdkSetFullTarget = await adapter.handleMessage({
    type: "set_full_target",
    head: headTarget,
    antennas: [0.11, -0.11],
    body_yaw: null,
  });
  assert.equal(sdkSetFullTarget.status, "ok", "the official Python SDK's omitted body_yaw serializes as null");
  assert.deepEqual(session.calls[0].command.pose, { head: headTarget, antennas: [0.11, -0.11] });

  const antennasOnly = await adapter.handleMessage({
    type: "set_full_target",
    head: null,
    antennas: [0.22, -0.22],
    body_yaw: null,
  });
  assert.equal(antennasOnly.status, "ok", "antenna-only Pydantic requests treat other null fields as omitted");
  assert.deepEqual(session.calls[1].command.pose, { antennas: [0.22, -0.22] });

  const headOnly = await adapter.handleMessage({
    type: "set_full_target",
    head: headTarget,
    antennas: null,
    body_yaw: null,
  });
  assert.equal(headOnly.status, "ok", "head-only Pydantic requests treat other null fields as omitted");
  assert.deepEqual(session.calls[2].command.pose, { head: headTarget });

  const callCount = session.calls.length;
  const invalidNumber = await adapter.handleMessage({
    type: "set_full_target", antennas: [0.1, 0.2], body_yaw: "0",
  });
  assert.match(invalidNumber.error, /body_yaw must be a finite number/);
  const invalidMatrix = [...IDENTITY];
  invalidMatrix[4] = null;
  const invalidHead = await adapter.handleMessage({ type: "set_full_target", head: invalidMatrix, antennas: null, body_yaw: null });
  assert.match(invalidHead.error, /16 finite numbers/);
  assert.equal(session.calls.length, callCount, "invalid numeric or matrix elements never reach the backend");

  await adapter.close();
}

async function testStopCancelsScheduledGotoFrames() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  await enableReachyTargets(adapter);
  const target = [...IDENTITY];
  target[3] = 1;
  const goto = adapter.handleMessage({ type: "goto_target", head: target, duration: 0.4 });
  await sleep(65);
  const countAtStop = session.calls.length;
  assert.ok(countAtStop >= 1 && countAtStop < 12, "goto emits a bounded sequence of interpolated frames");
  const stop = await adapter.handleMessage({ type: "stop_move" });
  assert.equal(stop.stopped, true);
  await goto;
  await sleep(80);
  assert.equal(session.calls.length, countAtStop, "no timer frame is sent after STOP");
  await adapter.close();
}

async function testOriginalPythonSdkTaskRequests() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  assert.equal((await adapter.handleMessage({ type: "get_motor_mode" })).motor_mode, "enabled",
    "an explicitly opened Reachy app session starts with its virtual target gate open");
  const target = [...IDENTITY];
  target[3] = 1;
  const uuid = "13c25c0e-5f00-4c35-8e12-4794e5221b90";
  const request = taskEnvelope(uuid, {
    head: target,
    antennas: [0.5, -0.5],
    duration: 2,
    method: "minjerk",
    body_yaw: 1,
  });
  const started = await adapter.handleMessage(request, { sequence: 10, ttlMs: 1_200 });
  assert.equal(started.type, "task_progress");
  assert.equal(started.uuid, uuid);
  assert.equal(started.finished, false);
  assert.equal(started.error, null);
  assert.ok(Number.isFinite(Date.parse(started.timestamp)), "task progress timestamp is ISO-compatible");
  assert.equal(session.calls.length, 1, "task starts dispatching without awaiting its full duration");
  assert.deepEqual(session.calls[0].options, { sequence: 1, ttlMs: 750 },
    "the source sequence is tracked separately and each target frame gets a fresh short core lease");
  const firstFrame = session.calls[0].command.pose;
  const firstMinJerkProgress = 10 * (1 / 60) ** 3 - 15 * (1 / 60) ** 4 + 6 * (1 / 60) ** 5;
  assert.ok(Math.abs(firstFrame.bodyYaw - firstMinJerkProgress) < 1e-12, "task method controls the Reachy time trajectory");
  assert.ok(Math.abs(firstFrame.head[3] - firstMinJerkProgress) < 1e-12);
  await sleep(1_300);
  assert.ok(session.calls.length > 30, "the admitted 2-second task continues beyond its 1.2-second source freshness window");
  assert.equal(adapter.takeMessages().some((message) => message.type === "task_progress" && message.uuid === uuid && message.finished), false,
    "the task remains active after its source TTL; core leases are renewed per frame");
  assert.ok(session.calls.every((call, index) => call.options.ttlMs === 750 && call.options.sequence === index + 1),
    "animation frames use independent strictly increasing core sequence numbers and short leases");
  await sleep(850);
  const finished = adapter.takeMessages().find((message) => message.type === "task_progress" && message.uuid === uuid);
  assert.ok(finished, "task completion is sent asynchronously through the message queue");
  assert.equal(finished.finished, true);
  assert.equal(finished.error, null);

  const cancelledUuid = "3f4b057f-397b-4ec2-a26d-c511c021377c";
  const cancelledTask = taskEnvelope(cancelledUuid, {
    head: target,
    antennas: null,
    duration: 2,
    method: "linear",
    body_yaw: null,
  });
  const pending = await adapter.handleMessage(cancelledTask, { sequence: 11, ttlMs: 1_200 });
  assert.equal(pending.finished, false);
  await sleep(1_300);
  const callsAtStop = session.calls.length;
  assert.ok(callsAtStop > 90, "the second task is still animating after the source TTL");
  const stop = await adapter.handleMessage({ type: "stop_move" }, { sequence: 12, ttlMs: 1_200 });
  assert.equal(stop.stopped, true);
  await sleep(10);
  const stopped = adapter.takeMessages().find((message) => message.type === "task_progress" && message.uuid === cancelledUuid);
  assert.ok(stopped);
  assert.equal(stopped.finished, true);
  assert.match(stopped.error, /stop|cancel/i);
  await sleep(50);
  assert.equal(session.calls.length, callsAtStop, "STOP prevents any later task frame");

  const staleCalls = session.calls.length;
  const staleUuid = "9f04921f-9334-4805-8e43-64c70a665f9f";
  const stale = await adapter.handleMessage(taskEnvelope(staleUuid, {
    head: target, antennas: null, duration: 0.1, method: "linear", body_yaw: null,
  }), { sequence: 11, ttlMs: 1_200 });
  assert.equal(stale.type, "task_progress");
  assert.equal(stale.finished, true);
  assert.match(stale.error, /stale.*sequence/i);
  assert.equal(session.calls.length, staleCalls, "source sequence ordering is checked before a stale task is admitted");

  const unsupportedUuid = "ad060cde-27b5-4ad2-a497-96f8f9d593f1";
  const unsupported = await adapter.handleMessage(taskEnvelope(unsupportedUuid, { move_name: "dance" }), { sequence: 13, ttlMs: 1_200 });
  assert.equal(unsupported.finished, false);
  const unsupportedFinished = adapter.takeMessages().find((message) => message.type === "task_progress" && message.uuid === unsupportedUuid);
  assert.equal(unsupportedFinished.finished, true);
  assert.match(unsupportedFinished.error, /unsupported/i);

  const invalid = await adapter.handleMessage(taskEnvelope("not-a-uuid", {
    head: target,
    antennas: null,
    duration: 0.1,
    method: "mystery",
    body_yaw: null,
  }));
  assert.match(invalid.error, /UUID/);
  await adapter.close();
}

async function testOutOfBandStopDuringPendingFrame() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  await enableReachyTargets(adapter);
  const delayed = deferred();
  session.delayNext = delayed;
  const target = [...IDENTITY];
  target[3] = 0.5;
  const goto = adapter.handleMessage({ type: "goto_target", head: target, duration: 0.3 });
  await sleep(5);
  assert.equal(session.calls.length, 1);
  await session.stop("another adapter stopped the shared core");
  delayed.resolve();
  const response = await goto;
  assert.match(response.error, /cancel|stopp/i);
  await sleep(50);
  assert.equal(session.calls.length, 1, "a late execute completion cannot schedule a later frame");
  assert.equal(session.applied.length, 0, "the fake core rejects the frame invalidated by STOP");
  await adapter.close();
}

async function testNamedReachyMovesUseAdvertisedCoreActions() {
  const session = makeSession({ gestures: ["nod", "looi_dance"] });
  const adapter = createReachyAdapter(session);
  const firstUuid = "c3be61ef-31c7-4be2-b01c-7a03bbb124ef";
  const first = await adapter.handleMessage(taskEnvelope(firstUuid, { move_name: "looi_dance" }), { sequence: 7, ttlMs: 1_200 });
  assert.equal(first.type, "task_progress");
  assert.equal(first.uuid, firstUuid);
  assert.equal(first.finished, false);
  await sleep(0);
  assert.deepEqual(session.calls[0], {
    command: { kind: "gesture", name: "looi_dance" },
    options: { sequence: 1, ttlMs: 3_000 },
  }, "an advertised custom alias passes unchanged through the normal session gesture command");
  const firstMessages = adapter.takeMessages();
  const firstFinished = firstMessages.find((message) => message.type === "task_progress" && message.uuid === firstUuid);
  assert.ok(firstFinished);
  assert.equal(firstFinished.finished, true);
  assert.equal(firstFinished.error, null);
  assert.deepEqual(session.applied[0], { kind: "gesture", name: "looi_dance" });

  const callCount = session.calls.length;
  const unknownUuid = "c604c3ec-21e7-4bb1-9e92-447385bf8b39";
  const unknown = await adapter.handleMessage(taskEnvelope(unknownUuid, { move_name: "dance" }), { sequence: 8, ttlMs: 1_200 });
  assert.equal(unknown.finished, false);
  await sleep(0);
  const unknownFinished = adapter.takeMessages().find((message) => message.type === "task_progress" && message.uuid === unknownUuid);
  assert.ok(unknownFinished);
  assert.equal(unknownFinished.finished, true);
  assert.match(unknownFinished.error, /unsupported/i);
  assert.equal(session.calls.length, callCount, "unadvertised names never reach the core and do not start a motion");

  const staleUuid = "331dbdb6-3ed4-4e5e-819e-375c5387ff08";
  const stale = await adapter.handleMessage(taskEnvelope(staleUuid, { move_name: "nod" }), { sequence: 6, ttlMs: 1_200 });
  assert.equal(stale.finished, true);
  assert.match(stale.error, /stale.*sequence/i);
  assert.equal(session.calls.length, callCount, "source sequencing is checked before named actions are admitted");

  const invalidLifetime = await adapter.handleMessage(taskEnvelope("3cace5ea-1397-48b7-b8c7-545d6690a779", { move_name: "nod" }), { ttlMs: 0 });
  assert.equal(invalidLifetime.finished, true);
  assert.match(invalidLifetime.error, /lifetime/i);
  assert.equal(session.calls.length, callCount, "invalid source lifetimes never reach the core gesture service");

  const disabledUuid = "eb32aa6e-6ceb-4b47-9371-7c694715c65b";
  await adapter.handleMessage({ type: "set_motor_mode", mode: "disabled" });
  const disabled = await adapter.handleMessage(taskEnvelope(disabledUuid, { move_name: "nod" }), { sequence: 9, ttlMs: 1_200 });
  assert.equal(disabled.finished, false);
  await sleep(0);
  const disabledFinished = adapter.takeMessages().find((message) => message.type === "task_progress" && message.uuid === disabledUuid);
  assert.ok(disabledFinished);
  assert.equal(disabledFinished.finished, true);
  assert.match(disabledFinished.error, /disabled/i);
  assert.equal(session.calls.length, callCount, "the Reachy virtual motor gate blocks named actions before session execution");
  await adapter.close();
}

async function testNamedReachyMoveReplacementAndCloseDropLateCompletion() {
  const session = makeSession({ gestures: ["nod", "curious"] });
  const adapter = createReachyAdapter(session);
  const delayed = deferred();
  session.delayNext = delayed;
  const oldUuid = "945d2509-6cee-48d0-9828-c28a4ed3593b";
  const oldTask = await adapter.handleMessage(taskEnvelope(oldUuid, { move_name: "nod" }), { sequence: 1, ttlMs: 1_200 });
  assert.equal(oldTask.finished, false);

  const newUuid = "948b585d-2334-4814-8da5-bc4dd6e3f0f6";
  const newTask = await adapter.handleMessage(taskEnvelope(newUuid, { move_name: "curious" }), { sequence: 2, ttlMs: 1_200 });
  assert.equal(newTask.finished, false);
  await sleep(0);
  assert.equal(session.calls.length, 2);
  assert.deepEqual(session.calls.map((call) => call.command.name), ["nod", "curious"]);
  assert.deepEqual(session.calls.map((call) => call.options.sequence), [1, 2], "gesture replacements keep the core pose sequence monotonic");

  delayed.reject(new Error("late backend failure after replacement"));
  await sleep(0);
  const replacementMessages = adapter.takeMessages();
  const oldFinished = replacementMessages.find((message) => message.type === "task_progress" && message.uuid === oldUuid);
  const newFinished = replacementMessages.find((message) => message.type === "task_progress" && message.uuid === newUuid);
  assert.ok(oldFinished);
  assert.equal(oldFinished.finished, true);
  assert.match(oldFinished.error, /supersed/i, "a replaced action completes with cancellation rather than late success");
  assert.ok(newFinished);
  assert.equal(newFinished.finished, true);
  assert.equal(newFinished.error, null);
  assert.deepEqual(session.applied, [{ kind: "gesture", name: "curious" }], "the replaced delayed action cannot apply after its successor");

  const closing = deferred();
  session.delayNext = closing;
  const closingUuid = "ea37f23b-1837-4b75-85b7-97f841d0b13e";
  const pending = await adapter.handleMessage(taskEnvelope(closingUuid, { move_name: "nod" }), { sequence: 3, ttlMs: 1_200 });
  assert.equal(pending.finished, false);
  await adapter.close();
  assert.ok(session.stopCalls.includes("Reachy adapter closed"), "closing an app adapter closes the session and sends STOP");
  closing.resolve();
  await sleep(0);
  assert.deepEqual(adapter.takeMessages(), [], "an app-session close drops late completion messages after STOP/close invalidates the run");
}

async function testMalformedAndUnsupportedCommands() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  assert.match((await adapter.handleMessage("{" )).error, /Invalid JSON/);
  assert.match((await adapter.handleMessage(null)).error, /expected an object/);
  assert.match((await adapter.handleMessage({ type: "set_target", head: IDENTITY.slice(0, 15) })).error, /16 finite numbers/);
  assert.match((await adapter.handleMessage({ type: "set_antennas", antennas: [0] })).error, /exactly two/);
  assert.equal((await adapter.handleMessage({ type: "play_sound", file: "beep.wav" })).compatibility_status, "unsupported");
  assert.equal((await adapter.handleMessage({ type: "get_imu" })).imu, null);
  const updateRefusal = await adapter.handleMessage({ type: "start_update" });
  assert.deepEqual(updateRefusal, {
    error: "My LOOI updates are managed by the app update system",
    command: "start_update",
  });
  assert.match((await adapter.handleMessage({ type: "start_update", pre_release: true })).error, /managed by the app update system/);
  for (const preRelease of [null, "true", 1, {}]) {
    assert.match((await adapter.handleMessage({ type: "start_update", pre_release: preRelease })).error, /pre_release must be a boolean/);
  }
  assert.equal(session.calls.length, 0);
  await adapter.close();
}

async function testReachyAudioServicesAndSessionPersistence() {
  const gains = { speaker: 37, microphone: 64 };
  const audioCalls = [];
  const soundCalls = [];
  let soundAccepted = true;
  const media = {
    audio: {
      async getGain(device) {
        audioCalls.push({ operation: "get", device });
        return { percent: gains[device], origin: "webrtc-track-gain", pending: true };
      },
      async setGain(device, percent) {
        audioCalls.push({ operation: "set", device, percent });
        gains[device] = percent;
        return { percent, origin: "webrtc-track-gain", pending: true };
      },
    },
    sound: {
      async play(name) {
        soundCalls.push(name);
        return soundAccepted ? { accepted: true } : { accepted: false, reason: "speaker is not enabled for this app" };
      },
      async stop() {},
    },
  };

  const first = createReachyAdapter(makeSession(), { media });
  assert.deepEqual(await first.handleMessage({ type: "get_volume" }), { command: "get_volume", volume: 37 });
  assert.deepEqual(await first.handleMessage({ type: "get_microphone_volume" }), { command: "get_microphone_volume", volume: 64 });
  assert.deepEqual(await first.handleMessage({ type: "set_volume", volume: 22 }), { status: "ok", command: "set_volume", volume: 22 });
  assert.deepEqual(await first.handleMessage({ type: "set_microphone_volume", volume: 48 }), {
    status: "ok", command: "set_microphone_volume", volume: 48,
  });
  await first.close();

  const second = createReachyAdapter(makeSession(), { media });
  assert.deepEqual(await second.handleMessage({ type: "get_volume" }), { command: "get_volume", volume: 22 });
  assert.deepEqual(await second.handleMessage({ type: "get_microphone_volume" }), { command: "get_microphone_volume", volume: 48 });
  assert.deepEqual(audioCalls, [
    { operation: "get", device: "speaker" },
    { operation: "get", device: "microphone" },
    { operation: "set", device: "speaker", percent: 22 },
    { operation: "set", device: "microphone", percent: 48 },
    { operation: "get", device: "speaker" },
    { operation: "get", device: "microphone" },
  ]);

  const supportedSounds = [
    ["chirp.wav", "chirp"],
    ["greet.wav", "greet"],
    ["inquire.wav", "inquire"],
    ["alarm.wav", "alarm"],
    ["peck.wav", "peck"],
    ["coo.wav", "coo"],
    ["wheee.wav", "wheee"],
  ];
  for (const [file, tag] of supportedSounds) {
    const played = await second.handleMessage({ type: "play_sound", file });
    assert.deepEqual(played, { status: "ok", command: "play_sound", sound_origin: "looi-synthesized" });
    assert.equal(soundCalls.at(-1), tag, `${file} maps to its exact synthesized LOOI sound tag`);
  }
  assert.deepEqual(soundCalls, supportedSounds.map(([, tag]) => tag));
  for (const file of ["../chirp.wav", "/tmp/chirp.wav", "sounds/chirp.wav", "https://example.test/chirp.wav", "user-audio.wav"]) {
    const refused = await second.handleMessage({ type: "play_sound", file });
    assert.equal(refused.command, "play_sound", `safe refusal preserves the command name for ${file}`);
    assert.equal(typeof refused.error, "string", `unsafe sound file is refused: ${file}`);
  }
  assert.deepEqual(soundCalls, supportedSounds.map(([, tag]) => tag), "unknown names and paths never reach the sound service");

  soundAccepted = false;
  const consentRefusal = await second.handleMessage({ type: "play_sound", file: "greet.wav" });
  assert.equal(typeof consentRefusal.error, "string");
  assert.equal(consentRefusal.command, "play_sound");
  assert.equal(consentRefusal.sound_origin, undefined, "refused playback is never reported as successful");
  assert.deepEqual(soundCalls, [...supportedSounds.map(([, tag]) => tag), "greet"]);
  await second.close();
}

async function testAudioCommandsWithoutAppMedia() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  assert.deepEqual(await adapter.handleMessage({ type: "get_volume" }), { command: "get_volume", volume: null });
  const fallbackSet = await adapter.handleMessage({ type: "set_volume", volume: 31 });
  assert.deepEqual(fallbackSet, { status: "ok", command: "set_volume", volume: 31 });
  assert.equal(session.calls.at(-1).command.kind, "volume", "legacy speaker volume remains available without app media services");
  for (const command of ["get_microphone_volume", "set_microphone_volume"]) {
    const reply = await adapter.handleMessage({ type: command, ...(command === "set_microphone_volume" ? { volume: 45 } : {}) });
    assert.equal(reply.command, command);
    assert.equal(typeof reply.error, "string");
  }
  await adapter.close();
}

async function testUploadedMoveValidationAndCancellation() {
  const session = makeSession();
  const adapter = createReachyAdapter(session);
  await enableReachyTargets(adapter);
  await adapter.handleMessage({ type: "start_recording" });
  assert.equal((await adapter.handleMessage({ type: "append_record", record: { time: 10, body_yaw: 0 } })).status, "ok");
  assert.match((await adapter.handleMessage({ type: "append_record", record: { time: 10, body_yaw: 0.1 } })).error, /strictly increasing/);
  await adapter.handleMessage({ type: "stop_recording" });
  assert.equal(adapter.takeMessages()[0].type, "recorded_data");

  const invalid = JSON.stringify({ time: [1, 1], set_target_data: [
    { head: IDENTITY, antennas: [0, 0] }, { head: IDENTITY, antennas: [0, 0] },
  ] });
  await adapter.handleMessage({ type: "upload_move_start", upload_id: "bad", total_chunks: 1 });
  await adapter.handleMessage({ type: "upload_move_chunk", upload_id: "bad", chunk_index: 0, chunk: invalid });
  assert.match((await adapter.handleMessage({ type: "upload_move_finish", upload_id: "bad" })).error, /strictly increasing/);

  const movedHead = [...IDENTITY];
  movedHead[3] = 0.5;
  const valid = JSON.stringify({ description: "short dance", time: [100, 100.4], set_target_data: [
    { head: IDENTITY, antennas: [0, 0], body_yaw: 0 },
    { head: movedHead, antennas: [0.2, -0.2], body_yaw: 0.3 },
  ] });
  await adapter.handleMessage({ type: "upload_move_start", upload_id: "dance", total_chunks: 1, estimated_duration_s: 0.4 });
  await adapter.handleMessage({ type: "upload_move_chunk", upload_id: "dance", chunk_index: 0, chunk: valid });
  assert.equal((await adapter.handleMessage({ type: "upload_move_finish", upload_id: "dance" })).status, "ok");
  assert.equal(await adapter.handleMessage({ type: "play_uploaded_move", upload_id: "dance", play_frequency: 20 }), null);
  assert.equal(adapter.takeMessages()[0].started, true);
  await sleep(70);
  const beforeStop = session.calls.length;
  assert.ok(beforeStop > 0);
  await adapter.handleMessage({ type: "cancel_move", upload_id: "dance" });
  await sleep(30);
  assert.equal(session.calls.length, beforeStop, "cancel_move prevents any later playback frame");
  const end = adapter.takeMessages().find((event) => event.type === "play_uploaded_move" && event.cancelled);
  assert.ok(end, "uploaded playback emits its protocol cancellation event");
  await adapter.close();
}

await testStateEnvelopeAndVirtualOrigin();
await testVirtualMotorLifecycleAndEnsureAwake();
await testRowMajorMatricesAndRadians();
await testStopCancelsScheduledGotoFrames();
await testOriginalPythonSdkTaskRequests();
await testOutOfBandStopDuringPendingFrame();
await testNamedReachyMovesUseAdvertisedCoreActions();
await testNamedReachyMoveReplacementAndCloseDropLateCompletion();
await testMalformedAndUnsupportedCommands();
await testReachyAudioServicesAndSessionPersistence();
await testAudioCommandsWithoutAppMedia();
await testPydanticOptionalNullFields();
await testUploadedMoveValidationAndCancellation();
console.log("robot-bridge-reachy.test.mjs: all checks passed");
