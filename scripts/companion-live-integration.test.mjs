import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { companionLiveCases } from "./companion-live-cases.mjs";
import { runLiveEvaluation } from "./companion-live-eval.mjs";

// This is a fake Realtime protocol trace around the real local companion
// runtime and PCM router. The fake server supplies scripted tool/text events;
// this does not evaluate model language, hearing, audio, network, or hardware.
const syntheticApiKeySentinel = "synthetic-test-token-do-not-use";

class ProtocolSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  responseCreates = [];
  serverResponses = [];
  toolOutputs = [];
  latestInstructions = "";
  responseSerial = 0;
  caseId;
  episodeId = null;

  constructor(_url, _options, caseId) {
    super();
    this.caseId = caseId;
    setImmediate(() => {
      this.emitServer({ type: "session.created", session: { id: `fake-session-${caseId}` } });
      this.emit("open");
    });
  }

  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);

    if (event.type === "session.update") {
      this.latestInstructions = String(event.session?.instructions ?? "");
      setImmediate(() => this.emitServer({ type: "session.updated", session: {} }));
      return;
    }

    if (event.type === "conversation.item.create" && event.item?.type === "function_call_output") {
      let output = {};
      try { output = JSON.parse(String(event.item.output ?? "{}")); } catch {}
      this.toolOutputs.push({ callId: event.item.call_id, output });
      // The evaluator observes the server acknowledgement separately from
      // the real client send, just as it does on the live transport.
      setImmediate(() => this.emitServer({
        type: "conversation.item.created",
        item: { type: "function_call_output", call_id: event.item.call_id },
      }));
      return;
    }

    if (event.type !== "response.create") return;
    this.responseCreates.push(event);
    const responseId = `fake-response-${++this.responseSerial}`;
    const echoedRequest = event.response?.metadata?.looi_companion_request;
    const response = {
      id: responseId,
      ...(echoedRequest ? { metadata: { looi_companion_request: echoedRequest } } : {}),
    };
    this.serverResponses.push(response);

    if (["de-recall-confirmed-long-detail-tail", "de-recall-confirmed-exact-title-compatibility"].includes(this.caseId) && this.responseSerial === 1) {
      this.episodeId = extractGerdaId(this.latestInstructions);
      const search = this.caseId === "de-recall-confirmed-long-detail-tail";
      setImmediate(() => {
        this.emitServer({ type: "response.created", response });
        this.emitServer({
          type: "response.output_item.done",
          response_id: responseId,
          item: {
            type: "function_call",
            call_id: search ? "fake-search-gerda-1" : "fake-recall-gerda-1",
            name: search ? "search_shared_experiences" : "recall_shared_experience",
            arguments: JSON.stringify(search ? { query: "unsere Rakete" } : { id: this.episodeId }),
          },
        });
        this.emitServer({
          type: "response.done",
          response: { ...response, status: "completed", output: [{ type: "function_call" }] },
        });
      });
      return;
    }

    const text = this.caseId === "de-natural-reference-correction"
      ? "Verstanden, du meinst die blaue Schachtel."
      : "Protokollantwort.";
    setImmediate(() => {
      this.emitServer({ type: "response.created", response });
      this.emitServer({
        type: "response.done",
        response: {
          ...response,
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text }] }],
        },
      });
    });
  }

  emitServer(value) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }

  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
}

function extractGerdaId(instructions) {
  const marker = "LOCAL ROBOT INTERACTION STATE (";
  const markerAt = instructions.indexOf(marker);
  assert.notEqual(markerAt, -1, "the real session.update includes bounded interaction state");
  const jsonStart = instructions.indexOf(":\n", markerAt);
  assert.notEqual(jsonStart, -1, "interaction state has the documented JSON boundary");
  const start = jsonStart + 2;
  const end = instructions.indexOf("\nUse a pending robot task", start);
  assert.ok(end > start, "interaction state ends before the production instruction rules");
  const state = JSON.parse(instructions.slice(start, end));
  const gerda = state?.companion?.episodes?.find((episode) => episode.title === "Gerda");
  assert.ok(gerda?.id, "the current Gerda user turn makes its confirmed episode id available");
  return gerda.id;
}

function testDependencies(caseId, sockets) {
  return {
    testOnly: true,
    // runLiveEvaluation currently requires a non-empty sentinel in test mode;
    // this is never used for a request because the fake socket is injected.
    apiKey: syntheticApiKeySentinel,
    ackTimeoutMs: 1_000,
    perTurnMs: 3_000,
    socketFactory: (url, options) => {
      const socket = new ProtocolSocket(url, options, caseId);
      sockets.push(socket);
      return socket;
    },
    // Deliberately omit runtimeFactory: both runtime and PCM router are real.
  };
}

const recallFixture = companionLiveCases.find((item) => item.id === "de-recall-confirmed-long-detail-tail");
const correctionFixture = companionLiveCases.find((item) => item.id === "de-natural-reference-correction");
assert.ok(recallFixture && correctionFixture, "the targeted fixtures exist");
const exactRecallFixture = {
  ...recallFixture,
  id: "de-recall-confirmed-exact-title-compatibility",
  userText: "Gerda, weißt du noch, wie wir die Papierrakete gebaut haben und was beim ersten Wurf passiert ist?",
  expected: {
    ...recallFixture.expected,
    requiredTool: "recall_shared_experience",
    requiredStatus: "recalled",
    searchQuery: undefined,
  },
  review: {
    ...recallFixture.review,
    passCriteria: ["The exact title Gerda keeps using the existing explicit recall path.", ...recallFixture.review.passCriteria],
  },
};

const recallSockets = [];
const recallReport = await runLiveEvaluation({
  cases: [recallFixture],
  ...testDependencies(recallFixture.id, recallSockets),
});
assert.equal(recallReport.status, "test_harness_only");
assert.equal(recallReport.executionKind, "injected-fake-transport-no-model-evidence");
assert.equal(recallReport.networkUsed, false);
assert.equal(recallReport.receiptMode, "simulated-text-receipt; not heard/voice verified");
assert.equal(recallReport.cases[0].status, "mechanical_checks_passed");
assert.equal(recallReport.counters.responseCreates, 2, "one model-shaped tool response and exactly one follow-up response are traced");
assert.equal(recallReport.counters.serverResponses, 2);
assert.equal(recallReport.counters.finalResponses, 1, "only the scripted follow-up contains text");
assert.deepEqual(recallReport.cases[0].observed.tools, ["search_shared_experiences"]);
assert.equal(recallReport.cases[0].observed.toolResults[0].status, "candidates_found");

const recallSocket = recallSockets[0];
assert.ok(recallSocket.episodeId, "the fake tool call used the id from actual production instructions");
assert.equal(recallSocket.responseCreates.length, 2);
assert.equal(recallSocket.serverResponses.length, 2);
assert.equal(recallSocket.toolOutputs.length, 1);
const rawSearch = recallSocket.toolOutputs[0].output;
assert.equal(rawSearch.status, "candidates_found");
assert.equal(rawSearch.totalMatches, 1);
assert.equal(rawSearch.matches.length, 1);
assert.equal(rawSearch.matches[0].episode.id, recallSocket.episodeId);
assert.equal(rawSearch.matches[0].episode.title, "Gerda", "candidate output preserves the saved title for attribution");
assert.ok(rawSearch.matches[0].matchedTerms.includes("rakete"), "the real tool output explains the descriptive lexical match");
assert.ok(rawSearch.matches[0].episode.detail.includes("Flossen dreimal"), "the real search result carries the confirmed detail tail");
assert.ok(rawSearch.matches[0].episode.detail.includes("stumpfe Nase"), "the real search result carries the late repair fact");
assert.ok(rawSearch.matches[0].episode.outcome.includes("ersten Wurf"));
assert.ok(rawSearch.matches[0].episode.outcome.includes("Zaun"), "the real search result carries the confirmed outcome tail");
assert.equal(recallReport.cases[0].observed.toolResults[0].status, rawSearch.status,
  "the evaluator observes the real outgoing candidate-search status");
const reportedSearch = recallReport.cases[0].observed.toolResults[0];
assert.equal(reportedSearch.totalMatches, rawSearch.totalMatches,
  "the bounded report retains the total candidate count from the actual sent tool output");
assert.equal(reportedSearch.matches.length, 1);
assert.deepEqual(reportedSearch.matches[0], {
  episode: {
    title: rawSearch.matches[0].episode.title,
    detail: rawSearch.matches[0].episode.detail.slice(0, 220),
    outcome: rawSearch.matches[0].episode.outcome.slice(0, 180),
    source: {
      evidence: rawSearch.matches[0].episode.source.evidence,
      sessionId: rawSearch.matches[0].episode.source.sessionId,
      at: rawSearch.matches[0].episode.source.at,
    },
  },
  matchedTerms: rawSearch.matches[0].matchedTerms,
}, "the report preserves bounded saved facts, provenance and matched terms from the actual outgoing output");
assert.equal(recallReport.cases[0].observed.responses.filter((response) => response.text).length, 1);

const exactRecallSockets = [];
const exactRecallReport = await runLiveEvaluation({
  cases: [exactRecallFixture],
  ...testDependencies(exactRecallFixture.id, exactRecallSockets),
});
assert.equal(exactRecallReport.status, "test_harness_only");
assert.equal(exactRecallReport.networkUsed, false);
assert.equal(exactRecallReport.cases[0].status, "mechanical_checks_passed");
assert.deepEqual(exactRecallReport.cases[0].observed.tools, ["recall_shared_experience"]);
assert.equal(exactRecallReport.cases[0].observed.toolResults[0].status, "recalled",
  "a separate explicit-title case retains the original exact recall flow");
const exactRecallOutput = exactRecallSockets[0].toolOutputs[0].output;
assert.equal(exactRecallOutput.episode.id, exactRecallSockets[0].episodeId);
assert.ok(exactRecallOutput.episode.detail.includes("stumpfe Nase"));

const correctionSockets = [];
const correctionReport = await runLiveEvaluation({
  cases: [correctionFixture],
  ...testDependencies(correctionFixture.id, correctionSockets),
});
assert.equal(correctionReport.status, "test_harness_only");
assert.equal(correctionReport.networkUsed, false);
assert.equal(correctionReport.cases[0].status, "mechanical_checks_passed");
assert.equal(correctionReport.cases[0].observed.engine.repairRequired, true,
  "the real runtime processes the correction and its response gate");
assert.equal(correctionReport.counters.responseCreates, 1,
  "the manual correction gate admits exactly one response");
assert.equal(correctionReport.counters.serverResponses, 1);
assert.equal(correctionReport.counters.finalResponses, 1);

const correctionSocket = correctionSockets[0];
assert.equal(correctionSocket.responseCreates.length, 1);
assert.equal(correctionSocket.serverResponses.length, 1);
const requestId = correctionSocket.responseCreates[0].response?.metadata?.looi_companion_request;
assert.ok(typeof requestId === "string" && requestId.length > 0,
  "the real correction response carries its companion request nonce");
assert.equal(correctionSocket.serverResponses[0].metadata?.looi_companion_request, requestId,
  "the fake server echoes the exact nonce so the actual PCM correlation gate accepts the response");
const sentHistory = correctionSocket.sent.filter((event) =>
  event.type === "conversation.item.create" && String(event.item?.id ?? "").startsWith("synthetic-history-"));
assert.deepEqual(sentHistory.map((event) => event.item.role), ["user", "assistant"],
  "the correction is exercised with the fixture's real inserted conversation history");

assert.equal(JSON.stringify(recallReport).includes(syntheticApiKeySentinel), false,
  "the test-only sentinel does not enter the report");
assert.equal(JSON.stringify(exactRecallReport).includes(syntheticApiKeySentinel), false);
assert.equal(JSON.stringify(correctionReport).includes(syntheticApiKeySentinel), false);

console.log("Fake-protocol integration: actual companion runtime and PCM router passed descriptive Gerda candidate search, exact-title recall compatibility, tool-output/follow-up, and correction nonce trace (no model semantics, network, hearing, audio, or hardware evidence)");
