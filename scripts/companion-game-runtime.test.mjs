import assert from "node:assert/strict";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => { for (let i = 0; i < 32; i += 1) await Promise.resolve(); };

for (const initiallyPaused of [false, true]) {
  const fixture = createCompanionLiveRuntime();
  const sessionId = `offline-game-kws-${initiallyPaused}`;
  const publish = (event) => fixture.events.publishBehaviorEvent({ ...event, sessionId });
  try {
    fixture.events.beginBehaviorSession(sessionId, () => {});
    publish({ type: "game-command", action: "start" });
    assert.equal(fixture.behaviorEngine.getState().game.status, "active");
    if (initiallyPaused) publish({ type: "user-turn", text: "Warte kurz." });
    const before = fixture.behaviorEngine.getState().game;
    assert.equal(before.status, initiallyPaused ? "paused" : "active");

    // This is the exact runtime state notification produced by the local KWS
    // emergency path. The native recognizer and robot are replaced; the
    // production runtime subscriber and engine process the notification.
    fixture.setRobotRuntimeState({ stopGeneration: 1, safety: { lastSafetyStopReason: "voice-emergency-kws" } });
    const after = fixture.behaviorEngine.getState().game;
    assert.equal(after.status, "stopped", "runtime stopGeneration forwards local KWS STOP into the actual engine");
    assert.equal(after.lastOutcome, "stopped");
    assert.equal(after.secretAnswer, before.secretAnswer);
    assert.equal(after.attemptsLeft, before.attemptsLeft, "STOP consumes no guess");
    assert.equal(after.round, before.round);
    publish({ type: "user-turn", text: "Ich bin wieder da." });
    publish({ type: "user-turn", text: "2" });
    await flush();
    assert.equal(fixture.behaviorEngine.getState().game.status, "stopped", "a later return or number cannot revive a stopped game");
    assert.equal(fixture.behaviorEngine.getState().game.attemptsLeft, before.attemptsLeft);
    assert.equal(fixture.events.requiresBehaviorTurnCommit(sessionId), false, "the stopped game releases its manual response gate");
  } finally {
    fixture.events.endBehaviorSession(sessionId);
    fixture.uninstallRuntime();
    fixture.behaviorEngine.dispose();
  }
}

{
  const fixture = createCompanionLiveRuntime();
  const sessionId = "offline-game-motion";
  const publish = (event) => fixture.events.publishBehaviorEvent({ ...event, sessionId });
  try {
    fixture.events.beginBehaviorSession(sessionId, () => {});
    publish({ type: "game-command", action: "start" });
    const before = fixture.behaviorEngine.getState().game;
    fixture.setRobotRuntimeState({ motionActive: true });
    assert.equal(fixture.behaviorEngine.getState().game.status, "paused", "the runtime parks a round when robot motion begins");
    publish({ type: "user-turn", text: "Ich bin wieder da." });
    publish({ type: "user-turn", text: "2" });
    assert.equal(fixture.behaviorEngine.getState().game.status, "paused");
    assert.equal(fixture.behaviorEngine.getState().game.attemptsLeft, before.attemptsLeft);
    fixture.setRobotRuntimeState({ motionActive: false });
    assert.equal(fixture.behaviorEngine.getState().game.status, "paused", "motion ending does not silently resume the round");
    publish({ type: "user-turn", text: "Ich bin wieder da." });
    assert.equal(fixture.behaviorEngine.getState().game.status, "active");
    assert.equal(fixture.behaviorEngine.getState().game.secretAnswer, before.secretAnswer);
    assert.equal(fixture.behaviorEngine.getState().game.attemptsLeft, before.attemptsLeft);
    await flush();
  } finally {
    fixture.events.endBehaviorSession(sessionId);
    fixture.uninstallRuntime();
    fixture.behaviorEngine.dispose();
  }
}

console.log("Companion game runtime: actual robot-state subscription parks motion and forwards local KWS STOP for active/paused rounds PASS (native recognition and hardware replaced)");
