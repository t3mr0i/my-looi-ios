import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const fed9 = loadTypeScript("src/device-tools/fed9-sensors.ts");
const api = loadTypeScript("src/robot-mind/device-check.ts", { "../device-tools/fed9-sensors": fed9 });

const windows = (steps, start = 10_000) => ({
  outcome: "complete",
  windows: steps.map((step, i) => {
    const from = start + i * 7000 + 3000;
    return { step, from, to: from + 3000, motion: false };
  }),
});
const frame = (at, hex, seeded) => (seeded ? { at, hex, seeded } : { at, hex });
const run = (steps, mutate) => { const r = windows(steps); mutate?.(r); return r; };
const at = (run, i, offset) => run.windows[i].from + offset;

// Blockers
const fine = { connected: true, driveControlReady: true, idleAutonomyLevel: "off", ambientMotionLevel: "off", cameraAttentionEnabled: false };
assert.deepEqual(api.deviceCheckBlockersFor(fine), []);
assert.deepEqual(api.deviceCheckBlockersFor({ connected: false, driveControlReady: true, idleAutonomyLevel: "look", ambientMotionLevel: "subtle", cameraAttentionEnabled: true }),
  ["not-connected", "autonomy-on", "ambient-on", "camera-on"]);
assert.deepEqual(api.deviceCheckBlockersFor({ ...fine, driveControlReady: false }), ["not-connected"]);

// Hold runner
function holdHarness({ readyAt = Infinity, disconnectAt = null, motionAt = null, cancelAt = null } = {}) {
  let now = 1_000_000;
  let readyCount = 0;
  const readyResolved = [];
  const phases = [];
  const deps = {
    now: () => now,
    async wait(ms) { now += ms; },
    async ready(step) { readyCount += 1; if (readyCount >= readyAt) return false; readyResolved.push(now); return true; },
    phase(step, phase) { phases.push(`${step}:${phase}`); },
    cancelled: () => cancelAt !== null && now >= cancelAt,
    robot: () => ({ connected: disconnectAt === null || now < disconnectAt, motionActive: motionAt !== null && now >= motionAt && now < motionAt + 100 }),
  };
  return { deps, readyResolved, phases, start: now };
}
{
  const h = holdHarness();
  const steps = ["a", "b", "c", "d"];
  const result = await api.runHoldSequence(h.deps, steps);
  assert.equal(result.outcome, "complete");
  assert.equal(result.windows.length, 4);
  result.windows.forEach((w, i) => {
    assert.ok(w.to - w.from >= 3000);
    assert.ok(w.from - h.readyResolved[i] >= 3000);
    assert.ok(h.phases.indexOf(`${w.step}:positioning`) < h.phases.indexOf(`${w.step}:holding`));
    assert.equal(w.motion, false);
  });
}
{
  const result = await api.runHoldSequence(holdHarness({ readyAt: 2 }).deps, ["a", "b", "c"]);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.windows.length, 1);
}
{
  const h = holdHarness({ disconnectAt: 1_000_000 + 4_000 });
  const result = await api.runHoldSequence(h.deps, ["a", "b"]);
  assert.equal(result.outcome, "disconnected");
  assert.equal(result.windows.length, 0);
}
{
  // step 3 holds from 1_015_000 to 1_018_000 (3 s countdown then 3 s hold per step, ready is instant)
  const result = await api.runHoldSequence(holdHarness({ motionAt: 1_000_000 + 16_000 }).deps, ["a", "b", "c", "d"]);
  assert.deepEqual(result.windows.map((w) => w.motion), [false, false, true, false]);
}
{
  const result = await api.runHoldSequence(holdHarness({ cancelAt: 1_000_000 + 1_000 }).deps, ["a", "b"]);
  assert.equal(result.outcome, "cancelled");
}

// Lift
const liftRun = windows(api.LIFT_POSES);
const L = (i, offset) => at(liftRun, i, offset);
const seed = frame(9_000, "0101010101", true);
{
  const report = api.evaluateLift(liftRun, [seed, frame(L(0, 500), "0101010101"), frame(L(1, 500), "0101010000"), frame(L(1, 800), "021a00"),
    frame(L(2, 500), "0100010101"), frame(L(3, 500), "0101010000")]);
  assert.equal(report.verdict, "partial");
  assert.deepEqual(report.liftedNoGround, ["rearLeft", "rearRight"]);
  assert.equal(report.liftedFrontGround, true);
  assert.equal(report.mappingConsistent, true);
  assert.deepEqual(report.otherTypesChanged, ["02@lifted+front_lifted+rear_lifted"]);
  assert.equal(report.poses[1].rawFlags, "11100");
  assert.deepEqual(report.poses[2].noGround, ["frontLeft"]);
}
{
  const report = api.evaluateLift(liftRun, [seed, frame(L(0, 500), "0101010101"), frame(L(1, 500), "0100000000"), frame(L(2, 500), "0100010101"), frame(L(3, 500), "0101010000")]);
  assert.equal(report.verdict, "all_four");
  assert.equal(report.liftedFrontGround, false);
}
{
  // Change-only robot: the lifted frame arrives in the countdown, nothing during the measurement.
  const countdown = liftRun.windows[1].from - 1000;
  const report = api.evaluateLift(liftRun, [seed, frame(L(0, 500), "0101010101"), frame(countdown, "0101010000")]);
  assert.equal(report.poses[1].fresh, true);
  assert.equal(report.poses[1].rawFlags, "11100");
  assert.equal(report.verdict, "partial");
  // Same frames identical later, none lifted: robot never reported a change.
  assert.equal(api.evaluateLift(liftRun, [seed, frame(L(0, 500), "0101010101"), frame(L(1, 500), "0101010101"), frame(L(2, 500), "0101010101")]).verdict, "none");
}
assert.equal(api.evaluateLift(liftRun, [seed, frame(L(0, 500), "021a00"), frame(L(1, 500), "021a00")]).verdict, "no_frames");
{
  const ok = [seed, frame(L(0, 500), "0101010101"), frame(L(1, 500), "0101010000")];
  const withMotion = run(api.LIFT_POSES, (r) => { r.windows[2].motion = true; });
  assert.deepEqual([api.evaluateLift(withMotion, ok).verdict, api.evaluateLift(withMotion, ok).invalidReason], ["invalid", "motion"]);
  const badTable = api.evaluateLift(liftRun, [seed, frame(L(0, 500), "0100010101")]);
  assert.deepEqual([badTable.verdict, badTable.invalidReason], ["invalid", "table-not-on-ground"]);
  const partial = { outcome: "cancelled", windows: liftRun.windows.slice(0, 2) };
  const incomplete = api.evaluateLift(partial, ok);
  assert.deepEqual([incomplete.verdict, incomplete.invalidReason], ["invalid", "incomplete"]);
}

// ToF
const tofRun = windows(api.TOF_STEPS);
const T = (i, offset = 500) => at(tofRun, i, offset);
const tofFrames = (hexes, offset) => hexes.flatMap((hex, i) => (hex ? [frame(T(i, offset), hex)] : []));
{
  const report = api.evaluateTof(tofRun, tofFrames(["0eff1f", "0e9001", "0ec800", "0e6400", "0e3200", "0eff1f"], 500));
  assert.equal(report.verdict, "distance_like");
  assert.equal(report.responsiveSteps, 4);
  assert.equal(report.monotonic, true);
  assert.equal(report.separated, true);
  assert.deepEqual(report.nearSteps, ["cm5", "cm10"]);
  assert.deepEqual(report.steps[4].values, ["0e3200"]);
}
{
  const countdown = -1000;
  const report = api.evaluateTof(tofRun, tofFrames(["0eff1f", "0e9001", "0ec800", "0e6400", "0e3200", "0eff1f"], countdown));
  assert.equal(report.verdict, "distance_like");
}
{
  const report = api.evaluateTof(tofRun, tofFrames([null, "0e4200", "0e7501", "0effff", "0ed305", null], 500));
  assert.equal(report.verdict, "not_a_distance");
  assert.equal(report.monotonic, false);
}
{
  const report = api.evaluateTof(tofRun, tofFrames(Array(6).fill("0effff"), 500));
  assert.equal(report.verdict, "not_a_distance");
  assert.equal(report.separated, false);
}
{
  const report = api.evaluateTof(tofRun, [frame(T(0), "0101010101"), frame(T(2), "0101010101")]);
  assert.equal(report.verdict, "no_frames");
  assert.equal(report.totalFrames, 0);
}
{
  const withMotion = run(api.TOF_STEPS, (r) => { r.windows[3].motion = true; });
  const report = api.evaluateTof(withMotion, tofFrames(["0eff1f", "0e9001", "0ec800", "0e6400", "0e3200", "0eff1f"], 500));
  assert.deepEqual([report.verdict, report.invalidReason], ["invalid", "motion"]);
}

// Link loss evaluation
const base = { attempt: 1, started: true, blockReason: null, startedAt: 1000, cutAt: 1400, cutDirection: "left", appLeftActiveAt: null, reconnectedAt: 6000, answer: "within_1s" };
const evalAttempt = (more) => api.evaluateLinkLossAttempt({ ...base, ...more });
assert.equal(evalAttempt({}).valid, true);
assert.equal(evalAttempt({ appLeftActiveAt: 1200 }).invalidReason, "app-left-foreground");
assert.equal(evalAttempt({ appLeftActiveAt: 2000 }).valid, true);
assert.equal(evalAttempt({ reconnectedAt: 2900 }).invalidReason, "reconnected-too-early");
assert.equal(evalAttempt({ started: false, blockReason: "cliff-turn" }).invalidReason, "not-started");
assert.equal(evalAttempt({ cutAt: null }).invalidReason, "no-cut");
assert.equal(evalAttempt({ answer: null }).invalidReason, "no-answer");

const attemptOf = (answer, valid = true) => ({ ...base, answer, valid, invalidReason: valid ? null : "app-left-foreground" });
const summarise = (...attempts) => { const s = api.evaluateLinkLoss(attempts); return [s.verdict, s.recommendation]; };
assert.deepEqual(summarise(attemptOf("within_1s"), attemptOf("within_1s")), ["stops", "confirm-steps"]);
assert.deepEqual(summarise(attemptOf("within_1s")), ["needs_more", "repeat"]);
assert.deepEqual(summarise(attemptOf("within_1s"), attemptOf("kept_going")), ["keeps_going", "keep-unchecked-autonomy-off"]);
assert.deepEqual(summarise(attemptOf("later"), attemptOf("within_1s")), ["stops_late", "keep-unchecked"]);
assert.deepEqual(summarise(attemptOf(null, false), attemptOf(null, false)), ["undecided", "repeat"]);
{
  const s = api.evaluateLinkLoss([attemptOf("within_1s", false), attemptOf("within_1s")]);
  assert.equal(s.verdict, "needs_more");
  assert.equal(s.validAttempts, 1);
  assert.equal(s.attempts, 2);
}

// Link loss runner
function linkHarness({ appLeftAfter = null, neverStarts = false, reconnectAfterCut = null, cutResult = { cut: true, direction: "left" }, cancelAfter = null } = {}) {
  let now = 500_000;
  const cancelAt = cancelAfter === null ? null : now + cancelAfter;
  const t0 = now;
  const calls = {};
  let turnAt = null;
  let cutAt = null;
  let connected = true;
  const deps = {
    now: () => now,
    async wait(ms) { now += ms; },
    robot: () => {
      const moving = !neverStarts && turnAt !== null && now >= turnAt + 100 && cutAt === null;
      if (cutAt !== null && reconnectAfterCut !== null && now >= cutAt + reconnectAfterCut) connected = true;
      return { connected, driveControlReady: connected, motionActive: moving, activeDirection: moving ? "left" : null, lastMotionBlockReason: neverStarts ? "cliff-turn" : null };
    },
    appActive: () => appLeftAfter === null || now < t0 + appLeftAfter,
    startTurn() { turnAt = now; calls.startTurn = now; },
    async cutLink() { calls.cut = now; cutAt = now; if (cutResult.cut) connected = false; return cutResult; },
    reconnect() { calls.reconnect = (calls.reconnect ?? []).concat(now); },
    phase() {},
    cancelled: () => cancelAt !== null && now >= cancelAt,
    async ask() { calls.ask = (calls.ask ?? []).concat(now); return "within_1s"; },
  };
  return { deps, calls };
}
{
  const h = linkHarness();
  const result = await api.runLinkLossAttempt(h.deps, 1);
  assert.equal(result.valid, true);
  assert.ok(h.calls.cut - result.startedAt >= 400 && h.calls.cut - result.startedAt <= 450, `cut ${h.calls.cut - result.startedAt} ms after start`);
  assert.equal(h.calls.reconnect.length, 1);
  assert.ok(h.calls.reconnect[0] >= h.calls.cut + 4000);
  assert.equal(h.calls.ask.length, 1);
  assert.ok(h.calls.reconnect[0] <= h.calls.ask[0]);
}
{
  const result = await api.runLinkLossAttempt(linkHarness({ appLeftAfter: 200 }).deps, 1);
  assert.equal(result.valid, false);
  assert.equal(result.invalidReason, "app-left-foreground");
}
{
  const h = linkHarness({ neverStarts: true });
  const result = await api.runLinkLossAttempt(h.deps, 1);
  assert.equal(result.invalidReason, "not-started");
  assert.equal(result.blockReason, "cliff-turn");
  assert.equal(h.calls.cut, undefined);
  assert.equal(h.calls.ask, undefined);
}
assert.equal((await api.runLinkLossAttempt(linkHarness({ reconnectAfterCut: 1000 }).deps, 1)).invalidReason, "reconnected-too-early");
{
  const h = linkHarness({ cutResult: { cut: false, direction: null } });
  const result = await api.runLinkLossAttempt(h.deps, 1);
  assert.equal(result.invalidReason, "no-cut");
  assert.equal(h.calls.ask, undefined);
}

{
  // Cancelled during the turn, before the cut: no cut, no ask, no result to record.
  const h = linkHarness({ cancelAfter: 250 });
  assert.equal(await api.runLinkLossAttempt(h.deps, 1), null);
  assert.equal(h.calls.cut, undefined);
  assert.equal(h.calls.ask, undefined);
  assert.equal(h.calls.reconnect, undefined);
}

// Link-loss gate: only the most recent real-hardware verdict counts, and only "stops"
const verdictEntry = (verdict, extra = {}) => ({ category: "robot", event: "device-check-link-loss", details: { verdict, mock: false, ...extra } });
const gate = (...entries) => api.linkLossStopRecorded(entries);
assert.equal(gate(verdictEntry("stops")), true);
for (const v of ["keeps_going", "stops_late", "needs_more", "undecided"]) assert.equal(gate(verdictEntry(v)), false, v);
assert.equal(gate(), false);
assert.equal(gate(verdictEntry("stops"), verdictEntry("keeps_going")), false);
assert.equal(gate(verdictEntry("stops"), verdictEntry("stops_late")), false);
assert.equal(gate(verdictEntry("keeps_going"), verdictEntry("stops")), true);
assert.equal(gate(verdictEntry("stops"), { category: "robot", event: "device-check-link-loss-attempt", details: { verdict: "keeps_going", mock: false } }), true);
assert.equal(gate({ category: "robot", event: "device-check-head", details: { verdict: "stops", mock: false } }), false);
assert.equal(gate(verdictEntry("stops", { mock: true })), false);
assert.equal(gate({ category: "robot", event: "device-check-link-loss", details: { verdict: "stops" } }), false);
assert.equal(gate(verdictEntry("stops"), verdictEntry("keeps_going", { mock: true })), true);
assert.equal(gate(verdictEntry("keeps_going"), verdictEntry("stops", { mock: true })), false);

// Head
const headDeps = ({ w87 = true, w5a = true, ready5a = true, answer = "5a" } = {}) => {
  const counts = { restore: 0 };
  return { counts, deps: {
    async ready(step) { return step === "head_5a" ? ready5a : true; },
    async setHead(value) { return value === "87" ? w87 : w5a; },
    async ask() { return answer; },
    async restore() { counts.restore += 1; },
  } };
};
{
  const h = headDeps();
  assert.equal((await api.runHeadCheck(h.deps)).verdict, "level_5a");
  assert.equal(h.counts.restore, 1);
}
assert.equal((await api.runHeadCheck(headDeps({ w5a: false }).deps)).verdict, "incomplete");
{
  const h = headDeps({ ready5a: false });
  assert.equal(await api.runHeadCheck(h.deps), null);
  assert.equal(h.counts.restore, 1);
}
assert.equal(await api.runHeadCheck(headDeps({ answer: null }).deps), null);

console.log("Device check logic tests passed");
