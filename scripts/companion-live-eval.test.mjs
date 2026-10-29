import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { runLiveEvaluation } from "./companion-live-eval.mjs";

class FakeSocket extends EventEmitter {
  readyState = 1;
  updateCount = 0;
  responseCount = 0;
  sent = [];

  constructor(_url, _options, scenario) {
    super();
    this.scenario = scenario;
    setImmediate(() => {
      // Exercise the real race: the server can send session.created before
      // the runner has attached its post-open event consumer.
      this.emit("message", Buffer.from(JSON.stringify({ type: "session.created", session: { id: "fake-session" } })));
      this.emit("open");
    });
  }

  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === "session.update") {
      this.updateCount += 1;
      if (this.scenario.ackUpdates !== false || this.updateCount < 3) {
        setTimeout(() => this.emitMessage({ type: "session.updated", session: {} }), 2);
      }
    }
    if (event.type === "response.cancel") {
      setTimeout(() => this.emitMessage({ type: "error", error: { code: "response_cancel_not_active", event_id: this.scenario.badCancelCorrelation ? "unmatched-id" : event.event_id, message: "safe fake" } }), 1);
    }
    if (event.type === "response.create") {
      this.responseCount += 1;
      const id = `fake-response-${this.responseCount}`;
      setTimeout(() => {
        this.emitMessage({ type: "response.created", response: { id } });
        if (this.scenario.responseStatus === "cancelled") {
          this.emitMessage({ type: "response.output_text.delta", response_id: id, delta: "partial" });
          this.emitMessage({ type: "response.done", response: { id, status: "cancelled", output: [] } });
          return;
        }
        if (this.scenario.tool && this.responseCount === 1) {
          this.emitMessage({ type: "response.output_item.done", response_id: id, item: { type: "function_call", call_id: "fake-call-1", name: "manage_shared_activity", arguments: "{}" } });
          this.emitMessage({ type: "response.done", response: { id, status: "completed", output: [{ type: "function_call" }] } });
          return;
        }
        this.emitMessage({ type: "response.output_text.delta", response_id: id, delta: "Eine kleine Idee." });
        this.emitMessage({ type: "response.done", response: { id, status: "completed", usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 }, output: [{ content: [{ type: "output_text", text: "Eine kleine Idee." }] }] } });
        if (this.scenario.errorAfterResponse) this.emitMessage({ type: "error", error: { code: "synthetic_failure", message: "test-only" } });
      }, 2);
    }
  }

  emitMessage(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
}

function createFakeRuntime(scenario) {
  const events = {
    beginBehaviorSession(_id, update) { this.updateContext = update; update(); },
    endBehaviorSession() {},
    publishBehaviorEvent() {},
    performBehaviorCompanionAction() { return { ok: true }; },
    triggerContextUpdate() { this.updateContext?.(); },
  };
  const service = {
    active: false,
    configured: false,
    sessionId: null,
    webSocket: null,
    toolCallsInFlight: 0,
    pendingCompanionToolCalls: new Map(),
    applySessionPreferences() { this.webSocket.send(JSON.stringify({ type: "session.update", session: {} })); return true; },
    async handleEvent(event) {
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        scenario.transcripts ??= [];
        scenario.transcripts.push(String(event.transcript ?? ""));
        if (scenario.cancelWarning) this.webSocket.send(JSON.stringify({ type: "response.cancel" }));
        if (scenario.hardCap) {
          for (let i = 0; i < 25; i += 1) this.webSocket.send(JSON.stringify({ type: "response.create" }));
        }
      }
      if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
        this.toolCallsInFlight += 1;
        if (scenario.slowTool) {
          setTimeout(() => {
            if (this.active && this.sessionId) {
              this.webSocket.send(JSON.stringify({ type: "response.create" }));
            }
            this.toolCallsInFlight = 0;
          }, 180);
          return;
        }
        this.webSocket.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.item.call_id, output: JSON.stringify({ ok: true, status: "pending_confirmation", results: [], episode: { title: "Gerda", detail: "Silberne Flügel", outcome: "Landete am Zaun" } }) } }));
        this.webSocket.send(JSON.stringify({ type: "response.create" }));
        this.toolCallsInFlight -= 1;
      }
    },
  };
  return {
    events,
    behaviorEngine: { getState: () => ({}) },
    RealtimePcmConversationService: class { constructor() { return service; } },
    uninstallRuntime() {},
  };
}

function dependencies(scenario = {}) {
  return {
    testOnly: true,
    apiKey: "synthetic-test-token-do-not-use",
    model: "fake-model-not-a-live-model",
    ackTimeoutMs: 100,
    socketFactory: (url, options) => new FakeSocket(url, options, scenario),
    runtimeFactory: () => createFakeRuntime(scenario),
  };
}

const testCase = { id: "fake-case", userText: "Hallo", expected: {} };

const preflight = spawnSync(process.execPath, ["scripts/companion-live-eval.mjs"], { encoding: "utf8" });
assert.equal(preflight.status, 0);
assert.equal(JSON.parse(preflight.stdout).networkUsed, false);

const cancellation = await runLiveEvaluation({ cases: [testCase], ...dependencies({ cancelWarning: true }) });
assert.equal(cancellation.status, "test_harness_only");
assert.notEqual(cancellation.status, "completed");
assert.match(cancellation.semanticReview, /not machine-evaluated/);
assert.deepEqual(cancellation.cases[0].warnings.map((warning) => warning.kind), ["cancel_no_active_response"]);
assert.equal(cancellation.counters.responseCreates, 1);

const uncorrelatedCancel = await runLiveEvaluation({ cases: [testCase], ...dependencies({ cancelWarning: true, badCancelCorrelation: true }) });
assert.equal(uncorrelatedCancel.status, "blocked");

const updated = await runLiveEvaluation({
  cases: [{ ...testCase, setup: ({ events }) => events.triggerContextUpdate() }],
  ...dependencies(),
});
assert.equal(updated.cases[0].status, "mechanical_checks_passed");
assert.equal(updated.counters.responseCreates, 1);

const multiTurnScenario = {};
let multiTurnSocket;
const multiTurn = await runLiveEvaluation({
  suiteId: "continuity",
  cases: [{
    id: "two-turn-offsets",
    turns: [
      { id: "first", userText: "Erste Frage.", expected: {}, review: { passCriteria: ["Erste Antwort."] } },
      { id: "second", userText: "Und noch eine.", expected: {}, review: { passCriteria: ["Zweite Antwort."] } },
    ],
  }],
  ...dependencies(multiTurnScenario),
  socketFactory: (url, options) => { multiTurnSocket = new FakeSocket(url, options, multiTurnScenario); return multiTurnSocket; },
});
assert.equal(multiTurn.suiteId, "continuity");
assert.equal(multiTurn.status, "test_harness_only");
assert.equal(multiTurn.cases[0].status, "mechanical_checks_passed");
assert.deepEqual(multiTurnScenario.transcripts, ["Erste Frage.", "Und noch eine."]);
assert.deepEqual(multiTurn.cases[0].turns.map((turn) => turn.id), ["first", "second"]);
assert.deepEqual(multiTurn.cases[0].turns.map((turn) => turn.status), ["mechanical_checks_passed", "mechanical_checks_passed"]);
assert.deepEqual(multiTurn.cases[0].turns.map((turn) => turn.observed.offsets.responseCreates), [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
assert.deepEqual(multiTurn.cases[0].turns.map((turn) => turn.observed.offsets.done), [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
assert.deepEqual(multiTurn.cases[0].turns.map((turn) => turn.observed.offsets.eventIndexes.responses), [[0], [1]]);
assert.deepEqual(multiTurn.cases[0].observed.responses.map((response) => response.turnIndex), [0, 1]);
assert.equal(multiTurnSocket.sent.filter((event) => event.type === "conversation.item.create" && event.item.role === "assistant").length, 0,
  "completed assistant model responses stay in the same server conversation and are not synthetic history copies");

const stopAfterFailureScenario = {};
let stopAfterFailureSocket;
const stopAfterFailure = await runLiveEvaluation({
  cases: [{
    id: "stop-after-failed-turn",
    turns: [
      { id: "failed", userText: "Prüfe zuerst diese Frage.", expected: { state: () => false } },
      { id: "synthetic-yes", userText: "Ja.", expected: {} },
    ],
  }],
  ...dependencies(stopAfterFailureScenario),
  socketFactory: (url, options) => { stopAfterFailureSocket = new FakeSocket(url, options, stopAfterFailureScenario); return stopAfterFailureSocket; },
});
assert.equal(stopAfterFailure.cases[0].status, "mechanical_checks_failed");
assert.equal(stopAfterFailure.cases[0].turns[0].status, "mechanical_checks_failed");
assert.equal(stopAfterFailure.cases[0].turns[1].status, "not_run_after_previous_turn_failure");
assert.deepEqual(stopAfterFailureScenario.transcripts, ["Prüfe zuerst diese Frage."]);
assert.equal(stopAfterFailureSocket.sent.some((event) => event.type === "conversation.item.create" && event.item.content?.[0]?.text === "Ja."), false,
  "the runner does not send a synthetic confirmation after a failed first turn");

let invalidSocketCalls = 0;
const invalidTurns = await runLiveEvaluation({
  cases: [{ id: "too-many-turns", turns: Array.from({ length: 4 }, (_, index) => ({ id: `turn-${index + 1}`, userText: `Turn ${index + 1}.`, expected: {} })) }],
  ...dependencies(),
  socketFactory: () => { invalidSocketCalls += 1; throw new Error("invalid fixture must stop before socket construction"); },
});
assert.equal(invalidTurns.status, "blocked");
assert.equal(invalidTurns.networkUsed, false);
assert.match(invalidTurns.reason, /1 to 3 turns/);
assert.equal(invalidSocketCalls, 0);

const invalidText = await runLiveEvaluation({
  cases: [{ id: "empty-turn", turns: [{ id: "empty", userText: "  ", expected: {} }] }],
  ...dependencies(),
  socketFactory: () => { invalidSocketCalls += 1; throw new Error("invalid fixture must stop before socket construction"); },
});
assert.equal(invalidText.status, "blocked");
assert.match(invalidText.reason, /non-empty plain text/);
assert.equal(invalidSocketCalls, 0);

const tooManyCases = await runLiveEvaluation({
  cases: Array.from({ length: 7 }, (_, index) => ({ id: `case-${index + 1}`, userText: "Hallo", expected: {} })),
  ...dependencies(),
  socketFactory: () => { invalidSocketCalls += 1; throw new Error("over-cap suite must stop before socket construction"); },
});
assert.equal(tooManyCases.status, "blocked");
assert.match(tooManyCases.reason, /at most 6 cases/);
assert.equal(invalidSocketCalls, 0);

const missingAck = await runLiveEvaluation({
  cases: [{ ...testCase, setup: ({ events }) => events.triggerContextUpdate() }],
  ...dependencies({ ackUpdates: false }),
});
assert.equal(missingAck.status, "blocked");
assert.match(missingAck.reason, /context update timed out/);

const tool = await runLiveEvaluation({ cases: [testCase], ...dependencies({ tool: true }) });
assert.equal(tool.cases[0].observed.tools[0], "manage_shared_activity");
assert.equal(tool.cases[0].observed.toolResults[0].status, "pending_confirmation");
assert.equal(tool.cases[0].observed.toolResults[0].source, "client-send");
assert.equal(tool.cases[0].observed.toolResults[0].episode.outcome, "Landete am Zaun");

const incomplete = await runLiveEvaluation({ cases: [testCase], ...dependencies({ responseStatus: "cancelled" }) });
assert.equal(incomplete.status, "test_harness_only");
assert.equal(incomplete.cases[0].status, "mechanical_checks_failed");
assert.ok(incomplete.cases[0].violations.some((value) => value.includes("completed Realtime response")));

const capped = await runLiveEvaluation({ cases: [testCase], ...dependencies({ hardCap: true }) });
assert.equal(capped.status, "blocked");
assert.equal(capped.counters.responseCreates, 24);
assert.equal(capped.counters.responseCreateAttempts, 25);

const partial = await runLiveEvaluation({ cases: [testCase], ...dependencies({ errorAfterResponse: true }) });
assert.equal(partial.status, "blocked");
assert.equal(partial.cases[0].observed.responses.length, 1);
assert.equal(partial.usage.outputTokens, 3);

const cancelledAsync = await runLiveEvaluation({ cases: [testCase], ...dependencies({ tool: true, slowTool: true }), perTurnMs: 50 });
assert.equal(cancelledAsync.status, "blocked");
const countAtTermination = cancelledAsync.counters.responseCreates;
await new Promise((resolve) => setTimeout(resolve, 220));
assert.equal(cancelledAsync.counters.responseCreates, countAtTermination);

const auth = await runLiveEvaluation({
  cases: [testCase],
  ...dependencies(),
  socketFactory: () => {
    const socket = new EventEmitter();
    socket.readyState = 0;
    socket.terminate = () => { socket.readyState = 3; };
    socket.close = () => { socket.readyState = 3; };
    setImmediate(() => {
      const response = { statusCode: 401, resume() {} };
      socket.emit("unexpected-response", {}, response);
    });
    return socket;
  },
});
assert.equal(auth.status, "blocked");
assert.ok(!JSON.stringify(auth).includes("synthetic-test-token-do-not-use"));

let historySocket;
await runLiveEvaluation({
  cases: [{ ...testCase, history: [{ role: "user", text: "Vorheriger Satz." }, { role: "assistant", text: "Vorherige Antwort." }] }],
  ...dependencies(),
  socketFactory: (url, options) => { historySocket = new FakeSocket(url, options, {}); return historySocket; },
});
assert.deepEqual(historySocket.sent.filter((event) => event.type === "conversation.item.create").slice(0, 2).map((event) => event.item.content[0].type), ["input_text", "output_text"]);

console.log("companion live-eval fake-protocol tests passed (no model/network evidence)");
