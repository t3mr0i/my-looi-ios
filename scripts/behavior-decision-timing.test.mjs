import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

function makeClock() {
  let now = 1_000;
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
    now = target;
    await flush();
  }
  return { now: () => now, tick, setTimeoutFake, clearTimeoutFake };
}

const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const policy = loadTypeScript("src/behavior/behavior-policy.ts");
const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});

function resultFor(request, { cue = "curious", visual = "use_view", costUsd = 0.001 } = {}) {
  const answers = request.questions.map((question) => {
    const values = question.choices.map(({ value }) => value);
    const selected = question.name === "cue" ? cue
      : question.name === "visual" ? visual
        : question.name === "attention" ? "keep_target" : "wait";
    const choice = values.includes(selected) ? selected : values[0];
    return {
      name: question.name,
      type: "choice",
      choice,
      confidence: 0.95,
      probabilities: values.map((value) => ({ value, probability: value === choice ? 1 : 0 })),
    };
  });
  return {
    answers,
    usage: { inputTokens: 120, cachedTokens: 20, cacheWriteTokens: 5, costUsd },
    requestId: "timing-test-request",
  };
}

function makeHarness({ decisionTimeoutMs = 1_800, visualEnabled = false } = {}) {
  const clock = makeClock();
  const engineModule = loadTypeScript("src/behavior/behavior-engine.ts", {
    "./behavior-policy": policy,
    "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts"),
  }, {
    setTimeout: (callback, delay) => clock.setTimeoutFake(callback, delay),
    clearTimeout: (id) => clock.clearTimeoutFake(id),
  });
  const calls = [];
  const effects = [];
  const engine = engineModule.createBehaviorEngine({
    now: clock.now,
    wallNow: () => Date.UTC(2026, 0, 1),
    decisionTimeoutMs,
    decide: (request, options) => {
      const item = { request, options, at: clock.now(), deferred: deferred() };
      calls.push(item);
      return item.deferred.promise;
    },
    executeCue: (cue) => effects.push(cue),
  });
  engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled });
  engine.setEnvironment({
    foreground: true,
    focused: true,
    sleeping: false,
    connected: true,
    ambientEnabled: true,
    cameraEnabled: visualEnabled,
    userSpeaking: false,
    assistantSpeaking: false,
    motionActive: false,
  });
  engine.dispatch({ type: "session-start", sessionId: "decision-timing" });
  return { engine, clock, calls, effects };
}

function assistantEnd(h) {
  // A transcript published while speech is active must not create a user-turn request.
  h.engine.dispatch({ type: "user-speech-start", sessionId: "decision-timing" });
  h.engine.dispatch({ type: "user-turn", sessionId: "decision-timing", text: "What do you think?" });
  h.engine.dispatch({ type: "user-speech-end", sessionId: "decision-timing" });
  h.engine.dispatch({ type: "assistant-start", sessionId: "decision-timing" });
  h.engine.dispatch({ type: "assistant-end", sessionId: "decision-timing", text: "I think that is an interesting question." });
}

async function respond(h, index = h.calls.length - 1, options) {
  h.calls[index].deferred.resolve(resultFor(h.calls[index].request, options));
  await flush();
}

function dispose(h) { h.engine.dispose(); }

// Assistant-end alone receives the longer response window. This reply is valid within
// production's 1.8s cap but beyond the old 800ms work deadline.
{
  const h = makeHarness();
  assistantEnd(h);
  await flush();
  assert.equal(h.calls.length, 1, "the assistant-end reaction is the only request");
  assert.equal(h.calls[0].request.context.eventType, "assistant-end");
  await h.clock.tick(1_480);
  await respond(h, 0, { cue: "curious" });
  assert.equal(h.engine.getState().metrics.completed, 1, "a timely assistant-end response completes");
  assert.equal(h.engine.getState().metrics.failed, 0);
  assert.equal(h.engine.getState().metrics.timedOut, 0);
  assert.equal(h.effects.length, 1, "one physical cue is emitted for the assistant reply");
  assert.equal(h.effects[0].gesture, "curious");
  assert.ok(h.effects[0].expiresAt >= 2_480 && h.effects[0].expiresAt <= 2_800,
    "cue expiry stays within its original absolute assistant-end deadline");
  dispose(h);
}

// The maximum assistant-end window is 1.8s even if a caller configures a longer request;
// a late valid provider reply still contributes usage exactly once but cannot move the robot.
{
  const h = makeHarness({ decisionTimeoutMs: 5_000 });
  assistantEnd(h);
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.signal.aborted, false);
  await h.clock.tick(1_801);
  assert.equal(h.calls[0].options.signal.aborted, true, "the hard 1.8s event cap aborts the request");
  await respond(h, 0, { cue: "curious", costUsd: 0.004 });
  assert.equal(h.engine.getState().metrics.completed, 0);
  assert.equal(h.engine.getState().metrics.timedOut, 1);
  assert.equal(h.effects.length, 0);
  assert.equal(h.engine.getState().metrics.costUsd, 0.004, "a late result's usage remains chargeable");
  assert.equal(h.engine.getState().metrics.inputTokens, 120);
  assert.equal(h.engine.getState().metrics.requests, 1, "the expired event is never retried");
  await flush();
  assert.equal(h.engine.getState().metrics.costUsd, 0.004, "provider usage is accounted exactly once");
  dispose(h);
}

// A lower configured timeout remains a hard upper bound for assistant-end decisions.
{
  const h = makeHarness({ decisionTimeoutMs: 1_200 });
  assistantEnd(h);
  await flush();
  await h.clock.tick(1_199);
  assert.equal(h.calls[0].options.signal.aborted, false);
  await respond(h, 0, { cue: "thinking" });
  assert.equal(h.engine.getState().metrics.completed, 1);
  assert.equal(h.effects[0].gesture, "thinking");
  assert.ok(h.effects[0].expiresAt <= 2_200);
  dispose(h);
}

{
  const h = makeHarness({ decisionTimeoutMs: 500 });
  assistantEnd(h);
  await flush();
  await h.clock.tick(501);
  assert.equal(h.calls[0].options.signal.aborted, true, "custom timeout remains applied below the event maximum");
  await respond(h, 0, { cue: "curious" });
  assert.equal(h.engine.getState().metrics.completed, 0);
  assert.equal(h.engine.getState().metrics.timedOut, 1);
  assert.equal(h.effects.length, 0);
  dispose(h);
}

// New turns, speech edges, explicit STOP, assistant-start, settings and unsafe runtime
// environment transitions all invalidate an in-flight output response. Usage is still
// charged once when that discarded response eventually arrives.
const invalidators = [
  ["new user turn", (h) => {
    h.engine.dispatch({ type: "user-speech-start", sessionId: "decision-timing" });
    h.engine.dispatch({ type: "user-turn", sessionId: "decision-timing", text: "A newer question." });
  }],
  ["session end", (h) => h.engine.dispatch({ type: "session-end", sessionId: "decision-timing" })],
  ["session rollover", (h) => h.engine.dispatch({ type: "session-start", sessionId: "next-session" })],
  ["user speech start", (h) => h.engine.dispatch({ type: "user-speech-start", sessionId: "decision-timing" })],
  ["STOP interrupt", (h) => h.engine.dispatch({ type: "interrupt", reason: "STOP", sessionId: "decision-timing" })],
  ["assistant start", (h) => h.engine.dispatch({ type: "assistant-start", sessionId: "decision-timing" })],
  ["behavior settings off", (h) => h.engine.configure({ mode: "off", dailyBudgetUsd: 1, candidateScoring: false, visualEnabled: false })],
  ["background", (h) => h.engine.setEnvironment({ foreground: false })],
  ["sleep", (h) => h.engine.setEnvironment({ sleeping: true })],
  ["disconnect", (h) => h.engine.setEnvironment({ connected: false })],
];

for (const [label, invalidate] of invalidators) {
  const h = makeHarness();
  assistantEnd(h);
  await flush();
  assert.equal(h.calls.length, 1, `${label}: only the assistant-end request started`);
  await h.clock.tick(900);
  assert.equal(h.calls[0].options.signal.aborted, false, `${label}: the request remains eligible beyond the old 800ms limit`);
  invalidate(h);
  await flush();
  assert.equal(h.calls[0].options.signal.aborted, true, `${label}: abort signal closes the request`);
  await h.clock.tick(580);
  await respond(h, 0, { cue: "happy_bob", costUsd: 0.002 });
  assert.equal(h.effects.length, 0, `${label}: stale response has no physical effect`);
  assert.equal(h.engine.getState().metrics.completed, 0, `${label}: stale response is not completed`);
  assert.equal(h.engine.getState().metrics.costUsd, 0.002, `${label}: late usage is retained once`);
  assert.equal(h.engine.getState().metrics.inputTokens, 120);
  await flush();
  assert.equal(h.engine.getState().metrics.costUsd, 0.002, `${label}: usage is not double-counted`);
  dispose(h);
}

// The original 800ms limit remains for user-turn and face membership work.
{
  const h = makeHarness();
  h.engine.dispatch({ type: "user-turn", sessionId: "decision-timing", text: "Tell me about that." });
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.context.eventType, "user-turn");
  await h.clock.tick(801);
  assert.equal(h.calls[0].options.signal.aborted, true);
  await respond(h, 0, { cue: "curious" });
  assert.equal(h.effects.length, 0);
  assert.equal(h.engine.getState().metrics.timedOut, 1);
  assert.equal(h.engine.getState().metrics.requests, 1);
  dispose(h);
}

{
  const h = makeHarness({ visualEnabled: true });
  h.engine.setEnvironment({ cameraEnabled: true });
  h.engine.dispatch({ type: "faces", faces: [
    { id: "left", centerX: 0.25, centerY: 0.5, width: 0.2, height: 0.3 },
    { id: "right", centerX: 0.75, centerY: 0.5, width: 0.2, height: 0.3 },
  ] });
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.context.eventType, "faces");
  await h.clock.tick(801);
  assert.equal(h.calls[0].options.signal.aborted, true);
  await respond(h, 0, { cue: "curious" });
  assert.equal(h.effects.length, 0);
  assert.equal(h.engine.getState().metrics.timedOut, 1);
  assert.equal(h.engine.getState().metrics.requests, 1, "unchanged face frames do not retry the expired membership event");
  dispose(h);
}

// Image advice retains its existing 2s limit even when the configured timeout is larger.
{
  const h = makeHarness({ decisionTimeoutMs: 5_000, visualEnabled: true });
  const advice = h.engine.inspectVisual("data:image/jpeg;base64,AA==", "read this label", "decision-timing");
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.context.eventType, "visual");
  await h.clock.tick(1_900);
  await respond(h, 0, { visual: "ask_reposition" });
  assert.match(await advice, /clearer view/u);
  assert.equal(h.engine.getState().metrics.completed, 1);
  assert.equal(h.effects.length, 0, "visual advice remains non-actuating");
  dispose(h);
}

// A rate-limited assistant-end request receives only the time left until its original
// enqueue deadline; dispatch time does not restart the 1.8s window.
{
  const h = makeHarness();
  h.engine.setEnvironment({ cameraEnabled: true });
  h.engine.dispatch({ type: "faces", faces: [
    { id: "left", centerX: 0.25, centerY: 0.5, width: 0.2, height: 0.3 },
    { id: "right", centerX: 0.75, centerY: 0.5, width: 0.2, height: 0.3 },
  ] });
  await flush();
  assert.equal(h.calls.length, 1);
  await respond(h, 0, { cue: "hold" });
  assert.equal(h.engine.getState().metrics.completed, 1);
  const effectsBeforeAssistantEnd = h.effects.length;
  await h.clock.tick(900);
  assistantEnd(h);
  await flush();
  assert.equal(h.calls.length, 1, "the reaction waits for the existing one-request-per-second rate window");
  await h.clock.tick(100);
  assert.equal(h.calls.length, 2, "the queued reaction starts at the rate-window boundary");
  assert.equal(h.calls[1].request.context.eventType, "assistant-end");
  assert.equal(h.calls[1].at, 2_000);
  await h.clock.tick(1_701);
  assert.equal(h.calls[1].options.signal.aborted, true, "queue delay consumed the event's absolute response window");
  await respond(h, 1, { cue: "curious", costUsd: 0.003 });
  assert.equal(h.effects.length, effectsBeforeAssistantEnd, "late queued result cannot actuate after the enqueue deadline");
  assert.equal(h.engine.getState().metrics.costUsd, 0.004, "both provider responses are accounted once");
  assert.equal(h.engine.getState().metrics.requests, 2, "a queued response is never retried");
  dispose(h);
}

// Only the latest pending assistant-end reaction survives coalescing while an earlier
// request is being cancelled, and its context belongs to the latest completed reply.
{
  const h = makeHarness();
  h.engine.dispatch({ type: "user-turn", sessionId: "decision-timing", text: "What do you think?" });
  await flush();
  assert.equal(h.calls.length, 1);
  h.engine.dispatch({ type: "assistant-start", sessionId: "decision-timing" });
  h.engine.dispatch({ type: "assistant-end", sessionId: "decision-timing", text: "An earlier draft." });
  h.engine.dispatch({ type: "assistant-start", sessionId: "decision-timing" });
  h.engine.dispatch({ type: "assistant-end", sessionId: "decision-timing", text: "The final answer." });
  await flush();
  assert.equal(h.calls.length, 1, "superseded queued reactions do not dispatch their own request");
  assert.equal(h.calls[0].options.signal.aborted, true, "the older in-flight decision was invalidated");
  await h.clock.tick(1_000);
  assert.equal(h.calls.length, 2, "the latest queued reaction dispatches once when the rate window opens");
  assert.equal(h.calls[1].request.context.eventType, "assistant-end");
  assert.equal(h.calls[1].request.context.eventText, "The final answer.");
  await respond(h, 0, { cue: "hold", costUsd: 0.001 });
  await respond(h, 1, { cue: "curious", costUsd: 0.002 });
  assert.equal(h.engine.getState().metrics.requests, 2);
  assert.equal(h.engine.getState().metrics.completed, 1, "only the current reaction completes");
  assert.equal(h.engine.getState().metrics.costUsd, 0.003, "both responses are charged exactly once");
  assert.deepEqual(h.effects.map(({ gesture }) => gesture), ["curious"]);
  dispose(h);
}

console.log("Behavior decision timing, invalidation, cap, queue and usage checks passed.");
