import assert from "node:assert/strict";
import { companionLiveCases } from "./companion-live-cases.mjs";
import { availableCompanionLiveSuites, getCompanionLiveSuite } from "./companion-live-suites.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

assert.deepEqual(availableCompanionLiveSuites, ["baseline", "continuity", "personality"]);
assert.deepEqual(getCompanionLiveSuite(), { id: "baseline", cases: companionLiveCases });
assert.equal(getCompanionLiveSuite("baseline").cases, companionLiveCases, "the baseline still uses the original six case objects");
assert.equal(companionLiveCases.length, 6);
const continuitySuite = getCompanionLiveSuite("continuity");
const anotherContinuitySuite = getCompanionLiveSuite("continuity");
assert.notEqual(continuitySuite.cases, anotherContinuitySuite.cases, "each resolution gets fresh setup closures");
assert.deepEqual(continuitySuite.cases.map((item) => item.id), [
  "de-continuity-overview-three-experiences",
  "de-continuity-correction-confirmed-recall",
  "de-continuity-game-pause-return",
]);
assert.throws(
  () => getCompanionLiveSuite("unknown"),
  { message: 'Unknown companion live suite "unknown". Available suites: baseline, continuity, personality.' },
);

let fixtureRun = 0;

function snapshot(engine) {
  const state = engine.getState();
  const pending = state.companion?.pendingExperience;
  return {
    game: state.game ? {
      status: state.game.status,
      attemptsLeft: state.game.attemptsLeft,
      round: state.game.round,
      lastOutcome: state.game.lastOutcome,
    } : null,
    pendingIntention: state.pendingIntention ?? null,
    companion: {
      episodes: state.companion.episodes.map((episode) => ({
        id: episode.id,
        title: episode.title,
        detail: episode.detail,
        outcome: episode.outcome,
        motif: episode.motif,
        source: episode.source,
        corrections: episode.corrections ?? {},
      })),
      pendingConfirmation: pending ? {
        kind: pending.kind,
        episodeId: pending.episodeId ?? null,
        field: pending.field ?? null,
        replacement: pending.replacement ?? null,
        previousValue: pending.previousValue ?? null,
        question: pending.question ?? null,
        askedAt: pending.askedAt,
      } : null,
    },
  };
}

async function withLocalSetup(testCase, run) {
  const runtime = createCompanionLiveRuntime();
  const sessionId = `suite-fixture-${testCase.id}-${++fixtureRun}`;
  const { events, behaviorEngine: engine, uninstallRuntime } = runtime;
  events.beginBehaviorSession(sessionId, () => {});
  const setup = {
    events,
    sessionId,
    engine,
    publishEvent: (event) => events.publishBehaviorEvent({ ...event, sessionId }),
    performAction: (action) => events.performBehaviorCompanionAction(action, sessionId),
  };
  try {
    await testCase.setup?.(setup);
    return await run({ ...setup, secureSnapshot: snapshot(engine) });
  } finally {
    events.endBehaviorSession(sessionId);
    engine.dispose();
    uninstallRuntime();
  }
}

const [overview, correction, game] = continuitySuite.cases;
await withLocalSetup(overview, async ({ engine, secureSnapshot }) => {
  assert.equal(engine.getState().companion.episodes.length, 3, "overview setup confirms three distinct episodes via public actions");
  assert.equal(overview.expected.state(secureSnapshot), true);
  assert.deepEqual(secureSnapshot.companion.episodes.map((item) => item.title), ["Gerda", "Möwe", "Basilikum"]);
});

await withLocalSetup(correction, async ({ engine, publishEvent, performAction, secureSnapshot }) => {
  const gerda = engine.getState().companion.episodes.find((episode) => episode.title === "Gerda");
  assert.ok(gerda, "correction setup confirms Gerda through public actions");
  assert.equal(gerda.motif, "hold");
  const first = correction.turns[0];
  publishEvent({ type: "user-turn", text: first.userText });
  const proposal = performAction({
    type: "correct_experience",
    id: gerda.id,
    field: "outcome",
    replacement: "Sie landete neben dem Baum.",
    evidence: first.userText,
  });
  assert.equal(proposal.status, "correction_pending");
  publishEvent({ type: "assistant-end", text: proposal.confirmationQuestion });
  assert.equal(first.expected.state(snapshot(engine)), true, "only the exact spoken question leaves a matching, asked correction pending");

  publishEvent({ type: "user-turn", text: correction.turns[1].userText });
  assert.equal(correction.turns[1].expected.state(snapshot(engine)), true, "yes updates one field and retains creation and correction provenance");

  publishEvent({ type: "user-turn", text: correction.turns[2].userText });
  const recall = performAction({ type: "recall_experience", id: gerda.id });
  assert.equal(recall.status, "recalled");
  assert.equal(correction.turns[2].expected.state(snapshot(engine)), true, "exact-title recall uses the corrected fact on the same entry");
});

async function makePendingCorrection(testCase) {
  return withLocalSetup(testCase, async ({ engine, publishEvent, performAction }) => {
    const episode = engine.getState().companion.episodes.find((item) => item.title === "Gerda");
    assert.ok(episode);
    publishEvent({ type: "user-turn", text: testCase.turns[0].userText });
    const proposal = performAction({
      type: "correct_experience",
      id: episode.id,
      field: "outcome",
      replacement: "Sie landete neben dem Baum.",
      evidence: testCase.turns[0].userText,
    });
    assert.equal(proposal.status, "correction_pending");
    publishEvent({ type: "assistant-end", text: proposal.confirmationQuestion });
    return { id: episode.id, snapshot: structuredClone(snapshot(engine)) };
  });
}

const correctionA = continuitySuite.cases[1];
const correctionB = anotherContinuitySuite.cases[1];
const pendingA = await makePendingCorrection(correctionA);
const pendingB = await makePendingCorrection(correctionB);
assert.notEqual(pendingA.id, pendingB.id, "separate local sessions produce independent episode identities");
assert.equal(correctionA.turns[0].expected.state(pendingA.snapshot), true);
assert.equal(correctionB.turns[0].expected.state(pendingB.snapshot), true);
assert.equal(correctionA.turns[0].expected.state(pendingB.snapshot), false,
  "a second suite setup cannot overwrite the first suite's expected episode ID");

await withLocalSetup(game, async ({ engine, publishEvent, secureSnapshot }) => {
  assert.equal("secretAnswer" in secureSnapshot.game, false, "the secure fixture view contains no answer");
  for (const turn of game.turns) {
    publishEvent({ type: "user-turn", text: turn.userText });
    assert.equal(turn.expected.state(snapshot(engine)), true, `${turn.id} preserves the intended game state`);
  }
});

console.log("Companion live suites: named registry and synthetic public-bridge continuity fixtures PASS (offline setup only; no live model evidence).");
