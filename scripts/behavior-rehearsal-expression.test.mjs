import assert from "node:assert/strict";
import fs from "node:fs";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function makeClock(startAt = 1_000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(duration) {
      const target = now + duration;
      let count = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++count < 2_000, "fake timer execution remains bounded");
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

let activeClock;
const expression = loadTypeScript("src/behavior/behavior-expression.ts", {}, {
  setTimeout: (callback, delay) => activeClock.setTimeout(callback, delay),
  clearTimeout: (id) => activeClock.clearTimeout(id),
});
const rehearsalExpression = loadTypeScript("src/behavior/behavior-rehearsal-expression.ts", {
  "./behavior-expression": expression,
});

const cue = (overrides = {}) => ({
  id: "native-preview-cue",
  gesture: "curious",
  mood: "curious",
  posture: "attend",
  expiresAt: 2_000,
  generation: 1,
  ...overrides,
});

// Real runner phases feed only a local RobotFace fixture. Head work remains on
// the injected, current-session mock seam, and phase snapshots can be slowed.
{
  const clock = makeClock();
  activeClock = clock;
  const controller = new AbortController();
  const head = deferred();
  let eligible = true;
  let headCalls = 0;
  let accentGuard;
  let liveFixture = null;
  let captured = null;
  const presentations = [];
  const resultPromise = rehearsalExpression.runBehaviorRehearsalExpression(cue(), {
    now: clock.now,
    signal: controller.signal,
    isCurrent: () => eligible,
    present(fixture) {
      if (!eligible) return;
      liveFixture = fixture;
      presentations.push(fixture);
    },
    beginAccent: () => eligible,
    executeHead(gesture, isCurrent) {
      assert.equal(gesture, "curious");
      assert.equal(isCurrent(), true, "adapter checks current ownership immediately before the mock write");
      accentGuard = isCurrent;
      headCalls += 1;
      return head.promise;
    },
    onFrames(frames) { captured = frames; },
  });

  assert.deepEqual(presentations[0], {
    voiceState: "attention",
    presentation: { mood: null, gaze: { x: 0, y: -0.16 }, expressionPhase: "prepare" },
  });
  assert.equal(headCalls, 0, "the real head adapter waits through the native face preparation phase");
  await clock.advance(150);
  assert.equal(headCalls, 1);
  assert.equal(liveFixture.presentation.expressionPhase, "accent");
  assert.equal(liveFixture.presentation.mood, "curious", "the curious accent keeps its own mood on the isolated face");
  assert.equal(accentGuard(), true);

  // Model a real mock gesture duration without changing the phase runner clock.
  await clock.advance(300);
  head.resolve({ completed: true });
  await flush();
  assert.equal(liveFixture.presentation.expressionPhase, "settle");
  await clock.advance(220);
  const result = await resultPromise;
  assert.equal(result.completed, true);
  assert.deepEqual(presentations.map(({ presentation }) => presentation?.expressionPhase ?? null), [
    "prepare", "accent", "settle", null,
  ]);
  assert.equal(liveFixture.presentation, null, "the face returns to its fixture baseline after the real-speed run");
  assert.equal(captured.length, 4);
  assert.deepEqual(captured.map(({ atMs }) => atMs), [0, 150, 450, 670]);
  assert.deepEqual(captured, result.frames);

  const frameCountBeforeReplay = presentations.length;
  const headCallsBeforeReplay = headCalls;
  const replayPresentations = [];
  let replayComplete = false;
  const stopReplay = rehearsalExpression.replayBehaviorRehearsalFrames(captured, {
    speed: 0.1,
    isCurrent: () => eligible,
    present(fixture) { replayPresentations.push(fixture); },
    schedule: (callback, delay) => clock.setTimeout(callback, delay),
    cancelScheduled: (timer) => clock.clearTimeout(timer),
    onComplete: () => { replayComplete = true; },
  });
  await clock.advance(0);
  assert.equal(replayPresentations[0].presentation.expressionPhase, "prepare");
  await clock.advance(1_500);
  assert.equal(replayPresentations.at(-1).presentation.expressionPhase, "accent");
  await clock.advance(3_000);
  assert.equal(replayPresentations.at(-1).presentation.expressionPhase, "settle");
  await clock.advance(2_200);
  assert.equal(replayPresentations.at(-1).presentation, null);
  assert.equal(replayComplete, true);
  assert.equal(presentations.length, frameCountBeforeReplay, "slow replay publishes captured frames only to its local preview target");
  assert.equal(headCalls, headCallsBeforeReplay, "10% visual replay never invokes the mock head controller");
  stopReplay();

  assert.deepEqual(rehearsalExpression.scaleBehaviorRehearsalFrames(captured).map(({ atMs }) => atMs), [0, 1_500, 4_500, 6_700]);
}

// A source/STOP invalidation interrupts the active expression before a later
// phase can write to the mock head. Panel cleanup owns clearing the visible fixture.
{
  const clock = makeClock();
  activeClock = clock;
  const controller = new AbortController();
  const head = deferred();
  let eligible = true;
  let headCalls = 0;
  let visibleFixture = null;
  const run = rehearsalExpression.runBehaviorRehearsalExpression(cue(), {
    now: clock.now,
    signal: controller.signal,
    isCurrent: () => eligible,
    present(fixture) { if (eligible) visibleFixture = fixture; },
    beginAccent: () => eligible,
    executeHead: () => { headCalls += 1; return head.promise; },
  });
  assert.equal(visibleFixture.presentation.expressionPhase, "prepare");
  eligible = false;
  controller.abort();
  // This is the panel's synchronous cleanup on STOP/source/background.
  visibleFixture = null;
  await clock.advance(150);
  assert.equal((await run).completed, false);
  assert.equal(headCalls, 0);
  assert.equal(visibleFixture, null, "invalidated source clears the isolated native face preview");
}

// Reduce Motion keeps the approved head accent but captures no spatial gaze lead.
{
  const clock = makeClock();
  activeClock = clock;
  const controller = new AbortController();
  let headCalls = 0;
  const presented = [];
  const result = await rehearsalExpression.runBehaviorRehearsalExpression(cue(), {
    now: clock.now,
    signal: controller.signal,
    isCurrent: () => true,
    reducedMotion: true,
    present: (fixture) => presented.push(fixture.presentation),
    beginAccent: () => true,
    executeHead: () => { headCalls += 1; return { completed: true }; },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(presented.map((item) => item?.expressionPhase ?? null), ["accent", null]);
  assert.equal(presented[0].gaze, undefined);
  assert.equal(headCalls, 1, "Reduce Motion retains only the already-approved head accent");
  assert.equal(clock.now(), 1_000, "reduced-motion rehearsal adds no visual hold");
}

const adapterSource = fs.readFileSync("src/behavior/behavior-rehearsal-expression.ts", "utf8");
assert.doesNotMatch(adapterSource, /behavior-runtime|useBehaviorStore|requestDecisions|fetch\s*\(/u,
  "native preview has no production behavior store, API request, or network path");
const faceSource = fs.readFileSync("src/ui/RobotFace.tsx", "utf8");
assert.match(faceSource, /fixture \? fixture\.presentation : storedBehaviorPresentation/u,
  "the native face uses the controlled rehearsal presentation instead of the production one in fixture mode");
assert.match(faceSource, /const attention = fixture \? null/u,
  "the isolated rehearsal face ignores production object and person gaze inputs");

console.log("Native behavior expression rehearsal: real face phases, isolated mock head, 10% frame replay, interruption and Reduce Motion PASS");
