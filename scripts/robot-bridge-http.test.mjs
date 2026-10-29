import assert from "node:assert/strict";
import { handleReachyHttp } from "../services/robot-bridge/reachy-http.mjs";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function makeSession() {
  const calls = [];
  const state = {
    head_pose: [
      [1, 0, 0, 0.1],
      [0, 1, 0, 0.2],
      [0, 0, 1, 0.3],
      [0, 0, 0, 1],
    ],
    antennas: [0.25, -0.5],
    head_joint_positions: [0, 0, 0, 0, 0, 0, 0],
    body_yaw: 0.4,
    motor_mode: "enabled",
    is_recording: false,
    is_move_running: false,
    face_target: { detected: false },
    doa: null,
    imu: null,
    pose_origin: "virtual",
    hardware_motors_available: false,
  };
  const invoke = async (message, meta) => {
    calls.push({ message: structuredClone(message), meta: { ...meta } });
    if (message.type === "get_version") return {
      version: "1.13.0+looi",
      adapter_version: "0.1.0",
      version_origin: "reachy_wire_compatibility",
      robot_family: "looi",
    };
    if (message.type === "get_state") return { state: structuredClone(state) };
    if (message.type === "set_motor_mode") {
      if (message.mode === "gravity_compensation") return { error: "LOOI has no gravity compensation", compatibility_status: "unsupported" };
      state.motor_mode = message.mode;
      return { status: "ok", motor_mode: message.mode, motor_mode_origin: "virtual" };
    }
    if (message.type === "set_full_target") {
      if (message.head) state.head_pose = [message.head.slice(0, 4), message.head.slice(4, 8), message.head.slice(8, 12), message.head.slice(12, 16)];
      if (message.antennas) state.antennas = message.antennas;
      if (message.body_yaw !== undefined) state.body_yaw = message.body_yaw;
      return { status: "ok", compatibility_status: "adapted" };
    }
    if (message.type === "task") {
      state.is_move_running = true;
      return { type: "task_progress", uuid: message.uuid, finished: false, error: null };
    }
    if (message.type === "stop_move") {
      state.is_move_running = false;
      return { status: "ok", stopped: true };
    }
    if (message.type === "wake_up" || message.type === "goto_sleep") {
      await new Promise(resolve => setTimeout(resolve, 15));
      state.is_move_running = false;
      return { status: "ok", completed: true };
    }
    return { status: "ok" };
  };
  const inspect = () => ({
    backend: "looi",
    active: true,
    capabilities: { media: { camera: false, microphone: false, speaker: false } },
    observed: { connected: true, moving: false, measuredPose: null, safetyReason: null },
  });
  return { calls, state, invoke, inspect };
}

function request(method, path, body) { return { method, path, ...(body === undefined ? {} : { body }) }; }

{
  const session = makeSession();
  const deps = { invoke: session.invoke, inspect: session.inspect };
  const status = await handleReachyHttp(request("GET", "/api/daemon/status"), deps);
  assert.equal(status.status, 200);
  assert.equal(status.body.robot_name, "LOOI");
  assert.equal(status.body.version, "1.13.0+looi");
  assert.equal(status.body.adapter_version, "0.1.0");
  assert.equal(status.body.version_origin, "reachy_wire_compatibility");
  assert.equal(status.body.robot_family, "looi");
  assert.equal(status.body.compatibility_origin, "virtual");
  assert.equal(status.body.no_media, true);
  assert.equal(status.body.compatibility.measurements.measuredPose, null);

  const xyz = await handleReachyHttp(request("GET", "/api/state/present_head_pose"), deps);
  assert.deepEqual(xyz.body, { x: 0.1, y: 0.2, z: 0.3, roll: 0, pitch: -0, yaw: 0 });
  const matrix = await handleReachyHttp(request("GET", "/api/state/present_head_pose?use_pose_matrix=true"), deps);
  assert.deepEqual(matrix.body.m, IDENTITY.map((value, i) => i % 4 === 3 && i < 12 ? [0.1, 0.2, 0.3][Math.floor(i / 4)] : value));
  assert.deepEqual((await handleReachyHttp(request("GET", "/api/state/present_body_yaw"), deps)).body, 0.4);
  assert.deepEqual((await handleReachyHttp(request("GET", "/api/state/present_antenna_joint_positions"), deps)).body, [0.25, -0.5]);
  assert.equal((await handleReachyHttp(request("GET", "/api/state/doa"), deps)).body, null);
  assert.equal((await handleReachyHttp(request("GET", "/api/state/imu"), deps)).body, null);

  const full = await handleReachyHttp(request("GET", "/api/state/full?with_head_joints=true&with_imu=true&with_antenna_positions=false"), deps);
  assert.equal(full.status, 200);
  assert.equal(full.body.control_mode, "enabled");
  assert.equal(full.body.head_joints.length, 7);
  assert.equal(full.body.imu, null);
  assert.equal("antennas_position" in full.body, false);
  assert.equal(full.headers["cache-control"], "no-store");

  const motor = await handleReachyHttp(request("GET", "/api/motors/status"), deps);
  assert.deepEqual(motor.body, { mode: "enabled" });
  assert.equal((await handleReachyHttp(request("POST", "/api/motors/set_mode/disabled"), deps)).status, 200);
  assert.equal(session.calls.at(-1).message.type, "set_motor_mode");
  assert.equal(session.calls.at(-1).meta.ttlMs, 1200);
  assert.equal(session.calls.at(-1).meta.sequence, session.calls.at(-2).meta.sequence + 1);
  assert.equal((await handleReachyHttp(request("POST", "/api/motors/set_mode/gravity_compensation"), deps)).status, 409);
  assert.equal((await handleReachyHttp(request("GET", "/api/camera/specs"), deps)).status, 501, "the LOOI camera has no Reachy calibration profile by default");

  const target = await handleReachyHttp(request("POST", "/api/move/set_target", {
    target_head_pose: { x: 0.5, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
    target_antennas: [0.1, -0.1], target_body_yaw: 0.2,
  }), deps);
  assert.equal(target.status, 200);
  assert.equal(session.calls.at(-1).message.type, "set_full_target");
  assert.equal(session.calls.at(-1).message.head[3], 0.5);
  assert.deepEqual(session.calls.at(-1).message.antennas, [0.1, -0.1]);
  assert.equal(session.calls.at(-1).message.body_yaw, 0.2);

  const goto = await handleReachyHttp(request("POST", "/api/move/goto", {
    head_pose: { m: IDENTITY }, antennas: [0, 0], duration: 0.2, interpolation: "cartoon", body_yaw: 0,
  }), deps);
  assert.equal(goto.status, 200);
  assert.match(goto.body.uuid, /^[0-9a-f-]{36}$/i);
  const task = session.calls.at(-1).message;
  assert.equal(task.type, "task");
  assert.equal(task.uuid, goto.body.uuid);
  assert.equal(task.req.method, "cartoon");
  assert.deepEqual(task.req.head, IDENTITY);
  assert.equal((await handleReachyHttp(request("GET", "/api/move/running"), deps)).body[0].uuid, goto.body.uuid);
  const stopped = await handleReachyHttp(request("POST", "/api/move/stop", { uuid: goto.body.uuid }), deps);
  assert.equal(stopped.status, 200);
  assert.equal(session.calls.at(-1).message.type, "stop_move");
  assert.deepEqual((await handleReachyHttp(request("GET", "/api/move/running"), deps)).body, []);

  const invalid = await handleReachyHttp(request("POST", "/api/move/goto", { duration: 0 }), deps);
  assert.equal(invalid.status, 422);
  assert.equal((await handleReachyHttp(request("PUT", "/api/move/goto", {}), deps)).status, 405);
  assert.equal(await handleReachyHttp(request("POST", "/api/move/recording/start"), deps), null, "recording is a websocket command, not a pinned REST route");
}

{
  const session = makeSession();
  let release = 0, acquire = 0;
  const media = {
    mediaStatus: () => ({ available: true, signalingReady: true, released: false, no_media: false }),
    releaseReachy: () => { release += 1; },
    acquireReachy: () => { acquire += 1; },
  };
  const deps = { invoke: session.invoke, inspect: session.inspect, media };
  const status = await handleReachyHttp(request("GET", "/api/media/status"), deps);
  assert.deepEqual(status.body, { available: true, released: false, no_media: false });
  assert.equal((await handleReachyHttp(request("POST", "/api/media/release"), deps)).status, 200);
  assert.equal((await handleReachyHttp(request("POST", "/api/media/acquire"), deps)).status, 200);
  assert.equal(release, 1);
  assert.equal(acquire, 1);
  assert.equal((await handleReachyHttp(request("GET", "/api/daemon/status"), deps)).body.no_media, false);
}

{
  const session = makeSession();
  const media = {
    // Reachy's REST `available` reports media ownership; signaling readiness
    // is a separate prerequisite for constructing a WebRTC SDK client.
    mediaStatus: () => ({ available: true, signalingReady: false, released: false, no_media: false }),
  };
  const deps = { invoke: session.invoke, inspect: session.inspect, media };
  const daemon = await handleReachyHttp(request("GET", "/api/daemon/status"), deps);
  assert.equal(daemon.body.no_media, false, "a signaling startup delay must not make the SDK disable its media backend");
  assert.equal(daemon.body.compatibility.media.available, false, "the LOOI stream is not marked usable until signaling is ready");
  assert.deepEqual((await handleReachyHttp(request("GET", "/api/media/status"), deps)).body, {
    available: true,
    released: false,
    no_media: false,
  }, "the stock REST status separates media ownership from signaling readiness");
}

{
  const calls = [];
  const media = {
    getVolume: async (device) => {
      calls.push({ action: "get", device });
      return { percent: device === "speaker" ? 63 : 41, origin: "webrtc-track-gain", pending: device === "speaker" };
    },
    setVolume: async (device, value) => {
      calls.push({ action: "set", device, value });
      return { percent: value, origin: "webrtc-track-gain", pending: false };
    },
  };
  const getSpeaker = await handleReachyHttp(request("GET", "/api/volume/current"), { media });
  assert.equal(getSpeaker.status, 200);
  assert.deepEqual(getSpeaker.body, {
    volume: 63,
    platform: "LOOI WebRTC software gain",
    device: "speaker",
    origin: "webrtc-track-gain",
    pending: true,
  }, "response keeps the pinned VolumeResponse fields and discloses software gain metadata");
  assert.equal(getSpeaker.headers["x-looi-volume-origin"], "webrtc-track-gain");

  const getMic = await handleReachyHttp(request("GET", "/api/volume/microphone/current"), { media });
  assert.equal(getMic.body.volume, 41);
  assert.equal(getMic.body.device, "microphone");
  const setSpeaker = await handleReachyHttp(request("POST", "/api/volume/set", { volume: 77 }), { media });
  const setMic = await handleReachyHttp(request("POST", "/api/volume/microphone/set", { volume: 22 }), { media });
  assert.equal(setSpeaker.body.volume, 77);
  assert.equal(setMic.body.volume, 22);
  assert.deepEqual(calls, [
    { action: "get", device: "speaker" },
    { action: "get", device: "microphone" },
    { action: "set", device: "speaker", value: 77 },
    { action: "set", device: "microphone", value: 22 },
  ]);

  for (const badVolume of [-1, 101, 12.5, "25", null]) {
    assert.equal((await handleReachyHttp(request("POST", "/api/volume/set", { volume: badVolume }), { media })).status, 422);
  }
  assert.equal((await handleReachyHttp(request("GET", "/api/volume/set"), { media })).status, 405);
  assert.equal((await handleReachyHttp(request("GET", "/api/volume/current"), {})).status, 501);

  const unavailable = await handleReachyHttp(request("GET", "/api/volume/current"), {
    media: { getVolume: async () => { throw Object.assign(new Error("paired phone is not connected"), { statusCode: 503 }); } },
  });
  assert.equal(unavailable.status, 503);
  const wrongOrigin = await handleReachyHttp(request("GET", "/api/volume/current"), {
    media: { getVolume: async () => ({ percent: 50, origin: "os-volume", pending: false }) },
  });
  assert.equal(wrongOrigin.status, 503, "the facade never reports OS volume as if it were the software track gain");
}

{
  const first = makeSession(), second = makeSession();
  await handleReachyHttp(request("GET", "/api/motors/status"), { invoke: first.invoke });
  await handleReachyHttp(request("GET", "/api/motors/status"), { invoke: second.invoke });
  assert.equal(first.calls[0].meta.sequence, 1);
  assert.equal(second.calls[0].meta.sequence, 1, "sequence and move state are scoped per stable app callback");
  assert.equal(await handleReachyHttp(request("GET", "/not-a-reachy-route"), { invoke: first.invoke }), null);
}

console.log("Reachy Mini daemon HTTP facade: pinned REST shapes, shared-session routing and unsupported media behavior passed");
