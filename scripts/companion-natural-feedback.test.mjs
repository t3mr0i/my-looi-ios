import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const { createBehaviorEngine } = load("src/behavior/behavior-engine.ts");
const { buildCompanionCharacterInstructions, PERSONALITY_REFERENCE_TTL_MS: TTL, HABIT_ENCOUNTER_INTERVAL_MS: DAY } = load("src/character/companion-personality.ts");
let now = Date.UTC(2026, 9, 28, 12);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const make = () => createBehaviorCompanion({ now: () => now });
function save(c, title = "Gerda") {
  const text = `We built ${title} together and it worked.`;
  c.userTurn(text);
  assert.equal(c.act({ type: "propose_experience", title, detail: "A shared paper rocket.", outcome: "It worked.", motif: "hold", evidence: text }, { userText: text, sessionId: `creation-${title}` }).status, "proposed");
  c.assistantEnd(`Should I remember ${title}?`);
  c.userTurn("Yes");
}
const base = make(); save(base);
const seed = base.serialize();
const fresh = () => { const c = make(); c.restore(seed); return c; };
const count = (c) => c.snapshot().episodes.find((item) => item.title === "Gerda").learnedInterest?.encounters.length ?? 0;

// Normal short feedback can use the immediately preceding, actually heard title.
let c = fresh();
c.notePersonalitySpeech("Wir können Gerda noch einmal ausprobieren.", "s1");
c.personalityTurn("Das hat wieder Spaß gemacht.", "s1", true);
assert.equal(count(c), 1);
let evidence = c.snapshot().episodes[0].learnedInterest.encounters[0];
assert.equal(evidence.evidence, "Das hat wieder Spaß gemacht.", "never manufacture the episode name inside a user quote");
assert.deepEqual(evidence.reference, { evidence: "Wir können Gerda noch einmal ausprobieren.", origin: "heard_assistant", sessionId: "s1", at: now });
assert.equal(c.personalitySituation("Das hat wieder Spaß gemacht.").developingInterest.encounters, 1);
assert.equal(c.personalitySituation("Das hat wieder Spaß gemacht.").conversationMoment.valence, "positive");
assert.equal(c.interestOverview("Was magst du?").total, 0, "a first spark of curiosity is not an established favorite");
let saved = c.serialize();
for (let day = 2; day <= 3; day++) {
  now += DAY;
  c = make(); c.restore(saved);
  assert.deepEqual(c.personalitySituation("Das hat wieder Spaß gemacht."), {}, "conversation moments do not survive restart");
  c.notePersonalitySpeech("Gerda ist unser Thema.", `s${day}`);
  c.personalityTurn("Das hat wieder Spaß gemacht.", `s${day}`, true);
  assert.equal(count(c), day);
  if (day === 2) {
    assert.equal(c.personalitySituation("Gerda").developingInterest.encounters, 2);
    assert.equal(c.interestOverview("Was magst du?").total, 0);
  }
  saved = c.serialize();
}
assert.equal(c.familiarInterest("Gerda"), "Gerda");
assert.equal(c.personalitySituation("Gerda").developingInterest, undefined);

// A disappointing attempt affects the moment, not the durable preference.
c.notePersonalitySpeech("Gerda ist unser Thema.", "s3");
c.personalityTurn("Das war heute nichts.", "s3", true);
assert.equal(c.personalitySituation("Das war heute nichts.").conversationMoment.valence, "negative");
assert.equal(count(c), 3);
assert.equal(c.interestOverview("Was magst du?").total, 1);
assert.equal(c.familiarInterest("Wie geht es mit Gerda weiter?"), null, "familiarity does not keep pushing enthusiasm after a setback");
const negativePrompt = buildCompanionCharacterInstructions(JSON.stringify({ tone: "calm", familiarInterests: [], ...c.personalitySituation("Das war heute nichts.") }));
assert.match(negativePrompt, /Respond gently and helpfully/u);
assert.match(negativePrompt, /do not.*changed permanent preference/iu);
now += TTL + 1;
assert.equal(c.personalitySituation("Gerda").conversationMoment, undefined, "a temporary setback fades without rewriting the stable interest");
assert.equal(c.familiarInterest("Gerda"), "Gerda");
c.personalityTurn("Wie ist das Wetter?", "s3", true);
assert.deepEqual(c.personalitySituation("Gerda"), {}, "a topic change ends the short-lived mood");
assert.equal(c.familiarInterest("Gerda"), "Gerda");

// Explicit user context is sufficient even when the heard reply uses a pronoun.
c = fresh();
c.personalityTurn("Was machen wir mit Gerda?", "user-anchor", true);
c.notePersonalitySpeech("Wir können es zusammen noch einmal versuchen.", "user-anchor");
c.personalityTurn("Das war richtig schön.", "user-anchor", true);
assert.equal(count(c), 1);
assert.equal(c.snapshot().episodes[0].learnedInterest.encounters[0].reference.origin, "user");
assert.equal(c.snapshot().episodes[0].learnedInterest.encounters[0].reference.evidence, "Was machen wir mit Gerda?");

for (const [name, setup, text = "Das hat wieder Spaß gemacht.", sessionId = "test"] of [
  ["no current anchor", () => {}],
  ["different session", (c) => c.notePersonalitySpeech("Gerda", "old-session")],
  ["expired anchor", (c) => { c.notePersonalitySpeech("Gerda", "test"); now += TTL + 1; }],
  ["topic change", (c) => { c.notePersonalitySpeech("Gerda", "test"); c.personalityTurn("Wie ist das Wetter?", "test", true); }],
  ["interruption", (c) => { c.notePersonalitySpeech("Gerda", "test"); c.notePersonalitySpeech(null, "test"); }],
  ["cancel", (c) => { c.notePersonalitySpeech("Gerda", "test"); c.cancel(); }],
  ["hypothetical anchor", (c) => c.notePersonalitySpeech("Wenn Gerda fliegen würde, wäre es toll.", "test")],
  ["reported user anchor", (c) => c.personalityTurn("Er sagte, Gerda würde fliegen.", "test", true)],
  ["two candidate episodes", (c) => { save(c, "Fritz"); c.notePersonalitySpeech("Gerda und Fritz sind unsere Themen.", "test"); }],
  ["quoted feedback", (c) => c.notePersonalitySpeech("Gerda", "test"), 'Er sagte: "Das hat wieder Spaß gemacht."'],
  ["a proposal is not an experience", (c) => c.notePersonalitySpeech("Gerda", "test"), "Das klingt nach Spaß."],
  ["question", (c) => c.notePersonalitySpeech("Gerda", "test"), "Hat das wieder Spaß gemacht?"],
]) {
  const test = fresh(); setup(test); test.personalityTurn(text, sessionId, true);
  assert.equal(count(test), 0, name);
}

// Positive words from another sentence must not train this episode.
c = fresh();
c.personalityTurn("Mit dir war der Film toll. Gerda ist kaputt.", "misattribution", true);
assert.equal(count(c), 0);
assert.equal(c.personalitySituation("Gerda").conversationMoment.valence, "negative");
c = fresh();
c.personalityTurn("Gerda ist kaputt, aber mit dir hat es trotzdem Spaß gemacht.", "mixed-outcome", true);
assert.equal(count(c), 1, "enjoyment can coexist with an unsuccessful attempt");
assert.equal(c.personalitySituation("Gerda").conversationMoment.valence, "positive");
c.personalityTurn("Sei nicht mehr so begeistert von Gerda", "mixed-outcome", true);
c.notePersonalitySpeech("Gerda ist unser Thema.", "mixed-outcome");
c.personalityTurn("Das war heute nichts.", "mixed-outcome", true);
assert.equal(c.personalitySituation("Das war heute nichts.").conversationMoment.valence, "negative", "disabling a learned interest does not disable an appropriate response to current feedback");
assert.ok(c.snapshot().episodes[0].learnedInterest.blocked);

for (const feedback of ["That was really fun.", "Это было очень весело.", "Це було дуже весело."]) {
  const test = fresh(); test.notePersonalitySpeech("Gerda", "language"); test.personalityTurn(feedback, "language", true);
  assert.equal(count(test), 1, feedback);
}

// Saved contextual evidence is validated and copied independently of snapshots.
c = make(); c.restore(saved);
assert.equal(count(c), 3);
const copy = c.snapshot();
copy.episodes[0].learnedInterest.encounters[0].reference.evidence = "mutated external snapshot";
assert.notEqual(c.snapshot().episodes[0].learnedInterest.encounters[0].reference.evidence, "mutated external snapshot");
for (const mutation of [
  (ref) => { ref.sessionId = "wrong-session"; },
  (ref) => { ref.at -= TTL + 1; },
  (ref) => { ref.evidence = "a different topic"; },
  (ref) => { ref.origin = "generated_text"; },
]) {
  const invalid = structuredClone(saved);
  mutation(invalid.episodes[0].learnedInterest.encounters[0].reference);
  const test = make(); test.restore(invalid);
  assert.equal(count(test), 0, "invalid contextual provenance cannot create a mature habit");
  assert.equal(test.snapshot().episodes.length, 1);
}

// The real engine supplies gradual context and respects negative feedback in expression.
const effects = [];
const engine = createBehaviorEngine({ now: () => now, wallNow: () => now,
  decide: async () => ({ answers: [{ name: "cue", type: "choice", choice: "happy_bob", confidence: 1 }], usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 } }),
  executeCue: (cue) => effects.push(cue),
});
engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
engine.setEnvironment({ foreground: true, focused: true, connected: true, ambientEnabled: true });
engine.dispatch({ type: "session-start", sessionId: "engine" });
engine.restore(JSON.stringify({ version: 1, companion: seed }));
engine.dispatch({ type: "assistant-end", sessionId: "engine", text: "Wir sprechen über Gerda." });
await flush(); now += 2_000;
engine.dispatch({ type: "user-turn", sessionId: "engine", text: "Das hat wieder Spaß gemacht." });
await flush();
let context = JSON.parse(engine.getPersonalityContext("Das hat wieder Spaß gemacht."));
assert.equal(context.developingInterest.encounters, 1);
assert.match(buildCompanionCharacterInstructions(JSON.stringify(context)), /tentative curiosity/u);
assert.match(buildCompanionCharacterInstructions(JSON.stringify(context)), /without announcing stages/u);
now += 2_000;
engine.dispatch({ type: "assistant-end", sessionId: "engine", text: "Gerda war wieder unser Thema." });
await flush(); now += 2_000;
engine.dispatch({ type: "user-turn", sessionId: "engine", text: "Das war heute nichts." });
await flush(); now += 2_000;
engine.dispatch({ type: "assistant-end", sessionId: "engine", text: "Wir können es für heute dabei lassen." });
await flush();
assert.equal(effects.at(-1).gesture, "hold", "a bouncy model cue does not override the user's recent setback");
assert.equal(engine.getState().companion.episodes[0].learnedInterest.encounters.length, 1);
engine.dispatch({ type: "session-end", sessionId: "engine" });
assert.deepEqual(JSON.parse(engine.getPersonalityContext("Gerda")).conversationMoment, undefined);
engine.dispose();
console.log("Natural companion feedback: heard/user references, gradual interest, transient setbacks, attribution, restore validation, language and expression PASS (offline)");
