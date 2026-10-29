import assert from "node:assert/strict";
import fs from "node:fs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

const originalFetch = globalThis.fetch;
let apiKeyReads = 0;
let apiKey = "fake-live-check-key";
const load = createTypeScriptTreeLoader({
  "./openai-api-key": {
    getOpenAiApiKey: async () => {
      apiKeyReads += 1;
      return apiKey;
    },
  },
});
const policy = load("src/behavior/behavior-policy.ts");
const liveCheckModule = load("src/behavior/decisions-live-check.ts");
const { buildBehaviorQuestions } = policy;
const {
  DECISIONS_LIVE_CHECK_SAMPLE_TEXT,
  DECISIONS_LIVE_CHECK_CONTEXT,
  createDecisionsLiveCheck,
} = liveCheckModule;

function usage() {
  return {
    input_tokens: 12,
    input_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
    output_tokens: 3,
    output_tokens_details: { reasoning_tokens: 1 },
    total_tokens: 15,
  };
}

function validPayload(questions) {
  const selected = { cue: "curious", attention: "keep_target", intention: "wait" };
  return {
    answers: questions.map((question) => {
      if (question.type !== "choice") throw new Error("Live check only uses choice questions.");
      const choice = selected[question.name] ?? question.choices[0].value;
      const alternativeProbability = 0.1 / Math.max(1, question.choices.length - 1);
      return {
        type: "choice",
        name: question.name,
        choice,
        confidence: 0.9,
        probabilities: question.choices.map(({ value }) => ({
          value,
          probability: value === choice ? 0.9 : alternativeProbability,
        })),
      };
    }),
    usage: usage(),
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function questionsFromRequest(init) {
  const body = JSON.parse(init.body);
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.input[0].role, "developer");
  assert.deepEqual(body.input[1].content, [{ type: "input_json", data: {
    scenario: "synthetic_robot_greeting",
    sample_user_text: DECISIONS_LIVE_CHECK_SAMPLE_TEXT,
    robot_state: { connection: "mock", sleeping: false },
    note: "Synthetic sample only; no real user, conversation history, camera, identity, or sensor data.",
  } }]);
  assert.equal(body.input[1].content.some(({ type }) => type === "input_image"), false);
  assert.deepEqual(body.questions, buildBehaviorQuestions({ candidateScoring: false, hasImage: false, faceIds: [] }));
  assert.equal(body.questions.some(({ type }) => type === "score"), false);
  assert.equal(body.questions.some(({ name }) => name === "target_face" || name === "visual"), false);
  return body.questions;
}

assert.equal(DECISIONS_LIVE_CHECK_CONTEXT.sample_user_text, DECISIONS_LIVE_CHECK_SAMPLE_TEXT);
assert.equal(DECISIONS_LIVE_CHECK_SAMPLE_TEXT, "Hallo! Zeig bitte eine kleine neugierige Geste.");

const source = fs.readFileSync("src/behavior/decisions-live-check.ts", "utf8");
assert.doesNotMatch(source, /behavior-runtime|app-bootstrap|user-store|openai-api-key|secure-store|console\.(?:log|warn|error)/u);
assert.match(source, /buildBehaviorQuestions\(\{\s*candidateScoring:\s*false,\s*hasImage:\s*false,\s*faceIds:\s*\[\]\s*\}\)/u);

try {
  // Exercise the real requestDecisions client through the live-check's default dependency,
  // with an explicitly fake key and a stubbed fetch that never accesses the network.
  let fetchCalls = 0;
  let sentAuthorization = null;
  let nowCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    sentAuthorization = init.headers.Authorization;
    const questions = questionsFromRequest(init);
    return response(validPayload(questions), 200, { "x-request-id": "req_live_check_123" });
  };
  const successful = createDecisionsLiveCheck({
    canRun: () => true,
    now: () => [1000, 1043][nowCalls++],
  });
  const states = [];
  successful.subscribe((state) => states.push(state));
  const firstRun = successful.run();
  assert.strictEqual(successful.run(), firstRun, "concurrent starts coalesce into the same explicit run");
  await firstRun;
  const successState = successful.getState();
  assert.equal(successState.status, "succeeded");
  assert.equal(successState.latencyMs, 43);
  assert.equal(successState.answers.find(({ name }) => name === "cue").choice, "curious");
  assert.equal(successState.answers.length, 3);
  assert.deepEqual({
    inputTokens: successState.usage.inputTokens,
    cachedTokens: successState.usage.cachedTokens,
    cacheWriteTokens: successState.usage.cacheWriteTokens,
  }, { inputTokens: 12, cachedTokens: 1, cacheWriteTokens: 2 });
  assert.ok(Math.abs(successState.usage.costUsd - 0.00000116) < 1e-15);
  assert.equal(successState.requestId, "req_live_check_123");
  assert.equal(successState.error, null);
  assert.equal(fetchCalls, 1, "one call is made for the run, with no retry");
  assert.equal(apiKeyReads, 1);
  assert.equal(sentAuthorization, "Bearer fake-live-check-key");
  assert.equal(states[0].status, "running");
  assert.equal(states.at(-1).status, "succeeded");
  const copied = successful.getState();
  copied.answers[0].name = "changed";
  copied.usage.inputTokens = 999;
  assert.equal(successful.getState().answers[0].name, "cue", "state snapshots do not expose mutable internals");
  assert.equal(successful.getState().usage.inputTokens, 12);
  successful.dispose();

  // No provider request is sent when the debug/mock eligibility gate is closed.
  let blockedFetchCalls = 0;
  globalThis.fetch = async () => { blockedFetchCalls += 1; throw new Error("must not dispatch"); };
  const blocked = createDecisionsLiveCheck({ canRun: () => false });
  await blocked.run();
  assert.deepEqual(blocked.getState(), {
    status: "failed", latencyMs: null, answers: [], usage: null, requestId: null,
    error: { code: "not_eligible", status: null },
  });
  assert.equal(blockedFetchCalls, 0);
  blocked.dispose();

  // Client errors expose only the allow-listed code and optional HTTP status.
  apiKey = null;
  const missingKey = createDecisionsLiveCheck({ canRun: () => true });
  const beforeMissingKeyFetches = fetchCalls;
  await missingKey.run();
  assert.deepEqual(missingKey.getState().error, { code: "missing_key", status: null });
  assert.equal(fetchCalls, beforeMissingKeyFetches);
  missingKey.dispose();
  apiKey = "fake-live-check-key";

  let failedFetchCalls = 0;
  globalThis.fetch = async (url, init) => {
    failedFetchCalls += 1;
    questionsFromRequest(init);
    assert.equal(url, "https://api.openai.com/v1/decisions");
    return response({ error: { message: "must not appear in UI" } }, 401);
  };
  const unauthorized = createDecisionsLiveCheck({ canRun: () => true });
  await unauthorized.run();
  assert.deepEqual(unauthorized.getState().error, { code: "api", status: 401 });
  assert.equal(failedFetchCalls, 1, "HTTP failures are not retried");
  assert.doesNotMatch(JSON.stringify(unauthorized.getState()), /must not appear|fake-live-check-key|Authorization/u);
  unauthorized.dispose();

  globalThis.fetch = async (_url, init) => {
    questionsFromRequest(init);
    return response("not-json");
  };
  const invalidResponse = createDecisionsLiveCheck({ canRun: () => true });
  await invalidResponse.run();
  assert.deepEqual(invalidResponse.getState().error, { code: "response", status: null });
  invalidResponse.dispose();

  globalThis.fetch = async () => { throw new Error("private key should never reach state"); };
  const networkFailure = createDecisionsLiveCheck({ canRun: () => true });
  await networkFailure.run();
  assert.deepEqual(networkFailure.getState().error, { code: "network", status: null });
  assert.doesNotMatch(JSON.stringify(networkFailure.getState()), /private key|fake-live-check-key/u);
  networkFailure.dispose();

  // The controller projects only known choice answers, safe usage fields and safe request IDs
  // even when a test seam returns a non-client object.
  const safeProjection = createDecisionsLiveCheck({
    canRun: () => true,
    request: async (input) => {
      const answers = validPayload(input.questions).answers.map((answer) => ({ ...answer, secret: "drop this field" }));
      return {
        answers,
        usage: { inputTokens: 12, cachedTokens: 1, cacheWriteTokens: 2, costUsd: 0.00000116, secret: "drop this field" },
        requestId: "req/unsafe-value",
      };
    },
  });
  await safeProjection.run();
  assert.equal(safeProjection.getState().status, "succeeded");
  assert.equal(safeProjection.getState().requestId, null);
  assert.doesNotMatch(JSON.stringify(safeProjection.getState()), /drop this field|unsafe-value/u);
  safeProjection.dispose();

  const invalidInjectedResponse = createDecisionsLiveCheck({
    canRun: () => true,
    request: async (input) => {
      const result = validPayload(input.questions);
      result.answers[0].choice = "forward_motor";
      return {
        answers: result.answers,
        usage: { inputTokens: 12, cachedTokens: 1, cacheWriteTokens: 2, costUsd: 0.00000116 },
        requestId: "req_valid_123",
      };
    },
  });
  await invalidInjectedResponse.run();
  assert.equal(invalidInjectedResponse.getState().status, "failed");
  assert.deepEqual(invalidInjectedResponse.getState().error, { code: "response", status: null });
  invalidInjectedResponse.dispose();

  // Cancelling settles the public run immediately and prevents its late response from
  // replacing the next explicit run's result.
  apiKey = "fake-live-check-key";
  const firstFetch = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  let cancellationFetchCount = 0;
  let firstFetchSignal = null;
  globalThis.fetch = (url, init) => {
    cancellationFetchCount += 1;
    const questions = questionsFromRequest(init);
    assert.equal(url, "https://api.openai.com/v1/decisions");
    if (cancellationFetchCount === 1) {
      firstFetchSignal = init.signal;
      firstStarted.resolve();
      return firstFetch.promise;
    }
    secondStarted.resolve();
    return Promise.resolve(response(validPayload(questions), 200, { "x-request-id": "req_new_run" }));
  };
  const replaceable = createDecisionsLiveCheck({ canRun: () => true });
  const staleRun = replaceable.run();
  await firstStarted.promise;
  replaceable.cancel();
  await staleRun;
  assert.equal(replaceable.getState().status, "cancelled");
  assert.equal(firstFetchSignal.aborted, true, "cancel propagates to the request client");
  const currentRun = replaceable.run();
  await secondStarted.promise;
  await currentRun;
  assert.equal(replaceable.getState().status, "succeeded");
  assert.equal(replaceable.getState().requestId, "req_new_run");
  firstFetch.resolve(response(validPayload(buildBehaviorQuestions({ candidateScoring: false, hasImage: false, faceIds: [] })), 200, { "x-request-id": "req_stale_run" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replaceable.getState().status, "succeeded");
  assert.equal(replaceable.getState().requestId, "req_new_run", "late results cannot overwrite a later run");
  assert.equal(cancellationFetchCount, 2);
  replaceable.dispose();

  // A running-state observer can dismiss synchronously; the request must not dispatch afterward.
  let dismissedFetches = 0;
  globalThis.fetch = async () => { dismissedFetches += 1; throw new Error("must not dispatch after dismissal"); };
  const dismissed = createDecisionsLiveCheck({ canRun: () => true });
  dismissed.subscribe((state) => { if (state.status === "running") dismissed.cancel(); });
  await dismissed.run();
  assert.equal(dismissed.getState().status, "cancelled");
  assert.equal(dismissedFetches, 0);
  dismissed.dispose();

  // Dispose aborts in-flight work and no late resolution can publish again.
  const disposeFetch = deferred();
  const disposeStarted = deferred();
  globalThis.fetch = (url, init) => {
    const questions = questionsFromRequest(init);
    disposeStarted.resolve();
    return disposeFetch.promise.then(() => response(validPayload(questions)));
  };
  const disposed = createDecisionsLiveCheck({ canRun: () => true });
  let notificationsAfterDispose = 0;
  disposed.subscribe(() => { notificationsAfterDispose += 1; });
  const disposedRun = disposed.run();
  await disposeStarted.promise;
  disposed.dispose();
  const notificationsAtDispose = notificationsAfterDispose;
  await disposedRun;
  disposeFetch.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed.getState().status, "cancelled");
  assert.equal(notificationsAfterDispose, notificationsAtDispose);
  const disposedRunAgain = disposed.run();
  await disposedRunAgain;
  assert.equal(notificationsAfterDispose, notificationsAtDispose, "disposed checks never start another request");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Decisions live-check one-shot, response, guard, cancellation, and safe-error checks passed.");
