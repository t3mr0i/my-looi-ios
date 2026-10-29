import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

function makeClock() {
  let monotonic = 1_000;
  let wall = Date.UTC(2026, 0, 1);
  let nextTimerId = 0;
  const timers = new Map();
  const setTimeoutFake = (callback, delay = 0) => {
    const id = ++nextTimerId;
    timers.set(id, { at: monotonic + Math.max(0, Number(delay) || 0), callback });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  function runDueTimers() {
    let guard = 0;
    while (guard++ < 500) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= monotonic).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      next[1].callback();
    }
    assert.ok(guard < 500, "fake timers settled");
  }
  return {
    now: () => monotonic,
    wall: () => wall,
    advance(ms) { monotonic += ms; wall += ms; },
    runDueTimers,
    setTimeoutFake,
    clearTimeoutFake,
  };
}

const flush = async () => { for (let index = 0; index < 24; index += 1) await Promise.resolve(); };
const policy = loadTypeScript("src/behavior/behavior-policy.ts");
const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
const sharedActivity = loadTypeScript("src/behavior/shared-activity.ts");
function decisionFor(request, overrides = {}) {
  const answers = request.questions.map((question) => {
    if (question.type === "score") return {
      name: question.name, type: "score", score: 0, confidence: 1,
      probabilities: question.levels.map((level, value) => ({ value, label: level.label, probability: value === 0 ? 1 : 0 })),
    };
    const choices = question.choices.map((item) => item.value);
    const preferred = question.name === "cue" ? "hold" : question.name === "attention" ? "keep_target" : question.name === "intention" ? overrides.intention ?? "wait" : question.name === "visual" ? "use_view" : "none";
    const choice = choices.includes(preferred) ? preferred : choices[0];
    return { name: question.name, type: "choice", choice, confidence: 1, probabilities: choices.map((value) => ({ value, probability: value === choice ? 1 : 0 })) };
  });
  return Promise.resolve({ answers, usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-game-pause" });
}

function makeEngine() {
  const clock = makeClock();
  const decisionContexts = [];
  const effects = [];
  let intentionChoice = "wait";
  const engineModule = loadTypeScript("src/behavior/behavior-engine.ts", {
    "./behavior-policy": policy,
    "./behavior-companion": companion,
    "./shared-activity": sharedActivity,
  }, { setTimeout: clock.setTimeoutFake, clearTimeout: clock.clearTimeoutFake });
  const engine = engineModule.createBehaviorEngine({
    now: clock.now,
    wallNow: clock.wall,
    decide: (request) => { decisionContexts.push(request.context); return decisionFor(request, { intention: intentionChoice }); },
    executeCue: (cue) => effects.push(cue),
  });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: true });
  engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false });
  engine.dispatch({ type: "session-start", sessionId: "game-pause-session" });
  return {
    engine, clock, decisionContexts, effects,
    setIntentionChoice(choice) { intentionChoice = choice; },
    turn(text) { engine.dispatch({ type: "user-turn", text, sessionId: engine.getState().sessionId }); },
    startGame() { engine.dispatch({ type: "game-command", action: "start", sessionId: engine.getState().sessionId }); },
    close() { engine.dispose(); },
  };
}

async function seedEpisode(h) {
  const evidence = "Wir haben Gerda gemeinsam gebaut";
  h.turn(`${evidence}.`);
  const proposed = h.engine.companionAction({
    type: "propose_experience", title: "Gerda", detail: "Ein roter Papierflieger",
    outcome: "Wir haben den Flügel gemeinsam gefaltet", motif: "curious", evidence,
  });
  assert.equal(proposed.status, "proposed");
  h.engine.dispatch({ type: "assistant-end", text: "Sollen wir Gerda als gemeinsame Erfahrung speichern?", sessionId: h.engine.getState().sessionId });
  h.turn("Ja.");
  await flush();
  const episode = h.engine.getState().companion.episodes.find((item) => item.title === "Gerda");
  assert.ok(episode, "the saved episode comes from the public confirmation flow");
  return episode.id;
}

async function seedActivityMilestone(h, episodeId) {
  const beginEvidence = "Lass uns mit Gerda ein gemeinsames Bastelprojekt starten";
  h.turn(`${beginEvidence}.`);
  const begin = h.engine.companionAction({ type: "manage_shared_activity", operation: "begin", id: episodeId, evidence: beginEvidence });
  assert.equal(begin.status, "pending_confirmation");
  h.engine.dispatch({ type: "assistant-end", text: begin.confirmationQuestion, sessionId: h.engine.getState().sessionId });
  h.turn("Ja.");

  const checkedEvidence = "Die Pappe liegt bereit";
  h.turn(`${checkedEvidence}.`);
  const checked = h.engine.companionAction({
    type: "manage_shared_activity", operation: "confirm_step", id: episodeId,
    step: "checked", detail: checkedEvidence, evidence: checkedEvidence,
  });
  assert.equal(checked.status, "pending_confirmation");
  h.engine.dispatch({ type: "assistant-end", text: checked.confirmationQuestion, sessionId: h.engine.getState().sessionId });
  h.turn("Ja.");
  return structuredClone(h.engine.getState().pendingIntention);
}


// Regression: a pause during a game belongs to the game and cannot create a
// task from the last conversational topic.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.turn("Erzähl mir etwas über den Weltraum.");
    h.turn("2");
    h.turn("Warte kurz.");
    const state = h.engine.getState();
    assert.equal(state.game.status, "paused");
    assert.equal(state.pendingIntention, null);
    assert.equal(state.game.secretAnswer, 1);
    assert.equal(state.game.attemptsLeft, 2);
    assert.equal(state.game.round, 1);
    assert.equal(state.game.lastOutcome, "too_high");

    const paused = structuredClone(state.game);
    h.clock.advance(10_000);
    h.turn("2");
    assert.deepEqual(h.engine.getState().game, paused, "a bare number neither resumes the game nor consumes an attempt");
    h.turn("Heute ist ein schöner Tag.");
    assert.deepEqual(h.engine.getState().game, paused, "unrelated chatter does not refresh or change a paused game");
    h.turn("Warte kurz.");
    assert.deepEqual(h.engine.getState().game, paused, "repeating pause preserves the original idle deadline");
  } finally { h.close(); }
}

// An already-pending ordinary task survives a game pause unchanged; returning
// to the paused game does not resume that competing task.
{
  const h = makeEngine();
  try {
    h.engine.dispatch({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet", sessionId: "game-pause-session" });
    const taskBefore = structuredClone(h.engine.getState().pendingIntention);
    h.startGame();
    h.turn("Warte kurz.");
    assert.deepEqual(h.engine.getState().pendingIntention, taskBefore, "pausing the game preserves the existing task");
    assert.match(JSON.parse(h.engine.getConversationContext()).pendingTask.instruction, /number game has current focus/u);
    h.clock.advance(250);
    h.turn("Ich bin wieder da.");
    assert.equal(h.engine.getState().game.status, "active");
    assert.deepEqual(h.engine.getState().pendingIntention, taskBefore, "explicit game resume does not resume or modify the task");

  } finally { h.close(); }
}

// Confirmed shared-activity milestones remain intact across game focus, pause,
// resume, and a game-only close.
{
  const h = makeEngine();
  try {
    const episodeId = await seedEpisode(h);
    const taskWithMilestone = await seedActivityMilestone(h, episodeId);
    assert.deepEqual(taskWithMilestone.activity.confirmed.map((item) => item.step), ["checked"], "the shared milestone is confirmed before the game starts");
    h.startGame();
    const parkedTask = structuredClone(h.engine.getState().pendingIntention);
    assert.equal(parkedTask.status, "paused");
    assert.deepEqual(parkedTask.activity.confirmed.map((item) => item.step), ["checked"]);
    h.turn("Warte kurz.");
    assert.deepEqual(h.engine.getState().pendingIntention, parkedTask, "game pause preserves task identity and milestones");
    h.turn("Ich bin wieder da.");
    assert.deepEqual(h.engine.getState().pendingIntention, parkedTask, "game resume preserves the separate shared task");
    h.turn("Lass gut sein.");
    assert.deepEqual(h.engine.getState().pendingIntention, parkedTask, "game-only close preserves the separate shared task");
  } finally { h.close(); }
}

// A focused ongoing game blocks every action on an existing shared activity,
// including resume and cancel. Stopping the game restores the named resume flow.
for (const status of ["active", "paused"]) {
  const h = makeEngine();
  try {
    const episodeId = await seedEpisode(h);
    await seedActivityMilestone(h, episodeId);
    h.startGame();
    if (status === "paused") h.turn("Warte kurz.");

    const resumeEvidence = "Gerda, lass uns beim Bastelprojekt weitermachen";
    h.turn(`${resumeEvidence}.`);
    const beforeResumeAttempt = structuredClone(h.engine.getState().pendingIntention);
    const blockedResume = h.engine.companionAction({ type: "manage_shared_activity", operation: "resume", id: episodeId, evidence: resumeEvidence });
    assert.equal(blockedResume.status, "activity_conflict", `${status} game blocks shared-activity resume`);
    assert.deepEqual(h.engine.getState().pendingIntention, beforeResumeAttempt, "blocked resume leaves the task and confirmed milestone unchanged");

    const cancelEvidence = "Gerda, beende das gemeinsame Bastelprojekt";
    h.turn(`${cancelEvidence}.`);
    const beforeCancelAttempt = structuredClone(h.engine.getState().pendingIntention);
    const blockedCancel = h.engine.companionAction({ type: "manage_shared_activity", operation: "cancel", id: episodeId, evidence: cancelEvidence });
    assert.equal(blockedCancel.status, "activity_conflict", `${status} game blocks shared-activity cancel`);
    assert.deepEqual(h.engine.getState().pendingIntention, beforeCancelAttempt, "blocked cancel leaves the task and milestone unchanged");

    h.turn("Beende das Spiel.");
    assert.equal(h.engine.getState().game.status, "stopped");
    h.turn(`${resumeEvidence}.`);
    const allowedResume = h.engine.companionAction({ type: "manage_shared_activity", operation: "resume", id: episodeId, evidence: resumeEvidence });
    assert.equal(allowedResume.status, "pending_confirmation", "the named task can be resumed again after the game is stopped");
  } finally { h.close(); }
}

// The typed intention event remains a task-specific contract; only interpreted
// conversational pause/return phrases control the number game.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.engine.dispatch({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet", sessionId: "game-pause-session" });
    assert.equal(h.engine.getState().game.status, "active");
    assert.equal(h.engine.getState().pendingIntention.goal, "Papierflieger bauen");
    h.engine.dispatch({ type: "intention", action: "resume", sessionId: "game-pause-session" });
    assert.equal(h.engine.getState().game.status, "active");
    assert.equal(h.engine.getState().pendingIntention.status, "active");
  } finally { h.close(); }
}

// An asynchronous Decisions suggestion cannot mutate a retained ordinary task
// while an ongoing game owns the current focus.
{
  const h = makeEngine();
  try {
    h.engine.dispatch({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet", sessionId: "game-pause-session" });
    const taskBefore = structuredClone(h.engine.getState().pendingIntention);
    h.startGame();
    h.turn("Warte kurz.");
    await flush();
    assert.match(h.decisionContexts.at(-1).interactionFocus, /Keep a separate pending task unchanged/u);
    h.setIntentionChoice("offer_resume");
    h.turn("How are you today?");
    h.clock.advance(1_000);
    h.clock.runDueTimers();
    await flush();
    assert.deepEqual(h.engine.getState().pendingIntention, taskBefore, "a delayed Decisions offer cannot alter the parked task during the game");
  } finally { h.close(); }
}

// Only an explicit stop ends a paused game. Further numbers and return phrases
// cannot restart or consume it.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.turn("Warte kurz.");
    h.turn("Beende das Spiel.");
    const stopped = structuredClone(h.engine.getState().game);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.lastOutcome, "stopped");
    h.turn("Ich bin wieder da.");
    h.turn("2");
    assert.equal(h.engine.getState().game.status, "stopped");
    assert.equal(h.engine.getState().game.attemptsLeft, stopped.attemptsLeft);
  } finally { h.close(); }
}

// A bare close phrase during a game closes the current game only; a separately
// paused task remains available, while task-specific drop still works.
{
  const h = makeEngine();
  try {
    h.engine.dispatch({ type: "intention", action: "pause", goal: "Papierflieger bauen", lastConfirmedStep: "Flügel gefaltet", sessionId: "game-pause-session" });
    const taskBefore = structuredClone(h.engine.getState().pendingIntention);
    h.startGame();
    h.turn("Warte kurz.");
    h.turn("Lass gut sein.");
    assert.equal(h.engine.getState().game.status, "stopped");
    assert.deepEqual(h.engine.getState().pendingIntention, taskBefore, "bare close does not drop a task beside the focused game");
    h.turn("Vergiss die Aufgabe.");
    assert.equal(h.engine.getState().pendingIntention, null, "a task-specific drop still clears that task");
  } finally { h.close(); }
}

// The five-minute deadline is measured from the last real game action. Both
// active and paused games expire just after the existing five-minute boundary.
{
  const paused = makeEngine();
  try {
    paused.startGame();
    paused.turn("Warte kurz.");
    const pausedAt = paused.engine.getState().game.updatedAt;
    let expiryEmits = 0;
    paused.engine.subscribe((state) => { if (state.game?.status === "expired") expiryEmits += 1; });
    paused.clock.advance(300_000);
    paused.engine.tick();
    assert.equal(paused.engine.getState().game.status, "paused", "the exact five-minute boundary is still valid");
    assert.equal(paused.engine.getState().game.updatedAt, pausedAt);
    paused.clock.advance(1);
    paused.engine.tick();
    assert.equal(paused.engine.getState().game.status, "expired");
    assert.equal(expiryEmits, 1, "expiry notifies subscribers once");
    paused.engine.tick();
    assert.equal(expiryEmits, 1, "unchanged expired state does not emit repeatedly");
    paused.turn("Ich bin wieder da.");
    assert.equal(paused.engine.getState().game.status, "expired", "return after expiry cannot revive the game");
  } finally { paused.close(); }

  const active = makeEngine();
  try {
    active.startGame();
    active.clock.advance(300_001);
    active.engine.tick();
    assert.equal(active.engine.getState().game.status, "expired", "an active game keeps its existing idle expiry");
  } finally { active.close(); }
}

// Foreground, focus, sleep, robot disconnect and configuration changes park
// an active game. Returning to a safe environment never resumes it implicitly.
for (const [label, park, restore] of [
  ["background", (h) => h.engine.setEnvironment({ foreground: false }), (h) => h.engine.setEnvironment({ foreground: true })],
  ["focus loss", (h) => h.engine.setEnvironment({ focused: false }), (h) => h.engine.setEnvironment({ focused: true })],
  ["sleep", (h) => h.engine.setEnvironment({ sleeping: true }), (h) => h.engine.setEnvironment({ sleeping: false })],
  ["disconnect", (h) => h.engine.setEnvironment({ connected: false }), (h) => h.engine.setEnvironment({ connected: true })],
  ["configuration", (h) => h.engine.configure({ mode: "shadow", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: true }), (h) => h.engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: true })],
  ["off mode", (h) => h.engine.configure({ mode: "off", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: true }), (h) => h.engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: true, curiosityEnabled: true })],
]) {
  const h = makeEngine();
  try {
    h.startGame();
    park(h);
    assert.equal(h.engine.getState().game.status, "paused", `${label} parks the game`);
    restore(h);
    assert.equal(h.engine.getState().game.status, "paused", `${label} return does not resume the game`);
  } finally { h.close(); }
}

// Active robot movement parks the number game. Numbers and return phrases are
// inert while movement is active; becoming safe still requires an explicit return.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.engine.setEnvironment({ motionActive: true });
    assert.equal(h.engine.getState().game.status, "paused");
    const parked = structuredClone(h.engine.getState().game);
    h.turn("1");
    assert.deepEqual(h.engine.getState().game, parked, "a number during motion neither consumes an attempt nor resumes the game");
    h.turn("Ich bin wieder da.");
    assert.deepEqual(h.engine.getState().game, parked, "a return phrase during motion cannot resume the game");
    h.engine.setEnvironment({ motionActive: false });
    assert.deepEqual(h.engine.getState().game, parked, "movement ending does not auto-resume the game");
    h.turn("1");
    assert.deepEqual(h.engine.getState().game, parked, "a number after movement still cannot implicitly resume the game");
    h.turn("Ich bin wieder da.");
    assert.equal(h.engine.getState().game.status, "active", "an explicit return resumes after the environment is safe");
    assert.equal(h.engine.getState().game.attemptsLeft, parked.attemptsLeft);
  } finally { h.close(); }
}

// Speech edges and the WebRTC manual-turn callback are not lifecycle pauses.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.engine.dispatch({ type: "user-speech-start", sessionId: "game-pause-session" });
    assert.equal(h.engine.getState().game.status, "active");
    h.engine.dispatch({ type: "user-speech-end", sessionId: "game-pause-session" });
    h.engine.dispatch({ type: "interrupt", reason: "local-manual-turn", sessionId: "game-pause-session" });
    assert.equal(h.engine.getState().game.status, "active", "a committed manual game turn does not pause itself");
    h.engine.setEnvironment({ userSpeaking: true });
    assert.equal(h.engine.getState().game.status, "active", "a normal user-speaking environment edge does not pause a game");
    h.engine.setEnvironment({ userSpeaking: false });
    assert.equal(h.engine.getState().game.status, "active");
  } finally { h.close(); }
}

// Safety interrupts close either active or paused games. New sessions never
// inherit the previous session's game.
for (const reason of ["STOP", "voice-emergency-kws", "cliff", "sleep", "disconnect"]) {
  for (const paused of [false, true]) {
    const h = makeEngine();
    try {
      h.startGame();
      if (paused) h.turn("Warte kurz.");
      h.engine.dispatch({ type: "interrupt", reason, sessionId: "game-pause-session" });
      assert.equal(h.engine.getState().game.status, "stopped", `${reason} closes a ${paused ? "paused" : "active"} game`);
    } finally { h.close(); }
  }
}
{
  const h = makeEngine();
  try {
    h.startGame();
    h.engine.dispatch({ type: "session-start", sessionId: "next-session" });
    assert.equal(h.engine.getState().game, null, "a new session clears the old game");
    h.startGame();
    h.engine.dispatch({ type: "session-end", sessionId: "next-session" });
    assert.equal(h.engine.getState().game, null, "session end clears the game");
  } finally { h.close(); }
}
{
  const h = makeEngine();
  try {
    h.startGame();
    h.engine.dispatch({ type: "user-turn", text: "Warte kurz.", sessionId: "foreign-session" });
    h.engine.dispatch({ type: "game-command", action: "stop", sessionId: "foreign-session" });
    h.engine.dispatch({ type: "session-end", sessionId: "foreign-session" });
    assert.equal(h.engine.getState().sessionId, "game-pause-session");
    assert.equal(h.engine.getState().game.status, "active", "events from another session cannot pause or stop this game");
  } finally { h.close(); }
}

// Ongoing games block new shared activities, curiosity, shared rituals and
// start signals while keeping existing episode data available.
for (const status of ["active", "paused"]) {
  const h = makeEngine();
  try {
    const episodeId = await seedEpisode(h);
    h.startGame();
    if (status === "paused") h.turn("Warte kurz.");
    h.turn("Was machen wir heute?");
    const blockedBegin = h.engine.companionAction({ type: "manage_shared_activity", operation: "begin", id: episodeId, evidence: "Lass uns Gerda weiterbauen" });
    assert.equal(blockedBegin.status, "activity_conflict", `${status} game blocks a new shared activity`);
    const blockedInterest = h.engine.companionAction({ type: "offer_interest", topic: "Weltraum", question: "Was ist dein Lieblingsplanet?" });
    assert.equal(blockedInterest.status, "visual_not_authorized", `${status} game blocks proactive curiosity`);
    const blockedRitual = h.engine.companionAction({ type: "prepare_shared_ritual", id: episodeId, signal: "voice", evidence: "Ich warte bei Gerda, bis du sagst: Start" });
    assert.equal(blockedRitual.status, "invalid_action", `${status} game blocks a shared start ritual`);
    assert.equal(h.engine.acceptStartSignal("voice"), false, `${status} game rejects start acceptance`);
    assert.ok(h.engine.getState().companion.episodes.some((item) => item.id === episodeId), "conflicts preserve saved episodes");
  } finally { h.close(); }
}

// Paused instructions are safe in both conversation and decision contexts;
// the local secret remains private and is intentionally not persisted.
{
  const h = makeEngine();
  try {
    h.startGame();
    h.turn("Warte kurz.");
    await flush();
    const conversation = JSON.parse(h.engine.getConversationContext());
    assert.equal(conversation.numberGame.status, "paused");
    assert.match(conversation.numberGame.instruction, /do not invite or process a guess/u);
    const decision = h.decisionContexts.at(-1);
    assert.equal(decision.game.status, "paused");
    assert.match(decision.game.instruction, /do not invite or process a guess/u);
    assert.equal(JSON.stringify(conversation).includes("secretAnswer"), false);
    assert.equal(JSON.stringify(decision).includes("secretAnswer"), false);
    assert.equal(JSON.stringify(JSON.parse(h.engine.serialize())).includes("secretAnswer"), false);
  } finally { h.close(); }
}

console.log("Companion game pause/resume tests: PASS");
