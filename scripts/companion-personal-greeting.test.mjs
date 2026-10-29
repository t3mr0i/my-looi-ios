import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load("src/behavior/behavior-companion.ts");
const { createBehaviorEngine } = load("src/behavior/behavior-engine.ts");
const { buildRealtimeSessionUpdate } = load("src/voice/realtime-config.ts");
const { buildBudgetConversationInstructions } = createTypeScriptTreeLoader({ "./openai-api-key": {} })("src/openai/budget-conversation.ts");
const { PERSONAL_GREETING_QUIET_MS: QUIET, PERSONAL_GREETING_COOLDOWN_MS: DAY, PERSONALITY_REFERENCE_TTL_MS: TTL, isCompanionGreeting } = load("src/character/companion-personality.ts");
let now = Date.UTC(2026, 9, 28, 12);
const create = () => createBehaviorCompanion({ now: () => now });
const c = create();
const text = "We built Gerda together and it worked.";
c.userTurn(text);
c.act({ type: "propose_experience", title: "Gerda", detail: "A shared paper rocket.", outcome: "It worked.", motif: "hold", evidence: text }, { userText: text, sessionId: "creation" });
c.assistantEnd("Should I remember Gerda?"); c.userTurn("Yes");
for (let day = 0; day < 3; day++) {
  now += DAY;
  c.personalityTurn("Mit dir hat Gerda Spaß gemacht.", `learning-${day}`, true);
}
const mature = c.serialize();
const fresh = (data = mature) => { const result = create(); result.restore(data); return result; };
const offered = (companion, question) => companion.personalitySituation(question).greetingInterest;

// A preference needs quiet time before it becomes an optional greeting callback.
let h = fresh();
h.personalityTurn("Guten Morgen", "too-soon", true);
assert.equal(offered(h, "Guten Morgen"), undefined);
now += QUIET;
h = fresh();
h.personalityTurn("Guten Morgen, Pico!", "return", true, "Pico");
assert.deepEqual(offered(h, "Guten Morgen, Pico!"), { title: "Gerda" });
const beforeRead = h.serialize();
assert.equal(offered(h, "Wie ist das Wetter?"), undefined);
assert.deepEqual(h.serialize(), beforeRead, "reading the opportunity does not consume the daily allowance");
assert.equal(beforeRead.lastPersonalGreetingAt, undefined, "generated instructions are not heard speech");
h.notePersonalitySpeech('Hallo! Bei „Gerda“ werde ich neugierig.', "return");
const heard = h.serialize();
assert.equal(heard.lastPersonalGreetingAt, now, "the daily timestamp commits only after the selected label was heard");
assert.deepEqual(heard.episodes, beforeRead.episodes, "the robot's own personal touch cannot reinforce its learned interest");
now += 100;
h.notePersonalitySpeech("Gerda", "return");
assert.equal(h.serialize().lastPersonalGreetingAt, heard.lastPersonalGreetingAt, "a duplicate heard-end event cannot extend the daily timestamp");
now -= 100;

h = fresh(heard);
h.personalityTurn("Hallo", "same-day", true);
assert.equal(offered(h, "Hallo"), undefined, "a restart cannot bypass the daily cadence");
now += DAY - 1;
h = fresh(heard); h.personalityTurn("Hallo", "still-same-day", true);
assert.equal(offered(h, "Hallo"), undefined);
now += 1;
h = fresh(heard); h.personalityTurn("Hallo", "next-day", true);
assert.deepEqual(offered(h, "Hallo"), { title: "Gerda" });

for (const [name, finish] of [
  ["interrupted", (item) => item.notePersonalitySpeech(null, "attempt")],
  ["plain reply", (item) => item.notePersonalitySpeech("Guten Morgen!", "attempt")],
  ["topic changed", (item) => { item.personalityTurn("Wie ist das Wetter?", "attempt", true); item.notePersonalitySpeech("Gerda", "attempt"); }],
  ["expired", (item) => { now += TTL + 1; item.notePersonalitySpeech("Gerda", "attempt"); }],
  ["forgotten episode", (item) => { item.forget(item.snapshot().episodes[0].id); item.notePersonalitySpeech("Gerda", "attempt"); }],
]) {
  const item = fresh(); item.personalityTurn("Hallo", "attempt", true);
  assert.ok(offered(item, "Hallo")); finish(item);
  assert.equal(item.serialize().lastPersonalGreetingAt, undefined, name);
}

h = fresh(); h.personalityTurn("Hallo", "one-session", true);
h.notePersonalitySpeech("Hallo!", "one-session");
h.personalityTurn("Hallo", "one-session", true);
assert.equal(offered(h, "Hallo"), undefined, "a single conversation does not keep proposing the personal touch");
h = fresh(); h.personalityTurn("Gerda hat keinen Spaß gemacht.", "setback", true);
h.personalityTurn("Hallo", "setback", true);
assert.equal(offered(h, "Hallo"), undefined, "a recent setback takes priority over a cheerful callback");
h = fresh(); h.personalityTurn("Sei nicht mehr so begeistert von Gerda", "muted", true);
h.personalityTurn("Hallo", "another-session", true);
assert.equal(offered(h, "Hallo"), undefined, "a blocked interest cannot appear in a greeting");

for (const greeting of ["Hallo LOOI", "Guten Morgen!", "Pico, hallo!", "Hello Pico", "Привет, Луи", "Привіт, Луї"]) {
  assert.equal(isCompanionGreeting(greeting, "Pico"), true, greeting);
}
for (const concern of ["Hallo, Gerda ist kaputt.", "Guten Morgen, ich brauche Hilfe.", "Hallo, mir geht es schlecht.", 'Er sagte: "Hallo"', "Wenn ich Hallo sage", "Hello, I am sad."]) {
  assert.equal(isCompanionGreeting(concern, "Pico"), false, concern);
  const item = fresh(); item.personalityTurn(concern, "concern", true);
  assert.equal(offered(item, concern), undefined);
}

const preferences = { robotName: "Pico", language: "de", listeningLanguage: "de", speechGender: "masculine", robotAddressAliases: [], robotAddressRecognitionAliases: [] };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
for (const mode of ["active", "shadow", "off"]) {
  const engine = createBehaviorEngine({ now: () => now, wallNow: () => now,
    decide: async () => ({ answers: [{ name: "cue", type: "choice", choice: "hold", confidence: 1 }], usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 } }),
    executeCue: (cue) => { assert.equal(cue.gesture, "hold"); },
  });
  engine.configure({ mode, dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
  engine.setEnvironment({ foreground: true, focused: true, robotName: "Pico" });
  engine.dispatch({ type: "session-start", sessionId: `greeting-${mode}` });
  engine.restore(JSON.stringify({ version: 1, companion: mature, style: { conversationTone: "calm" } }));
  assert.equal(JSON.parse(engine.getPersonalityContext("Hallo Pico")).greetingInterest, undefined, "a read alone cannot arm an opening");
  engine.dispatch({ type: "user-turn", sessionId: `greeting-${mode}`, text: "Hallo Pico" });
  await flush();
  const context = engine.getPersonalityContext("Hallo Pico");
  assert.equal(JSON.parse(context).greetingInterest.title, "Gerda");
  const realtime = buildRealtimeSessionUpdate(preferences, undefined, undefined, engine.getConversationContext()).session.instructions;
  const budget = buildBudgetConversationInstructions("Pico", "de", undefined, true, context);
  for (const prompt of [realtime, budget]) {
    assert.match(prompt, /optionally add at most one short clause/u);
    assert.match(prompt, /prefers a calmer manner/u);
    assert.match(prompt, /Do not infer whether the label is a person or object/u);
  }
  engine.notePersonalitySpeech("Hallo! Gerda macht mich neugierig.", `greeting-${mode}`);
  assert.equal(JSON.parse(engine.serialize()).companion.lastPersonalGreetingAt, now);
  engine.dispose();
}

// Ongoing work wins over the callback; the character-only Budget seam shares this gate.
const busy = createBehaviorEngine({ now: () => now, wallNow: () => now, decide: async () => { throw new Error("No decision should start here"); }, executeCue: () => {} });
busy.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: false });
busy.dispatch({ type: "session-start", sessionId: "busy" });
busy.restore(JSON.stringify({ version: 1, companion: mature }));
busy.dispatch({ type: "intention", action: "pause", goal: "Gerda reparieren", sessionId: "busy" });
busy.setEnvironment({ foreground: true, focused: true });
busy.acceptPersonalityTurn("Hallo", "busy");
assert.equal(JSON.parse(busy.getPersonalityContext("Hallo")).greetingInterest, undefined);
busy.dispose();
console.log("Personal greeting: established interests, pure openings, task/concern priority, heard-only daily cadence, interruption and restart across Realtime/Budget PASS (offline)");
