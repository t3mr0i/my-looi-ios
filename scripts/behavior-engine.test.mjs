import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

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
  async function tick(ms) {
    const target = now + ms;
    let guard = 0;
    while (guard++ < 500) {
      const next = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
    }
    assert.ok(guard < 500, "fake timers settled");
    now = target; await flush();
  }
  return { now: () => now, wall: () => wall, setWall: (value) => { wall = value; }, tick, setTimeoutFake, clearTimeoutFake };
}

const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const policy = loadTypeScript("src/behavior/behavior-policy.ts");
const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
const decisions = loadTypeScript("src/openai/decisions.ts", {
  "./openai-api-key": { getOpenAiApiKey: async () => "unused-test-key" },
});

function makeEngine({ mode = "active", budget = 1, scoring = true, visual = true, foreground = true, clock = makeClock() } = {}) {
  const engineModule = loadTypeScript("src/behavior/behavior-engine.ts", { "./behavior-policy": policy, "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts") }, {
    setTimeout: (callback, delay) => clock.setTimeoutFake(callback, delay),
    clearTimeout: (id) => clock.clearTimeoutFake(id),
  });
  const calls = [];
  const effects = [];
  const requests = [];
  const engine = engineModule.createBehaviorEngine({
    now: clock.now,
    wallNow: clock.wall,
    decisionTimeoutMs: 5_000,
    decide: (request, options) => { const item = { request, options, deferred: deferred() }; calls.push(item); return item.deferred.promise; },
    executeCue: (cue) => effects.push(cue),
  });
  engine.configure({ mode, dailyBudgetUsd: budget, candidateScoring: scoring, visualEnabled: visual });
  engine.setEnvironment({ foreground, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false });
  engine.dispatch({ type: "session-start", sessionId: "s1" });
  const turn = (text = "Tell me about that") => engine.dispatch({ type: "user-turn", text, sessionId: engine.getState().sessionId });
  return { engine, clock, calls, effects, requests, turn };
}

function resultFor(request, { cue = "hold", visual = "use_view", intention = "wait", scores = {}, costUsd = 0.001 } = {}) {
  const answers = request.questions.map((question) => {
    if (question.type === "score") {
      const score = scores[question.name] ?? 0;
      return { name: question.name, type: "score", score, confidence: 0.9, probabilities: question.levels.map((level, value) => ({ value, label: level.label, probability: value === score ? 1 : 0 })) };
    }
    const values = question.choices.map((item) => item.value);
    const preferred = question.name === "cue" ? cue : question.name === "visual" ? visual : question.name === "attention" ? "keep_target" : question.name === "intention" ? intention : "none";
    const choice = values.includes(preferred) ? preferred : values[0];
    return { name: question.name, type: "choice", choice, confidence: 0.95, probabilities: values.map((value) => ({ value, probability: value === choice ? 1 : 0 })) };
  });
  return { answers, usage: { inputTokens: 120, cachedTokens: 20, cacheWriteTokens: 5, costUsd }, requestId: "mock-request" };
}

async function complete(item, options) { item.deferred.resolve(resultFor(item.request, options)); await flush(); }
function event(engine, type, fields = {}) { engine.dispatch({ type, sessionId: engine.getState().sessionId, ...fields }); }

// Off mode is silent; shadow mode evaluates but never invokes physical effects.
const off = makeEngine({ mode: "off" }); off.turn();
assert.equal(off.calls.length, 0);
const shadow = makeEngine({ mode: "shadow" }); shadow.turn();
assert.equal(shadow.calls.length, 1);
await complete(shadow.calls[0], { cue: "curious" });
assert.equal(shadow.effects.length, 0);
const active = makeEngine(); active.turn();
assert.ok(active.calls[0].request.questions.some((item) => item.type === "score" && item.name === "score_joy"));
await complete(active.calls[0], { cue: "hold", scores: { score_joy: 4 } });
assert.equal(active.effects[0].gesture, "happy_bob", "score rubric selects a candidate only when enabled");
const curious = makeEngine(); curious.turn();
await complete(curious.calls[0], { cue: "curious" });
assert.equal(curious.engine.getState().cue.mood, "curious", "the curious gesture carries its own visual emotion instead of borrowing startled");
const noScores = makeEngine({ scoring: false }); noScores.turn();
assert.equal(noScores.calls[0].request.questions.some((item) => item.type === "score"), false);
await complete(noScores.calls[0]);
const style = makeEngine(); style.turn("Please nod less");
await complete(style.calls[0], { cue: "nod" });
assert.equal(style.engine.getState().cue.gesture, "hold", "an explicit style preference suppresses nods");
const styleReload = makeEngine({ mode: "shadow", foreground: false }); styleReload.engine.restore(style.engine.serialize());
assert.equal(styleReload.engine.getState().style.suppressNod, true, "the device style preference persists across restart");

const personality = makeEngine({ foreground: false });
personality.turn("Sei lebendiger");
assert.equal(personality.engine.getState().style.conversationTone, "playful");
assert.match(JSON.parse(personality.engine.getConversationContext()).conversationStyle, /livelier/u, "Realtime receives the chosen manner");
const personalityReload = makeEngine({ foreground: false });
personalityReload.engine.restore(personality.engine.serialize());
assert.equal(personalityReload.engine.getState().style.conversationTone, "playful", "explicit tone survives restart");
event(personalityReload.engine, "assistant-end", { text: "Sei ruhiger." });
assert.equal(personalityReload.engine.getState().style.conversationTone, "playful", "assistant speech cannot change the person's preference");
personalityReload.turn("Sei ruhiger");
assert.equal(personalityReload.engine.getState().style.conversationTone, "calm");
assert.equal(personalityReload.engine.getState().style.livelyWhenPlayful, false);
assert.match(JSON.parse(personalityReload.engine.getConversationContext()).conversationStyle, /calmer/u);
const beforeTemporaryRequest = personalityReload.engine.getState().style.version;
personalityReload.turn("Sei heute lebendiger");
assert.equal(personalityReload.engine.getState().style.version, beforeTemporaryRequest, "a temporary request is not saved as a durable preference");
personalityReload.turn("Sei wieder normal");
assert.equal(personalityReload.engine.getState().style.conversationTone, "default");
assert.equal(JSON.parse(personalityReload.engine.getConversationContext()).conversationStyle, undefined);
const legacyStyle = JSON.parse(personality.engine.serialize());
delete legacyStyle.style.conversationTone;
personalityReload.engine.restore(JSON.stringify(legacyStyle));
assert.equal(personalityReload.engine.getState().style.conversationTone, "playful", "an older explicit lively preference migrates");
personalityReload.engine.resetLearning();
assert.equal(personalityReload.engine.getState().style.conversationTone, "default", "clearing learning clears the saved tone");

const calmExpression = makeEngine({ scoring: false });
calmExpression.turn("Sei ruhiger");
await complete(calmExpression.calls[0], { cue: "happy_bob" });
assert.equal(calmExpression.engine.getState().cue.gesture, "hold", "the calm preference also suppresses a bouncy reactive accent");
const ritual = makeEngine(); ritual.turn("Greet me with a nod");
await complete(ritual.calls[0]); await ritual.clock.tick(1_000);
ritual.turn("Hello"); await complete(ritual.calls[1], { cue: "curious" });
assert.equal(ritual.engine.getState().cue.gesture, "nod", "an explicitly agreed greeting selects its motif");
const ritualReload = makeEngine(); ritualReload.engine.restore(ritual.engine.serialize());
assert.equal(ritualReload.engine.getState().style.greetingRitualSource, "explicit_user_request");
assert.equal(ritualReload.engine.getState().style.greetingRitual, "nod");
await ritual.clock.tick(1_000); ritual.turn("Hello again"); await complete(ritual.calls[2], { cue: "nod" });
assert.equal(ritual.engine.getState().cue.gesture, "hold", "a repeated greeting respects its cooldown");

// Physical accents are spaced across turns, but do not become permanently
// forbidden simply because the same gesture happened twice in the past.
const accents = makeEngine({ scoring: false });
async function accentTurn() {
  event(accents.engine, "user-speech-start");
  accents.turn("Was denkst du?");
  event(accents.engine, "user-speech-end");
  event(accents.engine, "assistant-start");
  event(accents.engine, "assistant-end", { text: "Das ist interessant." });
  await accents.clock.tick(1_000);
  await complete(accents.calls.at(-1), { cue: "curious" });
  return accents.engine.getState().cue.gesture;
}
assert.equal(await accentTurn(), "curious");
assert.equal(await accentTurn(), "hold", "an identical physical accent is not repeated immediately");
accents.clock.setWall(accents.clock.wall() + 13_000);
assert.equal(await accentTurn(), "curious", "the same accent is available again after its cooldown");
accents.clock.setWall(accents.clock.wall() + 13_000);
assert.equal(await accentTurn(), "curious", "repeated accents do not become permanently forbidden");

// A delayed transcript cannot clear a newer live speech edge and start cloud work.
const delayed = makeEngine();
event(delayed.engine, "user-speech-start"); event(delayed.engine, "user-speech-end");
event(delayed.engine, "user-speech-start"); delayed.turn("Earlier utterance");
assert.equal(delayed.calls.length, 0);
event(delayed.engine, "user-speech-end"); delayed.turn("Current utterance");
assert.equal(delayed.calls.length, 1);

// Repeated face positions with unchanged membership refresh evidence without API calls.
const faces = makeEngine();
const faceA = { id: "a", centerX: 0.2, centerY: 0.4, width: 0.2, height: 0.3 };
const faceB = { ...faceA, id: "b", centerX: 0.7 };
event(faces.engine, "faces", { faces: [faceA, faceB] });
assert.equal(faces.calls.length, 1);
for (let i = 0; i < 40; i += 1) event(faces.engine, "faces", { faces: [{ ...faceA, centerX: (i % 10) / 10 }, faceB] });
assert.equal(faces.calls.length, 1, "face-frame refresh never creates per-frame decisions for stable membership");
await complete(faces.calls[0]);

// A fresh cue cannot be applied after a new turn, speech start, session end, or learning reset.
for (const invalidate of [
  (h) => h.turn("A newer turn"),
  (h) => event(h.engine, "user-speech-start"),
  (h) => h.engine.dispatch({ type: "session-end", sessionId: "s1" }),
  (h) => h.engine.resetLearning(),
  (h) => h.engine.setEnvironment({ connected: false }),
]) {
  const h = makeEngine(); h.turn("Old turn"); const first = h.calls[0]; invalidate(h);
  first.deferred.resolve(resultFor(first.request, { cue: "curious", costUsd: 0.004 })); await flush();
  assert.equal(h.engine.getState().cue, undefined, "stale response cannot publish a cue");
  assert.ok(h.engine.getState().metrics.stale >= 1);
  assert.equal(h.effects.length, 0);
  assert.equal(h.engine.getState().metrics.costUsd, 0.004, "late provider usage is still counted once");
}

// Explicit style correction, intention lifecycle, and reference repair persist locally.
const learning = makeEngine({ mode: "shadow", foreground: false });
learning.turn("We are planning a trip"); learning.turn("Wait a moment");
assert.equal(learning.engine.getState().pendingIntention.status, "paused");
let saved = learning.engine.serialize();
const restored = makeEngine({ mode: "shadow", foreground: false }); restored.engine.restore(saved);
assert.equal(restored.engine.getState().pendingIntention.status, "paused");
restored.turn("Continue"); assert.equal(restored.engine.getState().pendingIntention.status, "active");
saved = restored.engine.serialize();
const resumed = makeEngine({ mode: "shadow", foreground: false }); resumed.engine.restore(saved);
assert.equal(resumed.engine.getState().pendingIntention.status, "paused", "restart requires explicit resumption again");
resumed.turn("Forget it"); assert.equal(resumed.engine.getState().pendingIntention, null);
const dropped = makeEngine({ mode: "shadow", foreground: false }); dropped.engine.restore(resumed.engine.serialize());
assert.equal(dropped.engine.getState().pendingIntention, null, "dropping an intention persists across restart");

// Explicitly paused work remains available beyond the next day, but restores
// paused and never silently resumes after a restart.
const retentionClock = makeClock();
const longTask = makeEngine({ clock: retentionClock });
event(longTask.engine, "intention", { action: "pause", goal: "Papierflieger", lastConfirmedStep: "Flügel gefaltet" });
const persistedTask = longTask.engine.serialize();
retentionClock.setWall(retentionClock.wall() + 2 * 24 * 60 * 60 * 1_000);
const nextDay = makeEngine({ clock: retentionClock });
nextDay.engine.restore(persistedTask);
assert.equal(nextDay.engine.getState().pendingIntention?.status, "paused");
assert.equal(nextDay.engine.getState().pendingIntention?.lastConfirmedStep, "Flügel gefaltet");
nextDay.engine.setEnvironment({ responseLanguage: "de" });
nextDay.turn("Ich bin wieder da.");
assert.equal(nextDay.engine.getState().pendingIntention?.status, "paused", "returning alone does not resume the task");
await complete(nextDay.calls.at(-1), { intention: "offer_resume" });
assert.equal(nextDay.engine.getState().pendingIntention?.status, "paused", "an asynchronous decision cannot replace the local confirmation gate");
assert.match(JSON.parse(nextDay.engine.getConversationContext()).returnQuestion, /Sollen wir weitermachen/u);
nextDay.turn("Ja");
assert.equal(nextDay.engine.getState().pendingIntention?.status, "paused", "yes cannot accept an unheard question");
nextDay.turn("Ich bin wieder da.");
event(nextDay.engine, "assistant-end", { text: "Schön, dass du wieder da bist." });
nextDay.turn("Ja");
assert.equal(nextDay.engine.getState().pendingIntention?.status, "paused", "a truncated question cannot authorize continuation");
nextDay.turn("Ich bin wieder da.");
event(nextDay.engine, "assistant-end", { text: "Schön, dass du wieder da bist. Sollen wir weitermachen?" });
nextDay.turn("Ja, bitte.");
assert.equal(nextDay.engine.getState().pendingIntention?.status, "active", "a heard question and affirmative answer resume the same task");
retentionClock.setWall(retentionClock.wall() + 6 * 24 * 60 * 60 * 1_000);
nextDay.engine.tick();
assert.equal(nextDay.engine.getState().pendingIntention, null, "bounded retention still expires abandoned work");

const expiredReturn = makeEngine();
event(expiredReturn.engine, "intention", { action: "pause", goal: "Papierflieger" });
expiredReturn.turn("Ich bin wieder da.");
assert.equal(expiredReturn.engine.hasPendingReturnConfirmation(), true);
expiredReturn.clock.setWall(expiredReturn.clock.wall() + 31_000);
expiredReturn.engine.tick();
assert.equal(expiredReturn.engine.hasPendingReturnConfirmation(), false, "an unanswered return question does not lock later replies");
expiredReturn.turn("Ja");
assert.equal(expiredReturn.engine.getState().pendingIntention.status, "paused", "an expired return question cannot authorize resumption");

const interrupted = makeEngine();
event(interrupted.engine, "assistant-start");
event(interrupted.engine, "user-speech-start");
event(interrupted.engine, "user-speech-end");
interrupted.turn("Moment, ich meinte die blaue.");
let interruptionContext = JSON.parse(interrupted.engine.getConversationContext());
assert.match(interruptionContext.interruptedReply, /unheard part/u, "repair is grounded in an actual interrupted spoken reply");
assert.equal(interruptionContext.physicalState.transportConnected, true);
assert.match(interruptionContext.physicalState.instruction, /may be simulated/u, "a mock transport is not presented as proof of a physical robot");
event(interrupted.engine, "assistant-end", { text: "Du meinst die blaue." });
interruptionContext = JSON.parse(interrupted.engine.getConversationContext());
assert.equal(interruptionContext.interruptedReply, undefined, "the repair hint does not repeat after a completed reply");
interrupted.engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: false, ambientEnabled: false, cameraEnabled: false, userSpeaking: false, assistantSpeaking: false, motionActive: false });
assert.equal(JSON.parse(interrupted.engine.getConversationContext()).physicalState.transportConnected, false, "connection context reflects the real local transport state");
dropped.turn("Please nod less"); assert.equal(dropped.engine.getState().style.suppressNod, true);
const referenceBefore = dropped.engine.getState().referenceVersion;
dropped.engine.dispatch({ type: "correction", sessionId: "s1", correctedReference: "the blue box" });
assert.equal(dropped.engine.getState().repairRequired, true);
assert.equal(dropped.engine.getState().referenceVersion, referenceBefore + 1);
dropped.engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: true, visualEnabled: true });
assert.match(dropped.engine.getConversationContext(), /corrected the previous reference/u);

// Persist budget across learning reset and process restart; renew only on a new local day.
const budgetClock = makeClock();
const budget = makeEngine({ budget: 0.25, clock: budgetClock }); budget.turn();
await complete(budget.calls[0], { costUsd: 0.25 });
budget.engine.resetLearning(); saved = budget.engine.serialize();
const restarted = makeEngine({ budget: 0.25, clock: budgetClock }); restarted.engine.restore(saved); restarted.turn();
assert.equal(restarted.calls.length, 0, "learning reset and restore do not refill a spent daily budget");
assert.equal(restarted.engine.getState().metrics.budgetSkipped, 1);
assert.equal(await restarted.engine.inspectVisual("image", "old day", "s1"), "", "visual advice also respects the exhausted daily budget");
assert.equal(restarted.calls.length, 0);
budgetClock.setWall(Date.UTC(2026, 0, 2)); restarted.turn("New day");
assert.equal(restarted.calls.length, 1, "budget renews on the next local day");

// Visual quality advice resolves only for the matching active session and visual opt-in.
const visual = makeEngine();
assert.ok(visual.calls.length === 0);
const advicePromise = visual.engine.inspectVisual("data:image/jpeg;base64,AA==", "read this label", "s1");
assert.ok(visual.calls[0].request.questions.some((item) => item.name === "visual"));
await complete(visual.calls[0], { visual: "ask_reposition" });
assert.match(await advicePromise, /clearer view/u);
assert.equal(visual.engine.getState().visualAdvice.sessionId, "s1");
const visualOff = makeEngine({ visual: false });
assert.equal(await visualOff.engine.inspectVisual("image", "task", "s1"), "");
assert.equal(visualOff.calls.length, 0, "visual work stays off unless explicitly enabled");
const staleVisual = makeEngine();
const staleAdvice = staleVisual.engine.inspectVisual("image", "old task", "s1");
staleVisual.engine.dispatch({ type: "session-start", sessionId: "s2" });
assert.equal(await staleAdvice, "");
staleVisual.calls[0].deferred.resolve(resultFor(staleVisual.calls[0].request, { visual: "use_view" })); await flush();
assert.equal(staleVisual.engine.getState().visualAdvice, null);
const bargedVisual = makeEngine();
const bargedAdvice = bargedVisual.engine.inspectVisual("image", "interrupted task", "s1");
event(bargedVisual.engine, "user-speech-start");
assert.equal(await bargedAdvice, "", "barge-in resolves pending visual advice as stale");
bargedVisual.calls[0].deferred.resolve(resultFor(bargedVisual.calls[0].request, { visual: "use_view" })); await flush();
assert.equal(bargedVisual.engine.getState().visualAdvice, null);

// The local game keeps its deterministic answer and attempt count out of speech context.
const game = makeEngine();
event(game.engine, "game-command", { action: "start" });
assert.equal(game.engine.getState().game.secretAnswer, 1);
game.turn("2"); assert.equal(game.engine.getState().game.attemptsLeft, 2);
assert.equal(game.engine.getState().game.lastOutcome, "too_high");
const spokenGameState = JSON.parse(game.engine.getConversationContext()).numberGame;
assert.equal(spokenGameState.attemptsLeft, 2);
assert.equal("secretAnswer" in spokenGameState, false, "the local secret never enters voice context");
game.turn("1"); assert.equal(game.engine.getState().game.status, "won");

// Exercise the real engine-to-HTTP contract, rather than validating each seam in isolation.
const httpEffects = [];
let httpCalls = 0;
const contractClock = makeClock();
const realEngine = loadTypeScript("src/behavior/behavior-engine.ts", { "./behavior-policy": policy, "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts") }, {
  setTimeout: contractClock.setTimeoutFake,
  clearTimeout: contractClock.clearTimeoutFake,
}).createBehaviorEngine({
  now: contractClock.now,
  wallNow: contractClock.wall,
  decide: (input, options) => decisions.requestDecisions(input, {
    ...options,
    dependencies: {
      getApiKey: async () => "local-contract-test",
      fetcher: async (_url, init) => {
        httpCalls += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.input[1].content[0].type, "input_json");
        const mocked = resultFor({ questions: body.questions }, { cue: "curious" });
        return new Response(JSON.stringify({ answers: mocked.answers, usage: {
          input_tokens: 120, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
          output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120,
        } }), { status: 200, headers: { "x-request-id": "engine-http-contract" } });
      },
    },
  }),
  executeCue: (cue) => httpEffects.push(cue),
});
realEngine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: true, visualEnabled: false });
realEngine.setEnvironment({ foreground: true, focused: true, cameraEnabled: true });
realEngine.dispatch({ type: "session-start", sessionId: "http-contract" });
realEngine.dispatch({ type: "faces", faces: [{ ...faceA, unusedNativeField: undefined }] });
realEngine.dispatch({ type: "user-turn", text: "Tell me about that", sessionId: "http-contract" });
await new Promise((resolve) => setImmediate(resolve));
await flush();
assert.equal(httpCalls, 1, "an ordinary non-image event passes the strict JSON request validator");
assert.equal(realEngine.getState().metrics.completed, 1);
assert.equal(httpEffects[0].gesture, "curious");
realEngine.dispose();

console.log("Behavior engine lifecycle, budget, persistence, visual, scoring, and game checks passed.");
