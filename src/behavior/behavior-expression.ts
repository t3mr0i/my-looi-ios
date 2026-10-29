import type { BehaviorCue, BehaviorGesture } from "./behavior-types";

export type BehaviorExpressionPhase = "prepare" | "accent" | "settle";

export interface BehaviorExpressionScore {
  gesture: Exclude<BehaviorGesture, "hold">;
  prepareMs: number;
  prepareGaze: { x: number; y: number };
  settleMs: number;
}

export interface BehaviorExpressionDependencies {
  now(): number;
  signal: AbortSignal;
  /** Must include lifecycle, source ownership, and the post-accent closing deadline. */
  isCurrent(): boolean;
  /** Disables gaze lead and settle holds while preserving the approved head macro. */
  reducedMotion?: boolean;
  present(phase: BehaviorExpressionPhase, gaze?: { x: number; y: number }): void;
  /** Synchronously opens the bounded head-motion window after checking cue freshness. */
  beginAccent(): boolean;
  executeHead(): Promise<{ completed?: boolean } | void>;
  settle?(): void;
}

const PREPARE_MS = 150;
const SETTLE_MS = 220;
const CLOSE_DEADLINE_MS = 1_500;
const CURRENT_POLL_MS = 25;
const MAX_GAZE = 0.2;

const PHYSICAL_GESTURES = new Set<BehaviorGesture>([
  "curious",
  "thinking",
  "happy_bob",
  "nod",
  "speaking_soft",
]);

function boundedGaze(value: { x: number; y: number }): { x: number; y: number } {
  const clamp = (coordinate: number) => Math.max(-MAX_GAZE, Math.min(MAX_GAZE, coordinate));
  return {
    x: clamp(Number.isFinite(value.x) ? value.x : 0),
    y: clamp(Number.isFinite(value.y) ? value.y : 0),
  };
}

/**
 * Compile one approved semantic cue into a small local expression score.
 * The 150 ms preparation and 220 ms settle are provisional design defaults,
 * not measured optima. No motor trajectory is synthesized here.
 */
export function compileBehaviorExpression(cue: BehaviorCue): BehaviorExpressionScore | null {
  if (cue.presentationOnly || !PHYSICAL_GESTURES.has(cue.gesture)) return null;

  let prepareGaze: { x: number; y: number };
  switch (cue.gesture) {
    case "curious":
      prepareGaze = { x: 0, y: -0.16 };
      break;
    case "thinking":
      // Preserve a supplied look direction, but keep it a small local accent.
      prepareGaze = cue.gaze ?? { x: 0, y: 0.18 };
      break;
    case "happy_bob":
      prepareGaze = { x: 0, y: -0.09 };
      break;
    case "nod":
      prepareGaze = { x: 0, y: 0.09 };
      break;
    case "speaking_soft":
      prepareGaze = { x: 0, y: 0 };
      break;
    default:
      return null;
  }

  return {
    gesture: cue.gesture,
    prepareMs: PREPARE_MS,
    prepareGaze: boundedGaze(prepareGaze),
    settleMs: SETTLE_MS,
  };
}

function isCurrent(deps: BehaviorExpressionDependencies): boolean {
  if (deps.signal.aborted) return false;
  try {
    return deps.isCurrent();
  } catch {
    return false;
  }
}

function cueIsFresh(cue: BehaviorCue, deps: BehaviorExpressionDependencies): boolean {
  let now: number;
  try {
    now = deps.now();
  } catch {
    return false;
  }
  return Number.isFinite(now) && now < cue.expiresAt && isCurrent(deps);
}

/** Wait in short bounded slices so ownership changes are noticed even without abort. */
async function waitWhileCurrent(
  durationMs: number,
  deadline: number,
  deps: BehaviorExpressionDependencies,
): Promise<boolean> {
  const end = Math.min(deps.now() + Math.max(0, durationMs), deadline);
  while (true) {
    if (!isCurrent(deps)) return false;
    const remaining = end - deps.now();
    if (remaining <= 0) return end <= deadline && isCurrent(deps);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.min(CURRENT_POLL_MS, remaining));
      function done() {
        deps.signal.removeEventListener("abort", onAbort);
        resolve();
      }
      function onAbort() {
        clearTimeout(timer);
        done();
      }
      deps.signal.addEventListener("abort", onAbort, { once: true });
      if (deps.signal.aborted) onAbort();
    });
  }
}

/**
 * Race a legacy head operation against interruption, owner invalidation, and
 * the bounded post-accent deadline. Late resolution never triggers a new phase.
 */
async function runHeadWithinDeadline(
  deps: BehaviorExpressionDependencies,
  deadline: number,
): Promise<{ completed: boolean }> {
  let headPromise: Promise<{ completed?: boolean } | void>;
  try {
    headPromise = Promise.resolve(deps.executeHead());
  } catch {
    return { completed: false };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setTimeout> | null = null;
  let onAbort = () => {};
  const interrupted = new Promise<{ completed: false }>((resolve) => {
    const finish = () => resolve({ completed: false });
    onAbort = finish;
    deps.signal.addEventListener("abort", onAbort, { once: true });
    const timeLeft = Math.max(0, deadline - deps.now());
    timer = setTimeout(finish, timeLeft);

    const checkCurrent = () => {
      if (!isCurrent(deps)) {
        finish();
        return;
      }
      const left = deadline - deps.now();
      if (left <= 0) {
        finish();
        return;
      }
      poll = setTimeout(checkCurrent, Math.min(CURRENT_POLL_MS, left));
    };
    poll = setTimeout(checkCurrent, Math.min(CURRENT_POLL_MS, timeLeft));
    if (deps.signal.aborted) finish();
  });

  try {
    const result = await Promise.race([headPromise, interrupted]);
    if (!isCurrent(deps)) return { completed: false };
    if (result && typeof result === "object" && result.completed === false) return { completed: false };
    return { completed: true };
  } catch {
    return { completed: false };
  } finally {
    if (timer) clearTimeout(timer);
    if (poll) clearTimeout(poll);
    deps.signal.removeEventListener("abort", onAbort);
  }
}

/** Run a locally authored prepare/accent/settle score for one still-current cue. */
export async function runBehaviorExpression(
  cue: BehaviorCue,
  deps: BehaviorExpressionDependencies,
): Promise<{ completed: boolean }> {
  const score = compileBehaviorExpression(cue);
  if (!score || !cueIsFresh(cue, deps)) return { completed: false };

  try {
    // Preparation never extends the original cue expiry. If the cue is too
    // close to expiry, skip only the eye lead and attempt the accent immediately.
    const remainingFreshness = cue.expiresAt - deps.now();
    const hasPreparationBudget = deps.reducedMotion !== true && remainingFreshness > score.prepareMs;
    if (hasPreparationBudget) {
      if (!isCurrent(deps)) return { completed: false };
      deps.present("prepare", score.prepareGaze);
      const prepared = await waitWhileCurrent(score.prepareMs, cue.expiresAt, deps);
      if (!prepared || !cueIsFresh(cue, deps)) return { completed: false };
    }

    if (!cueIsFresh(cue, deps)) return { completed: false };
    let accepted = false;
    try {
      // The adapter checks the original cue deadline synchronously here and
      // opens its independent post-start motion deadline only on acceptance.
      accepted = deps.beginAccent();
    } catch {
      return { completed: false };
    }
    if (!accepted || !isCurrent(deps)) return { completed: false };

    const accentStartedAt = deps.now();
    const closingDeadline = accentStartedAt + CLOSE_DEADLINE_MS;
    // Normal mode carries the prepared look through the head accent. Reduced
    // motion retains the approved head macro but adds no spatial display cue.
    deps.present("accent", deps.reducedMotion === true ? undefined : score.prepareGaze);
    if (!isCurrent(deps)) return { completed: false };

    const head = await runHeadWithinDeadline(deps, closingDeadline);
    if (!head.completed || !isCurrent(deps)) return { completed: false };
    if (deps.now() >= closingDeadline) return { completed: false };

    if (deps.reducedMotion === true) {
      // Reduced motion removes display choreography and the settle hold.
      deps.settle?.();
      return { completed: isCurrent(deps) };
    }

    deps.present("settle", undefined);
    const settled = await waitWhileCurrent(score.settleMs, closingDeadline, deps);
    if (!settled || !isCurrent(deps)) return { completed: false };
    deps.settle?.();
    return { completed: isCurrent(deps) };
  } catch {
    return { completed: false };
  }
}
