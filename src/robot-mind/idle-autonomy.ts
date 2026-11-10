/**
 * LOOI's idle life: what the robot does on its own while nobody is talking to
 * it. A pure state machine that decides one bounded action (or a pause) at a
 * time from the body state, the motion layer's own safety facts and an
 * injected random source. It never touches BLE, timers or stores itself; the
 * runtime in idle-autonomy-runtime.ts executes its decisions.
 *
 * resting -> looking_around -> resting
 * resting -> seeking_person -> attending | resting (search_gave_up)
 * attending -> approaching -> attending (arrived_at_person) | resting
 */
import type { RobotActivityMode, RobotBearing, RobotBodyEvent, RobotBodyState } from "./body-state";

export type IdleAutonomyLevel = "off" | "look" | "explore";
export type IdleAutonomyMode = Extract<RobotActivityMode,
  "resting" | "looking_around" | "seeking_person" | "approaching" | "attending">;

export const IDLE_AUTONOMY_MODES: readonly IdleAutonomyMode[] = [
  "resting", "looking_around", "seeking_person", "approaching", "attending",
];

// Hard wheel budgets. Every turn or step counts when it is chosen, not when it
// completes, so failed or blocked attempts also use up the budget.
export const MAX_WHEEL_ACTIONS_PER_MINUTE = 4;
export const MAX_WHEEL_ACTIONS_PER_TEN_MINUTES = 16;
export const MAX_TRANSLATIONS_PER_TEN_MINUTES = 6;
export const MAX_CONSECUTIVE_APPROACH_STEPS = 3;
export const MIN_PAUSE_BETWEEN_ACTIONS_MS = 1_500;
export const MIN_PAUSE_BETWEEN_WHEEL_ACTIONS_MS = 2_500;

// Bounded primitive sizes (milliseconds of wheel time). The motion layer clamps
// again; these are the autonomy's own, smaller ceilings.
export const LOOK_TURN_MS: readonly [number, number] = [160, 240];
export const SEARCH_TURN_MS: readonly [number, number] = [240, 360];
export const ATTEND_TURN_MS: readonly [number, number] = [110, 170];
export const APPROACH_STEP_MS: readonly [number, number] = [300, 420];
export const MAX_AUTONOMOUS_TURN_MS = 400;
export const MAX_AUTONOMOUS_STEP_MS = 450;

// Rhythm.
export const START_AFTER_INTERACTION_MS = 45_000;
export const RESUME_CALM_MS = 30_000;
export const DROWSY_AFTER_MS = 5 * 60_000;
/** After this much time without a human, idle life stops so the existing 15-minute auto sleep can take over. */
export const WIND_DOWN_AFTER_MS = 10 * 60_000;
export const REST_MS: readonly [number, number] = [12_000, 30_000];
export const LOOK_GAP_MS: readonly [number, number] = [1_800, 4_500];
export const SEARCH_SETTLE_MS: readonly [number, number] = [2_000, 3_200];
export const ATTEND_GAP_MS: readonly [number, number] = [3_000, 6_000];
export const APPROACH_SETTLE_MS: readonly [number, number] = [2_500, 4_000];
export const BUSY_RETRY_MS = 1_000;

// Searching, attending, approaching.
export const SEEK_AFTER_NO_PERSON_MS = 90_000;
export const MAX_SEARCH_STEPS = 4;
export const MAX_SEARCH_MS = 40_000;
export const SEARCH_COOLDOWN_MS = 4 * 60_000;
export const PERSON_FRESH_MS = 2_000;
export const PERSON_LOST_MS = 4_000;
export const ATTEND_MAX_MS = 60_000;
export const ATTEND_COOLDOWN_MS = 2 * 60_000;
export const APPROACH_ALIGN_MAX_MS = 6_000;
export const APPROACH_COOLDOWN_MS = 5 * 60_000;

// Safety memory.
export const EDGE_WHEEL_PAUSE_MS = 2 * 60_000;
export const EDGE_TRANSLATION_LOCK_MS = 15 * 60_000;
export const BLOCKED_TRANSLATION_PAUSE_MS = 5 * 60_000;
export const BLOCKED_TURN_PAUSE_MS = 60_000;
export const STOP_LISTENER_RETRY_MS = 2 * 60_000;

// Energy: actions spend it, rest restores it. Episodes start only with enough.
export const ENERGY_RECOVERY_MS = 180_000;
export const MIN_ENERGY_FOR_EPISODE = 0.4;
const ENERGY_COST = { head: 0.04, turn: 0.08, step: 0.12 } as const;

export type IdleHeadPosition = "up" | "center" | "down";
export type IdleAutonomyAction =
  | { kind: "wait"; durationMs: number; reason: string }
  | { kind: "head"; position: IdleHeadPosition }
  | { kind: "head_gesture"; gesture: "curious" | "thinking" }
  | { kind: "turn"; direction: "left" | "right"; durationMs: number; purpose: "look" | "search" | "attend" }
  | { kind: "step"; direction: "forward"; durationMs: number };

export type IdleAutonomyOutcome = "completed" | "blocked" | "interrupted" | "failed" | "stop_listener_unavailable";
/** The camera only looks; every autonomous body turn is chosen and gated here, never by the camera controller. */
export type IdleCameraRequest = "off" | "look";

export interface IdleAutonomyFacts {
  now: number;
  level: IdleAutonomyLevel;
  body: RobotBodyState;
  /** Non-null while anything with priority over idle life is going on. */
  yieldReason: string | null;
  /** Latest human interaction the runtime noticed itself (touch, speech, wake). */
  lastInteractionAt: number | null;
  /** Base connected with a ready drive channel, read from the motion layer itself. */
  robotReady: boolean;
  /** Another controller is moving the wheels or is mid-gesture. */
  otherMotionBusy: boolean;
  /** All four cliff sensors report ground, an edge-sensor frame is fresh, the reading is stable, and no near-edge latch. */
  turnSurfaceSafe: boolean;
  /** turnSurfaceSafe plus a 0e reading the app decodes as clear (an unverified signal that can only add caution). */
  forwardSurfaceSafe: boolean;
  /**
   * The owner has checked on this robot that it stops by itself when the Bluetooth link drops
   * mid-movement. No source establishes that it does; without this, explore takes no steps.
   */
  linkLossSelfStopConfirmed: boolean;
  /** Microphone PCM is flowing, so a local STOP decoder can be armed for a wheel action. */
  stopListenerLive: boolean;
  /** The user allows the camera and it can look for faces now. */
  cameraAvailable: boolean;
}

export interface IdleAutonomyDecision {
  action: IdleAutonomyAction;
  mode: IdleAutonomyMode;
  events: RobotBodyEvent[];
  camera: IdleCameraRequest;
}

export function isWheelAction(action: IdleAutonomyAction): action is Extract<IdleAutonomyAction, { kind: "turn" | "step" }> {
  return action.kind === "turn" || action.kind === "step";
}

type Episode =
  | { kind: "looking_around"; remaining: number; turned: "left" | "right" | null }
  | { kind: "seeking_person"; startedAt: number; steps: number; direction: "left" | "right" }
  | { kind: "attending"; startedAt: number }
  | { kind: "approaching"; startedAt: number; steps: number; alignWaitStartedAt: number | null };

export interface IdleAutonomyOptions {
  random: () => number;
  startedAt: number;
}

export function createIdleAutonomy(options: IdleAutonomyOptions) {
  const random = () => Math.min(0.999999, Math.max(0, options.random()));
  const between = (range: readonly [number, number]) => Math.round(range[0] + random() * (range[1] - range[0]));

  let mode: IdleAutonomyMode = "resting";
  let episode: Episode | null = null;
  let nextActionAt = options.startedAt;
  let pendingGapMs = 0;
  let pendingAction: IdleAutonomyAction | null = null;
  let levelSeen: IdleAutonomyLevel | null = null;
  let stopLock: string | null = null;
  let yieldedAt: number | null = null;
  let lastInteractionAt = options.startedAt;
  let energy = 1;
  let energyAt = options.startedAt;
  const wheelLog: number[] = [];
  const translationLog: number[] = [];
  let lastWheelActionAt: number | null = null;
  let edge: { at: number; side: "front" | "rear" } | null = null;
  let translationPausedUntil = 0;
  let wheelsPausedUntil = 0;
  let stopListenerFailedAt: number | null = null;
  let searchGaveUpAt: number | null = null;
  let attendCooldownUntil = 0;
  let approachCooldownUntil = 0;
  let lastNow = options.startedAt;

  const recover = (now: number) => {
    if (now > energyAt) energy = Math.min(1, energy + (now - energyAt) / ENERGY_RECOVERY_MS);
    energyAt = now;
  };

  const prune = (log: number[], now: number) => {
    while (log.length && now - log[0]! >= 10 * 60_000) log.shift();
  };

  const personPresent = (facts: IdleAutonomyFacts) => {
    const people = facts.body.people;
    return !!people.attended && people.lastSeenAt !== null && facts.now - people.lastSeenAt <= PERSON_FRESH_MS;
  };

  const personLostFor = (facts: IdleAutonomyFacts) => {
    const lastSeenAt = facts.body.people.lastSeenAt;
    return lastSeenAt === null ? Number.POSITIVE_INFINITY : facts.now - lastSeenAt;
  };

  const idleFor = (facts: IdleAutonomyFacts) => {
    const latest = Math.max(lastInteractionAt, facts.lastInteractionAt ?? 0, facts.body.lastHumanInteractionAt ?? 0);
    return facts.now - latest;
  };

  /** Why a turn in place is not allowed right now, or null. */
  const turnBlocker = (facts: IdleAutonomyFacts): string | null => {
    if (facts.level === "off") return "level-off";
    if (stopLock) return "stop-lock";
    if (!facts.robotReady) return "robot-not-ready";
    if (!facts.turnSurfaceSafe) return "surface-not-known-safe";
    if (!facts.stopListenerLive) return "stop-listener-not-live";
    if (stopListenerFailedAt !== null && facts.now - stopListenerFailedAt < STOP_LISTENER_RETRY_MS) return "stop-listener-failed";
    if (edge && facts.now - edge.at < EDGE_WHEEL_PAUSE_MS) return "recent-edge";
    if (facts.now < wheelsPausedUntil) return "wheels-paused";
    if (lastWheelActionAt !== null && facts.now - lastWheelActionAt < MIN_PAUSE_BETWEEN_WHEEL_ACTIONS_MS) return "wheel-pause";
    prune(wheelLog, facts.now);
    if (wheelLog.filter((at) => facts.now - at < 60_000).length >= MAX_WHEEL_ACTIONS_PER_MINUTE) return "budget-minute";
    if (wheelLog.length >= MAX_WHEEL_ACTIONS_PER_TEN_MINUTES) return "budget-ten-minutes";
    return null;
  };

  /** Why a forward step is not allowed right now, or null. Only "explore" may translate. */
  const translationBlocker = (facts: IdleAutonomyFacts): string | null => {
    if (facts.level !== "explore") return "level-not-explore";
    const turn = turnBlocker(facts);
    if (turn) return turn;
    if (!facts.linkLossSelfStopConfirmed) return "link-loss-stop-unconfirmed";
    if (!facts.forwardSurfaceSafe) return "forward-not-known-safe";
    if (facts.body.surface === "edge_front" || facts.body.surface === "edge_rear") return "body-state-edge";
    if (edge && facts.now - edge.at < EDGE_TRANSLATION_LOCK_MS) return "edge-translation-lock";
    if (facts.now < translationPausedUntil) return "translation-paused";
    prune(translationLog, facts.now);
    if (translationLog.length >= MAX_TRANSLATIONS_PER_TEN_MINUTES) return "budget-translation";
    return null;
  };

  const setMode = (next: IdleAutonomyMode, nextEpisode: Episode | null) => {
    mode = next;
    episode = nextEpisode;
  };

  const cameraFor = (facts: IdleAutonomyFacts): IdleCameraRequest => {
    return !facts.cameraAvailable || mode === "resting" ? "off" : "look";
  };

  const decision = (facts: IdleAutonomyFacts, action: IdleAutonomyAction, events: RobotBodyEvent[] = []): IdleAutonomyDecision => {
    if (action.kind === "wait") {
      nextActionAt = Math.max(nextActionAt, facts.now + action.durationMs);
      pendingAction = null;
      pendingGapMs = 0;
    } else {
      pendingAction = action;
      energy = Math.max(0, energy - (action.kind === "step" ? ENERGY_COST.step : action.kind === "turn" ? ENERGY_COST.turn : ENERGY_COST.head));
      if (isWheelAction(action)) {
        wheelLog.push(facts.now);
        lastWheelActionAt = facts.now;
        if (action.kind === "step") translationLog.push(facts.now);
      }
    }
    return { action, mode, events, camera: cameraFor(facts) };
  };

  const wait = (facts: IdleAutonomyFacts, durationMs: number, reason: string, events: RobotBodyEvent[] = []) =>
    decision(facts, { kind: "wait", durationMs: Math.max(0, Math.round(durationMs)), reason }, events);

  const drowsy = (facts: IdleAutonomyFacts) => idleFor(facts) >= DROWSY_AFTER_MS;
  const restMs = (facts: IdleAutonomyFacts) => between(REST_MS) * (drowsy(facts) ? 2 : 1) * (energy < 0.6 ? 1.5 : 1);

  /** End whatever is going on and rest. Does not count as an action. */
  const rest = (facts: IdleAutonomyFacts, reason: string, durationMs: number, events: RobotBodyEvent[] = []) => {
    setMode("resting", null);
    nextActionAt = Math.max(nextActionAt, facts.now + durationMs);
    return wait(facts, durationMs, reason, events);
  };

  const startAttending = (facts: IdleAutonomyFacts) => {
    setMode("attending", { kind: "attending", startedAt: facts.now });
    return wait(facts, between(ATTEND_GAP_MS) / 2, "attending-started");
  };

  const fromResting = (facts: IdleAutonomyFacts): IdleAutonomyDecision => {
    if (personPresent(facts) && facts.now >= attendCooldownUntil) return startAttending(facts);
    if (energy < MIN_ENERGY_FOR_EPISODE) return wait(facts, restMs(facts), "low-energy");

    const noPersonFor = facts.body.people.lastSeenAt === null
      ? facts.now - options.startedAt
      : personLostFor(facts);
    const canSeek = facts.cameraAvailable &&
      !drowsy(facts) &&
      noPersonFor >= SEEK_AFTER_NO_PERSON_MS &&
      (searchGaveUpAt === null || facts.now - searchGaveUpAt >= SEARCH_COOLDOWN_MS);
    const roll = random();
    if (canSeek && roll < 0.35) {
      setMode("seeking_person", { kind: "seeking_person", startedAt: facts.now, steps: 0, direction: random() < 0.5 ? "left" : "right" });
      return fromSeeking(facts);
    }
    if (roll < (drowsy(facts) ? 0.45 : 0.8)) {
      setMode("looking_around", { kind: "looking_around", remaining: 2 + Math.floor(random() * 3), turned: null });
      return fromLooking(facts);
    }
    return wait(facts, restMs(facts), "resting");
  };

  const fromLooking = (facts: IdleAutonomyFacts): IdleAutonomyDecision => {
    const current = episode as Extract<Episode, { kind: "looking_around" }>;
    if (personPresent(facts) && facts.now >= attendCooldownUntil) return startAttending(facts);
    if (current.remaining <= 0) {
      setMode("resting", null);
      pendingGapMs = restMs(facts);
      return decision(facts, { kind: "head", position: "center" });
    }
    current.remaining -= 1;
    pendingGapMs = between(LOOK_GAP_MS);
    const roll = random();
    if (roll < 0.3 && !turnBlocker(facts)) {
      // A glance to one side is followed by one back, so looking around does not drift LOOI's heading.
      const direction = current.turned === "left" ? "right" : current.turned === "right" ? "left" : random() < 0.5 ? "left" : "right";
      current.turned = current.turned ? null : direction;
      return decision(facts, {
        kind: "turn", direction,
        durationMs: Math.min(MAX_AUTONOMOUS_TURN_MS, between(LOOK_TURN_MS)), purpose: "look",
      });
    }
    if (roll < 0.5) return decision(facts, { kind: "head_gesture", gesture: random() < 0.7 ? "curious" : "thinking" });
    return decision(facts, { kind: "head", position: random() < 0.5 ? "up" : "down" });
  };

  const fromSeeking = (facts: IdleAutonomyFacts): IdleAutonomyDecision => {
    const current = episode as Extract<Episode, { kind: "seeking_person" }>;
    if (personPresent(facts)) return startAttending(facts);
    if (!facts.cameraAvailable) return rest(facts, "camera-unavailable", restMs(facts));
    if (current.steps >= MAX_SEARCH_STEPS || facts.now - current.startedAt >= MAX_SEARCH_MS) {
      searchGaveUpAt = facts.now;
      return rest(facts, "search-gave-up", restMs(facts) * 1.5, [{ type: "search_gave_up", at: facts.now }]);
    }
    current.steps += 1;
    pendingGapMs = between(SEARCH_SETTLE_MS);
    if (!turnBlocker(facts)) {
      // Sweep two steps one way, then two steps back to where the search began.
      const direction = current.steps === 3 ? (current.direction === "left" ? "right" : "left") : current.direction;
      if (current.steps === 3) current.direction = direction;
      return decision(facts, {
        kind: "turn", direction,
        durationMs: Math.min(MAX_AUTONOMOUS_TURN_MS, between(SEARCH_TURN_MS)), purpose: "search",
      });
    }
    return decision(facts, { kind: "head", position: current.steps % 2 === 1 ? "up" : "center" });
  };

  const turnToward = (bearing: RobotBearing) => (facts: IdleAutonomyFacts) => decision(facts, {
    kind: "turn", direction: bearing === "left" ? "left" : "right",
    durationMs: between(ATTEND_TURN_MS), purpose: "attend",
  });

  const endAttending = (facts: IdleAutonomyFacts, reason: string) => {
    attendCooldownUntil = facts.now + ATTEND_COOLDOWN_MS;
    return rest(facts, reason, restMs(facts));
  };

  const fromAttending = (facts: IdleAutonomyFacts): IdleAutonomyDecision => {
    const current = episode as Extract<Episode, { kind: "attending" }>;
    if (!personPresent(facts)) {
      if (personLostFor(facts) >= PERSON_LOST_MS) return endAttending(facts, "person-lost");
      return wait(facts, 500, "person-flicker");
    }
    if (facts.now - current.startedAt >= ATTEND_MAX_MS) return endAttending(facts, "attended-long-enough");
    const attended = facts.body.people.attended!;
    if (attended.distance === "far" && facts.now >= approachCooldownUntil && !translationBlocker(facts)) {
      setMode("approaching", { kind: "approaching", startedAt: facts.now, steps: 0, alignWaitStartedAt: null });
      return fromApproaching(facts);
    }
    pendingGapMs = between(ATTEND_GAP_MS);
    if (!isCentered(attended.bearing) && !turnBlocker(facts)) return turnToward(attended.bearing)(facts);
    if (random() < 0.25) return decision(facts, { kind: "head_gesture", gesture: "curious" });
    return wait(facts, between(ATTEND_GAP_MS), "attending");
  };

  const endApproach = (facts: IdleAutonomyFacts, events: RobotBodyEvent[] = []) => {
    approachCooldownUntil = facts.now + APPROACH_COOLDOWN_MS;
    setMode("attending", { kind: "attending", startedAt: facts.now });
    return wait(facts, between(ATTEND_GAP_MS), "approach-ended", events);
  };

  const fromApproaching = (facts: IdleAutonomyFacts): IdleAutonomyDecision => {
    const current = episode as Extract<Episode, { kind: "approaching" }>;
    if (!personPresent(facts)) {
      approachCooldownUntil = facts.now + APPROACH_COOLDOWN_MS;
      if (personLostFor(facts) >= PERSON_LOST_MS) return endAttending(facts, "person-lost-while-approaching");
      return wait(facts, 500, "person-flicker");
    }
    const attended = facts.body.people.attended!;
    if (attended.distance === "near") return endApproach(facts, [{ type: "arrived_at_person", at: facts.now }]);
    if (current.steps >= MAX_CONSECUTIVE_APPROACH_STEPS || attended.distance !== "far") return endApproach(facts);
    if (translationBlocker(facts)) return endApproach(facts);
    if (!isCentered(attended.bearing)) {
      current.alignWaitStartedAt ??= facts.now;
      if (facts.now - current.alignWaitStartedAt >= APPROACH_ALIGN_MAX_MS) return endApproach(facts);
      if (turnBlocker(facts)) return wait(facts, 700, "waiting-for-alignment");
      pendingGapMs = between(SEARCH_SETTLE_MS);
      return turnToward(attended.bearing)(facts);
    }
    current.alignWaitStartedAt = null;
    current.steps += 1;
    pendingGapMs = between(APPROACH_SETTLE_MS);
    return decision(facts, { kind: "step", direction: "forward", durationMs: Math.min(MAX_AUTONOMOUS_STEP_MS, between(APPROACH_STEP_MS)) });
  };

  return {
    decide(facts: IdleAutonomyFacts): IdleAutonomyDecision {
      recover(facts.now);
      lastNow = facts.now;
      if (levelSeen !== facts.level) {
        // Choosing a level again is the user's way to lift a STOP lock.
        levelSeen = facts.level;
        stopLock = null;
      }
      if (facts.yieldReason === "robot-sleeping") stopLock = null;
      if (facts.level === "off") return rest(facts, "level-off", 10_000);
      if (stopLock) return rest(facts, `stop-lock:${stopLock}`, 10_000);
      if (facts.yieldReason || !facts.robotReady) {
        yieldedAt = facts.now;
        return rest(facts, facts.yieldReason ? `yield:${facts.yieldReason}` : "robot-not-ready", 1_000);
      }
      if (yieldedAt !== null && facts.now - yieldedAt < RESUME_CALM_MS) {
        return rest(facts, "calm-after-yield", RESUME_CALM_MS - (facts.now - yieldedAt));
      }
      const idleMs = idleFor(facts);
      if (idleMs < START_AFTER_INTERACTION_MS) return rest(facts, "recent-interaction", START_AFTER_INTERACTION_MS - idleMs);
      if (idleMs >= WIND_DOWN_AFTER_MS) return rest(facts, "winding-down", 30_000);
      if (facts.otherMotionBusy) return wait(facts, BUSY_RETRY_MS, "other-motion-busy");
      if (facts.now < nextActionAt) return wait(facts, nextActionAt - facts.now, "pause");

      switch (mode) {
        case "resting": return fromResting(facts);
        case "looking_around": return fromLooking(facts);
        case "seeking_person": return fromSeeking(facts);
        case "attending": return fromAttending(facts);
        case "approaching": return fromApproaching(facts);
      }
    },

    /** Report the result of the last non-wait action. */
    observe(outcome: IdleAutonomyOutcome, now: number): void {
      const action = pendingAction;
      pendingAction = null;
      const gap = Math.max(MIN_PAUSE_BETWEEN_ACTIONS_MS, pendingGapMs);
      pendingGapMs = 0;
      nextActionAt = Math.max(nextActionAt, now + gap);
      if (outcome === "completed" || !action) return;
      if (outcome === "stop_listener_unavailable") {
        stopListenerFailedAt = now;
        if (mode === "approaching") { approachCooldownUntil = now + APPROACH_COOLDOWN_MS; setMode("attending", { kind: "attending", startedAt: now }); }
        return;
      }
      if (outcome === "blocked" && isWheelAction(action)) {
        if (action.kind === "step") translationPausedUntil = Math.max(translationPausedUntil, now + BLOCKED_TRANSLATION_PAUSE_MS);
        wheelsPausedUntil = Math.max(wheelsPausedUntil, now + BLOCKED_TURN_PAUSE_MS);
      }
      if (outcome === "interrupted") yieldedAt = now;
      setMode("resting", null);
      nextActionAt = Math.max(nextActionAt, now + between(REST_MS));
    },

    /** The motion layer latched a table edge or stopped at a cliff. */
    noteEdge(side: "front" | "rear", now: number): void {
      edge = { at: now, side };
      translationPausedUntil = Math.max(translationPausedUntil, now + EDGE_TRANSLATION_LOCK_MS);
      wheelsPausedUntil = Math.max(wheelsPausedUntil, now + EDGE_WHEEL_PAUSE_MS);
      if (mode !== "resting") setMode("resting", null);
      nextActionAt = Math.max(nextActionAt, now + between(REST_MS));
    },

    /** The front distance sensor stopped a step. Same caution as a front edge for translation. */
    noteObstacle(now: number): void {
      translationPausedUntil = Math.max(translationPausedUntil, now + EDGE_TRANSLATION_LOCK_MS);
      if (mode === "approaching") setMode("attending", { kind: "attending", startedAt: now });
    },

    /** STOP while LOOI moved on its own: no autonomous motion until the user chooses a level again or LOOI sleeps. */
    lockAfterStop(reason: string): void {
      stopLock = reason || "stop";
      setMode("resting", null);
    },

    /** Something with priority happened (touch, speech, a command); rest calmly afterwards. */
    noteInteraction(now: number): void {
      lastInteractionAt = Math.max(lastInteractionAt, now);
      yieldedAt = now;
      if (mode !== "resting") setMode("resting", null);
    },

    /** Something else needed the robot (an external stop, nearby voice); rest calmly afterwards. */
    noteYield(now: number): void {
      yieldedAt = now;
      if (mode !== "resting") setMode("resting", null);
    },

    getSnapshot() {
      return {
        mode,
        energy,
        stopLock,
        nextActionAt,
        wheelActionsLastMinute: wheelLog.filter((at) => lastNow - at < 60_000).length,
        wheelActionsLastTenMinutes: wheelLog.length,
        translationsLastTenMinutes: translationLog.length,
        edge: edge ? { ...edge } : null,
        translationPausedUntil,
        wheelsPausedUntil,
        stopListenerFailedAt,
        searchGaveUpAt,
      };
    },
  };
}

export type IdleAutonomy = ReturnType<typeof createIdleAutonomy>;

function isCentered(bearing: RobotBearing): boolean {
  return bearing === "center";
}

/** Minimal view of the motion layer used to judge the surface directly, never through the body-state store. */
export interface IdleMotionLayerSnapshot {
  connected: boolean;
  driveControlReady: boolean;
  motionActive: boolean;
  stopGeneration: number;
  nearEdge: { front: boolean; rear: boolean };
  sensors: {
    lastFed9At: number | null;
    lastCliffFrameAt?: number | null;
    tofDistanceMm?: number | null;
    cliffSensors: { frontLeft: boolean; frontRight: boolean; rearLeft: boolean; rearRight: boolean } | null;
    cliffSafeSince: { frontLeft: number | null; frontRight: number | null; rearLeft: number | null; rearRight: number | null };
    obstacleNear: boolean | null;
  };
  safety: { lastSafetyStopReason: string | null };
}

/**
 * Edge-sensor frames older than this make the surface unknown for autonomy. Only edge-sensor (cliff) frames
 * count: the robot's own motion frames (02/0e) show that the stream is alive, not where the edges are, and
 * used to let one wheel action open the window for the next. Whether the robot repeats edge frames at rest
 * is not established; the self-check measures it.
 */
export const SURFACE_SENSOR_FRESH_MS = 6_000;
/** Mirrors TOF_NO_TARGET in device-tools/fed9-sensors.ts; larger raw values are not a known distance. */
const TOF_RAW_LIMIT = 0x1fff;
/** All four cliff sensors must have reported ground continuously for this long. */
export const SURFACE_STABLE_MS = 1_000;

/** Opt-in only (owner's self-check showed no edge frames at rest): how long all four sensors must have seen ground since their last change. */
export const QUIET_SURFACE_SETTLED_MS = 10_000;
/** After an autonomous wheel action, a FED9 frame of any type must arrive within this long after it ended, or the quiet basis is suspended. */
export const QUIET_ECHO_WINDOW_MS = 1_000;
export type IdleSurfaceBasis = "fresh" | "quiet" | null;

export function assessIdleSurface(
  robot: IdleMotionLayerSnapshot,
  now: number,
  quiet?: { echoOk: boolean },
): { turn: boolean; forward: boolean; basis: IdleSurfaceBasis } {
  const sensors = robot.sensors;
  const cliff = sensors.cliffSensors;
  const ground = robot.connected &&
    robot.driveControlReady &&
    !robot.nearEdge.front && !robot.nearEdge.rear &&
    !!cliff && cliff.frontLeft && cliff.frontRight && cliff.rearLeft && cliff.rearRight;
  const stableFor = (ms: number) => (Object.values(sensors.cliffSafeSince) as Array<number | null>)
    .every((since) => since !== null && now - since >= ms);
  const freshTurn = ground &&
    sensors.lastCliffFrameAt != null && now - sensors.lastCliffFrameAt <= SURFACE_SENSOR_FRESH_MS &&
    stableFor(SURFACE_STABLE_MS);
  // The quiet basis trusts the last reported edge state, so it still needs an edge frame on this connection.
  const quietTurn = !!quiet && quiet.echoOk && ground && sensors.lastCliffFrameAt != null && stableFor(QUIET_SURFACE_SETTLED_MS);
  return {
    turn: freshTurn || quietTurn,
    // Steps never use the quiet basis.
    forward: freshTurn && sensors.obstacleNear === false && (sensors.tofDistanceMm == null || sensors.tofDistanceMm < TOF_RAW_LIMIT),
    basis: freshTurn ? "fresh" : quietTurn ? "quiet" : null,
  };
}
