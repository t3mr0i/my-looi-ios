import assert from "node:assert/strict";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
};

function makeHarness(name) {
  const runtime = createCompanionLiveRuntime();
  const sessionId = `conversation-boundaries-${name}`;
  runtime.events.beginBehaviorSession(sessionId, () => {});
  return {
    runtime,
    sessionId,
    async publish(event) {
      runtime.events.publishBehaviorEvent({ ...event, sessionId });
      await flush();
    },
    action(action) {
      return runtime.events.performBehaviorCompanionAction(action, sessionId);
    },
    close() {
      runtime.events.endBehaviorSession(sessionId);
      runtime.uninstallRuntime();
      runtime.behaviorEngine.dispose();
    },
  };
}

// A direct preference changes the live Realtime context, and the person can
// change it back without modifying voice, safety, or unrelated saved learning.
{
  const h = makeHarness("personality");
  try {
    await h.publish({ type: "user-turn", text: "Sei lebendiger." });
    let context = JSON.parse(h.runtime.events.getBehaviorConversationContext(h.sessionId));
    assert.match(context.conversationStyle, /livelier/u);
    let session = h.runtime.config.buildRealtimeSessionUpdate(h.runtime.preferences, undefined, undefined, JSON.stringify(context), false).session;
    assert.match(session.instructions, /livelier, more playful manner/u, "the actual Realtime session receives the explicit preference");
    await h.publish({ type: "user-turn", text: "Sei ruhiger." });
    context = JSON.parse(h.runtime.events.getBehaviorConversationContext(h.sessionId));
    assert.match(context.conversationStyle, /calmer/u);
    session = h.runtime.config.buildRealtimeSessionUpdate(h.runtime.preferences, undefined, undefined, JSON.stringify(context), false).session;
    assert.match(session.instructions, /prefers a calmer manner/u);
    await h.publish({ type: "user-turn", text: "Sei wieder normal." });
    assert.equal(JSON.parse(h.runtime.events.getBehaviorConversationContext(h.sessionId)).conversationStyle, undefined);
  } finally { h.close(); }
}

// A task-specific drop leaves the number game alone. The bounded conversational
// close then stops it, so later numbers no longer consume attempts.
{
  const h = makeHarness("game");
  try {
    await h.publish({ type: "game-command", action: "start" });
    assert.equal(h.runtime.behaviorEngine.getState().game.status, "active");

    await h.publish({ type: "user-turn", text: "Vergiss die Aufgabe." });
    assert.equal(h.runtime.behaviorEngine.getState().game.status, "active", "a task-specific drop must not stop the game");

    await h.publish({ type: "user-turn", text: "2" });
    const beforeClose = h.runtime.behaviorEngine.getState().game;
    assert.equal(beforeClose.attemptsLeft, 2, "the active game consumes a valid bare guess");

    await h.publish({ type: "user-turn", text: "Lass gut sein!" });
    const stopped = h.runtime.behaviorEngine.getState().game;
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.lastOutcome, "stopped");
    assert.equal(stopped.attemptsLeft, beforeClose.attemptsLeft);
    const closedContext = JSON.parse(h.runtime.events.getBehaviorConversationContext(h.sessionId)).numberGame;
    assert.equal(closedContext.status, "stopped");
    assert.match(closedContext.instruction, /Do not invite another guess or restart/u,
      "the reply context marks this as a closed game, rather than asking for another guess");

    await h.publish({ type: "user-turn", text: "2" });
    assert.equal(h.runtime.behaviorEngine.getState().game.attemptsLeft, beforeClose.attemptsLeft,
      "a later bare number cannot consume attempts after the game is stopped");
  } finally {
    h.close();
  }
}

// Closing an ordinary intention clears it; an explicit later pause preserves
// it, and returning offers a confirmation before resuming that same intention.
{
  const h = makeHarness("ordinary-task");
  try {
    await h.publish({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet" });
    assert.equal(h.runtime.behaviorEngine.getState().pendingIntention.goal, "Papierflieger bauen");
    await h.publish({ type: "user-turn", text: "Lass gut sein." });
    assert.equal(h.runtime.behaviorEngine.getState().pendingIntention, null, "closing clears the ordinary pending intention");

    await h.publish({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet" });
    const beforePause = h.runtime.behaviorEngine.getState().pendingIntention;
    await h.publish({ type: "user-turn", text: "Lass uns später weitermachen." });
    let pending = h.runtime.behaviorEngine.getState().pendingIntention;
    assert.equal(pending.status, "paused");
    assert.equal(pending.id, beforePause.id);
    assert.equal(pending.lastConfirmedStep, "Flügel gefaltet");

    await h.publish({ type: "user-turn", text: "später" });
    assert.equal(h.runtime.behaviorEngine.getState().pendingIntention.status, "paused", "bare 'später' stays ambiguous");

    await h.publish({ type: "user-turn", text: "Ich bin wieder da!" });
    pending = h.runtime.behaviorEngine.getState().pendingIntention;
    assert.equal(pending.status, "paused", "return alone only offers to continue");
    assert.equal(h.runtime.events.requiresBehaviorTurnCommit(h.sessionId), true, "the answer waits for a committed transcript");
    await h.publish({ type: "assistant-end", text: "Schön, dass du wieder da bist. Sollen wir weitermachen?" });
    await h.publish({ type: "user-turn", text: "Ja, bitte." });
    pending = h.runtime.behaviorEngine.getState().pendingIntention;
    assert.equal(pending.status, "active");
    assert.equal(h.runtime.events.requiresBehaviorTurnCommit(h.sessionId), false);
    assert.equal(pending.waitingFor, "user_reply");
    assert.equal(pending.id, beforePause.id, "return resumes the same intention");
    assert.equal(pending.goal, "Papierflieger bauen");
    assert.equal(pending.lastConfirmedStep, "Flügel gefaltet");

    await h.publish({ type: "user-turn", text: "Lass gut sein, wir machen später weiter." });
    pending = h.runtime.behaviorEngine.getState().pendingIntention;
    assert.equal(pending.status, "paused", "the explicit later-continuation clause pauses an active task instead of discarding it");
    assert.equal(pending.id, beforePause.id);
    assert.equal(pending.lastConfirmedStep, "Flügel gefaltet");
    await h.publish({ type: "user-turn", text: "Ich bin wieder da." });
    await h.publish({ type: "assistant-end", text: "Schön, dass du wieder da bist. Sollen wir weitermachen?" });
    await h.publish({ type: "user-turn", text: "Ja." });
    assert.equal(h.runtime.behaviorEngine.getState().pendingIntention.status, "active");
  } finally {
    h.close();
  }
}

// Without a task or game, a close utterance must not invent a target.
{
  const h = makeHarness("no-target");
  try {
    await h.publish({ type: "user-turn", text: "Lass gut sein." });
    const state = h.runtime.behaviorEngine.getState();
    assert.equal(state.pendingIntention, null);
    assert.equal(state.game, null);
  } finally {
    h.close();
  }
}

// Shared activities use their existing named proposal and heard-confirmation
// gate. Returning to the conversation alone does not restart one.
{
  const h = makeHarness("shared-activity");
  const { behaviorEngine: engine } = h.runtime;
  const userTurn = (text) => h.publish({ type: "user-turn", text });
  const assistantEnd = (text) => h.publish({ type: "assistant-end", text });

  async function confirmEpisode() {
    const evidence = "Wir haben Gerda gemeinsam gebaut";
    await userTurn(`${evidence}.`);
    const proposal = h.action({
      type: "propose_experience",
      title: "Gerda",
      detail: "Eine Papierrakete",
      outcome: "Wir haben gemeinsam den Flügel gefaltet",
      motif: "curious",
      evidence,
    });
    assert.equal(proposal.status, "proposed");
    const confirmationQuestion = "Sollen wir Gerda als gemeinsame Erfahrung speichern?";
    await assistantEnd(confirmationQuestion);
    await userTurn("Ja.");
    const episode = engine.getState().companion.episodes.find((item) => item.title === "Gerda");
    assert.ok(episode, "the shared activity uses a previously confirmed episode");
    return episode;
  }

  try {
    const episode = await confirmEpisode();

    const beginEvidence = "Lass uns mit Gerda ein gemeinsames Bastelprojekt starten";
    await userTurn(`${beginEvidence}.`);
    const begin = h.action({ type: "manage_shared_activity", operation: "begin", id: episode.id, evidence: beginEvidence });
    assert.equal(begin.status, "pending_confirmation");
    await assistantEnd(begin.confirmationQuestion);
    await userTurn("Ja.");
    assert.equal(engine.getState().pendingIntention.status, "active");

    const checkedEvidence = "Die Pappe liegt bereit";
    await userTurn(`${checkedEvidence}.`);
    const checked = h.action({
      type: "manage_shared_activity", operation: "confirm_step", id: episode.id,
      step: "checked", detail: checkedEvidence, evidence: checkedEvidence,
    });
    assert.equal(checked.status, "pending_confirmation");
    await assistantEnd(checked.confirmationQuestion);
    await userTurn("Ja.");
    assert.equal(engine.getState().pendingIntention.lastConfirmedStep, checkedEvidence);
    assert.equal(engine.getState().pendingIntention.activity.phase, "preparing");

    await userTurn("Lass uns später weitermachen.");
    let pending = engine.getState().pendingIntention;
    assert.equal(pending.status, "paused");
    assert.equal(pending.lastConfirmedStep, checkedEvidence);
    assert.equal(pending.activity.pending, null);
    assert.equal(pending.activity.phase, "preparing");

    await userTurn("Ich bin wieder da.");
    pending = engine.getState().pendingIntention;
    assert.equal(pending.status, "paused", "the ordinary return phrase cannot resume a shared activity");
    assert.equal(pending.activity.pending, null);

    const resumeEvidence = "Gerda, lass uns beim Bastelprojekt weitermachen";
    await userTurn(`${resumeEvidence}.`);
    const resume = h.action({ type: "manage_shared_activity", operation: "resume", id: episode.id, evidence: resumeEvidence });
    assert.equal(resume.status, "pending_confirmation", "the current turn names the existing activity before proposing resume");
    pending = engine.getState().pendingIntention;
    assert.equal(pending.status, "paused", "a proposal alone does not resume the task");
    assert.equal(pending.activity.pending.step, "resume");
    assert.equal(pending.lastConfirmedStep, checkedEvidence);

    await assistantEnd(resume.confirmationQuestion);
    assert.equal(engine.getState().pendingIntention.status, "paused", "hearing the exact question alone does not resume the task");
    await userTurn("Ja.");
    pending = engine.getState().pendingIntention;
    assert.equal(pending.status, "active", "the named proposal resumes only after its question was heard and accepted");
    assert.equal(pending.lastConfirmedStep, checkedEvidence);
    assert.equal(pending.activity.phase, "preparing", "resume does not implicitly start the physical activity");
    assert.notEqual(engine.getState().companion.scene.status, "started");
  } finally {
    h.close();
  }
}

console.log("Companion conversation-boundary runtime tests: PASS");
