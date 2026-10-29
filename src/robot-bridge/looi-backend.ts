import {
  driveLooiForDuration,
  getLooiRobotRuntimeState,
  LOOI_DRIVE_DURATION_LIMITS,
  performLooiHeadGesture,
  setLooiHead,
  setLooiLight,
  stopLooiMotion,
  type LooiHeadMotionOptions,
  type LooiMotionOptions,
} from "../device-tools/looi-robot";
import {
  type RobotBackend,
  type RobotCapabilities,
  type RobotCommand,
  type RobotExecution,
  type RobotExecutionContext,
  type RobotObservedState,
  type RobotPose,
} from "./types";

export const LOOI_SUPPORTED_GESTURES = Object.freeze([
  "nod",
  "curious",
  "happy_bob",
  "sleepy",
  "thinking",
  "speaking_soft",
] as const);

type LooiDriveDirection = "forward" | "back" | "left" | "right";
type LooiHeadDirection = "up" | "center" | "down";
type LooiControllerResult = { ok?: boolean; completed?: boolean; durationMs?: number };
type LooiRuntimeState = ReturnType<typeof getLooiRobotRuntimeState>;

/** Narrow controller seam so the backend can be tested without a BLE device. */
export type LooiBackendDependencies = {
  inspect(): Pick<LooiRuntimeState, "connected" | "motionActive" | "safety">;
  drive(direction: LooiDriveDirection, durationMs: number, options: LooiMotionOptions): Promise<LooiControllerResult>;
  setHead(direction: LooiHeadDirection, options: LooiHeadMotionOptions): Promise<LooiControllerResult>;
  performHeadGesture(name: string, repetitions: number, options: LooiHeadMotionOptions): Promise<LooiControllerResult>;
  setLight(enabled: boolean, options: LooiMotionOptions): Promise<LooiControllerResult>;
  stop(reason: string): Promise<void>;
};

const DEFAULT_DEPENDENCIES: LooiBackendDependencies = {
  inspect: getLooiRobotRuntimeState,
  drive: driveLooiForDuration,
  setHead: setLooiHead,
  performHeadGesture: performLooiHeadGesture,
  setLight: setLooiLight,
  stop: stopLooiMotion,
};

const LOOI_CAPABILITIES = Object.freeze({
  schemaVersion: 1,
  locomotion: {
    forward: true,
    lateral: false,
    yaw: true,
    simultaneous: false,
    calibratedVelocity: false,
    odometry: false,
  },
  pose: {
    head: "quantized",
    headTranslation: false,
    headRoll: false,
    headYaw: false,
    antennas: false,
    bodyYaw: "none",
  },
  gestures: LOOI_SUPPORTED_GESTURES,
  light: true,
  media: { camera: false, microphone: false, speaker: false, volume: false },
} satisfies RobotCapabilities);

const EPSILON = 1e-5;
const PITCH_QUANTIZATION_DEAD_ZONE = 0.12;
const SIMULTANEOUS_MIN_DURATION_MS = LOOI_DRIVE_DURATION_LIMITS.minimumMs * 2;
const MIN_HEAD_WRITE_INTERVAL_MS = 120;
const HEAD_REFRESH_WINDOW_MS = 240;
const HEAD_RATE_LIMIT_POLL_MS = 10;

function nearZero(value: number): boolean {
  return Math.abs(value) <= EPSILON;
}

function contextIsCurrent(context: RobotExecutionContext, backendGeneration: number, generation: () => number): boolean {
  if (backendGeneration !== generation() || context.signal.aborted) return false;
  try {
    return context.isCurrent();
  } catch {
    return false;
  }
}

function cancelled(): RobotExecution {
  return { status: "cancelled", limitations: [], message: "Command was cancelled before completion." };
}

function unsupported(message: string, limitations: string[] = []): RobotExecution {
  return { status: "unsupported", limitations, message };
}

function rejected(error: unknown): RobotExecution {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "LooiMotionCancelledError") {
    return { status: "cancelled", limitations: [], message };
  }
  return { status: "rejected", limitations: [], message };
}

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

type PoseAnalysis = {
  headDirection: LooiHeadDirection | null;
  pitch: number;
  unsupportedAxes: string[];
  malformed: string | null;
};

/** Extract pitch from a row-major homogeneous 4x4 transform (Z-up robot frame). */
function analyzePose(pose: RobotPose): PoseAnalysis {
  const unsupportedAxes: string[] = [];
  let headDirection: LooiHeadDirection | null = null;
  let pitch = 0;
  let malformed: string | null = null;

  if (pose.head !== undefined) {
    const matrix = pose.head;
    if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
      malformed = "head pose must be a finite row-major 4x4 matrix";
    } else {
      if (!nearZero(matrix[3]) || !nearZero(matrix[7]) || !nearZero(matrix[11])) unsupportedAxes.push("head translation");
      if (!nearZero(matrix[12]) || !nearZero(matrix[13]) || !nearZero(matrix[14]) || Math.abs(matrix[15] - 1) > EPSILON) {
        malformed = "head pose must use a homogeneous final row [0, 0, 0, 1]";
      }

      const sinePitch = Math.max(-1, Math.min(1, -matrix[8]));
      pitch = Math.asin(sinePitch);
      const yaw = Math.atan2(matrix[4], matrix[0]);
      const roll = Math.atan2(matrix[9], matrix[10]);
      if (Math.abs(yaw) > EPSILON) unsupportedAxes.push("head yaw");
      if (Math.abs(roll) > EPSILON) unsupportedAxes.push("head roll");
      if (Math.abs(pitch) < PITCH_QUANTIZATION_DEAD_ZONE) headDirection = "center";
      else headDirection = pitch > 0 ? "down" : "up";
    }
  }

  if (pose.antennas && (Math.abs(pose.antennas[0]) > EPSILON || Math.abs(pose.antennas[1]) > EPSILON)) {
    unsupportedAxes.push("antennas");
  }
  if (pose.bodyYaw !== undefined && !nearZero(pose.bodyYaw)) unsupportedAxes.push("body yaw");

  return { headDirection, pitch, unsupportedAxes, malformed };
}

function contextOptions(context: RobotExecutionContext, backendGeneration: number, generation: () => number) {
  const isCurrent = () => contextIsCurrent(context, backendGeneration, generation);
  return { isCurrent };
}

export function createLooiBackend(dependencies: LooiBackendDependencies = DEFAULT_DEPENDENCIES): RobotBackend {
  let stopGeneration = 0;
  let lastHeadDirection: LooiHeadDirection | null = null;
  let lastHeadWriteAt = -Infinity;
  let headCommandQueue: Promise<unknown> = Promise.resolve();
  const currentGeneration = () => stopGeneration;

  function queueHeadCommand<T>(command: () => Promise<T>): Promise<T> {
    const queued = headCommandQueue.then(command, command);
    headCommandQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  const backend: RobotBackend = {
    id: "looi",
    capabilities: LOOI_CAPABILITIES,

    inspect(): RobotObservedState {
      const runtime = dependencies.inspect();
      return {
        connected: runtime.connected,
        moving: runtime.motionActive,
        measuredPose: null,
        measuredVelocity: null,
        safetyReason: runtime.safety.lastMotionBlockReason ??
          (runtime.safety.lastSafetyStopReason === "cliff" || runtime.safety.lastSafetyStopReason === "obstacle"
            ? runtime.safety.lastSafetyStopReason
            : null),
      };
    },

    async execute(command, context): Promise<RobotExecution> {
      const generation = stopGeneration;
      const isCurrent = () => contextIsCurrent(context, generation, currentGeneration);
      if (!isCurrent()) return cancelled();
      const guardedOptions = contextOptions(context, generation, currentGeneration);

      try {
        if (command.kind === "target") {
          const analysis = analyzePose(command.pose);
          if (analysis.malformed) return { status: "rejected", limitations: [], message: analysis.malformed };
          const headPitchNeedsApproximation = analysis.headDirection !== null && !nearZero(analysis.pitch);
          if (!context.allowApproximation && (analysis.unsupportedAxes.length > 0 || headPitchNeedsApproximation)) {
            return unsupported(
              "LOOI only supports three named head positions and cannot express the requested pose precisely.",
              [...analysis.unsupportedAxes, ...(headPitchNeedsApproximation ? ["quantized head pitch"] : [])],
            );
          }
          if (analysis.headDirection === null) {
            if (!context.allowApproximation) {
              return unsupported(
                "The requested pose has no axis that LOOI can actuate.",
                [...analysis.unsupportedAxes, "no LOOI actuator for this target"],
              );
            }
            return {
              status: "adapted",
              limitations: [...analysis.unsupportedAxes, "virtual target only; no LOOI actuator"],
            };
          }

          const limitations = [...analysis.unsupportedAxes];
          if (headPitchNeedsApproximation) limitations.push("head pitch was quantized to up/center/down");
          const direction = analysis.headDirection;
          const headOutcome = await queueHeadCommand(async () => {
            if (!isCurrent()) return { kind: "cancelled" as const };
            const now = Date.now();
            if (lastHeadDirection === direction && now - lastHeadWriteAt < HEAD_REFRESH_WINDOW_MS) {
              return { kind: "coalesced" as const };
            }

            let rateLimited = false;
            while (Date.now() - lastHeadWriteAt < MIN_HEAD_WRITE_INTERVAL_MS) {
              if (!isCurrent()) return { kind: "cancelled" as const };
              const remaining = MIN_HEAD_WRITE_INTERVAL_MS - (Date.now() - lastHeadWriteAt);
              await new Promise<void>((resolve) => setTimeout(resolve, Math.min(HEAD_RATE_LIMIT_POLL_MS, remaining)));
              if (!isCurrent()) return { kind: "cancelled" as const };
              rateLimited = true;
            }
            if (!isCurrent()) return { kind: "cancelled" as const };

            let result: LooiControllerResult;
            try {
              result = await dependencies.setHead(direction, guardedOptions);
            } finally {
              // Start the next physical write's spacing window after this
              // attempt settles, even if cancellation raced with the BLE write.
              lastHeadWriteAt = Date.now();
              lastHeadDirection = null;
            }
            if (result.completed === false || result.ok === false) return { kind: "cancelled" as const };
            lastHeadDirection = direction;
            if (!isCurrent()) return { kind: "cancelled" as const };
            return { kind: "written" as const, rateLimited };
          });
          if (headOutcome.kind === "cancelled") return cancelled();
          if (headOutcome.kind === "coalesced") {
            limitations.push("repeated quantized head direction was coalesced within the 240ms refresh window");
          } else if (headOutcome.rateLimited) {
            limitations.push("physical head writes were rate-limited to at least 120ms apart");
          }
          return {
            status: limitations.length > 0 ? "adapted" : "applied",
            limitations,
            ...(limitations.length === 0 ? { applied: command } : {}),
          };
        }

        if (command.kind === "drive") {
          const { forward, lateral, yawRate, durationMs } = command;
          if (![forward, lateral, yawRate].every(Number.isFinite) || !validDuration(durationMs)) {
            return { status: "rejected", limitations: [], message: "Drive values must be finite and duration must be finite and nonnegative." };
          }
          if (lateral !== 0) return unsupported("LOOI cannot move laterally.", ["lateral axis"]);
          const hasForward = forward !== 0;
          const hasYaw = yawRate !== 0;
          if (!hasForward && !hasYaw) {
            if (!isCurrent()) return cancelled();
            await dependencies.stop("robot-bridge-zero-drive");
            if (!isCurrent()) return cancelled();
            return { status: "applied", limitations: [] };
          }
          if (durationMs === 0) {
            if (!isCurrent()) return cancelled();
            await dependencies.stop("robot-bridge-zero-duration");
            if (!isCurrent()) return cancelled();
            return { status: "applied", limitations: [] };
          }
          if (!context.allowApproximation) {
            return unsupported("LOOI drive is directional and time-bounded; it has no calibrated SI velocity.", ["uncalibrated velocity"]);
          }

          const limitations = ["requested SI velocity magnitudes and translation-to-yaw ratio were ignored; nonzero axes map to fixed directions and TTL, with no velocity or odometry measured"];
          const clampedDuration = Math.max(
            LOOI_DRIVE_DURATION_LIMITS.minimumMs,
            Math.min(LOOI_DRIVE_DURATION_LIMITS.maximumMs, Math.round(durationMs)),
          );
          if (clampedDuration !== Math.round(durationMs)) limitations.push("duration was clamped to LOOI's safe drive range");
          const directions: LooiDriveDirection[] = [];
          if (hasForward) directions.push(forward > 0 ? "forward" : "back");
          if (hasYaw) directions.push(yawRate > 0 ? "left" : "right");
          if (directions.length > 1) {
            if (clampedDuration < SIMULTANEOUS_MIN_DURATION_MS) {
              return unsupported("A simultaneous drive request needs at least 160 ms to serialize safely.", ["simultaneous axes"]);
            }
            limitations.push("simultaneous translation and yaw were serialized into two half-duration moves");
          }
          for (let index = 0; index < directions.length; index += 1) {
            if (!isCurrent()) return cancelled();
            const stepDuration = directions.length > 1
              ? Math.floor(clampedDuration / 2)
              : clampedDuration;
            const result = await dependencies.drive(directions[index]!, stepDuration, guardedOptions);
            if (!isCurrent()) return cancelled();
            if (result.completed === false || result.ok === false) return cancelled();
          }
          return { status: "adapted", limitations };
        }

        if (command.kind === "gesture") {
          if (!(LOOI_SUPPORTED_GESTURES as readonly string[]).includes(command.name)) {
            return unsupported(`LOOI does not support the gesture "${command.name}".`);
          }
          const result = await queueHeadCommand(async () => {
            if (!isCurrent()) return { ok: false, completed: false };
            try {
              return await dependencies.performHeadGesture(command.name, 1, guardedOptions);
            } finally {
              // A gesture moves through multiple positions; force the next
              // target stream to refresh instead of deduplicating stale state.
              lastHeadDirection = null;
              lastHeadWriteAt = Date.now();
            }
          });
          if (!isCurrent()) return cancelled();
          if (result.completed === false || result.ok === false) return cancelled();
          return { status: "applied", limitations: [], applied: command };
        }

        if (command.kind === "light") {
          if (!isCurrent()) return cancelled();
          const result = await dependencies.setLight(command.enabled, guardedOptions);
          if (!isCurrent()) return cancelled();
          if (result.completed === false || result.ok === false) return cancelled();
          return { status: "applied", limitations: [], applied: command };
        }

        if (command.kind === "volume") return unsupported("LOOI backend does not control speaker volume.", ["volume"]);
        return unsupported("LOOI backend does not support this command.");
      } catch (error) {
        if (!isCurrent() || (error instanceof Error && error.name === "LooiMotionCancelledError")) return cancelled();
        return rejected(error);
      }
    },

    async stop(reason: string): Promise<void> {
      stopGeneration += 1;
      lastHeadDirection = null;
      await dependencies.stop(reason);
    },
  };

  return backend;
}

