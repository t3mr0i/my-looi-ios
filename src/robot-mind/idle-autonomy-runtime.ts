/**
 * Runs LOOI's idle life: ticks the pure state machine, executes its single
 * bounded action through the existing motion primitives and reports back what
 * happened. Every dependency is injected so the same code runs against the
 * real controller and mock transport in tests; production wiring lives in
 * idle-autonomy-install.ts.
 */
import type { RobotActivityMode, RobotBodyState, RobotBodyStateStore } from "./body-state";
import {
  assessIdleSurface,
  createIdleAutonomy,
  IDLE_AUTONOMY_MODES,
  isWheelAction,
  type IdleAutonomyAction,
  type IdleAutonomyFacts,
  type IdleAutonomyLevel,
  type IdleAutonomyOutcome,
  type IdleCameraRequest,
  type IdleHeadPosition,
  type IdleMotionLayerSnapshot,
} from "./idle-autonomy";

export const IDLE_AUTONOMY_TICK_MS = 500;
/** The local STOP decoder stays armed this much longer than the wheel action itself. */
export const STOP_ARM_MARGIN_MS = 1_500;
/** A STOP this soon after an autonomous wheel action is treated as aimed at it. */
export const STOP_EPISODE_GRACE_MS = 5_000;
export const AMBIENT_HOLD_MS = 4_000;
const AMBIENT_HOLD_REFRESH_MS = 2_000;
/**
 * Between steps of a search or approach no wheel moves, so the STOP decoder is
 * not fed. Any sustained speech-level sound in that gap ends the episode. RMS
 * of float PCM in [-1, 1]; untuned on the device, deliberately low.
 */
export const VOICE_GUARD_RMS = 0.02;
export const VOICE_GUARD_LOUD_CHUNKS = 2;
export const VOICE_GUARD_SETTLE_MS = 600;
/** Stop reasons that come from a person or an explicit stop control. */
const USER_STOP_REASON = /stop|emergency/i;
const FOREIGN_ACTIVITY_MODES: readonly RobotActivityMode[] = ["sleeping", "conversation", "commanded_motion"];

type Completion = Promise<{ completed?: boolean; ok?: boolean }>;

export interface IdleAutonomyMotionPort {
  getState(): IdleMotionLayerSnapshot;
  subscribe(listener: () => void): () => void;
  drive(direction: "forward" | "left" | "right", durationMs: number, options: { isCurrent: () => boolean }): Completion;
  setHead(position: IdleHeadPosition, isCurrent: () => boolean): Completion;
  headGesture(gesture: "curious" | "thinking", isCurrent: () => boolean): Completion;
}

export interface IdleStopListenerPort {
  /** Microphone PCM is flowing into the local wake/command path right now. */
  isLive(): boolean;
  /** Prepare and arm the local STOP decoder for one wheel action; false if it cannot be armed. */
  arm(reason: string, durationMs: number): Promise<boolean>;
  disarm(reason: string): Promise<void>;
  subscribeSamples(listener: (samples: ArrayLike<number>) => void): () => void;
}

export interface IdleCameraPort {
  /** The user enabled camera attention and the camera may be used now. */
  available(): boolean;
  /** Keep the camera looking for faces without arming any camera-driven motion. Called repeatedly; idempotent. */
  request(): void;
  release(): void;
  bodyMotionInFlight(): boolean;
  holdMotion(durationMs: number): void;
}

export interface IdleAutonomyRuntimeDeps {
  bodyState: RobotBodyStateStore;
  now(): number;
  random(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  getLevel(): IdleAutonomyLevel;
  /** The owner confirmed on the robot that it stops by itself when the link drops mid-movement. */
  linkLossSelfStopConfirmed(): boolean;
  /** App-level reasons to stay still (conversation, background, sleep, driving session, robot app...). */
  getYieldReason(): string | null;
  /** Human interactions such as touch, speech or a robot-bridge command. */
  subscribeInteractions(listener: (source: string) => void): () => void;
  motion: IdleAutonomyMotionPort;
  stopListener: IdleStopListenerPort;
  camera: IdleCameraPort;
  ambient: { busy(): boolean; hold(durationMs: number, source: string): void };
  log(event: string, details?: Record<string, string | number | boolean | null | undefined>): void;
}

export function createIdleAutonomyRuntime(deps: IdleAutonomyRuntimeDeps) {
  const machine = createIdleAutonomy({ random: deps.random, startedAt: deps.now() });
  let running = false;
  let timer: unknown = null;
  let token = 0;
  let inFlight: { token: number; action: IdleAutonomyAction } | null = null;
  let lastStopGeneration: number | null = null;
  let nearEdge = { front: false, rear: false };
  let lastInteractionAt: number | null = null;
  let lastWheelEndedAt = Number.NEGATIVE_INFINITY;
  let camera: IdleCameraRequest = "off";
  let lastAmbientHoldAt = Number.NEGATIVE_INFINITY;
  let loudChunks = 0;
  let unsubscribeSamples: (() => void) | null = null;
  let subscriptions: Array<() => void> = [];
  let lastWaitReason = "";

  const bodyYieldReason = (body: RobotBodyState): string | null =>
    FOREIGN_ACTIVITY_MODES.includes(body.activity.mode) ? `body-${body.activity.mode}` : null;

  const yieldReason = (): string | null => {
    const reason = deps.getYieldReason();
    if (reason) return reason;
    return bodyYieldReason(deps.bodyState.getState());
  };

  const abortReason = (): string | null => {
    if (!running) return "stopped";
    if (deps.getLevel() === "off") return "level-off";
    if (machine.getSnapshot().stopLock) return "stop-lock";
    if (!deps.motion.getState().connected) return "disconnected";
    return yieldReason();
  };

  const abortInFlight = () => { token += 1; };

  const observeMotionLayer = () => {
    const robot = deps.motion.getState();
    const now = deps.now();
    if (lastStopGeneration === null) lastStopGeneration = robot.stopGeneration;
    else if (robot.stopGeneration !== lastStopGeneration) {
      lastStopGeneration = robot.stopGeneration;
      const reason = robot.safety.lastSafetyStopReason ?? "unknown";
      if (reason === "cliff") {
        machine.noteEdge(robot.nearEdge.rear && !robot.nearEdge.front ? "rear" : "front", now);
        deps.log("edge-stop", { reason });
      } else if (reason === "obstacle") {
        machine.noteObstacle(now);
        deps.log("obstacle-stop", { reason });
      } else {
        const mode = machine.getSnapshot().mode;
        const ownsWheels = (inFlight !== null && isWheelAction(inFlight.action)) ||
          mode === "seeking_person" || mode === "approaching" ||
          now - lastWheelEndedAt < STOP_EPISODE_GRACE_MS;
        if (ownsWheels || USER_STOP_REASON.test(reason)) {
          machine.lockAfterStop(reason);
          abortInFlight();
          deps.log("stopped-for-good", { reason, ownsWheels });
        } else {
          machine.noteYield(now);
        }
      }
    }
    if (robot.nearEdge.front && !nearEdge.front) machine.noteEdge("front", now);
    if (robot.nearEdge.rear && !nearEdge.rear) machine.noteEdge("rear", now);
    nearEdge = { front: robot.nearEdge.front, rear: robot.nearEdge.rear };
  };

  const applyMode = (mode: RobotActivityMode) => {
    const current = deps.bodyState.getState().activity.mode;
    if (current === mode) return;
    // Conversation, sleep and commanded motion belong to the body-sense layer.
    if (!(IDLE_AUTONOMY_MODES as readonly string[]).includes(current)) return;
    deps.bodyState.update({ activity: { mode, since: deps.now() } }, "idle-autonomy");
  };

  const applyCamera = (request: IdleCameraRequest) => {
    if (request === "off") {
      if (camera !== "off") deps.camera.release();
    } else {
      deps.camera.request();
    }
    camera = request;
  };

  const onSamples = (samples: ArrayLike<number>) => {
    if (!running || inFlight || samples.length === 0) return;
    if (deps.now() - lastWheelEndedAt < VOICE_GUARD_SETTLE_MS) return;
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) sum += samples[index]! * samples[index]!;
    const rms = Math.sqrt(sum / samples.length);
    loudChunks = rms >= VOICE_GUARD_RMS ? loudChunks + 1 : 0;
    if (loudChunks < VOICE_GUARD_LOUD_CHUNKS) return;
    loudChunks = 0;
    machine.noteYield(deps.now());
    deps.log("voice-nearby", { rms: Math.round(rms * 1000) / 1000 });
  };

  const applyVoiceGuard = (mode: RobotActivityMode) => {
    const wanted = mode === "seeking_person" || mode === "approaching";
    if (wanted && !unsubscribeSamples) unsubscribeSamples = deps.stopListener.subscribeSamples(onSamples);
    if (!wanted && unsubscribeSamples) {
      unsubscribeSamples();
      unsubscribeSamples = null;
      loudChunks = 0;
    }
  };

  const holdAmbient = (durationMs: number) => {
    lastAmbientHoldAt = deps.now();
    deps.ambient.hold(durationMs, "idle-autonomy");
  };

  const settle = (completion: { completed?: boolean; ok?: boolean }, isCurrent: () => boolean): IdleAutonomyOutcome =>
    completion.completed === true || (completion.completed === undefined && completion.ok === true)
      ? "completed"
      : isCurrent() ? "blocked" : "interrupted";

  const execute = async (action: IdleAutonomyAction) => {
    const myToken = ++token;
    inFlight = { token: myToken, action };
    const isCurrent = () => myToken === token && abortReason() === null;
    const wheel = isWheelAction(action);
    let outcome: IdleAutonomyOutcome = "failed";
    deps.log("action", {
      kind: action.kind,
      detail: action.kind === "head" ? action.position : action.kind === "head_gesture" ? action.gesture : action.kind === "wait" ? action.reason : action.direction,
      durationMs: wheel ? action.durationMs : undefined,
    });
    try {
      if (!isCurrent()) {
        outcome = "interrupted";
      } else if (action.kind === "turn" || action.kind === "step") {
        holdAmbient(action.durationMs + 1_500);
        deps.camera.holdMotion(action.durationMs + 800);
        const armed = deps.stopListener.isLive() &&
          await deps.stopListener.arm(`idle-autonomy-${action.kind}`, action.durationMs + STOP_ARM_MARGIN_MS).catch(() => false);
        if (!armed) {
          outcome = "stop_listener_unavailable";
          deps.log("stop-listener-unavailable", { kind: action.kind });
        } else {
          try {
            // Re-read the motion layer right before the wheels move; nothing from before the await is trusted.
            const surface = assessIdleSurface(deps.motion.getState(), deps.now());
            if (!isCurrent()) outcome = "interrupted";
            else if (!(action.kind === "step" ? surface.forward && deps.linkLossSelfStopConfirmed() : surface.turn)) outcome = "blocked";
            else outcome = settle(await deps.motion.drive(action.direction, action.durationMs, { isCurrent }), isCurrent);
          } finally {
            await deps.stopListener.disarm(`idle-autonomy-${action.kind}-finished`).catch(() => undefined);
          }
        }
      } else if (action.kind === "head") {
        holdAmbient(2_000);
        outcome = settle(await deps.motion.setHead(action.position, isCurrent), isCurrent);
      } else if (action.kind === "head_gesture") {
        holdAmbient(2_000);
        outcome = settle(await deps.motion.headGesture(action.gesture, isCurrent), isCurrent);
      }
    } catch (error) {
      outcome = isCurrent() ? (wheel ? "blocked" : "failed") : "interrupted";
      deps.log("action-error", { kind: action.kind, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (wheel) lastWheelEndedAt = deps.now();
      observeMotionLayer();
      if (inFlight?.token === myToken) inFlight = null;
      machine.observe(outcome, deps.now());
      deps.log("action-finished", { kind: action.kind, outcome });
      if (running) schedule(0);
    }
  };

  const step = () => {
    const robot = deps.motion.getState();
    const now = deps.now();
    const level = deps.getLevel();
    const body = deps.bodyState.getState();
    const surface = assessIdleSurface(robot, now);
    const facts: IdleAutonomyFacts = {
      now,
      level,
      body,
      yieldReason: yieldReason(),
      lastInteractionAt,
      robotReady: robot.connected && robot.driveControlReady,
      otherMotionBusy: robot.motionActive || deps.ambient.busy() || deps.camera.bodyMotionInFlight(),
      turnSurfaceSafe: surface.turn,
      forwardSurfaceSafe: surface.forward,
      linkLossSelfStopConfirmed: deps.linkLossSelfStopConfirmed(),
      stopListenerLive: deps.stopListener.isLive(),
      cameraAvailable: level !== "off" && deps.camera.available(),
    };
    const decision = machine.decide(facts);
    applyMode(decision.mode);
    for (const event of decision.events) {
      deps.bodyState.publishEvent(event);
      deps.log("event", { type: event.type });
    }
    applyCamera(decision.camera);
    applyVoiceGuard(decision.mode);
    if (decision.mode !== "resting" && now - lastAmbientHoldAt >= AMBIENT_HOLD_REFRESH_MS) holdAmbient(AMBIENT_HOLD_MS);
    if (decision.action.kind === "wait") {
      if (decision.action.reason !== lastWaitReason) {
        lastWaitReason = decision.action.reason;
        deps.log("waiting", { reason: decision.action.reason, mode: decision.mode });
      }
      return;
    }
    lastWaitReason = "";
    void execute(decision.action);
  };

  function schedule(delayMs: number) {
    if (!running) return;
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(tick, delayMs);
  }

  function tick() {
    timer = null;
    if (!running) return;
    try {
      observeMotionLayer();
      if (!inFlight) step();
    } catch (error) {
      deps.log("tick-error", { error: error instanceof Error ? error.message : String(error) });
    }
    schedule(IDLE_AUTONOMY_TICK_MS);
  }

  const noteInteraction = (source: string) => {
    const now = deps.now();
    lastInteractionAt = now;
    machine.noteInteraction(now);
    abortInFlight();
    if (running && source) schedule(0);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      lastStopGeneration = deps.motion.getState().stopGeneration;
      subscriptions = [
        deps.motion.subscribe(() => { if (running) observeMotionLayer(); }),
        deps.subscribeInteractions((source) => noteInteraction(source)),
        deps.bodyState.subscribeEvents((event) => { if (event.type === "petted") noteInteraction("petted"); }),
      ];
      deps.log("started", { level: deps.getLevel() });
      schedule(IDLE_AUTONOMY_TICK_MS);
    },
    stop(reason = "stopped"): void {
      if (!running) return;
      running = false;
      abortInFlight();
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      unsubscribeSamples?.();
      unsubscribeSamples = null;
      if (camera !== "off") deps.camera.release();
      camera = "off";
      applyMode("resting");
      deps.log("stopped", { reason });
    },
    /** Run one tick now; tests drive time with a virtual clock. */
    tick,
    getSnapshot() {
      return { running, inFlight: inFlight?.action ?? null, camera, ...machine.getSnapshot() };
    },
  };
}

export type IdleAutonomyRuntime = ReturnType<typeof createIdleAutonomyRuntime>;
