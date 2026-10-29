import type { BehaviorCue, BehaviorGesture } from "./behavior-types";
import { runBehaviorExpression, type BehaviorExpressionPhase } from "./behavior-expression";

export type BehaviorRehearsalFacePresentation = Pick<BehaviorCue, "mood" | "gaze"> & {
  expressionPhase: BehaviorExpressionPhase;
};

/** A controlled input for the existing native face, separate from production stores. */
export type BehaviorRehearsalFaceFixture = {
  voiceState: "attention";
  presentation: BehaviorRehearsalFacePresentation | null;
  action?: import("../character/character-action").CharacterActionFrame;
  /** Presentation-only inspection; normal playback never reads a user/model setting. */
  actionSpeed?: 0.1 | 1;
  actionProgress?: number;
};

export type BehaviorRehearsalExpressionFrame = {
  /** Offset from the start of the real-speed expression run. */
  atMs: number;
  presentation: BehaviorRehearsalFacePresentation | null;
};

export type BehaviorRehearsalExpressionResult = {
  completed: boolean;
  frames: readonly BehaviorRehearsalExpressionFrame[];
};

export type BehaviorRehearsalExpressionDependencies = {
  now(): number;
  signal: AbortSignal;
  /** Must include mock source/link, STOP generation, AppState, and run ownership. */
  isCurrent(): boolean;
  reducedMotion?: boolean;
  present(fixture: BehaviorRehearsalFaceFixture): void;
  /** Recheck the current mock session immediately before opening the head accent. */
  beginAccent(): boolean;
  /** The caller must check the supplied guard immediately before its mock write. */
  executeHead(gesture: Exclude<BehaviorGesture, "hold">, isCurrent: () => boolean): Promise<{ completed?: boolean } | void>;
  onFrames?(frames: readonly BehaviorRehearsalExpressionFrame[]): void;
};

function isCurrent(deps: BehaviorRehearsalExpressionDependencies): boolean {
  if (deps.signal.aborted) return false;
  try {
    return deps.isCurrent();
  } catch {
    return false;
  }
}

/**
 * Run the production expression score against a caller-owned local face fixture
 * and a mock-only head adapter. This module has no production store, key, or
 * network dependency.
 */
export async function runBehaviorRehearsalExpression(
  cue: BehaviorCue,
  deps: BehaviorRehearsalExpressionDependencies,
): Promise<BehaviorRehearsalExpressionResult> {
  let startedAt: number;
  try {
    startedAt = deps.now();
  } catch {
    return { completed: false, frames: [] };
  }
  if (!Number.isFinite(startedAt) || !isCurrent(deps)) return { completed: false, frames: [] };

  const frames: BehaviorRehearsalExpressionFrame[] = [];
  const publish = (presentation: BehaviorRehearsalFacePresentation | null) => {
    if (!isCurrent(deps)) return;
    deps.present({ voiceState: "attention", presentation });
    const atMs = Math.max(0, deps.now() - startedAt);
    frames.push({ atMs, presentation: presentation ? structuredCloneSafe(presentation) : null });
  };

  const result = await runBehaviorExpression(cue, {
    now: deps.now,
    signal: deps.signal,
    isCurrent: () => isCurrent(deps),
    reducedMotion: deps.reducedMotion,
    present(phase, gaze) {
      publish({
        mood: phase === "accent" ? cue.mood : null,
        gaze,
        expressionPhase: phase,
      });
    },
    beginAccent() {
      if (!isCurrent(deps) || deps.now() >= cue.expiresAt) return false;
      return deps.beginAccent();
    },
    async executeHead() {
      const guard = () => isCurrent(deps);
      if (!guard()) return { completed: false };
      return await deps.executeHead(cue.gesture as Exclude<BehaviorGesture, "hold">, guard);
    },
    settle() {
      publish(null);
    },
  });

  const completed = result.completed && isCurrent(deps);
  const captured = completed ? frames.map((frame) => ({
    atMs: frame.atMs,
    presentation: frame.presentation ? structuredCloneSafe(frame.presentation) : null,
  })) : [];
  if (completed) deps.onFrames?.(captured);
  return { completed, frames: captured };
}

/** Convert a captured real-speed trace into a visual-only replay schedule. */
export function scaleBehaviorRehearsalFrames(
  frames: readonly BehaviorRehearsalExpressionFrame[],
  speed = 0.1,
): BehaviorRehearsalExpressionFrame[] {
  const safeSpeed = Number.isFinite(speed) && speed > 0 && speed <= 1 ? speed : 0.1;
  return frames.map((frame) => ({
    atMs: Math.max(0, Math.round(frame.atMs / safeSpeed)),
    presentation: frame.presentation ? structuredCloneSafe(frame.presentation) : null,
  }));
}

/** Replay captured face frames only; this helper has no motor/controller seam. */
export function replayBehaviorRehearsalFrames(
  frames: readonly BehaviorRehearsalExpressionFrame[],
  options: {
    isCurrent(): boolean;
    present(fixture: BehaviorRehearsalFaceFixture): void;
    speed?: number;
    schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancelScheduled?: (timer: ReturnType<typeof setTimeout>) => void;
    onComplete?(): void;
  },
): () => void {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelScheduled = options.cancelScheduled ?? ((timer) => clearTimeout(timer));
  const timers: ReturnType<typeof setTimeout>[] = [];
  let active = true;
  const scaled = scaleBehaviorRehearsalFrames(frames, options.speed);
  scaled.forEach((frame, index) => {
    timers.push(schedule(() => {
      if (!active) return;
      let current = false;
      try { current = options.isCurrent(); } catch { current = false; }
      if (!current) return;
      options.present({ voiceState: "attention", presentation: frame.presentation });
      if (index === scaled.length - 1) options.onComplete?.();
    }, frame.atMs));
  });
  return () => {
    if (!active) return;
    active = false;
    for (const timer of timers) cancelScheduled(timer);
  };
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
