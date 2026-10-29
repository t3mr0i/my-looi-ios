import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createGameFaceFeedbackTracker } = loadTypeScript("src/behavior/game-face-feedback.ts");

const game = (overrides = {}) => ({ round: 1, status: "active", lastOutcome: "waiting", ...overrides });
const input = (overrides = {}) => ({
  sessionId: "session-a",
  generation: 4,
  turnId: 2,
  phase: "speaking",
  phaseAt: 1_000,
  game: game(),
  ...overrides,
});

function observeEdge(start, end, now = end.phaseAt) {
  const tracker = createGameFaceFeedbackTracker();
  assert.equal(tracker.observe(start, start.phaseAt), null, "the speaking phase only establishes a baseline");
  return { tracker, feedback: tracker.observe(end, now) };
}

// Expectancy appears once after a heard active-game answer, regardless of the
// last incorrect guess. It does not expose which direction the guess took.
for (const lastOutcome of ["waiting", "too_low", "too_high"]) {
  const { tracker, feedback } = observeEdge(
    input({ phase: "speaking", phaseAt: 1_000, game: game({ lastOutcome }) }),
    input({ phase: "reacting", phaseAt: 1_300, generation: 5, game: game({ lastOutcome }) }),
  );
  assert.deepEqual(feedback, {
    id: feedback?.id,
    kind: "game",
    mood: "expectant",
    generation: 5,
    expiresAt: 16_300,
  });
  assert.ok(feedback.id.length > 0);
  assert.equal(tracker.observe(input({ phase: "reacting", phaseAt: 1_300, generation: 5, game: game({ lastOutcome }) }), 1_301), null,
    "repeated polls of the same phase do not replay the expectation");
  assert.equal(tracker.observe(input({ phase: "settled", phaseAt: 16_000, generation: 5, game: game({ lastOutcome }) }), 16_000), null,
    "the tracker emits events; it does not replay one when the face settles");
}

// The end-of-answer phase edge, rather than the speaking or waiting phase,
// owns all face feedback.
{
  const tracker = createGameFaceFeedbackTracker();
  assert.equal(tracker.observe(input({ phase: "reacting" }), 1_100), null, "no prior speaking phase means no heard-answer edge");
  assert.equal(tracker.observe(input({ phase: "reflecting", phaseAt: 1_200 }), 1_200), null);
  assert.equal(tracker.observe(input({ phase: "speaking", phaseAt: 1_300 }), 1_300), null, "no expression is emitted before the answer ends");
  assert.equal(tracker.observe(input({ phase: "attending", phaseAt: 1_400 }), 1_400), null, "an interrupted answer does not produce a reaction");
}

// A live game can acknowledge that it ended without revealing a loss or
// pretending a paused/stopped/expired session is ready for another guess.
for (const status of ["paused", "stopped", "expired"]) {
  const inactive = game({ status, lastOutcome: status === "stopped" ? "stopped" : "too_low" });
  const { feedback } = observeEdge(
    input({ phase: "speaking", game: inactive }),
    input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: inactive }),
  );
  assert.equal(feedback, null, `${status} never produces an expectant expression`);
}
assert.equal(observeEdge(input({ game: null }), input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: null })).feedback, null,
  "a non-game assistant answer is not presented as a guessing-game beat");
assert.equal(observeEdge(
  input({ phase: "speaking", game: game({ status: "won", lastOutcome: "too_low" }) }),
  input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: game({ status: "won", lastOutcome: "too_low" }) }),
).feedback, null, "a won status without the local correct outcome cannot create a victory");

// A local winning result stays neutral until the corresponding spoken answer
// actually reaches its end. The game state is copied at each observation.
{
  const tracker = createGameFaceFeedbackTracker();
  const wonGame = game({ status: "won", lastOutcome: "correct" });
  assert.equal(tracker.observe(input({ phase: "reflecting", game: wonGame }), 1_000), null, "a correct guess alone is not a victory display");
  assert.equal(tracker.observe(input({ phase: "speaking", generation: 5, phaseAt: 1_200, game: wonGame }), 1_200), null,
    "hearing the start alone is not a victory display");
  const victory = tracker.observe(input({ phase: "reacting", generation: 6, phaseAt: 1_500, game: wonGame }), 1_500);
  assert.deepEqual(victory, {
    id: victory.id,
    kind: "game",
    mood: "victory",
    generation: 6,
    expiresAt: 2_600,
  });
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 6, phaseAt: 1_500, game: wonGame }), 1_600), null,
    "duplicate state polls do not repeat the victory beat");

  // Even a separate heard answer in the same round cannot replay a win.
  tracker.observe(input({ phase: "speaking", generation: 7, phaseAt: 1_700, game: wonGame }), 1_700);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 8, phaseAt: 1_800, game: wonGame }), 1_800), null,
    "a winning round emits exactly once");

  // A later answer in the same round after the user speaks again cannot
  // reclaim the victory that belonged to the interrupted turn.
  tracker.reset();
  tracker.observe(input({ phase: "speaking", turnId: 3, generation: 9, phaseAt: 2_000, game: wonGame }), 2_000);
  assert.equal(tracker.observe(input({ phase: "reacting", turnId: 3, generation: 10, phaseAt: 2_100, game: wonGame }), 2_100), null,
    "the winning result remains owned by the turn that first observed it");
}

// The successful response must belong to the same turn and round that were
// already won while the assistant was speaking. A changed turn/round cannot
// inherit a stale celebration.
for (const changed of [
  { turnId: 3 },
  { game: game({ round: 2, status: "won", lastOutcome: "correct" }) },
]) {
  const wonGame = game({ status: "won", lastOutcome: "correct" });
  const { feedback } = observeEdge(
    input({ phase: "speaking", game: wonGame }),
    input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: wonGame, ...changed }),
  );
  assert.equal(feedback, null, "a late answer from a different turn or round cannot claim this win");
}

// Session changes establish a fresh baseline. Generation may advance across
// assistant-start/assistant-end invalidations, but a stale backward update is
// discarded without changing the current speaking baseline.
{
  const tracker = createGameFaceFeedbackTracker();
  tracker.observe(input({ phase: "speaking", generation: 8, phaseAt: 1_000 }), 1_000);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 7, phaseAt: 1_300 }), 1_300), null,
    "a backward lifecycle generation is stale");
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 10, phaseAt: 1_400 }), 1_400)?.mood, "expectant",
    "a normal generation advance still permits the actual end edge");

  assert.equal(tracker.observe(input({ phase: "reacting", sessionId: "session-b", generation: 1, phaseAt: 2_000 }), 2_000), null,
    "a different session cannot inherit a pending speaking phase");
  tracker.observe(input({ phase: "speaking", sessionId: "session-b", generation: 1, phaseAt: 2_100 }), 2_100);
  assert.equal(tracker.observe(input({ phase: "reacting", sessionId: "session-b", generation: 2, phaseAt: 2_200 }), 2_200)?.mood, "expectant",
    "a new session can use its own assistant-end edge");
}

// The deadline is anchored to phaseAt, so delayed delivery and repeated polls
// cannot extend an old expression.
{
  const { feedback } = observeEdge(
    input({ phase: "speaking", phaseAt: 1_000 }),
    input({ phase: "reacting", generation: 5, phaseAt: 1_300 }),
    4_000,
  );
  assert.equal(feedback.expiresAt, 16_300, "expectancy has at most fifteen seconds from its end phase");
}
{
  const { feedback } = observeEdge(
    input({ phase: "speaking", phaseAt: 1_000 }),
    input({ phase: "reacting", generation: 5, phaseAt: 1_300 }),
    16_300,
  );
  assert.equal(feedback, null, "an already expired expectation is never shown late");
}
{
  const { feedback } = observeEdge(
    input({ phase: "speaking", phaseAt: 1_000, game: game({ status: "won", lastOutcome: "correct" }) }),
    input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: game({ status: "won", lastOutcome: "correct" }) }),
    2_400,
  );
  assert.equal(feedback, null, "an already expired victory beat is never shown late");
}

// The engine mutates the existing game object in place. Keeping copied
// primitives prevents a result that changed after output began from being
// attributed to that earlier spoken answer or recovered by a later poll.
{
  const tracker = createGameFaceFeedbackTracker();
  const mutableGame = game();
  tracker.observe(input({ phase: "speaking", game: mutableGame }), 1_000);
  mutableGame.status = "won";
  mutableGame.lastOutcome = "correct";
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: mutableGame }), 1_300), null,
    "an in-place result change after assistant-start is not celebrated as the spoken result");
  tracker.observe(input({ phase: "speaking", generation: 6, phaseAt: 1_500, game: mutableGame }), 1_500);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 7, phaseAt: 1_600, game: mutableGame }), 1_600), null,
    "a result that appeared after its answer began cannot be celebrated by a later same-turn answer");
}

// reset() drops an in-flight phase pair. Its per-session round guard survives
// runtime resets so STOP, sleep, settings, or a new speech start cannot replay
// a victory already emitted in that round.
{
  const tracker = createGameFaceFeedbackTracker();
  const wonGame = game({ status: "won", lastOutcome: "correct" });
  tracker.observe(input({ phase: "speaking", game: wonGame }), 1_000);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 5, phaseAt: 1_300, game: wonGame }), 1_300)?.mood, "victory");
  tracker.reset();
  tracker.observe(input({ phase: "speaking", generation: 7, phaseAt: 1_700, game: wonGame }), 1_700);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 8, phaseAt: 1_800, game: wonGame }), 1_800), null,
    "reset clears edges but keeps exactly-once protection for the current session round");

  // The engine clears game state when behavior learning is reset, then starts
  // the next local game at round 1 in the same session.
  tracker.reset();
  assert.equal(tracker.observe(input({ phase: "settled", turnId: 3, generation: 9, phaseAt: 1_900, game: null }), 1_900), null);
  const restartedRoundOne = game({ status: "won", lastOutcome: "correct" });
  tracker.observe(input({ phase: "speaking", turnId: 4, generation: 10, phaseAt: 2_000, game: restartedRoundOne }), 2_000);
  assert.equal(tracker.observe(input({ phase: "reacting", turnId: 4, generation: 11, phaseAt: 2_100, game: restartedRoundOne }), 2_100)?.mood, "victory",
    "an observed null-game reset permits a same-numbered round in the same session");

  const nextRound = game({ round: 2, status: "won", lastOutcome: "correct" });
  tracker.observe(input({ phase: "speaking", turnId: 5, generation: 12, phaseAt: 2_300, game: nextRound }), 2_300);
  assert.equal(tracker.observe(input({ phase: "reacting", turnId: 5, generation: 13, phaseAt: 2_400, game: nextRound }), 2_400)?.mood, "victory",
    "the next round can produce its own result");
}

// STOP also retires a pending result, even before the first success beat.
{
  const tracker = createGameFaceFeedbackTracker();
  const wonGame = game({ status: "won", lastOutcome: "correct" });
  tracker.observe(input({ phase: "speaking", game: wonGame }), 1_000);
  tracker.reset();
  tracker.observe(input({ phase: "speaking", generation: 6, phaseAt: 1_500, game: wonGame }), 1_500);
  assert.equal(tracker.observe(input({ phase: "reacting", generation: 7, phaseAt: 1_600, game: wonGame }), 1_600), null,
    "STOP consumes an unplayed win, not just an already displayed one");
}

console.log("Game face feedback: heard phase edges, bounded turns, local result and once-per-round victory PASS");
