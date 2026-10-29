import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load(path.resolve("src/behavior/behavior-companion.ts"));
const { createBehaviorEngine } = load(path.resolve("src/behavior/behavior-engine.ts"));

function makeCompanion() {
  let now = 10_000;
  const companion = createBehaviorCompanion({ now: () => now });
  return { companion, now: () => now, advance: (ms) => { now += ms; } };
}

function saveEpisode(companion, { title, detail, outcome, evidence = `${title} happened today.` }) {
  companion.userTurn(evidence);
  const proposal = companion.act({
    type: "propose_experience", title, detail, outcome, motif: "happy_bob", evidence,
  }, { userText: evidence, sessionId: "recall-test-session" });
  assert.equal(proposal.status, "proposed");
  companion.assistantEnd(`Should I remember ${title}?`);
  companion.userTurn("Yes.");
  return companion.snapshot().episodes.find((episode) => episode.title === title);
}

function recall(companion, episode, text = `Tell me what happened with ${episode.title}?`) {
  companion.userTurn(text);
  return companion.act({ type: "recall_experience", id: episode.id }, { userText: text, sessionId: "recall-test-session" });
}

function assertNoRecallFacts(result) {
  assert.equal(Object.hasOwn(result, "episode"), false, `${result.status} must not expose episode facts`);
}

const longDetail = "We built the paper rocket together, painted its silver wings, tested the fins, repaired the nose cone, and launched it from the garden after lunch.";
const longOutcome = "The rocket flew over the garden, circled the tall tree, and landed safely beside the red fence.";
const { companion } = makeCompanion();
const episode = saveEpisode(companion, { title: "Gerda", detail: longDetail, outcome: longOutcome, evidence: "Gerda and I built the paper rocket together today." });

const firstRecall = recall(companion, episode);
assert.equal(firstRecall.status, "recalled");
assert.deepEqual(firstRecall.episode, {
  id: episode.id,
  title: "Gerda",
  detail: longDetail,
  outcome: longOutcome,
  createdAt: episode.createdAt,
  source: { evidence: episode.source.evidence, sessionId: episode.source.sessionId, at: episode.source.at },
});
assert.ok(firstRecall.episode.detail.length > 70, "exact recall returns the full bounded detail, including its tail");
assert.ok(firstRecall.episode.outcome.length > 60, "exact recall returns the full bounded outcome, including its tail");
assert.ok(firstRecall.episode.detail.length <= 220);
assert.ok(firstRecall.episode.outcome.length <= 180);
assert.ok(firstRecall.episode.source.evidence.length <= 240);
assert.ok(firstRecall.episode.source.sessionId.length <= 96);
assert.equal(companion.context("Tell me what happened with Gerda?").companion.episodes[0].detail.length, 70, "the general prompt context stays compact");

// Returned records are independent copies, including nested provenance.
firstRecall.episode.detail = "caller mutation";
firstRecall.episode.source.evidence = "caller mutation";
const secondRecall = recall(companion, episode);
assert.equal(secondRecall.episode.detail, longDetail);
assert.equal(secondRecall.episode.source.evidence, episode.source.evidence);
assert.equal(companion.snapshot().episodes[0].detail, longDetail);

// The existing identity gate remains authoritative, with no facts on failures.
let result = recall(companion, episode, "Tell me about Rocket?");
assert.equal(result.status, "reference_not_named");
assertNoRecallFacts(result);
companion.userTurn("Tell me about Gerda?");
result = companion.act({ type: "recall_experience", id: "ep_missing" }, { userText: "Tell me about Gerda?", sessionId: "recall-test-session" });
assert.equal(result.status, "not_found");
assertNoRecallFacts(result);

const rocket = saveEpisode(companion, { title: "Rocket", detail: "We repaired the tail.", outcome: "It flew straight.", evidence: "Rocket flew straight today." });
result = recall(companion, episode, "Tell me about Gerda and Rocket?");
assert.equal(result.status, "ambiguous_reference");
assertNoRecallFacts(result);
result = recall(companion, episode, "Rocket was fun?");
assert.equal(result.status, "reference_not_named");
assertNoRecallFacts(result);

// Every successful recall status carries the same confirmed episode record.
const silentFixture = makeCompanion();
const silentEpisode = saveEpisode(silentFixture.companion, { title: "Silent Rocket", detail: "We built it.", outcome: "It flew.", evidence: "Silent Rocket flew today." });
const muteText = "Please keep the Silent Rocket ritual silent.";
silentFixture.companion.userTurn(muteText);
assert.equal(silentFixture.companion.act({ type: "set_episode_ritual", id: silentEpisode.id, mode: "silent", evidence: muteText }, { userText: muteText, sessionId: "recall-test-session" }).status, "personal_ritual_silenced");
result = recall(silentFixture.companion, silentEpisode);
assert.equal(result.status, "personal_ritual_silent");
assert.deepEqual(result.episode.detail, silentEpisode.detail);

const activeFixture = makeCompanion();
const activeEpisode = saveEpisode(activeFixture.companion, { title: "Active Rocket", detail: "We built it.", outcome: "It flew.", evidence: "Active Rocket flew today." });
const ritualText = "For Active Rocket, please nod and say Mission Rocket!";
activeFixture.companion.userTurn(ritualText);
const ritualProposal = activeFixture.companion.act({ type: "set_episode_ritual", id: activeEpisode.id, mode: "active", motif: "nod", phrase: "Mission Rocket!", evidence: ritualText }, { userText: ritualText, sessionId: "recall-test-session" });
assert.equal(ritualProposal.status, "personal_ritual_pending");
activeFixture.companion.assistantEnd(ritualProposal.confirmationQuestion);
activeFixture.companion.userTurn("Yes.");
result = recall(activeFixture.companion, activeEpisode);
assert.equal(result.status, "personal_ritual_offered");
assert.deepEqual(result.episode.detail, activeEpisode.detail);
result = recall(activeFixture.companion, activeEpisode);
assert.equal(result.status, "personal_ritual_cooldown");
assert.deepEqual(result.episode.detail, activeEpisode.detail);

const cooldownFixture = makeCompanion();
const cooldownEpisode = saveEpisode(cooldownFixture.companion, { title: "Cooldown Rocket", detail: "We built it.", outcome: "It flew.", evidence: "Cooldown Rocket flew today." });
result = recall(cooldownFixture.companion, cooldownEpisode);
assert.equal(result.status, "recalled");
assert.equal(cooldownFixture.companion.reserveMotif("happy_bob"), true);
result = recall(cooldownFixture.companion, cooldownEpisode);
assert.equal(result.status, "motif_cooldown");
assert.deepEqual(result.episode.detail, cooldownEpisode.detail);

// Exercise the public engine action path as well as the isolated companion.
async function flush() { for (let index = 0; index < 32; index += 1) await Promise.resolve(); }
let mono = 1_000;
let wall = Date.UTC(2026, 0, 1);
const effects = [];
const engine = createBehaviorEngine({
  now: () => mono,
  wallNow: () => wall,
  decide: async (request) => ({
    answers: request.questions.map((question) => question.type === "score"
      ? { name: question.name, type: "score", score: 0, confidence: 1, probabilities: question.levels.map((level, index) => ({ value: index, label: level.label, probability: index === 0 ? 1 : 0 })) }
      : { name: question.name, type: "choice", choice: question.choices[0].value, confidence: 1, probabilities: question.choices.map((item, index) => ({ value: item.value, probability: index === 0 ? 1 : 0 })) }),
    usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "shared-episode-recall",
  }),
  executeCue: (cue) => effects.push(cue),
});
engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: true, candidateScoring: true });
engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false, responseLanguage: "en" });
engine.dispatch({ type: "session-start", sessionId: "engine-recall-test" });
async function engineTurn(text) {
  mono += 1_200;
  wall += 1_200;
  engine.dispatch({ type: "user-turn", sessionId: "engine-recall-test", text });
  await flush();
}
async function engineSave(title, text, detail, outcome) {
  await engineTurn(text);
  const proposal = engine.companionAction({ type: "propose_experience", title, detail, outcome, motif: "happy_bob", evidence: text });
  assert.equal(proposal.status, "proposed");
  engine.dispatch({ type: "assistant-end", sessionId: "engine-recall-test", text: `Should I remember ${title}?` });
  await flush();
  await engineTurn("Yes.");
  return engine.getState().companion.episodes.find((item) => item.title === title);
}
async function recallFromEngine(id, text) {
  await engineTurn(text);
  return engine.companionAction({ type: "recall_experience", id });
}
await engineTurn("Gerda and I built the paper rocket together today.");
const engineProposal = engine.companionAction({ type: "propose_experience", title: "Gerda", detail: longDetail, outcome: longOutcome, motif: "happy_bob", evidence: "Gerda and I built the paper rocket together today." });
assert.equal(engineProposal.status, "proposed");
engine.dispatch({ type: "assistant-end", sessionId: "engine-recall-test", text: "Should I remember Gerda?" });
await flush();
await engineTurn("Yes.");
const engineEpisode = engine.getState().companion.episodes[0];
await engineTurn("Tell me what happened with Gerda?");
const effectsBeforeRecall = effects.length;
const engineRecall = engine.companionAction({ type: "recall_experience", id: engineEpisode.id });
assert.equal(engineRecall.status, "recalled");
assert.deepEqual(engineRecall.episode, {
  id: engineEpisode.id,
  title: "Gerda",
  detail: longDetail,
  outcome: longOutcome,
  createdAt: engineEpisode.createdAt,
  source: { evidence: engineEpisode.source.evidence, sessionId: engineEpisode.source.sessionId, at: engineEpisode.source.at },
});
const engineContext = JSON.parse(engine.getConversationContext()).companion.episodes[0];
assert.equal(engineContext.detail.length, 70, "the engine's general context remains compact after adding recall payloads");
engineRecall.episode.detail = "modified through engine result";
engineRecall.episode.source.evidence = "modified through engine result";
assert.equal(engine.getState().companion.episodes[0].detail, longDetail, "the engine action result cannot mutate stored memory");
assert.equal(engine.getState().companion.episodes[0].source.evidence, "Gerda and I built the paper rocket together today.");
assert.equal(effects.length, effectsBeforeRecall, "returning facts through recall does not cause a physical effect");

// Engine-gated rejects stay fact-free, and successful cooldown/mute/offer paths preserve the same facts.
let engineRejected = await recallFromEngine(engineEpisode.id, "Tell me about Rocket?");
assert.equal(engineRejected.status, "reference_not_named");
assertNoRecallFacts(engineRejected);
await engineTurn("Tell me about Gerda?");
engineRejected = engine.companionAction({ type: "recall_experience", id: "ep_missing" });
assert.equal(engineRejected.status, "not_found");
assertNoRecallFacts(engineRejected);

const rocketEpisode = await engineSave("Rocket", "Rocket flew straight today.", "We repaired the rocket fins and checked the frame.", "The rocket flew straight over the garden.");
await engineTurn("Rocket, it worked!");
assert.ok(engine.getState().companion.episodes.find((item) => item.id === rocketEpisode.id).lastUsedAt !== null, "the engine records only the usual explicit positive-report cue");
let engineCooldown = await recallFromEngine(rocketEpisode.id, "Tell me about Rocket?");
assert.equal(engineCooldown.status, "motif_cooldown");
assert.equal(engineCooldown.episode.detail, rocketEpisode.detail);
engineRejected = await recallFromEngine(engineEpisode.id, "Tell me about Gerda and Rocket?");
assert.equal(engineRejected.status, "ambiguous_reference");
assertNoRecallFacts(engineRejected);

const muteTextForEngine = "Please keep Rocket's ritual silent.";
await engineTurn(muteTextForEngine);
const engineMute = engine.companionAction({ type: "set_episode_ritual", id: rocketEpisode.id, mode: "silent", evidence: muteTextForEngine });
assert.equal(engineMute.status, "personal_ritual_silenced");
const engineSilent = await recallFromEngine(rocketEpisode.id, "Tell me about Rocket?");
assert.equal(engineSilent.status, "personal_ritual_silent");
assert.equal(engineSilent.episode.detail, rocketEpisode.detail);

mono += 60_001;
wall += 60_001;
const engineRitualText = "For Gerda, please nod and say Mission Gerda!";
await engineTurn(engineRitualText);
const engineRitual = engine.companionAction({ type: "set_episode_ritual", id: engineEpisode.id, mode: "active", motif: "nod", phrase: "Mission Gerda!", evidence: engineRitualText });
assert.equal(engineRitual.status, "personal_ritual_pending");
engine.dispatch({ type: "assistant-end", sessionId: "engine-recall-test", text: engineRitual.confirmationQuestion });
await flush();
await engineTurn("Yes.");
const engineOffer = await recallFromEngine(engineEpisode.id, "Tell me about Gerda?");
assert.equal(engineOffer.status, "personal_ritual_offered");
assert.equal(engineOffer.episode.detail, longDetail);
const enginePersonalCooldown = await recallFromEngine(engineEpisode.id, "Tell me about Gerda?");
assert.equal(enginePersonalCooldown.status, "personal_ritual_cooldown");
assert.equal(enginePersonalCooldown.episode.detail, longDetail);

console.log("Shared episode exact recall: PASS");
