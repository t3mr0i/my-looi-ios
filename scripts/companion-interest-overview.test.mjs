import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const load = createTypeScriptTreeLoader({ "./openai-api-key": { getOpenAiApiKey: async () => { throw new Error("No network"); } } });
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const { createBehaviorEngine } = load("src/behavior/behavior-engine.ts");
const { buildRealtimeSessionUpdate } = load("src/voice/realtime-config.ts");
const { generateBudgetReply, buildBudgetConversationTools } = load("src/openai/budget-conversation.ts");
const DAY = 86_400_000;
let clock = Date.now() - 30 * DAY;
const c = createBehaviorCompanion({ now: () => clock });
function addEpisode(title, encounters = 3) {
  const text = `We built ${title} together and it worked.`;
  c.userTurn(text);
  assert.equal(c.act({ type: "propose_experience", title, detail: "A shared activity.", outcome: "It worked.", motif: "hold", evidence: text }, { userText: text, sessionId: `create-${title}` }).status, "proposed");
  c.assistantEnd(`Should I remember ${title}?`);
  c.userTurn("Yes");
  for (let d = 0; d < encounters; d++) {
    clock += DAY;
    c.personalityTurn(`Mit dir hat ${title} Spaß gemacht.`, `${title}-day-${d}`, true);
  }
}
for (const title of ["Gerda", "Tea", "Chess", "Garden"]) addEpisode(title);
addEpisode("Budding", 2);
addEpisode("Muted");
c.personalityTurn("Sei nicht mehr so begeistert von Muted", "explicit-correction", true);
const mature = c.serialize();
const engine = createBehaviorEngine({ now: () => clock, wallNow: () => clock,
  decide: async () => { throw new Error("A character read cannot request a decision"); },
  executeCue: () => { throw new Error("A character read cannot execute a cue"); },
});
engine.restore(JSON.stringify({ version: 1, companion: mature }));
engine.setEnvironment({ robotName: "Pico" });
engine.dispatch({ type: "session-start", sessionId: "overview" });
const before = engine.serialize();
const overview = JSON.parse(engine.getPersonalityContext("Was magst du inzwischen?"));
assert.deepEqual(overview.interestOverview, { total: 4 }, "direct questions expose the real learned collection");
assert.equal(overview.familiarInterests.length, 3, "the summary stays bounded");
assert.ok(overview.familiarInterests.every((title) => ["Gerda", "Tea", "Chess", "Garden"].includes(title)));
assert.equal(engine.serialize(), before, "an overview cannot train, touch, or otherwise rewrite the profile");

for (const question of [
  "Was magst du inzwischen?", "Wofür begeisterst du dich?", "Welche eigenen Vorlieben hast du?",
  "Was magst du denn inzwischen?", "Was gefällt dir besonders?", "Was sind deine Vorlieben?",
  "Was machst du mit mir am liebsten?", "Pico, was magst du?", "LOOI, was magst du inzwischen?",
  "Sag mal, Pico, was magst du inzwischen?",
  "What do you enjoy?", "What have you grown to like?", "What are your own preferences?",
  "Что тебе теперь нравится?", "Какие у тебя есть предпочтения?",
  "Що тобі тепер подобається?", "Які в тебе є вподобання?",
]) assert.equal(JSON.parse(engine.getPersonalityContext(question)).interestOverview?.total, 4, question);

for (const question of [
  "Was mag ich inzwischen?", "Welche Vorlieben hat meine Tochter?", "Wie ist das Wetter?",
  'Er sagte: "Was magst du inzwischen?"', "Wenn ich frage, was magst du?",
  "Sag nicht, was magst du", "What do I enjoy?", "What do you like about Gerda?",
  "Что мне нравится?", "Що мені подобається?",
]) assert.equal(JSON.parse(engine.getPersonalityContext(question)).interestOverview, undefined, question);
assert.deepEqual(JSON.parse(engine.getPersonalityContext("Gerda")).familiarInterests, ["Gerda"], "named familiarity keeps its single-episode behavior");
assert.equal(c.familiarInterest("Was magst du inzwischen?"), null, "the overview cannot select an episode's gesture");

const preferences = { robotName: "Pico", language: "de", listeningLanguage: "de", speechGender: "masculine", robotAddressAliases: [], robotAddressRecognitionAliases: [] };
const saved = engine.serialize();
for (const mode of ["active", "shadow", "off"]) {
  engine.configure({ mode, dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: false });
  engine.dispatch({ type: "user-turn", sessionId: "overview", text: "Pico, was magst du?" });
  const context = engine.getConversationContext();
  assert.equal(JSON.parse(context).personality.interestOverview.total, 4, mode);
  const session = buildRealtimeSessionUpdate(preferences, undefined, undefined, context).session;
  assert.match(session.instructions, /directly asked about your own learned preferences/u);
  assert.ok(session.tools.some((tool) => tool.name === "list_companion_interests"));
  if (mode !== "active") assert.equal(JSON.parse(context).companion, undefined, "an interest overview does not expose adaptive episode state");
}
engine.restore(saved);
assert.deepEqual(JSON.parse(engine.getPersonalityContext("Pico, was magst du?")).familiarInterests, overview.familiarInterests, "the same bounded ordering survives restore");
engine.resetLearning();
for (const mode of ["active", "shadow", "off"]) {
  engine.configure({ mode, dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: false });
  engine.dispatch({ type: "user-turn", sessionId: "overview", text: "Was magst du?" });
  const context = engine.getConversationContext();
  assert.deepEqual(JSON.parse(context).personality.interestOverview, { total: 0 }, "empty/default profiles must survive the mode gate");
  assert.match(buildRealtimeSessionUpdate(preferences, undefined, undefined, context).session.instructions, /No learned interest is currently established/u);
}
engine.dispose();

// Both actual Realtime event handlers wait for a committed transcript even if
// the model's tool call arrives first. All native/model boundaries are replaced.
for (const transport of ["RealtimePcmConversationService", "RealtimeConversationService"]) {
  const r = createCompanionLiveRuntime({ robotName: "Pico" });
  const sessionId = `interests-${transport}`;
  const sent = [];
  r.behaviorEngine.restore(JSON.stringify({ version: 1, companion: mature }));
  r.events.beginBehaviorSession(sessionId, () => {});
  const service = new r[transport]();
  service.active = true;
  service.sessionId = sessionId;
  service.send = (message) => { sent.push(message); return true; };
  const output = (callId) => {
    const item = sent.find((message) => message.item?.call_id === callId)?.item;
    return item ? JSON.parse(item.output) : null;
  };
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  try {
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    await service.handleEvent({ type: "response.created", response: { id: "early-overview" } });
    await service.handleEvent({ type: "response.output_item.done", response_id: "early-overview", item: {
      type: "function_call", call_id: "own-preferences", name: "list_companion_interests", arguments: "{}",
    } });
    await flush();
    assert.equal(output("own-preferences"), null, "a tool cannot read from an unheard or old user turn");
    const learningBefore = JSON.stringify(r.behaviorEngine.getState().companion.episodes);
    await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "question", transcript: "Pico, was magst du inzwischen?" });
    await flush();
    assert.equal(output("own-preferences")?.ok, true, `${transport} returns an authoritative overview`);
    assert.equal(output("own-preferences").total, 4);
    assert.equal(output("own-preferences").interests.length, 3);
    assert.equal(output("own-preferences").hasMore, true);
    assert.equal(JSON.stringify(r.behaviorEngine.getState().companion.episodes), learningBefore, "reading cannot create learning evidence or ritual leases");
    assert.deepEqual(r.behaviorHeadCalls, []);
    assert.deepEqual(r.externalBridgeCalls, []);
    assert.equal(output("own-preferences").episodes, undefined, "historical episode facts are not returned");
    await service.executeToolCall({ call_id: "invalid-arguments", name: "list_companion_interests", arguments: '{"title":"Gerda"}' }, service.currentCompanionUserTurn);
    assert.equal(output("invalid-arguments").status, "invalid_action", "the read-only overview accepts no model-supplied selection or mutation arguments");

    const oldTurn = service.currentCompanionUserTurn;
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    await service.executeToolCall({ call_id: "stale-overview", name: "list_companion_interests", arguments: "{}" }, oldTurn);
    assert.equal(output("stale-overview").status, "stale-turn");
    assert.equal(output("stale-overview").interests, undefined);

    await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "human-preferences", transcript: "Was mag ich inzwischen?" });
    await service.executeToolCall({ call_id: "wrong-person", name: "list_companion_interests", arguments: "{}" }, service.currentCompanionUserTurn);
    assert.equal(output("wrong-person").status, "interest-question-required");
  } finally {
    service.active = false;
    r.events.endBehaviorSession(sessionId);
    r.uninstallRuntime();
    r.behaviorEngine.dispose();
  }
}

// The real Budget client advertises and executes the same read-only tool round.
const r = createCompanionLiveRuntime({ robotName: "Pico" });
try {
  r.behaviorEngine.restore(JSON.stringify({ version: 1, companion: mature }));
  // Refresh the real adapter's configured identity without starting a voice session.
  r.events.acceptCompanionPersonalityTurn("Hallo", "budget-overview");
  const requestBodies = [];
  const question = "Pico, was magst du inzwischen?";
  const readsBefore = JSON.stringify(r.behaviorEngine.getState().companion.episodes);
  await generateBudgetReply({ robotName: "Pico", language: "de", history: [{ role: "user", content: question }],
    personalityContext: r.events.getCompanionPersonalityContext(question),
    runTool: async (name, args) => { assert.equal(name, "list_companion_interests"); assert.deepEqual(args, {}); return r.events.readCompanionInterests(question); },
    dependencies: { getApiKey: async () => "offline", fetcher: async (_url, request) => {
      requestBodies.push(JSON.parse(request.body));
      return new Response(JSON.stringify({ status: "completed", output: requestBodies.length === 1
        ? [{ type: "function_call", call_id: "budget-interests", name: "list_companion_interests", arguments: "{}" }]
        : [{ type: "message", content: [{ type: "output_text", text: "Gerda gehört inzwischen dazu." }] }] }), { headers: { "content-type": "application/json" } });
    } },
  });
  assert.ok(buildBudgetConversationTools().some((tool) => tool.name === "list_companion_interests" && tool.strict));
  const result = JSON.parse(requestBodies[1].input.find((item) => item.type === "function_call_output").output);
  assert.equal(result.total, 4);
  assert.equal(result.hasMore, true);
  assert.equal(JSON.stringify(r.behaviorEngine.getState().companion.episodes), readsBefore);
  r.behaviorEngine.resetLearning();
  assert.equal(r.events.readCompanionInterests(question).total, 0, "empty means no established preference, not an unavailable reader");
  assert.equal(r.events.readCompanionInterests("Was mag ich?").status, "interest-question-required");
  let invalidReads = 0;
  await assert.rejects(generateBudgetReply({ robotName: "Pico", language: "de", history: [{ role: "user", content: question }],
    runTool: async () => { invalidReads++; return {}; },
    dependencies: { getApiKey: async () => "offline", fetcher: async () => new Response(JSON.stringify({ status: "completed", output: [
      { type: "function_call", call_id: "invalid-budget", name: "list_companion_interests", arguments: '{"title":"Gerda"}' },
    ] }), { headers: { "content-type": "application/json" } }) },
  }), (error) => error.code === "response");
  assert.equal(invalidReads, 0, "Budget validates the empty argument contract before dispatch");
} finally { r.uninstallRuntime(); r.behaviorEngine.dispose(); }
assert.equal(r.events.readCompanionInterests("Was magst du?").status, "character-unavailable", "an unavailable reader is not an empty personality");

console.log("Companion interest overview: own/human distinction, empty and bounded mature profiles, modes, identity, persistence, and actual PCM/WebRTC/Budget tool paths PASS (offline)");
