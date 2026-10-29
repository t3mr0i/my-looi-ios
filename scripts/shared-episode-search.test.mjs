import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load(path.resolve("src/behavior/behavior-companion.ts"));
const flush = async () => { for (let index = 0; index < 32; index += 1) await Promise.resolve(); };

function createHarness(name) {
  const runtime = createCompanionLiveRuntime();
  const sessionId = `episode-search-${name}`;
  runtime.events.beginBehaviorSession(sessionId, () => {});
  const publish = (event) => runtime.events.publishBehaviorEvent({ ...event, sessionId });
  const action = (value) => runtime.events.performBehaviorCompanionAction(value, sessionId);
  const state = () => runtime.behaviorEngine.getState();
  async function turn(text) {
    publish({ type: "user-turn", text });
    await flush();
  }
  async function save({ title, detail, outcome, source }) {
    await turn(source);
    const proposal = action({
      type: "propose_experience",
      title,
      detail,
      outcome,
      motif: "hold",
      evidence: source,
    });
    assert.equal(proposal.status, "proposed", `${title} is first proposed through the public action bridge`);
    const question = state().companion.pendingExperience?.draft
      ? `Soll ich ${title} als gemeinsame Erinnerung speichern?`
      : `Soll ich ${title} speichern?`;
    publish({ type: "assistant-end", text: question });
    await flush();
    await turn("Ja.");
    const saved = state().companion.episodes.find((episode) => episode.title === title);
    assert.ok(saved, `${title} is present only after the follow-up affirmative transcript`);
    return saved;
  }
  function close() {
    runtime.events.endBehaviorSession(sessionId);
    runtime.uninstallRuntime();
    runtime.behaviorEngine.dispose();
  }
  return { runtime, sessionId, publish, action, state, turn, save, close };
}

function companionStateSnapshot(state) {
  return JSON.parse(JSON.stringify({
    episodes: state.companion.episodes,
    pendingExperience: state.companion.pendingExperience,
    interest: state.companion.interest,
    visualGrant: state.companion.visualGrant,
    scene: state.companion.scene,
    pendingIntention: state.pendingIntention,
    game: state.game,
    objectReference: state.objectReference,
  }));
}

const harness = createHarness("candidates");
let gerda;
let komet;
try {
  gerda = await harness.save({
    title: "Gerda",
    detail: "Wir bauten eine Papierrakete aus Pappe, klebten silberne Flügel mit Spiegelglanz an, prüften die Flossen dreimal und reparierten die stumpfe Nase.",
    outcome: "Beim ersten Wurf flog sie über den Garten und landete sicher neben dem Zaun.",
    source: "Wir haben Gerda gebaut; Papierrakete flog bis zum Zaun.",
  });
  komet = await harness.save({
    title: "Komet",
    detail: "Wir falteten die Papierrakete mit Spiegelglanz und klebten silberne Flügel an.",
    outcome: "Der zweite Wurf landete sicher neben dem Gartenzaun.",
    source: "Komet war die zweite Papierrakete für den Flug im Garten.",
  });
  await harness.save({
    title: "Stern",
    detail: "Wir bauten eine Papierrakete mit roter Spitze und breiten Flossen.",
    outcome: "Sie blieb beim ersten Wurf auf dem Rasen liegen.",
    source: "Stern ist die rote Papierrakete.",
  });
  await harness.save({
    title: "Blitz",
    detail: "Wir falteten eine Papierrakete aus blauem Karton.",
    outcome: "Sie landete hinter dem kleinen Zaun.",
    source: "Blitz heißt blaue Papierrakete.",
  });
  const english = await harness.save({
    title: "Orbit",
    detail: "We built a paper rocket with silver fins and repaired its blunt nose.",
    outcome: "On the first launch it landed beside the garden fence.",
    source: "Orbit is our paper rocket from the garden.",
  });

  const naturalQuestion = "Weißt du noch unsere Rakete?";
  await harness.turn(naturalQuestion);
  const beforeSearch = companionStateSnapshot(harness.state());
  const search = harness.action({ type: "search_experiences", query: naturalQuestion });
  assert.equal(search.ok, true);
  assert.equal(search.status, "candidates_found");
  assert.equal(search.totalMatches, 4, "all four German compound tokens match the lexical suffix Rakete");
  assert.equal(search.matches.length, 3, "at most three candidates are returned");
  assert.ok(search.matches.every((match) => match.matchedTerms.includes("rakete")));
  assert.ok(search.matches.every((match) => match.episode.id !== english.id), "German compounds do not match English rocket by translation");
  assert.ok(search.instruction.includes("possible saved entry") || search.instruction.includes("Several lexical candidates"));
  assert.equal(harness.state().companion.episodes.find((episode) => episode.id === gerda.id).lastUsedAt, null,
    "a search candidate does not reserve a legacy gesture");
  assert.deepEqual(companionStateSnapshot(harness.state()), beforeSearch,
    "candidate search changes no episode, activity, game, scene, or object-reference state");

  const uniqueLexicalQuestion = "Weißt du noch den Spiegelglanz?";
  await harness.turn(uniqueLexicalQuestion);
  const ambiguous = harness.action({ type: "search_experiences", query: "Spiegelglanz" });
  assert.equal(ambiguous.status, "candidates_found");
  assert.equal(ambiguous.totalMatches, 2);
  assert.deepEqual(new Set(ambiguous.matches.map((match) => match.episode.title)), new Set(["Gerda", "Komet"]));
  assert.ok(ambiguous.instruction.includes("Gerda") && ambiguous.instruction.includes("Komet"),
    "multiple candidates are named in the instruction and neither is silently selected");
  assert.deepEqual(ambiguous.matches.find((match) => match.episode.id === gerda.id).matchedTerms, ["spiegelglanz"]);

  const fullGerda = ambiguous.matches.find((match) => match.episode.id === gerda.id).episode;
  assert.equal(fullGerda.detail, gerda.detail);
  assert.ok(fullGerda.detail.length > 70 && fullGerda.detail.includes("dreimal") && fullGerda.detail.includes("stumpfe Nase"),
    "the candidate contains the full confirmed detail, including facts beyond the compact context preview");
  assert.equal(fullGerda.outcome, gerda.outcome);
  assert.ok(fullGerda.outcome.length > 60 && fullGerda.outcome.includes("ersten Wurf") && fullGerda.outcome.includes("Zaun"),
    "the candidate contains the full confirmed outcome tail");
  assert.deepEqual(fullGerda.source, gerda.source, "candidate provenance is copied with the complete source quote");

  // Returned facts are caller-owned copies, not aliases into the companion.
  fullGerda.detail = "caller mutation";
  fullGerda.source.evidence = "caller mutation";
  ambiguous.matches.find((match) => match.episode.id === gerda.id).matchedTerms.push("invented");
  await harness.turn(uniqueLexicalQuestion);
  const copiedAgain = harness.action({ type: "search_experiences", query: "Spiegelglanz" });
  const freshGerda = copiedAgain.matches.find((match) => match.episode.id === gerda.id);
  assert.equal(freshGerda.episode.detail, gerda.detail);
  assert.equal(freshGerda.episode.source.evidence, gerda.source.evidence);
  assert.deepEqual(freshGerda.matchedTerms, ["spiegelglanz"]);

  const fillerQuery = "Weißt du noch unsere?";
  await harness.turn(fillerQuery);
  const fillerResult = harness.action({ type: "search_experiences", query: fillerQuery });
  assert.equal(fillerResult.status, "no_candidates", "common query fillers alone are not treated as identifying terms");
  assert.equal(fillerResult.totalMatches, 0);
  assert.deepEqual(fillerResult.matches, []);

  const unrelated = "Erzähl mir vom Kühlschrank.";
  await harness.turn(unrelated);
  const unrelatedResult = harness.action({ type: "search_experiences", query: unrelated });
  assert.equal(unrelatedResult.status, "no_candidates");
  assert.equal(unrelatedResult.totalMatches, 0);

  const englishQuery = "Do you remember our paper rocket?";
  await harness.turn(englishQuery);
  const englishResult = harness.action({ type: "search_experiences", query: englishQuery });
  assert.equal(englishResult.status, "candidates_found");
  assert.deepEqual(englishResult.matches.map((match) => match.episode.id), [english.id]);
  assert.deepEqual(englishResult.matches[0].matchedTerms, ["paper", "rocket"]);

  // Quoted or negated text is allowed as literal search data, but it still
  // creates only candidates and leaves all mutation/ritual state untouched.
  const quotedQuestion = "Ich sage nicht, dass «unsere Rakete» wirklich geflogen ist.";
  await harness.turn(quotedQuestion);
  const beforeQuotedSearch = companionStateSnapshot(harness.state());
  const quotedResult = harness.action({ type: "search_experiences", query: "«unsere Rakete»" });
  assert.equal(quotedResult.status, "candidates_found");
  assert.deepEqual(companionStateSnapshot(harness.state()), beforeQuotedSearch);

  // Candidate IDs do not relax the existing exact saved-title recall gate.
  await harness.turn(naturalQuestion);
  const exactGate = harness.action({ type: "recall_experience", id: gerda.id });
  assert.equal(exactGate.status, "reference_not_named");
  assert.equal(Object.hasOwn(exactGate, "episode"), false);
  assert.equal(Object.hasOwn(exactGate, "matches"), false);
  const currentContext = JSON.parse(harness.runtime.events.getBehaviorConversationContext(harness.sessionId));
  assert.deepEqual(currentContext.companion.episodes, [],
    "the legacy prompt preview does not silently change to suffix matching");

  // A public explicit forget flow removes a candidate from later searches.
  await harness.turn("Bitte vergiss Komet.");
  const forget = harness.action({ type: "forget_experience", id: komet.id });
  assert.equal(forget.status, "forget_pending");
  harness.publish({ type: "assistant-end", text: "Soll ich den Eintrag Komet vergessen?" });
  await flush();
  await harness.turn("Ja.");
  assert.equal(harness.state().companion.episodes.some((episode) => episode.id === komet.id), false);
  const afterDeleteTurn = "Weißt du noch den Spiegelglanz?";
  await harness.turn(afterDeleteTurn);
  const afterDelete = harness.action({ type: "search_experiences", query: "Spiegelglanz" });
  assert.equal(afterDelete.matches.some((match) => match.episode.id === komet.id), false,
    "deleted confirmed episodes no longer appear as candidates");
} finally {
  harness.close();
}

// Search does not clear or manufacture the private, short-lived motif leases.
// Exercise them through the companion's public turn/action/end API without a
// runtime or physical effect.
let clock = 10_000;
const companion = createBehaviorCompanion({ now: () => clock });
const ritualSession = "episode-search-ritual";
function directAct(action, userText) {
  return companion.act(action, { userText, sessionId: ritualSession });
}
const seedText = "Wir haben Gerda zusammen gebaut.";
companion.userTurn(seedText);
assert.equal(directAct({
  type: "propose_experience", title: "Gerda", detail: "Unsere Papierrakete hatte silberne Flügel.",
  outcome: "Sie landete am Zaun.", motif: "nod", evidence: seedText,
}, seedText).status, "proposed");
companion.assistantEnd("Soll ich Gerda speichern?");
companion.userTurn("Ja.");
const ritualEpisode = companion.snapshot().episodes[0];
const ritualText = "Für Gerda bitte nicken und Mission Rakete sagen.";
companion.userTurn(ritualText);
const ritualProposal = directAct({
  type: "set_episode_ritual", id: ritualEpisode.id, mode: "active", motif: "nod",
  phrase: "Mission Rakete", evidence: ritualText,
}, ritualText);
assert.equal(ritualProposal.status, "personal_ritual_pending");
companion.assistantEnd(ritualProposal.confirmationQuestion);
companion.userTurn("Ja.");
clock += 1;
const recallText = "Tell me about Gerda?";
companion.userTurn(recallText);
assert.equal(directAct({ type: "recall_experience", id: ritualEpisode.id }, recallText).status, "personal_ritual_offered");
const beforeRitualSearch = companion.snapshot();
const ritualSearch = directAct({ type: "search_experiences", query: "Gerda" }, recallText);
assert.equal(ritualSearch.status, "candidates_found");
assert.deepEqual(companion.snapshot(), beforeRitualSearch,
  "search leaves lastOfferedAt, lastUsedAt, and saved preferences unchanged");
assert.deepEqual(companion.assistantEnd("Our phrase is Mission Rakete."), { ritualMotif: "nod" },
  "the one-shot personal-ritual speech lease remains intact across a search action");
assert.equal(companion.reserveMotif("nod"), true, "the heard ritual remains eligible for its normal local cue reservation");

// The direct public companion action does not create or discard a legacy motif
// candidate; an explicit positive report still reserves it in the usual flow.
const legacyCompanion = createBehaviorCompanion({ now: () => clock });
legacyCompanion.userTurn(seedText);
legacyCompanion.act({
  type: "propose_experience", title: "Gerda", detail: "Unsere Papierrakete flog.",
  outcome: "Sie landete am Zaun.", motif: "happy_bob", evidence: seedText,
}, { userText: seedText, sessionId: ritualSession });
legacyCompanion.assistantEnd("Soll ich Gerda speichern?");
legacyCompanion.userTurn("Ja.");
const positive = "Gerda, it worked!";
assert.equal(legacyCompanion.userTurn(positive).motif, "happy_bob");
const legacySnapshot = legacyCompanion.snapshot();
assert.equal(legacyCompanion.act({ type: "search_experiences", query: "Gerda" }, { userText: positive, sessionId: ritualSession }).status, "candidates_found");
assert.deepEqual(legacyCompanion.snapshot(), legacySnapshot);
assert.equal(legacyCompanion.reserveMotif("happy_bob"), true,
  "search preserves a separately earned legacy positive-report cue candidate");

// Invalid evidence, malformed queries, and stale turns have distinct outcomes.
const validation = createBehaviorCompanion({ now: () => clock });
const actValidation = (query, userText = "Weißt du noch unsere Rakete?") => validation.act(
  (validation.userTurn(userText), { type: "search_experiences", query }),
  { userText, sessionId: ritualSession },
);
assert.equal(actValidation("rakete").status, "missing_evidence", "query must be a literal substring with original case");
assert.equal(actValidation(" Rakete").status, "invalid_action", "queries are not trimmed or repaired");
assert.equal(actValidation(`Ko\tmet`, `Ko\tmet`).status, "invalid_action", "control characters are rejected even in a literal excerpt");
assert.equal(actValidation("x".repeat(241), "x".repeat(241)).status, "invalid_action", "queries are bounded to 240 characters");
assert.equal(actValidation("").status, "invalid_action");
validation.userTurn("Current turn with another word.");
const stale = validation.act({ type: "search_experiences", query: "Rakete" }, { userText: "An older turn with Rakete", sessionId: ritualSession });
assert.equal(stale.status, "stale-turn", "the public companion rejects search work from a non-current turn");

console.log("Shared episode search: PASS (offline lexical candidates, full confirmed facts, strict separation from identity/recall and all mutation or ritual leases)");
