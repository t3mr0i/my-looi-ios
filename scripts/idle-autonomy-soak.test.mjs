import assert from "node:assert/strict";
import { createIdleAutonomyWorld } from "./helpers/idle-autonomy-world.mjs";

// Randomized long runs of LOOI's idle life against the real controller, SDK and
// mock transport, with faults thrown in at random moments. The scenario test
// shows that each safety rule holds in the case written for it; this shows
// that no ordering of events found by chance breaks one.
//
// Three passes:
// 1. the app's original sensor model (frames every 250 ms) with the link-loss check confirmed;
// 2. the same model while the owner's link-loss confirmation is on or off and flips at random;
// 3. a robot that reports only on change, as community captures describe (no frames at rest).
const SEEDS = Number(process.env.IDLE_SOAK_SEEDS ?? 60);
const SIDE_SEEDS = Number(process.env.IDLE_SOAK_SIDE_SEEDS ?? 30);
const MINUTES_PER_SEED = Number(process.env.IDLE_SOAK_MINUTES ?? 40);
const REST_FRAME_MS = process.env.IDLE_SOAK_REST_FRAME_MS ? Number(process.env.IDLE_SOAK_REST_FRAME_MS) : null;

const { clock, connection, robot, idle, harness, settle, advance, connectMock, resetRobot, writes, seeded, MINUTE, DRIVE_PAYLOAD } = createIdleAutonomyWorld();
const SCENARIOS = ["clear", "clear", "clear", "clear", "clear", "front-edge", "rear-edge", "obstacle", "unknown"];

async function soak({ seeds, cadence, confirmation }) {
const totals = { drives: 0, forward: 0, edgeStops: 0, stopLocks: 0, yieldsDuringMotion: 0, linkLossDuringMotion: 0, repositions: 0, refusedForStop: 0, faults: 0, unconfirmedExploreChecks: 0, events: {} };
const violations = [];
/** Moments the BLE link dropped. The app cannot send a stop then; what the robot does is a hardware question. */
const linkLosses = [];
const firstWrite = writes.length;

for (let seed = 1; seed <= seeds; seed += 1) {
  const random = seeded(seed * 7919);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const between = (low, high) => low + random() * (high - low);
  await resetRobot();
  connection.setMockLooiSensorCadence(cadence);
  await connectMock("clear");
  const h = harness({ level: pick(["look", "explore", "explore", "explore"]), seed, linkLossConfirmed: confirmation === "random" ? random() < 0.5 : true });
  const startedAt = clock.now;
  const world = { scenario: "clear", unsafeSince: null, connected: true, stopLockedAt: null, levelChangedAt: startedAt };
  const fail = (rule, detail) => violations.push({ seed, rule, at: Math.round((clock.now - startedAt) / 1000), ...detail });
  h.runtime.start();
  h.interact("touch");

  const end = startedAt + MINUTES_PER_SEED * MINUTE;
  let nextInteraction = clock.now + between(1, 3) * MINUTE;
  while (clock.now < end) {
    await advance(between(3_000, 35_000));
    totals.faults += 1;
    const fault = pick(["person", "person", "person", "gone", "scenario", "scenario", "mic", "arm", "yield", "touch", "ambush", "ambush", "ambush", "level", "link", "voice", "reposition", "reposition"]);
    if (fault === "person") h.person = { bearing: pick(["left", "center", "center", "center", "right"]), distance: pick(["far", "far", "far", "near", "unknown"]) };
    else if (fault === "gone") h.person = null;
    else if (fault === "scenario") {
      world.scenario = pick(SCENARIOS);
      world.unsafeSince = world.scenario === "clear" ? null : clock.now;
      await settle(connection.setMockLooiScenario(world.scenario));
    } else if (fault === "mic") h.micLive = random() < 0.7;
    else if (fault === "arm") h.armReady = random() < 0.7;
    else if (fault === "yield") {
      const moving = robot.getLooiRobotRuntimeState().motionActive;
      h.yieldReason = pick(["conversation", "user-speaking", "background", "driving-session"]);
      if (moving) {
        totals.yieldsDuringMotion += 1;
        await advance(150);
        if (robot.getLooiRobotRuntimeState().motionActive) fail("yield-stops-motion", { reason: h.yieldReason });
      }
      await advance(between(2_000, 20_000));
      h.yieldReason = null;
    } else if (fault === "reposition") {
      // Someone lifts LOOI away from the edge and puts it down on clear table: the motion layer's
      // own edge latch is released, so only idle autonomy's memory of the edge still holds it back.
      world.scenario = "clear"; world.unsafeSince = null;
      await settle(connection.setMockLooiScenario("clear"));
      await advance(1_500);
      robot.clearLooiNearEdgeAfterManualReposition();
      totals.repositions += 1;
      h.interact("touch");
    } else if (fault === "touch") h.interact("touch");
    else if (fault === "ambush") {
      // Movements last under half a second, so chance alone almost never lands inside one.
      // Wait for LOOI's next wheel action and strike in the middle of it.
      const deadline = clock.now + 90_000;
      while (clock.now < deadline && !(robot.getLooiRobotRuntimeState().motionActive && h.armed > 0)) await advance(25);
      if (robot.getLooiRobotRuntimeState().motionActive && h.armed > 0) {
        await advance(between(10, 120));
        const strike = pick(["stop", "edge", "yield", "unlink"]);
        if (strike === "stop" && h.armed > 0 && robot.getLooiRobotRuntimeState().motionActive) {
          // A spoken STOP can only be heard while the decoder is armed, which is while LOOI's own wheels move.
          await settle(h.heardStop());
          world.stopLockedAt = clock.now;
          totals.stopLocks += 1;
          if (robot.getLooiRobotRuntimeState().motionActive) fail("stop-halts-motion", {});
        } else if (strike === "edge") {
          world.scenario = pick(["front-edge", "rear-edge"]);
          world.unsafeSince = clock.now;
          await settle(connection.setMockLooiScenario(world.scenario));
        } else if (strike === "yield") {
          h.yieldReason = pick(["conversation", "user-speaking", "background"]);
          totals.yieldsDuringMotion += 1;
          await advance(150);
          if (robot.getLooiRobotRuntimeState().motionActive) fail("yield-stops-motion", { reason: h.yieldReason });
          await advance(between(2_000, 10_000));
          h.yieldReason = null;
        } else if (strike === "unlink") {
          world.connected = false;
          linkLosses.push(clock.now);
          totals.linkLossDuringMotion += 1;
          await settle(connection.setMockLooiConnected(false));
          await advance(between(2_000, 10_000));
          world.connected = true;
          await settle(connection.setMockLooiConnected(true));
        }
      }
    } else if (fault === "level") {
      h.level = pick(["off", "look", "explore"]);
      world.levelChangedAt = clock.now;
      world.stopLockedAt = null;
      h.interact("touch");
    } else if (fault === "link") {
      world.connected = !world.connected;
      if (!world.connected) linkLosses.push(clock.now);
      await settle(connection.setMockLooiConnected(world.connected));
      if (world.connected) { world.unsafeSince = world.scenario === "clear" ? null : clock.now; }
    } else if (fault === "voice") {
      h.samples(Array.from({ length: 1_600 }, (_, i) => 0.2 * Math.sin(i / 5)));
      h.samples(Array.from({ length: 1_600 }, (_, i) => 0.2 * Math.sin(i / 5)));
    }
    if (clock.now >= nextInteraction) { h.interact("touch"); nextInteraction = clock.now + between(1, 4) * MINUTE; }
    if (confirmation === "random") {
      // The owner changes the link-loss confirmation now and then, also in the middle of a movement.
      if (random() < 0.08) h.linkLossConfirmed = !h.linkLossConfirmed;
      if (!h.linkLossConfirmed && h.level === "explore") totals.unconfirmedExploreChecks += 1;
    }

    // Checked after every fault: what happened since the previous check.
    if (world.stopLockedAt !== null) {
      const after = h.drives.filter((drive) => drive.at > world.stopLockedAt);
      if (after.length) fail("stop-locks-until-setting-changes", { drives: after.length });
    }
  }
  h.runtime.stop();
  await advance(2_000);
  if (!world.connected) await settle(connection.setMockLooiConnected(true));

  // --- Rules over the whole run -------------------------------------------------
  const drives = h.drives;
  totals.drives += drives.length;
  for (const event of h.events) totals.events[event.type] = (totals.events[event.type] ?? 0) + 1;
  for (const drive of drives) {
    const where = { direction: drive.direction, t: Math.round((drive.at - startedAt) / 1000) };
    if (!drive.armedAtStart) fail("stop-decoder-armed-before-wheels", where);
    if (!drive.micLiveAtStart) fail("no-wheels-without-microphone", where);
    if (drive.yieldAtStart) fail("no-wheels-while-yielding", { ...where, reason: drive.yieldAtStart });
    if (drive.levelAtStart === "off") fail("off-never-moves", where);
    if (!drive.connectedAtStart) fail("no-wheels-while-disconnected", where);
    if (drive.direction === "forward") {
      totals.forward += 1;
      if (drive.levelAtStart !== "explore") fail("only-explore-drives-forward", where);
      if (!drive.linkLossConfirmedAtStart) fail("no-step-without-link-loss-check", where);
      if (drive.durationMs > idle.MAX_AUTONOMOUS_STEP_MS) fail("step-length-capped", { ...where, ms: drive.durationMs });
    } else if (drive.direction === "left" || drive.direction === "right") {
      if (drive.durationMs > idle.MAX_AUTONOMOUS_TURN_MS) fail("turn-length-capped", { ...where, ms: drive.durationMs });
    } else fail("only-forward-and-turns", where);
  }
  // Budgets over sliding windows.
  const inWindow = (list, at, ms) => list.filter((drive) => drive.at > at - ms && drive.at <= at).length;
  for (const drive of drives) {
    if (inWindow(drives, drive.at, MINUTE) > idle.MAX_WHEEL_ACTIONS_PER_MINUTE) fail("wheel-actions-per-minute", { t: drive.at - startedAt });
    if (inWindow(drives, drive.at, 10 * MINUTE) > idle.MAX_WHEEL_ACTIONS_PER_TEN_MINUTES) fail("wheel-actions-per-ten-minutes", { t: drive.at - startedAt });
    if (drive.direction === "forward" && inWindow(drives.filter((item) => item.direction === "forward"), drive.at, 10 * MINUTE) > idle.MAX_TRANSLATIONS_PER_TEN_MINUTES) fail("forward-steps-per-ten-minutes", { t: drive.at - startedAt });
  }
  for (let i = 1; i < drives.length; i += 1) {
    if (drives[i].at - drives[i - 1].at < idle.MIN_PAUSE_BETWEEN_WHEEL_ACTIONS_MS) fail("pause-between-wheel-actions", { gapMs: drives[i].at - drives[i - 1].at });
  }
  // After an edge stopped a movement: no wheels for two minutes, no forward step for fifteen.
  const edgeStops = h.logs.filter((entry) => entry.event === "edge-stop");
  totals.edgeStops += edgeStops.length;
  for (const stop of edgeStops) {
    for (const drive of drives) {
      const since = drive.at - stop.at;
      if (since > 0 && since < idle.EDGE_WHEEL_PAUSE_MS) fail("no-wheels-right-after-edge", { sinceMs: since, direction: drive.direction });
      if (since > 0 && since < idle.EDGE_TRANSLATION_LOCK_MS && drive.direction === "forward") fail("no-forward-after-edge", { sinceMs: since });
    }
  }
  totals.refusedForStop += h.logs.filter((entry) => entry.event === "stop-listener-unavailable").length;
  if (h.armed !== 0) fail("decoder-disarmed-at-the-end", { armed: h.armed });
  if (h.arms.length !== h.disarms + h.arms.filter(() => false).length && h.arms.length < h.disarms) fail("disarm-without-arm", {});
}

// --- Rules on the wire, over every seed: what the mock robot actually received -----
const driveWrites = writes.slice(firstWrite).filter((write) => write.action === "drive");
let moving = null;
for (const write of driveWrites) {
  const stopped = /^0+$/u.test(write.detail);
  if (!stopped && !DRIVE_PAYLOAD[write.detail]) violations.push({ rule: "only-known-drive-payloads", payload: write.detail });
  if (!stopped && DRIVE_PAYLOAD[write.detail] === "back") violations.push({ rule: "idle-life-never-reverses", at: write.at });
  if (!stopped) moving ??= write.at;
  else if (moving !== null) {
    // Every movement is followed by a stop within the longest allowed action plus the BLE deadline slack.
    // A dropped link is the one case where the app cannot end a movement itself.
    const linkLost = linkLosses.some((at) => at >= moving && at <= write.at);
    if (!linkLost && write.at - moving > Math.max(idle.MAX_AUTONOMOUS_STEP_MS, idle.MAX_AUTONOMOUS_TURN_MS) + 600) violations.push({ rule: "every-movement-ends-in-time", ms: write.at - moving });
    moving = null;
  }
}
if (moving !== null && !linkLosses.some((at) => at >= moving)) violations.push({ rule: "wheels-parked-at-the-end", since: moving });
await resetRobot();
connection.setMockLooiSensorCadence({ cadence: "periodic" });
return { totals, violations };
}

const summary = (label, seeds, totals) => `${label}: ${seeds} seeds x ${MINUTES_PER_SEED} virtual minutes, ${totals.faults} faults, ${totals.drives} wheel actions (${totals.forward} forward), ${totals.edgeStops} edge stops, ${totals.stopLocks} STOP locks, ${totals.refusedForStop} refusals without STOP decoder, ${totals.yieldsDuringMotion} yields during motion, ${totals.linkLossDuringMotion} link losses during motion, ${totals.repositions} manual repositions; events ${JSON.stringify(totals.events)}; 0 violations`;

{
  const { totals, violations } = await soak({ seeds: SEEDS, cadence: { cadence: "periodic" }, confirmation: "confirmed" });
  if (process.env.IDLE_SOAK_VERBOSE) console.log(JSON.stringify(totals));
  assert.deepEqual(violations.slice(0, 12), [], `${violations.length} safety rule violations`);
  // The run must have exercised what it claims to prove.
  assert.ok(totals.drives >= 150, `enough wheel actions to mean something: ${totals.drives}`);
  assert.ok(totals.forward >= 10, `forward steps happened: ${totals.forward}`);
  assert.ok(totals.edgeStops >= 5, `edges were hit during movement: ${totals.edgeStops}`);
  assert.ok(totals.stopLocks >= 5, `STOP was heard during movement: ${totals.stopLocks}`);
  assert.ok(totals.yieldsDuringMotion >= 5, `conversations started during movement: ${totals.yieldsDuringMotion}`);
  assert.ok(totals.refusedForStop >= 5, `wheels were refused for a missing STOP decoder: ${totals.refusedForStop}`);
  console.log(`Idle autonomy soak, ${summary("250 ms sensor stream, link-loss check confirmed", SEEDS, totals)} PASS`);
}
{
  const { totals, violations } = await soak({ seeds: SIDE_SEEDS, cadence: { cadence: "periodic" }, confirmation: "random" });
  if (process.env.IDLE_SOAK_VERBOSE) console.log(JSON.stringify(totals));
  assert.deepEqual(violations.slice(0, 12), [], `${violations.length} safety rule violations`);
  assert.ok(totals.unconfirmedExploreChecks >= 50, `explore ran unconfirmed often enough: ${totals.unconfirmedExploreChecks}`);
  assert.ok(totals.forward >= 1, `steps still happened while confirmed: ${totals.forward}`);
  console.log(`Idle autonomy soak, ${summary("link-loss confirmation flipping", SIDE_SEEDS, totals)}, ${totals.unconfirmedExploreChecks} unconfirmed explore checkpoints PASS`);
}
{
  const cadence = { cadence: "on-change", restFrameIntervalMs: REST_FRAME_MS };
  const { totals, violations } = await soak({ seeds: SIDE_SEEDS, cadence, confirmation: "confirmed" });
  if (process.env.IDLE_SOAK_VERBOSE) console.log(JSON.stringify(totals));
  assert.deepEqual(violations.slice(0, 12), [], `${violations.length} safety rule violations`);
  console.log(`Idle autonomy soak, ${summary(`on-change sensor frames${REST_FRAME_MS ? `, edge frame every ${REST_FRAME_MS} ms at rest` : ", none at rest"}`, SIDE_SEEDS, totals)} PASS`);
}
