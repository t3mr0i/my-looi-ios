import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const { createBehaviorCompanion } = createTypeScriptTreeLoader()(
  path.resolve("src/behavior/behavior-companion.ts"),
);

function createHarness(sessionId) {
  let now = 10_000;
  let currentText = "";
  const companion = createBehaviorCompanion({ now: () => now });
  function turn(text, at = now) {
    now = at;
    currentText = text;
    companion.userTurn(text);
    return text;
  }
  function act(action, userText = currentText, sourceSessionId = sessionId) {
    return companion.act(action, { userText, sessionId: sourceSessionId });
  }
  function save({ title, detail, outcome, motif = "hold", at = now + 10 }) {
    now = at;
    const prefix = `We built ${title} together. Evidence: `;
    const evidence = prefix + "x".repeat(239 - prefix.length);
    turn(evidence, at);
    const proposal = act({ type: "propose_experience", title, detail, outcome, motif, evidence });
    assert.equal(proposal.status, "proposed", `${title} is proposed using the public companion action`);
    companion.assistantEnd(`Should I remember ${title}?`);
    turn("Yes.", at);
    const episode = companion.snapshot().episodes.find((item) => item.title === title);
    assert.ok(episode, `${title} is saved only after confirmation`);
    return episode;
  }
  return {
    companion,
    turn,
    act,
    save,
    setNow(value) { now = value; },
    close() { companion.reset(); },
  };
}

function stateSnapshot(companion) {
  return structuredClone(companion.snapshot());
}

// No confirmed episodes means an empty saved collection, never a claim that
// the pair has experienced nothing. A pending draft is not part of that list.
{
  const h = createHarness("episode-overview-empty");
  try {
    const question = "Was haben wir zusammen erlebt?";
    h.turn(question);
    const empty = h.act({ type: "list_experiences" });
    assert.equal(empty.ok, true);
    assert.equal(empty.status, "no_saved_experiences");
    assert.deepEqual(empty.episodes, []);
    assert.equal(empty.total, 0);
    assert.match(empty.instruction, /does not mean nothing was experienced/u);

    const draftText = "We made Comet together and it finally worked.";
    h.turn(draftText);
    assert.equal(h.act({
      type: "propose_experience", title: "Comet", detail: "A paper comet.",
      outcome: "It worked and landed by the fence.", motif: "hold", evidence: draftText,
    }).status, "proposed");
    const beforeSnapshot = stateSnapshot(h.companion);
    const beforeSerialized = structuredClone(h.companion.serialize());
    const beforeContext = structuredClone(h.companion.context(draftText));
    const noConfirmed = h.act({ type: "list_experiences" });
    assert.equal(noConfirmed.status, "no_saved_experiences");
    assert.equal(noConfirmed.total, 0);
    assert.deepEqual(noConfirmed.episodes, []);
    assert.deepEqual(stateSnapshot(h.companion), beforeSnapshot, "listing leaves a pending proposal untouched");
    assert.deepEqual(h.companion.serialize(), beforeSerialized, "listing does not alter persistence");
    assert.deepEqual(h.companion.context(draftText), beforeContext, "listing adds no lasting context fields");

    assert.equal(h.act({ type: "list_experiences" }, "an older user turn").status, "stale-turn",
      "the existing current-text guard applies to the overview action");
    assert.equal(h.act({ type: "list_experiences" }, draftText, "").status, "stale-turn",
      "a session remains required for the overview action");
  } finally { h.close(); }
}

// One entry returns the full corrected fact and both its original and
// correction provenance as defensive copies. An overview does not change the
// subsequent exact-title recall path or consume its ordinary motif lease.
{
  const h = createHarness("episode-overview-one");
  try {
    const saved = h.save({
      title: "Gerda",
      detail: "We made a small paper rocket together.",
      outcome: "It landed by the red fence.",
      motif: "happy_bob",
    });
    const replacement = "We built and repaired a blue paper rocket together on the balcony.";
    const correctionText = `Correction for ${saved.title}: ${replacement}`;
    h.turn(correctionText);
    const correction = h.act({
      type: "correct_experience", id: saved.id, field: "detail", replacement, evidence: correctionText,
    });
    assert.equal(correction.status, "correction_pending");
    h.companion.assistantEnd(correction.confirmationQuestion);
    h.turn("Yes.");
    const corrected = h.companion.snapshot().episodes[0];

    const listQuestion = "Show me our saved experiences.";
    h.turn(listQuestion);
    const beforeSnapshot = stateSnapshot(h.companion);
    const beforeSerialized = structuredClone(h.companion.serialize());
    const beforeContext = structuredClone(h.companion.context(listQuestion));
    const listed = h.act({ type: "list_experiences" });
    assert.equal(listed.ok, true);
    assert.equal(listed.status, "experiences_listed");
    assert.equal(listed.total, 1);
    assert.equal(listed.episodes.length, 1);
    assert.deepEqual(listed.episodes[0], {
      id: corrected.id,
      title: corrected.title,
      detail: replacement,
      outcome: corrected.outcome,
      createdAt: corrected.createdAt,
      source: structuredClone(corrected.source),
      corrections: structuredClone(corrected.corrections),
    });
    assert.equal(listed.episodes[0].createdAt, saved.createdAt,
      "createdAt remains the time the entry was saved, not its event date");
    assert.equal(listed.episodes[0].source.evidence, saved.source.evidence,
      "the original creation source is retained after correction");
    assert.equal(listed.episodes[0].corrections.detail.evidence, correctionText,
      "the corrected fact carries its own confirmation provenance");
    assert.match(listed.instruction, /Never call recall_shared_experience from this overview/u);
    assert.match(listed.instruction, /later current user turn names exactly one saved title/u);
    assert.match(listed.instruction, /does not identify a current object/u);
    assert.match(listed.instruction, /does not identify.*authorize a ritual, tracking, an activity, or deletion/u);
    assert.deepEqual(Object.keys(listed.episodes[0]).sort(),
      ["id", "title", "detail", "outcome", "createdAt", "source", "corrections"].sort(),
      "the overview contains episode facts and provenance, not ritual, visual, or activity authority");

    assert.deepEqual(stateSnapshot(h.companion), beforeSnapshot, "list leaves every snapshot field unchanged");
    assert.deepEqual(h.companion.serialize(), beforeSerialized, "list leaves serialized confirmed episodes unchanged");
    assert.deepEqual(h.companion.context(listQuestion), beforeContext, "list adds no context retention or preview changes");
    assert.equal(h.companion.reserveMotif("happy_bob"), false,
      "a broad list without a prior recall does not create a gesture candidate");

    listed.episodes[0].detail = "caller mutation";
    listed.episodes[0].source.evidence = "caller mutation";
    listed.episodes[0].corrections.detail.evidence = "caller mutation";
    listed.episodes[0].corrections.detail.sessionId = "caller mutation";
    const copiedAgain = h.act({ type: "list_experiences" });
    assert.equal(copiedAgain.episodes[0].detail, replacement);
    assert.equal(copiedAgain.episodes[0].source.evidence, saved.source.evidence);
    assert.equal(copiedAgain.episodes[0].corrections.detail.evidence, correctionText);
    assert.equal(copiedAgain.episodes[0].corrections.detail.sessionId, corrected.corrections.detail.sessionId);

    const laterExactTitleTurn = "Tell me about Gerda.";
    h.turn(laterExactTitleTurn);
    const recalled = h.act({ type: "recall_experience", id: saved.id });
    assert.equal(recalled.status, "recalled", "a later user turn naming the saved title still permits existing recall");
    assert.equal(recalled.episode.detail, replacement);
    const beforeSecondList = stateSnapshot(h.companion);
    const secondList = h.act({ type: "list_experiences" });
    assert.equal(secondList.status, "experiences_listed");
    assert.deepEqual(stateSnapshot(h.companion), beforeSecondList,
      "listing does not reserve or clear the recall-produced gesture candidate");
    assert.equal(h.companion.reserveMotif("happy_bob"), true,
      "the ordinary recall cue can still be reserved after listing");
  } finally { h.close(); }
}

// Eight complete, representative ASCII fact/source payloads are measured.
// createdAt orders newest-first; same-time entries sort by stable ASCII IDs,
// independently of the underlying restore order. The fixture-specific
// threshold is not a global response maximum: it has no Unicode or correction
// provenance, and therefore no pair of correction sources per record.
{
  const h = createHarness("episode-overview-eight");
  try {
    const timestamps = [5_000, 7_000, 6_000, 7_000, 4_000, 7_000, 5_000, 7_000];
    for (let index = 0; index < 8; index += 1) {
      const title = `Episode ${index} ${"T".repeat(70)}`;
      h.save({
        title,
        detail: (`Confirmed detail for ${title}: ` + "d".repeat(240)).slice(0, 220),
        outcome: ("It worked " + "o".repeat(200)).slice(0, 180),
        at: timestamps[index],
      });
    }
    const prompt = "List our saved memories.";
    h.turn(prompt, 8_000);
    const listed = h.act({ type: "list_experiences" });
    assert.equal(listed.status, "experiences_listed");
    assert.equal(listed.total, 8);
    assert.equal(listed.episodes.length, 8, "all saved entries are returned up to the storage limit");
    assert.ok(listed.episodes.every((episode) => episode.detail.length === 220 && episode.outcome.length === 180));
    assert.ok(listed.episodes.every((episode) => episode.source.evidence.length === 239));
    const bytes = Buffer.byteLength(JSON.stringify(listed), "utf8");
    assert.ok(bytes <= 12_000, `the full ASCII fixture remains within its fixture-only 12,000-byte regression threshold (${bytes} bytes)`);
    console.log(`Overview payload fixture: ${bytes} bytes (8 complete ASCII episodes; not a global UTF-8 maximum).`);

    const expectedOrder = [...h.companion.snapshot().episodes]
      .sort((left, right) => right.createdAt - left.createdAt
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((episode) => episode.id);
    assert.deepEqual(listed.episodes.map((episode) => episode.id), expectedOrder,
      "newest save time sorts first, then equal timestamps use stable ID order");
    const sameTime = listed.episodes.filter((episode) => episode.createdAt === 7_000).map((episode) => episode.id);
    assert.deepEqual(sameTime, [...sameTime].sort(), "equal-time IDs use deterministic codepoint order");

    const reorderedStore = structuredClone(h.companion.serialize());
    reorderedStore.episodes.reverse();
    const restored = createBehaviorCompanion({ now: () => 8_000 });
    restored.restore(reorderedStore);
    restored.userTurn(prompt);
    const restoredList = restored.act({ type: "list_experiences" }, { userText: prompt, sessionId: "episode-overview-restored" });
    assert.deepEqual(restoredList.episodes.map((episode) => episode.id), expectedOrder,
      "restore/storage order does not affect the overview order");
    assert.equal(Buffer.byteLength(JSON.stringify(restoredList), "utf8"), bytes,
      "payload size is stable after restoring the same entries in a different order");
  } finally { h.close(); }
}

// Listing leaves a queued, explicitly confirmed personal-ritual speech lease
// available to its existing assistant-end path.
{
  const h = createHarness("episode-overview-ritual");
  try {
    const saved = h.save({
      title: "Komet",
      detail: "We made a paper comet together.",
      outcome: "It worked and landed beside the fence.",
    });
    const ritualText = "For Komet, please nod and say Mission Komet.";
    h.turn(ritualText);
    const proposedRitual = h.act({
      type: "set_episode_ritual", id: saved.id, mode: "active", motif: "nod",
      phrase: "Mission Komet", evidence: ritualText,
    });
    assert.equal(proposedRitual.status, "personal_ritual_pending");
    h.companion.assistantEnd(proposedRitual.confirmationQuestion);
    h.turn("Yes.");

    const broadQuestion = "Show me our saved experiences.";
    h.turn(broadQuestion, 20_000);
    const beforeBroadList = stateSnapshot(h.companion);
    const beforeBroadSerialized = structuredClone(h.companion.serialize());
    const broadList = h.act({ type: "list_experiences" });
    assert.equal(broadList.status, "experiences_listed");
    assert.deepEqual(stateSnapshot(h.companion), beforeBroadList,
      "a broad overview does not update the active ritual preference or create an offer");
    assert.deepEqual(h.companion.serialize(), beforeBroadSerialized);
    assert.equal(h.companion.assistantEnd("Mission Komet")?.ritualMotif, undefined,
      "a broad list does not queue a ritual phrase for assistant-end recognition");
    assert.equal(h.companion.reserveMotif("nod"), false,
      "a broad list cannot authorize or reserve the personal ritual gesture");

    const exactTitle = "Tell me about Komet.";
    h.turn(exactTitle, 20_001);
    const recall = h.act({ type: "recall_experience", id: saved.id });
    assert.equal(recall.status, "personal_ritual_offered");
    const beforeList = stateSnapshot(h.companion);
    const beforeSerialized = structuredClone(h.companion.serialize());
    const listed = h.act({ type: "list_experiences" });
    assert.equal(listed.status, "experiences_listed");
    assert.deepEqual(stateSnapshot(h.companion), beforeList, "list leaves the ritual offer and lastOfferedAt untouched");
    assert.deepEqual(h.companion.serialize(), beforeSerialized);
    assert.equal(h.companion.assistantEnd("We made Komet together: Mission Komet.")?.ritualMotif, "nod",
      "the exact queued phrase remains recognizable after a list action");
    assert.equal(h.companion.reserveMotif("nod"), true,
      "the heard personal ritual can still reserve its normal local cue");
  } finally { h.close(); }
}

console.log("Shared episode overview: PASS (bounded confirmed list, deterministic ordering, corrected provenance, read-only state and existing recall/ritual gates)");
