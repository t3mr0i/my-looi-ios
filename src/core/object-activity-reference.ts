import type { BehaviorMode, BehaviorState } from "../behavior/behavior-types";

export interface ObjectActivityReferenceCandidate {
  sessionId: string;
  taskId: string;
  episodeId: string;
  title: string;
  referenceVersion: number;
}

/** A user-confirmed, current activity may temporarily give meaning to a selected ROI. */
export function getObjectActivityReferenceCandidate(
  state: BehaviorState,
  mode: BehaviorMode,
  wallNow = Date.now(),
): ObjectActivityReferenceCandidate | null {
  const task = state.pendingIntention;
  const activity = task?.activity;
  if (mode !== "active" || !state.sessionId || !task || task.status !== "active"
    || !Number.isFinite(wallNow) || task.expiresAt <= wallNow || !activity
    || activity.confirmedAt === null || !Number.isFinite(activity.confirmedAt)
    || activity.phase === "completed" || !activity.episodeId || !activity.title) return null;
  const episode = state.companion.episodes.find((item) => item.id === activity.episodeId);
  if (!episode || episode.title !== activity.title || !Number.isFinite(episode.confirmedAt)) return null;
  return {
    sessionId: state.sessionId,
    taskId: task.id,
    episodeId: activity.episodeId,
    title: episode.title,
    referenceVersion: state.referenceVersion,
  };
}

/** Ordinary turns preserve a binding; identity/reference/task/session changes invalidate it. */
export function isObjectActivityReferenceCurrent(
  candidate: ObjectActivityReferenceCandidate,
  state: BehaviorState,
  mode: BehaviorMode,
  wallNow = Date.now(),
): boolean {
  const current = getObjectActivityReferenceCandidate(state, mode, wallNow);
  return current !== null
    && candidate.sessionId === current.sessionId
    && candidate.taskId === current.taskId
    && candidate.episodeId === current.episodeId
    && candidate.title === current.title
    && candidate.referenceVersion === current.referenceVersion;
}

export type ObjectActivityGazeInput = {
  bindingKey: string;
  phaseKey: string;
  phase: string;
  busy: boolean;
  pendingConfirmation: boolean;
  tracked: boolean;
};

export type ObjectActivityGazeTarget = "person" | "object";

const QUIET_DWELL_MS = 500;
const OBJECT_GLANCE_MS = 700;
const GLANCE_PHASES = new Set(["checking", "preparing", "awaiting_result"]);

/**
 * Local screen-gaze cadence; timings are provisional product defaults, not measured behavior.
 * The runtime should call update on its local timer and reset whenever the ROI lease ends.
 */
export function createObjectActivityGazeDirector(now: () => number = Date.now) {
  let key: string | null = null;
  let quietSince: number | null = null;
  let glanceStartedAt: number | null = null;
  let consumed = false;

  const reset = (): void => {
    key = null;
    quietSince = null;
    glanceStartedAt = null;
    consumed = false;
  };

  const update = (input: ObjectActivityGazeInput): ObjectActivityGazeTarget => {
    const time = now();
    if (!input.tracked || !input.bindingKey || !input.phaseKey || !Number.isFinite(time)) {
      reset();
      return "person";
    }
    const nextKey = `${input.bindingKey}\u0000${input.phaseKey}`;
    if (nextKey !== key) {
      key = nextKey;
      quietSince = null;
      glanceStartedAt = null;
      consumed = false;
    }
    if (!GLANCE_PHASES.has(input.phase)) {
      quietSince = null;
      glanceStartedAt = null;
      consumed = true;
      return "person";
    }
    if (input.busy || input.pendingConfirmation) {
      if (glanceStartedAt !== null) consumed = true;
      glanceStartedAt = null;
      quietSince = null;
      return "person";
    }
    if (consumed) return "person";
    if (glanceStartedAt !== null) {
      if (time - glanceStartedAt < OBJECT_GLANCE_MS) return "object";
      glanceStartedAt = null;
      consumed = true;
      return "person";
    }
    if (quietSince === null) {
      quietSince = time;
      return "person";
    }
    if (time - quietSince < QUIET_DWELL_MS) return "person";
    glanceStartedAt = time;
    return "object";
  };

  return { reset, update };
}
