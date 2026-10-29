import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const load = createTypeScriptTreeLoader();
const { createBehaviorCompanion } = load(path.resolve("src/behavior/behavior-companion.ts"));
const flush = async () => { for (let index = 0; index < 32; index += 1) await Promise.resolve(); };

function createHarness() {
  const runtime = createCompanionLiveRuntime();
  const sessionId = "companion-memory-capacity";
  runtime.events.beginBehaviorSession(sessionId, () => {});
  const publish = (event) => runtime.events.publishBehaviorEvent({ ...event, sessionId });
  const action = (value) => runtime.events.performBehaviorCompanionAction(value, sessionId);
  const state = () => runtime.behaviorEngine.getState();
  async function turn(text) {
    publish({ type: "user-turn", text });
    await flush();
  }
  async function save({ title, source, detail, outcome }) {
    await turn(source);
    const proposal = action({ type: "propose_experience", title, detail, outcome, motif: "hold", evidence: source });
    assert.equal(proposal.status, "proposed", `${title} is proposed through the public action bridge`);
    publish({ type: "assistant-end", text: `Soll ich ${title} als gemeinsame Erinnerung speichern?` });
    await flush();
    await turn("Ja.");
    const episode = state().companion.episodes.find((item) => item.title === title);
    assert.ok(episode, `${title} is saved only after the affirmative next turn`);
    return episode;
  }
  function close() {
    runtime.events.endBehaviorSession(sessionId);
    runtime.uninstallRuntime();
    runtime.behaviorEngine.dispose();
  }
  return { runtime, sessionId, publish, action, state, turn, save, close };
}

function memorySnapshot(state) {
  return JSON.parse(JSON.stringify(state.companion));
}

const harness = createHarness();
try {
  const firstEight = [];
  for (let index = 1; index <= 8; index += 1) {
    const title = `Episode ${index}`;
    const special = index === 1 ? "Mondstein" : `Sternstaub${index}`;
    firstEight.push(await harness.save({
      title,
      detail: `Wir fanden ${special} im stillen Garten.`,
      outcome: `Der Fund ${special} leuchtete im Abendlicht.`,
      source: `${title}: Wir fanden ${special} im stillen Garten.`,
    }));
  }

  const atCapacity = harness.state();
  assert.equal(atCapacity.companion.episodes.length, 8);
  assert.deepEqual(atCapacity.companion.episodes.map((episode) => episode.title), firstEight.map((episode) => episode.title));

  // The actual public runtime bridge must reject a new, valid experience without
  // opening a confirmation or changing any saved entry.
  const ninthTitle = "Episode 9";
  const ninthSource = `${ninthTitle}: Wir fanden den Silberkompass im stillen Garten.`;
  await harness.turn(ninthSource);
  const beforeFullProposal = memorySnapshot(harness.state());
  const fullProposal = harness.action({
    type: "propose_experience",
    title: ninthTitle,
    detail: "Wir fanden den Silberkompass im stillen Garten.",
    outcome: "Die Nadel zeigte nach Norden.",
    motif: "hold",
    evidence: ninthSource,
  });
  assert.equal(fullProposal.ok, false);
  assert.equal(fullProposal.status, "memory_full");
  assert.deepEqual(fullProposal.capacity, { used: 8, limit: 8 });
  assert.deepEqual(memorySnapshot(harness.state()), beforeFullProposal);
  assert.equal(harness.state().companion.pendingExperience, null, "a rejected proposal never creates a confirmation");

  harness.publish({ type: "assistant-end", text: `Soll ich ${ninthTitle} speichern?` });
  await flush();
  await harness.turn("Ja.");
  assert.deepEqual(harness.state().companion.episodes.map((episode) => episode.id), firstEight.map((episode) => episode.id),
    "a later generic affirmative cannot evict or save anything");

  // Existing entries remain searchable and exactly recallable at capacity.
  const recallTurn = "Erinnerst du dich an Episode 1?";
  await harness.turn(recallTurn);
  const recalled = harness.action({ type: "recall_experience", id: firstEight[0].id });
  assert.equal(recalled.status, "recalled");
  assert.equal(recalled.episode.title, "Episode 1");

  const searchTurn = "Kannst du den Mondstein noch finden?";
  await harness.turn(searchTurn);
  const search = harness.action({ type: "search_experiences", query: "Mondstein" });
  assert.equal(search.status, "candidates_found");
  assert.ok(search.matches.some((match) => match.episode.id === firstEight[0].id));

  // A same-title proposal still points to the existing entry before capacity is
  // considered; malformed provenance and stale source turns retain their gates.
  const duplicateTurn = "Episode 2 war unser kleiner Fund.";
  await harness.turn(duplicateTurn);
  const duplicate = harness.action({
    type: "propose_experience", title: "Episode 2", detail: "Noch ein Fund.", outcome: "Er war blau.",
    motif: "hold", evidence: duplicateTurn,
  });
  assert.equal(duplicate.status, "title_exists");
  assert.equal(duplicate.episodeId, firstEight[1].id);
  const invalid = harness.action({
    type: "propose_experience", title: "Episode 10", detail: "Ein neuer Fund.", outcome: "Er war rot.",
    motif: "hold", evidence: "not in the current user turn",
  });
  assert.equal(invalid.status, "missing_evidence");
  assert.equal(harness.state().companion.pendingExperience, null);
  const staleSource = "Episode 2 was our little find.";
  const staleCompanion = createBehaviorCompanion();
  staleCompanion.userTurn(staleSource);
  staleCompanion.userTurn("A newer turn makes the earlier source stale.");
  assert.equal(staleCompanion.act({
    type: "propose_experience", title: "Episode 10", detail: "Ein neuer Fund.", outcome: "Er war rot.",
    motif: "hold", evidence: duplicateTurn,
  }, { userText: staleSource, sessionId: "stale-capacity" }).status, "stale-turn");

  // The existing explicit forget confirmation flow releases exactly one slot.
  await harness.turn("Bitte vergiss Episode 1.");
  const forget = harness.action({ type: "forget_experience", id: firstEight[0].id });
  assert.equal(forget.status, "forget_pending");
  harness.publish({ type: "assistant-end", text: "Soll ich Episode 1 vergessen?" });
  await flush();
  await harness.turn("Ja.");
  assert.equal(harness.state().companion.episodes.some((episode) => episode.id === firstEight[0].id), false);
  assert.equal(harness.state().companion.episodes.length, 7);

  const ninth = await harness.save({
    title: ninthTitle,
    detail: "Wir fanden den Silberkompass im stillen Garten.",
    outcome: "Die Nadel zeigte nach Norden.",
    source: ninthSource,
  });
  assert.equal(harness.state().companion.episodes.length, 8);
  assert.ok(harness.state().companion.episodes.some((episode) => episode.id === ninth.id));
  assert.ok(harness.state().companion.episodes.every((episode) => episode.id !== firstEight[0].id));

  // Restoring a full confirmed snapshot keeps all eight entries and remains full.
  const restored = createBehaviorCompanion();
  restored.restore({ version: 1, episodes: harness.state().companion.episodes });
  assert.deepEqual(restored.snapshot().episodes.map((episode) => episode.title), harness.state().companion.episodes.map((episode) => episode.title));
  const restoredTurn = "Episode 10 happened in the garden.";
  restored.userTurn(restoredTurn);
  const restoredFull = restored.act({
    type: "propose_experience", title: "Episode 10", detail: "Ein weiterer Fund.", outcome: "Er war grün.",
    motif: "hold", evidence: restoredTurn,
  }, { userText: restoredTurn, sessionId: "restored-capacity" });
  assert.equal(restoredFull.status, "memory_full");
  assert.equal(restored.snapshot().pendingExperience, null);
  assert.deepEqual(restored.snapshot().episodes.map((episode) => episode.title), harness.state().companion.episodes.map((episode) => episode.title));
} finally {
  harness.close();
}

console.log("Companion memory capacity without silent eviction: PASS");
