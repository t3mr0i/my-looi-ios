import type {
  RobotCommandOptions,
  RobotExecution,
  RobotPose,
  RobotCapabilities,
  RobotSession,
} from "./types";
import type { AppSoundService, MicroDuckSoundTag } from "./app-sounds";
export type { MicroDuckSoundTag } from "./app-sounds";

/** Pinned MicroDuck IPC contract used by this compatibility adapter. */
export const MICRODUCK_API_VERSION = 44;
export const MICRODUCK_PROTOCOL_COMMIT = "942e58e3aa6dbb28e7037203fff11866122c7567";
export const MICRODUCK_ADAPTER_VERSION = "0.1.0";

/** The command lease is capped at MicroDuck's documented 500 ms default. */
export const DEFAULT_MOVE_VALIDITY_MS = 500;
export const MAX_MOVE_VALIDITY_MS = 500;
/** Leave time for the backend to stop and report before the core lease expires. */
export const DRIVE_COMPLETION_MARGIN_MS = 25;

const JSONRPC_VERSION = "2.0";
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;
const JSONRPC_UNSUPPORTED = -32001;

type RequestId = string | number;
type JsonRpcError = { code: number; message: string; data?: unknown };
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: RequestId | null; result: unknown }
  | { jsonrpc: "2.0"; id: RequestId | null; error: JsonRpcError };
export type JsonRpcNotification = { jsonrpc: "2.0"; method: "robot.state"; params: Record<string, unknown> };

export type MicroDuckAdapter = {
  /** Accepts a parsed JSON value or an NDJSON line; returns null for every notification. */
  handleMessage(raw: unknown, options?: RobotCommandOptions): Promise<JsonRpcResponse | null>;
  /** Stop adapter-owned audio before the app connection closes. */
  close(): Promise<void>;
  /** Current MicroDuck-shaped state notification. Measurements remain explicitly unavailable. */
  getStateEvent(): JsonRpcNotification;
  /** One current state event when the session's requested rate permits it. */
  stateMessages(): JsonRpcNotification[];
  /** Subscribe to core snapshots and translate them to MicroDuck robot.state notifications. */
  subscribeState(listener: (event: JsonRpcNotification) => void): () => void;
};

export type MicroDuckSystemInfo = {
  name: string;
  serial: string | null;
  /** Device uptime, when supplied by the native device source. */
  uptimeSeconds?: number;
};

export type MicroDuckVideoInfo = {
  available: boolean;
  width: number | null;
  height: number | null;
  rotate: 0 | 90 | 180 | 270;
  source: "measured" | "configured";
};

export type MicroDuckAdapterDependencies = {
  now?: () => number;
  systemInfo?: () => MicroDuckSystemInfo;
  /** Resolution and mount rotation for the camera selected by the live media session. */
  videoInfo?: () => MicroDuckVideoInfo | null;
  /** App-owned audio player used by MicroDuck Console sound RPCs. */
  sound?: AppSoundService;
};

type Envelope = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  jsonrpc?: unknown;
};

type RpcFailure = {
  code: number;
  message: string;
  data?: unknown;
};

type Movement = { vx: number; vy: number; vyaw: number };
type HeadJoints = { neck_pitch: number; head_pitch: number; head_yaw: number; head_roll: number };

class ProtocolFailure extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProtocolFailure";
    this.code = code;
    this.data = data;
  }
}

/**
 * Translate the pinned MicroDuck JSON-RPC robot API into the shared robot session.
 * This module deliberately has no transport, BLE, motor, or filesystem dependency.
 */
export function createMicroDuckAdapter(session: RobotSession, dependencies: MicroDuckAdapterDependencies = {}): MicroDuckAdapter {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let controlEnabled = true;
  let stateHzRequested: number | undefined;
  let lastStateSentAt: number | undefined;
  let lastRequestedMove: Movement = { vx: 0, vy: 0, vyaw: 0 };
  let lastAppliedMove: Movement | null = { vx: 0, vy: 0, vyaw: 0 };
  let lastMoveLimitations: string[] = [];
  let lastRequestedHead: HeadJoints = { neck_pitch: 0, head_pitch: 0, head_yaw: 0, head_roll: 0 };
  let lastAppliedHead: HeadJoints | null = { ...lastRequestedHead };
  let lastHeadLimitations: string[] = [];
  let activeHeldSound: { tag: MicroDuckSoundTag; controller: AbortController } | null = null;
  const activeSoundControllers = new Set<AbortController>();
  let adapterClosed = false;

  function getStateEvent(snapshot = session.inspect()): JsonRpcNotification {
    const observed = snapshot.observed;
    const observedAppliedHead = poseToHeadJoints(snapshot.lastResult?.applied?.kind === "target"
      ? snapshot.lastResult.applied.pose
      : undefined);
    const headTarget = observedAppliedHead ?? lastAppliedHead ?? lastRequestedHead;
    const moveAppliedKnown = lastAppliedMove !== null;

    return {
      jsonrpc: JSONRPC_VERSION,
      method: "robot.state",
      params: {
        t: Math.max(0, (now() - startedAt) / 1000),
        move: {
          requested: [lastRequestedMove.vx, lastRequestedMove.vy, lastRequestedMove.vyaw],
          // MicroDuck requires a three-number array here. LOOI has no calibrated SI-velocity
          // output, so use the schema's neutral virtual value when the adapter cannot know it.
          applied: lastAppliedMove ? [lastAppliedMove.vx, lastAppliedMove.vy, lastAppliedMove.vyaw] : [0, 0, 0],
          ...(lastMoveLimitations.length > 0 ? { limited_by: [...lastMoveLimitations] } : {}),
        },
        // RobotState requires four joint values. This is a virtual target, never a measurement.
        head: [headTarget.neck_pitch, headTarget.head_pitch, headTarget.head_yaw, headTarget.head_roll],
        // LOOI does not run a MicroDuck ONNX policy. Do not label it "walk" or "stand".
        policy: "looi-adapter",
        // MicroDuck's fixed 15-joint, safety, loop, and odometry readings do not exist here.
        // Empty joint vectors and null blocks mark these fields unavailable instead of fabricating data.
        safety: { fallen: false, limp: false, gravity: [0, 0, 0], gain: null, picked_up: false },
        loop: { hz: 0, missed: 0 },
        joints: [],
        targets: [],
        velocities: [],
        currents_ma: [],
        odom: { position: [0, 0, 0], yaw: 0 },
        compatibility: {
          origin: "looi",
          model: "looi",
          adapter: "microduck",
          protocolApiVersion: MICRODUCK_API_VERSION,
          protocolCommit: MICRODUCK_PROTOCOL_COMMIT,
          measured: {
            pose: observed.measuredPose,
            velocity: observed.measuredVelocity,
            safety: observed.safetyReason,
          },
          virtualFields: ["move.applied", "head", "policy", "safety", "loop", "odom"],
          moveAppliedKnown,
          headSource: observedAppliedHead ? "backend-applied" : (lastAppliedHead ? "requested-or-adapted" : "requested"),
          requestedHead: { ...lastRequestedHead },
          headLimitations: [...lastHeadLimitations],
          generation: snapshot.generation,
          connected: observed.connected,
          moving: observed.moving,
          enabled: controlEnabled,
          controlScope: "session-intent-gate",
          hardwareTorqueControl: false,
        },
      },
    };
  }

  async function handleMessage(raw: unknown, options?: RobotCommandOptions): Promise<JsonRpcResponse | null> {
    let input: unknown = raw;
    if (typeof raw === "string") {
      try {
        input = JSON.parse(raw) as unknown;
      } catch {
        return errorResponse(null, JSONRPC_PARSE_ERROR, "Parse error");
      }
    }

    if (!isRecord(input)) {
      return errorResponse(null, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }

    const envelope = input as Envelope;
    const hasId = Object.prototype.hasOwnProperty.call(input, "id");
    const notification = !hasId;
    const id = isRequestId(envelope.id) ? envelope.id : null;

    // A well-formed notification is never answered, including invalid-method and bad-params cases.
    if (hasId && !isRequestId(envelope.id)) {
      return errorResponse(null, JSONRPC_INVALID_REQUEST, "Invalid Request: id must be a string or finite number");
    }
    if (Object.keys(input).some((key) => !["jsonrpc", "id", "method", "params"].includes(key))) {
      return notification ? null : errorResponse(id, JSONRPC_INVALID_REQUEST, "Invalid Request: unexpected envelope member");
    }
    if (envelope.jsonrpc !== JSONRPC_VERSION || typeof envelope.method !== "string" || envelope.method.length === 0) {
      return notification ? null : errorResponse(id, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }

    try {
      const method = envelope.method;
      const params = envelope.params;

      switch (method) {
        case "hello":
          return resultOrNull(id, notification, helloResult(requireParams(params, method)));

        case "robot.move": {
          const move = parseMove(requireParams(params, method));
          const commandOptions = normalizeCommandOptions(options, true);

          if (!controlEnabled) {
            lastRequestedMove = move;
            lastAppliedMove = null;
            lastMoveLimitations = ["LOOI logical control gate is disabled"];
            return resultOrNull(id, notification, intentResult(false, lastMoveLimitations[0], {
              requested: [move.vx, move.vy, move.vyaw],
              limited_by: [...lastMoveLimitations],
            }));
          }

          if (move.vy !== 0 && !session.inspect().capabilities.locomotion.lateral) {
            // A refused drive intent still supersedes an older move. Bypassing the core must
            // never leave an earlier locomotion lease running behind this response.
            await session.stop("microduck lateral move unsupported");
            lastRequestedMove = move;
            lastAppliedMove = null;
            lastMoveLimitations = ["lateral locomotion is unsupported by the LOOI backend"];
            return resultOrNull(id, notification, intentResult(false, lastMoveLimitations[0], {
              requested: [move.vx, move.vy, move.vyaw],
              limited_by: [...lastMoveLimitations],
            }));
          }

          lastRequestedMove = move;
          lastMoveLimitations = [];
          const ttlMs = commandOptions.ttlMs ?? DEFAULT_MOVE_VALIDITY_MS;
          const durationMs = Math.max(0, ttlMs - DRIVE_COMPLETION_MARGIN_MS);
          const result = await session.execute({
            kind: "drive",
            forward: move.vx,
            lateral: move.vy,
            yawRate: move.vyaw,
            durationMs: Math.min(durationMs, MAX_MOVE_VALIDITY_MS),
          }, commandOptions);
          lastAppliedMove = executionToMove(result, move);
          lastMoveLimitations = [...result.limitations];
          return resultOrNull(id, notification, executionIntentResult(result));
        }

        case "robot.head": {
          const joints = parseHead(requireParams(params, method));
          const commandOptions = normalizeCommandOptions(options, false);
          if (!controlEnabled) {
            lastRequestedHead = joints;
            lastAppliedHead = null;
            lastHeadLimitations = ["LOOI logical control gate is disabled"];
            return resultOrNull(id, notification, intentResult(false, lastHeadLimitations[0], {
              limitations: [...lastHeadLimitations],
            }));
          }
          lastRequestedHead = joints;
          lastHeadLimitations = [];
          const result = await session.execute({
            kind: "target",
            pose: { head: headJointsToMatrix(joints) },
          }, commandOptions);
          const applied = poseToHeadJoints(result.applied?.kind === "target" ? result.applied.pose : undefined);
          lastAppliedHead = applied;
          lastHeadLimitations = mergeLimitations(result.limitations, headRequestLimitations(joints, session.inspect().capabilities.pose));
          return resultOrNull(id, notification, executionIntentResult(result));
        }

        case "robot.look": {
          const look = parseLook(requireParams(params, method));
          const commandOptions = normalizeCommandOptions(options, false);
          const joints = lookPointToHeadJoints(look);
          if (!controlEnabled) {
            lastRequestedHead = joints;
            lastAppliedHead = null;
            lastHeadLimitations = ["LOOI logical control gate is disabled"];
            return resultOrNull(id, notification, intentResult(false, lastHeadLimitations[0], {
              limitations: [...lastHeadLimitations],
            }));
          }
          lastRequestedHead = joints;
          lastHeadLimitations = [];
          const result = await session.execute({
            kind: "target",
            pose: { head: headJointsToMatrix(joints) },
          }, commandOptions);
          const applied = poseToHeadJoints(result.applied?.kind === "target" ? result.applied.pose : undefined);
          lastAppliedHead = applied;
          lastHeadLimitations = mergeLimitations(result.limitations, headRequestLimitations(joints, session.inspect().capabilities.pose));
          if (!executionAccepted(result)) {
            throw new ProtocolFailure(JSONRPC_UNSUPPORTED, result.message ?? "LOOI could not apply the requested look target", {
              limitations: result.limitations,
            });
          }
          return resultOrNull(id, notification, {
            head: headJointsToWire(lastAppliedHead ?? joints),
            clamped: result.status === "adapted" || lastHeadLimitations.length > 0,
            compatibility: { origin: "looi", limitations: [...lastHeadLimitations], headTargetSource: lastAppliedHead ? "backend-applied" : "requested" },
          });
        }

        case "robot.sound": {
          const sound = parseSound(requireParams(params, method));
          return resultOrNull(id, notification, await playSound(sound.tag, sound.hold));
        }

        case "robot.stop": {
          requireNoParams(params, method);
          const audioStop = stopActiveSounds();
          await session.stop("microduck robot.stop");
          await audioStop;
          lastRequestedMove = { vx: 0, vy: 0, vyaw: 0 };
          lastAppliedMove = { vx: 0, vy: 0, vyaw: 0 };
          lastMoveLimitations = [];
          return resultOrNull(id, notification, { accepted: true });
        }

        case "robot.enable": {
          const enable = parseEnable(requireParams(params, method));
          const requestedEnabled = enable.toggle ? !controlEnabled : enable.on;
          return resultOrNull(id, notification, await setLogicalControlEnabled(requestedEnabled, "robot.enable"));
        }

        case "robot.init":
          requireNoParams(params, method);
          return resultOrNull(id, notification, await initializeLogicalControl());

        case "robot.relax": {
          requireNoParams(params, method);
          return resultOrNull(id, notification, await setLogicalControlEnabled(false, "robot.relax"));
        }

        case "robot.shutdown":
          requireNoParams(params, method);
          return resultOrNull(id, notification, intentResult(false,
            "LOOI does not expose a robot power-off operation through this app session", {
              compatibility: { origin: "looi", hardwarePowerControl: false },
            }));

        case "system.info": {
          requireNoParams(params, method);
          const info = dependencies.systemInfo?.();
          const name = validName(info?.name) ? info.name.trim() : "LOOI";
          const serial = typeof info?.serial === "string" && info.serial.length > 0 ? info.serial : null;
          const uptimeSeconds = info?.uptimeSeconds;
          const hasDeviceUptime = typeof uptimeSeconds === "number"
            && Number.isSafeInteger(uptimeSeconds) && uptimeSeconds >= 0;
          return resultOrNull(id, notification, {
            name,
            serial,
            ...(hasDeviceUptime ? { uptime_seconds: uptimeSeconds } : {}),
            compatibility: {
              origin: "looi",
              uptime_source: hasDeviceUptime ? "device" : "unavailable",
            },
          });
        }

        case "media.video": {
          requireNoParams(params, method);
          return resultOrNull(id, notification, mediaVideoResult(dependencies.videoInfo?.() ?? null));
        }

        case "robot.policies": {
          requireNoParams(params, method);
          const skills = supportedGestures(session.inspect().capabilities.gestures);
          return resultOrNull(id, notification, {
            mode: "looi",
            enabled: false,
            slots: [],
            skills,
            compatibility: { origin: "looi", policy_runtime: false, control_enabled: controlEnabled },
          });
        }

        case "robot.mode":
          requireNoParams(params, method);
          return resultOrNull(id, notification, {
            mode: "looi",
            compatibility: { origin: "looi", mode_scope: "backend" },
          });

        case "robot.health": {
          requireNoParams(params, method);
          const snapshot = session.inspect();
          const connected = snapshot.active && snapshot.observed.connected;
          const safetyReason = snapshot.observed.safetyReason;
          const healthy = connected && safetyReason === null;
          return resultOrNull(id, notification, {
            healthy,
            degraded: connected && safetyReason !== null,
            ...(safetyReason
              ? { reason: `LOOI reports a safety condition: ${safetyReason}` }
              : !connected ? { reason: "LOOI device session is disconnected" } : {}),
            compatibility: {
              origin: "looi",
              health_scope: "looi-bridge-session",
              connected,
              moving: snapshot.observed.moving,
              hardware_metrics_available: false,
            },
          });
        }

        case "robot.subscribe": {
          const subscribe = parseSubscribe(requireParams(params, method));
          // The pinned daemon replaces a connection's prior rate on each subscribe. A missing
          // rate and hz=0 mean no decimation; the transport's own 10 Hz pump remains the cap.
          stateHzRequested = subscribe.hz;
          lastStateSentAt = undefined;
          return resultOrNull(id, notification, {
            accepted: true,
            walk: null,
            stand: null,
            unavailable: "LOOI runs its native backend; MicroDuck ONNX policies are not installed",
            skills: supportedGestures(session.inspect().capabilities.gestures),
            compatibility: { origin: "looi", stateHzRequested: subscribe.hz ?? null },
          });
        }

        case "robot.skills":
          requireNoParams(params, method);
          return resultOrNull(id, notification, skillsResult(session.inspect().capabilities.gestures));

        case "robot.do": {
          const skill = parseSkill(requireParams(params, method));
          if (!controlEnabled) {
            return resultOrNull(id, notification, intentResult(false, "LOOI logical control gate is disabled"));
          }
          const capabilities = session.inspect().capabilities;
          if (!capabilities.gestures.includes(skill)) {
            return resultOrNull(id, notification, intentResult(false, `LOOI does not support gesture '${skill}'`));
          }
          const result = await session.execute({ kind: "gesture", name: skill }, normalizeCommandOptions(options, false));
          return resultOrNull(id, notification, executionIntentResult(result));
        }

        default:
          if (isPolicyManagementMethod(method)) {
            throw new ProtocolFailure(JSONRPC_UNSUPPORTED, `${method} is unsupported: LOOI does not install or run MicroDuck motion policies`);
          }
          if (isHardwareMaintenanceMethod(method)) {
            throw new ProtocolFailure(JSONRPC_UNSUPPORTED, `${method} is unsupported by the LOOI adapter; torque and firmware operations are not exposed`);
          }
          throw new ProtocolFailure(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      if (notification) return null;
      if (error instanceof ProtocolFailure) return errorResponse(id, error.code, error.message, error.data);
      return errorResponse(id, JSONRPC_INTERNAL_ERROR, safeErrorMessage(error));
    }
  }

  return {
    handleMessage,
    async close() {
      if (adapterClosed) return;
      adapterClosed = true;
      await stopActiveSounds();
    },
    getStateEvent,
    stateMessages() {
      const at = now();
      const intervalMs = stateHzRequested === undefined || stateHzRequested === 0
        ? 0
        : 1000 / stateHzRequested;
      if (lastStateSentAt !== undefined && at - lastStateSentAt < intervalMs) return [];
      lastStateSentAt = at;
      return [getStateEvent()];
    },
    subscribeState(listener) {
      return session.subscribe((snapshot) => listener(getStateEvent(snapshot)));
    },
  };

  async function setLogicalControlEnabled(enabled: boolean, source: string): Promise<Record<string, unknown>> {
    if (enabled) {
      controlEnabled = true;
      return {
        accepted: true,
        enabled: true,
        reason: "LOOI app control is enabled; servo torque is unchanged",
        compatibility: logicalControlCompatibility(),
      };
    }

    // Close admission before awaiting STOP so a concurrent intent cannot get behind it.
    controlEnabled = false;
    const audioStop = stopActiveSounds();
    await session.stop(`microduck ${source} off`);
    await audioStop;
    resetMoveState();
    const neutral = await centerHead();
    const limitations = neutral && !executionAccepted(neutral)
      ? mergeLimitations(neutral.limitations, [neutral.message ?? "LOOI could not center the head"])
      : neutral?.limitations ?? [];
    return {
      accepted: true,
      enabled: false,
      reason: limitations.length
        ? `LOOI stopped session movement; head centering was not completed: ${limitations.join("; ")}`
        : "LOOI stopped session movement and centered the supported head target; servo torque is unchanged",
      ...(limitations.length > 0 ? { limitations } : {}),
      compatibility: logicalControlCompatibility(),
    };
  }

  async function initializeLogicalControl(): Promise<Record<string, unknown>> {
    const wasEnabled = controlEnabled;
    controlEnabled = false;
    const audioStop = stopActiveSounds();
    await session.stop("microduck robot.init");
    await audioStop;
    resetMoveState();
    const neutral = await centerHead();
    if (!neutral || !executionAccepted(neutral)) {
      controlEnabled = wasEnabled;
      const reason = neutral?.message ?? "LOOI cannot home the head with the current backend";
      return intentResult(false, reason, {
        enabled: controlEnabled,
        compatibility: logicalControlCompatibility(),
      });
    }
    controlEnabled = true;
    return {
      accepted: true,
      enabled: true,
      ...(neutral.limitations.length > 0 ? { limitations: [...neutral.limitations] } : {}),
      reason: "LOOI centered the supported head target and enabled app intents; servo torque is unchanged",
      compatibility: logicalControlCompatibility(),
    };
  }

  async function centerHead(): Promise<RobotExecution | null> {
    if (session.inspect().capabilities.pose.head === "none") {
      lastRequestedHead = { neck_pitch: 0, head_pitch: 0, head_yaw: 0, head_roll: 0 };
      lastAppliedHead = null;
      lastHeadLimitations = ["LOOI backend does not expose a controllable head target"];
      return { status: "unsupported", limitations: [...lastHeadLimitations], message: lastHeadLimitations[0] };
    }
    const neutral: HeadJoints = { neck_pitch: 0, head_pitch: 0, head_yaw: 0, head_roll: 0 };
    lastRequestedHead = neutral;
    const result = await session.execute({ kind: "target", pose: { head: headJointsToMatrix(neutral) } });
    lastAppliedHead = poseToHeadJoints(result.applied?.kind === "target" ? result.applied.pose : undefined);
    lastHeadLimitations = mergeLimitations(result.limitations, headRequestLimitations(neutral, session.inspect().capabilities.pose));
    return result;
  }

  function resetMoveState(): void {
    lastRequestedMove = { vx: 0, vy: 0, vyaw: 0 };
    lastAppliedMove = { vx: 0, vy: 0, vyaw: 0 };
    lastMoveLimitations = [];
  }

  function logicalControlCompatibility(): Record<string, unknown> {
    return { origin: "looi", control_scope: "session-intent-gate", hardware_torque_control: false };
  }

  async function playSound(tag: MicroDuckSoundTag, hold?: boolean): Promise<Record<string, unknown>> {
    if (!dependencies.sound) {
      return intentResult(false, "LOOI app audio playback is unavailable", {
        compatibility: { origin: "looi", audio_scope: "unavailable" },
      });
    }
    if (adapterClosed) return intentResult(false, "MicroDuck app connection is closed");
    if (!controlEnabled) return intentResult(false, "LOOI logical control gate is disabled");

    if (tag === "wheee" && hold === false) {
      const held = activeHeldSound?.tag === tag ? activeHeldSound : null;
      if (held) activeHeldSound = null;
      try {
        // This is the exact Console pointer-up message. The player maps hold:false to release.
        const result = await dependencies.sound.play(tag, { hold: false });
        held?.controller.abort();
        if (held) activeSoundControllers.delete(held.controller);
        return soundIntentResult(result, false);
      } finally {
        if (held && !held.controller.signal.aborted) held.controller.abort();
        if (held) activeSoundControllers.delete(held.controller);
      }
    }

    if (tag === "wheee" && hold === true) {
      let held = activeHeldSound;
      if (held?.tag !== tag) {
        if (held || activeSoundControllers.size > 0) await stopActiveSounds();
        const controller = new AbortController();
        activeSoundControllers.add(controller);
        held = { tag, controller };
        activeHeldSound = held;
      }
      let result: { accepted: boolean; reason?: string };
      try {
        result = await dependencies.sound.play(tag, { hold: true, signal: held.controller.signal });
      } catch (error) {
        held.controller.abort();
        activeSoundControllers.delete(held.controller);
        if (activeHeldSound === held) activeHeldSound = null;
        throw error;
      }
      if (!result.accepted || held.controller.signal.aborted || activeHeldSound !== held) {
        held.controller.abort();
        activeSoundControllers.delete(held.controller);
        if (activeHeldSound === held) activeHeldSound = null;
        return soundIntentResult(result, true, "LOOI wheee playback was stopped before the request completed");
      }
      return soundIntentResult(result, false);
    }

    // Starting another sound replaces a held wheee loop. Its player cancels previous playback;
    // aborting here also prevents a stale request from keeping its lease alive.
    if (activeHeldSound || activeSoundControllers.size > 0) await stopActiveSounds();
    const controller = new AbortController();
    activeSoundControllers.add(controller);
    try {
      const result = await dependencies.sound.play(tag, { signal: controller.signal });
      return soundIntentResult(result, controller.signal.aborted, "LOOI sound playback was stopped before it completed");
    } finally {
      controller.abort();
      activeSoundControllers.delete(controller);
    }
  }

  async function stopActiveSounds(): Promise<void> {
    activeHeldSound = null;
    for (const controller of activeSoundControllers) controller.abort();
    activeSoundControllers.clear();
    await dependencies.sound?.stop();
  }

  function soundIntentResult(
    result: { accepted: boolean; reason?: string },
    aborted: boolean,
    abortedReason?: string,
  ): Record<string, unknown> {
    const accepted = result.accepted && !aborted;
    return {
      accepted,
      ...(accepted && result.reason ? { reason: result.reason } : {}),
      ...(!accepted ? { reason: aborted ? (abortedReason ?? "LOOI sound playback was canceled") : (result.reason ?? "LOOI audio player refused the sound") } : {}),
      compatibility: { origin: "looi", audio_scope: "app-audio" },
    };
  }
}

function helloResult(params: Record<string, unknown>): Record<string, unknown> {
  assertKnownKeys(params, ["api_version"], "hello");
  if (!isIntegerInRange(params.api_version, 0, 0xffff_ffff)) {
    throw invalidParams("hello.api_version must be an unsigned 32-bit integer");
  }
  return {
    api_version: MICRODUCK_API_VERSION,
    daemon_version: null,
    revision: `looi-robot-bridge-${MICRODUCK_ADAPTER_VERSION}`,
    robot: {
      id: "looi",
      name: "LOOI",
      model: "looi",
      origin: "looi",
      compatibility: {
        protocol: "microduck",
        api_version: MICRODUCK_API_VERSION,
        protocol_commit: MICRODUCK_PROTOCOL_COMMIT,
        adapter_version: MICRODUCK_ADAPTER_VERSION,
        policy_runtime: false,
      },
    },
  };
}

function parseMove(params: Record<string, unknown>): Movement {
  assertKnownKeys(params, ["vx", "vy", "vyaw"], "robot.move");
  return {
    vx: optionalFinite(params, "vx", 0),
    vy: optionalFinite(params, "vy", 0),
    vyaw: optionalFinite(params, "vyaw", 0),
  };
}

function parseHead(params: Record<string, unknown>): HeadJoints {
  assertKnownKeys(params, ["neck_pitch", "head_pitch", "head_yaw", "head_roll"], "robot.head");
  return {
    neck_pitch: optionalFinite(params, "neck_pitch", 0),
    head_pitch: optionalFinite(params, "head_pitch", 0),
    head_yaw: optionalFinite(params, "head_yaw", 0),
    head_roll: optionalFinite(params, "head_roll", 0),
  };
}

function parseLook(params: Record<string, unknown>): { x: number; y: number; z: number; neck_pitch: number } {
  assertKnownKeys(params, ["x", "y", "z", "neck_pitch"], "robot.look");
  return {
    x: optionalFinite(params, "x", 0),
    y: optionalFinite(params, "y", 0),
    z: optionalFinite(params, "z", 0),
    neck_pitch: optionalFinite(params, "neck_pitch", 0),
  };
}

function parseEnable(params: Record<string, unknown>): { on: boolean; toggle: boolean } {
  assertKnownKeys(params, ["on", "toggle"], "robot.enable");
  if (typeof params.on !== "boolean") throw invalidParams("robot.enable.on must be a boolean");
  if (params.toggle !== undefined && typeof params.toggle !== "boolean") {
    throw invalidParams("robot.enable.toggle must be a boolean");
  }
  return { on: params.on, toggle: params.toggle === true };
}

function parseSubscribe(params: Record<string, unknown>): { hz?: number } {
  assertKnownKeys(params, ["hz"], "robot.subscribe");
  if (params.hz === undefined) return {};
  if (!isIntegerInRange(params.hz, 0, 0xffff_ffff)) throw invalidParams("robot.subscribe.hz must be an unsigned 32-bit integer");
  return { hz: params.hz };
}

function parseSkill(params: Record<string, unknown>): string {
  assertKnownKeys(params, ["skill"], "robot.do");
  if (typeof params.skill !== "string" || params.skill.trim().length === 0) {
    throw invalidParams("robot.do.skill must be a non-empty string");
  }
  return params.skill;
}

function parseSound(params: Record<string, unknown>): { tag: MicroDuckSoundTag; hold?: boolean } {
  assertKnownKeys(params, ["tag", "hold"], "robot.sound");
  const validTags: readonly string[] = ["chirp", "greet", "inquire", "alarm", "peck", "coo", "wheee"];
  if (typeof params.tag !== "string" || !validTags.includes(params.tag)) {
    throw invalidParams("robot.sound.tag must be one of chirp, greet, inquire, alarm, peck, coo, wheee");
  }
  if (params.hold !== undefined && typeof params.hold !== "boolean") {
    throw invalidParams("robot.sound.hold must be a boolean");
  }
  if (params.tag !== "wheee" && params.hold !== undefined) {
    throw invalidParams("robot.sound.hold is supported only for wheee");
  }
  return { tag: params.tag as MicroDuckSoundTag, ...(typeof params.hold === "boolean" ? { hold: params.hold } : {}) };
}

function normalizeCommandOptions(options: RobotCommandOptions | undefined, forMovement: boolean): RobotCommandOptions {
  if (options === undefined) return forMovement ? { ttlMs: DEFAULT_MOVE_VALIDITY_MS } : {};
  if (!isRecord(options)) throw invalidParams("command options must be an object");
  assertKnownKeys(options, ["sequence", "ttlMs"], "command options");
  if (options.sequence !== undefined && !isIntegerInRange(options.sequence, 0, Number.MAX_SAFE_INTEGER)) {
    throw invalidParams("command sequence must be a non-negative safe integer");
  }
  if (options.ttlMs !== undefined && !isIntegerInRange(options.ttlMs, 1, 5_000)) {
    throw invalidParams("command ttlMs must be an integer from 1 to 5000");
  }
  const normalized: RobotCommandOptions = {};
  if (typeof options.sequence === "number") normalized.sequence = options.sequence;
  if (typeof options.ttlMs === "number") {
    normalized.ttlMs = forMovement ? Math.min(options.ttlMs, MAX_MOVE_VALIDITY_MS) : options.ttlMs;
  } else if (forMovement) {
    normalized.ttlMs = DEFAULT_MOVE_VALIDITY_MS;
  }
  return normalized;
}

function requireParams(value: unknown, method: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidParams(`${method}.params must be an object`);
  return value;
}

function requireNoParams(value: unknown, method: string): void {
  if (value !== undefined && value !== null && (!isRecord(value) || Object.keys(value).length > 0)) {
    throw invalidParams(`${method} does not accept params`);
  }
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], owner: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw invalidParams(`${owner} has unknown parameter${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
}

function optionalFinite(params: Record<string, unknown>, key: string, defaultValue: number): number {
  if (params[key] === undefined) return defaultValue;
  if (typeof params[key] !== "number" || !Number.isFinite(params[key])) {
    throw invalidParams(`${key} must be a finite number`);
  }
  return params[key];
}

function headJointsToMatrix(joints: HeadJoints): number[] {
  // Right-handed trunk frame: x forward, y left, z up. LOOI has no separate MicroDuck neck joint,
  // so its neck and head pitch are combined and the limitation is reported in the state metadata.
  const pitch = joints.neck_pitch + joints.head_pitch;
  const yaw = joints.head_yaw;
  const roll = joints.head_roll;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  // Rz(yaw) * Ry(pitch) * Rx(roll); positive pitch rotates the forward axis downward.
  const r00 = cy * cp;
  const r01 = cy * sp * sr - sy * cr;
  const r02 = cy * sp * cr + sy * sr;
  const r10 = sy * cp;
  const r11 = sy * sp * sr + cy * cr;
  const r12 = sy * sp * cr - cy * sr;
  const r20 = -sp;
  const r21 = cp * sr;
  const r22 = cp * cr;
  return [r00, r01, r02, 0, r10, r11, r12, 0, r20, r21, r22, 0, 0, 0, 0, 1];
}

function lookPointToHeadJoints(look: { x: number; y: number; z: number; neck_pitch: number }): HeadJoints {
  const horizontal = Math.hypot(look.x, look.y);
  if (horizontal < 1e-9 && Math.abs(look.z) < 1e-9) throw invalidParams("robot.look target must not be the trunk origin");
  const pitch = -Math.atan2(look.z, horizontal);
  return {
    neck_pitch: look.neck_pitch,
    head_pitch: pitch - look.neck_pitch,
    head_yaw: Math.atan2(look.y, look.x),
    head_roll: 0,
  };
}

function poseToHeadJoints(pose: RobotPose | undefined): HeadJoints | null {
  const matrix = pose?.head;
  if (!matrix || matrix.length !== 16 || matrix.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  const yaw = Math.atan2(matrix[4], matrix[0]);
  const pitch = Math.atan2(-matrix[8], Math.hypot(matrix[0], matrix[4]));
  const roll = Math.atan2(matrix[9], matrix[10]);
  return { neck_pitch: 0, head_pitch: pitch, head_yaw: yaw, head_roll: roll };
}

function headJointsToWire(joints: HeadJoints): HeadJoints {
  return {
    neck_pitch: joints.neck_pitch,
    head_pitch: joints.head_pitch,
    head_yaw: joints.head_yaw,
    head_roll: joints.head_roll,
  };
}

function executionToMove(result: RobotExecution, requested: Movement): Movement | null {
  const applied = result.applied;
  if (applied?.kind === "drive") {
    return { vx: applied.forward, vy: applied.lateral, vyaw: applied.yawRate };
  }
  // An acknowledged zero twist is an explicit stop. For adapted or refused SI commands,
  // LOOI does not expose a calibrated velocity and the state must not invent one.
  if (result.status === "applied" && requested.vx === 0 && requested.vy === 0 && requested.vyaw === 0) {
    return { vx: 0, vy: 0, vyaw: 0 };
  }
  return null;
}

function headRequestLimitations(
  joints: HeadJoints,
  capabilities: RobotCapabilities["pose"],
): string[] {
  const limitations: string[] = [];
  if (joints.neck_pitch !== 0) limitations.push("LOOI combines MicroDuck neck_pitch and head_pitch into one head-pitch target");
  if (joints.head_yaw !== 0 && !capabilities.headYaw) limitations.push("head yaw is unsupported by the LOOI backend");
  if (joints.head_roll !== 0 && !capabilities.headRoll) limitations.push("head roll is unsupported by the LOOI backend");
  return limitations;
}

function mergeLimitations(primary: readonly string[], additional: readonly string[]): string[] {
  return [...new Set([...primary, ...additional])];
}

function executionAccepted(result: RobotExecution): boolean {
  return result.status === "applied" || result.status === "adapted";
}

function executionIntentResult(result: RobotExecution): Record<string, unknown> {
  const accepted = executionAccepted(result);
  const reason = result.message ?? (result.limitations.length > 0 ? result.limitations.join("; ") : undefined);
  return {
    accepted,
    ...(reason ? { reason } : {}),
    ...(result.limitations.length > 0 ? { limitations: [...result.limitations] } : {}),
    ...(result.applied ? { applied: result.applied } : {}),
  };
}

function intentResult(accepted: boolean, reason?: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { accepted, ...(reason ? { reason } : {}), ...(extra ?? {}) };
}

function supportedGestures(gestures: readonly string[]): string[] {
  // Expose only gestures that the shared backend explicitly advertises. Never imply that LOOI has
  // MicroDuck's built-in gait, sit/stand, kick, or recovery policies.
  return [...new Set(gestures)].sort();
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mediaVideoResult(info: MicroDuckVideoInfo | null): Record<string, unknown> {
  if (!info || !info.available) {
    return {
      available: false,
      width: null,
      height: null,
      rotate: 0,
      compatibility: { origin: "looi", metadata_source: "unavailable" },
    };
  }
  const rotationIsValid = [0, 90, 180, 270].includes(info.rotate);
  const dimensionsAreValid = Number.isInteger(info.width) && info.width !== null && info.width > 0
    && Number.isInteger(info.height) && info.height !== null && info.height > 0;
  if (!rotationIsValid || !dimensionsAreValid) {
    throw new ProtocolFailure(JSONRPC_INTERNAL_ERROR, "LOOI camera metadata must include positive integer dimensions and a right-angle rotation");
  }
  return {
    available: true,
    width: info.width,
    height: info.height,
    rotate: info.rotate,
    compatibility: { origin: "looi", metadata_source: info.source },
  };
}

function skillsResult(gestures: readonly string[]): Record<string, unknown> {
  return {
    skills: supportedGestures(gestures).map((name) => ({
      name,
      path: null,
      duration: null,
      command: null,
      unwind: null,
      unwind_s: null,
      chain: null,
      action_scale: null,
      gain_ratio: null,
      overridden: false,
      compatibility: { kind: "generic-gesture", origin: "looi" },
    })),
    built_in: [],
    compatibility: { origin: "looi", policy_runtime: false },
  };
}

function isPolicyManagementMethod(method: string): boolean {
  return method.startsWith("policy.") || /^robot\.(?:loadPolicy|reloadPolicies|setSkill|removeSkill)$/.test(method);
}

function isHardwareMaintenanceMethod(method: string): boolean {
  return /^robot\.(?:init|relax|rebootMotors|rest|shutdown|setMode)$/.test(method)
    || /^(?:update|firmware)\./.test(method);
}

function resultOrNull(id: RequestId | null, notification: boolean, result: unknown): JsonRpcResponse | null {
  return notification ? null : { jsonrpc: JSONRPC_VERSION, id, result };
}

function errorResponse(id: RequestId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function invalidParams(message: string): ProtocolFailure {
  return new ProtocolFailure(JSONRPC_INVALID_PARAMS, message);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Adapter operation failed";
}
