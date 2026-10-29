#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";
import { companionLiveCases } from "./companion-live-cases.mjs";
import { availableCompanionLiveSuites, getCompanionLiveSuite } from "./companion-live-suites.mjs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const DEFAULT_MODEL = createTypeScriptTreeLoader()("src/openai/realtime-models.ts").DEFAULT_REALTIME_MODEL_ID;
const MAX_CASES = 6;
const MAX_TURNS_PER_CASE = 3;
const MAX_FIXTURE_TEXT_LENGTH = 2_000;
const MAX_RESPONSE_CREATES = 24;
const MAX_FINAL_RESPONSES = 12;
const MAX_TOOL_ROUNDS_PER_TURN = 4;
const PER_TURN_MS = 45_000;
const WHOLE_RUN_MS = 240_000;
const IDLE_SETTLE_MS = 900;

function parseArgs(argv) {
  let live = false;
  let outputPath = null;
  let suite = "baseline";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--live") live = true;
    else if (argv[i] === "--suite" && argv[i + 1]) suite = argv[++i];
    else if (argv[i].startsWith("--suite=")) suite = argv[i].slice("--suite=".length);
    else if (argv[i] === "--output" && argv[i + 1]) outputPath = argv[++i];
    else if (argv[i].startsWith("--output=")) outputPath = argv[i].slice("--output=".length);
    else throw new Error("Usage: node scripts/companion-live-eval.mjs [--suite baseline|continuity|personality] [--live --output PATH]");
  }
  if (!availableCompanionLiveSuites.includes(suite)) throw new Error(`--suite must be one of: ${availableCompanionLiveSuites.join(", ")}.`);
  return { live, outputPath, suite };
}

function turnsForCase(testCase) {
  if (Array.isArray(testCase?.turns)) return testCase.turns;
  return [{ id: `${testCase?.id ?? "case"}-turn-1`, userText: testCase?.userText, expected: testCase?.expected ?? {}, review: testCase?.review ?? null }];
}

function validFixtureText(value, label) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_FIXTURE_TEXT_LENGTH
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
    ? null
    : `${label} must be non-empty plain text of at most ${MAX_FIXTURE_TEXT_LENGTH} characters.`;
}

function validateExpected(expected, label) {
  if (expected == null) return null;
  for (const field of ["requiredTool", "requiredStatus", "searchQuery"]) {
    if (expected[field] != null && (typeof expected[field] !== "string" || !expected[field].trim() || expected[field].length > 200)) return `${label} ${field} must be non-empty text of at most 200 characters.`;
  }
  for (const field of ["forbiddenTools", "responseMustNotClaim"]) {
    if (expected[field] == null) continue;
    if (!Array.isArray(expected[field]) || expected[field].length > 32) return `${label} ${field} must contain at most 32 values.`;
    if (expected[field].some((value) => typeof value !== "string" || !value.trim() || value.length > 200)) return `${label} ${field} entries must be non-empty text of at most 200 characters.`;
  }
  if (expected.state != null && typeof expected.state !== "function") return `${label} state must be a local predicate.`;
  return null;
}

function boundedReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const boundedList = (values) => Array.isArray(values) ? values.slice(0, 12).filter((value) => typeof value === "string").map((value) => value.slice(0, 500)) : [];
  return { passCriteria: boundedList(review.passCriteria), expectedFacts: boundedList(review.expectedFacts) };
}

function validateCases(cases) {
  if (!Array.isArray(cases)) return "Cases must be an array.";
  if (cases.length > MAX_CASES) return `Live evaluation accepts at most ${MAX_CASES} cases; no network request was made.`;
  if (cases.length === 0) return "Live evaluation requires at least one case; no network request was made.";
  for (const [caseIndex, testCase] of cases.entries()) {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) return `Case ${caseIndex + 1} is invalid; no network request was made.`;
    if (typeof testCase.id !== "string" || !testCase.id.trim() || testCase.id.length > 100) return `Case ${caseIndex + 1} must have a non-empty id of at most 100 characters; no network request was made.`;
    const hasTurns = Object.hasOwn(testCase, "turns");
    if (hasTurns && !Array.isArray(testCase.turns)) return `Case ${testCase.id} turns must be an array; no network request was made.`;
    const turns = turnsForCase(testCase);
    if (turns.length < 1 || turns.length > MAX_TURNS_PER_CASE) return `Case ${testCase.id} must have 1 to ${MAX_TURNS_PER_CASE} turns; no network request was made.`;
    const seenTurnIds = new Set();
    for (const [turnIndex, turn] of turns.entries()) {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) return `Case ${testCase.id} turn ${turnIndex + 1} is invalid; no network request was made.`;
      if (typeof turn.id !== "string" || !turn.id.trim() || turn.id.length > 100) return `Case ${testCase.id} turn ${turnIndex + 1} must have a non-empty id of at most 100 characters; no network request was made.`;
      if (seenTurnIds.has(turn.id)) return `Case ${testCase.id} has duplicate turn id ${turn.id}; no network request was made.`;
      seenTurnIds.add(turn.id);
      const textError = validFixtureText(turn.userText, `Case ${testCase.id} turn ${turn.id} userText`);
      if (textError) return `${textError} No network request was made.`;
      if (turn.expected != null && (typeof turn.expected !== "object" || Array.isArray(turn.expected))) return `Case ${testCase.id} turn ${turn.id} expected must be an object; no network request was made.`;
      const expectedError = validateExpected(turn.expected, `Case ${testCase.id} turn ${turn.id} expected`);
      if (expectedError) return `${expectedError} No network request was made.`;
      if (turn.review != null && (typeof turn.review !== "object" || Array.isArray(turn.review))) return `Case ${testCase.id} turn ${turn.id} review must be an object; no network request was made.`;
    }
    if (Array.isArray(testCase.history)) {
      if (testCase.history.length > 8) return `Case ${testCase.id} history may contain at most 8 entries; no network request was made.`;
      for (const [historyIndex, entry] of testCase.history.entries()) {
        if (!entry || (entry.role !== "user" && entry.role !== "assistant")) return `Case ${testCase.id} history entry ${historyIndex + 1} has an invalid role; no network request was made.`;
        const historyError = validFixtureText(entry.text, `Case ${testCase.id} history entry ${historyIndex + 1} text`);
        if (historyError) return `${historyError} No network request was made.`;
      }
    } else if (testCase.history != null) return `Case ${testCase.id} history must be an array; no network request was made.`;
    if (testCase.setup != null && typeof testCase.setup !== "function") return `Case ${testCase.id} setup must be a function; no network request was made.`;
    if (testCase.expected != null && (typeof testCase.expected !== "object" || Array.isArray(testCase.expected))) return `Case ${testCase.id} expected must be an object; no network request was made.`;
    const caseExpectedError = validateExpected(testCase.expected, `Case ${testCase.id} expected`);
    if (caseExpectedError) return `${caseExpectedError} No network request was made.`;
    if (testCase.review != null && (typeof testCase.review !== "object" || Array.isArray(testCase.review))) return `Case ${testCase.id} review must be an object; no network request was made.`;
    if (testCase.robotName != null && (typeof testCase.robotName !== "string" || !testCase.robotName.trim() || testCase.robotName.length > 80)) return `Case ${testCase.id} robotName is invalid; no network request was made.`;
    if (testCase.memoryFacts != null) {
      if (!Array.isArray(testCase.memoryFacts) || testCase.memoryFacts.length > 8) return `Case ${testCase.id} memoryFacts must contain at most 8 entries; no network request was made.`;
      if (testCase.memoryFacts.some((fact) => !fact || typeof fact.memory !== "string" || !fact.memory.trim() || fact.memory.length > 350)) return `Case ${testCase.id} memoryFacts contain invalid text; no network request was made.`;
    }
  }
  return null;
}

function fixtureInput(c) {
  return {
    userText: String(turnsForCase(c)[0]?.userText ?? ""),
    history: (Array.isArray(c.history) ? c.history : []).map((entry) => ({
      role: entry.role,
      text: String(entry.text ?? ""),
    })),
  };
}

function expectedReview(expected = {}) {
  return {
    requiredTool: expected.requiredTool ?? null,
    forbiddenTools: Array.isArray(expected.forbiddenTools) ? expected.forbiddenTools : [],
    requiredStatus: expected.requiredStatus ?? null,
    responseMustNotClaim: Array.isArray(expected.responseMustNotClaim) ? expected.responseMustNotClaim : [],
    searchQuery: expected.searchQuery ?? null,
  };
}

function fixtureReview(c) {
  return {
    id: c.id,
    ...fixtureInput(c),
    review: boundedReview(c.review),
    expected: expectedReview(c.expected ?? {}),
    turns: turnsForCase(c).map((turn) => ({
      id: turn.id,
      userText: turn.userText,
      review: boundedReview(turn.review),
      expected: expectedReview(turn.expected ?? {}),
    })),
  };
}

function extractResponseText(response, deltas = "") {
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim() || deltas.trim();
}

function episodeProjection(episode) {
  if (!episode || typeof episode !== "object") return null;
  const boundedString = (value, maximum) => typeof value === "string" ? value.slice(0, maximum) : null;
  const projection = {
    id: boundedString(episode.id, 96),
    title: boundedString(episode.title, 80),
    detail: boundedString(episode.detail, 220),
    outcome: boundedString(episode.outcome, 180),
    source: episode.source && typeof episode.source === "object" ? {
      evidence: boundedString(episode.source.evidence, 240),
      sessionId: boundedString(episode.source.sessionId, 96),
      at: Number.isFinite(episode.source.at) ? episode.source.at : null,
    } : null,
  };
  if (typeof episode.motif === "string") projection.motif = episode.motif.slice(0, 24);
  if (episode.ritualPreference && typeof episode.ritualPreference === "object") {
    projection.ritualPreference = {
      mode: boundedString(episode.ritualPreference.mode, 24),
      motif: boundedString(episode.ritualPreference.motif, 24),
      phrase: boundedString(episode.ritualPreference.phrase, 120),
    };
  }
  if (episode.corrections && typeof episode.corrections === "object") {
    const corrections = Object.fromEntries(["detail", "outcome"].filter((field) => episode.corrections[field]).map((field) => [field, {
      evidence: boundedString(episode.corrections[field].evidence, 240),
      sessionId: boundedString(episode.corrections[field].sessionId, 96),
      at: Number.isFinite(episode.corrections[field].at) ? episode.corrections[field].at : null,
      confirmedAt: Number.isFinite(episode.corrections[field].confirmedAt) ? episode.corrections[field].confirmedAt : null,
    }]));
    if (Object.keys(corrections).length) projection.corrections = corrections;
  }
  if (episode.learnedInterest && typeof episode.learnedInterest === "object") {
    projection.learnedInterest = {
      encounters: Array.isArray(episode.learnedInterest.encounters) ? Math.min(3, episode.learnedInterest.encounters.length) : 0,
      blocked: episode.learnedInterest.blocked != null,
    };
  }
  if (Number.isFinite(episode.confirmedAt)) projection.confirmedAt = episode.confirmedAt;
  return projection;
}

function searchedEpisodeProjection(episode) {
  const projection = episodeProjection(episode);
  if (!projection) return null;
  return {
    title: projection.title,
    detail: projection.detail,
    outcome: projection.outcome,
    source: projection.source,
    ...(projection.corrections ? { corrections: projection.corrections } : {}),
  };
}

function personalityProjection(engine) {
  try {
    const raw = engine?.getPersonalityContext?.();
    if (typeof raw !== "string" || raw.length > 16_000) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const life = value.life && typeof value.life === "object" ? value.life : {};
    const pick = (value, allowed) => allowed.includes(value) ? value : null;
    return {
      tone: pick(value.tone, ["default", "calm", "playful"]),
      life: {
        core: pick(life.core, ["gentle-curious"]),
        familiarity: pick(life.familiarity, ["new", "recognizing", "familiar", "at_ease"]),
        energy: pick(life.energy, ["rested", "steady", "quiet"]),
        mood: pick(life.mood, ["curious", "content", "playful", "quiet"]),
        playfulness: pick(life.playfulness, ["gentle", "ready"]),
      },
      familiarInterests: Array.isArray(value.familiarInterests) ? value.familiarInterests.filter((item) => typeof item === "string" && item.length <= 80).slice(0, 3) : [],
      ...(value.conversationMoment && typeof value.conversationMoment.title === "string" && value.conversationMoment.title.length <= 80
        ? { conversationMoment: { title: value.conversationMoment.title, valence: pick(value.conversationMoment.valence, ["positive", "negative"]) } } : {}),
    };
  } catch { return null; }
}

function engineSnapshot(engine) {
  const state = engine?.getState?.() ?? {};
  const boundedString = (value, maximum) => typeof value === "string" ? value.slice(0, maximum) : null;
  const episodes = (Array.isArray(state.companion?.episodes) ? state.companion.episodes : []).slice(0, 8).map((episode) => ({
    ...episodeProjection(episode),
    ritualMode: episode.ritualPreference?.mode ?? null,
  }));
  const pending = state.companion?.pendingExperience;
  const pendingConfirmation = pending ? {
    kind: boundedString(pending.kind, 40),
    episodeId: boundedString(pending.episodeId, 96),
    field: pending.field === "detail" || pending.field === "outcome" ? pending.field : null,
    replacement: boundedString(pending.replacement, 220),
    previousValue: boundedString(pending.previousValue, 220),
    question: boundedString(pending.question, 320),
    askedAt: Number.isFinite(pending.askedAt) ? pending.askedAt : null,
  } : null;
  return {
    personality: personalityProjection(engine),
    repairRequired: state.repairRequired === true,
    game: state.game ? {
      status: boundedString(state.game.status, 24),
      attemptsLeft: Number.isFinite(state.game.attemptsLeft) ? state.game.attemptsLeft : null,
      round: Number.isFinite(state.game.round) ? state.game.round : null,
      lastOutcome: boundedString(state.game.lastOutcome, 24),
    } : null,
    pendingIntention: state.pendingIntention ? {
      status: boundedString(state.pendingIntention.status, 40),
      goal: boundedString(state.pendingIntention.goal, 220),
      lastConfirmedStep: boundedString(state.pendingIntention.lastConfirmedStep, 120),
      activity: state.pendingIntention.activity ? {
        phase: boundedString(state.pendingIntention.activity.phase, 40),
        pending: state.pendingIntention.activity.pending ? { step: boundedString(state.pendingIntention.activity.pending.step, 120) } : null,
      } : null,
    } : null,
    companion: { episodes, pendingConfirmation },
    interactionPhase: boundedString(state.moment?.phase, 40),
  };
}

async function writeReport(outputPath, report) {
  if (!outputPath) return;
  const destination = path.resolve(outputPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function openSocket(apiKey, model, wholeDeadline, socketFactory = (url, options) => new WebSocket(url, options)) {
  return new Promise((resolve, reject) => {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    const socket = socketFactory(url, { headers: { Authorization: `Bearer ${apiKey}` }, maxPayload: 8 * 1024 * 1024 });
    let messageHandler = null;
    const bufferedMessages = [];
    socket.on("message", (message) => {
      if (messageHandler) messageHandler(message);
      else bufferedMessages.push(message);
    });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Realtime socket open timed out.")); }, Math.max(1, Math.min(8_000, wholeDeadline - Date.now())));
    socket.once("open", () => {
      clearTimeout(timer);
      resolve({ socket, setMessageHandler(handler) { messageHandler = handler; for (const message of bufferedMessages.splice(0)) handler(message); } });
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      const status = Number(response.statusCode) || 0;
      response.resume();
      socket.terminate();
      reject(new Error(status === 401 || status === 403 ? "Realtime authentication was rejected; server details were suppressed." : `Realtime socket rejected (HTTP ${status}); response body suppressed.`));
    });
    socket.once("error", () => { clearTimeout(timer); reject(new Error("Realtime socket connection failed; server details were suppressed.")); });
  });
}

async function runCase(testCase, apiKey, budget, dependencies = {}) {
  const startedAt = Date.now();
  const model = dependencies.model ?? DEFAULT_MODEL;
  const runtime = (dependencies.runtimeFactory ?? createCompanionLiveRuntime)({ robotName: testCase.robotName ?? "LOOI", memoryFacts: testCase.memoryFacts ?? [] });
  const sessionId = `companion-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  let socket;
  let service;
  let caseCompleted = false;
  let fatal = null;
  let eventChain = Promise.resolve();
  let sendCount = 0;
  let createdCount = 0;
  let doneCount = 0;
  let finalResponseCount = 0;
  let activeTurnIndex = -1;
  let activeTurnStartedAt = null;
  let lastActivityAt = Date.now();
  let sentSessionUpdates = 0;
  let acknowledgedSessionUpdates = 0;
  let sessionCreated = false;
  let cancelEventSerial = 0;
  const liveEvents = [];
  const responseTextDeltas = new Map();
  const responseCreatedAt = new Map();
  const responseTurnIndex = new Map();
  const responseCreateTurnQueue = [];
  const responseCreateCountsByTurn = turnsForCase(testCase).map(() => 0);
  const serverResponseCountsByTurn = turnsForCase(testCase).map(() => 0);
  const doneCountsByTurn = turnsForCase(testCase).map(() => 0);
  const finalResponseCountsByTurn = turnsForCase(testCase).map(() => 0);
  const responseCreateTurnEvents = [];
  const serverResponseTurnEvents = [];
  const doneTurnEvents = [];
  const finalResponseTurnEvents = [];
  const responses = [];
  const toolCalls = [];
  const toolResults = [];
  const toolCallTurnIndex = new Map();
  const outgoingToolCallIds = new Set();
  const expectedWarnings = [];
  const cancellationEventIds = new Set();
  const turnReports = [];
  const toolRoundsByTurn = turnsForCase(testCase).map(() => 0);

  try {
    if (dependencies.testOnly && typeof dependencies.socketFactory !== "function") throw new Error("testOnly requires an injected fake WebSocket; live transport is disabled.");
    const opened = await openSocket(apiKey, model, budget.deadline, dependencies.socketFactory);
    socket = opened.socket;
    const socketProxy = {
      get readyState() { return socket.readyState; },
      send(raw) {
        let event;
        try { event = JSON.parse(raw); } catch { fatal = new Error("Transport emitted invalid JSON."); socket.close(); return; }
        if (event.type === "response.cancel") {
          const eventId = typeof event.event_id === "string" ? event.event_id : `harness-cancel-${++cancelEventSerial}`;
          event.event_id = eventId;
          cancellationEventIds.add(eventId);
        }
        if (event.type === "response.create") {
          budget.responseCreateAttempts += 1;
          if (budget.responseCreates >= MAX_RESPONSE_CREATES) { fatal = new Error("Response-create hard cap exceeded."); socket.terminate(); return; }
          sendCount += 1;
          budget.responseCreates += 1;
          const requestId = typeof event.response?.metadata?.looi_companion_request === "string" ? event.response.metadata.looi_companion_request : "";
          responseCreateTurnQueue.push({ turnIndex: activeTurnIndex, requestId });
          responseCreateTurnEvents.push(activeTurnIndex);
          if (activeTurnIndex >= 0) responseCreateCountsByTurn[activeTurnIndex] += 1;
          event.response = { ...(event.response ?? {}), output_modalities: ["text"] };
        } else if (event.type === "conversation.item.create" && event.item?.type === "function_call_output") {
          const callId = String(event.item.call_id ?? "");
          if (callId && !outgoingToolCallIds.has(callId)) {
            outgoingToolCallIds.add(callId);
            let output = {};
            try { output = JSON.parse(String(event.item.output ?? "{}")); } catch {}
            toolResults.push({
              callId: callId.slice(0, 128),
              turnIndex: toolCallTurnIndex.get(callId) ?? -1,
              status: typeof output.status === "string" ? output.status.slice(0, 80) : output.ok === true ? "ok" : "error",
              resultCount: Array.isArray(output.results) ? Math.min(output.results.length, 6) : null,
              total: Number.isInteger(output.total) && output.total >= 0 ? output.total : null,
              episode: episodeProjection(output.episode),
              episodes: Array.isArray(output.episodes) ? output.episodes.slice(0, 8).map(episodeProjection) : [],
              matches: Array.isArray(output.matches) ? output.matches.slice(0, 3).map((match) => ({
                episode: searchedEpisodeProjection(match?.episode),
                matchedTerms: Array.isArray(match?.matchedTerms) ? match.matchedTerms.slice(0, 60).filter((term) => typeof term === "string").map((term) => term.slice(0, 240)) : [],
              })) : [],
              totalMatches: Number.isInteger(output.totalMatches) && output.totalMatches >= 0 ? output.totalMatches : null,
              source: "client-send",
              acknowledged: false,
            });
          }
        } else if (event.type === "session.update") {
          sentSessionUpdates += 1;
          event.session = { ...(event.session ?? {}), output_modalities: ["text"] };
          // Keep the production input VAD/transcription config and full instructions/tools.
          if (event.session.audio && typeof event.session.audio === "object") {
            event.session.audio = { ...event.session.audio };
            delete event.session.audio.output;
          }
        }
        lastActivityAt = Date.now();
        socket.send(JSON.stringify(event));
      },
      close() { socket.close(); },
    };

    service = new runtime.RealtimePcmConversationService();
    service.active = true;
    service.configured = true;
    service.sessionId = sessionId;
    service.webSocket = socketProxy;
    service.sessionMemoryContext = (testCase.memoryFacts ?? []).map((fact) => `- ${String(fact.memory).slice(0, 350)}`).join("\n") || undefined;
    const responseIsCurrentForTurn = (responseId, turnIndex) => {
      if (!responseId || turnIndex < 0 || turnIndex !== activeTurnIndex) return false;
      if (dependencies.testOnly && dependencies.runtimeFactory) return true;
      const contexts = service.responseCompanionContexts;
      if (!(contexts instanceof Map) || !contexts.has(responseId)) return false;
      const context = contexts.get(responseId);
      const current = service.currentCompanionUserTurn;
      if (!context || !current) return false;
      if (typeof service.isCurrentCompanionTurn === "function") return service.isCurrentCompanionTurn(context, sessionId);
      return context.sessionId === sessionId
        && current.sessionId === sessionId
        && context.itemId === current.itemId
        && context.userTurnRevision === current.userTurnRevision
        && context.revision === current.revision;
    };
    const handleServerEvent = async (event) => {
      let simulatedTextReceipt = null;
      liveEvents.push(event.type);
      lastActivityAt = Date.now();
      if (event.type === "error") {
        const code = typeof event.error?.code === "string" ? event.error.code.slice(0, 60) : "unknown";
        const sourceEventId = typeof event.error?.event_id === "string" ? event.error.event_id : "";
        if (code === "response_cancel_not_active" && cancellationEventIds.has(sourceEventId)) {
          cancellationEventIds.delete(sourceEventId);
          expectedWarnings.push({ kind: "cancel_no_active_response", code, eventId: sourceEventId });
          await service.handleEvent(event);
          return;
        }
        fatal = new Error(code === "invalid_api_key" ? "Realtime authentication was rejected (invalid_api_key); message omitted." : `Realtime server error (${code}); message omitted.`);
        socket.close();
        return;
      }
      if (event.type === "session.created") sessionCreated = true;
      if (event.type === "session.updated" && acknowledgedSessionUpdates < sentSessionUpdates) acknowledgedSessionUpdates += 1;
      if (event.type === "response.created") {
        createdCount += 1;
        budget.serverResponses += 1;
        if (budget.serverResponses > MAX_RESPONSE_CREATES) { fatal = new Error("Server response hard cap exceeded."); socket.close(); return; }
        const responseId = String(event.response?.id ?? event.response_id ?? "");
        if (responseId) {
          const requestId = typeof event.response?.metadata?.looi_companion_request === "string" ? event.response.metadata.looi_companion_request : "";
          const queueIndex = requestId
            ? responseCreateTurnQueue.findIndex((entry) => entry.requestId === requestId)
            : responseCreateTurnQueue.findIndex((entry) => !entry.requestId);
          const queued = queueIndex >= 0 ? responseCreateTurnQueue.splice(queueIndex, 1)[0] : null;
          const turnIndex = queued?.turnIndex ?? -1;
          responseCreatedAt.set(responseId, Date.now());
          responseTurnIndex.set(responseId, turnIndex);
          serverResponseTurnEvents.push(turnIndex);
          if (turnIndex >= 0) serverResponseCountsByTurn[turnIndex] += 1;
          if (!dependencies.runtimeFactory && (turnIndex < 0 || turnIndex !== activeTurnIndex)) {
            // Prevent the production PCM router from binding an old/unrequested response
            // to whichever user turn happens to be current when this event arrives.
            service.rejectResponseId?.(responseId);
          }
        }
      }
      if (event.type === "response.output_text.delta" || event.type === "response.output_audio_transcript.delta") {
        const id = String(event.response_id ?? "");
        if (id) responseTextDeltas.set(id, `${responseTextDeltas.get(id) ?? ""}${String(event.delta ?? "")}`.slice(0, 3_000));
      }
      if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
        const responseId = String(event.response_id ?? "");
        const turnIndex = responseTurnIndex.get(responseId) ?? -1;
        if (turnIndex >= 0) toolRoundsByTurn[turnIndex] = (toolRoundsByTurn[turnIndex] ?? 0) + 1;
        if (turnIndex >= 0 && toolRoundsByTurn[turnIndex] > MAX_TOOL_ROUNDS_PER_TURN) {
          fatal = new Error("Per-turn tool-round hard cap exceeded.");
          socket.close();
          return;
        }
        const callId = String(event.item.call_id ?? event.item.id ?? "");
        if (callId) toolCallTurnIndex.set(callId, turnIndex);
        toolCalls.push({ callId: callId.slice(0, 128), responseId: responseId.slice(0, 128), turnIndex, accepted: responseIsCurrentForTurn(responseId, turnIndex), name: String(event.item.name ?? "unknown").slice(0, 80) });
      }
      if (event.type === "response.done") {
        doneCount += 1;
        const response = event.response ?? {};
        const responseId = String(response.id ?? "");
        const turnIndex = responseTurnIndex.get(responseId) ?? -1;
        const text = extractResponseText(response, responseTextDeltas.get(String(response.id ?? "")) ?? "").slice(0, 3_000);
        const usage = response.usage ?? {};
        const final = text.length > 0;
        if (final) {
          finalResponseCount += 1;
          budget.finalResponses += 1;
          finalResponseTurnEvents.push(turnIndex);
          if (turnIndex >= 0) finalResponseCountsByTurn[turnIndex] += 1;
        }
        if (budget.finalResponses > MAX_FINAL_RESPONSES) {
          fatal = new Error("Final-response hard cap exceeded.");
          socket.close();
          return;
        }
        doneTurnEvents.push(turnIndex);
        if (turnIndex >= 0) doneCountsByTurn[turnIndex] += 1;
        const accepted = responseIsCurrentForTurn(responseId, turnIndex);
        responses.push({ id: responseId.slice(0, 128), status: String(response.status ?? "unknown").slice(0, 32), text, turnIndex, accepted, latencyMs: responseCreatedAt.has(responseId) ? Date.now() - responseCreatedAt.get(responseId) : null, usage: { inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, totalTokens: usage.total_tokens ?? null } });
        if (final && String(response.status) === "completed" && accepted) {
          // This is a simulated text receipt for confirmation-state testing only; it is not heard/voice verification.
          simulatedTextReceipt = text;
        }
      }
      if ((event.type === "conversation.item.created" || event.type === "conversation.item.added") && event.item?.type === "function_call_output") {
        const callId = String(event.item.call_id ?? "");
        const existing = toolResults.find((result) => result.callId === callId);
        if (existing) existing.acknowledged = true;
      }
      await service.handleEvent(event);
      if (simulatedTextReceipt) runtime.events.publishBehaviorEvent({ type: "assistant-end", text: simulatedTextReceipt, sessionId });
    };
    opened.setMessageHandler((raw) => {
      eventChain = eventChain.then(async () => {
        let event;
        try { event = JSON.parse(raw.toString()); } catch { fatal = new Error("Realtime server sent invalid JSON."); socket.close(); return; }
        await handleServerEvent(event);
      }).catch(() => { fatal = new Error("Realtime event processing failed; details suppressed."); socket.close(); });
    });
    socket.on("error", () => { if (!fatal) fatal = new Error("Realtime socket failed; details suppressed."); });

    const setup = {
      events: runtime.events,
      sessionId,
      engine: runtime.behaviorEngine,
      performAction: (action) => runtime.events.performBehaviorCompanionAction(action, sessionId),
      publishEvent: (event) => runtime.events.publishBehaviorEvent({ ...event, sessionId }),
    };
    const ackTimeoutMs = dependencies.ackTimeoutMs ?? 15_000;
    const created = await waitUntil(() => sessionCreated, Math.min(ackTimeoutMs, budget.deadline - Date.now()), () => fatal, () => eventChain);
    if (!created) throw new Error("Realtime session.created timed out.");
    runtime.events.beginBehaviorSession(sessionId, () => {
      if (service.active && service.sessionId === sessionId) service.applySessionPreferences("companion-live-behavior-context");
    });
    const configured = await waitUntil(() => sentSessionUpdates > 0 && acknowledgedSessionUpdates === sentSessionUpdates, Math.min(ackTimeoutMs, budget.deadline - Date.now()), () => fatal, () => eventChain);
    if (!configured) throw new Error("Realtime session configuration timed out.");
    if (typeof testCase.setup === "function") await testCase.setup(setup);
    // Refresh once after setup so the model receives the real engine context and production tools.
    service.applySessionPreferences("companion-live-case-setup");
    const refreshed = await waitUntil(() => acknowledgedSessionUpdates === sentSessionUpdates, Math.min(ackTimeoutMs, budget.deadline - Date.now()), () => fatal, () => eventChain);
    if (!refreshed) throw new Error("Realtime case context update timed out.");

    for (const [index, entry] of (Array.isArray(testCase.history) ? testCase.history : []).entries()) {
      const role = entry.role;
      socketProxy.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          id: `synthetic-history-${testCase.id}-${index}-${Date.now().toString(36)}`,
          type: "message",
          role,
          content: [{ type: role === "user" ? "input_text" : "output_text", text: entry.text }],
        },
      }));
    }
    const turns = turnsForCase(testCase);
    const caseStartedAt = Date.now();
    let failedTurn = false;
    for (const [turnIndex, turn] of turns.entries()) {
      if (failedTurn) {
        turnReports.push({
          id: turn.id,
          userText: turn.userText,
          status: "not_run_after_previous_turn_failure",
          durationMs: 0,
          semanticReview: "required; passCriteria are not machine-evaluated",
          violations: [],
      review: boundedReview(turn.review),
          expected: expectedReview(turn.expected ?? {}),
          observed: null,
        });
        continue;
      }
      activeTurnIndex = turnIndex;
      const turnStarted = Date.now();
      activeTurnStartedAt = turnStarted;
      const turnDeadline = Math.min(turnStarted + (dependencies.perTurnMs ?? PER_TURN_MS), budget.deadline);
      const createsAtStart = sendCount;
      const createAttemptsAtStart = budget.responseCreateAttempts;
      const serverResponsesAtStart = createdCount;
      const finalResponsesAtStart = finalResponseCount;
      const doneAtStart = doneCount;
      const responseAtStart = responses.length;
      const toolAtStart = toolCalls.length;
      const toolResultAtStart = toolResults.length;
      const warningAtStart = expectedWarnings.length;
      const turnCreatesAtStart = responseCreateCountsByTurn[turnIndex];
      const turnServerAtStart = serverResponseCountsByTurn[turnIndex];
      const turnDoneAtStart = doneCountsByTurn[turnIndex];
      const turnFinalAtStart = finalResponseCountsByTurn[turnIndex];
      const itemId = `synthetic-input-${testCase.id}-${turn.id}-${Date.now().toString(36)}`;
      socketProxy.send(JSON.stringify({ type: "conversation.item.create", item: { id: itemId, type: "message", role: "user", content: [{ type: "input_text", text: turn.userText }] } }));
      // Exercise the production PCM router's completed-transcript entry point while keeping
      // one Realtime conversation alive across all turns in this fixture.
      await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: turn.userText, item_id: itemId });
      if (sendCount === createsAtStart) socketProxy.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["text"] } }));

      let stableAt = Date.now();
      while (Date.now() < turnDeadline) {
        if (fatal) throw fatal;
        await awaitWithin(eventChain, turnDeadline, "Live case event processing exceeded its hard cap.");
        const newCreates = responseCreateCountsByTurn[turnIndex] - turnCreatesAtStart;
        const newServerResponses = serverResponseCountsByTurn[turnIndex] - turnServerAtStart;
        const newDone = doneCountsByTurn[turnIndex] - turnDoneAtStart;
        const pendingResponses = newServerResponses - newDone;
        if (newCreates > 0 && newServerResponses >= newCreates && newDone >= newServerResponses && pendingResponses <= 0 && service.toolCallsInFlight === 0 && service.pendingCompanionToolCalls.size === 0) {
          if (Date.now() - stableAt >= IDLE_SETTLE_MS) break;
        } else stableAt = Date.now();
        if (Date.now() - lastActivityAt > IDLE_SETTLE_MS && newCreates > newDone) stableAt = Date.now();
        if (newCreates > MAX_RESPONSE_CREATES) throw new Error("Per-turn response-create hard cap exceeded.");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (fatal) throw fatal;
      if (Date.now() >= turnDeadline) throw new Error("Live case timed out within the configured hard cap.");
      if (sendCount - createsAtStart === 0 || doneCount - doneAtStart === 0) throw new Error("Live case produced no completed Realtime response.");

      const turnResponses = responses.filter((response) => response.turnIndex === turnIndex);
      const turnCalls = toolCalls.filter((call) => call.turnIndex === turnIndex);
      const turnResults = toolResults.filter((result) => result.turnIndex === turnIndex);
      const responseIndexes = responses.map((response, index) => response.turnIndex === turnIndex ? index : -1).filter((index) => index >= 0);
      const toolIndexes = toolCalls.map((call, index) => call.turnIndex === turnIndex ? index : -1).filter((index) => index >= 0);
      const toolResultIndexes = toolResults.map((result, index) => result.turnIndex === turnIndex ? index : -1).filter((index) => index >= 0);
      const responseCreateIndexes = responseCreateTurnEvents.map((owner, index) => owner === turnIndex ? index : -1).filter((index) => index >= 0);
      const serverResponseIndexes = serverResponseTurnEvents.map((owner, index) => owner === turnIndex ? index : -1).filter((index) => index >= 0);
      const doneIndexes = doneTurnEvents.map((owner, index) => owner === turnIndex ? index : -1).filter((index) => index >= 0);
      const finalResponseIndexes = finalResponseTurnEvents.map((owner, index) => owner === turnIndex ? index : -1).filter((index) => index >= 0);
      const expected = turn.expected ?? {};
      const violations = [];
      if (!turnResponses.some((response) => response.accepted && response.status === "completed" && response.text.length > 0)) violations.push("no non-empty completed Realtime response observed for the current turn");
      if (turnResponses.some((response) => response.text.length > 0 && !response.accepted)) violations.push("one or more text responses failed current-turn correlation");
      if (turnResponses.some((response) => response.status !== "completed")) violations.push("one or more Realtime responses ended without completed status");
      if (expected.requiredTool && !turnCalls.some((call) => call.name === expected.requiredTool && call.accepted)) violations.push(`required tool not observed for the current turn: ${expected.requiredTool}`);
      for (const name of expected.forbiddenTools ?? []) if (turnCalls.some((call) => call.name === name)) violations.push(`forbidden tool observed: ${name}`);
      if (expected.requiredStatus && !turnResults.some((result) => result.status === expected.requiredStatus)) violations.push(`required tool status not observed: ${expected.requiredStatus}`);
      const latestText = turnResponses.filter((response) => response.accepted).at(-1)?.text ?? "";
      for (const phrase of expected.responseMustNotClaim ?? []) if (latestText.toLocaleLowerCase().includes(String(phrase).toLocaleLowerCase())) violations.push(`response contained forbidden claim: ${phrase}`);
      const observed = {
        responses: turnResponses,
        tools: turnCalls.map((call) => call.name),
        toolResults: turnResults,
        engine: engineSnapshot(runtime.behaviorEngine),
        offsets: {
          responses: { start: responseAtStart, end: responses.length },
          tools: { start: toolAtStart, end: toolCalls.length },
          toolResults: { start: toolResultAtStart, end: toolResults.length },
          responseCreates: { start: createsAtStart, end: sendCount },
          responseCreateAttempts: { start: createAttemptsAtStart, end: budget.responseCreateAttempts },
          serverResponses: { start: serverResponsesAtStart, end: createdCount },
          finalResponses: { start: finalResponsesAtStart, end: finalResponseCount },
          done: { start: doneAtStart, end: doneCount },
          eventIndexes: {
            responses: responseIndexes,
            tools: toolIndexes,
            toolResults: toolResultIndexes,
            responseCreates: responseCreateIndexes,
            serverResponses: serverResponseIndexes,
            finalResponses: finalResponseIndexes,
            done: doneIndexes,
          },
          turnCounters: {
            responseCreates: { start: turnCreatesAtStart, end: responseCreateCountsByTurn[turnIndex] },
            serverResponses: { start: turnServerAtStart, end: serverResponseCountsByTurn[turnIndex] },
            finalResponses: { start: turnFinalAtStart, end: finalResponseCountsByTurn[turnIndex] },
            done: { start: turnDoneAtStart, end: doneCountsByTurn[turnIndex] },
          },
        },
      };
      if (typeof expected.state === "function" && !expected.state(observed.engine)) violations.push("expected engine-state predicate was false");
      const status = violations.length ? "mechanical_checks_failed" : "mechanical_checks_passed";
      turnReports.push({
        id: turn.id,
        userText: turn.userText,
        status,
        durationMs: Date.now() - turnStarted,
        semanticReview: "required; passCriteria are not machine-evaluated",
        violations,
        warnings: expectedWarnings.slice(warningAtStart),
        review: turn.review ?? null,
        expected: expectedReview(expected),
        observed,
      });
      if (violations.length) failedTurn = true;
    }

    const caseResponses = responses.slice();
    const caseToolCalls = toolCalls.slice();
    const caseToolResults = toolResults.slice();
    const caseViolations = turnReports.flatMap((turn) => turn.violations.map((violation) => `${turn.id}: ${violation}`));
    const observed = {
      responses: caseResponses,
      tools: caseToolCalls.map((call) => call.name),
      toolResults: caseToolResults,
      engine: engineSnapshot(runtime.behaviorEngine),
      turns: turnReports.map((turn) => ({ id: turn.id, status: turn.status, offsets: turn.observed?.offsets ?? null })),
    };
    caseCompleted = true;
    return {
      id: testCase.id,
      ...fixtureInput(testCase),
      status: failedTurn ? "mechanical_checks_failed" : "mechanical_checks_passed",
      durationMs: Date.now() - caseStartedAt,
      semanticReview: "required; passCriteria are not machine-evaluated",
      violations: caseViolations,
      warnings: expectedWarnings,
      review: boundedReview(testCase.review ?? turns[0]?.review),
      expected: expectedReview(testCase.expected ?? turns[0]?.expected ?? {}),
      turns: turnReports,
      observed,
    };
  } catch (error) {
    if (error && typeof error === "object") {
      const turns = turnsForCase(testCase);
      const interruptedTurn = activeTurnIndex >= 0 ? turns[activeTurnIndex] : null;
      if (interruptedTurn && !turnReports.some((turn) => turn.id === interruptedTurn.id)) {
        turnReports.push({
          id: interruptedTurn.id,
          userText: interruptedTurn.userText,
          status: "blocked",
          durationMs: activeTurnStartedAt ? Date.now() - activeTurnStartedAt : 0,
          semanticReview: "required; passCriteria are not machine-evaluated",
          violations: [],
          review: interruptedTurn.review ?? null,
          expected: expectedReview(interruptedTurn.expected ?? {}),
          observed: {
            responses: responses.filter((response) => response.turnIndex === activeTurnIndex),
            tools: toolCalls.filter((call) => call.turnIndex === activeTurnIndex).map((call) => call.name),
            toolResults: toolResults.filter((result) => result.turnIndex === activeTurnIndex),
            engine: engineSnapshot(runtime.behaviorEngine),
          },
        });
      }
      error.liveCasePartial = {
        responses: responses.slice(),
        tools: toolCalls.map((call) => call.name),
        toolResults: toolResults.slice(),
        turns: turnReports.slice(),
        engine: engineSnapshot(runtime.behaviorEngine),
        durationMs: Date.now() - startedAt,
        warnings: expectedWarnings.slice(),
      };
    }
    throw error;
  } finally {
    if (service) {
      service.active = false;
      service.sessionId = null;
      service.webSocket = null;
      service.pendingCompanionToolCalls?.clear?.();
      service.requestedCompanionResponses?.clear?.();
    }
    try { runtime.events.endBehaviorSession(sessionId); } catch {}
    try { runtime.behaviorEngine?.dispose?.(); } catch {}
    try { runtime.uninstallRuntime(); } catch {}
    if (socket && socket.readyState < WebSocket.CLOSING) caseCompleted ? socket.close() : socket.terminate();
  }
}

async function waitUntil(predicate, timeoutMs, fatalGetter, chainGetter) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    if (fatalGetter()) throw fatalGetter();
    await awaitWithin(chainGetter(), deadline, "Realtime event processing exceeded its deadline.");
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

async function awaitWithin(promise, deadline, message) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), remaining); })]);
  } finally { clearTimeout(timer); }
}

export async function runLiveEvaluation({ cases = companionLiveCases, suiteId, apiKey, outputPath, model = DEFAULT_MODEL, socketFactory, runtimeFactory, testOnly = false, ackTimeoutMs, perTurnMs } = {}) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const budget = { deadline: startedMs + WHOLE_RUN_MS, responseCreates: 0, responseCreateAttempts: 0, serverResponses: 0, finalResponses: 0 };
  const report = { mode: testOnly ? "test-fake-protocol-only" : "live-text-only-semantic-eval", status: "running", executionKind: testOnly ? "injected-fake-transport-no-model-evidence" : "real-realtime-text-session", networkUsed: false, ...(typeof suiteId === "string" && suiteId ? { suiteId: suiteId.slice(0, 80) } : {}), model, startedAt, receiptMode: "simulated-text-receipt; not heard/voice verified", semanticReview: "required; passCriteria are not machine-evaluated", limits: { maxCases: MAX_CASES, maxTurnsPerCase: MAX_TURNS_PER_CASE, maxResponseCreates: MAX_RESPONSE_CREATES, maxServerResponses: MAX_RESPONSE_CREATES, maxFinalResponses: MAX_FINAL_RESPONSES, maxToolRoundsPerTurn: MAX_TOOL_ROUNDS_PER_TURN, perTurnMs: PER_TURN_MS, wholeRunMs: WHOLE_RUN_MS }, cases: [] };
  const validationError = validateCases(cases);
  if (validationError) {
    report.status = "blocked";
    report.reason = validationError;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedMs;
    report.counters = { responseCreates: 0, responseCreateAttempts: 0, serverResponses: 0, finalResponses: 0 };
    await writeReport(outputPath, report);
    return report;
  }
  if (!testOnly && !outputPath) {
    report.status = "blocked";
    report.reason = "Live evaluation requires an explicit output report path; no network request was made.";
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedMs;
    report.counters = { responseCreates: 0, responseCreateAttempts: 0, serverResponses: 0, finalResponses: 0 };
    return report;
  }
  if (!testOnly && model !== DEFAULT_MODEL) {
    report.status = "blocked";
    report.reason = "Live evaluation uses only the configured default model; no network request was made.";
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedMs;
    report.counters = { responseCreates: 0, responseCreateAttempts: 0, serverResponses: 0, finalResponses: 0 };
    return report;
  }
  if (!apiKey) {
    report.status = "blocked";
    report.reason = "OPENAI_API_KEY is not set; no network request was made.";
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedMs;
    report.counters = { responseCreates: 0, responseCreateAttempts: 0, serverResponses: 0, finalResponses: 0 };
    await writeReport(outputPath, report);
    return report;
  }
  if (!testOnly) report.networkUsed = true;
  try {
    for (const testCase of cases) {
      if (Date.now() >= budget.deadline) throw new Error("Whole-run hard cap reached.");
      const caseStartedAt = Date.now();
      try {
        report.cases.push(await runCase(testCase, apiKey, budget, { model, socketFactory, runtimeFactory, testOnly, ackTimeoutMs, perTurnMs }));
      } catch (error) {
        const reason = error instanceof Error ? error.message.replaceAll(apiKey, "[REDACTED]") : "Live evaluation failed; details suppressed.";
        const partial = error?.liveCasePartial;
        report.cases.push({ id: testCase.id, ...fixtureInput(testCase), status: "blocked", durationMs: Date.now() - caseStartedAt, reason, turns: partial?.turns ?? [], observed: partial ? { responses: partial.responses, tools: partial.tools, toolResults: partial.toolResults, warnings: partial.warnings, engine: partial.engine } : undefined });
        throw error;
      }
    }
    report.status = testOnly ? "test_harness_only" : report.cases.some((item) => item.status !== "mechanical_checks_passed") ? "mechanical_checks_failed" : "human_review_required";
  } catch (error) {
    report.status = "blocked";
    report.reason = error instanceof Error ? error.message.replaceAll(apiKey, "[REDACTED]") : "Live evaluation failed; details suppressed.";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedMs;
    report.counters = { responseCreates: budget.responseCreates, responseCreateAttempts: budget.responseCreateAttempts, serverResponses: budget.serverResponses, finalResponses: budget.finalResponses };
    report.usage = report.cases.flatMap((item) => item.observed?.responses ?? []).reduce((totals, response) => ({
      inputTokens: totals.inputTokens + (Number(response.usage.inputTokens) || 0),
      outputTokens: totals.outputTokens + (Number(response.usage.outputTokens) || 0),
      totalTokens: totals.totalTokens + (Number(response.usage.totalTokens) || 0),
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    await writeReport(outputPath, report);
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const suite = getCompanionLiveSuite(args.suite);
  if (!args.live) {
    console.log(JSON.stringify({ mode: "offline-preflight", networkUsed: false, suiteId: suite.id, availableSuites: availableCompanionLiveSuites, model: DEFAULT_MODEL, limits: { maxCases: MAX_CASES, maxTurnsPerCase: MAX_TURNS_PER_CASE, maxResponseCreates: MAX_RESPONSE_CREATES, maxServerResponses: MAX_RESPONSE_CREATES, maxFinalResponses: MAX_FINAL_RESPONSES, maxToolRoundsPerTurn: MAX_TOOL_ROUNDS_PER_TURN, perTurnMs: PER_TURN_MS, wholeRunMs: WHOLE_RUN_MS }, cases: suite.cases.map(fixtureReview), note: "Run with --live --output PATH to opt in. No key or network is used by this preflight." }, null, 2));
    return;
  }
  if (!args.outputPath) throw new Error("--live requires --output PATH for the sanitized report.");
  const report = await runLiveEvaluation({ suiteId: suite.id, cases: suite.cases, apiKey: process.env.OPENAI_API_KEY, outputPath: args.outputPath });
  if (report.status === "human_review_required") console.log(`Live evaluation completed with mechanical checks only; human review required. Report: ${path.resolve(args.outputPath)}`);
  else { console.error(`${report.status}: ${report.reason ?? "see report for mechanical failures"}`); process.exitCode = 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => {
  const safe = error instanceof Error && /Usage:|--live requires/.test(error.message) ? error.message : "Live evaluation stopped; details suppressed.";
  console.error(safe);
  process.exitCode = 2;
});
