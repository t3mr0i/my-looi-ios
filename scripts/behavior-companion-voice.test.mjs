import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const flush = async () => {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
};

const loadBehaviorCompanion = () => createTypeScriptTreeLoader()("src/behavior/behavior-companion.ts");

async function callCompanionTool(service, callId, text, name, args) {
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: text, item_id: `${callId}-turn` });
  const responseId = `${callId}-response`;
  await service.handleEvent({ type: "response.created", response: { id: responseId } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: responseId,
    item: { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) },
  });
  await flush();
  return responseId;
}

async function assertFullRecallThroughTransport(service, sent, prefix) {
  const { createBehaviorCompanion } = loadBehaviorCompanion();
  const companion = createBehaviorCompanion({ now: () => 80_000 });
  const detail = "We built the paper rocket together, painted its silver wings, tested the fins, repaired the nose cone, and launched it from the garden after lunch.";
  const outcome = "The rocket landed safely beyond the blue garden chair, beside the yellow bucket, and we agreed to widen its foot next time.";
  const origin = "Gerda finally flew today.";
  companion.userTurn(origin);
  assert.equal(companion.act({ type: "propose_experience", title: "Gerda", detail, outcome, motif: "hold", evidence: origin }, { userText: origin, sessionId: "recall-source" }).status, "proposed");
  companion.assistantEnd("Should I remember Gerda?");
  companion.userTurn("Yes");
  const episodeId = companion.snapshot().episodes[0].id;
  const question = "Tell me what happened with Gerda.";
  companion.userTurn(question);
  const result = companion.act({ type: "recall_experience", id: episodeId }, { userText: question, sessionId: "recall-source" });
  assert.equal(result.episode?.detail, detail, "the selected recall includes confirmed detail beyond the compact preview");
  assert.equal(result.episode?.outcome, outcome);
  const previousResult = actionResult;
  try {
    actionResult = result;
    sent.length = 0;
    const callId = `${prefix}-full-recall`;
    await callCompanionTool(service, callId, question, "recall_shared_experience", { id: episodeId });
    const output = sent.find((event) => event.item?.call_id === callId);
    assert.ok(output, `${prefix} returns the selected episode as a tool result`);
    assert.deepEqual(JSON.parse(output.item.output), result, `${prefix} preserves full confirmed recall facts and provenance`);
    assert.equal(sent.filter((event) => event.type === "response.create").length, 1, `${prefix} creates one tool-result response`);
  } finally {
    actionResult = previousResult;
  }
}

function makeSearchFixture(sessionId) {
  const { createBehaviorCompanion } = loadBehaviorCompanion();
  const companion = createBehaviorCompanion({ now: () => 80_000 });
  const origin = "Gerda finally flew today after our paper rocket project.";
  const detail = "We built the paper rocket together, attached silver wings, checked the fins three times, repaired the nose cone, and launched it from the garden.";
  const outcome = "On its first launch it flew over the garden, circled the tree, and landed safely beyond the blue chair.";
  companion.userTurn(origin);
  const proposal = companion.act({
    type: "propose_experience", title: "Gerda", detail, outcome, motif: "hold", evidence: "paper rocket project",
  }, { userText: origin, sessionId });
  assert.equal(proposal.status, "proposed");
  companion.assistantEnd("Should I remember Gerda?");
  companion.userTurn("Yes, please.");
  const episode = companion.snapshot().episodes[0];
  assert.ok(episode, "the search fixture contains one confirmed episode");
  return { companion, sessionId, episode, userText: "", results: [] };
}

function toolOutput(sent, callId) {
  const event = sent.find((candidate) => candidate.item?.call_id === callId);
  assert.ok(event, `transport returns a tool result for ${callId}`);
  return JSON.parse(event.item.output);
}

async function assertMemoryCapacityThroughTransport(service, sent, prefix, sessionId) {
  const { createBehaviorCompanion } = loadBehaviorCompanion();
  const companion = createBehaviorCompanion({ now: () => 80_000 });
  for (let index = 0; index < 8; index += 1) {
    const title = `Capacity${index}`;
    const origin = `${title} was our completed shared project.`;
    companion.userTurn(origin);
    assert.equal(companion.act({ type: "propose_experience", title, detail: "We built it together.", outcome: "It worked.", motif: "hold", evidence: origin }, { userText: origin, sessionId }).status, "proposed");
    companion.assistantEnd(`Should I remember ${title}?`);
    companion.userTurn("Yes.");
  }
  const before = companion.snapshot();
  const rememberedBefore = rememberedNotes.length;
  const fixture = { companion, sessionId, userText: "", results: [] };
  activeCapacityFixture = fixture;
  try {
    sent.length = 0;
    const text = "Comet was our new completed shared project.";
    const callId = `${prefix}-capacity-full`;
    const responseId = await callCompanionTool(service, callId, text, "propose_shared_experience", {
      title: "Comet", detail: "We built it together.", outcome: "It worked.", motif: "hold", evidence: text,
    });
    const result = toolOutput(sent, callId);
    assert.equal(result.status, "memory_full");
    assert.equal(result.ok, false);
    assert.deepEqual(result.capacity, { used: 8, limit: 8 });
    assert.deepEqual(result, fixture.results.at(-1), `${prefix} returns the actual companion capacity result unchanged`);
    assert.deepEqual(companion.snapshot(), before, `${prefix} full memory retains every confirmed episode and creates no pending confirmation`);
    assert.equal(sent.filter((event) => event.type === "response.create").length, 1, `${prefix} creates one explanatory follow-up for the failed save`);

    await service.handleEvent({ type: "response.done", response: { id: responseId, status: "completed", output: [{ type: "function_call" }] } });
    const fallbackResponseId = `${prefix}-capacity-fallback-response`;
    await service.handleEvent({ type: "response.created", response: { id: fallbackResponseId } });
    const fallbackCall = `${prefix}-capacity-fallback`;
    await service.handleEvent({
      type: "response.output_item.done", response_id: fallbackResponseId,
      item: { type: "function_call", call_id: fallbackCall, name: "remember", arguments: JSON.stringify({ note: "Comet was our new completed shared project." }) },
    });
    await flush();
    assert.equal(toolOutput(sent, fallbackCall).status, "shared-experience-capacity", `${prefix} cannot bypass a rejected episode through ordinary remember in its follow-up response`);
    assert.equal(rememberedNotes.length, rememberedBefore);
    assert.deepEqual(companion.snapshot(), before);

    const freshCall = `${prefix}-capacity-next-personal-fact`;
    await callCompanionTool(service, freshCall, "My favorite drink is tea.", "remember", { note: "The user's favorite drink is tea." });
    assert.equal(toolOutput(sent, freshCall).ok, true, `${prefix} a fresh user turn still admits an ordinary personal fact`);
    assert.equal(rememberedNotes.length, rememberedBefore + 1);
    assert.deepEqual(companion.snapshot(), before);
  } finally {
    activeCapacityFixture = null;
    rememberedNotes.splice(rememberedBefore);
  }
}

async function assertSearchThroughTransport(service, sent, prefix, sessionId) {
  const fixture = makeSearchFixture(sessionId);
  activeSearchFixture = fixture;
  const rememberedCount = rememberedNotes.length;
  const assertNoRitualSideEffects = (ritualState) => {
    assert.equal(service.armedSharedRituals.size, ritualState.armed, `${prefix} search does not arm a ritual`);
    assert.equal(service.attemptedSharedRituals.size, ritualState.attempted, `${prefix} search does not consume a ritual attempt`);
    assert.equal(fixture.companion.snapshot().scene.status, "idle", `${prefix} search leaves the companion scene idle`);
    assert.equal(rememberedNotes.length, rememberedCount, `${prefix} search does not write a memory note`);
  };
  const ritualState = {
    armed: service.armedSharedRituals.size,
    attempted: service.attemptedSharedRituals.size,
  };

  try {
    const query = "paper rocket fins nose cone";
    const userText = `Please search our saved story for \"${query}\".`;
    sent.length = 0;
    const actionsBeforeSearch = receivedActions.length;
    const callId = `${prefix}-search-full`;
    await callCompanionTool(service, callId, userText, "search_shared_experiences", { query });
    const result = toolOutput(sent, callId);
    const actual = fixture.results.at(-1);
    assert.equal(receivedActions.length, actionsBeforeSearch + 1, `${prefix} routes one search action to the local companion`);
    assert.deepEqual(actual.action, { type: "search_experiences", query }, `${prefix} preserves the exact query bytes`);
    assert.equal(result.status, "candidates_found");
    assert.equal(result.totalMatches, 1);
    assert.equal(result.matches.length, 1);
    assert.deepEqual(result.matches[0].matchedTerms, ["paper", "rocket", "fins", "nose", "cone"]);
    assert.equal(result.matches[0].episode.id, fixture.episode.id);
    assert.equal(result.matches[0].episode.detail, fixture.episode.detail, `${prefix} returns the complete saved detail`);
    assert.equal(result.matches[0].episode.outcome, fixture.episode.outcome, `${prefix} returns the complete saved outcome`);
    assert.deepEqual(result.matches[0].episode.source, fixture.episode.source, `${prefix} preserves evidence provenance`);
    assert.deepEqual(result, actual.result, `${prefix} serializes the actual local search result as JSON`);
    assert.deepEqual(actual.after, actual.before, `${prefix} search leaves companion memory unchanged`);
    assert.equal(sent.filter((event) => event.type === "response.create").length, 1, `${prefix} creates one tool-result follow-up`);
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    const noMatchCallId = `${prefix}-search-no-match`;
    const noMatchQuery = "purple elephant";
    await callCompanionTool(service, noMatchCallId, `Search the saved notes for ${noMatchQuery}.`, "search_shared_experiences", { query: noMatchQuery });
    const noMatch = toolOutput(sent, noMatchCallId);
    assert.equal(noMatch.status, "no_candidates", `${prefix} reports only a literal lexical no-match`);
    assert.deepEqual(noMatch.matches, []);
    assert.equal(noMatch.totalMatches, 0);
    assert.deepEqual(fixture.results.at(-1).action, { type: "search_experiences", query: noMatchQuery });
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    const absentEvidenceCallId = `${prefix}-search-absent-evidence`;
    const absentQuery = "paper rocket";
    const actionsBeforeAbsentEvidence = receivedActions.length;
    await callCompanionTool(service, absentEvidenceCallId, "Search the Gerda entry by its saved details.", "search_shared_experiences", { query: absentQuery });
    const absentEvidence = toolOutput(sent, absentEvidenceCallId);
    assert.equal(receivedActions.length, actionsBeforeAbsentEvidence + 1, `${prefix} forwards the query unchanged for exact validation`);
    assert.equal(absentEvidence.status, "missing_evidence", `${prefix} does not let a query absent from the turn invent evidence`);
    assert.deepEqual(fixture.results.at(-1).action, { type: "search_experiences", query: absentQuery });
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    const untrimmedQuery = " paper rocket ";
    const untrimmedCallId = `${prefix}-search-untrimmed`;
    await callCompanionTool(service, untrimmedCallId, `Search for the exact phrase '${untrimmedQuery}'.`, "search_shared_experiences", { query: untrimmedQuery });
    const untrimmed = toolOutput(sent, untrimmedCallId);
    assert.deepEqual(fixture.results.at(-1).action, { type: "search_experiences", query: untrimmedQuery }, `${prefix} never trims a model query into evidence`);
    assert.equal(untrimmed.status, "invalid_action", `${prefix} lets the engine reject non-canonical query text`);
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    const invalidCallId = `${prefix}-search-invalid-type`;
    const actionsBeforeInvalidType = receivedActions.length;
    await callCompanionTool(service, invalidCallId, "Search this story.", "search_shared_experiences", { query: 42 });
    const invalidType = toolOutput(sent, invalidCallId);
    assert.equal(receivedActions.length, actionsBeforeInvalidType, `${prefix} rejects a non-string query before dispatch`);
    assert.equal(typeof invalidType.error, "string");
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    const duplicateText = "Search our saved memory for the rocket.";
    const duplicateResponseId = `${prefix}-search-duplicate-response`;
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: duplicateText, item_id: `${prefix}-search-duplicate-turn` });
    await service.handleEvent({ type: "response.created", response: { id: duplicateResponseId } });
    const duplicateActionsBefore = receivedActions.length;
    const firstDuplicateCall = `${prefix}-search-duplicate-first`;
    await service.handleEvent({
      type: "response.output_item.done", response_id: duplicateResponseId,
      item: { type: "function_call", call_id: firstDuplicateCall, name: "search_shared_experiences", arguments: JSON.stringify({ query: "rocket" }) },
    });
    await flush();
    assert.equal(toolOutput(sent, firstDuplicateCall).status, "candidates_found");
    assert.equal(receivedActions.length, duplicateActionsBefore + 1);
    const duplicateCall = `${prefix}-search-duplicate-second`;
    await service.handleEvent({
      type: "response.output_item.done", response_id: duplicateResponseId,
      item: { type: "function_call", call_id: duplicateCall, name: "search_shared_experiences", arguments: JSON.stringify({ query: "rocket" }) },
    });
    await flush();
    assert.equal(receivedActions.length, duplicateActionsBefore + 1, `${prefix} preserves one-companion-action-per-turn gate`);
    assert.equal(toolOutput(sent, duplicateCall).status, "already-handled-this-turn");
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Search the notes for rocket.", item_id: `${prefix}-search-stale-turn` });
    const staleResponseId = `${prefix}-search-stale-response`;
    await service.handleEvent({ type: "response.created", response: { id: staleResponseId } });
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    const actionsBeforeStale = receivedActions.length;
    const staleCallId = `${prefix}-search-stale-call`;
    await service.handleEvent({
      type: "response.output_item.done", response_id: staleResponseId,
      item: { type: "function_call", call_id: staleCallId, name: "search_shared_experiences", arguments: JSON.stringify({ query: "rocket" }) },
    });
    await flush();
    assert.equal(receivedActions.length, actionsBeforeStale, `${prefix} rejects a stale search before local dispatch`);
    assert.equal(toolOutput(sent, staleCallId).status, "stale-turn");
    assert.equal(sent.some((event) => event.type === "response.create"), false, `${prefix} does not answer a stale search turn`);
    assertNoRitualSideEffects(ritualState);

    sent.length = 0;
    await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Search the rocket notes.", item_id: `${prefix}-search-session-turn` });
    const sessionResponseId = `${prefix}-search-session-response`;
    await service.handleEvent({ type: "response.created", response: { id: sessionResponseId } });
    const otherSessionId = `${prefix}-other-session`;
    behaviorEvents.endBehaviorSession(sessionId);
    behaviorEvents.beginBehaviorSession(otherSessionId, () => {}, () => false);
    const actionsBeforeSessionChange = receivedActions.length;
    const otherSessionCallId = `${prefix}-search-other-session`;
    await service.handleEvent({
      type: "response.output_item.done", response_id: sessionResponseId,
      item: { type: "function_call", call_id: otherSessionCallId, name: "search_shared_experiences", arguments: JSON.stringify({ query: "rocket" }) },
    });
    await flush();
    assert.equal(receivedActions.length, actionsBeforeSessionChange, `${prefix} rejects a search after the behavior session changes`);
    assert.equal(toolOutput(sent, otherSessionCallId).status, "stale-turn");
    assert.equal(sent.some((event) => event.type === "response.create"), false, `${prefix} sends no follow-up for a stale session`);
    behaviorEvents.endBehaviorSession(otherSessionId);
  } finally {
    activeSearchFixture = null;
  }
}

const behaviorEvents = loadTypeScript("src/behavior/behavior-events.ts");
const hermesTaskToolDefinitions = loadTypeScript("src/voice/hermes-task-tool-definitions.ts");
const robotAppSkillToolDefinitions = loadTypeScript("src/voice/robot-app-skill-tool-definitions.ts");
const robotAppSkillCalls = [];
const robotAppSkillToolModule = loadTypeScript("src/voice/robot-app-skill-tools.ts", {
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
});
const robotAppSkillToolBridge = robotAppSkillToolModule.createRobotAppSkillToolBridge({
  async searchRobotAppSkills(query, limit) {
    robotAppSkillCalls.push({ method: "search", query, limit });
    return { status: "listed", items: [{ spaceId: "pollen/dance-demo", title: "Dance demo" }] };
  },
  async describeRobotAppSkill(spaceId) {
    robotAppSkillCalls.push({ method: "describe", spaceId });
    return { status: "described", spaceId };
  },
  async startRobotAppSkill(spaceId, options) {
    robotAppSkillCalls.push({ method: "start", spaceId, current: options?.isCurrent?.() });
    return { status: "handoff_requested", spaceId };
  },
  async stopRobotAppSkills() {
    robotAppSkillCalls.push({ method: "stop" });
    return { status: "stopped" };
  },
});
const receivedActions = [];
const hermesVoiceCalls = [];
const hermesVoiceBridge = {
  async execute(name, args, turn) {
    hermesVoiceCalls.push({ name, args, sessionId: turn.sessionId, userTurnRevision: turn.userTurnRevision, userText: turn.userText, current: turn.isCurrent() });
    return { ok: true, id: "1b64b268-0a42-4c1e-8abd-2686e9b8b722", status: "queued", query: turn.userText };
  },
};
const contextUpdates = [];
const rememberedNotes = [];
let currentContext = "";
let actionResult = { ok: true, status: "proposed", instruction: "Ask once, then wait." };
let activeSearchFixture = null;
let activeCapacityFixture = null;
let manualResponseRequired = false;
let clearManualResponseOnNextUserTurn = false;
const detachAdapter = behaviorEvents.registerBehaviorAdapter({
  dispatch(event) {
    if (event.type === "user-turn") currentContext = JSON.stringify({ latestTurn: event.text });
  },
  getContext: () => currentContext,
  inspectVisual: async () => "",
  companionAction(action) {
    receivedActions.push(action);
    return actionResult;
  },
});

const configModule = loadTypeScript("src/voice/realtime-config.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "../openai/realtime-models": {
    DEFAULT_REALTIME_MODEL_ID: "test-realtime",
    normalizeRealtimeModelId: (value) => value || "test-realtime",
    supportsRealtimeReasoning: () => false,
  },
  "./tts-voices": loadTypeScript("src/voice/tts-voices.ts"),
  "./hermes-completion-copy": loadTypeScript("src/voice/hermes-completion-copy.ts"),
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
});
const preferences = {
  language: "en", listeningLanguage: "en", realtimeModelId: "test-realtime",
  ttsVoiceId: "alloy", ttsSpeed: 1, speechGender: "masculine", robotName: "LOOI",
  robotAddressAliases: [], robotAddressRecognitionAliases: [],
};
const realtimeConfig = configModule.buildRealtimeSessionUpdate(preferences, undefined, undefined, "{\"companion\":{\"episodes\":[]}}", false).session;
const tools = realtimeConfig.tools;
const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
for (const name of ["propose_shared_experience", "list_shared_experiences", "correct_shared_experience", "search_shared_experiences", "recall_shared_experience", "forget_shared_experience", "offer_small_interest", "propose_visual_memory", "compare_shared_object", "prepare_shared_ritual", "manage_shared_activity", "set_episode_ritual"]) {
  assert.ok(toolByName.has(name), `Realtime exposes ${name}`);
  assert.equal(toolByName.get(name).parameters.additionalProperties, false);
}
for (const name of ["start_hermes_task", "list_hermes_tasks", "get_hermes_task", "retry_pending_hermes_task"]) {
  assert.ok(toolByName.has(name), `Realtime exposes ${name}`);
  assert.equal(toolByName.get(name).parameters.additionalProperties, false);
}
for (const name of ["search_robot_apps", "describe_robot_app", "start_robot_app", "stop_robot_app"]) {
  assert.ok(toolByName.has(name), `Realtime exposes ${name}`);
  assert.equal(toolByName.get(name).parameters.additionalProperties, false);
}
assert.deepEqual(toolByName.get("list_shared_experiences").parameters.properties, {});
assert.deepEqual(toolByName.get("list_shared_experiences").parameters.required, []);
assert.deepEqual(toolByName.get("correct_shared_experience").parameters.required, ["id", "field", "replacement", "evidence"]);
assert.deepEqual(toolByName.get("correct_shared_experience").parameters.properties.field.enum, ["detail", "outcome"]);
assert.equal(toolByName.get("correct_shared_experience").parameters.properties.replacement.maxLength, 220);
assert.equal(toolByName.get("correct_shared_experience").parameters.properties.evidence.maxLength, 240);
assert.deepEqual(toolByName.get("search_shared_experiences").parameters.required, ["query"]);
assert.equal(toolByName.get("search_shared_experiences").parameters.properties.query.type, "string");
assert.equal(toolByName.get("search_shared_experiences").parameters.properties.query.minLength, 1);
assert.equal(toolByName.get("search_shared_experiences").parameters.properties.query.maxLength, 240);
assert.equal(toolByName.get("search_shared_experiences").parameters.additionalProperties, false);
assert.deepEqual(toolByName.get("propose_shared_experience").parameters.required, ["title", "detail", "outcome", "motif", "evidence"]);
assert.deepEqual(toolByName.get("propose_shared_experience").parameters.properties.motif.enum, ["hold", "curious", "happy_bob", "nod"]);
assert.match(toolByName.get("propose_shared_experience").parameters.properties.evidence.description, /anywhere in the current user turn/u);
assert.match(realtimeConfig.instructions, /short word-for-word quote/u);
assert.match(realtimeConfig.instructions, /ask exactly one concise confirmation question/u);
assert.match(realtimeConfig.instructions, /do not repeat, remind, or follow up/u);
assert.match(realtimeConfig.instructions, /do not call remember during that turn/u);
assert.match(realtimeConfig.instructions, /LOCAL ROBOT INTERACTION STATE/u);
assert.deepEqual(toolByName.get("propose_visual_memory").parameters.required, ["id", "description", "evidence"]);
assert.deepEqual(toolByName.get("compare_shared_object").parameters.properties.match.enum, ["same", "different", "uncertain"]);
assert.deepEqual(toolByName.get("prepare_shared_ritual").parameters.properties.signal.enum, ["voice", "open_palm"]);
assert.deepEqual(toolByName.get("manage_shared_activity").parameters.required, ["operation", "id", "evidence"]);
assert.deepEqual(toolByName.get("manage_shared_activity").parameters.properties.operation.enum, ["begin", "confirm_step", "report_result", "resume", "cancel"]);
assert.deepEqual(toolByName.get("manage_shared_activity").parameters.properties.step.enum, ["checked", "prepared"]);
assert.deepEqual(toolByName.get("set_episode_ritual").parameters.properties.mode.enum, ["active", "silent"]);
assert.deepEqual(toolByName.get("set_episode_ritual").parameters.properties.motif.enum, ["nod", "curious", "happy_bob"]);
assert.match(toolByName.get("set_episode_ritual").description, /distinct from prepare_shared_ritual/u);
assert.match(configModule.buildSharedCountdownInstructions("ru"), /Три\. Два\. Один\. Поехали!/u);
assert.match(configModule.buildSharedCountdownInstructions("uk"), /Три\. Два\. Один\. Поїхали!/u);
assert.match(configModule.buildSharedCountdownInstructions("de"), /Drei\. Zwei\. Eins\. Los!/u);
assert.match(configModule.buildSharedCountdownInstructions("en"), /Three\. Two\. One\. Go!/u);
assert.match(configModule.buildSharedCountdownInstructions("en"), /Do not claim that the robot moved/u);

const facadeSession = "facade-session";
let facadeSignal = null;
behaviorEvents.beginBehaviorSession(facadeSession, (context) => contextUpdates.push(context), (signal) => { facadeSignal = signal; return true; });
behaviorEvents.publishBehaviorEvent({ type: "user-turn", text: "We named the rocket Gerda.", sessionId: facadeSession, turnId: "facade-turn" });
const facadeSnapshot = behaviorEvents.getBehaviorInteractionSnapshot(facadeSession);
assert.ok(facadeSnapshot);
const facadeResult = behaviorEvents.performBehaviorCompanionAction({ type: "recall_experience", id: "ep_demo" }, facadeSession);
assert.equal(facadeResult, actionResult, "the session facade returns the local engine result unchanged");
assert.deepEqual(receivedActions.at(-1), { type: "recall_experience", id: "ep_demo" });
assert.equal(behaviorEvents.getBehaviorConversationContext(facadeSession), currentContext);
assert.equal(behaviorEvents.performBehaviorCompanionAction({ type: "recall_experience", id: "ep_demo" }, "other-session").status, "session-inactive");
assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-1", episodeTitle: "Gerda" }, facadeSession), true);
assert.deepEqual(facadeSignal, { kind: "shared-countdown", id: "scene-1", episodeTitle: "Gerda" });
assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-1", episodeTitle: "Gerda" }, "other-session"), false);
behaviorEvents.publishBehaviorEvent({ type: "user-speech-start", sessionId: facadeSession });
assert.equal(behaviorEvents.getBehaviorInteractionSnapshot(facadeSession), null, "barge-in invalidates the current tool authorization");
behaviorEvents.endBehaviorSession(facadeSession);
assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-1", episodeTitle: "Gerda" }, facadeSession), false, "ending the session removes the signal callback");

const conversationStore = {
  isUserSpeaking: false,
  setCurrentTranscript() {}, addMessage() {}, setListening() {}, setProcessing() {}, setSpeaking() {},
  setUserSpeaking() {}, setHeardSpeechText() {}, setStreamingText() {}, setOverlayVisible() {}, setRealtimeReadiness() {},
  setActiveSession() {}, setRealtimeIssue() {},
};
const preferencesState = {
  ...preferences,
  ambientMotionLevel: "normal", voiceOutputGain: 1,
  customVoiceCommands: {},
};
const userStore = {
  preferences: preferencesState,
  robotSleeping: false,
  setVoiceState() {},
  updatePreferences(patch) { Object.assign(preferencesState, patch); },
};
const flatActionArguments = JSON.stringify({
  title: "Gerda's first flight",
  detail: "We named the paper rocket Gerda and launched it together.",
  outcome: "It finally flew.",
  motif: "happy_bob",
  evidence: "Gerda and it finally flew",
});

function makeAdapter() {
  return {
    dispatch(event) {
      if (event.type === "user-turn") {
        currentContext = JSON.stringify({ latestTurn: event.text, companion: { episodes: [] } });
        if (activeSearchFixture?.sessionId === event.sessionId) {
          activeSearchFixture.userText = event.text;
          activeSearchFixture.companion.userTurn(event.text);
        }
        if (activeCapacityFixture?.sessionId === event.sessionId) {
          activeCapacityFixture.userText = event.text;
          activeCapacityFixture.companion.userTurn(event.text);
        }
        if (clearManualResponseOnNextUserTurn) {
          manualResponseRequired = false;
          clearManualResponseOnNextUserTurn = false;
        }
      }
    },
    getContext: () => currentContext,
    inspectVisual: async () => "",
    isGameActive: () => false,
    requiresManualResponse: () => manualResponseRequired,
    companionAction(action) {
      receivedActions.push(action);
      if (action.type === "propose_experience" && activeCapacityFixture) {
        const result = activeCapacityFixture.companion.act(action, {
          userText: activeCapacityFixture.userText,
          sessionId: activeCapacityFixture.sessionId,
        });
        activeCapacityFixture.results.push(result);
        return result;
      }
      if (action.type === "prepare_shared_ritual" && actionResult.status === "ritual_armed") {
        manualResponseRequired = true;
        clearManualResponseOnNextUserTurn = action.signal === "voice";
      }
      if (action.type === "search_experiences" && activeSearchFixture) {
        const before = activeSearchFixture.companion.snapshot();
        const result = activeSearchFixture.companion.act(action, {
          userText: activeSearchFixture.userText,
          sessionId: activeSearchFixture.sessionId,
        });
        activeSearchFixture.results.push({ action, before, after: activeSearchFixture.companion.snapshot(), result });
        return result;
      }
      return actionResult;
    },
  };
}

function registerSession(sessionId, signalRequester) {
  behaviorEvents.beginBehaviorSession(sessionId, (context) => contextUpdates.push(context), signalRequester);
  const detach = behaviorEvents.registerBehaviorAdapter(makeAdapter());
  return detach;
}

function mockCommonBehaviorDependencies() {
  return {
    "../behavior/behavior-events": behaviorEvents,
    "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
    "expo-audio": { async setIsAudioActiveAsync() {} },
    "../core/observation": { createObservation: () => ({ metadata: {} }) },
    "../core/robot-inactivity": { markRobotInteraction() {} },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../memory/local-memory-database": { localMemoryDatabase: { async search() { return []; }, async remember(messages) { rememberedNotes.push(messages[0]?.content ?? ""); } } },
    "../memory/memory-service": {
      isLocalMemoryMutationInProgress: () => false,
      mirrorSessionMessage() {}, mirrorSessionTouch() {},
      async retrieveConversationMemories() { return { facts: [], strategy: "test" }; },
    },
    "../openai/openai-api-key": {
      async createOpenAiRealtimeClientSecret() { return { value: "local-test-secret", expiresAt: 0 }; },
      async exchangeOpenAiRealtimeSdp() { return ""; },
      createOpenAiRealtimeEphemeralWebSocket() { return {}; },
    },
    "../store/conversation": { useConversationStore: { getState: () => conversationStore } },
    "../store/user": { isPcmRealtimeMode: () => false, useUserStore: { getState: () => userStore } },
    "../../modules/vosk-command-recognizer": { __esModule: true, default: {
      addListener: () => ({ remove() {} }),
      async beginAssistantOutput() { return { ready: false, generation: 0 }; },
      cancelAssistantOutput() {}, endAssistantOutput() {}, feedAssistantPcm24() { return false; },
    } },
    "../character/speech-expression": {
      createSpeechExpressionTracker: () => ({
        acceptRecognition() {}, setNativeGeneration() {}, advancePlayback() {}, setTranscript() {}, invalidate() {},
      }),
    },
    "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
  "../language/response-language": { normalizeResponseLanguage: (language) => language },
    "../core/main-screen-presence": { isMainScreenFocused: () => true },
    "../vision/look-here": { captureExplicitLookHereStill: async () => null },
    "../openai/openai-api-status": { classifyOpenAiError: () => null, async setOpenAiApiStatus() {} },
    "../../modules/realtime-audio-route": {
      async activateRealtimeSpeakerRoute() { return {}; }, async deactivateRealtimeSpeakerRoute() { return {}; },
      async ensureRealtimeSpeakerRoute() { return {}; }, async getRealtimeAudioRouteStatus() { return { supported: false }; },
    },
    "./kws-audio-feeder": { kwsAudioFeeder: {
      diagnosticStatus: { appCaptureAllowed: true }, isRunning: false,
      setAppCaptureAllowed() {}, setWakewordFeedingEnabled() {}, getRecentSamples: () => [],
      async start() {}, async stop() {}, subscribeSamples() { return () => {}; },
    } },
    "./wakeword": { wakewordService: { async start() {}, async stop() {}, async waitForFallbackIdle() {}, isListening: false } },
    "./realtime-config": {
      REALTIME_MODEL: "test-realtime", REALTIME_UPLINK_GAIN: 1,
      applyRealtimeUplinkGain: (samples) => [...samples], base64ToBytes: () => new Uint8Array(),
      buildRealtimeSessionUpdate: (...args) => ({ type: "session.update", session: { manualResponseTurns: args[4] } }), bytesToBase64: () => "",
      buildSharedCountdownInstructions: configModule.buildSharedCountdownInstructions,
      buildHermesCompletionInstructions: configModule.buildHermesCompletionInstructions,
      floatSamplesToPcm16Bytes: () => new Uint8Array(), resample16kTo24k: (samples) => [...samples],
    },
    "./hermes-task-tools": { hermesTaskVoiceBridge: hermesVoiceBridge },
    "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
    "./robot-app-skill-tools": { robotAppSkillToolBridge },
    "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
    "./realtime-physical-command": {
      parseRealtimePhysicalCommand: () => null, executeRealtimePhysicalCommand: async () => ({ ok: true }),
    },
    "./realtime-visual-command": { parseRealtimeVisualCommand: () => null },
  };
}

function assertHermesCompletionGate(service, sent, sessionId, label) {
  behaviorEvents.publishBehaviorEvent({ type: "user-turn", sessionId, text: "Please research this." });
  const snapshot = behaviorEvents.getBehaviorInteractionSnapshot(sessionId);
  const signal = { kind: "hermes-completed", id: "1b64b268-0a42-4c1e-8abd-2686e9b8b722", ...snapshot };
  sent.length = 0;
  service.generationActive = true;
  assert.equal(behaviorEvents.requestBehaviorSignalResponse(signal, sessionId), false, `${label} does not interrupt a response`);
  service.generationActive = false;
  manualResponseRequired = true;
  assert.equal(behaviorEvents.requestBehaviorSignalResponse(signal, sessionId), false, `${label} does not interrupt a pending confirmation`);
  manualResponseRequired = false;
  assert.equal(behaviorEvents.requestBehaviorSignalResponse(signal, sessionId), true, `${label} can offer a confirmed result when idle`);
  assert.equal(sent.filter((item) => item.type === "response.create").length, 1);
  assert.match(sent.at(-1).response.instructions, /Would you like to hear the result/u);
  behaviorEvents.publishBehaviorEvent({ type: "user-speech-start", sessionId });
  assert.equal(behaviorEvents.requestBehaviorSignalResponse(signal, sessionId), false, `${label} rejects a stale turn`);
  sent.length = 0;
}

async function exerciseWebRtcTransport() {
  const sessionId = "webrtc-session";
  const deps = {
    ...mockCommonBehaviorDependencies(),
    "react-native-webrtc": {
      RTCPeerConnection: class {}, RTCSessionDescription: class {}, mediaDevices: {},
    },
    "../core/main-screen-presence": { isMainScreenFocused: () => true },
    "./realtime-pcm-conversation": { realtimePcmConversationService: {} },
  };
  assert.equal(typeof deps["../store/conversation"].useConversationStore.getState().setHeardSpeechText, "function");
  const { RealtimeConversationService } = loadTypeScript("src/voice/realtime-conversation.ts", deps);
  let service;
  const detach = registerSession(sessionId, (signal) => service?.requestSharedCountdown(signal, sessionId) ?? false);
  service = new RealtimeConversationService();
  const sent = [];
  service.send = (event) => { sent.push(event); return true; };
  service.active = true;
  service.configured = true;
  service.sessionId = sessionId;
  service.dataChannel = { readyState: "open" };
  assertHermesCompletionGate(service, sent, sessionId, "WebRTC");
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "We named the rocket Gerda and it finally flew", item_id: "webrtc-turn-1" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-response-1" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-response-1",
    item: { type: "function_call", call_id: "webrtc-call-1", name: "propose_shared_experience", arguments: flatActionArguments },
  });
  await flush();
  assert.deepEqual(receivedActions.at(-1), {
    type: "propose_experience", title: "Gerda's first flight",
    detail: "We named the paper rocket Gerda and launched it together.", outcome: "It finally flew.",
    motif: "happy_bob", evidence: "Gerda and it finally flew",
  });
  const toolOutput = sent.find((event) => event.item?.call_id === "webrtc-call-1");
  assert.deepEqual(JSON.parse(toolOutput.item.output), actionResult, "WebRTC passes the engine result through unchanged");
  assert.equal(sent.filter((event) => event.type === "response.create").length, 1, "WebRTC uses only the existing tool-response follow-up");

  const webRtcAppCallsBefore = robotAppSkillCalls.length;
  await callCompanionTool(service, "webrtc-app-search", "Find a dance app and try a suitable one.", "search_robot_apps", { query: "dance", limit: 2 });
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-search").item.output), {
    status: "listed", items: [{ spaceId: "pollen/dance-demo", title: "Dance demo" }], ok: true,
  }, "WebRTC returns a bounded searchable catalog result");
  await callCompanionTool(service, "webrtc-app-describe", "Find a dance app and try a suitable one.", "describe_robot_app", { space_id: "pollen/dance-demo" });
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-describe").item.output).status, "described");
  await callCompanionTool(service, "webrtc-app-start", "Find a dance app and try a suitable one.", "start_robot_app", { space_id: "pollen/dance-demo" });
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-start").item.output).status, "handoff_requested", "app handoff is not reported as a running robot action");
  assert.deepEqual(robotAppSkillCalls.slice(webRtcAppCallsBefore).map(({ method }) => method), ["search", "describe", "start"]);

  // Two model calls for one user turn cannot admit duplicate app starts.
  const duplicateStartsBefore = robotAppSkillCalls.filter(({ method }) => method === "start").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Start the best suitable robot app.", item_id: "webrtc-app-duplicate-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-app-duplicate-response" } });
  for (const [callId, space_id] of [["webrtc-app-duplicate-first", "pollen/dance-demo"], ["webrtc-app-duplicate-second", "pollen/face-demo"]]) {
    await service.handleEvent({
      type: "response.output_item.done", response_id: "webrtc-app-duplicate-response",
      item: { type: "function_call", call_id: callId, name: "start_robot_app", arguments: JSON.stringify({ space_id }) },
    });
  }
  await flush();
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "start").length, duplicateStartsBefore + 1);
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-duplicate-second").item.output).status, "already-started-this-turn");

  // A late tool from a response invalidated by new speech cannot launch an app.
  const webRtcStartsBeforeStale = robotAppSkillCalls.filter(({ method }) => method === "start").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-app-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Never mind, do not start an app.", item_id: "webrtc-app-new-turn" });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-app-stale-response",
    item: { type: "function_call", call_id: "webrtc-app-stale", name: "start_robot_app", arguments: JSON.stringify({ space_id: "pollen/dance-demo" }) },
  });
  await flush();
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "start").length, webRtcStartsBeforeStale);
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-stale").item.output).status, "stale-turn");

  const webRtcStartsBeforeBadJson = robotAppSkillCalls.filter(({ method }) => method === "start").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Try a dance app.", item_id: "webrtc-app-invalid-json-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-app-invalid-json-response" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-app-invalid-json-response",
    item: { type: "function_call", call_id: "webrtc-app-invalid-json", name: "start_robot_app", arguments: "{not-json" },
  });
  await flush();
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-invalid-json").item.output), { ok: false, status: "invalid-arguments" });
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "start").length, webRtcStartsBeforeBadJson, "malformed tool JSON cannot reach the app runtime");

  const webRtcStopsBeforeBadJson = robotAppSkillCalls.filter(({ method }) => method === "stop").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Try a dance app.", item_id: "webrtc-app-invalid-stop-json-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-app-invalid-stop-json-response" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-app-invalid-stop-json-response",
    item: { type: "function_call", call_id: "webrtc-app-invalid-stop-json", name: "stop_robot_app", arguments: "{not-json" },
  });
  await flush();
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-app-invalid-stop-json").item.output), { ok: false, status: "invalid-arguments" });
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "stop").length, webRtcStopsBeforeBadJson, "malformed stop arguments cannot stop an app");

  const hermesRequest = "Please ask Hermes to prepare a plan for improving a small greenhouse.";
  const webRtcHermesCallsBefore = hermesVoiceCalls.length;
  await callCompanionTool(service, "webrtc-hermes-start", hermesRequest, "start_hermes_task", { request: hermesRequest });
  assert.deepEqual(hermesVoiceCalls.at(-1), {
    name: "start_hermes_task", args: { request: hermesRequest }, sessionId, userTurnRevision: hermesVoiceCalls.at(-1).userTurnRevision,
    userText: hermesRequest, current: true,
  }, "WebRTC passes only the accepted exact transcript and current session to Hermes");
  assert.equal(hermesVoiceCalls.length, webRtcHermesCallsBefore + 1);
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-hermes-start").item.output).status, "queued");

  const webRtcHermesBeforeStale = hermesVoiceCalls.length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-hermes-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually, do not start that task.", item_id: "webrtc-hermes-new-turn" });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-hermes-stale-response",
    item: { type: "function_call", call_id: "webrtc-hermes-stale", name: "start_hermes_task", arguments: JSON.stringify({ request: hermesRequest }) },
  });
  assert.equal(hermesVoiceCalls.length, webRtcHermesBeforeStale, "a stale WebRTC response cannot start a Hermes task");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-hermes-stale").item.output).status, "stale-turn");

  await assertFullRecallThroughTransport(service, sent, "webrtc");
  await assertMemoryCapacityThroughTransport(service, sent, "webrtc", sessionId);

  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-response-early" } });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "We named the rocket Gerda. It finally flew.", item_id: "webrtc-turn-2" });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-response-early",
    item: { type: "function_call", call_id: "webrtc-early-call", name: "propose_shared_experience", arguments: JSON.stringify({ title: "Gerda", detail: "We named the rocket Gerda.", outcome: "It finally flew.", motif: "happy_bob", evidence: "Gerda" }) },
  });
  await flush();
  assert.deepEqual(receivedActions.at(-1), { type: "propose_experience", title: "Gerda", detail: "We named the rocket Gerda.", outcome: "It finally flew.", motif: "happy_bob", evidence: "Gerda" }, "an exact quote from any sentence in the accepted turn is allowed even when response.created arrived first");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-early-call").item.output).status, "proposed");

  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "We met yesterday. It finally flew.", item_id: "webrtc-turn-3" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-response-3" } });
  const actionCountBeforeBadEvidence = receivedActions.length;
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-response-3",
    item: { type: "function_call", call_id: "webrtc-bad-evidence", name: "propose_shared_experience", arguments: JSON.stringify({ title: "Gerda", detail: "The rocket flew.", outcome: "It finally flew.", motif: "happy_bob", evidence: "Gerda" }) },
  });
  await flush();
  assert.equal(receivedActions.length, actionCountBeforeBadEvidence, "evidence absent from the complete current turn is rejected");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-bad-evidence").item.output).status, "evidence-not-in-current-turn");

  const memoriesBeforePending = rememberedNotes.length;
  currentContext = JSON.stringify({ companion: { pendingConfirmation: { kind: "create", title: "Gerda" }, episodes: [] } });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-memory-pending" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-memory-pending",
    item: { type: "function_call", call_id: "webrtc-remember-pending", name: "remember", arguments: '{"note":"We named the rocket Gerda."}' },
  });
  await flush();
  assert.equal(rememberedNotes.length, memoriesBeforePending, "generic remember cannot bypass an unresolved episode confirmation");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-remember-pending").item.output).status, "pending-shared-experience");

  currentContext = JSON.stringify({ companion: { pendingConfirmation: null, episodes: [{
    title: "Gerda's first flight", detail: "We named the paper rocket Gerda and launched it together.",
    outcome: "It finally flew.", source: { evidence: "We named the rocket Gerda." },
  }] } });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-memory-duplicate" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-memory-duplicate",
    item: { type: "function_call", call_id: "webrtc-remember-duplicate", name: "remember", arguments: '{"note":"We named the paper rocket Gerda and launched it together."}' },
  });
  await flush();
  assert.equal(rememberedNotes.length, memoriesBeforePending, "a confirmed shared episode cannot be duplicated as an ordinary fact");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-remember-duplicate").item.output).status, "duplicate-shared-experience");

  currentContext = JSON.stringify({ companion: { pendingConfirmation: { kind: "create", title: "Gerda" }, episodes: [] } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Yes, please remember it", item_id: "webrtc-confirmation-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-memory-confirmation" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-memory-confirmation",
    item: { type: "function_call", call_id: "webrtc-remember-confirmation", name: "remember", arguments: '{"note":"We named the rocket Gerda."}' },
  });
  await flush();
  assert.equal(rememberedNotes.length, memoriesBeforePending, "the confirmation reply itself cannot store the episode through generic remember");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-remember-confirmation").item.output).status, "pending-shared-experience");

  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "I live in Berlin", item_id: "webrtc-next-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-memory-next-turn" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-memory-next-turn",
    item: { type: "function_call", call_id: "webrtc-remember-next-turn", name: "remember", arguments: '{"note":"The user lives in Berlin."}' },
  });
  await flush();
  assert.deepEqual(rememberedNotes.at(-1), "The user lives in Berlin.", "an unrelated ordinary fact is available to remember on the next turn");

  actionResult = { ok: true, status: "visual_memory_pending", instruction: "Ask whether this is right." };
  await callCompanionTool(service, "webrtc-visual-memory", "Remember the blue cup from Gerda's flight.", "propose_visual_memory", {
    id: "ep-gerda", description: "A small blue cup with a white handle.", evidence: "Remember the blue cup",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "propose_visual_memory", id: "ep-gerda", description: "A small blue cup with a white handle.", evidence: "Remember the blue cup",
  }, "WebRTC binds visual-memory evidence to the accepted user turn");

  actionResult = { ok: true, status: "comparison_pending", instruction: "Ask one title-specific confirmation." };
  await callCompanionTool(service, "webrtc-object-comparison", "Compare the cup in this photo with Gerda's first flight.", "compare_shared_object", {
    id: "ep-gerda", observedDescription: "A blue cup with a white handle.", change: "It looks similar to the remembered cup.", match: "same",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "compare_shared_object", id: "ep-gerda", observedDescription: "A blue cup with a white handle.", change: "It looks similar to the remembered cup.", match: "same",
  }, "WebRTC sends only the tentative comparison action to the local engine");

  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-webrtc-open-palm", episodeTitle: "Gerda's first flight", instruction: "Wait for an open palm." };
  const ritualResponseId = await callCompanionTool(service, "webrtc-ritual-prepare", "For Gerda's first flight, start when I show an open palm.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "prepare_shared_ritual", id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  }, "WebRTC binds the named episode and open-palm request to the current turn");
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-ritual-prepare").item.output), actionResult, "WebRTC returns the local ritual result unchanged");
  assert.equal(behaviorEvents.requiresBehaviorTurnCommit(sessionId), true, "an armed ritual switches the voice session to committed-turn responses");
  service.applySessionPreferences("ritual-armed-test");
  assert.equal(sent.at(-1).session.manualResponseTurns, true, "WebRTC updates server VAD to wait for a committed transcript while armed");
  await service.handleEvent({ type: "response.done", response: { id: ritualResponseId, status: "completed", output: [] } });
  sent.length = 0;
  manualResponseRequired = false; // Root accepts the local signal and marks the scene started before invoking voice.
  preferencesState.language = "ru";
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-webrtc-open-palm", episodeTitle: "Gerda's first flight" }, sessionId), true);
  assert.deepEqual(sent.map((event) => event.type), ["session.update", "response.create"], "WebRTC applies current preferences before the one countdown response");
  assert.equal(sent[0].session.manualResponseTurns, false, "started rituals restore automatic VAD response mode");
  assert.equal(sent[1].response.instructions, configModule.buildSharedCountdownInstructions("ru"));
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-webrtc-open-palm", episodeTitle: "Gerda's first flight" }, sessionId), false, "a local ritual signal cannot create a duplicate response");

  preferencesState.language = "en";
  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-webrtc-busy", episodeTitle: "Gerda's first flight", instruction: "Wait for an open palm." };
  const busyResponseId = await callCompanionTool(service, "webrtc-ritual-busy", "For Gerda's first flight, start when I show an open palm.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  });
  await service.handleEvent({ type: "response.done", response: { id: busyResponseId, status: "completed", output: [] } });
  sent.length = 0;
  service.generationActive = true;
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-webrtc-busy", episodeTitle: "Gerda's first flight" }, sessionId), false, "a busy WebRTC response closes instead of queueing a ritual start");
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-webrtc-busy", episodeTitle: "Gerda's first flight" }, sessionId), false, "a rejected busy start cannot be retried twice");
  assert.equal(sent.some((event) => event.type === "response.create"), false);
  service.generationActive = false;

  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-webrtc-voice", episodeTitle: "Gerda's first flight", instruction: "Say the start phrase when ready." };
  const voiceRitualResponseId = await callCompanionTool(service, "webrtc-ritual-voice", "For Gerda's first flight, start when I say go.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "voice", evidence: "start when I say go",
  });
  await service.handleEvent({ type: "response.done", response: { id: voiceRitualResponseId, status: "completed", output: [] } });
  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Go, start Gerda's first flight.", item_id: "webrtc-voice-signal-turn" });
  assert.equal(behaviorEvents.requiresBehaviorTurnCommit(sessionId), false, "a spoken start returns the session to automatic VAD after transcript commit");
  const voiceResponseCount = sent.filter((event) => event.type === "response.create").length;
  assert.equal(voiceResponseCount, 1, "the spoken start has exactly one committed-turn response");
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-webrtc-voice", episodeTitle: "Gerda's first flight" }, sessionId), false, "a voice ritual relies on VAD and never invokes the local hand-signal callback");
  assert.equal(sent.filter((event) => event.type === "response.create").length, voiceResponseCount, "voice-start callback creates no duplicate response");

  actionResult = { ok: true, status: "activity_pending", instruction: "Ask the exact confirmation question." };
  await callCompanionTool(service, "webrtc-activity-begin", "Let's begin the rocket trial now.", "manage_shared_activity", {
    operation: "begin", id: "ep-gerda", evidence: "begin the rocket trial now",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "manage_shared_activity", operation: "begin", id: "ep-gerda", evidence: "begin the rocket trial now" }, "WebRTC forwards an explicitly requested activity with current-turn evidence");
  const webrtcActionsBeforeBadEvidence = receivedActions.length;
  await callCompanionTool(service, "webrtc-activity-bad-evidence", "Let's discuss the rocket trial.", "manage_shared_activity", {
    operation: "begin", id: "ep-gerda", evidence: "start the rocket trial",
  });
  assert.equal(receivedActions.length, webrtcActionsBeforeBadEvidence, "WebRTC rejects activity evidence absent from this exact turn");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-activity-bad-evidence").item.output).status, "evidence-not-in-current-turn");

  actionResult = { ok: true, status: "ritual_choice_pending", instruction: "Ask the exact confirmation question." };
  await callCompanionTool(service, "webrtc-episode-ritual-active", "For Gerda's first flight, greet me with a nod and say Ready, launch!", "set_episode_ritual", {
    id: "ep-gerda", mode: "active", motif: "nod", phrase: "Ready, launch!", evidence: "greet me with a nod and say Ready, launch!",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "set_episode_ritual", id: "ep-gerda", mode: "active", motif: "nod", phrase: "Ready, launch!", evidence: "greet me with a nod and say Ready, launch!" }, "WebRTC forwards an explicitly chosen ritual and exact phrase");
  let actionsBeforeInvalidRitual = receivedActions.length;
  await callCompanionTool(service, "webrtc-episode-ritual-bad-mode", "Mute the ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "automatic", evidence: "Mute the ritual for Gerda's first flight",
  });
  assert.equal(receivedActions.length, actionsBeforeInvalidRitual, "WebRTC rejects an unsupported ritual mode");
  await callCompanionTool(service, "webrtc-episode-ritual-bad-motif", "For Gerda's first flight, greet me with a nod.", "set_episode_ritual", {
    id: "ep-gerda", mode: "active", motif: "wave", evidence: "greet me with a nod",
  });
  assert.equal(receivedActions.length, actionsBeforeInvalidRitual, "WebRTC rejects an unsupported ritual gesture");
  await callCompanionTool(service, "webrtc-episode-ritual-no-quote", "Mute the ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "silent", evidence: "stop the ritual for Gerda's first flight",
  });
  assert.equal(receivedActions.length, actionsBeforeInvalidRitual, "WebRTC rejects ritual evidence missing from this turn");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-episode-ritual-no-quote").item.output).status, "evidence-not-in-current-turn");
  await callCompanionTool(service, "webrtc-episode-ritual-mute", "Mute the personal ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "silent", evidence: "Mute the personal ritual for Gerda's first flight",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "set_episode_ritual", id: "ep-gerda", mode: "silent", evidence: "Mute the personal ritual for Gerda's first flight" }, "WebRTC forwards an explicitly named ritual mute");

  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-response-4" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  const actionCount = receivedActions.length;
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-response-4",
    item: { type: "function_call", call_id: "webrtc-stale-call", name: "recall_shared_experience", arguments: '{"id":"ep_demo"}' },
  });
  await flush();
  assert.equal(receivedActions.length, actionCount, "barge-in invalidates the old WebRTC tool call");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-stale-call").item.output).status, "stale-turn");
  assert.equal(sent.some((event) => event.type === "response.create"), false, "a stale WebRTC tool call cannot start a late answer");

  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-activity-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  const actionsBeforeStaleActivity = receivedActions.length;
  await service.handleEvent({ type: "response.output_item.done", response_id: "webrtc-activity-stale-response", item: { type: "function_call", call_id: "webrtc-activity-stale", name: "manage_shared_activity", arguments: JSON.stringify({ operation: "begin", id: "ep-gerda", evidence: "begin it" }) } });
  await flush();
  assert.equal(receivedActions.length, actionsBeforeStaleActivity, "a stale WebRTC activity request cannot reach the local engine");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-activity-stale").item.output).status, "stale-turn");
  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-episode-ritual-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  const actionsBeforeStaleRitual = receivedActions.length;
  await service.handleEvent({ type: "response.output_item.done", response_id: "webrtc-episode-ritual-stale-response", item: { type: "function_call", call_id: "webrtc-episode-ritual-stale", name: "set_episode_ritual", arguments: JSON.stringify({ id: "ep-gerda", mode: "silent", evidence: "mute it" }) } });
  await flush();
  assert.equal(receivedActions.length, actionsBeforeStaleRitual, "a stale WebRTC ritual choice cannot reach the local engine");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-episode-ritual-stale").item.output).status, "stale-turn");

  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "webrtc-response-a" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Forget that shared story", item_id: "webrtc-turn-4" });
  const actionsBeforeLateA = receivedActions.length;
  await service.handleEvent({
    type: "response.output_item.done", response_id: "webrtc-response-a",
    item: { type: "function_call", call_id: "webrtc-late-a-call", name: "recall_shared_experience", arguments: '{"id":"ep_demo"}' },
  });
  await flush();
  assert.equal(receivedActions.length, actionsBeforeLateA, "a response created for speech A cannot inherit speech B's accepted turn");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "webrtc-late-a-call").item.output).status, "stale-turn");
  assert.equal(sent.some((event) => event.type === "response.create"), false, "a late response A tool call cannot start an answer for turn B");
  await assertSearchThroughTransport(service, sent, "webrtc", sessionId);
  behaviorEvents.endBehaviorSession(sessionId);
  detach();
}

async function exercisePcmTransport() {
  const sessionId = "pcm-session";
  const audio = { beginPlayback() {}, enqueuePlayback() {}, finishPlayback() {}, stopPlayback() { return { playedDurationMs: 0 }; }, addListener() { return { remove() {} }; } };
  const deps = {
    ...mockCommonBehaviorDependencies(),
    "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
    "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
    "../../modules/local-realtime-audio-capture/realtime-pcm": {
      getRealtimePcmAudioModule: () => audio,
      async startPcmCapture() { return { captureRunning: true }; }, async stopPcmCapture() {}, async reservePcmCapture() {},
    },
  };
  const { RealtimePcmConversationService } = loadTypeScript("src/voice/realtime-pcm-conversation.ts", deps);
  let service;
  const detach = registerSession(sessionId, (signal) => service?.requestSharedCountdown(signal, sessionId, service.lifecycleGeneration) ?? false);
  service = new RealtimePcmConversationService();
  const sent = [];
  service.send = (event) => { sent.push(event); return true; };
  service.active = true;
  service.configured = true;
  service.sessionId = sessionId;
  service.webSocket = { readyState: 1 };
  assertHermesCompletionGate(service, sent, sessionId, "PCM");
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "We named the rocket Gerda and it finally flew", item_id: "pcm-turn-1" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-response-1" } });
  actionResult = { ok: false, status: "visual_not_authorized", instruction: "Wait for a permitted image." };
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-response-1",
    item: { type: "function_call", call_id: "pcm-call-1", name: "offer_small_interest", arguments: '{"topic":"paper rocket","question":"Should it fly again?"}' },
  });
  await flush();
  const toolOutput = sent.find((event) => event.item?.call_id === "pcm-call-1");
  assert.deepEqual(JSON.parse(toolOutput.item.output), actionResult, "PCM returns the local engine gate result unchanged");
  assert.deepEqual(receivedActions.at(-1), { type: "offer_interest", topic: "paper rocket", question: "Should it fly again?" });
  assert.equal(sent.filter((event) => event.type === "response.create").length, 1, "PCM uses only the existing tool-response follow-up");

  const pcmAppCallsBefore = robotAppSkillCalls.length;
  await callCompanionTool(service, "pcm-app-search", "Find a suitable app for dancing and try it.", "search_robot_apps", { query: "dance" });
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-app-search").item.output).status, "listed");
  await callCompanionTool(service, "pcm-app-start", "Find a suitable app for dancing and try it.", "start_robot_app", { space_id: "pollen/dance-demo" });
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-app-start").item.output).status, "handoff_requested");
  assert.deepEqual(robotAppSkillCalls.slice(pcmAppCallsBefore).map(({ method }) => method), ["search", "start"]);

  const pcmStartsBeforeStale = robotAppSkillCalls.filter(({ method }) => method === "start").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-app-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Never mind, do not launch an app.", item_id: "pcm-app-new-turn" });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-app-stale-response",
    item: { type: "function_call", call_id: "pcm-app-stale", name: "start_robot_app", arguments: JSON.stringify({ space_id: "pollen/dance-demo" }) },
  });
  await flush();
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "start").length, pcmStartsBeforeStale);
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-app-stale").item.output).status, "stale-turn");

  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Find a dance app.", item_id: "pcm-app-invalid-json-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-app-invalid-json-response" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-app-invalid-json-response",
    item: { type: "function_call", call_id: "pcm-app-invalid-json", name: "search_robot_apps", arguments: "{not-json" },
  });
  await flush();
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-app-invalid-json").item.output), { ok: false, status: "invalid-arguments" });

  const pcmStopsBeforeBadJson = robotAppSkillCalls.filter(({ method }) => method === "stop").length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Try a dance app.", item_id: "pcm-app-invalid-stop-json-turn" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-app-invalid-stop-json-response" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-app-invalid-stop-json-response",
    item: { type: "function_call", call_id: "pcm-app-invalid-stop-json", name: "stop_robot_app", arguments: "{not-json" },
  });
  await flush();
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-app-invalid-stop-json").item.output), { ok: false, status: "invalid-arguments" });
  assert.equal(robotAppSkillCalls.filter(({ method }) => method === "stop").length, pcmStopsBeforeBadJson, "malformed stop arguments cannot stop an app");

  const hermesRequest = "Please ask Hermes to prepare a plan for improving a small greenhouse.";
  const pcmHermesCallsBefore = hermesVoiceCalls.length;
  await callCompanionTool(service, "pcm-hermes-start", hermesRequest, "start_hermes_task", { request: hermesRequest });
  assert.equal(hermesVoiceCalls.length, pcmHermesCallsBefore + 1, "PCM routes an explicitly requested Hermes task");
  assert.equal(hermesVoiceCalls.at(-1).sessionId, sessionId);
  assert.equal(hermesVoiceCalls.at(-1).userText, hermesRequest);
  assert.equal(hermesVoiceCalls.at(-1).current, true);
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-hermes-start").item.output).status, "queued");

  const pcmHermesBeforeStale = hermesVoiceCalls.length;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-hermes-stale-response" } });
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually, do not start that task.", item_id: "pcm-hermes-new-turn" });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-hermes-stale-response",
    item: { type: "function_call", call_id: "pcm-hermes-stale", name: "start_hermes_task", arguments: JSON.stringify({ request: hermesRequest }) },
  });
  assert.equal(hermesVoiceCalls.length, pcmHermesBeforeStale, "a stale PCM response cannot start a Hermes task");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-hermes-stale").item.output).status, "stale-turn");

  await assertFullRecallThroughTransport(service, sent, "pcm");
  await assertMemoryCapacityThroughTransport(service, sent, "pcm", sessionId);

  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-response-early" } });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "We built a small paper rocket. It finally flew.", item_id: "pcm-turn-2" });
  actionResult = { ok: true, status: "proposed", instruction: "Ask once, then wait." };
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-response-early",
    item: { type: "function_call", call_id: "pcm-early-call", name: "propose_shared_experience", arguments: JSON.stringify({ title: "Paper rocket", detail: "We built a small paper rocket.", outcome: "It finally flew.", motif: "happy_bob", evidence: "paper rocket" }) },
  });
  await flush();
  assert.deepEqual(receivedActions.at(-1), { type: "propose_experience", title: "Paper rocket", detail: "We built a small paper rocket.", outcome: "It finally flew.", motif: "happy_bob", evidence: "paper rocket" }, "PCM binds an early response only to the immediately completed speech turn");

  const memoriesBeforePending = rememberedNotes.length;
  currentContext = JSON.stringify({ companion: { pendingConfirmation: { kind: "create", title: "Paper rocket" }, episodes: [] } });
  await service.handleEvent({ type: "response.created", response: { id: "pcm-memory-pending" } });
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-memory-pending",
    item: { type: "function_call", call_id: "pcm-remember-pending", name: "remember", arguments: '{"note":"We built a small paper rocket."}' },
  });
  await flush();
  assert.equal(rememberedNotes.length, memoriesBeforePending, "PCM generic remember cannot bypass pending episode confirmation");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-remember-pending").item.output).status, "pending-shared-experience");

  actionResult = { ok: true, status: "visual_memory_pending", instruction: "Ask whether this is right." };
  await callCompanionTool(service, "pcm-visual-memory", "Remember the red kite from Gerda's flight.", "propose_visual_memory", {
    id: "ep-gerda", description: "A red kite with a short yellow tail.", evidence: "Remember the red kite",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "propose_visual_memory", id: "ep-gerda", description: "A red kite with a short yellow tail.", evidence: "Remember the red kite",
  }, "PCM binds visual-memory evidence to the accepted user turn");

  actionResult = { ok: true, status: "comparison_pending", instruction: "Ask one title-specific confirmation." };
  await callCompanionTool(service, "pcm-object-comparison", "Compare the kite in this photo with Gerda's first flight.", "compare_shared_object", {
    id: "ep-gerda", observedDescription: "A red kite with a yellow tail.", change: "The tail seems shorter than the remembered one.", match: "different",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "compare_shared_object", id: "ep-gerda", observedDescription: "A red kite with a yellow tail.", change: "The tail seems shorter than the remembered one.", match: "different",
  }, "PCM passes the tentative object comparison to the local engine");

  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-pcm-open-palm", episodeTitle: "Gerda's first flight", instruction: "Wait for an open palm." };
  const ritualResponseId = await callCompanionTool(service, "pcm-ritual-prepare", "For Gerda's first flight, start when I show an open palm.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  });
  assert.deepEqual(receivedActions.at(-1), {
    type: "prepare_shared_ritual", id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  }, "PCM binds the named episode and open-palm request to the current turn");
  assert.deepEqual(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-ritual-prepare").item.output), actionResult, "PCM returns the local ritual result unchanged");
  assert.equal(behaviorEvents.requiresBehaviorTurnCommit(sessionId), true, "an armed PCM ritual switches VAD to committed-turn responses");
  service.applySessionPreferences("ritual-armed-test");
  assert.equal(sent.at(-1).session.manualResponseTurns, true, "PCM updates server VAD to wait for a committed transcript while armed");
  await service.handleEvent({ type: "response.done", response: { id: ritualResponseId, status: "completed", output: [] } });
  sent.length = 0;
  manualResponseRequired = false; // Root marks the scene started before this accepted local signal.
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-pcm-open-palm", episodeTitle: "Gerda's first flight" }, sessionId), true);
  assert.deepEqual(sent.map((event) => event.type), ["session.update", "response.create"], "PCM applies current preferences before the countdown response");
  assert.equal(sent[0].session.manualResponseTurns, false, "started rituals restore automatic VAD response mode");
  assert.equal(sent[1].response.instructions, configModule.buildSharedCountdownInstructions("en"));
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-pcm-open-palm", episodeTitle: "Gerda's first flight" }, sessionId), false, "PCM cannot repeat the same accepted hand signal");

  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-pcm-stale", episodeTitle: "Gerda's first flight", instruction: "Wait for an open palm." };
  const staleRitualResponseId = await callCompanionTool(service, "pcm-ritual-stale", "For Gerda's first flight, start when I show an open palm.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "open_palm", evidence: "start when I show an open palm",
  });
  await service.handleEvent({ type: "response.done", response: { id: staleRitualResponseId, status: "completed", output: [] } });
  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-pcm-stale", episodeTitle: "Gerda's first flight" }, sessionId), false, "a newer PCM speech start invalidates a pending local signal");
  assert.equal(sent.some((event) => event.type === "response.create"), false, "a stale signal never queues a response");

  actionResult = { ok: true, status: "ritual_armed", sceneId: "scene-pcm-voice", episodeTitle: "Gerda's first flight", instruction: "Say the start phrase when ready." };
  const voiceRitualResponseId = await callCompanionTool(service, "pcm-ritual-voice", "For Gerda's first flight, start when I say go.", "prepare_shared_ritual", {
    id: "ep-gerda", signal: "voice", evidence: "start when I say go",
  });
  await service.handleEvent({ type: "response.done", response: { id: voiceRitualResponseId, status: "completed", output: [] } });
  sent.length = 0;
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Go, start Gerda's first flight.", item_id: "pcm-voice-signal-turn" });
  assert.equal(behaviorEvents.requiresBehaviorTurnCommit(sessionId), false, "PCM restores automatic VAD after a committed spoken-start turn");
  const voiceResponseCount = sent.filter((event) => event.type === "response.create").length;
  assert.equal(voiceResponseCount, 1, "PCM sends exactly one committed-turn response for voice-start");
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "shared-countdown", id: "scene-pcm-voice", episodeTitle: "Gerda's first flight" }, sessionId), false, "voice-start never invokes the local hand-signal callback");
  assert.equal(sent.filter((event) => event.type === "response.create").length, voiceResponseCount, "voice-start produces no extra response");

  actionResult = { ok: true, status: "activity_pending", instruction: "Ask the exact confirmation question." };
  await callCompanionTool(service, "pcm-activity-begin", "Please begin the kite trial.", "manage_shared_activity", {
    operation: "begin", id: "ep-gerda", evidence: "begin the kite trial",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "manage_shared_activity", operation: "begin", id: "ep-gerda", evidence: "begin the kite trial" }, "PCM forwards explicit activity request with current-turn evidence");
  const pcmActionsBeforeBadEvidence = receivedActions.length;
  await callCompanionTool(service, "pcm-activity-bad-evidence", "Please discuss the kite trial.", "manage_shared_activity", {
    operation: "begin", id: "ep-gerda", evidence: "begin the kite trial",
  });
  assert.equal(receivedActions.length, pcmActionsBeforeBadEvidence, "PCM rejects activity evidence absent from this exact turn");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-activity-bad-evidence").item.output).status, "evidence-not-in-current-turn");

  actionResult = { ok: true, status: "ritual_choice_pending", instruction: "Ask the exact confirmation question." };
  await callCompanionTool(service, "pcm-episode-ritual-active", "For Gerda's first flight, greet me with a nod and say Ready, launch!", "set_episode_ritual", {
    id: "ep-gerda", mode: "active", motif: "nod", phrase: "Ready, launch!", evidence: "greet me with a nod and say Ready, launch!",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "set_episode_ritual", id: "ep-gerda", mode: "active", motif: "nod", phrase: "Ready, launch!", evidence: "greet me with a nod and say Ready, launch!" }, "PCM forwards explicitly chosen ritual and exact phrase");
  const pcmActionsBeforeInvalidRitual = receivedActions.length;
  await callCompanionTool(service, "pcm-episode-ritual-bad-mode", "Mute the ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "automatic", evidence: "Mute the ritual for Gerda's first flight",
  });
  assert.equal(receivedActions.length, pcmActionsBeforeInvalidRitual, "PCM rejects unsupported ritual mode");
  await callCompanionTool(service, "pcm-episode-ritual-bad-motif", "For Gerda's first flight, greet me with a nod.", "set_episode_ritual", {
    id: "ep-gerda", mode: "active", motif: "wave", evidence: "greet me with a nod",
  });
  assert.equal(receivedActions.length, pcmActionsBeforeInvalidRitual, "PCM rejects unsupported ritual gesture");
  await callCompanionTool(service, "pcm-episode-ritual-no-quote", "Mute the ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "silent", evidence: "stop the ritual for Gerda's first flight",
  });
  assert.equal(receivedActions.length, pcmActionsBeforeInvalidRitual, "PCM rejects ritual evidence missing from this turn");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-episode-ritual-no-quote").item.output).status, "evidence-not-in-current-turn");
  await callCompanionTool(service, "pcm-episode-ritual-mute", "Mute the personal ritual for Gerda's first flight.", "set_episode_ritual", {
    id: "ep-gerda", mode: "silent", evidence: "Mute the personal ritual for Gerda's first flight",
  });
  assert.deepEqual(receivedActions.at(-1), { type: "set_episode_ritual", id: "ep-gerda", mode: "silent", evidence: "Mute the personal ritual for Gerda's first flight" }, "PCM forwards explicitly named ritual mute");

  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "pcm-activity-stale-response" } });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually, not now.", item_id: "pcm-activity-new-turn" });
  const actionsBeforeStalePcmActivity = receivedActions.length;
  await service.handleEvent({ type: "response.output_item.done", response_id: "pcm-activity-stale-response", item: { type: "function_call", call_id: "pcm-activity-stale", name: "manage_shared_activity", arguments: JSON.stringify({ operation: "begin", id: "ep-gerda", evidence: "begin the kite trial" }) } });
  await flush();
  assert.equal(receivedActions.length, actionsBeforeStalePcmActivity, "a stale PCM activity request cannot reach the local engine");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-activity-stale").item.output).status, "stale-turn");
  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "pcm-episode-ritual-stale-response" } });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually, leave it.", item_id: "pcm-episode-ritual-new-turn" });
  const actionsBeforeStalePcmRitual = receivedActions.length;
  await service.handleEvent({ type: "response.output_item.done", response_id: "pcm-episode-ritual-stale-response", item: { type: "function_call", call_id: "pcm-episode-ritual-stale", name: "set_episode_ritual", arguments: JSON.stringify({ id: "ep-gerda", mode: "silent", evidence: "mute it" }) } });
  await flush();
  assert.equal(receivedActions.length, actionsBeforeStalePcmRitual, "a stale PCM ritual choice cannot reach the local engine");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-episode-ritual-stale").item.output).status, "stale-turn");

  sent.length = 0;
  await service.handleEvent({ type: "response.created", response: { id: "pcm-response-2" } });
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Forget that story", item_id: "pcm-turn-3" });
  const actionCount = receivedActions.length;
  await service.handleEvent({
    type: "response.output_item.done", response_id: "pcm-response-2",
    item: { type: "function_call", call_id: "pcm-stale-call", name: "forget_shared_experience", arguments: '{"id":"ep_demo"}' },
  });
  await flush();
  assert.equal(receivedActions.length, actionCount, "a newer PCM user turn invalidates the older response");
  assert.equal(JSON.parse(sent.find((event) => event.item?.call_id === "pcm-stale-call").item.output).status, "stale-turn");
  assert.equal(sent.some((event) => event.type === "response.create"), false, "a stale PCM tool call cannot start a late answer");
  await assertSearchThroughTransport(service, sent, "pcm", sessionId);
  behaviorEvents.endBehaviorSession(sessionId);
  detach();
}

await exerciseWebRtcTransport();
actionResult = { ok: true, status: "proposed", instruction: "Ask once, then wait." };
await exercisePcmTransport();
behaviorEvents.endBehaviorSession("facade-session");
detachAdapter();
console.log("Realtime companion tools, session gates, and tool-response routing: PASS");
