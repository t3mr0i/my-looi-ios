import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader({ "./openai-api-key": { getOpenAiApiKey: async () => { throw new Error("No network in life tests"); } } });
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const { createBehaviorEngine } = load("src/behavior/behavior-engine.ts");
const { buildRealtimeInstructions } = load("src/voice/realtime-config.ts");
const { buildBudgetConversationInstructions } = load("src/openai/budget-conversation.ts");
const { buildCompanionDeliveryInstructions, createCompanionLife, updateCompanionLife, readCompanionLife, companionLifeContext, COMPANION_DAY_MS: DAY } = load("src/character/companion-personality.ts");
let now = Date.UTC(2026, 9, 28, 12);
const start = now;
const companion = () => createBehaviorCompanion({ now: () => now });
const seedEpisode = (c) => {
  const text = "We built Gerda together and it worked.";
  c.userTurn(text);
  assert.equal(c.act({ type: "propose_experience", title: "Gerda", detail: "A shared paper rocket.", outcome: "It worked.", motif: "hold", evidence: text }, { userText: text, sessionId: "creation" }).status, "proposed");
  c.assistantEnd("Should I remember Gerda?"); c.userTurn("Yes");
};

// An accelerated timeline checks production persistence, not actual weeks of use.
let c = companion(); seedEpisode(c);
const rawSeed = c.serialize();
let saved;
for (let day = 0; day < 35; day++) {
  now = start + day * DAY;
  c = companion(); c.restore(day ? saved : rawSeed);
  c.noteFriendlyStroke();
  c.personalityTurn("Mit dir hat Gerda heute wieder Spaß gemacht.", `day-${day}`, true);
  for (let repeat = 0; repeat < 50; repeat++) c.noteFriendlyStroke();
  assert.equal(c.lifeContext().core, "gentle-curious", "every day retains the same core");
  assert.equal(c.serialize().life.days.length, Math.min(day + 1, 32), "one relationship day despite repeated affection and two sources");
  if (day === 0) assert.equal(c.lifeContext().familiarity, "new");
  if (day === 2) assert.equal(c.lifeContext().familiarity, "recognizing");
  if (day === 6) assert.equal(c.lifeContext().familiarity, "familiar");
  if (day === 20) assert.equal(c.lifeContext().familiarity, "at_ease");
  saved = JSON.parse(JSON.stringify(c.serialize()));
}
assert.equal(c.lifeContext().disposition, "confident");
assert.equal(c.interestOverview("Was magst du?").total, 1);
assert.equal(c.serialize().life.days.length, 32);
assert.ok(c.serialize().life.days.every((day) => day.petted && day.sharedEpisodeIds.length === 1));
const developed = c.serialize();
const originalLife = JSON.stringify(developed.life);
developed.life.days[0].sharedEpisodeIds.push("mutation");
assert.notEqual(JSON.stringify(c.serialize().life), JSON.stringify(developed.life), "serialization returns a deep copy");
now += 180 * DAY;
c = companion(); c.restore(saved);
assert.equal(c.lifeContext().familiarity, "at_ease", "six months away does not punish the relationship");
assert.equal(c.lifeContext().mood, "curious", "short-lived contentment does not survive as a permanent mood");
assert.equal(JSON.stringify(c.serialize().life), originalLife, "time and reads cannot rewrite history");
assert.equal(c.lifeContext(true).energy, "quiet", "sleep is reflected without overwriting temperament");

// Shared activities alone build continuity; forgetting removes their contribution.
now = start; c = companion(); seedEpisode(c);
for (let day = 0; day < 8; day++) {
  now = start + day * DAY;
  c.personalityTurn("Mit dir hat Gerda heute Spaß gemacht.", `experience-${day}`, true);
}
assert.equal(c.lifeContext().familiarity, "familiar", "relationship can develop after interest evidence has reached its cap");
const id = c.snapshot().episodes[0].id;
c.forget(id);
assert.equal(c.lifeContext().familiarity, "new");
assert.equal(c.serialize().life.days.length, 0);
// The confirmed conversational forget path uses the same cleanup.
now = start + 40 * DAY; c = companion(); c.restore(saved);
const forgetText = "Forget Gerda"; c.userTurn(forgetText);
assert.equal(c.act({ type: "forget_experience", id: c.snapshot().episodes[0].id }, { userText: forgetText, sessionId: "forget" }).status, "forget_pending");
c.assistantEnd("Should I forget Gerda?"); c.userTurn("Yes");
assert.ok(c.serialize().life.days.every((day) => day.sharedEpisodeIds.length === 0));
assert.equal(c.lifeContext().familiarity, "at_ease", "genuine petting history remains independently");

// Conversation volume, quotations, assistant replies and disabled learning cannot create affection.
now = start; c = companion(); seedEpisode(c);
for (let day = 0; day < 30; day++) {
  now = start + day * DAY;
  c.personalityTurn('Er sagte: "Mit dir hat Gerda Spaß gemacht."', `quote-${day}`, true);
  c.personalityTurn("Mit dir hat Gerda Spaß gemacht.", `off-${day}`, false);
  c.notePersonalitySpeech("Mit dir hat Gerda Spaß gemacht.", `quote-${day}`);
}
assert.equal(c.lifeContext().familiarity, "new");
assert.equal(c.serialize().life.days.length, 0);

// Symbolic energy reflects sustained activity, survives restart, recovers with rest.
now = start; c = companion();
for (let turn = 0; turn < 200; turn++) {
  now = start + turn * 30_000;
  c.personalityTurn("Erzähl mir etwas.", "long-conversation", true);
}
assert.equal(c.lifeContext().energy, "quiet");
assert.equal(c.lifeContext().playfulness, "gentle");
const tired = c.serialize(); c = companion(); c.restore(tired);
assert.equal(c.lifeContext().energy, "quiet", "restart is not an instant recharge");
now += 60 * 60_000;
assert.equal(c.lifeContext().energy, "rested");
assert.equal(c.lifeContext().core, "gentle-curious");
assert.equal(c.lifeContext().familiarity, "new", "chat volume is not a relationship shortcut");

// Validation, rolling intervals, clock rollback and reset.
let life = createCompanionLife(now);
life = updateCompanionLife(life, "petting", now);
assert.strictEqual(updateCompanionLife(life, "petting", now + 5), life);
assert.strictEqual(updateCompanionLife(life, "petting", now - 1), life);
life = updateCompanionLife(life, "petting", now + DAY - 1);
assert.equal(life.days.length, 1, "midnight and rapid strokes do not create additional credited days");
life = updateCompanionLife(life, "petting", now + DAY + 60_000);
assert.equal(life.days.length, 2);
assert.equal(companionLifeContext(life, now + 2 * DAY).familiarity, "new");
for (const invalid of [null, { ...life, core: "aggressive" }, { ...life, days: Array(33).fill(life.days[0]) }, { ...life, days: [{ ...life.days[0], at: now + 100 * DAY }] }]) {
  assert.deepEqual(readCompanionLife(invalid, now + 2 * DAY, new Set()), createCompanionLife(now + 2 * DAY));
}
assert.equal(readCompanionLife({ ...life, vitality: { ...life.vitality, energy: NaN } }, now + 2 * DAY, new Set()).days.length, 2, "bad short-term energy cannot erase valid relationship history");
c.reset(); assert.equal(c.lifeContext().familiarity, "new"); assert.equal(c.serialize().life.days.length, 0);

// Real engine seam, all voice modes, user preference priority and input ownership.
now = start + 40 * DAY;
const effects = [];
const engine = createBehaviorEngine({ now: () => now, wallNow: () => now, decide: async () => { throw new Error("No network"); }, executeCue: (cue) => effects.push(cue) });
engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
engine.setEnvironment({ foreground: true, focused: true, connected: false });
engine.restore(JSON.stringify({ version: 1, companion: saved }));
assert.deepEqual(engine.noteFriendlyStroke(), { durationMs: 1450 });
assert.equal(effects.length, 0, "affection never grants motor authority");
engine.acceptPersonalityTurn("Sei ruhiger", "budget");
assert.deepEqual(engine.noteFriendlyStroke(), { durationMs: 900 });
for (const blocked of [{ foreground: false }, { focused: false }, { sleeping: true }, { motionActive: true }, { userSpeaking: true }, { assistantSpeaking: true }]) {
  engine.setEnvironment({ foreground: true, focused: true, sleeping: false, motionActive: false, userSpeaking: false, assistantSpeaking: false, ...blocked });
  const before = engine.serialize(); assert.equal(engine.noteFriendlyStroke(), null); assert.equal(engine.serialize(), before);
}
engine.setEnvironment({ foreground: true, focused: true, sleeping: false, motionActive: false, userSpeaking: false, assistantSpeaking: false });
const prefs = { language: "de", listeningLanguage: "de", robotName: "LOOI", robotAddressAliases: [], robotAddressRecognitionAliases: [], speechGender: "masculine", ttsStyleId: "playful-robot" };
for (const mode of ["active", "shadow", "off"]) {
  engine.configure({ mode, dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
  engine.dispatch({ type: "session-start", sessionId: `mode-${mode}` });
  const character = engine.getPersonalityContext("Hallo");
  assert.equal(JSON.parse(character).life.familiarity, "at_ease");
  assert.equal(JSON.parse(engine.getConversationContext()).personality.life.core, "gentle-curious");
  for (const prompt of [buildRealtimeInstructions(prefs, undefined, undefined, engine.getConversationContext()), buildBudgetConversationInstructions("LOOI", "de", undefined, true, character)]) {
    assert.match(prompt, /stable temperament is gentle curiosity/u);
    assert.match(prompt, /more relaxed, quietly familiar/u);
    assert.match(prompt, /explicitly prefers a calmer manner/u);
    assert.match(prompt, /Absence creates no loneliness/u);
    assert.match(prompt, /not recognition or identification/u);
  }
  assert.match(buildCompanionDeliveryInstructions(character), /calmer manner/u);
  if (mode !== "active") assert.equal(engine.noteFriendlyStroke(), null);
}
engine.resetLearning();
assert.equal(JSON.parse(engine.getPersonalityContext()).life.familiarity, "new");

// A full bounded archive must not silently lose its personality on restart.
// This synthetic density fixture uses the actual readers' accepted field limits.
const pad = (text, length) => text + "x".repeat(length - text.length);
const denseEpisodes = Array.from({ length: 8 }, (_, index) => {
  const base = structuredClone(rawSeed.episodes[0]);
  const title = `Gerda${index}`;
  const source = { evidence: pad(`We built ${title} together. `, 240), sessionId: "s".repeat(96), at: start };
  return { ...base, id: `ep_${String(index).padStart(48, "0")}`, title, detail: "d".repeat(220), outcome: "o".repeat(180), source,
    visualMemory: { description: "v".repeat(240), confirmedAt: start, source: { ...source, visualTask: "t".repeat(200) } },
    ritualPreference: { mode: "active", motif: "nod", phrase: "p".repeat(80), confirmedAt: start, source: { ...source, origin: "voice" }, lastOfferedAt: null },
    learnedInterest: { version: 1, blocked: null, encounters: [1, 2, 3].map((day) => {
      const at = start + day * DAY;
      const sessionId = pad(`session-${day}`, 96);
      return { at, sessionId, evidence: pad(`Mit dir hat ${title} Spaß gemacht. `, 240),
        reference: { at: at - 1, sessionId, evidence: pad(`Unser Thema ist ${title}. `, 240), origin: "heard_assistant" } };
    }) },
  };
});
const denseLife = createCompanionLife(now);
denseLife.days = Array.from({ length: 32 }, (_, day) => ({ at: start + day * DAY, petted: true, sharedEpisodeIds: denseEpisodes.map((episode) => episode.id) }));
engine.restore(JSON.stringify({ version: 1, companion: { version: 1, episodes: denseEpisodes, life: denseLife } }));
assert.equal(engine.getState().companion.episodes.length, 8);
assert.ok(engine.getState().companion.episodes.every((episode) => episode.learnedInterest?.encounters.length === 3 && episode.ritualPreference && episode.visualMemory));
const denseArchive = engine.serialize();
assert.ok(denseArchive.length > 48_000 && denseArchive.length < 80_000, "bounded relationship metadata exceeds the previous read ceiling");
engine.resetLearning(); engine.restore(denseArchive);
assert.equal(engine.getState().companion.episodes.length, 8);
assert.equal(JSON.parse(engine.getPersonalityContext()).life.familiarity, "at_ease");
assert.equal(JSON.parse(engine.serialize()).companion.life.days.length, 32);
engine.dispose();
console.log(`Companion life: 35-day simulation, stable core, relationship, actual stroke seam, energy/recovery, persistence (${denseArchive.length} characters density fixture), privacy and both voice modes PASS`);
