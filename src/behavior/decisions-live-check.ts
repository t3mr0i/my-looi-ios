import { buildBehaviorQuestions } from "./behavior-policy";
import {
  DecisionsError,
  requestDecisions,
} from "../openai/decisions";
import type {
  DecisionAnswer,
  DecisionQuestion,
  DecisionResult,
  DecisionsErrorCode,
  DecisionsRequestInput,
  DecisionsRunOptions,
} from "../openai/decisions";

export const DECISIONS_LIVE_CHECK_SAMPLE_TEXT = "Hallo! Zeig bitte eine kleine neugierige Geste.";

export const DECISIONS_LIVE_CHECK_CONTEXT = Object.freeze({
  scenario: "synthetic_robot_greeting",
  sample_user_text: DECISIONS_LIVE_CHECK_SAMPLE_TEXT,
  robot_state: Object.freeze({ connection: "mock", sleeping: false }),
  note: "Synthetic sample only; no real user, conversation history, camera, identity, or sensor data.",
});

export type DecisionsLiveCheckStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
export type DecisionsLiveCheckErrorCode = DecisionsErrorCode | "not_eligible" | "unknown";
export type DecisionsLiveCheckAnswer = Extract<DecisionAnswer, { type: "choice" }>;

export interface DecisionsLiveCheckError {
  code: DecisionsLiveCheckErrorCode;
  status: number | null;
}

export interface DecisionsLiveCheckState {
  status: DecisionsLiveCheckStatus;
  latencyMs: number | null;
  answers: DecisionsLiveCheckAnswer[];
  usage: DecisionResult["usage"] | null;
  requestId: string | null;
  error: DecisionsLiveCheckError | null;
}

export type DecisionsLiveCheckRequest = (
  input: DecisionsRequestInput,
  options: Pick<DecisionsRunOptions, "signal">
) => Promise<DecisionResult>;

export interface DecisionsLiveCheckDependencies {
  /** Must return true only while the caller's debug/live-check gates are open. */
  canRun: () => boolean;
  /** Test seam; defaults to the real one-shot Decisions API client. */
  request?: DecisionsLiveCheckRequest;
  /** Test seam for deterministic latency assertions. */
  now?: () => number;
}

const ERROR_CODES = new Set<DecisionsLiveCheckErrorCode>([
  "missing_key", "invalid_request", "timeout", "cancelled", "network", "api", "response", "not_eligible", "unknown",
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function makeRequestInput(): { input: DecisionsRequestInput; questions: DecisionQuestion[] } {
  const questions = buildBehaviorQuestions({ candidateScoring: false, hasImage: false, faceIds: [] });
  return {
    input: {
      context: {
        scenario: DECISIONS_LIVE_CHECK_CONTEXT.scenario,
        sample_user_text: DECISIONS_LIVE_CHECK_SAMPLE_TEXT,
        robot_state: { ...DECISIONS_LIVE_CHECK_CONTEXT.robot_state },
        note: DECISIONS_LIVE_CHECK_CONTEXT.note,
      },
      questions,
    },
    questions,
  };
}

function safeCanRun(canRun: () => boolean): boolean {
  try { return canRun() === true; } catch { return false; }
}

function safeError(error: unknown): DecisionsLiveCheckError {
  try {
    const value = error && typeof error === "object"
      ? error as { code?: unknown; status?: unknown }
      : null;
    const code = typeof value?.code === "string" && ERROR_CODES.has(value.code as DecisionsLiveCheckErrorCode)
      ? value.code as DecisionsLiveCheckErrorCode
      : "unknown";
    const status = Number.isInteger(value?.status) && Number(value?.status) >= 100 && Number(value?.status) <= 599
      ? Number(value?.status)
      : null;
    return { code, status };
  } catch {
    return { code: "unknown", status: null };
  }
}

function sanitizeRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : null;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sanitizeResult(result: DecisionResult, questions: DecisionQuestion[]): Omit<DecisionResult, "answers"> & { answers: DecisionsLiveCheckAnswer[] } {
  const expectedNames = ["cue", "attention", "intention"];
  if (questions.length !== expectedNames.length || questions.some((question, index) =>
    question.type !== "choice" || question.name !== expectedNames[index]
  )) {
    throw new DecisionsError("response");
  }
  if (!result || typeof result !== "object" || !Array.isArray(result.answers) || result.answers.length !== questions.length) {
    throw new DecisionsError("response");
  }

  const seen = new Set<string>();
  const answers = result.answers.map((answer): DecisionsLiveCheckAnswer => {
    if (!answer || typeof answer !== "object" || answer.type !== "choice" || typeof answer.name !== "string" || seen.has(answer.name)) {
      throw new DecisionsError("response");
    }
    const question = questions.find((candidate) => candidate.name === answer.name);
    if (!question || question.type !== "choice") throw new DecisionsError("response");
    seen.add(answer.name);

    if (!question.choices.some(({ value }) => value === answer.choice) || !isProbability(answer.confidence)
      || !Array.isArray(answer.probabilities) || answer.probabilities.length !== question.choices.length) {
      throw new DecisionsError("response");
    }
    const probabilityValues = new Set<string>();
    let probabilityTotal = 0;
    const probabilities = answer.probabilities.map(({ value, probability }) => {
      if (!question.choices.some((choice) => choice.value === value) || probabilityValues.has(value) || !isProbability(probability)) {
        throw new DecisionsError("response");
      }
      probabilityValues.add(value);
      probabilityTotal += probability;
      return { value, probability };
    });
    if (probabilityValues.size !== question.choices.length || Math.abs(probabilityTotal - 1) > 0.02) {
      throw new DecisionsError("response");
    }
    return { name: question.name, type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities };
  });

  if (seen.size !== questions.length || !result.usage || !isSafeInteger(result.usage.inputTokens)
    || !isSafeInteger(result.usage.cachedTokens) || !isSafeInteger(result.usage.cacheWriteTokens)
    || result.usage.cachedTokens + result.usage.cacheWriteTokens > result.usage.inputTokens
    || typeof result.usage.costUsd !== "number" || !Number.isFinite(result.usage.costUsd) || result.usage.costUsd < 0) {
    throw new DecisionsError("response");
  }

  return {
    answers,
    usage: {
      inputTokens: result.usage.inputTokens,
      cachedTokens: result.usage.cachedTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      costUsd: result.usage.costUsd,
    },
    requestId: sanitizeRequestId(result.requestId),
  };
}

function cloneState(state: DecisionsLiveCheckState): DecisionsLiveCheckState {
  return {
    ...state,
    answers: state.answers.map((answer) => ({
      ...answer,
      probabilities: answer.probabilities.map((item) => ({ ...item })),
    })),
    usage: state.usage ? { ...state.usage } : null,
    error: state.error ? { ...state.error } : null,
  };
}

/** Performs one explicitly requested live Decisions API response check; it never actuates the robot. */
export function createDecisionsLiveCheck(deps: DecisionsLiveCheckDependencies) {
  let state: DecisionsLiveCheckState = {
    status: "idle", latencyMs: null, answers: [], usage: null, requestId: null, error: null,
  };
  const listeners = new Set<(value: DecisionsLiveCheckState) => void>();
  let generation = 0;
  let disposed = false;
  let active: { generation: number; controller: AbortController; promise: Promise<void>; settle: () => void } | null = null;

  const getState = () => cloneState(state);
  function publish(next: DecisionsLiveCheckState) {
    state = next;
    const value = getState();
    for (const listener of listeners) { try { listener(value); } catch { /* observers cannot alter check state */ } }
  }

  function cancelActive(status: "cancelled", publishState: boolean) {
    const run = active;
    if (!run) return;
    active = null;
    generation += 1;
    run.controller.abort();
    if (publishState && !disposed) {
      publish({ status, latencyMs: null, answers: [], usage: null, requestId: null, error: null });
    }
    run.settle();
  }

  function run(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (active) return active.promise;

    const runGeneration = ++generation;
    if (!safeCanRun(deps.canRun)) {
      publish({ status: "failed", latencyMs: null, answers: [], usage: null, requestId: null, error: { code: "not_eligible", status: null } });
      return Promise.resolve();
    }

    const controller = new AbortController();
    let settlePromise!: () => void;
    let settled = false;
    const promise = new Promise<void>((resolve) => {
      settlePromise = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
    });
    const runRecord = {
      generation: runGeneration,
      controller,
      promise,
      settle: settlePromise,
    };
    active = runRecord;
    publish({ status: "running", latencyMs: null, answers: [], usage: null, requestId: null, error: null });
    const startedAt = readNow(deps.now);
    const isCurrent = () => !disposed && generation === runGeneration && active === runRecord && !controller.signal.aborted;

    void (async () => {
      try {
        if (!isCurrent()) return;
        if (!safeCanRun(deps.canRun)) {
          if (isCurrent()) publish({ status: "failed", latencyMs: null, answers: [], usage: null, requestId: null, error: { code: "not_eligible", status: null } });
          return;
        }
        const { input, questions } = makeRequestInput();
        const request = deps.request ?? requestDecisions;
        const raw = await request(input, { signal: controller.signal });
        if (!isCurrent()) return;
        if (!safeCanRun(deps.canRun)) {
          publish({ status: "cancelled", latencyMs: null, answers: [], usage: null, requestId: null, error: null });
          return;
        }
        const result = sanitizeResult(raw, questions);
        publish({
          status: "succeeded",
          latencyMs: Math.max(0, Math.round(readNow(deps.now) - startedAt)),
          answers: result.answers,
          usage: result.usage,
          requestId: result.requestId,
          error: null,
        });
      } catch (error) {
        if (!isCurrent()) return;
        const safe = safeError(error);
        if (safe.code === "cancelled") {
          publish({ status: "cancelled", latencyMs: null, answers: [], usage: null, requestId: null, error: null });
        } else {
          publish({ status: "failed", latencyMs: null, answers: [], usage: null, requestId: null, error: safe });
        }
      } finally {
        if (active === runRecord) active = null;
        runRecord.settle();
      }
    })();
    return promise;
  }

  function readNow(now?: () => number): number {
    const clock = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const value = now ? now() : clock();
      return typeof value === "number" && Number.isFinite(value) ? value : clock();
    } catch {
      return clock();
    }
  }

  return {
    getState,
    subscribe(listener: (value: DecisionsLiveCheckState) => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    cancel() {
      cancelActive("cancelled", true);
    },
    dispose() {
      if (disposed) return;
      cancelActive("cancelled", true);
      disposed = true;
      listeners.clear();
    },
  };
}
