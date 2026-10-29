import { randomUUID } from "node:crypto";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-looi-compatibility": "virtual",
  "x-looi-hardware-motors": "unavailable",
});

const INTERPOLATIONS = new Set(["linear", "minjerk", "ease_in_out", "cartoon"]);
const MOVE_MAX_SECONDS = 60;
const REQUEST_TTL_MS = 1_200;

// State is scoped to the stable invoke callback the gateway creates for one
// app session. The gateway must reuse that callback until the app exits and
// bind it to the same ReachyAdapter/RobotSession as /ws/sdk.
const sessionState = new WeakMap();

function response(status, body, headers = {}) {
  return { status, body, headers: { ...JSON_HEADERS, ...headers } };
}

function badRequest(message, status = 422) {
  return response(status, { detail: message });
}

function asObject(value, label = "body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function matrixFromPose(value, label = "head_pose") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(value.m)) {
      if (value.m.length !== 16 || !value.m.every((n) => typeof n === "number" && Number.isFinite(n))) {
        throw new TypeError(`${label}.m must contain 16 finite numbers`);
      }
      return [...value.m];
    }
    const x = finite(value.x ?? 0, `${label}.x`);
    const y = finite(value.y ?? 0, `${label}.y`);
    const z = finite(value.z ?? 0, `${label}.z`);
    const roll = finite(value.roll ?? 0, `${label}.roll`);
    const pitch = finite(value.pitch ?? 0, `${label}.pitch`);
    const yaw = finite(value.yaw ?? 0, `${label}.yaw`);
    // Matches upstream XYZRPYPose: scipy Rotation.from_euler("xyz", ...).
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    return [
      cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
      sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
      -sp, cp * sr, cp * cr, z,
      0, 0, 0, 1,
    ];
  }
  throw new TypeError(`${label} must use the Reachy XYZRPY or matrix pose representation`);
}

function flattenMatrix(value, label = "head_pose") {
  if (Array.isArray(value) && value.length === 16 && value.every((n) => typeof n === "number" && Number.isFinite(n))) return [...value];
  if (Array.isArray(value) && value.length === 4 && value.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === "number" && Number.isFinite(n)))) return value.flat();
  if (value && typeof value === "object" && !Array.isArray(value)) return matrixFromPose(value, label);
  throw new TypeError(`${label} must be a 4x4 matrix or a Reachy pose object`);
}

function poseForRest(flat, useMatrix) {
  if (useMatrix) return { m: [...flat] };
  const pitch = Math.asin(Math.max(-1, Math.min(1, -flat[8])));
  return {
    x: flat[3], y: flat[7], z: flat[11],
    roll: Math.atan2(flat[9], flat[10]),
    pitch,
    yaw: Math.atan2(flat[4], flat[0]),
  };
}

function queryBool(params, name, fallback) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new TypeError(`query parameter ${name} must be a boolean`);
}

function readSessionState(invoke) {
  let current = sessionState.get(invoke);
  if (!current) {
    current = { sequence: 0, moves: new Map() };
    sessionState.set(invoke, current);
  }
  return current;
}

async function reachyMediaStatus(media) {
  if (typeof media?.mediaStatus === "function") return await media.mediaStatus();
  if (typeof media?.getReachyStatus === "function") return await media.getReachyStatus();
  return media?.reachyStatus ?? null;
}

function makeRequestMeta(session, method) {
  session.sequence += 1;
  return {
    protocol: "reachy",
    transport: "http",
    source: "reachy-http",
    method,
    sequence: session.sequence,
    ttlMs: REQUEST_TTL_MS,
  };
}

function getStateFromReply(reply) {
  if (!reply || typeof reply !== "object" || !reply.state || typeof reply.state !== "object") {
    if (reply?.error) throw Object.assign(new Error(String(reply.error)), { compatibilityStatus: reply.compatibility_status });
    throw new Error("The shared Reachy session did not return a state snapshot");
  }
  return reply.state;
}

async function invokeState(invoke, session) {
  const reply = await invoke({ type: "get_state" }, makeRequestMeta(session, "GET /api/state"));
  return getStateFromReply(reply);
}

async function invokeVersion(invoke, session) {
  return await invoke({ type: "get_version" }, makeRequestMeta(session, "GET /api/daemon/status"));
}

function resultFailure(result) {
  if (!result || typeof result !== "object" || typeof result.error !== "string") return null;
  return result;
}

function modeFromState(state) {
  return ["enabled", "disabled", "gravity_compensation"].includes(state?.motor_mode) ? state.motor_mode : null;
}

function validCameraResolution(value) {
  return value && typeof value === "object" && typeof value.name === "string"
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && Number.isInteger(value.fps) && value.fps > 0
    && typeof value.crop_factor === "number" && Number.isFinite(value.crop_factor);
}

function normalizeVolumeReply(value, device) {
  if (!value || typeof value !== "object"
    || !Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100
    || value.origin !== "webrtc-track-gain"
    || typeof value.pending !== "boolean") {
    throw Object.assign(new Error("The media worker returned an invalid software volume status"), { statusCode: 503 });
  }
  return {
    // These first three fields match the pinned Reachy VolumeResponse model.
    // The additional fields disclose that LOOI controls WebRTC track gain,
    // not the phone's operating-system or physical-device volume.
    volume: value.percent,
    platform: "LOOI WebRTC software gain",
    device,
    origin: value.origin,
    pending: value.pending,
  };
}

function volumeRoute(pathname) {
  const routes = new Map([
    ["/api/volume/current", { method: "GET", device: "speaker", action: "get" }],
    ["/api/volume/set", { method: "POST", device: "speaker", action: "set" }],
    ["/api/volume/microphone/current", { method: "GET", device: "microphone", action: "get" }],
    ["/api/volume/microphone/set", { method: "POST", device: "microphone", action: "set" }],
  ]);
  return routes.get(pathname) ?? null;
}

function statusFromSnapshot(snapshot, mediaStatus, versionInfo) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : {};
  const observed = value.observed ?? value.state?.observed ?? {};
  const capabilities = value.capabilities ?? value.state?.capabilities ?? {};
  const media = mediaStatus && typeof mediaStatus === "object" ? mediaStatus : {};
  const ready = value.active !== false && observed.connected === true;
  const noMedia = typeof media.no_media === "boolean"
    ? media.no_media
    : typeof media.noMedia === "boolean"
      ? media.noMedia
      : media.available !== true;
  const released = typeof media.released === "boolean" ? media.released : false;
  return {
    type: "daemon_status",
    robot_name: "LOOI",
    state: ready ? "running" : "stopped",
    wireless_version: false,
    desktop_app_daemon: false,
    simulation_enabled: null,
    mockup_sim_enabled: null,
    no_media: noMedia,
    media_released: released,
    camera_specs_name: "",
    backend_status: null,
    error: ready ? null : (observed.safetyReason ?? "LOOI phone session is not connected"),
    wlan_ip: null,
    version: typeof versionInfo?.version === "string" ? versionInfo.version : null,
    adapter_version: typeof versionInfo?.adapter_version === "string" ? versionInfo.adapter_version : null,
    version_origin: typeof versionInfo?.version_origin === "string" ? versionInfo.version_origin : null,
    hardware_id: null,
    face_target: { detected: false },
    compatibility_origin: "virtual",
    robot_family: typeof versionInfo?.robot_family === "string" ? versionInfo.robot_family : "looi",
    compatibility: {
      backend: value.backend ?? null,
      capabilities,
      measurements: observed,
      media: {
        available: media.available === true && media.signalingReady === true,
        signaling_ready: media.signalingReady === true,
      },
    },
  };
}

function makeGotoTask(body) {
  asObject(body);
  if (body.head_pose === undefined && body.antennas === undefined && body.body_yaw === undefined) {
    throw new TypeError("at least one of head_pose, antennas, or body_yaw is required");
  }
  const duration = finite(body.duration, "duration");
  if (duration <= 0 || duration > MOVE_MAX_SECONDS) throw new TypeError(`duration must be greater than 0 and no more than ${MOVE_MAX_SECONDS} seconds`);
  const method = body.interpolation ?? "minjerk";
  if (typeof method !== "string" || !INTERPOLATIONS.has(method)) throw new TypeError(`interpolation must be one of ${[...INTERPOLATIONS].join(", ")}`);
  let antennas;
  if (body.antennas !== undefined && body.antennas !== null) {
    if (!Array.isArray(body.antennas) || body.antennas.length !== 2) throw new TypeError("antennas must contain exactly two finite numbers");
    antennas = body.antennas.map((n, i) => finite(n, `antennas[${i}]`));
  }
  const request = {
    head: body.head_pose === undefined || body.head_pose === null ? null : matrixFromPose(body.head_pose),
    antennas: antennas ?? null,
    body_yaw: body.body_yaw === undefined || body.body_yaw === null ? null : finite(body.body_yaw, "body_yaw"),
    duration,
    method,
  };
  const uuid = randomUUID();
  const timestamp = new Date().toISOString();
  return { uuid, timestamp, req: request };
}

function normalizePath(input) {
  try {
    const url = new URL(input, "http://127.0.0.1");
    return { pathname: url.pathname.replace(/\/$/, "") || "/", params: url.searchParams };
  } catch {
    return { pathname: typeof input === "string" ? input.split("?")[0] : "", params: new URLSearchParams() };
  }
}

/**
 * Implement the HTTP subset the pinned Reachy Mini daemon actually exposes.
 * `invoke` is a stable, app-lifetime callback into the same adapter/session as
 * `/ws/sdk`; this helper never creates or closes a phone session itself.
 */
export async function handleReachyHttp(request, { invoke, inspect, apps, media } = {}) {
  if (!request || typeof request !== "object") return null;
  const { pathname, params } = normalizePath(request.path ?? request.url ?? "");
  const method = String(request.method ?? "GET").toUpperCase();
  const session = typeof invoke === "function" ? readSessionState(invoke) : null;

  const methods = new Map([
    ["/api/daemon/status", ["GET"]],
    ["/api/motors/status", ["GET"]],
    ["/api/motors/set_mode/enabled", ["POST"]],
    ["/api/motors/set_mode/disabled", ["POST"]],
    ["/api/motors/set_mode/gravity_compensation", ["POST"]],
    ["/api/state/present_head_pose", ["GET"]],
    ["/api/state/present_body_yaw", ["GET"]],
    ["/api/state/present_antenna_joint_positions", ["GET"]],
    ["/api/state/doa", ["GET"]],
    ["/api/state/imu", ["GET"]],
    ["/api/state/full", ["GET"]],
    ["/api/move/running", ["GET"]],
    ["/api/move/set_target", ["POST"]],
    ["/api/move/goto", ["POST"]],
    ["/api/move/play/wake_up", ["POST"]],
    ["/api/move/play/goto_sleep", ["POST"]],
    ["/api/move/stop", ["POST"]],
    ["/api/media/status", ["GET"]],
    ["/api/camera/specs", ["GET"]],
    ["/api/media/release", ["POST"]],
    ["/api/media/acquire", ["POST"]],
  ]);
  const volume = volumeRoute(pathname);
  if (volume) methods.set(pathname, [volume.method]);
  const dynamicMotorMode = /^\/api\/motors\/set_mode\/[^/]+$/.test(pathname);
  const allowed = methods.get(pathname) ?? (dynamicMotorMode ? ["POST"] : undefined);
  if (!allowed) return null;
  if (!allowed.includes(method)) return response(405, { detail: "Method Not Allowed" }, { allow: allowed.join(", ") });
  if (typeof invoke !== "function" && !volume && !["/api/daemon/status", "/api/media/status"].includes(pathname)) {
    return badRequest("Reachy app session is unavailable", 503);
  }

  try {
    if (pathname === "/api/daemon/status") {
      const snapshot = typeof inspect === "function" ? await inspect() : inspect;
      if (!snapshot) return badRequest("LOOI phone session is not connected", 503);
      // Ask the active protocol adapter for its version identity so the REST
      // status and WebSocket `get_version` response cannot drift apart.
      const versionInfo = typeof invoke === "function" ? await invokeVersion(invoke, session) : null;
      const mediaStatus = await reachyMediaStatus(media);
      return response(200, statusFromSnapshot(snapshot, mediaStatus, versionInfo));
    }

    if (pathname === "/api/media/status") {
      const mediaStatus = await reachyMediaStatus(media);
      if (!mediaStatus || typeof mediaStatus !== "object") return response(200, { available: false, released: false, no_media: true });
      const released = mediaStatus.released === true;
      const noMedia = typeof mediaStatus.no_media === "boolean"
        ? mediaStatus.no_media
        : typeof mediaStatus.noMedia === "boolean"
          ? mediaStatus.noMedia
          : false;
      return response(200, {
        // The stock daemon defines `available` as camera/audio ownership;
        // signaling readiness is separate and only gates SDK app startup.
        available: mediaStatus.available === true && !released && !noMedia,
        released,
        no_media: noMedia,
      });
    }

    if (pathname === "/api/camera/specs") {
      if (typeof media?.getCameraSpecs !== "function") {
        return badRequest("LOOI has no Reachy camera calibration or resolution profile", 501);
      }
      const specs = await media.getCameraSpecs();
      if (!specs || typeof specs !== "object" || typeof specs.name !== "string"
        || !Array.isArray(specs.available_resolutions) || !specs.available_resolutions.every(validCameraResolution)
        || !validCameraResolution(specs.default_resolution)
        || !Array.isArray(specs.K) || specs.K.length !== 3
        || !specs.K.every((row) => Array.isArray(row) && row.length === 3 && row.every((n) => typeof n === "number" && Number.isFinite(n)))
        || !Array.isArray(specs.D) || !specs.D.every((n) => typeof n === "number" && Number.isFinite(n))) {
        return badRequest("The media worker did not provide Reachy-compatible camera specifications", 501);
      }
      return response(200, specs, { "x-looi-compatibility": "media-profile" });
    }

    if (pathname === "/api/media/release" || pathname === "/api/media/acquire") {
      const operation = pathname.endsWith("/release") ? media?.releaseReachy : media?.acquireReachy;
      if (typeof operation !== "function") return badRequest("The companion has no Reachy media ownership bridge", 501);
      await operation.call(media);
      return response(200, { status: "ok" });
    }

    if (volume) {
      const operation = volume.action === "get" ? media?.getVolume : media?.setVolume;
      if (typeof operation !== "function") return badRequest("LOOI WebRTC software volume control is unavailable", 501);
      let value;
      if (volume.action === "get") {
        value = await operation.call(media, volume.device);
      } else {
        const body = asObject(request.body);
        if (!Number.isInteger(body.volume) || body.volume < 0 || body.volume > 100) {
          throw new TypeError("volume must be an integer between 0 and 100");
        }
        value = await operation.call(media, volume.device, body.volume);
      }
      return response(200, normalizeVolumeReply(value, volume.device), {
        "x-looi-volume-origin": "webrtc-track-gain",
      });
    }

    const state = await invokeState(invoke, session);

    if (pathname === "/api/motors/status") {
      const mode = modeFromState(state);
      if (!mode) return badRequest("The Reachy-compatible motor mode is unavailable", 503);
      return response(200, { mode });
    }

    if (pathname.startsWith("/api/motors/set_mode/")) {
      const mode = pathname.slice("/api/motors/set_mode/".length);
      if (!["enabled", "disabled", "gravity_compensation"].includes(mode)) {
        return badRequest("mode must be enabled, disabled, or gravity_compensation");
      }
      const result = await invoke({ type: "set_motor_mode", mode }, makeRequestMeta(session, method + " " + pathname));
      const failure = resultFailure(result);
      if (failure) return badRequest(failure.error, 409);
      return response(200, { status: `motors changed to ${mode} mode`, compatibility_origin: "virtual", hardware_motors_available: false });
    }

    if (pathname === "/api/state/present_head_pose") {
      const useMatrix = queryBool(params, "use_pose_matrix", false);
      const pose = flattenMatrix(state.head_pose, "state.head_pose");
      return response(200, poseForRest(pose, useMatrix));
    }
    if (pathname === "/api/state/present_body_yaw") return response(200, finite(state.body_yaw ?? 0, "state.body_yaw"));
    if (pathname === "/api/state/present_antenna_joint_positions") {
      const antennas = state.antennas ?? [0, 0];
      if (!Array.isArray(antennas) || antennas.length !== 2 || !antennas.every((n) => typeof n === "number" && Number.isFinite(n))) {
        return badRequest("Reachy-compatible antenna state is unavailable", 503);
      }
      return response(200, [...antennas]);
    }
    if (pathname === "/api/state/doa") return response(200, state.doa ?? null);
    if (pathname === "/api/state/imu") return response(200, state.imu ?? null);
    if (pathname === "/api/state/full") {
      const useMatrix = queryBool(params, "use_pose_matrix", false);
      const result = { timestamp: new Date().toISOString(), compatibility_origin: "virtual", hardware_motors_available: false };
      if (queryBool(params, "with_control_mode", true)) result.control_mode = modeFromState(state);
      const pose = flattenMatrix(state.head_pose, "state.head_pose");
      if (queryBool(params, "with_head_pose", true)) result.head_pose = poseForRest(pose, useMatrix);
      if (queryBool(params, "with_target_head_pose", false)) result.target_head_pose = poseForRest(pose, useMatrix);
      if (queryBool(params, "with_head_joints", false)) result.head_joints = Array.isArray(state.head_joint_positions) ? [...state.head_joint_positions] : null;
      if (queryBool(params, "with_target_head_joints", false)) result.target_head_joints = null;
      if (queryBool(params, "with_body_yaw", true)) result.body_yaw = finite(state.body_yaw ?? 0, "state.body_yaw");
      if (queryBool(params, "with_target_body_yaw", false)) result.target_body_yaw = finite(state.body_yaw ?? 0, "state.body_yaw");
      const antennas = state.antennas ?? [0, 0];
      if (queryBool(params, "with_antenna_positions", true)) result.antennas_position = Array.isArray(antennas) ? [...antennas] : null;
      if (queryBool(params, "with_target_antenna_positions", false)) result.target_antennas_position = Array.isArray(antennas) ? [...antennas] : null;
      if (queryBool(params, "with_passive_joints", false)) result.passive_joints = null;
      if (queryBool(params, "with_doa", false)) result.doa = null;
      if (queryBool(params, "with_imu", false)) result.imu = null;
      return response(200, result);
    }

    if (pathname === "/api/move/running") {
      const tracked = [...session.moves.values()].filter((move) => !move.completed);
      if (!state.is_move_running) {
        for (const move of session.moves.values()) move.completed = true;
        return response(200, []);
      }
      return response(200, tracked.map(({ uuid }) => ({ uuid })));
    }

    if (pathname === "/api/move/set_target") {
      if (state.is_move_running === true) return response(200, { status: "ignored", reason: "move_running" });
      const body = asObject(request.body);
      const target = {};
      if (body.target_head_pose !== undefined && body.target_head_pose !== null) target.head = matrixFromPose(body.target_head_pose, "target_head_pose");
      if (body.target_antennas !== undefined && body.target_antennas !== null) {
        if (!Array.isArray(body.target_antennas) || body.target_antennas.length !== 2) throw new TypeError("target_antennas must contain exactly two finite numbers");
        target.antennas = body.target_antennas.map((n, i) => finite(n, `target_antennas[${i}]`));
      }
      if (body.target_body_yaw !== undefined && body.target_body_yaw !== null) target.body_yaw = finite(body.target_body_yaw, "target_body_yaw");
      if (!Object.keys(target).length) throw new TypeError("at least one target field is required");
      const result = await invoke({ type: "set_full_target", ...target }, makeRequestMeta(session, method + " " + pathname));
      const failure = resultFailure(result);
      if (failure) return badRequest(failure.error, failure.compatibility_status === "unsupported" ? 501 : 409);
      return response(200, { status: "ok", compatibility_origin: "virtual", hardware_motors_available: false });
    }

    if (pathname === "/api/move/goto") {
      const task = makeGotoTask(request.body);
      const result = await invoke({ type: "task", ...task }, makeRequestMeta(session, method + " " + pathname));
      const failure = resultFailure(result);
      if (failure) return badRequest(failure.error, failure.compatibility_status === "unsupported" ? 501 : 409);
      if (result?.finished === true) return badRequest(result.error ?? "Move request did not start", 409);
      session.moves.set(task.uuid, { uuid: task.uuid, completed: false, createdAt: Date.now() });
      return response(200, { uuid: task.uuid });
    }

    if (pathname === "/api/move/play/wake_up" || pathname === "/api/move/play/goto_sleep") {
      const uuid = randomUUID();
      const command = pathname.endsWith("wake_up") ? "wake_up" : "goto_sleep";
      const move = { uuid, completed: false, createdAt: Date.now() };
      session.moves.set(uuid, move);
      void invoke({ type: command }, makeRequestMeta(session, method + " " + pathname))
        .catch(() => undefined)
        .finally(() => { move.completed = true; });
      return response(200, { uuid });
    }

    if (pathname === "/api/move/stop") {
      const body = asObject(request.body);
      if (typeof body.uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.uuid)) {
        throw new TypeError("uuid must be a UUID string");
      }
      const move = session.moves.get(body.uuid.toLowerCase());
      if (!move || move.completed) return badRequest(`Running move with UUID ${body.uuid} not found`, 404);
      const result = await invoke({ type: "stop_move" }, makeRequestMeta(session, method + " " + pathname));
      const failure = resultFailure(result);
      if (failure) return badRequest(failure.error, 409);
      move.completed = true;
      return response(200, { message: `Stopped move with UUID: ${body.uuid}` });
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return badRequest(message, error?.statusCode ?? 422);
  }
}
