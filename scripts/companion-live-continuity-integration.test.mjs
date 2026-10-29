import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { getCompanionLiveSuite } from "./companion-live-suites.mjs";
import { runLiveEvaluation } from "./companion-live-eval.mjs";

// This fake Realtime trace runs the actual local companion runtime, its PCM
// conversation service, and production session configuration. Scripted
// function events and text are fixtures, not model evidence or speech/audio.
const syntheticApiKeySentinel = "synthetic-test-token-do-not-use";
const CORRECTION_CASE_ID = "de-continuity-correction-confirmed-recall";
const OVERVIEW_CASE_ID = "de-continuity-overview-three-experiences";
const GAME_CASE_ID = "de-continuity-game-pause-return";

class ContinuityProtocolSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  responseCreates = [];
  serverResponses = [];
  toolOutputs = [];
  sessionUpdates = [];
  userInputs = [];
  latestInstructions = "";
  responseSerial = 0;
  activeTurnIndex = -1;
  invokedToolForTurn = new Set();

  constructor(_url, _options, testCase, scenario = {}) {
    super();
    this.testCase = testCase;
    this.scenario = scenario;
    this.turns = Array.isArray(testCase.turns) ? testCase.turns : [testCase];
    setImmediate(() => {
      this.emitServer({ type: "session.created", session: { id: `fake-session-${testCase.id}` } });
      this.emit("open");
    });
  }

  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);

    if (event.type === "session.update") {
      this.sessionUpdates.push(event.session ?? {});
      this.latestInstructions = String(event.session?.instructions ?? "");
      setImmediate(() => this.emitServer({ type: "session.updated", session: {} }));
      return;
    }

    if (event.type === "conversation.item.create" && event.item?.type === "function_call_output") {
      let output = {};
      try { output = JSON.parse(String(event.item.output ?? "{}")); } catch {}
      this.toolOutputs.push({ callId: event.item.call_id, output });
      // The PCM transport waits for the server acknowledgement before it
      // considers a function result complete.
      setImmediate(() => this.emitServer({
        type: "conversation.item.created",
        item: { type: "function_call_output", call_id: event.item.call_id },
      }));
      return;
    }

    if (event.type === "conversation.item.create" && event.item?.role === "user") {
      const text = String(event.item?.content?.[0]?.text ?? "");
      this.userInputs.push(text);
      const matched = this.turns.findIndex((turn) => turn.userText === text);
      if (matched >= 0) this.activeTurnIndex = matched;
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

    const tool = this.toolForActiveTurn();
    if (tool && !this.invokedToolForTurn.has(this.activeTurnIndex)) {
      this.invokedToolForTurn.add(this.activeTurnIndex);
      const args = this.argumentsForTool(tool);
      setImmediate(() => {
        this.emitServer({ type: "response.created", response });
        this.emitServer({
          type: "response.output_item.done",
          response_id: responseId,
          item: {
            type: "function_call",
            call_id: `fake-${this.testCase.id}-turn-${this.activeTurnIndex}-${tool}`,
            name: tool,
            arguments: JSON.stringify(args),
          },
        });
        this.emitServer({
          type: "response.done",
          response: { ...response, status: "completed", output: [{ type: "function_call" }] },
        });
      });
      return;
    }

    const turnIndex = this.activeTurnIndex;
    const matchingToolOutput = this.toolOutputs.at(-1)?.output;
    let text = "Okay.";
    if (this.testCase.id.startsWith(CORRECTION_CASE_ID) && turnIndex === 0) {
      const question = String(matchingToolOutput?.confirmationQuestion ?? "");
      if (this.scenario.confirmationResponse === "missing") text = "";
      else if (this.scenario.confirmationResponse === "wrong") text = "Soll ich Gerda speichern?";
      else text = question;
    } else if (this.testCase.id === OVERVIEW_CASE_ID) {
      const episodes = Array.isArray(matchingToolOutput?.episodes) ? matchingToolOutput.episodes : [];
      text = episodes.length
        ? `Ich erinnere mich an ${episodes.map((episode) => episode.title).join(", ")}.`
        : "Ich habe die gespeicherten Erlebnisse angesehen.";
    } else if (this.testCase.id.startsWith(CORRECTION_CASE_ID) && turnIndex === 2) {
      const episode = matchingToolOutput?.episode;
      text = episode?.outcome ?? episode?.detail ?? "Ich habe Gerda abgerufen.";
    }

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

  toolForActiveTurn() {
    if (this.testCase.id.startsWith(CORRECTION_CASE_ID)) {
      if (this.activeTurnIndex === 0) return "correct_shared_experience";
      if (this.activeTurnIndex === 2) return "recall_shared_experience";
    }
    if (this.testCase.id === OVERVIEW_CASE_ID && this.activeTurnIndex === 0) return "list_shared_experiences";
    return null;
  }

  argumentsForTool(name) {
    if (name === "list_shared_experiences") return {};
    const episodeId = extractEpisodeId(this.latestInstructions, "Gerda");
    if (name === "recall_shared_experience") return { id: episodeId };
    if (name === "correct_shared_experience") {
      const userText = String(this.turns[this.activeTurnIndex]?.userText ?? "");
      const replacement = userText.split(":").slice(1).join(":").trim();
      return { id: episodeId, field: "outcome", replacement, evidence: userText };
    }
    throw new Error(`Unexpected scripted tool: ${name}`);
  }

  emitServer(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
}

function extractInteractionState(instructions) {
  const marker = "LOCAL ROBOT INTERACTION STATE (";
  const markerAt = instructions.indexOf(marker);
  assert.notEqual(markerAt, -1, "the actual production instructions include bounded interaction state");
  const jsonStart = instructions.indexOf(":\n", markerAt);
  assert.notEqual(jsonStart, -1, "production interaction state has its JSON boundary");
  const start = jsonStart + 2;
  const end = instructions.indexOf("\nUse a pending robot task", start);
  assert.ok(end > start, "production interaction state ends before its instruction rules");
  return JSON.parse(instructions.slice(start, end));
}

function extractEpisodeId(instructions, title) {
  const episode = extractInteractionState(instructions)?.companion?.episodes?.find((entry) => entry.title === title);
  assert.ok(episode?.id, `the current production context supplies the saved ${title} id`);
  return episode.id;
}

function testDependencies(cases, sockets, scenario = {}) {
  let caseIndex = 0;
  return {
    testOnly: true,
    // The injected fake socket is the only transport; this sentinel never
    // reaches the network and must never enter a report.
    apiKey: syntheticApiKeySentinel,
    ackTimeoutMs: 1_000,
    perTurnMs: 3_000,
    socketFactory: (url, options) => {
      assert.match(url, /^wss:\/\/api\.openai\.com\/v1\/realtime\?/u,
        "the runner constructs the normal URL but the injected socket prevents network use");
      const testCase = cases[caseIndex++];
      assert.ok(testCase, "the runner opened one fake socket for a targeted case");
      const socket = new ContinuityProtocolSocket(url, options, testCase, scenario);
      sockets.push(socket);
      return socket;
    },
    // No runtimeFactory: run the real companion runtime and production PCM
    // route/configuration through the test-only socket seam.
  };
}

function countTurnEvents(turn, key) {
  const range = turn?.observed?.offsets?.[key];
  assert.ok(Number.isInteger(range?.start) && Number.isInteger(range?.end),
    `the per-turn report includes bounded ${key} offsets`);
  return range.end - range.start;
}

function freshContinuitySuite() { return getCompanionLiveSuite("continuity"); }

const suite = freshContinuitySuite();
assert.equal(suite.id, "continuity");
assert.equal(suite.cases.length, 3, "the continuity suite contains only its three targeted scenarios");
const overviewFixture = suite.cases.find((testCase) => testCase.id === OVERVIEW_CASE_ID);
const correctionFixture = suite.cases.find((testCase) => testCase.id === CORRECTION_CASE_ID);
const gameFixture = suite.cases.find((testCase) => testCase.id === GAME_CASE_ID);
assert.ok(overviewFixture && correctionFixture && gameFixture, "the continuity registry exposes overview, correction/recall, and pause/return cases");
assert.equal(Array.isArray(overviewFixture.turns), false, "the broad saved-experience overview is a one-turn case");
assert.equal(correctionFixture.turns?.length, 3, "correction, confirmation, and exact-title recall are separate turns");
assert.equal(gameFixture.turns?.length, 3, "pause, paused guess, and explicit return are separate turns");

const suiteSockets = [];
const report = await runLiveEvaluation({
  cases: suite.cases,
  suiteId: suite.id,
  ...testDependencies(suite.cases, suiteSockets),
});
assert.equal(report.status, "test_harness_only");
assert.equal(report.suiteId, "continuity");
assert.equal(report.executionKind, "injected-fake-transport-no-model-evidence");
assert.equal(report.networkUsed, false);
assert.equal(report.receiptMode, "simulated-text-receipt; not heard/voice verified");
assert.equal(report.cases.length, 3);
assert.deepEqual(report.cases.map((item) => item.status), [
  "mechanical_checks_passed",
  "mechanical_checks_passed",
  "mechanical_checks_passed",
]);
assert.equal(report.counters.responseCreates, 10,
  "overview 2 + correction/recall 5 + pause/return 3 responses are counted once");
assert.equal(report.counters.serverResponses, 10);
assert.equal(report.counters.finalResponses, 7,
  "one overview, three correction-flow, and three game turns finish with text");
assert.equal(report.limits.maxResponseCreates, 24);
assert.equal(report.limits.maxServerResponses, 24);
assert.equal(report.limits.maxFinalResponses, 12);
assert.equal(report.limits.maxToolRoundsPerTurn, 4,
  "the continuity suite does not broaden the runner's hard caps");
assert.equal(report.limits.maxCases, 6);
assert.equal(report.limits.maxTurnsPerCase, 3);
assert.equal(JSON.stringify(report).includes(syntheticApiKeySentinel), false,
  "the synthetic test sentinel is omitted from reports");
assert.equal(JSON.stringify(report).includes("secretAnswer"), false,
  "the game secret is not exposed in the report");

for (const socket of suiteSockets) {
  assert.ok(socket.sessionUpdates.length >= 2, "the fake transport saw initial and post-setup production session updates");
  const productionSession = socket.sessionUpdates.at(-1);
  const productionTools = new Set((productionSession.tools ?? []).map((tool) => tool.name));
  assert.ok(productionTools.has("list_shared_experiences"));
  assert.ok(productionTools.has("correct_shared_experience"));
  assert.ok(productionTools.has("recall_shared_experience"));
  assert.equal(productionSession.audio?.input?.format?.type, "audio/pcm",
    "the actual production PCM input configuration is retained in the fake protocol trace");
  assert.equal(productionSession.audio?.input?.format?.rate, 24_000);
}

const overviewReport = report.cases[0];
assert.deepEqual(overviewReport.observed.tools, ["list_shared_experiences"]);
assert.equal(overviewReport.observed.toolResults.length, 1);
assert.equal(overviewReport.observed.toolResults[0].status, "experiences_listed");
assert.equal(overviewReport.observed.toolResults[0].total, 3);
assert.equal(overviewReport.observed.toolResults[0].episodes.length, 3,
  "the report projection retains all three saved current facts from the real overview output");
assert.ok(overviewReport.observed.toolResults[0].episodes.every((episode) =>
  episode.title && episode.detail && episode.outcome && episode.source?.evidence),
"each overview fact retains its title, current detail/outcome, and source evidence");
assert.equal(overviewReport.observed.engine.companion.episodes.length, 3,
  "the bounded engine snapshot also retains all three current facts in the case report");
assert.ok(overviewReport.observed.engine.companion.episodes.every((episode) =>
  episode.title && episode.detail && episode.outcome && episode.source?.evidence),
"the case snapshot retains each overview fact and its source evidence");
assert.equal(overviewReport.observed.responses.filter((response) => response.text).length, 1);
assert.equal(countTurnEvents(overviewReport.turns[0], "responseCreates"), 2);
assert.equal(countTurnEvents(overviewReport.turns[0], "serverResponses"), 2);
assert.equal(countTurnEvents(overviewReport.turns[0], "finalResponses"), 1);
assert.equal(countTurnEvents(overviewReport.turns[0], "tools"), 1);
assert.equal(countTurnEvents(overviewReport.turns[0], "toolResults"), 1);
assert.equal(suiteSockets[0].toolOutputs.length, 1);
assert.equal(suiteSockets[0].toolOutputs[0].output.episodes.length, 3,
  "the actual client-sent overview result contains all three current facts");

const correctionReport = report.cases[1];
assert.equal(correctionReport.turns.length, 3);
assert.deepEqual(correctionReport.turns.map((turn) => turn.status), [
  "mechanical_checks_passed",
  "mechanical_checks_passed",
  "mechanical_checks_passed",
]);
assert.deepEqual(correctionReport.observed.tools, ["correct_shared_experience", "recall_shared_experience"]);
assert.equal(correctionReport.observed.toolResults.length, 2,
  "the real correction and later recall produce two acknowledged tool outputs");
assert.ok(correctionReport.observed.toolResults.every((result) => result.acknowledged === true));
assert.deepEqual(correctionReport.turns.map((turn) => countTurnEvents(turn, "responseCreates")), [2, 1, 2]);
assert.deepEqual(correctionReport.turns.map((turn) => countTurnEvents(turn, "serverResponses")), [2, 1, 2]);
assert.deepEqual(correctionReport.turns.map((turn) => countTurnEvents(turn, "finalResponses")), [1, 1, 1]);
assert.deepEqual(correctionReport.turns.map((turn) => countTurnEvents(turn, "tools")), [1, 0, 1]);
assert.deepEqual(correctionReport.turns.map((turn) => countTurnEvents(turn, "toolResults")), [1, 0, 1]);
const firstCorrectionTurn = correctionReport.turns[0];
const pendingConfirmation = firstCorrectionTurn.observed.engine.companion.pendingConfirmation;
assert.equal(pendingConfirmation.kind, "correction");
assert.equal(pendingConfirmation.field, "outcome");
assert.equal(pendingConfirmation.replacement, "Sie landete neben dem Baum.");
assert.ok(pendingConfirmation.askedAt !== null,
  "the real engine records askedAt only after the scripted response contains the exact returned question");
const exactQuestion = suiteSockets[1].toolOutputs.find((entry) =>
  entry.output.status === "correction_pending")?.output.confirmationQuestion;
assert.ok(exactQuestion, "the correction action returned its actual localized confirmation question");
assert.equal(firstCorrectionTurn.observed.responses.filter((response) => response.text).at(-1)?.text, exactQuestion,
  "the final correction response repeats the actual tool result question exactly");
const beforeConfirmation = firstCorrectionTurn.observed.engine.companion.episodes.find((episode) => episode.title === "Gerda");
assert.equal(beforeConfirmation.outcome, pendingConfirmation.previousValue,
  "the old fact remains current until the user's later yes");
const confirmedTurn = correctionReport.turns[1];
assert.equal(confirmedTurn.observed.engine.companion.pendingConfirmation, null);
const afterConfirmation = confirmedTurn.observed.engine.companion.episodes.find((episode) => episode.title === "Gerda");
assert.equal(afterConfirmation.outcome, "Sie landete neben dem Baum.");
assert.equal(afterConfirmation.corrections.outcome.evidence,
  "Korrektur zu Gerda: Sie landete neben dem Baum.");
const recallOutput = suiteSockets[1].toolOutputs.find((entry) => entry.output.status === "recalled")?.output;
assert.equal(recallOutput.episode.outcome, "Sie landete neben dem Baum.",
  "the later exact-title recall returns the confirmed corrected fact");
assert.equal(recallOutput.episode.corrections.outcome.evidence,
  "Korrektur zu Gerda: Sie landete neben dem Baum.");
assert.equal(suiteSockets[1].userInputs.includes("Ja."), true,
  "the runner sends its synthetic yes as the second turn only after the first turn passes mechanically");

const gameReport = report.cases[2];
assert.equal(gameReport.turns.length, 3);
assert.deepEqual(gameReport.observed.tools, [], "the scripted game pause flow needs no model-shaped function event");
assert.deepEqual(gameReport.turns.map((turn) => countTurnEvents(turn, "responseCreates")), [1, 1, 1]);
assert.deepEqual(gameReport.turns.map((turn) => countTurnEvents(turn, "serverResponses")), [1, 1, 1]);
assert.deepEqual(gameReport.turns.map((turn) => countTurnEvents(turn, "finalResponses")), [1, 1, 1]);
const pausedTurn = gameReport.turns[0].observed.engine.game;
const pausedGuessTurn = gameReport.turns[1].observed.engine.game;
const resumedTurn = gameReport.turns[2].observed.engine.game;
assert.equal(pausedTurn.status, "paused");
assert.equal(pausedGuessTurn.status, "paused");
assert.equal(pausedGuessTurn.attemptsLeft, pausedTurn.attemptsLeft,
  "the guess spoken while paused does not consume an attempt");
assert.equal(pausedGuessTurn.round, pausedTurn.round);
assert.equal(resumedTurn.status, "active");
assert.equal(resumedTurn.attemptsLeft, pausedTurn.attemptsLeft);
assert.equal(resumedTurn.round, pausedTurn.round);
assert.equal(suiteSockets[2].userInputs.includes("Warte kurz."), true);
assert.equal(suiteSockets[2].userInputs.includes("2"), true);
assert.equal(suiteSockets[2].userInputs.includes("Ich bin wieder da."), true);

async function assertCorrectionQuestionFailure(confirmationResponse, suffix) {
  const negativeSuite = freshContinuitySuite();
  const freshCorrectionFixture = negativeSuite.cases.find((testCase) => testCase.id === CORRECTION_CASE_ID);
  assert.ok(freshCorrectionFixture, "each isolated negative run resolves a fresh correction fixture");
  const negativeFixture = { ...freshCorrectionFixture, id: `${freshCorrectionFixture.id}-${suffix}` };
  const sockets = [];
  const negative = await runLiveEvaluation({
    cases: [negativeFixture],
    suiteId: negativeSuite.id,
    ...testDependencies([negativeFixture], sockets, { confirmationResponse }),
  });
  const failedCase = negative.cases[0];
  assert.equal(failedCase.turns[0].status, "mechanical_checks_failed",
    `${confirmationResponse}: the first correction turn fails its mechanical question/askedAt gate`);
  assert.ok(failedCase.turns[0].violations.length > 0);
  assert.equal(failedCase.turns[1].status, "not_run_after_previous_turn_failure");
  assert.equal(failedCase.turns[2].status, "not_run_after_previous_turn_failure");
  assert.equal(sockets[0].userInputs.includes("Ja."), false,
    `${confirmationResponse}: the runner must not send the synthetic yes after a failed first turn`);
  assert.equal(sockets[0].userInputs.includes(correctionFixture.turns[2].userText), false,
    `${confirmationResponse}: recall is not attempted after an unasked correction`);
  assert.equal(sockets[0].toolOutputs.length, 1,
    `${confirmationResponse}: only the first correction tool result is produced`);
  assert.equal(negative.networkUsed, false);
  assert.equal(JSON.stringify(negative).includes(syntheticApiKeySentinel), false);
}

await assertCorrectionQuestionFailure("wrong", "wrong-question");
await assertCorrectionQuestionFailure("missing", "missing-question");

console.log("Continuity fake-protocol integration passed: real PCM runtime, one-turn overview, exact correction confirmation then recall, and paused-game return; negative question gates stop synthetic follow-up (no model, network, hearing, speech, or device evidence)");
