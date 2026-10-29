import assert from "node:assert/strict";
import path from "node:path";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function makeClock() {
  let now = 1_000;
  let wall = Date.UTC(2026, 0, 1);
  let nextId = 0;
  const timers = new Map();
  const setTimeoutFake = (callback, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  function advance(ms) {
    const target = now + ms;
    let guard = 0;
    while (guard++ < 500) {
      const next = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
    }
    assert.ok(guard < 500, "fake timers settled");
    now = target;
    wall += ms;
  }
  return { now: () => now, wall: () => wall, setWall: (value) => { wall = value; }, advance, setTimeoutFake, clearTimeoutFake };
}

const flush = async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
const clock = makeClock();
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = clock.setTimeoutFake;
globalThis.clearTimeout = clock.clearTimeoutFake;

const loadTypeScript = createTypeScriptTreeLoader();
const { createBehaviorEngine } = loadTypeScript(path.resolve("src/behavior/behavior-engine.ts"));
const sessionId = "shared-activity-engine-test";
let fakeCueInvocations = 0;
let nonHoldCueInvocations = 0;
let forcedIntentionChoice = null;
let forcedIntentionChoiceCount = 0;

function decisionFor(input) {
  const answers = input.questions.map((question) => {
    if (question.type === "score") {
      return {
        name: question.name,
        type: "score",
        score: 0,
        confidence: 1,
        probabilities: question.levels.map((level, value) => ({ value, label: level.label, probability: value === 0 ? 1 : 0 })),
      };
    }
    const values = question.choices.map((choice) => choice.value);
    const preferred = question.name === "intention" && forcedIntentionChoice
      ? forcedIntentionChoice
      : question.name === "cue" ? "hold" : question.name === "visual" ? "use_view" : "none";
    const choice = values.includes(preferred) ? preferred : values[0];
    if (question.name === "intention" && forcedIntentionChoice && choice === forcedIntentionChoice) forcedIntentionChoiceCount += 1;
    return { name: question.name, type: "choice", choice, confidence: 1, probabilities: values.map((value) => ({ value, probability: value === choice ? 1 : 0 })) };
  });
  return Promise.resolve({ answers, usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-shared-activity" });
}

function makeEngine() {
  const engine = createBehaviorEngine({
    now: clock.now,
    wallNow: clock.wall,
    decisionTimeoutMs: 2_000,
    decide: (input) => decisionFor(input),
    // This stub intentionally has no robot transport, so the test cannot emit
    // motion, speech, or any other physical effect.
    executeCue: (cue) => {
      fakeCueInvocations += 1;
      if (cue.gesture !== "hold") nonHoldCueInvocations += 1;
    },
  });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, visualEnabled: true, candidateScoring: true });
  engine.setEnvironment({
    foreground: true, focused: true, sleeping: false, connected: true,
    ambientEnabled: true, cameraEnabled: true, userSpeaking: false,
    assistantSpeaking: false, motionActive: false, responseLanguage: "de",
  });
  engine.dispatch({ type: "session-start", sessionId });
  return engine;
}

async function dispatch(engine, type, fields = {}) {
  clock.advance(1_200);
  engine.dispatch({ type, sessionId, ...fields });
  await flush();
}

async function userTurn(engine, text) { await dispatch(engine, "user-turn", { text }); }
async function assistantEnd(engine, text) { await dispatch(engine, "assistant-end", { text }); }

async function action(engine, value) {
  clock.advance(20);
  const result = engine.companionAction(value);
  await flush();
  return result;
}

async function seedEpisode(engine) {
  const evidence = "Wir haben Gerda gemeinsam gebaut";
  await userTurn(engine, `${evidence}.`);
  const proposed = await action(engine, {
    type: "propose_experience", title: "Gerda", detail: "Ein roter Papierflieger",
    outcome: "Wir haben ihn gemeinsam gebaut", motif: "curious", evidence,
  });
  assert.equal(proposed.status, "proposed");
  await assistantEnd(engine, "Sollen wir Gerda als gemeinsame Erfahrung speichern?");
  await userTurn(engine, "Ja");
  const episode = engine.getState().companion.episodes.find((item) => item.title === "Gerda");
  assert.ok(episode, "the engine confirms the seeded episode only after the heard question and user affirmation");
  return episode;
}

async function beginActivity(engine, episodeId) {
  const evidence = "Lass uns mit Gerda ein gemeinsames Bastelprojekt starten";
  await userTurn(engine, `${evidence}.`);
  const result = await action(engine, { type: "manage_shared_activity", operation: "begin", id: episodeId, evidence });
  assert.equal(result.status, "pending_confirmation");
  let activity = engine.getState().pendingIntention.activity;
  assert.equal(activity.phase, "checking");
  assert.equal(activity.confirmedAt, null, "begin remains unconfirmed until its exact question is heard and accepted");
  assert.equal(activity.pending.step, "begin");
  await assistantEnd(engine, result.confirmationQuestion);
  await userTurn(engine, "Ja");
  activity = engine.getState().pendingIntention.activity;
  assert.equal(activity.confirmedAt, clock.wall());
  assert.equal(activity.pending, null);
  assert.equal(engine.getState().pendingIntention.status, "active");
  return activity;
}

async function confirmMilestone(engine, episodeId, step, text, answer = "Ja") {
  const evidence = text.replace(/[.!?]+$/u, "");
  await userTurn(engine, text);
  const result = await action(engine, {
    type: "manage_shared_activity", operation: "confirm_step", id: episodeId, step,
    detail: evidence, evidence,
  });
  assert.equal(result.status, "pending_confirmation", `${step} is proposed but not saved as fact yet`);
  const beforeAnswer = engine.getState().pendingIntention.activity;
  assert.equal(beforeAnswer.pending.step, step);
  await assistantEnd(engine, result.confirmationQuestion);
  await userTurn(engine, answer);
  return engine.getState().pendingIntention.activity;
}

async function authorizeVisual(engine, taskText) {
  // Let the engine's one-request-per-second local decision spacing elapse.
  clock.advance(1_200);
  const result = await engine.inspectVisual("data:image/jpeg;base64,AA==", taskText, sessionId);
  await flush();
  assert.match(result, /usable/u, "the deterministic offline visual decision authorizes only this requested view");
}

const main = makeEngine();
const seededEpisode = await seedEpisode(main);
const episodeId = seededEpisode.id;
const originalEpisodeFacts = {
  id: seededEpisode.id, title: seededEpisode.title, detail: seededEpisode.detail,
  outcome: seededEpisode.outcome, motif: seededEpisode.motif, source: structuredClone(seededEpisode.source),
  confirmedAt: seededEpisode.confirmedAt, createdAt: seededEpisode.createdAt,
};

await beginActivity(main, episodeId);
let activity = await confirmMilestone(main, episodeId, "checked", "Die Pappe liegt bereit.");
assert.equal(activity.phase, "preparing");
assert.deepEqual(activity.confirmed.map((item) => item.step), ["checked"]);
activity = await confirmMilestone(main, episodeId, "prepared", "Schere und Kleber liegen bereit.");
assert.equal(activity.phase, "waiting_for_start");
assert.deepEqual(activity.confirmed.map((item) => item.step), ["checked", "prepared"]);

// A result report before a fresh matching start is rejected without changing confirmed history.
const tooEarlyText = "Das Ergebnis für Gerda ist: Die Rakete steht stabil.";
await userTurn(main, tooEarlyText);
const tooEarly = await action(main, {
  type: "manage_shared_activity", operation: "report_result", id: episodeId,
  detail: "Die Rakete steht stabil", evidence: "Das Ergebnis für Gerda ist: Die Rakete steht stabil",
});
assert.equal(tooEarly.status, "wrong_phase");
assert.deepEqual(main.getState().pendingIntention.activity.confirmed.map((item) => item.step), ["checked", "prepared"]);

// Use the existing authorized visual-memory and shared-scene path to make a scene ready.
await userTurn(main, "Bitte beschreibe Gerda anhand des Fotos.");
await authorizeVisual(main, "Beschreibe Gerda anhand des ausdrücklich angeforderten Fotos");
const visualMemory = await action(main, {
  type: "propose_visual_memory", id: episodeId, description: "Ein roter Papierflieger mit breiten Flügeln.", evidence: "Bitte beschreibe Gerda",
});
assert.equal(visualMemory.status, "visual_memory_pending");
await assistantEnd(main, visualMemory.confirmationQuestion);
await userTurn(main, "Ja");
assert.equal(main.getState().companion.episodes[0].visualMemory.description, "Ein roter Papierflieger mit breiten Flügeln.");

await userTurn(main, "Vergleiche Gerda bitte mit diesem angeforderten Foto.");
await authorizeVisual(main, "Vergleiche Gerda mit dem ausdrücklich angeforderten Foto");
const comparison = await action(main, {
  type: "compare_shared_object", id: episodeId,
  observedDescription: "Ein roter Papierflieger mit einer eingedrückten Spitze.",
  change: "Die Spitze ist eingedrückt", match: "same",
});
assert.equal(comparison.status, "comparison_pending");
assert.equal(main.getState().companion.scene.status, "awaiting_confirmation");
await assistantEnd(main, comparison.confirmationQuestion);
await userTurn(main, "Ja");
assert.equal(main.getState().companion.scene.status, "ready");

const ritualEvidence = "Ich warte bei Gerda, bis du sagst: Start";
await userTurn(main, `${ritualEvidence}.`);
const ritual = await action(main, { type: "prepare_shared_ritual", id: episodeId, signal: "voice", evidence: ritualEvidence });
assert.equal(ritual.status, "ritual_armed");
assert.equal(main.getState().companion.scene.status, "armed");
assert.equal(main.getState().pendingIntention.activity.phase, "waiting_for_start");
assert.equal(main.getState().pendingIntention.activity.startedAt, null, "arming is not an accepted start");
await userTurn(main, "Start");
activity = main.getState().pendingIntention.activity;
assert.equal(main.getState().companion.scene.status, "started");
assert.equal(activity.phase, "awaiting_result");
assert.equal(activity.startedAt, clock.wall(), "only the existing accepted voice ritual marks a start");

// A restart while awaiting the result restores only confirmed facts and forces a new named confirmation.
const savedWhileAwaitingResult = main.serialize();
const resultEvidence = "Die Rakete für Gerda steht sicher auf der breiten Basis";
await userTurn(main, `${resultEvidence}.`);
const embellishedResult = await action(main, {
  type: "manage_shared_activity", operation: "report_result", id: episodeId,
  detail: "Die Rakete für Gerda steht sicher auf der breiten Basis und trägt drei Bücher",
  evidence: resultEvidence,
});
assert.equal(embellishedResult.status, "detail_not_in_evidence", "a model-added result detail is rejected against the user's exact quote");
assert.equal(main.getState().pendingIntention.activity.pending, null, "rejected invented detail creates no confirmation question");
const result = await action(main, {
  type: "manage_shared_activity", operation: "report_result", id: episodeId,
  detail: resultEvidence, evidence: resultEvidence,
});
assert.equal(result.status, "pending_confirmation");
assert.equal(main.getState().pendingIntention.activity.phase, "awaiting_result");
assert.deepEqual(main.getState().pendingIntention.activity.confirmed.map((item) => item.step), ["checked", "prepared"]);
await assistantEnd(main, result.confirmationQuestion);
await userTurn(main, "Ja");
assert.equal(main.getState().pendingIntention.activity.phase, "completed");
assert.deepEqual(main.getState().pendingIntention.activity.confirmed.map((item) => item.step), ["checked", "prepared", "result"]);
const restored = makeEngine();
clock.setWall(clock.wall() + 2 * 24 * 60 * 60 * 1_000);
restored.restore(savedWhileAwaitingResult);
let restoredTask = restored.getState().pendingIntention;
assert.equal(restoredTask.status, "paused");
assert.deepEqual(restoredTask.activity.confirmed.map((item) => item.step), ["checked", "prepared"], "confirmed milestones survive two days and a restart");
assert.equal(restoredTask.activity.phase, "waiting_for_start");
assert.equal(restoredTask.activity.startedAt, null);
assert.equal(restoredTask.activity.pending, null);
assert.equal(restored.getState().companion.scene.status, "idle", "scene readiness and armed signals are transient on restore");
assert.equal(restored.acceptStartSignal("voice"), false, "restore never preserves permission to start");
forcedIntentionChoice = "offer_resume";
const forcedOfferResumeCountBefore = forcedIntentionChoiceCount;
await userTurn(restored, "Weiter");
forcedIntentionChoice = null;
assert.equal(forcedIntentionChoiceCount, forcedOfferResumeCountBefore + 1, "the offline decider actually selected offer_resume for the paused activity");
assert.equal(restored.getState().pendingIntention.status, "paused", "generic 'Weiter' cannot resume a bound activity");
const unnamedResume = await action(restored, {
  type: "manage_shared_activity", operation: "resume", id: episodeId, evidence: "Weiter",
});
assert.equal(unnamedResume.status, "missing_title");
assert.equal(restored.getState().pendingIntention.status, "paused");
const resumeEvidence = "Ich möchte mit Gerda weitermachen";
await userTurn(restored, `${resumeEvidence}.`);
const resume = await action(restored, { type: "manage_shared_activity", operation: "resume", id: episodeId, evidence: resumeEvidence });
assert.equal(resume.status, "pending_confirmation");
assert.equal(restored.getState().pendingIntention.status, "paused", "named resume is still tentative before the heard confirmation");
await assistantEnd(restored, resume.confirmationQuestion);
await userTurn(restored, "Ja");
restoredTask = restored.getState().pendingIntention;
assert.equal(restoredTask.status, "active");
assert.equal(restoredTask.activity.phase, "waiting_for_start");
assert.equal(restoredTask.activity.startedAt, null);
assert.equal(restoredTask.activity.pending, null);
assert.equal(restored.getState().companion.scene.status, "idle");
assert.equal(restored.acceptStartSignal("voice"), false, "resuming a task does not re-arm its start ritual");

// Only a currently matched, explicitly confirmed result enters this activity's confirmed history.
await userTurn(restored, "Die Rakete für Gerda steht sicher auf der breiten Basis.");
const restoredResult = await action(restored, {
  type: "manage_shared_activity", operation: "report_result", id: episodeId,
  detail: "Die Rakete für Gerda steht sicher auf der breiten Basis", evidence: "Die Rakete für Gerda steht sicher auf der breiten Basis",
});
assert.equal(restoredResult.status, "wrong_phase");
assert.equal(restored.getState().pendingIntention.activity.phase, "waiting_for_start", "a report after restore does not bypass a fresh start signal");

// Focus loss, sleep, and STOP all pause an active activity and discard its unanswered question.
for (const interrupt of [
  async (engine) => engine.setEnvironment({ focused: false }),
  async (engine) => engine.setEnvironment({ sleeping: true }),
  async (engine) => dispatch(engine, "interrupt", { reason: "STOP" }),
]) {
  const engine = makeEngine();
  const episode = await seedEpisode(engine);
  await beginActivity(engine, episode.id);
  await userTurn(engine, "Die Pappe ist bereit.");
  const question = await action(engine, {
    type: "manage_shared_activity", operation: "confirm_step", id: episode.id, step: "checked",
    detail: "Die Pappe ist bereit", evidence: "Die Pappe ist bereit",
  });
  assert.equal(question.status, "pending_confirmation");
  assert.ok(engine.getState().pendingIntention.activity.pending);
  await interrupt(engine);
  const paused = engine.getState().pendingIntention;
  assert.equal(paused.status, "paused");
  assert.equal(paused.waitingFor, "user_return");
  assert.equal(paused.activity.pending, null, "lifecycle interruption drops an unanswered activity proposal");
  assert.deepEqual(paused.activity.confirmed, [], "the interrupted proposal never becomes a confirmed milestone");
  const snapshot = engine.serialize();
  const reloaded = makeEngine();
  reloaded.restore(snapshot);
  assert.equal(reloaded.getState().pendingIntention.status, "paused");
  assert.equal(reloaded.getState().pendingIntention.activity.pending, null);
  assert.equal(reloaded.getState().pendingIntention.activity.startedAt, null);
  assert.equal(reloaded.acceptStartSignal("voice"), false);
  reloaded.forgetExperience(episode.id);
  assert.equal(reloaded.getState().pendingIntention, null, "forgetting its bound episode drops the activity task");
  assert.equal(reloaded.getState().companion.episodes.some((item) => item.id === episode.id), false);
  engine.dispose();
  reloaded.dispose();
}

// A pending activity question expires even when no user turn arrives; tick must
// publish the newly paused task so observers can persist the lifecycle change.
const ttlEngine = makeEngine();
const ttlEpisode = await seedEpisode(ttlEngine);
await beginActivity(ttlEngine, ttlEpisode.id);
await userTurn(ttlEngine, "Die Pappe liegt bereit.");
const ttlProposal = await action(ttlEngine, {
  type: "manage_shared_activity", operation: "confirm_step", id: ttlEpisode.id, step: "checked",
  detail: "Die Pappe liegt bereit", evidence: "Die Pappe liegt bereit",
});
assert.equal(ttlProposal.status, "pending_confirmation");
const taskBeforeTtl = ttlEngine.getState().pendingIntention;
assert.equal(taskBeforeTtl.activity.pending.step, "checked");
const observedTtlStates = [];
const unsubscribeTtl = ttlEngine.subscribe((state) => observedTtlStates.push(state.pendingIntention));
clock.advance(120_001);
ttlEngine.tick();
await flush();
const taskAfterTtl = ttlEngine.getState().pendingIntention;
assert.notEqual(taskAfterTtl, taskBeforeTtl, "TTL expiry replaces the task state");
assert.equal(taskAfterTtl.status, "paused");
assert.equal(taskAfterTtl.waitingFor, "user_return");
assert.equal(taskAfterTtl.activity.pending, null, "the unanswered milestone is discarded on timeout");
assert.ok(observedTtlStates.some((task) => task === taskAfterTtl), "tick emits the updated task for lifecycle persistence");
unsubscribeTtl();
ttlEngine.dispose();

// The shared trial remains task state; it does not rewrite the saved episode's confirmed history.
const finalEpisode = main.getState().companion.episodes.find((item) => item.id === episodeId);
assert.deepEqual({
  id: finalEpisode.id, title: finalEpisode.title, detail: finalEpisode.detail,
  outcome: finalEpisode.outcome, motif: finalEpisode.motif, source: finalEpisode.source,
  confirmedAt: finalEpisode.confirmedAt, createdAt: finalEpisode.createdAt,
}, originalEpisodeFacts);
assert.equal(main.getState().companion.episodes.length, 1, "confirmed activity milestones do not create or rewrite an episode");
assert.ok(fakeCueInvocations > 0, "the active engine exercised only the injected no-op cue stub");
assert.equal(nonHoldCueInvocations, 0, "the offline fake emits no physical movement cue");

main.dispose();
restored.dispose();
globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;
console.log("shared activity BehaviorEngine confirmation, scene start, pause, restore, and forget checks passed");
