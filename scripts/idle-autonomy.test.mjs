import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

// The pure idle-life state machine with seeded randomness and simulated time:
// no timers, no robot, no stores.
const idle = loadTypeScript("src/robot-mind/idle-autonomy.ts", {});
const { createInitialRobotBodyState } = loadTypeScript("src/robot-mind/body-state.ts", {});

const MINUTE = 60_000;
const START = 1_000_000;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function body(now, people = null) {
  const state = createInitialRobotBodyState(START);
  if (people) {
    state.people = {
      visible: 1,
      attended: { bearing: people.bearing ?? "center", distance: people.distance ?? "far", since: START },
      lastSeenAt: now,
    };
  }
  return state;
}

function facts(now, overrides = {}) {
  return {
    now,
    level: "look",
    body: body(now),
    yieldReason: null,
    lastInteractionAt: null,
    robotReady: true,
    otherMotionBusy: false,
    turnSurfaceSafe: true,
    forwardSurfaceSafe: true,
    linkLossSelfStopConfirmed: true,
    stopListenerLive: true,
    cameraAvailable: true,
    ...overrides,
  };
}

/** Drive the machine like the runtime does: 500 ms ticks, actions take their own time. */
function simulate(machine, { from = START, durationMs, factsAt, outcome = () => "completed", onDecision }) {
  const actions = [];
  const events = [];
  const modes = [];
  let now = from;
  while (now < from + durationMs) {
    const decision = machine.decide(factsAt(now));
    modes.push({ at: now, mode: decision.mode, camera: decision.camera });
    events.push(...decision.events);
    onDecision?.(decision, now);
    if (decision.action.kind === "wait") {
      now += 500;
      continue;
    }
    const took = decision.action.durationMs ?? 700;
    actions.push({ at: now, end: now + took, mode: decision.mode, ...decision.action });
    now += took;
    machine.observe(outcome(decision.action, now), now);
  }
  return { actions, events, modes, now };
}

const wheel = (actions) => actions.filter((action) => action.kind === "turn" || action.kind === "step");

test("level off never moves anything", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(1), startedAt: START });
  const run = simulate(machine, { durationMs: 30 * MINUTE, factsAt: (now) => facts(now, { level: "off", body: body(now, { distance: "far" }) }) });
  assert.deepEqual(run.actions, []);
  assert.ok(run.modes.every(({ mode, camera }) => mode === "resting" && camera === "off"));
});

test("look: head and turns only, inside every budget, mostly resting, then winds down for sleep", () => {
  let turned = 0;
  let calmer = 0;
  for (let seed = 1; seed <= 10; seed += 1) {
    const machine = idle.createIdleAutonomy({ random: seeded(seed), startedAt: START });
    const run = simulate(machine, { durationMs: 15 * MINUTE, factsAt: (now) => facts(now) });
    const turns = wheel(run.actions);
    if (turns.length) turned += 1;
    assert.ok(run.actions.some((action) => action.kind === "head" || action.kind === "head_gesture"), "LOOI looks around");
    assert.equal(run.actions.filter((action) => action.kind === "step").length, 0, "look never translates");
    assert.ok(turns.every((action) => action.durationMs <= idle.MAX_AUTONOMOUS_TURN_MS));

    assert.ok(run.actions[0].at - START >= idle.START_AFTER_INTERACTION_MS, "nothing right after start/interaction");
    for (const action of turns) {
      const lastMinute = turns.filter((other) => other.at <= action.at && action.at - other.at < MINUTE);
      const lastTen = turns.filter((other) => other.at <= action.at && action.at - other.at < 10 * MINUTE);
      assert.ok(lastMinute.length <= idle.MAX_WHEEL_ACTIONS_PER_MINUTE, "per-minute wheel budget");
      assert.ok(lastTen.length <= idle.MAX_WHEEL_ACTIONS_PER_TEN_MINUTES, "ten-minute wheel budget");
    }
    for (let index = 1; index < run.actions.length; index += 1) {
      assert.ok(run.actions[index].at - run.actions[index - 1].end >= idle.MIN_PAUSE_BETWEEN_ACTIONS_MS, "minimum pause between actions");
    }
    for (let index = 1; index < turns.length; index += 1) {
      assert.ok(turns[index].at - turns[index - 1].at >= idle.MIN_PAUSE_BETWEEN_WHEEL_ACTIONS_MS, "minimum pause between wheel actions");
    }

    const awakeMs = idle.WIND_DOWN_AFTER_MS - idle.START_AFTER_INTERACTION_MS;
    const movingMs = run.actions.reduce((sum, action) => sum + (action.end - action.at), 0);
    assert.ok(movingMs < awakeMs * 0.2, `far more rest than motion (${movingMs} of ${awakeMs} ms)`);

    const after = run.actions.filter((action) => action.at >= START + idle.WIND_DOWN_AFTER_MS);
    assert.deepEqual(after, [], "no idle motion keeps LOOI awake past the wind-down; auto sleep can take over");
    const early = run.actions.filter((action) => action.at < START + idle.DROWSY_AFTER_MS).length / (idle.DROWSY_AFTER_MS - idle.START_AFTER_INTERACTION_MS);
    const late = run.actions.filter((action) => action.at >= START + idle.DROWSY_AFTER_MS).length / (idle.WIND_DOWN_AFTER_MS - idle.DROWSY_AFTER_MS);
    if (late < early) calmer += 1;
  }
  assert.ok(turned >= 8, `LOOI turns in place in most idle periods (${turned}/10)`);
  assert.ok(calmer >= 8, `calmer the longer nothing happens (${calmer}/10)`);
});

test("seeking turns in bounded steps and gives up with search_gave_up", () => {
  let searched = 0;
  for (let seed = 1; seed <= 10; seed += 1) {
    const machine = idle.createIdleAutonomy({ random: seeded(seed), startedAt: START });
    const run = simulate(machine, { durationMs: 10 * MINUTE, factsAt: (now) => facts(now) });
    const gaveUp = run.events.filter((event) => event.type === "search_gave_up");
    const searchTurns = run.actions.filter((action) => action.purpose === "search");
    if (gaveUp.length) searched += 1;
    for (let index = 1; index < gaveUp.length; index += 1) {
      assert.ok(gaveUp[index].at - gaveUp[index - 1].at >= idle.SEARCH_COOLDOWN_MS, "searches are separated by the cooldown");
    }
    assert.ok(searchTurns.length <= (gaveUp.length + 1) * idle.MAX_SEARCH_STEPS, "each search has a bounded number of turns");
    assert.ok(searchTurns.every((action) => action.durationMs <= idle.MAX_AUTONOMOUS_TURN_MS));
    if (gaveUp.length) {
      assert.ok(run.modes.some(({ mode, camera }) => mode === "seeking_person" && camera === "look"), "the camera looks while seeking");
    }
  }
  assert.ok(searched >= 7, `most idle periods include a search for people (${searched}/10)`);
});

test("without a camera there is no seeking", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(3), startedAt: START });
  const run = simulate(machine, { durationMs: 9 * MINUTE, factsAt: (now) => facts(now, { cameraAvailable: false }) });
  assert.ok(run.modes.every(({ mode, camera }) => mode !== "seeking_person" && camera === "off"));
  assert.deepEqual(run.events, []);
});

test("explore: approaches a far, centred person in bounded steps and reports arrival", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(11), startedAt: START });
  let steps = 0;
  const run = simulate(machine, {
    durationMs: 3 * MINUTE,
    factsAt: (now) => facts(now, { level: "explore", body: body(now, { distance: steps >= 2 ? "near" : "far" }) }),
    onDecision: (decision) => { if (decision.action.kind === "step") steps += 1; },
  });
  const forward = run.actions.filter((action) => action.kind === "step");
  assert.equal(forward.length, 2, "two steps, then the person is near");
  assert.ok(forward.every((action) => action.direction === "forward" && action.durationMs <= idle.MAX_AUTONOMOUS_STEP_MS));
  assert.deepEqual(run.events.filter((event) => event.type === "arrived_at_person").length, 1);
  assert.ok(run.modes.some(({ mode }) => mode === "approaching"));
  assert.ok(run.modes.some(({ mode }) => mode === "attending"));
});

test("explore: never more than the consecutive-step limit toward a person who stays far", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(5), startedAt: START });
  const run = simulate(machine, { durationMs: 4 * MINUTE, factsAt: (now) => facts(now, { level: "explore", body: body(now, { distance: "far" }) }) });
  const forward = run.actions.filter((action) => action.kind === "step");
  assert.equal(forward.length, idle.MAX_CONSECUTIVE_APPROACH_STEPS, "approach gives up and cools down");
  assert.equal(run.events.filter((event) => event.type === "arrived_at_person").length, 0);
});

test("explore turns toward an off-centre person before stepping", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(5), startedAt: START });
  let bearing = "left";
  const run = simulate(machine, {
    durationMs: 2 * MINUTE,
    factsAt: (now) => facts(now, { level: "explore", body: body(now, { distance: "far", bearing }) }),
    onDecision: (decision) => { if (decision.action.kind === "turn") bearing = "center"; },
  });
  const first = wheel(run.actions)[0];
  assert.deepEqual([first.kind, first.direction, first.purpose], ["turn", "left", "attend"]);
  assert.ok(run.actions.some((action) => action.kind === "step"));
});

test("look never steps toward a far person", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(5), startedAt: START });
  const run = simulate(machine, { durationMs: 8 * MINUTE, factsAt: (now) => facts(now, { body: body(now, { distance: "far" }) }) });
  assert.equal(run.actions.filter((action) => action.kind === "step").length, 0);
  assert.ok(run.modes.some(({ mode }) => mode === "attending"));
});

test("unknown surface, missing STOP listener or an unready base keep the wheels still", () => {
  for (const override of [
    { forwardSurfaceSafe: false, turnSurfaceSafe: false },
    { stopListenerLive: false },
  ]) {
    const machine = idle.createIdleAutonomy({ random: seeded(9), startedAt: START });
    const run = simulate(machine, { durationMs: 9 * MINUTE, factsAt: (now) => facts(now, { level: "explore", body: body(now, { distance: "far" }), ...override }) });
    assert.deepEqual(wheel(run.actions), [], JSON.stringify(override));
    assert.ok(run.actions.length > 0, "head-only life continues");
  }
  const forwardUnknown = idle.createIdleAutonomy({ random: seeded(9), startedAt: START });
  const run = simulate(forwardUnknown, { durationMs: 6 * MINUTE, factsAt: (now) => facts(now, { level: "explore", forwardSurfaceSafe: false, body: body(now, { distance: "far" }) }) });
  assert.equal(run.actions.filter((action) => action.kind === "step").length, 0, "an unknown front surface forbids steps");

  const disconnected = idle.createIdleAutonomy({ random: seeded(9), startedAt: START });
  assert.deepEqual(simulate(disconnected, { durationMs: 9 * MINUTE, factsAt: (now) => facts(now, { robotReady: false }) }).actions, []);
});

test("explore takes no step until the owner confirmed the robot stops by itself on link loss", () => {
  // No source establishes that LOOI stops when the BLE link drops mid-move; until the owner checked, explore only turns.
  const machine = idle.createIdleAutonomy({ random: seeded(5), startedAt: START });
  const run = simulate(machine, { durationMs: 8 * MINUTE, factsAt: (now) => facts(now, { level: "explore", linkLossSelfStopConfirmed: false, body: body(now, { distance: "far" }) }) });
  assert.equal(run.actions.filter((action) => action.kind === "step").length, 0);
  assert.ok(wheel(run.actions).length > 0, "turning in place continues");
  const confirmed = simulate(idle.createIdleAutonomy({ random: seeded(5), startedAt: START }), { durationMs: 8 * MINUTE,
    factsAt: (now) => facts(now, { level: "explore", body: body(now, { distance: "far" }) }) });
  assert.ok(confirmed.actions.some((action) => action.kind === "step"), "the same run steps once confirmed");
  // A missing value is never a confirmation.
  const missing = simulate(idle.createIdleAutonomy({ random: seeded(5), startedAt: START }), { durationMs: 8 * MINUTE,
    factsAt: (now) => facts(now, { level: "explore", linkLossSelfStopConfirmed: undefined, body: body(now, { distance: "far" }) }) });
  assert.equal(missing.actions.filter((action) => action.kind === "step").length, 0);
});

test("a body-state edge vetoes steps even when the motion layer looks clear", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(11), startedAt: START });
  const run = simulate(machine, {
    durationMs: 3 * MINUTE,
    factsAt: (now) => { const state = body(now, { distance: "far" }); state.surface = "edge_front"; return facts(now, { level: "explore", body: state }); },
  });
  assert.equal(run.actions.filter((action) => action.kind === "step").length, 0);
});

test("yielding stops immediately and resumes only after a calm interval", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(13), startedAt: START });
  const yieldFrom = START + 3 * MINUTE;
  const yieldUntil = yieldFrom + 20_000;
  const run = simulate(machine, {
    durationMs: 6 * MINUTE,
    factsAt: (now) => facts(now, { yieldReason: now >= yieldFrom && now < yieldUntil ? "conversation" : null }),
  });
  assert.ok(run.actions.some((action) => action.at < yieldFrom), "active before the conversation");
  const during = run.actions.filter((action) => action.end > yieldFrom && action.at < yieldUntil + idle.RESUME_CALM_MS);
  assert.deepEqual(during.filter((action) => action.at >= yieldFrom), [], "nothing during the yield or the calm interval");
  assert.ok(run.modes.filter(({ at }) => at >= yieldFrom && at < yieldUntil).every(({ mode }) => mode === "resting"));
  assert.ok(run.actions.some((action) => action.at >= yieldUntil + idle.RESUME_CALM_MS), "resumes later");
});

test("an interaction restarts the quiet period", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(13), startedAt: START });
  const touchAt = START + 2 * MINUTE;
  let touched = false;
  const run = simulate(machine, {
    durationMs: 4 * MINUTE,
    factsAt: (now) => {
      if (!touched && now >= touchAt) { touched = true; machine.noteInteraction(now); }
      return facts(now);
    },
  });
  assert.deepEqual(run.actions.filter((action) => action.at >= touchAt && action.at < touchAt + idle.START_AFTER_INTERACTION_MS), []);
});

test("a front edge pauses the wheels and forbids steps for a long time", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(11), startedAt: START });
  const edgeAt = START + 60_000;
  let noted = false;
  const run = simulate(machine, {
    durationMs: 12 * MINUTE,
    factsAt: (now) => {
      if (!noted && now >= edgeAt) { noted = true; machine.noteEdge("front", now); }
      return facts(now, { level: "explore", body: body(now, { distance: "far" }), lastInteractionAt: now - 2 * MINUTE });
    },
  });
  assert.deepEqual(wheel(run.actions).filter((action) => action.at >= edgeAt && action.at < edgeAt + idle.EDGE_WHEEL_PAUSE_MS), []);
  assert.deepEqual(run.actions.filter((action) => action.kind === "step" && action.at >= edgeAt), [], "no step toward any edge for the lock period");
});

test("STOP locks all idle motion until the level changes or LOOI slept", () => {
  for (const unlock of ["level", "sleep"]) {
    const machine = idle.createIdleAutonomy({ random: seeded(17), startedAt: START });
    const stopAt = START + 2 * MINUTE;
    const unlockAt = START + 6 * MINUTE;
    let locked = false;
    const run = simulate(machine, {
      durationMs: 9 * MINUTE,
      factsAt: (now) => {
        if (!locked && now >= stopAt) { locked = true; machine.lockAfterStop("voice-emergency-kws"); }
        const unlocked = now >= unlockAt && now < unlockAt + 1_000;
        return facts(now, {
          level: unlock === "level" && unlocked ? "explore" : "look",
          yieldReason: unlock === "sleep" && unlocked ? "robot-sleeping" : null,
          lastInteractionAt: now - 2 * MINUTE,
        });
      },
    });
    assert.deepEqual(run.actions.filter((action) => action.at >= stopAt && action.at < unlockAt), [], unlock);
    assert.ok(run.actions.some((action) => action.at > unlockAt), `${unlock} lifts the lock`);
  }
});

test("a STOP listener that cannot be armed keeps the wheels still for a while", () => {
  const machine = idle.createIdleAutonomy({ random: seeded(7), startedAt: START });
  let failedAt = null;
  const run = simulate(machine, {
    durationMs: 6 * MINUTE,
    factsAt: (now) => facts(now, { lastInteractionAt: now - 2 * MINUTE }),
    outcome: (action, now) => {
      if ((action.kind === "turn" || action.kind === "step") && failedAt === null) { failedAt = now; return "stop_listener_unavailable"; }
      return "completed";
    },
  });
  assert.ok(failedAt !== null);
  const next = wheel(run.actions).filter((action) => action.at > failedAt);
  assert.ok(next.every((action) => action.at - failedAt >= idle.STOP_LISTENER_RETRY_MS));
});

test("surface assessment trusts only fresh, stable, complete sensor data", () => {
  const now = 50_000;
  const good = () => ({
    connected: true, driveControlReady: true, motionActive: false, stopGeneration: 0,
    nearEdge: { front: false, rear: false },
    sensors: {
      lastFed9At: now - 200,
      lastCliffFrameAt: now - 200,
      cliffSensors: { frontLeft: true, frontRight: true, rearLeft: true, rearRight: true },
      cliffSafeSince: { frontLeft: now - 5_000, frontRight: now - 5_000, rearLeft: now - 5_000, rearRight: now - 5_000 },
      obstacleNear: false,
    },
    safety: { lastSafetyStopReason: null },
  });
  assert.deepEqual(idle.assessIdleSurface(good(), now), { turn: true, forward: true });
  const cases = [
    (s) => { s.sensors.cliffSensors = null; },
    (s) => { s.sensors.lastCliffFrameAt = null; },
    (s) => { delete s.sensors.lastCliffFrameAt; },
    // A fresh motion frame alone is not enough: only edge-sensor frames open the window.
    (s) => { s.sensors.lastCliffFrameAt = now - idle.SURFACE_SENSOR_FRESH_MS - 1; s.sensors.lastFed9At = now - 200; },
    (s) => { s.sensors.lastCliffFrameAt = now - idle.SURFACE_SENSOR_FRESH_MS - 1; },
    (s) => { s.sensors.cliffSensors.frontLeft = false; },
    (s) => { s.sensors.cliffSafeSince.rearRight = now - 100; },
    (s) => { s.nearEdge.front = true; },
    (s) => { s.connected = false; },
    (s) => { s.driveControlReady = false; },
  ];
  for (const mutate of cases) {
    const snapshot = good(); mutate(snapshot);
    assert.deepEqual(idle.assessIdleSurface(snapshot, now), { turn: false, forward: false }, mutate.toString());
  }
  // 0e above 0x1fff is not a known distance: it can drive a turn, not a step. 0x1fff (null) and a real distance are fine.
  for (const [tofDistanceMm, expected] of [[65_535, { turn: true, forward: false }], [null, { turn: true, forward: true }], [373, { turn: true, forward: true }]]) {
    const snapshot = good(); snapshot.sensors.tofDistanceMm = tofDistanceMm;
    assert.deepEqual(idle.assessIdleSurface(snapshot, now), expected, `tof ${tofDistanceMm}`);
  }
  for (const obstacleNear of [null, true]) {
    const snapshot = good(); snapshot.sensors.obstacleNear = obstacleNear;
    assert.deepEqual(idle.assessIdleSurface(snapshot, now), { turn: true, forward: false }, `obstacle ${obstacleNear}`);
  }
});
