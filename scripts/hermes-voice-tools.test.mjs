import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createHermesTaskVoiceBridge } = load("src/voice/hermes-task-tools.ts");
const { AgentError } = load("src/agent/agent-protocol.ts");
const id = "1b64b268-0a42-4c1e-8abd-2686e9b8b722";
const otherId = "7e8f0d3f-6ec7-4cfe-a0e4-58b27a68f2d4";
const pendingId = "5f10311d-d3cd-4b43-8999-05f9db13c34c";
const task = (overrides = {}) => ({
  id, query: "Please research lithium battery recycling options.", language: "en", status: "queued",
  createdAt: "2026-10-26T12:00:00Z", updatedAt: "2026-10-26T12:00:00Z", answer: null, sources: [], error: null,
  ...overrides,
});

let current = true;
const calls = [];
let tasks = [task()];
let pending = null;
let pendingRecoveryError = null;
let olderPage = null;
let invalidateAtNextCursorRead = false;
let submitError = null;
let submitResult = task();
let flipTurnAfterSubmit = false;
const bridge = createHermesTaskVoiceBridge({
  async submit(query, language) { calls.push({ type: "submit", query, language }); if (flipTurnAfterSubmit) { flipTurnAfterSubmit = false; current = false; } if (submitError) throw submitError; return submitResult; },
  async listPage(cursor) {
    calls.push({ type: "list", cursor });
    if (cursor === "older") return olderPage;
    const page = { tasks, nextCursor: olderPage ? "older" : null };
    if (invalidateAtNextCursorRead && olderPage) {
      Object.defineProperty(page, "nextCursor", { get() { invalidateAtNextCursorRead = false; current = false; return "older"; } });
    }
    return page;
  },
  async get(taskId) { calls.push({ type: "get", taskId }); const found = [...tasks, ...(olderPage?.tasks ?? [])].find((item) => item.id === taskId); if (!found) throw new AgentError("not_found"); return found; },
  async getPending() { calls.push({ type: "pending" }); if (pendingRecoveryError) throw pendingRecoveryError; return pending; },
  async retryPending() { calls.push({ type: "retry" }); pending = null; return task({ status: "running" }); },
});

// The voice model may have seen several task IDs. A locally heard and accepted
// offer resolves to its own exact ID, regardless of which ID the model supplies.
let offered = { id, accepted: false };
const offeredLoader = createTypeScriptTreeLoader({ "./hermes-completion-watch": {
  watchHermesCompletion() {}, offeredHermesTask: () => offered, isGenericHermesAcceptance: (text) => text === "Yes, please.",
} });
const offeredBridgeFactory = offeredLoader("src/voice/hermes-task-tools.ts").createHermesTaskVoiceBridge;
const fetchedOfferedIds = [];
const offeredBridge = offeredBridgeFactory({
  async submit() { throw new Error("unexpected submit"); }, async listPage() { throw new Error("unexpected list"); },
  async get(taskId) { fetchedOfferedIds.push(taskId); return task({ id: taskId, status: "completed", answer: "Confirmed result" }); },
  async getPending() { return null; }, async retryPending() { throw new Error("unexpected retry"); },
});
const offeredTurn = { sessionId: "offered", userTurnRevision: 1, userText: "Yes, please.", language: "en", isCurrent: () => true };
assert.equal((await offeredBridge.execute("get_hermes_task", { id: otherId }, offeredTurn)).status, "awaiting-user-confirmation");
assert.equal(fetchedOfferedIds.length, 0, "the offer cannot fetch a result before the person confirms it");
offered = { id, accepted: true };
assert.equal((await offeredBridge.execute("get_hermes_task", { id: otherId }, offeredTurn)).id, id);
assert.deepEqual(fetchedOfferedIds, [id], "the accepted task identity overrides a confused model selection");
offered = null;
assert.equal((await offeredBridge.execute("get_hermes_task", { id: otherId }, offeredTurn)).status, "task-selection-required", "a generic yes after an unheard offer does not select a task");
assert.deepEqual(fetchedOfferedIds, [id]);

const turn = (userText, sessionId = "session-a", userTurnRevision = 1, isCurrent = () => current) => ({
  sessionId, userTurnRevision, userText, language: "en", isCurrent,
});

const started = await bridge.execute("start_hermes_task", { request: "Please research lithium battery recycling options." }, turn("Please research lithium battery recycling options."));
assert.equal(started.status, "queued");
assert.deepEqual(calls.filter((call) => call.type === "submit")[0], {
  type: "submit", query: "Please research lithium battery recycling options.", language: "en",
}, "only the exact current transcript is sent to Hermes");
assert.equal((await bridge.execute("start_hermes_task", { request: "Research lithium batteries" }, turn("Please research lithium battery recycling options."))).status, "request-must-match-current-transcript");
assert.equal((await bridge.execute("start_hermes_task", { request: "Please research lithium battery recycling options." }, turn("Please research lithium battery recycling options."))).status, "already-submitted-this-turn");

current = false;
const staleBeforeNetwork = calls.length;
assert.equal((await bridge.execute("start_hermes_task", { request: "Please research lithium battery recycling options." }, turn("Please research lithium battery recycling options.", "session-stale", 1))).status, "stale-turn");
assert.equal(calls.length, staleBeforeNetwork, "a stale session cannot make an agent request");
current = true;

flipTurnAfterSubmit = true;
const staleDuringRequest = turn("Please prepare a plan for a small greenhouse.", "session-b", 2);
const staleAdmission = await bridge.execute("start_hermes_task", { request: staleDuringRequest.userText }, staleDuringRequest);
assert.equal(staleAdmission.status, "stale-turn");
assert.equal(staleAdmission.admitted, true, "a turn change after request admission reports its task id without claiming completion");

current = true;
submitError = new AgentError("timeout");
const unknown = await bridge.execute("start_hermes_task", { request: "Please prepare a plan for a small greenhouse." }, turn("Please prepare a plan for a small greenhouse.", "session-c", 3));
assert.equal(unknown.status, "connection-outcome-unknown-check-task-list");
assert.equal(calls.filter((call) => call.type === "retry").length, 0, "unknown admission is never retried automatically");
submitError = null;

pending = { id: pendingId, query: "Please prepare a plan for a small greenhouse.", language: "en" };
tasks = [
  task({ id: otherId, status: "completed", query: "Please research lithium battery pricing and suppliers.", answer: "Lithium battery prices vary by supplier." }),
  task({ id, status: "completed", query: "Please research lithium battery recycling options.", answer: "Lithium recycling has several methods." }),
];
const ambiguous = await bridge.execute("list_hermes_tasks", { reference: "What did you find about lithium?" }, turn("What did you find about lithium?", "session-d", 4));
assert.equal(ambiguous.ambiguous, true, "a broad reference with tied matches is surfaced for clarification");
assert.equal(ambiguous.candidates.length, 2);
const callsBeforeAmbiguousGet = calls.filter((call) => call.type === "get").length;
const prematureGet = await bridge.execute("get_hermes_task", { id: otherId }, turn("What did you find about lithium?", "session-d", 4));
assert.equal(prematureGet.status, "task-selection-required");
assert.equal(calls.filter((call) => call.type === "get").length, callsBeforeAmbiguousGet, "an ambiguous candidate cannot be fetched before a new user choice");
const chosenGet = await bridge.execute("get_hermes_task", { id: otherId }, turn("The one about battery prices.", "session-d", 5));
assert.equal(chosenGet.status, "completed", "a later user choice can retrieve the selected task");

const unique = await bridge.execute("list_hermes_tasks", { reference: "What did you find about lithium battery recycling?" }, turn("What did you find about lithium battery recycling?", "session-e", 5));
assert.equal(unique.status, "completed");
assert.equal(unique.answer, "Lithium recycling has several methods.");
assert.equal(unique.pendingSubmission.status, "admission-unknown", "an unrelated pending admission remains visible to the conversation");

const list = await bridge.execute("list_hermes_tasks", {}, turn("What are you working on?", "session-f", 6));
assert.equal(list.tasks.length, 2);
assert.equal(list.pendingSubmission.status, "admission-unknown");

const retried = await bridge.execute("retry_pending_hermes_task", {}, turn("Retry the same pending Hermes task.", "session-g", 7));
assert.equal(retried.retriedSameTask, true);
assert.equal(calls.filter((call) => call.type === "retry").length, 1, "only the explicit retry tool resends the stored identity");

pending = { id: pendingId, query: "Please prepare a plan for a small greenhouse.", language: "en" };
tasks = [task({ id: pendingId, status: "running", query: pending.query })];
const confirmedAdmission = await bridge.execute("list_hermes_tasks", {}, turn("What are you working on?", "session-h", 8));
assert.equal(confirmedAdmission.pendingSubmission.status, "admission-confirmed-needs-retry", "known server admission remains visible until the same id clears the local journal");

tasks = [task({ id: pendingId, status: "running", query: "A different task with the same id." })];
const conflictingAdmission = await bridge.execute("list_hermes_tasks", {}, turn("What are you working on?", "session-conflict", 1));
assert.equal(conflictingAdmission.pendingSubmission.status, "admission-conflict", "an id match alone does not establish the pending payload was admitted");
tasks = [task({ id: pendingId, status: "running", query: pending.query })];

pendingRecoveryError = new AgentError("storage");
const listWithoutRecovery = await bridge.execute("list_hermes_tasks", {}, turn("What are you working on?", "session-i", 9));
assert.equal(listWithoutRecovery.tasks.length, 1, "a local recovery-store failure does not hide readable server tasks");
assert.equal(listWithoutRecovery.pendingRecoveryUnavailable, true);
const resultWithoutRecovery = await bridge.execute("list_hermes_tasks", { reference: "greenhouse" }, turn("What about the greenhouse?", "session-recovery", 1));
assert.equal(resultWithoutRecovery.pendingRecoveryUnavailable, true, "a specific task response must disclose a recovery-store failure as well");
pendingRecoveryError = null;

const oldTask = task({ id: "c1164f05-80a3-4f0f-b9fd-1a10cf8356af", status: "completed", query: "Please research ocean plastic cleanup projects.", answer: "Several cleanup projects exist." });
olderPage = { tasks: [oldTask], nextCursor: null };
const oldResult = await bridge.execute("list_hermes_tasks", { reference: "What happened with ocean plastic cleanup?" }, turn("What happened with ocean plastic cleanup?", "session-j", 10));
assert.equal(oldResult.answer, "Several cleanup projects exist.", "specific references page through older task summaries before giving a result");
assert.ok(calls.some((call) => call.type === "list" && call.cursor === "older"));

olderPage = null;
tasks = Array.from({ length: 11 }, (_, index) => task({ id: `task-${index}`, query: `Task number ${index}` }));
const truncatedOverview = await bridge.execute("list_hermes_tasks", {}, turn("What are you working on?", "session-overview", 1));
assert.equal(truncatedOverview.tasks.length, 10);
assert.equal(truncatedOverview.hasMore, true, "an overview must disclose omitted tasks even when the server returned them in one page");

let searchPage = 0;
let incompleteDetailReads = 0;
const incompleteBridge = createHermesTaskVoiceBridge({
  async submit() { throw new Error("unexpected submission"); },
  async retryPending() { throw new Error("unexpected retry"); },
  async getPending() { return null; },
  async listPage() {
    searchPage += 1;
    return { tasks: searchPage === 1 ? [oldTask] : [], nextCursor: `page-${searchPage}` };
  },
  async get() { incompleteDetailReads += 1; return oldTask; },
});
const incompleteTurn = turn("What happened with ocean plastic cleanup?", "session-incomplete", 1);
const incomplete = await incompleteBridge.execute("list_hermes_tasks", { reference: incompleteTurn.userText }, incompleteTurn);
assert.equal(incomplete.status, "search-incomplete");
assert.equal(incomplete.candidates.length, 1);
assert.equal(incomplete.hasMore, true);
assert.equal(incompleteDetailReads, 0, "a match in an incomplete history is not read as a unique answer");
assert.equal((await incompleteBridge.execute("get_hermes_task", { id: oldTask.id }, incompleteTurn)).status, "task-selection-required");
assert.equal(incompleteDetailReads, 0, "the model cannot bypass clarification in the same turn");

olderPage = { tasks: [oldTask], nextCursor: null };
current = true;
invalidateAtNextCursorRead = true;
const beforeStalePaging = calls.filter((call) => call.type === "list").length;
const interruptedPageSearch = await bridge.execute("list_hermes_tasks", { reference: "What happened with ocean plastic cleanup?" }, turn("What happened with ocean plastic cleanup?", "session-k", 11));
assert.equal(interruptedPageSearch.status, "stale-turn");
assert.equal(calls.filter((call) => call.type === "list").length, beforeStalePaging + 1, "a changed turn prevents a later cursor page request");

console.log("Hermes voice task bridge: PASS");
