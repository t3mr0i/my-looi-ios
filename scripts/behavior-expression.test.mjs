import assert from "node:assert/strict";
import fs from "node:fs";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

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
    while (guard++ < 1_000) {
      const next = [...timers.entries()].filter(([, item]) => item.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].callback();
      await flush();
    }
    assert.ok(guard < 1_000, "fake timers settled");
    now = target;
    await flush();
  }
  return { now: () => now, tick, elapse: (ms) => { now += ms; }, setTimeoutFake, clearTimeoutFake, pending: () => timers.size };
}

const flush = async () => { for (let i = 0; i < 32; i += 1) await Promise.resolve(); };
const { compileBehaviorExpression, runBehaviorExpression } = loadTypeScript(
  "src/behavior/behavior-expression.ts",
  {},
  { setTimeout: (callback, delay) => activeClock.setTimeoutFake(callback, delay), clearTimeout: (id) => activeClock.clearTimeoutFake(id) },
);
let activeClock;

function cue(gesture = "curious", overrides = {}) {
  return {
    id: "expression-test-cue",
    gesture,
    mood: null,
    posture: "settle",
    expiresAt: 2_000,
    generation: 1,
    presentationOnly: false,
    ...overrides,
  };
}

function harness({ expiresAt = 2_000, executeHead = async () => ({ completed: true }), beginAccent = () => true } = {}) {
  const clock = makeClock();
  activeClock = clock;
  const controller = new AbortController();
  const phases = [];
  let accentAt = null;
  let headCalls = 0;
  let beginCalls = 0;
  let settleCalls = 0;
  const deps = {
    now: clock.now,
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted && (accentAt === null || clock.now() < accentAt + 1_500),
    present: (phase, gaze) => phases.push({ phase, gaze }),
    beginAccent: () => {
      beginCalls += 1;
      const accepted = beginAccent();
      if (accepted) accentAt = clock.now();
      return accepted;
    },
    executeHead: () => { headCalls += 1; return executeHead(); },
    settle: () => { settleCalls += 1; },
  };
  return {
    clock, controller, phases, deps, headCalls: () => headCalls,
    beginCalls: () => beginCalls, settleCalls: () => settleCalls,
    run: (value = cue("curious", { expiresAt })) => runBehaviorExpression(value, deps),
  };
}

// Compiler output is a small, bounded local score; durations are documented provisional values.
{
  const curious = compileBehaviorExpression(cue("curious"));
  assert.deepEqual(curious, {
    gesture: "curious", prepareMs: 150, prepareGaze: { x: 0, y: -0.16 }, settleMs: 220,
  });
  const thinking = compileBehaviorExpression(cue("thinking", { gaze: { x: 1.4, y: 0.25 } }));
  assert.deepEqual(thinking.prepareGaze, { x: 0.2, y: 0.2 }, "gaze is clamped to a small range");
  assert.deepEqual(compileBehaviorExpression(cue("speaking_soft")).prepareGaze, { x: 0, y: 0 });
  assert.equal(compileBehaviorExpression(cue("hold")), null);
  assert.equal(compileBehaviorExpression(cue("curious", { presentationOnly: true })), null);
  assert.equal(compileBehaviorExpression(cue("not-an-approved-gesture")), null);
}

// Successful run preserves prepare -> accent -> settle ordering and default return gaze.
{
  const h = harness();
  const running = h.run();
  assert.deepEqual(h.phases, [{ phase: "prepare", gaze: { x: 0, y: -0.16 } }]);
  await h.clock.tick(150);
  await flush();
  assert.equal(h.beginCalls(), 1);
  assert.equal(h.headCalls(), 1);
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["prepare", "accent", "settle"]);
  assert.deepEqual(h.phases[1].gaze, h.phases[0].gaze, "prepared gaze remains through the head accent");
  assert.equal(h.phases[2].gaze, undefined, "settle returns gaze to the default attention target");
  await h.clock.tick(220);
  assert.deepEqual(await running, { completed: true });
  assert.equal(h.settleCalls(), 1);
}

// Reduced motion skips both holds and all spatial display choreography.
{
  const head = deferred();
  const h = harness({ executeHead: () => head.promise });
  h.deps.reducedMotion = true;
  const startedAt = h.clock.now();
  const running = h.run();
  assert.deepEqual(h.phases, [{ phase: "accent", gaze: undefined }],
    "reduced motion has no prepare phase or display gaze movement");
  assert.equal(h.clock.now(), startedAt, "the expression adds no lead delay");
  assert.equal(h.headCalls(), 1, "the already-approved gesture still runs");
  head.resolve({ completed: true });
  assert.deepEqual(await running, { completed: true }, "there is no additional settle hold");
  assert.equal(h.clock.now(), startedAt, "no settle delay is added");
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["accent"], "reduced motion skips the settle display phase");
  assert.equal(h.settleCalls(), 1);
}

// A cue with less than the preparation lead remaining skips the lead without extending expiry.
{
  const h = harness();
  const running = h.run(cue("nod", { expiresAt: h.clock.now() + 149 }));
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["accent"], "no prepare motion is started when its full lead cannot fit");
  await flush();
  assert.equal(h.beginCalls(), 1);
  assert.equal(h.headCalls(), 1);
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["accent", "settle"]);
  await h.clock.tick(220);
  assert.deepEqual(await running, { completed: true });
}

// Cue expiry during a preparation that originally fit suppresses the accent.
{
  const h = harness();
  const running = h.run(cue("thinking", { expiresAt: h.clock.now() + 160 }));
  assert.equal(h.phases[0].phase, "prepare");
  h.clock.elapse(160); // Simulate a delayed timer callback after the original cue expired.
  await h.clock.tick(0);
  assert.deepEqual(await running, { completed: false });
  assert.equal(h.beginCalls(), 0);
  assert.equal(h.headCalls(), 0);
}

// Already-expired, hold, display-only, and rejected accents have no physical effect.
{
  const expired = harness();
  assert.deepEqual(await expired.run(cue("curious", { expiresAt: expired.clock.now() })), { completed: false });
  assert.equal(expired.phases.length, 0);
  assert.equal(expired.beginCalls(), 0);

  const hold = harness();
  assert.deepEqual(await hold.run(cue("hold")), { completed: false });
  assert.equal(hold.phases.length, 0);

  const displayOnly = harness();
  assert.deepEqual(await displayOnly.run(cue("happy_bob", { presentationOnly: true })), { completed: false });
  assert.equal(displayOnly.phases.length, 0);

  const rejected = harness({ beginAccent: () => false });
  const rejectedRun = rejected.run();
  await rejected.clock.tick(150);
  assert.deepEqual(await rejectedRun, { completed: false });
  assert.deepEqual(rejected.phases.map(({ phase }) => phase), ["prepare"]);
  assert.equal(rejected.headCalls(), 0);
  assert.equal(rejected.settleCalls(), 0);
}

// Abort during preparation wakes the wait promptly and prevents any later phase.
{
  const h = harness();
  const running = h.run();
  await h.clock.tick(50);
  h.controller.abort();
  assert.deepEqual(await running, { completed: false });
  assert.equal(h.beginCalls(), 0);
  assert.equal(h.headCalls(), 0);
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["prepare"]);
  assert.equal(h.clock.pending(), 0);
}

// Abort during an in-flight head operation returns immediately; a late success cannot settle.
{
  const head = deferred();
  const h = harness({ executeHead: () => head.promise });
  const running = h.run();
  await h.clock.tick(150);
  assert.equal(h.headCalls(), 1);
  h.controller.abort();
  assert.deepEqual(await running, { completed: false });
  head.resolve({ completed: true });
  await flush();
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["prepare", "accent"]);
  assert.equal(h.settleCalls(), 0);
}

// A hanging head seam is bounded by the independent 1.5-second post-start window.
{
  const head = deferred();
  const h = harness({ executeHead: () => head.promise });
  const running = h.run();
  await h.clock.tick(150);
  await h.clock.tick(1_500);
  assert.deepEqual(await running, { completed: false });
  head.resolve({ completed: true });
  await flush();
  assert.equal(h.settleCalls(), 0);
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["prepare", "accent"]);
}

// The same independent close bound applies in reduced motion when the head seam hangs.
{
  const head = deferred();
  const h = harness({ executeHead: () => head.promise });
  h.deps.reducedMotion = true;
  const running = h.run();
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["accent"]);
  await h.clock.tick(1_500);
  assert.deepEqual(await running, { completed: false });
  assert.equal(h.settleCalls(), 0);
  assert.deepEqual(h.phases.map(({ phase }) => phase), ["accent"]);
  head.resolve({ completed: true });
  await flush();
  assert.equal(h.settleCalls(), 0, "late head completion cannot start a settle phase");
}

// Incomplete or rejected SDK seams cannot be reported as a completed expression.
for (const executeHead of [
  async () => ({ completed: false }),
  async () => { throw new Error("synthetic adapter failure"); },
]) {
  const h = harness({ executeHead });
  const running = h.run();
  await h.clock.tick(150);
  assert.deepEqual(await running, { completed: false });
  assert.equal(h.phases.some(({ phase }) => phase === "settle"), false);
  assert.equal(h.settleCalls(), 0);
}

// Abort during the settle hold prevents the final cleanup callback from writing stale state.
{
  const h = harness();
  const running = h.run();
  await h.clock.tick(150);
  await flush();
  assert.equal(h.phases.at(-1).phase, "settle");
  h.controller.abort();
  assert.deepEqual(await running, { completed: false });
  assert.equal(h.settleCalls(), 0);
}

const source = fs.readFileSync("src/behavior/behavior-expression.ts", "utf8");
assert.match(source, /import type \{ BehaviorCue, BehaviorGesture \}/u);
assert.doesNotMatch(source, /behavior-runtime|requestDecisions|fetch\s*\(|looi-robot/u,
  "the expression score has no provider or production actuator dependency");

console.log("behavior-expression tests passed");
