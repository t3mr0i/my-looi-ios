/** Robot-neutral contract. Distances use metres, angles radians, times milliseconds. */
export type Matrix4 = readonly number[];
export type RobotPose = {
  /** Row-major homogeneous transform, in the robot's world frame. */
  head?: Matrix4;
  antennas?: readonly [number, number];
  bodyYaw?: number;
};

export type RobotCommand =
  | { kind: "target"; pose: RobotPose; durationMs?: number }
  | { kind: "drive"; forward: number; lateral: number; yawRate: number; durationMs: number }
  | { kind: "gesture"; name: string }
  | { kind: "light"; enabled: boolean }
  | { kind: "volume"; value: number };

export type RobotCapabilities = {
  schemaVersion: 1;
  locomotion: {
    forward: boolean;
    lateral: boolean;
    yaw: boolean;
    simultaneous: boolean;
    calibratedVelocity: boolean;
    odometry: boolean;
  };
  pose: {
    head: "none" | "quantized" | "continuous";
    headTranslation: boolean;
    headRoll: boolean;
    headYaw: boolean;
    antennas: boolean;
    bodyYaw: "none" | "estimated" | "measured";
  };
  gestures: readonly string[];
  light: boolean;
  media: { camera: boolean; microphone: boolean; speaker: boolean; volume: boolean };
};

export type RobotObservedState = {
  connected: boolean;
  moving: boolean;
  /** Null is unknown, never zero or the last requested pose. */
  measuredPose: RobotPose | null;
  measuredVelocity: { forward: number; lateral: number; yawRate: number } | null;
  safetyReason: string | null;
};

export type RobotExecution = {
  status: "applied" | "adapted" | "unsupported" | "cancelled" | "rejected";
  limitations: string[];
  applied?: RobotCommand;
  message?: string;
};

export type RobotExecutionContext = {
  signal: AbortSignal;
  /** Must be checked after every await and immediately before physical actuation. */
  isCurrent(): boolean;
  allowApproximation: boolean;
};

export interface RobotBackend {
  readonly id: string;
  readonly capabilities: RobotCapabilities;
  inspect(): RobotObservedState;
  execute(command: RobotCommand, context: RobotExecutionContext): Promise<RobotExecution>;
  /** Out-of-band cancellation: must not wait behind a pending execute. */
  stop(reason: string): Promise<void>;
}

export type RobotCommandOptions = {
  /** Strictly increasing per channel; transports should preserve source ordering. */
  sequence?: number;
  /** Admission lifetime, bounded by the core; queued commands keep their original deadline. */
  ttlMs?: number;
};

export type RobotResult = RobotExecution & { sessionId: string; commandId: number };

export type RobotSnapshot = {
  schemaVersion: 1;
  backend: string;
  capabilities: RobotCapabilities;
  sessionId: string | null;
  active: boolean;
  /** Increases synchronously on STOP, suspension, close and deadline cancellation. */
  generation: number;
  /** Compatibility model only. It does not describe measured LOOI hardware. */
  virtualPose: RobotPose;
  observed: RobotObservedState;
  lastResult: RobotResult | null;
};

export interface RobotSession {
  readonly id: string;
  readonly closed: boolean;
  execute(command: RobotCommand, options?: RobotCommandOptions): Promise<RobotResult>;
  stop(reason?: string): Promise<void>;
  close(reason?: string): Promise<void>;
  inspect(): RobotSnapshot;
  subscribe(listener: (state: RobotSnapshot) => void): () => void;
}

export interface RobotCore {
  openSession(options?: { id?: string; allowApproximation?: boolean }): RobotSession;
  stop(reason?: string): Promise<void>;
  setActive(active: boolean): Promise<void>;
  inspect(): RobotSnapshot;
  subscribe(listener: (state: RobotSnapshot) => void): () => void;
  dispose(): Promise<void>;
}

export const IDENTITY_HEAD: readonly number[] = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
