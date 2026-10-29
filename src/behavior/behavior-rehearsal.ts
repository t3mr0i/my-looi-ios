import { createBehaviorEngine } from "./behavior-engine";
import type { BehaviorCue, BehaviorGesture } from "./behavior-types";
import type { DecisionAnswer, DecisionQuestion, DecisionResult } from "../openai/decisions";

export const BEHAVIOR_REHEARSAL_SCENARIOS = [
  { id: "curiosity" },
  { id: "celebration" },
  { id: "less-nodding" },
  { id: "interrupted" },
] as const;

export type BehaviorRehearsalScenarioId = (typeof BEHAVIOR_REHEARSAL_SCENARIOS)[number]["id"];
export type BehaviorRehearsalStatus = "idle" | "running" | "passed" | "failed" | "cancelled";
export interface BehaviorRehearsalTrace {
  kind: string;
  reason?: string;
}
export interface BehaviorRehearsalState {
  status: BehaviorRehearsalStatus;
  scenarioId: BehaviorRehearsalScenarioId | null;
  expected: BehaviorGesture | null;
  observed: BehaviorGesture | null;
  decisionCount: number;
  executionCount: number;
  traces: BehaviorRehearsalTrace[];
  error: string | null;
}

export interface BehaviorRehearsalDependencies {
  /** Must fail closed unless the current mock robot is eligible for this rehearsal. */
  canRun: () => boolean;
  /** Execute only through the caller's guarded mock adapter. Check isCurrent immediately before each write. */
  executeCue: (cue: BehaviorCue, isCurrent: () => boolean) => Promise<unknown> | unknown;
}

const MAX_TRACES = 12;
const REHEARSAL_BUDGET_USD = 0.25;
const OPERATION_TIMEOUT_MS = 1_500;
const CUE_CLOSE_TIMEOUT_MS = 1_500;
const CUE_CLOSE_EXPIRED = Symbol("cue-close-deadline");
const expectedGesture: Record<BehaviorRehearsalScenarioId, BehaviorGesture | null> = {
  curiosity: "curious",
  celebration: "happy_bob",
  "less-nodding": "hold",
  interrupted: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function resultFor(questions: DecisionQuestion[], cue: BehaviorGesture): DecisionResult {
  const answers: DecisionAnswer[] = questions.map((question) => {
    if (question.type === "choice") {
      const value = question.choices.some((choice) => choice.value === cue) && question.name === "cue"
        ? cue
        : question.choices.some((choice) => choice.value === "keep_target")
          ? "keep_target"
          : question.choices[0]?.value ?? "";
      return {
        name: question.name,
        type: "choice",
        choice: value,
        confidence: 0.99,
        probabilities: question.choices.map((choice) => ({ value: choice.value, probability: choice.value === value ? 1 : 0 })),
      };
    }
    if (question.type === "predicate") return { name: question.name, type: "predicate", probability: 0 };
    const score = 0;
    return {
      name: question.name,
      type: "score",
      score,
      confidence: 0.99,
      probabilities: question.levels.map((level, index) => ({ value: index, label: level.label, probability: index === score ? 1 : 0 })),
    };
  });
  return { answers, usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-behavior-rehearsal" };
}

function safeCanRun(canRun: () => boolean): boolean {
  try { return canRun() === true; } catch { return false; }
}

function rejectedByAdapter(value: unknown): boolean {
  if (value === false) return true;
  if (!value || typeof value !== "object") return false;
  const result = value as { accepted?: unknown; completed?: unknown; ok?: unknown; cancelled?: unknown; canceled?: unknown };
  return result.accepted === false || result.completed === false || result.ok === false || result.cancelled === true || result.canceled === true;
}

/** Runs the real behavior policy against isolated, deterministic, offline provider answers. */
export function createBehaviorRehearsal(deps: BehaviorRehearsalDependencies) {
  let state: BehaviorRehearsalState = {
    status: "idle", scenarioId: null, expected: null, observed: null,
    decisionCount: 0, executionCount: 0, traces: [], error: null,
  };
  const listeners = new Set<(value: BehaviorRehearsalState) => void>();
  let generation = 0;
  let disposed = false;
  let engine: ReturnType<typeof createBehaviorEngine> | null = null;
  let activeRun: Promise<void> | null = null;
  let settleWait: (() => void) | null = null;

  function snapshot(value = state): BehaviorRehearsalState {
    return { ...value, traces: value.traces.map((item) => ({ ...item })) };
  }
  function publish(patch: Partial<BehaviorRehearsalState>) {
    state = { ...state, ...patch };
    const value = snapshot();
    for (const listener of listeners) { try { listener(value); } catch {} }
  }
  function record(kind: string, reason?: string) {
    const entry = { kind, ...(reason ? { reason: reason.slice(0, 120) } : {}) };
    publish({ traces: [...state.traces, entry].slice(-MAX_TRACES) });
  }
  function finishWait() {
    const done = settleWait;
    settleWait = null;
    done?.();
  }

  async function runScenario(scenarioId: BehaviorRehearsalScenarioId): Promise<void> {
    if (disposed) return;
    const scenario = BEHAVIOR_REHEARSAL_SCENARIOS.find((item) => item.id === scenarioId);
    if (!scenario) {
      publish({ status: "failed", scenarioId: null, expected: null, observed: null, decisionCount: 0, executionCount: 0, traces: [], error: "Unknown rehearsal scenario." });
      record("failed", "unknown-scenario");
      return;
    }

    const runGeneration = ++generation;
    const expected = expectedGesture[scenarioId];
    const isRunGenerationCurrent = () => !disposed && generation === runGeneration && state.scenarioId === scenarioId;
    const traceRun = (kind: string, reason?: string) => {
      if (isRunGenerationCurrent()) record(kind, reason);
    };
    publish({ status: "running", scenarioId, expected, observed: null, decisionCount: 0, executionCount: 0, traces: [], error: null });
    if (!safeCanRun(deps.canRun)) {
      publish({ status: "failed", error: "Mock robot is not eligible for rehearsal." });
      traceRun("blocked", "mock-not-ready");
      return;
    }

    const lateDecision = deferred<DecisionResult>();
    let requestedQuestions: DecisionQuestion[] = [];
    let isInterruptedScenario = scenarioId === "interrupted";
    let adapterPromise: Promise<void> | null = null;
    let guardFailure: string | null = null;
    const isRunCurrent = () => !disposed && generation === runGeneration && state.status === "running";

    engine = createBehaviorEngine({
      decide: (request, _options) => {
        requestedQuestions = request.questions;
        publish({ decisionCount: state.decisionCount + 1 });
        traceRun("decision-requested", "offline-deterministic-provider");
        const cue: BehaviorGesture = scenarioId === "curiosity" ? "curious"
          : scenarioId === "celebration" ? "happy_bob"
            : scenarioId === "less-nodding" ? "nod" : "curious";
        return isInterruptedScenario ? lateDecision.promise : Promise.resolve(resultFor(request.questions, cue));
      },
      executeCue: (cue) => {
        if (!isRunCurrent()) return;
        if (cue.presentationOnly) { traceRun("display-only", cue.gesture); return; }
        if (cue.gesture === "hold") {
          if (!safeCanRun(deps.canRun)) {
            guardFailure = "Mock robot became unavailable or ineligible.";
            traceRun("cue-blocked", "mock-not-ready");
            return;
          }
          publish({ observed: "hold" });
          traceRun("policy-hold", "behavior policy selected hold; no mock write");
          return;
        }
        if (!safeCanRun(deps.canRun)) {
          guardFailure = "Mock robot became unavailable or ineligible.";
          traceRun("cue-blocked", "mock-not-ready");
          return;
        }
        if (performance.now() > cue.expiresAt) {
          guardFailure = "The behavior cue expired before execution.";
          traceRun("cue-blocked", "cue-expired");
          return;
        }
        publish({ observed: cue.gesture, executionCount: state.executionCount + 1 });
        traceRun("cue-requested", cue.gesture);
        const executionDeadline = performance.now() + CUE_CLOSE_TIMEOUT_MS;
        const current = () => {
          if (!isRunCurrent()) return false;
          if (performance.now() > executionDeadline) { guardFailure = "The mock cue did not finish before its closing deadline."; return false; }
          if (!safeCanRun(deps.canRun)) { guardFailure = "Mock robot became unavailable or ineligible."; return false; }
          return true;
        };
        adapterPromise = (async () => {
          let timeout: ReturnType<typeof setTimeout> | null = null;
          try {
            const expired = new Promise<typeof CUE_CLOSE_EXPIRED>((resolve) => {
              timeout = setTimeout(() => resolve(CUE_CLOSE_EXPIRED), Math.max(0, executionDeadline - performance.now()));
            });
            const result = await Promise.race([Promise.resolve().then(() => current() ? deps.executeCue(cue, current) : false), expired]);
            if (result === CUE_CLOSE_EXPIRED) {
              guardFailure = "The mock cue did not finish before its closing deadline.";
              traceRun("cue-expired", "deadline");
              return;
            }
            if (!current()) {
              if (guardFailure) traceRun("cue-blocked", guardFailure);
              return;
            }
            if (rejectedByAdapter(result)) {
              guardFailure = "The mock adapter cancelled the cue.";
              traceRun("cue-cancelled", "adapter-rejected");
              return;
            }
            traceRun("cue-executed", cue.gesture);
          } catch {
            guardFailure = "The mock adapter rejected the cue.";
            traceRun("cue-failed", "adapter-rejected");
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        })();
        return adapterPromise;
      },
      traceLimit: 16,
    });
    const currentEngine = engine;
    currentEngine.configure({ mode: "active", dailyBudgetUsd: REHEARSAL_BUDGET_USD, visualEnabled: false, candidateScoring: true });
    currentEngine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: false, cameraEnabled: false, userSpeaking: false, assistantSpeaking: false, motionActive: false });
    const sessionId = `offline-rehearsal-${runGeneration}`;
    currentEngine.dispatch({ type: "session-start", sessionId });

    let decisionTimer: ReturnType<typeof setTimeout> | null = null;
    const outcome = new Promise<void>((resolve) => {
      let settled = false;
      const unsubscribe = currentEngine.subscribe((value) => {
        if (value.metrics.completed > 0 || value.metrics.stale > 0 || value.metrics.failed > 0 || value.metrics.timedOut > 0) {
          finish();
        }
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        if (decisionTimer) clearTimeout(decisionTimer);
        decisionTimer = null;
        if (settleWait === finish) settleWait = null;
        resolve();
      };
      settleWait = finish;
      decisionTimer = setTimeout(finish, OPERATION_TIMEOUT_MS);
    });

    try {
      const userText = scenarioId === "less-nodding" ? "Please nod less" : scenarioId === "celebration" ? "That worked!" : "Tell me about that";
      // Accept the input while the local speech edge still owns the turn, then
      // exercise the one physical beat after an explicitly heard output.
      currentEngine.setEnvironment({ userSpeaking: true });
      currentEngine.dispatch({ type: "user-turn", text: userText, sessionId });
      currentEngine.dispatch({ type: "user-speech-end", sessionId });
      currentEngine.dispatch({ type: "assistant-start", sessionId });
      currentEngine.dispatch({ type: "assistant-end", text: scenarioId === "celebration" ? "We did it!" : "Let's look at that together.", sessionId });
      if (isInterruptedScenario) {
        if (state.decisionCount !== 1) throw new Error("The offline decision did not start.");
        currentEngine.dispatch({ type: "interrupt", reason: "rehearsal-interruption", sessionId });
        traceRun("decision-interrupted", "before deterministic result");
        isInterruptedScenario = false;
        lateDecision.resolve(resultFor(requestedQuestions, "curious"));
      }
      await outcome;
      if (decisionTimer) clearTimeout(decisionTimer);
      decisionTimer = null;
      if (!isRunCurrent()) return;
      if (state.decisionCount !== 1) throw new Error("The offline decision did not complete.");
      if (isInterruptedScenario || currentEngine.getState().metrics.stale > 0) {
        publish({ observed: null });
        traceRun("late-result-discarded", "engine generation was interrupted");
        const pass = state.executionCount === 0 && currentEngine.getState().cue === undefined;
        publish({ status: pass ? "passed" : "failed", error: pass ? null : "An interrupted cue was not safely discarded." });
        if (pass) traceRun("scenario-passed", "no cue executed after interrupt");
        return;
      }
      if (currentEngine.getState().metrics.failed > 0 || currentEngine.getState().metrics.timedOut > 0) throw new Error("The offline behavior decision failed or timed out.");
      if (state.observed !== expected) throw new Error(`Expected ${expected ?? "no cue"}; observed ${state.observed ?? "no cue"}.`);
      if (state.observed !== "hold") {
        if (!adapterPromise) throw new Error("The mock adapter was not called.");
        await adapterPromise;
      }
      if (!isRunCurrent()) return;
      if (guardFailure) throw new Error(guardFailure);
      if (currentEngine.getState().metrics.failed > 0 || currentEngine.getState().metrics.timedOut > 0) throw new Error("The offline behavior decision failed or timed out.");
      publish({ status: "passed", error: null });
      traceRun("scenario-passed", expected ?? "no cue");
    } catch (error) {
      if (!isRunCurrent()) return;
      const message = error instanceof Error ? error.message : "Behavior rehearsal failed.";
      publish({ status: "failed", error: message.slice(0, 160) });
      traceRun("scenario-failed", message);
    } finally {
      if (decisionTimer) clearTimeout(decisionTimer);
      if (generation === runGeneration) {
        currentEngine.dispose();
        if (engine === currentEngine) engine = null;
        settleWait = null;
      }
    }
  }

  function run(scenarioId: BehaviorRehearsalScenarioId): Promise<void> {
    if (disposed) return Promise.resolve();
    if (state.status === "running" && activeRun) return activeRun;
    const task = runScenario(scenarioId);
    activeRun = task;
    void task.then(() => { if (activeRun === task) activeRun = null; }, () => { if (activeRun === task) activeRun = null; });
    return task;
  }

  function cancel() {
    if (state.status !== "running") return;
    generation += 1;
    try { engine?.dispatch({ type: "interrupt", reason: "rehearsal-cancelled" }); } catch {}
    engine?.dispose();
    engine = null;
    publish({ status: "cancelled", error: "Rehearsal cancelled." });
    record("cancelled", "run generation invalidated");
    finishWait();
    activeRun = null;
  }

  function dispose() {
    if (disposed) return;
    cancel();
    disposed = true;
    engine?.dispose();
    engine = null;
    listeners.clear();
  }

  return {
    getState: () => snapshot(),
    subscribe(listener: (value: BehaviorRehearsalState) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    cancel,
    dispose,
  };
}
