import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader({ "./openai-api-key": { getOpenAiApiKey: async () => { throw new Error("No network in character tests"); } } });
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const { createBehaviorEngine } = load("src/behavior/behavior-engine.ts");
const { buildRealtimeInstructions } = load("src/voice/realtime-config.ts");
const { buildBudgetConversationInstructions, generateBudgetReply } = load("src/openai/budget-conversation.ts");
const events = load("src/behavior/behavior-events.ts");
const { HABIT_ENCOUNTER_INTERVAL_MS: DAY, COMPANION_CHARACTER_INSTRUCTIONS } = load("src/character/companion-personality.ts");
const prefs = { language: "de", listeningLanguage: "de", robotName: "LOOI", robotAddressAliases: [], robotAddressRecognitionAliases: [], speechGender: "masculine", ttsStyleId: "playful-robot" };
let now = Date.UTC(2026, 9, 28, 12);
let sessionSerial = 0;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function savedEpisode(title = "Gerda") {
  const companion = createBehaviorCompanion({ now: () => now });
  const text = `We repaired ${title} together and it finally flew.`;
  companion.userTurn(text);
  const proposal = companion.act({ type: "propose_experience", title, detail: "We repaired a paper rocket together.", outcome: "The rocket flew.", motif: "happy_bob", evidence: text }, { userText: text, sessionId: "initial" });
  assert.equal(proposal.status, "proposed");
  companion.assistantEnd(`Should I remember ${title}?`);
  companion.userTurn("Yes");
  return companion.serialize();
}

const episodeSeed = savedEpisode();
function make({ saved, mode = "active", cue = "nod" } = {}) {
  const effects = [];
  const requests = [];
  const engine = createBehaviorEngine({ now: () => now, wallNow: () => now,
    decide: async (input) => { requests.push(input); return { answers: [{ name: "cue", type: "choice", choice: cue, confidence: 1 }], usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline" }; },
    executeCue: (effect) => effects.push(effect),
  });
  engine.configure({ mode, dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
  engine.setEnvironment({ foreground: true, focused: true, connected: true, ambientEnabled: true, responseLanguage: "de" });
  engine.dispatch({ type: "session-start", sessionId: `s-${++sessionSerial}-${now}` });
  const state = saved ?? JSON.stringify({ version: 1, companion: episodeSeed });
  engine.restore(state);
  const turn = (text) => engine.dispatch({ type: "user-turn", sessionId: engine.getState().sessionId, text });
  return { engine, turn, effects, requests };
}

let h = make();
assert.equal(h.engine.getState().companion.episodes[0].learnedInterest, undefined, "old confirmed episodes do not acquire invented history");
const positive = "Mit dir hat Gerda heute wieder Spaß gemacht.";
h.turn(positive);
await flush();
assert.equal(h.engine.getState().companion.episodes[0].learnedInterest.encounters.length, 1);
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda" )).familiarInterests, [], "one positive moment cannot establish a trait");
h.turn(positive);
await flush();
assert.equal(h.engine.getState().companion.episodes[0].learnedInterest.encounters.length, 1, "repetition cannot accelerate growth");
const early = make({ saved: h.engine.serialize() });
now += DAY - 1;
early.turn(positive);
await flush();
assert.equal(early.engine.getState().companion.episodes[0].learnedInterest.encounters.length, 1, "a new session before 24 hours cannot accelerate growth");
now -= DAY - 1;
early.engine.dispose();
let stored = h.engine.serialize();
h.engine.dispose();
for (let day = 1; day <= 2; day++) {
  now += DAY;
  h = make({ saved: stored });
  h.turn(positive);
  await flush();
  const interest = h.engine.getState().companion.episodes[0].learnedInterest;
  assert.equal(interest.encounters.length, day + 1);
  assert.equal(interest.encounters.at(-1).evidence, positive);
  assert.equal(interest.encounters.at(-1).sessionId, h.engine.getState().sessionId);
  stored = h.engine.serialize();
  h.engine.dispose();
}

h = make({ saved: stored });
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Was machen wir mit Gerda?" )).familiarInterests, ["Gerda"], "learned familiarity survives a restart");
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Wie ist das Wetter?" )).familiarInterests, [], "unrelated turns do not invite a learned topic");
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda ist kaputt, ich bin traurig." )).familiarInterests, [], "a serious current turn suppresses the playful interest");
const learnedCopy = structuredClone(h.engine.getState().companion.episodes[0].learnedInterest);
h.engine.dispatch({ type: "assistant-end", text: positive, sessionId: h.engine.getState().sessionId });
await flush();
assert.deepEqual(h.engine.getState().companion.episodes[0].learnedInterest, learnedCopy, "assistant speech cannot train its own personality");
const accentsBefore = h.effects.filter((effect) => !effect.presentationOnly && effect.gesture !== "hold").length;
const futureSaved = h.engine.serialize();
now -= DAY * 5;
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda")).familiarInterests, [], "a backwards clock cannot activate future evidence");
now += DAY * 5;
h.turn("Sei ruhiger");
await flush();
now += 2_000;
h.turn("Was machen wir mit Gerda?");
await flush();
now += 2_000;
h.engine.dispatch({ type: "assistant-end", text: "Wir können uns Gerda zusammen anschauen.", sessionId: h.engine.getState().sessionId });
await flush();
assert.equal(h.effects.at(-1).gesture, "curious", "a learned interest changes an allowed nod to a curious accent");
assert.equal(h.effects.filter((effect) => !effect.presentationOnly && effect.gesture !== "hold").length - accentsBefore, 1, "the current heard turn retains at most one physical accent");

for (const mode of ["active", "shadow", "off"]) {
  h.engine.configure({ mode, dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
  const character = h.engine.getPersonalityContext("Gerda");
  const rt = buildRealtimeInstructions(prefs, undefined, undefined, h.engine.getConversationContext());
  const budget = buildBudgetConversationInstructions("LOOI", "de", undefined, true, character);
  assert.ok(rt.includes(COMPANION_CHARACTER_INSTRUCTIONS));
  assert.ok(budget.includes(COMPANION_CHARACTER_INSTRUCTIONS));
  assert.match(rt, /explicitly prefers a calmer manner/u);
  assert.match(rt, /gradually learned fondness/u);
  assert.match(budget, /explicitly prefers a calmer manner/u);
  assert.match(budget, /gradually learned fondness/u);
  assert.match(budget, /Shared episodes, shared rituals, and photo inspection are unavailable/u, "character continuity grants no extra capabilities");
  if (mode !== "active") {
    assert.equal(JSON.parse(h.engine.getConversationContext()).pendingTask, undefined);
    assert.equal(JSON.parse(h.engine.getConversationContext()).companion, undefined);
  }
}
const persistedTone = h.engine.getState().style.conversationTone;
h.turn("Sei heute lebendiger");
assert.equal(h.engine.getState().style.conversationTone, persistedTone);
h.turn("Sei nicht mehr so begeistert von Gerda");
assert.ok(h.engine.getState().companion.episodes[0].learnedInterest.blocked, "an explicit correction works even with adaptive behavior off");
const blockedState = h.engine.serialize();
h.engine.dispose();

const held = make({ saved: futureSaved, cue: "hold" });
held.turn("Gerda");
await flush();
now += 2_000;
held.engine.dispatch({ type: "assistant-end", text: "Gerda.", sessionId: held.engine.getState().sessionId });
await flush();
assert.equal(held.effects.at(-1).gesture, "hold", "a learned habit cannot override a hold decision");
held.engine.forgetExperience(held.engine.getState().companion.episodes[0].id);
assert.deepEqual(JSON.parse(held.engine.getPersonalityContext("Gerda")).familiarInterests, [], "forgetting an episode also forgets its learned habit");
held.engine.dispose();

const greeting = make({ saved: futureSaved });
greeting.turn("Begrüß mich mit einem Nicken");
await flush();
greeting.engine.setEnvironment({ foreground: false });
greeting.turn("Hallo Gerda");
now += 2_000;
greeting.engine.setEnvironment({ foreground: true });
greeting.engine.dispatch({ type: "assistant-end", text: "Hallo!", sessionId: greeting.engine.getState().sessionId });
await flush();
assert.equal(greeting.effects.at(-1).gesture, "nod", "learned familiarity cannot replace an explicitly chosen greeting");
greeting.engine.dispose();
h = make({ saved: blockedState });
now += DAY;
h.turn(positive);
await flush();
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda")).familiarInterests, [], "a later positive report cannot silently undo a correction");
assert.equal(h.engine.getState().companion.episodes[0].title, "Gerda", "correcting a habit keeps the episode");
h.turn("Du darfst dich wieder für Gerda begeistern");
await flush();
assert.equal(h.engine.getState().companion.episodes[0].learnedInterest.blocked, null);
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda")).familiarInterests, [], "resuming learning does not instantly recreate the habit");
h.engine.resetLearning();
assert.deepEqual(JSON.parse(h.engine.getPersonalityContext("Gerda")), { tone: "default", familiarInterests: [], life: {
  core: "gentle-curious", familiarity: "new", disposition: "tentative", energy: "rested", mood: "curious", playfulness: "gentle",
} });
h.engine.dispose();

// Each rejected input is tested on an independent, otherwise eligible confirmed episode.
for (const text of [
  'Er sagte: "Mit dir hat Gerda Spaß gemacht."', "'Mit dir hat Gerda Spaß gemacht.'",
  "Wenn Gerda mit dir Spaß gemacht hätte.", "Mit dir hat Gerda keinen Spaß gemacht.",
  "Hat Gerda mit dir Spaß gemacht?", "Gerda ist eine Rakete.", "Mit dir hat die Rakete Spaß gemacht.",
  "Mit dir hat Gerda Spaß gemacht, war nur Spaß.",
  'Er sagte: "Sei nicht mehr so begeistert von Gerda"', "Sei nicht mehr so begeistert von Gerda?",
]) {
  const companion = createBehaviorCompanion({ now: () => now });
  companion.restore(episodeSeed);
  companion.personalityTurn(text, "negative-cases", true);
  assert.equal(companion.snapshot().episodes[0].learnedInterest, undefined, `${text} cannot train or correct a habit`);
}
for (const text of ["Mit dir hat Gerda Spaß gemacht.", "Gerda was fun together.", "С тобой Gerda было весело.", "З тобою Gerda було весело."]) {
  const companion = createBehaviorCompanion({ now: () => now });
  companion.restore(episodeSeed);
  companion.personalityTurn(text, "multilingual", true);
  assert.equal(companion.snapshot().episodes[0].learnedInterest.encounters.length, 1, `explicit shared enjoyment is recognized: ${text}`);
}
const sameSession = createBehaviorCompanion({ now: () => now });
sameSession.restore(episodeSeed);
sameSession.personalityTurn(positive, "one-long-session", true);
now += DAY;
sameSession.personalityTurn(positive, "one-long-session", true);
assert.equal(sameSession.snapshot().episodes[0].learnedInterest.encounters.length, 1, "even a long session contributes only one encounter");
const malformed = structuredClone(episodeSeed);
malformed.episodes[0].learnedInterest = { version: 1, encounters: [1, 2, 3].map((at) => ({ at, sessionId: "fake", evidence: positive })), blocked: null };
const safe = createBehaviorCompanion({ now: () => now });
safe.restore(malformed);
assert.equal(safe.snapshot().episodes.length, 1);
assert.equal(safe.snapshot().episodes[0].learnedInterest, undefined, "invalid sources cannot fabricate maturity during restore");

// Episode labels cannot supply sentiment or change the meaning of user feedback.
for (const [title, text, expected] of [
  ["Spaß", "Zusammen haben wir Spaß repariert.", false],
  ["Together", "I enjoyed Together.", false],
  ["Never", "With you Never was fun.", true],
]) {
  const companion = createBehaviorCompanion({ now: () => now });
  companion.restore(savedEpisode(title));
  companion.personalityTurn(text, "title-semantics", true);
  assert.equal(!!companion.snapshot().episodes[0].learnedInterest, expected, `title words are data: ${title}`);
}

// Exercise the public character-only bridge and the actual outgoing Budget request.
const bridged = make({ saved: stored, mode: "off" });
const detach = events.registerBehaviorAdapter({
  dispatch: (event) => bridged.engine.dispatch(event),
  getContext: () => bridged.engine.getConversationContext(),
  getPersonalityContext: (text) => bridged.engine.getPersonalityContext(text),
  acceptPersonalityTurn: (text, sessionId) => bridged.engine.acceptPersonalityTurn(text, sessionId),
  inspectVisual: async () => { throw new Error("No image grant"); },
});
events.acceptCompanionPersonalityTurn("Sei ruhiger", "budget-live");
let outgoing;
await generateBudgetReply({ history: [{ role: "user", content: "Gerda" }], language: "de", robotName: "LOOI",
  personalityContext: events.getCompanionPersonalityContext("Gerda"),
  dependencies: { getApiKey: async () => "offline-test", fetcher: async (_url, request) => {
    outgoing = JSON.parse(request.body);
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Gerda klingt nach einer schönen Idee." }] }] }), { headers: { "content-type": "application/json" } });
  } },
});
assert.match(outgoing.instructions, /explicitly prefers a calmer manner/u);
assert.match(outgoing.instructions, /gradually learned fondness/u);
assert.match(outgoing.instructions, /stable temperament is gentle curiosity/u, "the actual Budget payload carries the same stable core");
assert.deepEqual(bridged.effects, [], "Budget character access cannot execute a cue or activate a game");
assert.equal(bridged.engine.getState().game, null);
events.beginBehaviorSession("replacement-realtime", () => {});
events.acceptCompanionPersonalityTurn("Sei lebendiger", "stale-budget");
assert.equal(bridged.engine.getState().style.conversationTone, "calm", "an old Budget session cannot overwrite the replacement conversation's character");
events.endBehaviorSession("replacement-realtime");
detach();
bridged.engine.dispose();
console.log("Companion personality: gradual source-backed learning, restart, mode continuity, corrections, expression, and actual Budget request PASS (offline, no hardware)");
