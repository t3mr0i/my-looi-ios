import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterModule = loadTypeScript(path.join(here, "../src/robot-bridge/microduck-adapter.ts"));
const { createMicroDuckAdapter, MICRODUCK_API_VERSION, MICRODUCK_PROTOCOL_COMMIT } = adapterModule;
const sharedTypes = loadTypeScript(path.join(here, "../src/robot-bridge/types.ts"));
const sharedActionProfile = loadTypeScript(path.join(here, "../src/robot-bridge/action-profile.ts"), { "./types": sharedTypes });
const { createRobotCore } = loadTypeScript(path.join(here, "../src/robot-bridge/core.ts"), { "./types": sharedTypes, "./action-profile": sharedActionProfile });

function makeSession(overrides = {}) {
  const calls = { execute: [], stop: [], listeners: [] };
  let snapshot = {
    schemaVersion: 1,
    backend: "looi",
    capabilities: {
      schemaVersion: 1,
      locomotion: { forward: true, lateral: true, yaw: true, simultaneous: true, calibratedVelocity: false, odometry: false },
      pose: { head: "continuous", headTranslation: false, headRoll: false, headYaw: true, antennas: false, bodyYaw: "none" },
      gestures: ["dance", "nod"],
      light: false,
      media: { camera: false, microphone: false, speaker: false, volume: false },
    },
    sessionId: "session-test",
    active: true,
    generation: 0,
    virtualPose: {},
    observed: {
      connected: true,
      moving: false,
      measuredPose: null,
      measuredVelocity: null,
      safetyReason: null,
    },
    lastResult: null,
    ...overrides.snapshot,
  };
  let lastSequence = -1;
  const session = {
    id: "session-test",
    closed: false,
    inspect() { return snapshot; },
    async execute(command, options) {
      calls.execute.push({ command, options });
      if (options?.sequence !== undefined && options.sequence <= lastSequence) {
        const result = { status: "rejected", limitations: ["stale sequence"], message: "stale sequence" };
        snapshot = { ...snapshot, lastResult: { ...result, sessionId: session.id, commandId: calls.execute.length } };
        return snapshot.lastResult;
      }
      if (options?.sequence !== undefined) lastSequence = options.sequence;
      const result = overrides.executeResult?.(command, options) ?? {
        status: "applied",
        limitations: [],
        applied: command,
      };
      snapshot = { ...snapshot, lastResult: { ...result, sessionId: session.id, commandId: calls.execute.length } };
      return snapshot.lastResult;
    },
    async stop(reason) {
      calls.stop.push(reason);
      snapshot = { ...snapshot, generation: snapshot.generation + 1, observed: { ...snapshot.observed, moving: false } };
    },
    async close() {},
    subscribe(listener) {
      calls.listeners.push(listener);
      return () => { calls.listeners = calls.listeners.filter((candidate) => candidate !== listener); };
    },
  };
  return { session, calls, setSnapshot(value) { snapshot = value; }, emit(snapshotValue = snapshot) { calls.listeners.forEach((listener) => listener(snapshotValue)); } };
}

function makeSoundService() {
  const calls = { play: [], stop: 0 };
  return {
    calls,
    service: {
      async play(name, options = {}) {
        calls.play.push({ name, options });
        return { accepted: true };
      },
      async stop() { calls.stop += 1; },
    },
  };
}

function request(method, params, id = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function notification(method, params) {
  return { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
}

function successResult(response) {
  assert.ok(response && "result" in response, JSON.stringify(response));
  return response.result;
}

function error(response, expectedCode) {
  assert.ok(response && "error" in response, JSON.stringify(response));
  assert.equal(response.error.code, expectedCode);
  return response.error;
}

function assertPinnedRobotStateShape(state) {
  // Required fields and non-optional nested structs from duck-ipc-proto at the pinned commit.
  assert.equal(typeof state.t, "number");
  assert.ok(Array.isArray(state.move.requested) && state.move.requested.length === 3);
  assert.ok(Array.isArray(state.move.applied) && state.move.applied.length === 3);
  assert.ok(Array.isArray(state.head) && state.head.length === 4);
  assert.equal(typeof state.policy, "string");
  assert.equal(typeof state.safety.fallen, "boolean");
  assert.equal(typeof state.safety.limp, "boolean");
  assert.ok(Array.isArray(state.safety.gravity) && state.safety.gravity.length === 3);
  assert.ok(state.safety.gain === null || Number.isInteger(state.safety.gain));
  assert.equal(typeof state.safety.picked_up, "boolean");
  assert.equal(typeof state.loop.hz, "number");
  assert.ok(Number.isInteger(state.loop.missed));
  for (const field of ["joints", "targets", "velocities", "currents_ma"]) assert.ok(Array.isArray(state[field]));
  assert.ok(Array.isArray(state.odom.position) && state.odom.position.length === 3);
  assert.equal(typeof state.odom.yaw, "number");
}

async function run() {
  const h = makeSession();
  const adapter = createMicroDuckAdapter(h.session);

  const hello = await adapter.handleMessage(request("hello", { api_version: 44 }, 0));
  assert.equal(hello.id, 0, "numeric request id zero is preserved");
  assert.equal(hello.result.api_version, MICRODUCK_API_VERSION);
  assert.equal(hello.result.daemon_version, null, "adapter must not claim to be a MicroDuck daemon release");
  assert.equal(hello.result.robot.origin, "looi");
  assert.equal(hello.result.robot.compatibility.protocol_commit, MICRODUCK_PROTOCOL_COMMIT);
  assert.equal(hello.result.robot.compatibility.policy_runtime, false);
  assert.equal(h.calls.execute.length, 0);

  const subscribe = successResult(await adapter.handleMessage(request("robot.subscribe", { hz: 0 }, 40)));
  assert.equal(subscribe.accepted, true);
  assert.equal(subscribe.compatibility.stateHzRequested, 0, "subscribe accepts the source protocol's unsigned 32-bit frequency field");

  let clockMs = 0;
  const rateHarness = makeSession();
  const rateAdapter = createMicroDuckAdapter(rateHarness.session, { now: () => clockMs });
  assert.equal(rateAdapter.stateMessages().length, 1, "unsubscribed state follows the transport pump rate");
  const rateSubscribe = await rateAdapter.handleMessage(request("robot.subscribe", { hz: 2 }, 42));
  assert.equal(successResult(rateSubscribe).accepted, true);
  assert.equal(rateAdapter.stateMessages().length, 1, "the first state after subscribe is sent promptly");
  assert.equal(rateAdapter.stateMessages().length, 0, "hz=2 suppresses another frame on the same poll time");
  clockMs = 499;
  assert.equal(rateAdapter.stateMessages().length, 0, "hz=2 waits for its 500 ms period");
  clockMs = 500;
  assert.equal(rateAdapter.stateMessages().length, 1, "hz=2 permits the next frame at 500 ms");
  const directStateBefore = rateAdapter.getStateEvent();
  rateAdapter.getStateEvent();
  assert.deepEqual(rateAdapter.stateMessages(), [], "direct state snapshots do not mutate notification timing");
  assertPinnedRobotStateShape(directStateBefore.params);
  const fasterSubscribe = await rateAdapter.handleMessage(request("robot.subscribe", { hz: 4 }, 43));
  assert.equal(successResult(fasterSubscribe).accepted, true);
  assert.equal(rateAdapter.stateMessages().length, 1, "resubscribing replaces the per-session rate and resets its cadence");
  clockMs = 749;
  assert.equal(rateAdapter.stateMessages().length, 0);
  clockMs = 750;
  assert.equal(rateAdapter.stateMessages().length, 1, "hz=4 permits the next frame after 250 ms");
  const invalidRate = await rateAdapter.handleMessage(request("robot.subscribe", { hz: 1.5 }, 44));
  error(invalidRate, -32602);
  assert.equal(rateAdapter.stateMessages().length, 0, "invalid resubscribe does not change the chosen rate");
  clockMs = 1000;
  assert.equal(rateAdapter.stateMessages().length, 1, "the valid hz=4 schedule survives invalid resubscribe");

  const zeroRateAdapter = createMicroDuckAdapter(makeSession().session, { now: () => clockMs });
  await zeroRateAdapter.handleMessage(request("robot.subscribe", { hz: 0 }, 45));
  assert.equal(zeroRateAdapter.stateMessages().length, 1);
  assert.equal(zeroRateAdapter.stateMessages().length, 1, "hz=0 leaves polling unthrottled");

  const move = await adapter.handleMessage(request("robot.move", { vx: 0.3, vy: 0, vyaw: 0.4 }, "move-1"), { sequence: 7, ttlMs: 180 });
  assert.equal(move.id, "move-1");
  assert.equal(successResult(move).accepted, true);
  assert.deepEqual(h.calls.execute.at(-1).command, {
    kind: "drive", forward: 0.3, lateral: 0, yawRate: 0.4, durationMs: 155,
  });
  assert.deepEqual(h.calls.execute.at(-1).options, { sequence: 7, ttlMs: 180 });

  await adapter.handleMessage(request("robot.move", { vx: 1, vy: 0, vyaw: 0 }, 2), { ttlMs: 5000 });
  assert.equal(h.calls.execute.at(-1).command.durationMs, 475, "drive duration leaves a completion margin before the 500ms lease expires");
  assert.equal(h.calls.execute.at(-1).options.ttlMs, 500);

  const beforeNotification = h.calls.execute.length;
  assert.equal(await adapter.handleMessage(notification("robot.move", { vx: 0.1, vy: 0, vyaw: 0 })), null);
  assert.equal(h.calls.execute.length, beforeNotification + 1);
  assert.equal(await adapter.handleMessage(notification("robot.move", { vx: Number.NaN, vy: 0, vyaw: 0 })), null);
  assert.equal(h.calls.execute.length, beforeNotification + 1, "invalid notification never actuates and never receives an error response");
  assert.equal(await adapter.handleMessage(notification("robot.notAFunction", {})), null, "unknown notification never receives a response");

  const unknownMethod = await adapter.handleMessage(request("robot.notAFunction", {}, "unknown"));
  assert.equal(unknownMethod.id, "unknown");
  error(unknownMethod, -32601);

  const invalidParameters = await adapter.handleMessage(request("robot.move", { vx: 1, lateral: 2 }, 23));
  assert.equal(invalidParameters.id, 23);
  error(invalidParameters, -32602);
  const invalidFinite = await adapter.handleMessage(request("robot.head", { head_yaw: Infinity }, 24));
  error(invalidFinite, -32602);
  assert.equal(h.calls.execute.length, beforeNotification + 1);

  const invalidEnvelope = await adapter.handleMessage({
    ...request("robot.move", { vx: 1, vy: 0, vyaw: 0 }, 24), result: "not a request member",
  });
  error(invalidEnvelope, -32600);
  assert.equal(h.calls.execute.length, beforeNotification + 1, "invalid envelope members never actuate");

  const beforeInvalidOptions = h.calls.execute.length;
  const invalidOptions = await adapter.handleMessage(request("robot.move", { vx: 0.1 }, 24), { ttlMs: 6000 });
  error(invalidOptions, -32602);
  assert.equal(h.calls.execute.length, beforeInvalidOptions, "invalid command metadata never actuates");

  const head = await adapter.handleMessage(request("robot.head", {
    neck_pitch: 0.2, head_pitch: -0.1, head_yaw: 0.4, head_roll: 0,
  }, 25));
  assert.equal(successResult(head).accepted, true);
  assert.equal(h.calls.execute.at(-1).command.kind, "target");
  assert.equal(h.calls.execute.at(-1).command.pose.head.length, 16);

  const look = await adapter.handleMessage(request("robot.look", { x: 1, y: 1, z: 1, neck_pitch: 0.1 }, 26));
  assert.equal(look.id, 26);
  assert.equal(successResult(look).clamped, true, "LOOI combines the MicroDuck neck and head pitch axes");
  assert.ok(Math.abs(successResult(look).head.head_yaw - Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(successResult(look).head.head_pitch + Math.atan2(1, Math.sqrt(2))) < 1e-9,
    "an above-trunk look target maps to negative pitch in the right-handed Z-up frame");

  const skills = successResult(await adapter.handleMessage(request("robot.skills", {}, 27)));
  assert.deepEqual(skills.skills.map((skill) => skill.name), ["dance", "nod"]);
  assert.deepEqual(skills.built_in, []);
  assert.equal(successResult(await adapter.handleMessage(request("robot.do", { skill: "dance" }, 28))).accepted, true);
  const doCalls = h.calls.execute.length;
  assert.equal(successResult(await adapter.handleMessage(request("robot.do", { skill: "kick_left" }, 29))).accepted, false);
  assert.equal(h.calls.execute.length, doCalls, "unsupported MicroDuck skill does not run any gesture");

  const queryHarness = makeSession();
  const queryAdapter = createMicroDuckAdapter(queryHarness.session, {
    now: () => 1_000,
    systemInfo: () => ({ name: "LOOI", serial: "looi-device-1", uptimeSeconds: 84 }),
    videoInfo: () => ({ available: true, width: 640, height: 480, rotate: 90, source: "measured" }),
  });
  const info = successResult(await queryAdapter.handleMessage(request("system.info", {}, 46)));
  assert.deepEqual(info, {
    name: "LOOI", serial: "looi-device-1", uptime_seconds: 84,
    compatibility: { origin: "looi", uptime_source: "device" },
  }, "system.info uses the pinned response names and only reports supplied device metadata");
  const policies = successResult(await queryAdapter.handleMessage(request("robot.policies", {}, 47)));
  assert.deepEqual(policies.skills, ["dance", "nod"], "the stock Console can fill its menu from known LOOI gestures");
  assert.equal(policies.mode, "looi");
  assert.equal(policies.enabled, false, "LOOI does not claim a MicroDuck policy runtime");
  assert.deepEqual(policies.slots, []);
  assert.equal(successResult(await queryAdapter.handleMessage(request("robot.mode", {}, 48))).mode, "looi");
  const health = successResult(await queryAdapter.handleMessage(request("robot.health", {}, 49)));
  assert.equal(health.healthy, true, "connected LOOI bridge with no reported safety stop is healthy within its declared scope");
  assert.equal(health.compatibility.health_scope, "looi-bridge-session");
  assert.equal(health.compatibility.hardware_metrics_available, false);
  for (const field of ["battery", "motors", "cpu_temp_c"]) {
    assert.equal(field in health, false, `health must not invent ${field} telemetry`);
  }
  assert.deepEqual(successResult(await queryAdapter.handleMessage(request("media.video", {}, 50))), {
    available: true, width: 640, height: 480, rotate: 90,
    compatibility: { origin: "looi", metadata_source: "measured" },
  });

  const noVideoAdapter = createMicroDuckAdapter(makeSession().session);
  assert.deepEqual(successResult(await noVideoAdapter.handleMessage(request("media.video", {}, 51))), {
    available: false, width: null, height: null, rotate: 0,
    compatibility: { origin: "looi", metadata_source: "unavailable" },
  }, "unavailable camera metadata is explicit and safe for the original Console's onVideoInfo handler");

  const soundHarness = makeSession();
  const sound = makeSoundService();
  const soundAdapter = createMicroDuckAdapter(soundHarness.session, { sound: sound.service });
  const chirp = successResult(await soundAdapter.handleMessage(request("robot.sound", { tag: "chirp" }, 53)));
  assert.equal(chirp.accepted, true, "stock MicroDuck Console one-shot tag is passed to the app audio service");
  assert.equal(sound.calls.play.at(-1).name, "chirp");
  const wheeeStart = successResult(await soundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 54)));
  assert.equal(wheeeStart.accepted, true);
  const heldSignal = sound.calls.play.at(-1).options.signal;
  assert.equal(sound.calls.play.at(-1).name, "wheee");
  assert.equal(sound.calls.play.at(-1).options.hold, true);
  const wheeeRefresh = successResult(await soundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 55)));
  assert.equal(wheeeRefresh.accepted, true);
  assert.equal(sound.calls.play.at(-1).options.signal, heldSignal,
    "200ms Console hold refreshes renew the same playback lease instead of restarting the sound");
  const wheeeRelease = successResult(await soundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: false }, 56)));
  assert.equal(wheeeRelease.accepted, true);
  assert.equal(sound.calls.play.at(-1).options.hold, false, "stock wheee pointer-up sends hold:false");
  assert.equal(heldSignal.aborted, true, "wheee hold lease is canceled on hold:false");
  const unsupportedSoundCallCount = sound.calls.play.length;
  error(await soundAdapter.handleMessage(request("robot.sound", { tag: "bell" }, 57)), -32602);
  assert.equal(sound.calls.play.length, unsupportedSoundCallCount, "unknown sound names never reach the player");

  const noSoundAdapter = createMicroDuckAdapter(makeSession().session);
  const noPlayer = successResult(await noSoundAdapter.handleMessage(request("robot.sound", { tag: "chirp" }, 58)));
  assert.equal(noPlayer.accepted, false, "missing audio capability is a truthful refusal, not fake successful playback");

  const stoppedSoundHarness = makeSession();
  const stoppedSound = makeSoundService();
  const stoppedSoundAdapter = createMicroDuckAdapter(stoppedSoundHarness.session, { sound: stoppedSound.service });
  await stoppedSoundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 59));
  const stoppedHoldSignal = stoppedSound.calls.play.at(-1).options.signal;
  await stoppedSoundAdapter.handleMessage(request("robot.stop", undefined, 60));
  assert.equal(stoppedHoldSignal.aborted, true, "robot.stop aborts a held sound lease");
  assert.equal(stoppedSound.calls.stop, 1, "robot.stop stops audio playback as well as locomotion");

  const relaxedSoundHarness = makeSession();
  const relaxedSound = makeSoundService();
  const relaxedSoundAdapter = createMicroDuckAdapter(relaxedSoundHarness.session, { sound: relaxedSound.service });
  await relaxedSoundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 61));
  const relaxedHoldSignal = relaxedSound.calls.play.at(-1).options.signal;
  await relaxedSoundAdapter.handleMessage(request("robot.relax", {}, 62));
  assert.equal(relaxedHoldSignal.aborted, true, "relax aborts a held sound lease");
  assert.equal(relaxedSound.calls.stop, 1, "relax stops audio playback when it closes the app intent gate");

  const disabledSoundHarness = makeSession();
  const disabledSound = makeSoundService();
  const disabledSoundAdapter = createMicroDuckAdapter(disabledSoundHarness.session, { sound: disabledSound.service });
  await disabledSoundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 63));
  const disabledHoldSignal = disabledSound.calls.play.at(-1).options.signal;
  await disabledSoundAdapter.handleMessage(request("robot.enable", { on: false }, 64));
  assert.equal(disabledHoldSignal.aborted, true, "robot.enable off aborts held sound playback");
  assert.equal(disabledSound.calls.stop, 1, "robot.enable off stops the active sound player");

  const closedSoundHarness = makeSession();
  const closedSound = makeSoundService();
  const closedSoundAdapter = createMicroDuckAdapter(closedSoundHarness.session, { sound: closedSound.service });
  await closedSoundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 65));
  const closedHoldSignal = closedSound.calls.play.at(-1).options.signal;
  await closedSoundAdapter.close();
  assert.equal(closedHoldSignal.aborted, true, "closing the app connection aborts held playback");
  assert.equal(closedSound.calls.stop, 1, "closing the app connection stops the player");
  await closedSoundAdapter.close();
  assert.equal(closedSound.calls.stop, 1, "adapter close is idempotent");

  const lateSoundHarness = makeSession();
  let finishLateHold;
  const lateSoundCalls = { stop: 0, signal: null };
  const lateSoundAdapter = createMicroDuckAdapter(lateSoundHarness.session, { sound: {
    play(_name, options = {}) {
      lateSoundCalls.signal = options.signal;
      return new Promise((resolve) => { finishLateHold = resolve; });
    },
    async stop() { lateSoundCalls.stop += 1; },
  } });
  const pendingHold = lateSoundAdapter.handleMessage(request("robot.sound", { tag: "wheee", hold: true }, 66));
  assert.ok(lateSoundCalls.signal, "hold requests carry a cancellation signal to the audio service");
  await lateSoundAdapter.handleMessage(request("robot.stop", undefined, 67));
  assert.equal(lateSoundCalls.signal.aborted, true, "robot.stop cancels a sound request even while player setup is pending");
  finishLateHold({ accepted: true });
  assert.equal(successResult(await pendingHold).accepted, false,
    "a late player acknowledgement after stop is reported as canceled, not accepted playback");
  assert.equal(lateSoundCalls.stop, 1);

  const disconnectedHarness = makeSession({ snapshot: {
    active: false,
    observed: { connected: false, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null },
  } });
  const disconnectedHealth = successResult(await createMicroDuckAdapter(disconnectedHarness.session)
    .handleMessage(request("robot.health", {}, 52)));
  assert.equal(disconnectedHealth.healthy, false);
  assert.equal(disconnectedHealth.degraded, false);
  assert.match(disconnectedHealth.reason, /disconnected/i);

  const stop = await adapter.handleMessage(request("robot.stop", undefined, 30));
  assert.deepEqual(successResult(stop), { accepted: true });
  assert.equal(h.calls.stop.length, 1);
  const lifecycleHarness = makeSession();
  const lifecycleAdapter = createMicroDuckAdapter(lifecycleHarness.session);
  const disable = successResult(await lifecycleAdapter.handleMessage(request("robot.enable", { on: false, toggle: true }, 31)));
  assert.equal(disable.accepted, true);
  assert.equal(disable.enabled, false);
  assert.equal(disable.compatibility.control_scope, "session-intent-gate");
  assert.equal(disable.compatibility.hardware_torque_control, false);
  assert.equal(lifecycleHarness.calls.stop.length, 1, "turning the logical gate off stops the current movement lease");
  const neutralCommand = lifecycleHarness.calls.execute.at(-1).command;
  assert.equal(neutralCommand.kind, "target");
  assert.deepEqual(neutralCommand.pose.head.map((value) => value === 0 ? 0 : value),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    "relaxing recenters the supported head target without claiming physical torque control");
  const disabledExecuteCount = lifecycleHarness.calls.execute.length;
  assert.equal(successResult(await lifecycleAdapter.handleMessage(request("robot.move", { vx: 0.2, vy: 0, vyaw: 0 }, 32))).accepted, false);
  assert.equal(successResult(await lifecycleAdapter.handleMessage(request("robot.do", { skill: "nod" }, 33))).accepted, false);
  assert.equal(lifecycleHarness.calls.execute.length, disabledExecuteCount, "disabled gate refuses movement and gestures");
  const enable = successResult(await lifecycleAdapter.handleMessage(request("robot.enable", { on: true, toggle: true }, 34)));
  assert.equal(enable.accepted, true);
  assert.equal(enable.enabled, true);
  assert.equal(successResult(await lifecycleAdapter.handleMessage(request("robot.do", { skill: "nod" }, 35))).accepted, true);
  const init = successResult(await lifecycleAdapter.handleMessage(request("robot.init", {}, 36)));
  assert.equal(init.accepted, true);
  assert.equal(init.enabled, true);
  const relax = successResult(await lifecycleAdapter.handleMessage(request("robot.relax", {}, 37)));
  assert.equal(relax.accepted, true);
  assert.equal(relax.enabled, false);
  const beforeShutdown = lifecycleHarness.calls.execute.length;
  const shutdown = successResult(await lifecycleAdapter.handleMessage(request("robot.shutdown", {}, 38)));
  assert.equal(shutdown.accepted, false, "the app must not claim it powered off LOOI");
  assert.equal(lifecycleHarness.calls.execute.length, beforeShutdown, "shutdown refusal never actuates");

  const unsupportedPolicy = await adapter.handleMessage(request("policy.install", { version: "v1" }, 34));
  error(unsupportedPolicy, -32001);
  assert.equal(h.calls.execute.length, doCalls, "unsupported maintenance routes never actuate");

  const lateralHarness = makeSession({ snapshot: { capabilities: {
    ...h.session.inspect().capabilities,
    locomotion: { ...h.session.inspect().capabilities.locomotion, lateral: false },
  } } });
  const lateralAdapter = createMicroDuckAdapter(lateralHarness.session);
  const lateralResponse = await lateralAdapter.handleMessage(request("robot.move", { vx: 0.2, vy: 0.1, vyaw: 0 }, 36));
  assert.equal(successResult(lateralResponse).accepted, false);
  assert.equal("applied" in successResult(lateralResponse), false, "unsupported moves do not invent an applied SI vector");
  assert.equal(lateralHarness.calls.execute.length, 0, "unsupported lateral motion blocks the whole twist instead of applying it partially");
  assert.equal(lateralHarness.calls.stop.length, 1, "refusing a lateral request also invalidates any older locomotion lease");
  const moveState = lateralAdapter.getStateEvent().params.move;
  assert.deepEqual(moveState.requested, [0.2, 0.1, 0]);
  assert.deepEqual(moveState.applied, [0, 0, 0]);
  assert.match(moveState.limited_by[0], /lateral locomotion/);
  assert.equal(lateralAdapter.getStateEvent().params.compatibility.moveAppliedKnown, false,
    "schema-required neutral state value is explicitly marked virtual when actual SI velocity is unavailable");

  const adaptedHarness = makeSession({ executeResult: () => ({ status: "adapted", limitations: ["SI velocity was mapped to direction and TTL"] }) });
  const adaptedAdapter = createMicroDuckAdapter(adaptedHarness.session);
  const adaptedMove = successResult(await adaptedAdapter.handleMessage(request("robot.move", { vx: 0.4, vy: 0, vyaw: 0 }, 39)));
  assert.equal(adaptedMove.accepted, true);
  assert.equal("applied" in adaptedMove, false, "approximate LOOI movement does not claim a calibrated SI result");
  assert.equal(adaptedAdapter.getStateEvent().params.compatibility.moveAppliedKnown, false);

  const sequenceResponse1 = await adapter.handleMessage(request("robot.move", { vx: 0.1, vy: 0, vyaw: 0 }, 37), { sequence: 50, ttlMs: 100 });
  assert.equal(successResult(sequenceResponse1).accepted, true);
  const sequenceResponse2 = await adapter.handleMessage(request("robot.move", { vx: 0.8, vy: 0, vyaw: 0 }, 38), { sequence: 49, ttlMs: 100 });
  assert.equal(successResult(sequenceResponse2).accepted, false, "stale sequence is surfaced as a refusal");
  assert.equal("applied" in successResult(sequenceResponse2), false, "stale sequence refusal does not claim a physical SI vector");
  assert.equal(h.calls.execute.at(-1).options.sequence, 49, "adapter preserves source sequence for core admission");

  const stateEvent = adapter.getStateEvent();
  assert.equal(stateEvent.method, "robot.state");
  assert.deepEqual(stateEvent.params.joints, [], "unknown MicroDuck joint measurements stay absent");
  assert.equal(stateEvent.params.compatibility.origin, "looi");
  assert.equal(stateEvent.params.compatibility.measured.velocity, null);
  assert.ok(stateEvent.params.compatibility.virtualFields.includes("safety"));
  assertPinnedRobotStateShape(stateEvent.params);
  let streamed;
  const unsubscribe = adapter.subscribeState((event) => { streamed = event; });
  h.emit();
  assert.equal(streamed.method, "robot.state");
  unsubscribe();

  const coreCapabilities = {
    schemaVersion: 1,
    locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: true, odometry: false },
    pose: { head: "none", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
    gestures: [], light: false, media: { camera: false, microphone: false, speaker: false, volume: false },
  };
  let observedDrive;
  const asyncBackend = {
    id: "async-test",
    capabilities: coreCapabilities,
    inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }),
    async execute(command, context) {
      observedDrive = command;
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(context.isCurrent(), true, "the asynchronous backend completes within the command lease");
      return { status: "applied", limitations: [], applied: command };
    },
    async stop() {},
  };
  const core = createRobotCore(asyncBackend);
  const coreSession = core.openSession({ id: "microduck-async-test" });
  const coreAdapter = createMicroDuckAdapter(coreSession);
  const asyncResult = successResult(await coreAdapter.handleMessage(
    request("robot.move", { vx: 0.1, vy: 0, vyaw: 0 }, 41), { ttlMs: 140 },
  ));
  assert.equal(asyncResult.accepted, true);
  assert.equal(observedDrive.durationMs, 115);
  assert.ok(observedDrive.durationMs < 140, "drive duration is shorter than its core admission deadline");
  await core.dispose();

  const parseFailure = await adapter.handleMessage("{bad json");
  error(parseFailure, -32700);
  assert.equal(parseFailure.id, null);

  console.log("MicroDuck robot-bridge adapter checks passed");
}

await run();
