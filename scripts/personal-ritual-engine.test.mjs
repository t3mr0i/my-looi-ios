import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorEngine } = load(path.resolve("src/behavior/behavior-engine.ts"));
const DAY = 24 * 60 * 60 * 1_000;
const flush = async () => { for (let index = 0; index < 32; index += 1) await Promise.resolve(); };

function makeClock() {
  let mono = 1_000;
  let wall = Date.UTC(2026, 0, 1);
  return {
    now: () => mono,
    wall: () => wall,
    advance(ms) { mono += ms; wall += ms; },
    setWall(value) { wall = value; },
  };
}

function decisionFor(request, cue = "hold") {
  const answers = request.questions.map((question) => {
    if (question.type === "score") return {
      name: question.name, type: "score", score: 0, confidence: 1,
      probabilities: question.levels.map((level, index) => ({ value: index, label: level.label, probability: index === 0 ? 1 : 0 })),
    };
    const values = question.choices.map((item) => item.value);
    const preferred = question.name === "cue" ? cue
      : question.name === "visual" ? "use_view"
        : question.name === "attention" ? "keep_target" : question.name === "intention" ? "wait" : "none";
    const choice = values.includes(preferred) ? preferred : values[0];
    return { name: question.name, type: "choice", choice, confidence: 1, probabilities: values.map((value) => ({ value, probability: value === choice ? 1 : 0 })) };
  });
  return { answers, usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-personal-ritual" };
}

function makeEngine({ cue = "hold", deferred = false, clock = makeClock() } = {}) {
  const decisions = [];
  const effects = [];
  let selectedCue = cue;
  const engine = createBehaviorEngine({
    now: clock.now,
    wallNow: clock.wall,
    decisionTimeoutMs: 60_000,
    decide(request) {
      if (!deferred) return Promise.resolve(decisionFor(request, selectedCue));
      return new Promise((resolve) => decisions.push({ request, resolve }));
    },
    // A test recording seam: never connects to a robot or emits physical effects.
    executeCue: (value) => effects.push(value),
  });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: true, candidateScoring: true });
  engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false, responseLanguage: "en" });
  engine.dispatch({ type: "session-start", sessionId: "personal-ritual-test" });
  return { engine, clock, effects, decisions, setCue: (value) => { selectedCue = value; } };
}

async function dispatch(h, type, fields = {}) {
  h.clock.advance(1_200);
  h.engine.dispatch({ type, sessionId: h.engine.getState().sessionId, ...fields });
  await flush();
}

async function userTurn(h, text) { await dispatch(h, "user-turn", { text }); }
async function assistantEnd(h, text) { await dispatch(h, "assistant-end", { text }); }

async function action(h, value) {
  const result = h.engine.companionAction(value);
  await flush();
  return result;
}

async function seedEpisode(h, title = "Gerda") {
  const text = `${title} finally flew today.`;
  await userTurn(h, text);
  const proposal = await action(h, { type: "propose_experience", title, detail: "We repaired the paper rocket.", outcome: "The rocket finally flew.", motif: "happy_bob", evidence: `${title} finally flew` });
  assert.equal(proposal.status, "proposed");
  await assistantEnd(h, `Should I remember ${title}?`);
  await userTurn(h, "Yes");
  const episode = h.engine.getState().companion.episodes.find((item) => item.title === title);
  assert.ok(episode, "the episode was saved only after its question was heard and confirmed");
  return episode;
}

async function chooseRitual(h, episode, phrase = "Mission Gerda!") {
  const text = `For ${episode.title}, please use a nod and say ${phrase}`;
  await userTurn(h, text);
  const proposal = await action(h, { type: "set_episode_ritual", id: episode.id, mode: "active", motif: "nod", phrase, evidence: text });
  assert.equal(proposal.status, "personal_ritual_pending");
  await assistantEnd(h, proposal.confirmationQuestion);
  await userTurn(h, "Yes");
  assert.equal(h.engine.getState().companion.episodes.find((item) => item.id === episode.id).ritualPreference.mode, "active");
}

async function recall(h, episode, text = `Tell me what happened with ${episode.title}.`) {
  await userTurn(h, text);
  return action(h, { type: "recall_experience", id: episode.id });
}

function nonHold(effects) { return effects.filter((cue) => cue.gesture !== "hold"); }

// Seed and confirm a selected per-episode nod and exact spoken phrase.
const main = makeEngine();
const episode = await seedEpisode(main);
await chooseRitual(main, episode);
let preference = main.engine.getState().companion.episodes.find((item) => item.id === episode.id).ritualPreference;
assert.equal(preference.motif, "nod");
assert.equal(preference.phrase, "Mission Gerda!");
assert.equal(preference.lastOfferedAt, null);
assert.equal(main.effects.some((cue) => cue.gesture === "nod"), false, "choosing the ritual itself never plays a head cue");

const firstOffer = await recall(main, episode);
assert.equal(firstOffer.status, "personal_ritual_offered");
assert.deepEqual(firstOffer.ritualOffer, { episodeId: episode.id, title: "Gerda", motif: "nod", phrase: "Mission Gerda!" });
assert.equal(nonHold(main.effects).length, 0, "recall offers no gesture before the phrase is actually heard");
const firstAttemptAt = main.engine.getState().companion.episodes.find((item) => item.id === episode.id).ritualPreference.lastOfferedAt;
assert.equal(firstAttemptAt, main.clock.wall(), "the per-episode attempt is counted when offered");
await assistantEnd(main, "Gerda's story is lovely.");
assert.equal(nonHold(main.effects).length, 0, "an assistant transcript without the selected phrase cannot emit the personal cue");

// Restored state keeps the attempted-offer cooldown, but never restores a queued phrase.
const saved = main.engine.serialize();
const restored = makeEngine({ clock: main.clock });
restored.engine.restore(saved);
restored.engine.dispatch({ type: "session-start", sessionId: "personal-ritual-restored" });
await userTurn(restored, "Tell me what happened with Gerda.");
const tooSoon = await action(restored, { type: "recall_experience", id: episode.id });
assert.equal(tooSoon.status, "personal_ritual_cooldown");
assert.equal(nonHold(restored.effects).length, 0);

// The interval opens exactly at 24 hours; this later single offer may cue only after its phrase is heard once.
restored.clock.setWall(firstAttemptAt + DAY - 1_200);
const nextOffer = await recall(restored, episode);
assert.equal(nextOffer.status, "personal_ritual_offered", "the attempt window reopens exactly at 24 hours");
await assistantEnd(restored, "Mission Gerda! Mission Gerda!");
assert.equal(nonHold(restored.effects).length, 0, "repeating the chosen phrase does not count as one heard offer");
// Repeated playback is still within cooldown; explicitly advance to the next allowed opportunity.
restored.clock.setWall(firstAttemptAt + 2 * DAY - 1_200);
const finalOffer = await recall(restored, episode);
assert.equal(finalOffer.status, "personal_ritual_offered");
await assistantEnd(restored, "Mission Gerda!");
const emitted = nonHold(restored.effects);
assert.equal(emitted.length, 1, "a heard phrase emits at most one selected head cue");
assert.equal(emitted[0].gesture, "nod");
assert.equal(emitted[0].presentationOnly, false);

// The saved nod preference remains subordinate to an explicit less-nodding setting.
const quiet = makeEngine();
const quietEpisode = await seedEpisode(quiet);
await chooseRitual(quiet, quietEpisode);
const quietOffer = await recall(quiet, quietEpisode);
await assistantEnd(quiet, quietOffer.ritualPhrase);
const beforeLessNod = nonHold(quiet.effects).length;
await userTurn(quiet, "Please nod less");
assert.equal(quiet.engine.getState().style.suppressNod, true);
assert.equal(nonHold(quiet.effects).length, beforeLessNod, "less-nodding preference suppresses the saved nod ritual");

// An immediate No after the heard phrase silently mutes the ritual and wins over a happy-bob model suggestion.
const decline = makeEngine({ cue: "happy_bob" });
const declineEpisode = await seedEpisode(decline);
await chooseRitual(decline, declineEpisode);
const declineOffer = await recall(decline, declineEpisode);
assert.equal(declineOffer.status, "personal_ritual_offered");
await assistantEnd(decline, declineOffer.ritualPhrase);
const beforeNo = decline.effects.length;
decline.engine.dispatch({ type: "user-speech-start", sessionId: decline.engine.getState().sessionId });
await dispatch(decline, "user-speech-end");
await userTurn(decline, "No");
assert.equal(decline.engine.getState().companion.episodes.find((item) => item.id === declineEpisode.id).ritualPreference.mode, "silent");
assert.ok(decline.effects.slice(beforeNo).every((cue) => cue.gesture === "hold"), "No suppresses every cue on its turn even when the decision model selects happy_bob");
decline.setCue("hold");
const beforePositive = decline.effects.length;
await userTurn(decline, "Gerda finally flew, it worked!");
assert.equal(nonHold(decline.effects.slice(beforePositive)).length, 0, "a silent choice prevents legacy motif fallback on later positive reports");

// Compound natural-language refusals after the heard phrase have the same effect as a bare No.
const compoundDecline = makeEngine({ cue: "happy_bob" });
const compoundEpisode = await seedEpisode(compoundDecline);
await chooseRitual(compoundDecline, compoundEpisode);
const compoundOffer = await recall(compoundDecline, compoundEpisode);
await assistantEnd(compoundDecline, compoundOffer.ritualPhrase);
const beforeCompoundNo = compoundDecline.effects.length;
await userTurn(compoundDecline, "No, stop it");
assert.equal(compoundDecline.engine.getState().companion.episodes.find((item) => item.id === compoundEpisode.id).ritualPreference.mode, "silent");
assert.ok(compoundDecline.effects.slice(beforeCompoundNo).every((cue) => cue.gesture === "hold"), "a compound No after the heard phrase silences the ritual and suppresses all cues");

// Declining the audible choice question in German also persists silent and wins over model enthusiasm.
const pendingDecline = makeEngine({ cue: "happy_bob" });
const pendingEpisode = await seedEpisode(pendingDecline);
const pendingText = "Für Gerda bitte nicken und Mission Gerda sagen";
await userTurn(pendingDecline, pendingText);
const pendingChoice = await action(pendingDecline, { type: "set_episode_ritual", id: pendingEpisode.id, mode: "active", motif: "nod", phrase: "Mission Gerda", evidence: pendingText });
assert.equal(pendingChoice.status, "personal_ritual_pending");
await assistantEnd(pendingDecline, pendingChoice.confirmationQuestion);
const beforeGermanNo = pendingDecline.effects.length;
await userTurn(pendingDecline, "Nein, lass das bitte");
assert.equal(pendingDecline.engine.getState().companion.episodes.find((item) => item.id === pendingEpisode.id).ritualPreference.mode, "silent");
assert.ok(pendingDecline.effects.slice(beforeGermanNo).every((cue) => cue.gesture === "hold"), "a compound German refusal after the heard choice question suppresses all cues");

// Interruption or a new user turn consumes an unspoken offer; stale audio cannot restore its cue.
const interrupted = makeEngine();
const interruptedEpisode = await seedEpisode(interrupted);
await chooseRitual(interrupted, interruptedEpisode);
const staleOffer = await recall(interrupted, interruptedEpisode);
assert.equal(staleOffer.status, "personal_ritual_offered");
await dispatch(interrupted, "interrupt", { reason: "user-interruption" });
await assistantEnd(interrupted, staleOffer.ritualPhrase);
assert.equal(nonHold(interrupted.effects).length, 0, "an interruption invalidates a turn-bound offer");
await recall(interrupted, interruptedEpisode);
await userTurn(interrupted, "Actually, tell me another thing.");
await assistantEnd(interrupted, staleOffer.ritualPhrase);
assert.equal(nonHold(interrupted.effects).length, 0, "a new user turn consumes an unanswered ritual offer");

// Settings mute invalidates in-flight decisions and clears the personal preference without speaking a claim.
const settings = makeEngine({ deferred: true });
const settingsEpisode = await seedEpisode(settings);
await chooseRitual(settings, settingsEpisode);
const decisionBeforeDisable = settings.decisions.length;
const settingsOffer = await recall(settings, settingsEpisode);
assert.equal(settingsOffer.status, "personal_ritual_offered");
await assistantEnd(settings, settingsOffer.ritualPhrase);
assert.ok(settings.decisions.length > decisionBeforeDisable);
const generationBeforeDisable = settings.engine.getState().lifecycleGeneration;
assert.equal(settings.engine.disablePersonalRitual(settingsEpisode.id), true);
assert.ok(settings.engine.getState().lifecycleGeneration > generationBeforeDisable);
for (const pending of settings.decisions.splice(0)) pending.resolve(decisionFor(pending.request, "happy_bob"));
await flush();
assert.equal(nonHold(settings.effects).length, 0, "settings disable makes an in-flight ritual cue stale");
assert.equal(settings.engine.getState().companion.episodes.find((item) => item.id === settingsEpisode.id).ritualPreference.mode, "silent");

// A pending shared object confirmation and ritual selection cannot overwrite one another.
const sharedScope = makeEngine();
const sharedEpisode = await seedEpisode(sharedScope);
const beginText = "Let's begin an object trial for Gerda.";
await userTurn(sharedScope, beginText);
const begin = await action(sharedScope, { type: "manage_shared_activity", operation: "begin", id: sharedEpisode.id, evidence: beginText });
assert.equal(begin.status, "pending_confirmation");
const blockedChoice = await action(sharedScope, { type: "set_episode_ritual", id: sharedEpisode.id, mode: "active", motif: "nod", phrase: "Mission Gerda!", evidence: beginText });
assert.equal(blockedChoice.status, "pending_exists", "an activity confirmation remains the only pending intention");
assert.equal(sharedScope.engine.getState().pendingIntention.activity.pending.step, "begin");

console.log("personal ritual engine gating, heard phrase, cadence, mute, interruption, and persistence tests passed");
