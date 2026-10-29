/**
 * Reachy Mini wire-protocol compatibility over the robot-neutral session.
 *
 * Wire field names and reply envelopes follow Reachy Mini at
 * https://github.com/pollen-robotics/reachy_mini/tree/9fb2bfcbdf4c9800b0649acb8f0c18027673943f/src/reachy_mini/io
 * (protocol.py, daemon/backend/abstract.py, and ts/lib/math.ts). This adapter
 * intentionally implements only commands that can be represented by the
 * RobotSession contract; unsupported hardware services return explicit errors.
 */
import type {
  Matrix4,
  RobotCommandOptions,
  RobotExecution,
  RobotPose,
  RobotResult,
  RobotSession,
  RobotSnapshot,
} from "./types";
import type { RobotAppMediaServices } from "./app-media-services";

/** This is the tested Reachy wire target, not installed Reachy firmware. */
const REACHY_WIRE_VERSION = "1.13.0+looi";
const REACHY_ADAPTER_VERSION = "0.1.0";
const REACHY_VERSION_ORIGIN = "reachy_wire_compatibility";
const MAX_GOTO_SECONDS = 60;
const MAX_MOVE_SECONDS = 300;
const MAX_MOVE_FRAMES = 30_000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOADS = 4;
const MAX_CHUNK_CHARS = 16 * 1024;
const GOTO_FREQUENCY_HZ = 30;
const MAX_PLAYBACK_FREQUENCY_HZ = 50;
const MAX_SOURCE_TTL_MS = 5_000;
const CORE_FRAME_LEASE_MS = 750;
const IDENTITY: Matrix4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

type WireObject = Record<string, unknown>;
type WireReply = WireObject | null;

type MotionRun = {
  localGeneration: number;
  sessionGeneration: number;
  kind: "goto" | "uploaded" | "gesture";
  uploadId?: string;
  cancelled: boolean;
  cancellationReason?: string;
  timer: ReturnType<typeof setTimeout> | null;
  wake: ((completed: boolean) => void) | null;
};

type RecordedFrame = {
  time: number;
  head: number[];
  antennas: [number, number];
  body_yaw?: number;
};

type UploadedMove = {
  description: string;
  frames: RecordedFrame[];
  durationSeconds: number;
  bytes: number;
};

type UploadSlot = {
  totalChunks: number;
  nextChunk: number;
  chunks: string[];
  bytes: number;
};

type InterpolationTechnique = "linear" | "minjerk" | "ease_in_out" | "cartoon";
const INTERPOLATION_TECHNIQUES: readonly InterpolationTechnique[] = ["linear", "minjerk", "ease_in_out", "cartoon"];

export type ReachyTarget = {
  head?: readonly number[];
  antennas?: readonly [number, number] | readonly number[];
  body_yaw?: number;
};

type VirtualMotorMode = "enabled" | "disabled";

export type ReachyAdapter = {
  /** Apply a Reachy SDK-style pose update. Matrices are flat row-major; angles are radians. */
  setTarget(target: ReachyTarget, options?: RobotCommandOptions): Promise<RobotResult>;
  /** Interpolate to a Reachy SDK-style target over `duration` seconds. */
  gotoTarget(target: ReachyTarget & { duration: number }, options?: RobotCommandOptions): Promise<WireReply>;
  /** Set orientation using the Reachy SDK's ZYX Euler convention, in degrees. */
  setHeadRpyDeg(roll: number, pitch: number, yaw: number, options?: RobotCommandOptions): Promise<RobotResult>;
  setAntennasDeg(right: number, left: number, options?: RobotCommandOptions): Promise<RobotResult>;
  setBodyYawDeg(yaw: number, options?: RobotCommandOptions): Promise<RobotResult>;
  /** Handle one original Reachy `{type, ...}` command. `null` means fire-and-forget. */
  handleMessage(raw: string | unknown, options?: RobotCommandOptions): Promise<WireReply>;
  /** Reachy state envelope: `{state, seq}`. Pose fields are explicitly virtual. */
  snapshot(): WireObject;
  /** Startup status message for transports that need an initial daemon snapshot. */
  initialMessages(): WireObject[];
  /** Current messages used by the original Python SDK WebSocket startup/poll loop. */
  pollMessages(): WireObject[];
  /** Messages produced asynchronously, e.g. `recorded_data` and move lifecycle events. */
  takeMessages(): WireObject[];
  wantsPoseStream(): boolean;
  close(): Promise<void>;
};

type ReachyAdapterDependencies = {
  /** Session-authorized app audio only; never acquires or reroutes a device. */
  media?: Pick<RobotAppMediaServices, "audio" | "sound">;
};

type ReachySoundTag = "chirp" | "greet" | "inquire" | "alarm" | "peck" | "coo" | "wheee";

function reachySoundTag(file: unknown): ReachySoundTag | null {
  switch (file) {
    case "chirp.wav": return "chirp";
    case "greet.wav": return "greet";
    case "inquire.wav": return "inquire";
    case "alarm.wav": return "alarm";
    case "peck.wav": return "peck";
    case "coo.wav": return "coo";
    case "wheee.wav": return "wheee";
    default: return null;
  }
}

function audioVolumePercent(value: unknown, label: string): number {
  const percent = finiteNumber(value, label);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new TypeError(`${label} must be an integer from 0 to 100`);
  }
  return percent;
}

function isObject(value: unknown): value is WireObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function flatMatrix(value: unknown, label = "head"): number[] {
  if (!Array.isArray(value) || value.length !== 16 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new TypeError(`${label} must be a flat row-major 4x4 matrix of 16 finite numbers`);
  }
  return [...value] as number[];
}

function pair(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new TypeError(`${label} must contain exactly two finite numbers`);
  }
  return [value[0] as number, value[1] as number];
}

function requiredNonEmptyPose(pose: RobotPose): void {
  if (pose.head === undefined && pose.antennas === undefined && pose.bodyYaw === undefined) {
    throw new TypeError("at least one of head, antennas, or body_yaw is required");
  }
}

function wirePose(input: WireObject, { requireHead = false } = {}): RobotPose {
  const pose: RobotPose = {
    // Pydantic serializes omitted Optional fields as null by default. Treat
    // null exactly like an absent field while continuing to validate every
    // provided matrix and numeric value.
    ...(input.head !== undefined && input.head !== null ? { head: flatMatrix(input.head) } : {}),
    ...(input.antennas !== undefined && input.antennas !== null ? { antennas: pair(input.antennas, "antennas") } : {}),
    ...(input.body_yaw !== undefined && input.body_yaw !== null ? { bodyYaw: finiteNumber(input.body_yaw, "body_yaw") } : {}),
  };
  if (requireHead && pose.head === undefined) throw new TypeError("head is required");
  requiredNonEmptyPose(pose);
  return pose;
}

function rad(degrees: number): number {
  return degrees * Math.PI / 180;
}

/** Reachy `ts/lib/math.ts` rpyToMatrix: ZYX convention, flat row-major 4x4. */
function rpyToMatrix(rollDegrees: number, pitchDegrees: number, yawDegrees: number): number[] {
  const r = rad(rollDegrees);
  const p = rad(pitchDegrees);
  const y = rad(yawDegrees);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, 0,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, 0,
    -sp, cp * sr, cp * cr, 0,
    0, 0, 0, 1,
  ];
}

function matrixToRpy(matrix: readonly number[]): [number, number, number] {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -matrix[8]!)));
  return [
    Math.atan2(matrix[9]!, matrix[10]!),
    pitch,
    Math.atan2(matrix[4]!, matrix[0]!),
  ];
}

function shortestLerp(from: number, to: number, alpha: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}

/** Reachy Mini `time_trajectory` easing functions from the pinned SDK source. */
function trajectoryProgress(t: number, method: InterpolationTechnique): number {
  if (method === "linear") return t;
  if (method === "minjerk") return 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
  if (method === "ease_in_out") return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
    : (((2 * t - 2) ** 2 * ((c2 + 1) * (2 * t - 2) + c2)) + 2) / 2;
}

function interpolateMatrix(from: readonly number[], to: readonly number[], alpha: number): number[] {
  const aRpy = matrixToRpy(from);
  const bRpy = matrixToRpy(to);
  const r = shortestLerp(aRpy[0], bRpy[0], alpha);
  const p = shortestLerp(aRpy[1], bRpy[1], alpha);
  const y = shortestLerp(aRpy[2], bRpy[2], alpha);
  const result = rpyToMatrix(r * 180 / Math.PI, p * 180 / Math.PI, y * 180 / Math.PI);
  for (const offset of [3, 7, 11]) result[offset] = from[offset]! + (to[offset]! - from[offset]!) * alpha;
  return result;
}

function interpolatePose(from: RobotPose, to: RobotPose, alpha: number): RobotPose {
  const next: RobotPose = {};
  if (to.head !== undefined) next.head = interpolateMatrix(from.head ?? IDENTITY, to.head, alpha);
  if (to.antennas !== undefined) {
    const a = from.antennas ?? [0, 0];
    next.antennas = [a[0] + (to.antennas[0] - a[0]) * alpha, a[1] + (to.antennas[1] - a[1]) * alpha];
  }
  if (to.bodyYaw !== undefined) next.bodyYaw = shortestLerp(from.bodyYaw ?? 0, to.bodyYaw, alpha);
  return next;
}

function nestedMatrix(flat: readonly number[]): number[][] {
  return [0, 1, 2, 3].map((row) => flat.slice(row * 4, row * 4 + 4));
}

function virtualHeadJointPositions(bodyYaw: number | undefined): number[] {
  // Reachy reserves index 0 for body yaw and six following head joints. LOOI
  // has no corresponding joint-space model, so the remaining slots are
  // explicit virtual placeholders (never measured motor positions).
  return [bodyYaw ?? 0, 0, 0, 0, 0, 0, 0];
}

function taskProgressMessage(uuid: string, finished: boolean, error: string | null): WireObject {
  return {
    type: "task_progress",
    uuid,
    finished,
    error,
    timestamp: new Date().toISOString(),
  };
}

function normalizeRecordedFrame(value: unknown, index: number, timestamp?: number): RecordedFrame {
  if (!isObject(value)) throw new TypeError(`set_target_data[${index}] must be an object`);
  const time = timestamp ?? finiteNumber(value.time, `set_target_data[${index}].time`);
  const headValue = value.head;
  const head = Array.isArray(headValue) && Array.isArray(headValue[0])
    ? (headValue as unknown[][]).flat()
    : headValue;
  const flatHead = flatMatrix(head, `set_target_data[${index}].head`);
  const antennas = pair(value.antennas, `set_target_data[${index}].antennas`);
  const bodyYaw = value.body_yaw === undefined ? undefined : finiteNumber(value.body_yaw, `set_target_data[${index}].body_yaw`);
  return { time, head: flatHead, antennas, ...(bodyYaw !== undefined ? { body_yaw: bodyYaw } : {}) };
}

function validateUploadedMove(value: unknown): UploadedMove {
  if (!isObject(value)) throw new TypeError("uploaded move must be a JSON object");
  if (!Array.isArray(value.time) || !Array.isArray(value.set_target_data)) {
    throw new TypeError("uploaded move requires time[] and set_target_data[] arrays");
  }
  if (value.time.length < 2 || value.time.length !== value.set_target_data.length || value.time.length > MAX_MOVE_FRAMES) {
    throw new TypeError(`uploaded move must contain 2-${MAX_MOVE_FRAMES} matching timestamps and frames`);
  }
  const times = value.time.map((entry, index) => finiteNumber(entry, `time[${index}]`));
  const frames = value.set_target_data.map((frame, index) => normalizeRecordedFrame(frame, index, times[index]));
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i]!;
    if (i > 0 && time <= times[i - 1]!) {
      throw new TypeError("uploaded move timestamps must be strictly increasing");
    }
  }
  const durationSeconds = frames.at(-1)!.time - frames[0]!.time;
  if (!(durationSeconds > 0) || durationSeconds > MAX_MOVE_SECONDS) {
    throw new TypeError(`uploaded move duration must be greater than 0 and no more than ${MAX_MOVE_SECONDS} seconds`);
  }
  const description = typeof value.description === "string" ? value.description.slice(0, 500) : "LOOI compatibility move";
  return { description, frames, durationSeconds, bytes: 0 };
}

function resultError(result: RobotExecution, command: string): WireReply {
  if (result.status === "applied" || result.status === "adapted") {
    return {
      status: "ok",
      command,
      ...(result.status === "adapted" ? { compatibility_status: "adapted" } : {}),
      ...(result.limitations.length ? { limitations: result.limitations } : {}),
    };
  }
  return {
    error: result.message ?? `LOOI compatibility layer ${result.status} this command`,
    command,
    compatibility_status: result.status,
    ...(result.limitations.length ? { limitations: result.limitations } : {}),
  };
}

export function createReachyAdapter(session: RobotSession, dependencies: ReachyAdapterDependencies = {}): ReachyAdapter {
  let closed = false;
  // Opening an authenticated Reachy app session is the user's explicit
  // opt-in to this compatibility model. Start its *virtual* target gate open
  // so the stock SDK's wake_up() can issue its usual TaskRequest sequence;
  // this never asserts physical Reachy torque or hardware motor availability.
  let virtualMotorMode: VirtualMotorMode = "enabled";
  let stateSequence = 0;
  let localGeneration = 0;
  let sourceSequence = -1;
  let corePoseSequence = 0;
  let observedSessionGeneration = session.inspect().generation;
  let activeRun: MotionRun | null = null;
  let recording = false;
  let records: WireObject[] = [];
  let firstRecordTime: number | null = null;
  let lastRecordTime = -Infinity;
  let recordingChars = 0;
  let outputVolume: number | null = null;
  let poseSubscribed = false;
  let totalUploadBytes = 0;
  const uploadSlots = new Map<string, UploadSlot>();
  const uploadedMoves = new Map<string, UploadedMove>();
  const outgoingMessages: WireObject[] = [];

  /** Check source freshness/order once at admission, separately from frame leases. */
  function sourceAdmissionError(options?: RobotCommandOptions): string | null {
    if (!options) return null;
    if (options.sequence !== undefined) {
      if (!Number.isSafeInteger(options.sequence) || options.sequence < 0) {
        return "Invalid source command sequence";
      }
      if (options.sequence <= sourceSequence) return "Stale source command sequence";
      sourceSequence = options.sequence;
    }
    if (options.ttlMs !== undefined) {
      if (typeof options.ttlMs !== "number" || !Number.isFinite(options.ttlMs)
        || options.ttlMs < 1 || options.ttlMs > MAX_SOURCE_TTL_MS) {
        return "Invalid source command lifetime";
      }
    }
    return null;
  }

  function frameOptions(): RobotCommandOptions {
    corePoseSequence += 1;
    return { sequence: corePoseSequence, ttlMs: CORE_FRAME_LEASE_MS };
  }

  function rejectedExecution(message: string): RobotResult {
    return {
      status: "rejected",
      limitations: ["source_admission_rejected"],
      message,
      sessionId: session.id,
      commandId: -1,
    };
  }

  const unsubscribe = session.subscribe((state) => {
    if (state.generation === observedSessionGeneration) return;
    observedSessionGeneration = state.generation;
    if (activeRun) cancelRun(activeRun, "session stopped outside the Reachy adapter");
  });

  function pushMessage(message: WireObject): void {
    outgoingMessages.push(message);
    if (outgoingMessages.length > 128) outgoingMessages.shift();
  }

  function currentPose(): RobotPose {
    return { ...session.inspect().virtualPose };
  }

  function statePayload(): WireObject {
    const state = session.inspect();
    const pose = state.virtualPose;
    const head = pose.head ?? IDENTITY;
    return {
      head_pose: nestedMatrix(head),
      antennas: pose.antennas ? [...pose.antennas] : null,
      head_joint_positions: virtualHeadJointPositions(pose.bodyYaw),
      body_yaw: pose.bodyYaw ?? 0,
      motor_mode: virtualMotorMode,
      motor_mode_origin: "virtual",
      is_recording: recording,
      is_move_running: !!activeRun && !activeRun.cancelled,
      face_target: { detected: false },
      doa: null,
      imu: null,
      // Extra metadata is ignored by the Reachy SDK and prevents virtual
      // compatibility state from being mistaken for measured hardware state.
      pose_origin: "virtual",
      hardware_motors_available: false,
      camera_available: state.capabilities.media.camera,
      microphone_available: state.capabilities.media.microphone,
      imu_available: false,
      face_tracking_available: state.capabilities.media.camera,
      measured_pose: state.observed.measuredPose,
      measured_velocity: state.observed.measuredVelocity,
      safety_reason: state.observed.safetyReason,
    };
  }

  function buildSnapshot(): WireObject {
    stateSequence += 1;
    return { state: statePayload(), seq: stateSequence };
  }

  /**
   * Reachy Mini's Python WS client waits for these two concrete discriminators
   * before considering its connection initialized. Keep their protocol field
   * names and shapes, while explicitly marking all values as virtual: LOOI
   * does not expose Reachy joint sensors or a Reachy head actuator.
   *
   * Upstream reference: pinned io/ws_server.py and io/protocol.py.
   */
  function pythonSdkPoseMessages(): WireObject[] {
    const pose = session.inspect().virtualPose;
    return [
      {
        type: "joint_positions",
        // The seven-slot Reachy joint vector has no kinematic equivalent in
        // LOOI. Preserve the envelope with virtual placeholders, not claimed
        // measurements. Body yaw is the only corresponding requested angle.
        head_joint_positions: virtualHeadJointPositions(pose.bodyYaw),
        antennas_joint_positions: pose.antennas ? [...pose.antennas] : [0, 0],
        compatibility_origin: "virtual",
        hardware_motors_available: false,
      },
      {
        type: "head_pose",
        head_pose: nestedMatrix(pose.head ?? IDENTITY),
        compatibility_origin: "virtual",
        hardware_motors_available: false,
      },
    ];
  }

  function recordPose(pose: RobotPose): void {
    if (!recording) return;
    const now = Math.max(Date.now() / 1000, lastRecordTime + 0.001);
    const record: WireObject = {
      time: now,
      body_yaw: pose.bodyYaw ?? 0,
      ...(pose.head ? { head: nestedMatrix(pose.head) } : {}),
      ...(pose.antennas ? { antennas: [...pose.antennas] } : {}),
    };
    appendValidatedRecord(record);
  }

  function appendValidatedRecord(value: unknown): void {
    if (!recording) return;
    if (!isObject(value)) throw new TypeError("record must be an object");
    const time = finiteNumber(value.time, "record.time");
    if (time <= lastRecordTime) throw new TypeError("record.time must be strictly increasing");
    if (firstRecordTime !== null && time - firstRecordTime > MAX_MOVE_SECONDS) {
      recording = false;
      throw new TypeError(`recording exceeds the ${MAX_MOVE_SECONDS}-second duration limit`);
    }
    const normalized: WireObject = { time };
    if (value.head !== undefined) {
      const headValue = value.head;
      const head = Array.isArray(headValue) && Array.isArray(headValue[0]) ? (headValue as unknown[][]).flat() : headValue;
      normalized.head = nestedMatrix(flatMatrix(head, "record.head"));
    }
    if (value.antennas !== undefined) normalized.antennas = pair(value.antennas, "record.antennas");
    if (value.body_yaw !== undefined) normalized.body_yaw = finiteNumber(value.body_yaw, "record.body_yaw");
    if (normalized.head === undefined && normalized.antennas === undefined && normalized.body_yaw === undefined) {
      throw new TypeError("record must contain head, antennas, or body_yaw");
    }
    const size = JSON.stringify(normalized).length;
    if (records.length >= MAX_MOVE_FRAMES || recordingChars + size > MAX_UPLOAD_BYTES) {
      recording = false;
      throw new TypeError("recording reached its size limit");
    }
    records.push(normalized);
    recordingChars += size;
    firstRecordTime ??= time;
    lastRecordTime = time;
  }

  function isCurrentRun(run: MotionRun): boolean {
    return !closed
      && !session.closed
      && activeRun === run
      && !run.cancelled
      && run.localGeneration === localGeneration
      && run.sessionGeneration === session.inspect().generation;
  }

  function cancelRun(run: MotionRun, reason: string): void {
    if (run.cancelled) return;
    run.cancelled = true;
    run.cancellationReason = reason;
    if (run.timer !== null) {
      clearTimeout(run.timer);
      run.timer = null;
    }
    const wake = run.wake;
    run.wake = null;
    wake?.(false);
  }

  function beginRun(kind: MotionRun["kind"], uploadId?: string): MotionRun {
    if (activeRun) {
      const previous = activeRun;
      cancelRun(previous, "superseded by a newer Reachy command");
      // Named actions can resolve to wheels or lights, not just the pose lane.
      // Revoke their old core lease before starting a replacement in any lane.
      if (kind === "gesture" || previous.kind === "gesture") {
        void session.stop("reachy-named-action-replaced").catch(() => undefined);
      }
    }
    localGeneration += 1;
    const run: MotionRun = {
      localGeneration,
      sessionGeneration: session.inspect().generation,
      kind,
      ...(uploadId ? { uploadId } : {}),
      cancelled: false,
      timer: null,
      wake: null,
    };
    activeRun = run;
    return run;
  }

  function waitUntil(run: MotionRun, deadline: number): Promise<boolean> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.resolve(isCurrentRun(run));
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (completed: boolean): void => {
        if (run.timer === timer) run.timer = null;
        if (run.wake === finish) run.wake = null;
        resolve(completed && isCurrentRun(run));
      };
      run.wake = finish;
      timer = setTimeout(() => finish(true), remaining);
      run.timer = timer;
    });
  }

  async function executeTarget(
    pose: RobotPose,
    run?: MotionRun,
  ): Promise<RobotResult> {
    if (run && !isCurrentRun(run)) {
      return {
        status: "cancelled",
        limitations: [],
        message: run.cancellationReason ?? "motion was cancelled",
        sessionId: session.id,
        commandId: -1,
      };
    }
    if (virtualMotorMode !== "enabled") {
      return {
        status: "rejected",
        limitations: ["virtual_motor_mode_disabled"],
        message: "Reachy pose commands are disabled; call wake_up or set_motor_mode enabled first",
        sessionId: session.id,
        commandId: -1,
      };
    }
    // The transport TTL was checked once when the source packet was admitted.
    // Every bounded pose frame gets its own short core lease so a valid long
    // trajectory does not expire merely because it outlives the source packet.
    const result = await session.execute({ kind: "target", pose }, frameOptions());
    if (run && !isCurrentRun(run)) {
      return { ...result, status: "cancelled", message: run.cancellationReason ?? "motion was cancelled" };
    }
    if (result.status === "applied" || result.status === "adapted") recordPose(pose);
    return result;
  }

  async function applyTarget(target: ReachyTarget): Promise<RobotResult> {
    if (closed || session.closed) throw new Error("Reachy adapter session is closed");
    if (!isObject(target)) throw new TypeError("target must be an object");
    const pose = wirePose(target as WireObject);
    return executeTarget(pose);
  }

  async function applyPublicTarget(target: ReachyTarget, options?: RobotCommandOptions): Promise<RobotResult> {
    const admissionError = sourceAdmissionError(options);
    if (admissionError) return rejectedExecution(admissionError);
    return applyTarget(target);
  }

  function addUploadBytes(delta: number): void {
    totalUploadBytes += delta;
    if (totalUploadBytes < 0) totalUploadBytes = 0;
  }

  function emitMoveEvent(uploadId: string, status: "finished" | "cancelled" | "error", detail?: string): void {
    const event: WireObject = { type: "play_uploaded_move", upload_id: uploadId };
    if (status === "finished") event.finished = true;
    else if (status === "cancelled") event.cancelled = true;
    else event.error = detail ?? "uploaded move failed";
    pushMessage(event);
  }

  async function animateTo(
    target: RobotPose,
    durationMs: number,
    commandName: string,
    run: MotionRun,
    method: InterpolationTechnique = "linear",
  ): Promise<WireReply> {
    const from = currentPose();
    const startAt = Date.now();
    const frameCount = Math.max(1, Math.ceil(durationMs * GOTO_FREQUENCY_HZ / 1000));
    const frameInterval = durationMs / frameCount;
    let lastResult: RobotResult | null = null;
    for (let index = 1; index <= frameCount; index += 1) {
      if (!isCurrentRun(run)) return { error: run.cancellationReason ?? `${commandName} cancelled`, command: commandName };
      const pose = interpolatePose(from, target, trajectoryProgress(index / frameCount, method));
      lastResult = await executeTarget(pose, run);
      if (lastResult.status !== "applied" && lastResult.status !== "adapted") {
        return resultError(lastResult, commandName);
      }
      if (index < frameCount && !(await waitUntil(run, startAt + Math.round(frameInterval * index)))) {
        return { error: run.cancellationReason ?? `${commandName} cancelled`, command: commandName };
      }
    }
    if (!lastResult) return { error: `${commandName} did not produce a motion frame`, command: commandName };
    const reply = resultError(lastResult, commandName) as WireObject;
    reply.completed = true;
    return reply;
  }

  async function animateAndRelease(
    target: RobotPose,
    durationMs: number,
    commandName: string,
    run: MotionRun,
    method: InterpolationTechnique = "linear",
  ): Promise<WireReply> {
    try {
      return await animateTo(target, durationMs, commandName, run, method);
    } finally {
      if (activeRun === run) activeRun = null;
    }
  }

  function evaluateMove(move: UploadedMove, elapsedSeconds: number): RobotPose {
    const { frames } = move;
    const sourceTime = frames[0]!.time + Math.max(0, Math.min(move.durationSeconds, elapsedSeconds));
    let right = 1;
    while (right < frames.length - 1 && frames[right]!.time < sourceTime) right += 1;
    const left = Math.max(0, right - 1);
    const a = frames[left]!;
    const b = frames[right]!;
    const span = b.time - a.time;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (sourceTime - a.time) / span)) : 0;
    const from: RobotPose = { head: a.head, antennas: a.antennas, bodyYaw: a.body_yaw ?? 0 };
    const to: RobotPose = { head: b.head, antennas: b.antennas, bodyYaw: b.body_yaw ?? 0 };
    return interpolatePose(from, to, alpha);
  }

  async function runUploadedMove(
    uploadId: string,
    move: UploadedMove,
    run: MotionRun,
    initialGotoDuration: number,
    requestedFrequency: number,
  ): Promise<void> {
    let eventStatus: "finished" | "cancelled" | "error" = "finished";
    let error: string | undefined;
    try {
      if (initialGotoDuration > 0) {
        const first = move.frames[0]!;
        const firstPose: RobotPose = { head: first.head, antennas: first.antennas, bodyYaw: first.body_yaw ?? 0 };
        const approach = await animateTo(firstPose, initialGotoDuration * 1000, "play_uploaded_move", run);
        if (!isCurrentRun(run)) {
          eventStatus = "cancelled";
          return;
        }
        if (approach && "error" in approach) {
          eventStatus = "error";
          error = String(approach.error);
          return;
        }
      }
      const frequency = Math.min(requestedFrequency, MAX_PLAYBACK_FREQUENCY_HZ);
      const intervalMs = 1000 / frequency;
      const start = Date.now();
      let lastPoseTime = -1;
      while (true) {
        if (!isCurrentRun(run)) {
          eventStatus = "cancelled";
          return;
        }
        const elapsed = Math.min(move.durationSeconds, Math.max(0, (Date.now() - start) / 1000));
        if (elapsed >= move.durationSeconds && lastPoseTime >= move.durationSeconds) break;
        const pose = evaluateMove(move, elapsed);
        const result = await executeTarget(pose, run);
        if (result.status !== "applied" && result.status !== "adapted") {
          eventStatus = "error";
          error = result.message ?? `move frame ${result.status}`;
          return;
        }
        lastPoseTime = elapsed;
        if (elapsed >= move.durationSeconds) break;
        const nextDeadline = start + Math.min(move.durationSeconds * 1000, (Math.floor(elapsed * frequency) + 1) * intervalMs);
        if (!(await waitUntil(run, Math.max(Date.now() + 1, nextDeadline)))) {
          eventStatus = "cancelled";
          return;
        }
      }
    } catch (cause) {
      eventStatus = "error";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      emitMoveEvent(uploadId, eventStatus, error);
      if (activeRun === run) activeRun = null;
    }
  }

  async function stopCurrent(reason: string): Promise<boolean> {
    const run = activeRun;
    if (!run) return false;
    cancelRun(run, reason);
    await session.stop(reason);
    return true;
  }

  /** Invalidate this adapter's timers and stop the shared backend immediately. */
  async function stopSession(reason: string): Promise<void> {
    const run = activeRun;
    if (run) cancelRun(run, reason);
    await session.stop(reason);
  }

  function taskFailure(uuid: string, error: string): WireReply {
    const initial = taskProgressMessage(uuid, false, null);
    pushMessage(taskProgressMessage(uuid, true, error));
    return initial;
  }

  function startNamedMoveTask(uuid: string, moveName: string): WireReply {
    if (!session.inspect().capabilities.gestures.includes(moveName)) {
      return taskFailure(uuid, `Named Reachy move '${moveName}' is unsupported by the LOOI bridge`);
    }
    if (virtualMotorMode !== "enabled") {
      return taskFailure(uuid, "Reachy pose commands are disabled; call wake_up or set_motor_mode enabled first");
    }

    const initial = taskProgressMessage(uuid, false, null);
    const run = beginRun("gesture");
    void (async () => {
      let error: string | null = null;
      try {
        if (!isCurrentRun(run)) {
          error = run.cancellationReason ?? "Named Reachy move was cancelled";
        } else {
          // A complete named gesture is longer than a streaming pose frame:
          // LOOI's nod alone waits 810ms, before its BLE writes finish.
          const result = await session.execute({ kind: "gesture", name: moveName }, { ...frameOptions(), ttlMs: 3_000 });
          if (!isCurrentRun(run)) {
            error = run.cancellationReason ?? "Named Reachy move was cancelled";
          } else if (result.status !== "applied" && result.status !== "adapted") {
            error = result.message ?? `LOOI compatibility layer ${result.status} the named Reachy move`;
          }
        }
      } catch (cause) {
        error = !isCurrentRun(run)
          ? run.cancellationReason ?? "Named Reachy move was cancelled"
          : cause instanceof Error ? cause.message : String(cause);
      } finally {
        if (activeRun === run) activeRun = null;
      }
      // Session close invalidates a pending core execution. Its late completion
      // must not leak a final task event into a transport that has ended.
      if (!closed && !session.closed) pushMessage(taskProgressMessage(uuid, true, error));
    })();
    return initial;
  }

  async function disableVirtualMotors(reason: string): Promise<void> {
    // Close the target gate synchronously before yielding to the backend stop.
    virtualMotorMode = "disabled";
    await stopSession(reason);
  }

  async function unsupported(command: string, reason: string): Promise<WireReply> {
    return { error: reason, command, compatibility_status: "unsupported" };
  }

  function handleTaskRequest(request: WireObject): WireReply {
    const rawUuid = request.uuid;
    if (typeof rawUuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUuid)) {
      throw new TypeError("task.uuid must be a UUID string");
    }
    const uuid = rawUuid.toLowerCase();
    if (typeof request.timestamp !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/i.test(request.timestamp)
      || !Number.isFinite(Date.parse(request.timestamp))) {
      throw new TypeError("task.timestamp must be an ISO 8601 datetime string");
    }
    if (!isObject(request.req)) throw new TypeError("task.req must be a GotoTaskRequest or PlayMoveTaskRequest object");
    const req = request.req;

    if (typeof req.move_name === "string") {
      const moveNameLength = Array.from(req.move_name).length;
      if (moveNameLength === 0 || moveNameLength > 200) throw new TypeError("task.req.move_name must contain 1-200 characters");
      return startNamedMoveTask(uuid, req.move_name);
    }

    const targetFields: WireObject = {};
    if (req.head !== undefined && req.head !== null) targetFields.head = flatMatrix(req.head, "task.req.head");
    if (req.antennas !== undefined && req.antennas !== null) targetFields.antennas = pair(req.antennas, "task.req.antennas");
    if (req.body_yaw !== undefined && req.body_yaw !== null) targetFields.body_yaw = finiteNumber(req.body_yaw, "task.req.body_yaw");
    const target = wirePose(targetFields);

    const duration = finiteNumber(req.duration, "task.req.duration");
    if (duration <= 0 || duration > MAX_GOTO_SECONDS) {
      throw new TypeError(`task.req.duration must be greater than 0 and no more than ${MAX_GOTO_SECONDS} seconds`);
    }
    if (typeof req.method !== "string" || !INTERPOLATION_TECHNIQUES.includes(req.method as InterpolationTechnique)) {
      throw new TypeError(`task.req.method must be one of ${INTERPOLATION_TECHNIQUES.join(", ")}`);
    }
    const method = req.method as InterpolationTechnique;
    const run = beginRun("goto");
    void (async () => {
      let error: string | null = null;
      try {
        const result = await animateAndRelease(target, duration * 1000, "task", run, method);
        if (isObject(result) && typeof result.error === "string") error = result.error;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        if (activeRun === run) activeRun = null;
      }
      pushMessage(taskProgressMessage(uuid, true, error));
    })();
    return taskProgressMessage(uuid, false, null);
  }

  async function handleMessage(raw: string | unknown, options?: RobotCommandOptions): Promise<WireReply> {
    let message: unknown = raw;
    if (typeof raw === "string") {
      try {
        message = JSON.parse(raw);
      } catch (cause) {
        return { error: `Invalid JSON command: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    }
    if (!isObject(message) || typeof message.type !== "string" || message.type.length === 0) {
      return { error: "Invalid Reachy command: expected an object with a non-empty string type" };
    }
    const command = message.type;
    if (closed || session.closed) return { error: "Reachy adapter session is closed", command };

    const admissionError = sourceAdmissionError(options);
    if (admissionError) {
      if (command === "task" && typeof message.uuid === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.uuid)) {
        return taskProgressMessage(message.uuid.toLowerCase(), true, admissionError);
      }
      return { error: admissionError, command };
    }

    try {
      switch (command) {
        case "task":
          return handleTaskRequest(message);
        case "set_target": {
          if (message.head === undefined) throw new TypeError("head is required");
          const result = await applyTarget({ head: flatMatrix(message.head) });
          return resultError(result, command);
        }
        case "set_full_target":
        case "set_body_yaw":
        case "set_antennas": {
          const target: WireObject = command === "set_body_yaw"
            ? { body_yaw: message.body_yaw }
            : command === "set_antennas"
              ? { antennas: message.antennas }
              : message;
          const result = await applyTarget(wirePose(target));
          return resultError(result, command);
        }
        case "goto_target": {
          const target = wirePose(message);
          const durationSeconds = message.duration === undefined ? 0.5 : finiteNumber(message.duration, "duration");
          if (durationSeconds <= 0 || durationSeconds > MAX_GOTO_SECONDS) {
            throw new TypeError(`duration must be greater than 0 and no more than ${MAX_GOTO_SECONDS} seconds`);
          }
          const run = beginRun("goto");
          return await animateAndRelease(target, durationSeconds * 1000, command, run);
        }
        case "get_state":
          return { state: statePayload() };
        case "get_version":
          return {
            version: REACHY_WIRE_VERSION,
            adapter_version: REACHY_ADAPTER_VERSION,
            version_origin: REACHY_VERSION_ORIGIN,
            compatibility_origin: "virtual",
            robot_family: "looi",
          };
        case "get_hardware_id":
          return { hardware_id: null, compatibility_origin: "virtual" };
        case "get_imu":
          return { command, imu: null, available: false, reason: "LOOI has no Reachy IMU data source" };
        case "set_motor_mode":
          if (!["enabled", "disabled", "gravity_compensation"].includes(String(message.mode))) {
            throw new TypeError("mode must be enabled, disabled, or gravity_compensation");
          }
          if (message.mode === "gravity_compensation") {
            return {
              error: "LOOI does not support Reachy gravity compensation; physical interaction control is unavailable",
              command,
              compatibility_status: "unsupported",
              motor_mode: virtualMotorMode,
              motor_mode_origin: "virtual",
              hardware_motors_available: false,
            };
          }
          if (message.mode === "disabled") {
            await disableVirtualMotors("Reachy virtual motor mode disabled");
          } else {
            virtualMotorMode = "enabled";
          }
          // Match the pinned daemon's SetMotorModeCmd ack fields. The extra
          // metadata distinguishes this compatibility gate from real torque.
          return {
            motor_mode: virtualMotorMode,
            status: "ok",
            motor_mode_origin: "virtual",
            hardware_motors_available: false,
          };
        case "get_motor_mode":
          return {
            motor_mode: virtualMotorMode,
            motor_mode_origin: "virtual",
            hardware_motors_available: false,
          };
        case "set_torque": {
          if (typeof message.on !== "boolean") throw new TypeError("on must be a boolean");
          if (message.ids !== undefined && message.ids !== null) {
            if (!Array.isArray(message.ids) || !message.ids.every((id) => typeof id === "string")) {
              throw new TypeError("ids must be an array of motor-id strings");
            }
            return await unsupported(command, "LOOI has no Reachy per-joint torque controls");
          }
          if (message.on) virtualMotorMode = "enabled";
          else await disableVirtualMotors("Reachy set_torque off");
          return {
            status: "ok",
            command,
            motor_mode: virtualMotorMode,
            motor_mode_origin: "virtual",
            hardware_motors_available: false,
          };
        }
        case "set_gravity_compensation":
          return await unsupported(command, "LOOI does not expose Reachy gravity-compensation controls");
        case "set_head_joints":
          if (!Array.isArray(message.joints) || message.joints.length !== 7 || !message.joints.every((v) => typeof v === "number" && Number.isFinite(v))) {
            throw new TypeError("joints must contain exactly seven finite numbers");
          }
          return await unsupported(command, "Reachy joint-space targets cannot be mapped without Reachy head kinematics");
        case "wake_up": {
          // This lifecycle state is virtual: enabling opens the adapter's
          // pose-command gate but never asserts physical motor torque.
          virtualMotorMode = "enabled";
          const run = beginRun("goto");
          const reply = await animateAndRelease({ head: IDENTITY, antennas: [0, 0], bodyYaw: 0 }, 500, command, run);
          if (!isObject(reply)) return reply;
          const modeMetadata = {
            motor_mode: virtualMotorMode,
            motor_mode_origin: "virtual",
            hardware_motors_available: false,
          };
          if (typeof reply.error === "string") return { ...reply, ...modeMetadata };
          return { ...reply, completed: true, ...modeMetadata };
        }
        case "goto_sleep": {
          await disableVirtualMotors("Reachy goto_sleep requested");
          return {
            status: "ok",
            command,
            completed: true,
            compatibility_status: "adapted",
            limitations: ["Reachy sleep pose is unavailable; STOP was sent and only virtual pose commands were disabled, with no physical motor torque change"],
            motor_mode: virtualMotorMode,
            motor_mode_origin: "virtual",
            hardware_motors_available: false,
          };
        }
        case "start_recording":
          recording = true;
          records = [];
          firstRecordTime = null;
          lastRecordTime = -Infinity;
          recordingChars = 0;
          return { status: "ok", command, is_recording: true };
        case "append_record":
          if (recording) appendValidatedRecord(message.record);
          return { status: "ok", command };
        case "stop_recording": {
          recording = false;
          const data = records;
          records = [];
          firstRecordTime = null;
          lastRecordTime = -Infinity;
          recordingChars = 0;
          pushMessage({ type: "recorded_data", data });
          return { status: "ok", command, is_recording: false };
        }
        case "upload_move_start": {
          const uploadId = message.upload_id;
          if (typeof uploadId !== "string" || uploadId.length === 0 || uploadId.length > 128) throw new TypeError("upload_id must be a non-empty string of at most 128 characters");
          if (message.encoding !== undefined && message.encoding !== "json") {
            return await unsupported(command, "Only JSON move uploads are supported by the LOOI bridge");
          }
          const totalChunks = finiteNumber(message.total_chunks, "total_chunks");
          if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > Math.floor(MAX_UPLOAD_BYTES / MAX_CHUNK_CHARS)) {
            throw new TypeError("total_chunks is outside the bridge upload limit");
          }
          if (uploadSlots.size + uploadedMoves.size >= MAX_UPLOADS) throw new TypeError("too many pending or stored move uploads");
          const old = uploadSlots.get(uploadId);
          if (old) addUploadBytes(-old.bytes);
          const previousMove = uploadedMoves.get(uploadId);
          if (previousMove) {
            uploadedMoves.delete(uploadId);
            addUploadBytes(-previousMove.bytes);
          }
          uploadSlots.set(uploadId, { totalChunks, nextChunk: 0, chunks: [], bytes: 0 });
          return { status: "ok", command, upload_id: uploadId };
        }
        case "upload_move_chunk": {
          const uploadId = message.upload_id;
          if (typeof uploadId !== "string") throw new TypeError("upload_id must be a string");
          const slot = uploadSlots.get(uploadId);
          if (!slot) throw new TypeError("no pending upload for upload_id");
          const chunkIndex = finiteNumber(message.chunk_index, "chunk_index");
          const chunk = message.chunk;
          if (!Number.isInteger(chunkIndex) || chunkIndex !== slot.nextChunk) throw new TypeError(`chunk_index must be the next expected index (${slot.nextChunk})`);
          if (typeof chunk !== "string" || chunk.length > MAX_CHUNK_CHARS) throw new TypeError(`chunk must be a string no longer than ${MAX_CHUNK_CHARS} characters`);
          const nextBytes = slot.bytes + chunk.length;
          if (nextBytes > MAX_UPLOAD_BYTES || totalUploadBytes + chunk.length > MAX_TOTAL_UPLOAD_BYTES) {
            uploadSlots.delete(uploadId);
            addUploadBytes(-slot.bytes);
            throw new TypeError("move upload exceeds the bridge size limit");
          }
          slot.chunks.push(chunk);
          slot.bytes = nextBytes;
          slot.nextChunk += 1;
          addUploadBytes(chunk.length);
          return { status: "ok", command, upload_id: uploadId, chunk_index: chunkIndex };
        }
        case "upload_move_finish": {
          const uploadId = message.upload_id;
          if (typeof uploadId !== "string") throw new TypeError("upload_id must be a string");
          const slot = uploadSlots.get(uploadId);
          if (!slot) throw new TypeError("no pending upload for upload_id");
          uploadSlots.delete(uploadId);
          addUploadBytes(-slot.bytes);
          if (slot.nextChunk !== slot.totalChunks) throw new TypeError("move upload is missing one or more chunks");
          const serialized = slot.chunks.join("");
          if (serialized.length > MAX_UPLOAD_BYTES) throw new TypeError("move upload exceeds the bridge size limit");
          let parsed: unknown;
          try { parsed = JSON.parse(serialized); }
          catch (cause) { throw new TypeError(`move upload is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
          const move = validateUploadedMove(parsed);
          move.bytes = serialized.length;
          uploadedMoves.set(uploadId, move);
          totalUploadBytes += serialized.length;
          if (totalUploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
            uploadedMoves.delete(uploadId);
            addUploadBytes(-move.bytes);
            throw new TypeError("stored move uploads exceed the bridge size limit");
          }
          return { status: "ok", command, upload_id: uploadId };
        }
        case "play_uploaded_move": {
          if (virtualMotorMode !== "enabled") throw new Error("Reachy pose commands are disabled; call wake_up or set_motor_mode enabled first");
          const uploadId = message.upload_id;
          if (typeof uploadId !== "string") throw new TypeError("upload_id must be a string");
          const move = uploadedMoves.get(uploadId);
          if (!move) throw new TypeError("no such uploaded move (upload first)");
          if (activeRun && !activeRun.cancelled) throw new TypeError("another Reachy motion is already running");
          const frequency = message.play_frequency === undefined ? 100 : finiteNumber(message.play_frequency, "play_frequency");
          if (frequency <= 0 || frequency > 200) throw new TypeError("play_frequency must be greater than 0 and no more than 200 Hz");
          const initialGotoDuration = message.initial_goto_duration === undefined ? 0 : finiteNumber(message.initial_goto_duration, "initial_goto_duration");
          if (initialGotoDuration < 0 || initialGotoDuration > MAX_GOTO_SECONDS) throw new TypeError(`initial_goto_duration must be between 0 and ${MAX_GOTO_SECONDS} seconds`);
          if (message.audio_lead_ms !== undefined && finiteNumber(message.audio_lead_ms, "audio_lead_ms") !== 0) {
            // The motion still plays; the audio timing value has no meaning
            // without the unsupported uploaded-audio channel.
            pushMessage({ type: "compatibility_warning", command, upload_id: uploadId, limitation: "audio_lead_ms ignored because Reachy audio uploads are unsupported" });
          }
          uploadedMoves.delete(uploadId);
          addUploadBytes(-move.bytes);
          const run = beginRun("uploaded", uploadId);
          const effectiveFrequency = Math.min(frequency, MAX_PLAYBACK_FREQUENCY_HZ);
          pushMessage({
            type: "play_uploaded_move",
            upload_id: uploadId,
            started: true,
            duration_s: move.durationSeconds + initialGotoDuration,
            has_audio: false,
            compatibility_status: frequency > effectiveFrequency ? "adapted" : "virtual",
            ...(frequency > effectiveFrequency ? { limitations: [`playback frequency capped at ${effectiveFrequency} Hz`] } : {}),
          });
          void runUploadedMove(uploadId, move, run, initialGotoDuration, effectiveFrequency);
          return null;
        }
        case "cancel_move": {
          const uploadId = message.upload_id;
          if (typeof uploadId !== "string") throw new TypeError("upload_id must be a string");
          const run = activeRun;
          if (!run || run.kind !== "uploaded" || run.uploadId !== uploadId) return null;
          cancelRun(run, "uploaded move cancelled");
          await session.stop("Reachy uploaded move cancelled");
          return null;
        }
        case "stop_move": {
          const stopped = await stopCurrent("Reachy stop_move requested");
          return { status: "ok", command, stopped, ...(!stopped ? { info: "no motion was running" } : {}) };
        }
        case "subscribe_pose":
          poseSubscribed = true;
          return { status: "ok", command };
        case "unsubscribe_pose":
          poseSubscribed = false;
          return { status: "ok", command };
        case "set_volume": {
          const volume = audioVolumePercent(message.volume, "volume");
          if (dependencies.media?.audio) {
            const result = await dependencies.media.audio.setGain("speaker", volume);
            outputVolume = audioVolumePercent(result.percent, "volume");
            return { status: "ok", command, volume: outputVolume };
          }
          const result = await session.execute({ kind: "volume", value: volume }, options);
          if (result.status === "applied" || result.status === "adapted") outputVolume = volume;
          return { ...(resultError(result, command) ?? {}), volume: outputVolume };
        }
        case "get_volume": {
          if (!dependencies.media?.audio) return { command, volume: outputVolume };
          const result = await dependencies.media.audio.getGain("speaker");
          outputVolume = audioVolumePercent(result.percent, "volume");
          return { command, volume: outputVolume };
        }
        case "set_microphone_volume": {
          const volume = audioVolumePercent(message.volume, "volume");
          if (!dependencies.media?.audio) {
            return { error: "LOOI microphone volume control is unavailable in this app session", command, compatibility_status: "unavailable" };
          }
          const result = await dependencies.media.audio.setGain("microphone", volume);
          return { status: "ok", command, volume: audioVolumePercent(result.percent, "volume") };
        }
        case "get_microphone_volume": {
          if (!dependencies.media?.audio) {
            return { error: "LOOI microphone volume control is unavailable in this app session", command, compatibility_status: "unavailable" };
          }
          const result = await dependencies.media.audio.getGain("microphone");
          return { command, volume: audioVolumePercent(result.percent, "volume") };
        }
        case "play_sound": {
          if (typeof message.file !== "string") throw new TypeError("file must be a string");
          const tag = reachySoundTag(message.file);
          if (!tag) return await unsupported(command, "LOOI does not have that built-in Reachy sound");
          if (!dependencies.media?.sound) {
            return { error: "LOOI app sound service is unavailable in this session", command, compatibility_status: "unavailable" };
          }
          const result = await dependencies.media.sound.play(tag);
          if (!result.accepted) {
            return {
              error: result.reason ?? "LOOI could not play the built-in sound",
              command,
              compatibility_status: "unavailable",
            };
          }
          return { status: "ok", command, sound_origin: "looi-synthesized" };
        }
        case "get_robot_name":
          return { command, name: "LOOI", compatibility_origin: "virtual" };
        case "get_tracked_face":
          return { command, face_target: null, available: session.inspect().capabilities.media.camera, reason: "Reachy face tracking is not implemented by the LOOI bridge" };
        case "set_head_tracking":
          if (typeof message.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
          return await unsupported(command, "Reachy head tracking requires a Reachy-compatible camera pipeline");
        case "play_recorded_move":
        case "preload_dataset":
        case "upload_audio_start":
        case "upload_audio_chunk":
        case "upload_audio_finish":
        case "play_uploaded_audio":
        case "cancel_audio":
        case "clear_incoming_audio":
          return await unsupported(command, "Reachy audio playback or microphone control is not available through the LOOI robot session");
        case "set_automatic_body_yaw":
          return await unsupported(command, "Reachy automatic body-yaw control has no LOOI equivalent");
        case "set_speech_offsets":
        case "set_wobbling":
          return await unsupported(command, "Reachy media-driven head motion is unavailable on the LOOI bridge");
        case "start_update":
          if (Object.hasOwn(message, "pre_release") && typeof message.pre_release !== "boolean") {
            throw new TypeError("pre_release must be a boolean");
          }
          return { error: "My LOOI updates are managed by the app update system", command };
        case "restart_daemon":
        case "subscribe_logs":
        case "unsubscribe_logs":
        case "set_robot_name":
        case "delete_hf_token":
        case "get_first_wake_up":
        case "set_first_wake_up":
        case "get_telemetry":
        case "set_telemetry":
        case "apply_audio_config":
        case "read_audio_parameter":
          return await unsupported(command, `Reachy daemon service '${command}' is not implemented by the LOOI bridge`);
        default:
          return await unsupported(command, `Unknown Reachy command '${command}'`);
      }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : String(cause),
        command,
      };
    }
  }

  return {
    setTarget: applyPublicTarget,
    async gotoTarget(target, options) {
      const admissionError = sourceAdmissionError(options);
      if (admissionError) return { error: admissionError, command: "goto_target" };
      if (!isObject(target)) throw new TypeError("target must be an object");
      const pose = wirePose(target as WireObject);
      const duration = finiteNumber(target.duration, "duration");
      if (duration <= 0 || duration > MAX_GOTO_SECONDS) throw new TypeError(`duration must be greater than 0 and no more than ${MAX_GOTO_SECONDS} seconds`);
      const run = beginRun("goto");
      return animateAndRelease(pose, duration * 1000, "goto_target", run);
    },
    setHeadRpyDeg(roll, pitch, yaw, options) {
      return applyPublicTarget({ head: rpyToMatrix(finiteNumber(roll, "roll"), finiteNumber(pitch, "pitch"), finiteNumber(yaw, "yaw")) }, options);
    },
    setAntennasDeg(right, left, options) {
      return applyPublicTarget({ antennas: [rad(finiteNumber(right, "right")), rad(finiteNumber(left, "left"))] }, options);
    },
    setBodyYawDeg(yaw, options) {
      return applyPublicTarget({ body_yaw: rad(finiteNumber(yaw, "yaw")) }, options);
    },
    handleMessage,
    snapshot: buildSnapshot,
    initialMessages() {
      const state = session.inspect();
      return [{
        type: "daemon_status",
        robot_name: "LOOI",
        state: state.observed.connected ? "running" : "stopped",
        wireless_version: false,
        desktop_app_daemon: false,
        simulation_enabled: null,
        mockup_sim_enabled: null,
        no_media: !state.capabilities.media.camera && !state.capabilities.media.microphone && !state.capabilities.media.speaker,
        media_released: false,
        camera_specs_name: "",
        backend_status: null,
        error: null,
        wlan_ip: null,
        version: REACHY_WIRE_VERSION,
        adapter_version: REACHY_ADAPTER_VERSION,
        version_origin: REACHY_VERSION_ORIGIN,
        hardware_id: null,
        face_target: { detected: false },
        compatibility_origin: "virtual",
        robot_family: "looi",
      }, ...pythonSdkPoseMessages()];
    },
    pollMessages() {
      return pythonSdkPoseMessages();
    },
    takeMessages() {
      const pending = outgoingMessages.splice(0, outgoingMessages.length);
      return pending;
    },
    wantsPoseStream() {
      return poseSubscribed;
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (activeRun) cancelRun(activeRun, "Reachy adapter closed");
      await session.close("Reachy adapter closed");
    },
  };
}
