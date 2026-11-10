import assert from "node:assert/strict";
import { createIdleAutonomyWorld } from "./helpers/idle-autonomy-world.mjs";


// LOOI's idle life against the real robot controller, SDK and mock transport on
// a virtual clock: no network, no physical BLE, no model. Only the microphone
// (STOP decoder), camera and app state are faked at their ports.
const { clock, connection, robot, idle, harness, settle, advance, connectMock, resetRobot, motionWrites, driveDirections, MINUTE } = createIdleAutonomyWorld();

try {
  // 1. Disconnected: idle life writes nothing and never tries to connect.
  {
    await settle(connection.setLooiConnectionMode("disconnected"));
    const h = harness({ level: "explore" });
    h.person = { bearing: "center", distance: "far" };
    const from = clock.now;
    h.runtime.start();
    await advance(6 * MINUTE);
    h.runtime.stop();
    assert.deepEqual(motionWrites(from), [], "no BLE write while disconnected");
    assert.deepEqual(h.drives, []);
    assert.equal(h.logs.filter((entry) => entry.event === "action").length, 0, "no action is even attempted");
    assert.equal(robot.getLooiRobotRuntimeState().connected, false);
  }

  // 2. Look: LOOI turns in place in bounded, STOP-armed steps while it searches, and never translates.
  {
    await connectMock("clear");
    const h = harness({ level: "look", seed: 2 });
    const from = clock.now;
    h.runtime.start();
    await clock.until(() => h.events.some((event) => event.type === "search_gave_up"), 12 * MINUTE);
    h.runtime.stop();
    const searchTurns = h.drives.filter((drive) => drive.direction === "left" || drive.direction === "right");
    assert.ok(searchTurns.length >= 2, `searching turns the body (${searchTurns.length})`);
    assert.ok(h.drives.every((drive) => drive.armedAtStart), "the local STOP decoder is armed before every wheel action");
    assert.equal(h.disarms, h.arms.length, "every arm is disarmed again");
    assert.ok(h.drives.every((drive) => drive.durationMs <= idle.MAX_AUTONOMOUS_TURN_MS && drive.result.completed === true));
    const physical = driveDirections(from);
    assert.ok(physical.length > 0 && physical.every((direction) => direction === "left" || direction === "right"), `look never drives forward/back: ${physical}`);
    assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop", "wheels parked");
    assert.ok(h.store.getState().activity.mode === "resting");
  }

  // 3. Explore: approaches a far person in bounded steps and reports arrival.
  {
    const h = harness({ level: "explore", seed: 3 });
    h.person = { bearing: "center", distance: "far" };
    h.runtime.start();
    await clock.until(() => h.drives.filter((drive) => drive.direction === "forward").length >= 2, 4 * MINUTE);
    h.person = { bearing: "center", distance: "near" };
    await clock.until(() => h.events.some((event) => event.type === "arrived_at_person"), MINUTE);
    const steps = h.drives.filter((drive) => drive.direction === "forward");
    assert.equal(steps.length, 2, "two bounded steps, then near");
    assert.ok(steps.every((step) => step.durationMs <= idle.MAX_AUTONOMOUS_STEP_MS && step.armedAtStart && step.result.completed));
    assert.equal(h.store.getState().activity.mode, "attending");
    await advance(2 * MINUTE);
    h.runtime.stop();
    assert.equal(h.drives.filter((drive) => drive.direction === "forward").length, 2, "no step once arrived");
    assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");
  }

  // 4. Explore: a front edge mid-step stops the wheels; LOOI does not step again.
  {
    await resetRobot();
    await connectMock("clear");
    const h = harness({ level: "explore", seed: 4 });
    h.person = { bearing: "center", distance: "far" };
    let edgeInjected = false;
    const unsubscribe = robot.subscribeLooiRobotRuntimeState(() => {
      const state = robot.getLooiRobotRuntimeState();
      if (!edgeInjected && state.motionActive && state.activeDirection === "forward") {
        edgeInjected = true;
        void connection.setMockLooiScenario("front-edge");
      }
    });
    h.runtime.start();
    await clock.until(() => edgeInjected, 4 * MINUTE);
    await advance(1_000);
    unsubscribe();
    const state = robot.getLooiRobotRuntimeState();
    assert.equal(state.motionActive, false, "the edge stopped the step");
    assert.equal(state.nearEdge.front, true);
    assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");
    assert.equal(h.drives.at(-1).result.completed, false, "the interrupted step is not reported as done");
    const stepsAtEdge = h.drives.filter((drive) => drive.direction === "forward").length;
    // Someone puts LOOI back on safe ground and clears the motion layer's latch;
    // idle life still does not retry the edge direction for its own lock period.
    await settle(connection.setMockLooiScenario("clear"));
    await advance(2_000);
    robot.clearLooiNearEdgeAfterManualReposition();
    assert.equal(robot.getLooiRobotRuntimeState().nearEdge.front, false);
    const after = clock.now;
    for (let minute = 0; minute < 12; minute += 3) {
      h.interact("touch"); // keeps LOOI awake, so a missing lock would show up as a step
      await advance(3 * MINUTE);
    }
    assert.ok(h.drives.length > stepsAtEdge || h.logs.some((entry) => entry.at > after && entry.event === "action"), "LOOI was active after the edge");
    h.runtime.stop();
    assert.equal(h.drives.filter((drive) => drive.direction === "forward").length, stepsAtEdge, "no further step after the edge");
    assert.deepEqual(driveDirections(after).filter((direction) => direction === "forward" || direction === "back"), []);
  }

  // 5. STOP while LOOI turns on its own halts it for good; choosing a level again lifts the lock.
  {
    await resetRobot();
    await connectMock("clear");
    const h = harness({ level: "look", seed: 2 });
    let stopped = false;
    const unsubscribe = robot.subscribeLooiRobotRuntimeState(() => {
      const state = robot.getLooiRobotRuntimeState();
      if (!stopped && state.motionActive && h.armed > 0) {
        stopped = true;
        void h.heardStop();
      }
    });
    h.runtime.start();
    await clock.until(() => stopped, 12 * MINUTE);
    await advance(500);
    unsubscribe();
    assert.equal(robot.getLooiRobotRuntimeState().motionActive, false);
    assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");
    assert.equal(h.runtime.getSnapshot().stopLock, "driving-local-stop");
    const after = clock.now;
    await advance(8 * MINUTE);
    assert.deepEqual(motionWrites(after), [], "no wheel or head write after STOP");
    h.level = "off";
    await advance(1_000);
    h.level = "look";
    h.interact("touch"); // someone is back; the idle clock restarts after the long quiet period
    await clock.until(() => motionWrites(after).length > 0, 3 * MINUTE);
    h.runtime.stop();
  }

  // 6. Yielding: an interaction aborts the running action at once; a missing STOP decoder keeps the wheels still.
  {
    const h = harness({ level: "look", seed: 2 });
    let interacted = false;
    const unsubscribe = robot.subscribeLooiRobotRuntimeState(() => {
      if (!interacted && robot.getLooiRobotRuntimeState().motionActive) {
        interacted = true;
        h.interact("touch");
      }
    });
    h.runtime.start();
    await clock.until(() => interacted, 12 * MINUTE);
    const touchedAt = clock.now;
    await advance(200);
    unsubscribe();
    assert.equal(robot.getLooiRobotRuntimeState().motionActive, false, "the turn was cancelled by the touch");
    assert.equal(h.drives.at(-1).result.completed, false);
    await advance(idle.START_AFTER_INTERACTION_MS - 1_000);
    assert.deepEqual(motionWrites(touchedAt + 200), [], "calm after the touch");
    assert.equal(h.store.getState().activity.mode, "resting");
    h.runtime.stop();

    // A conversation starting mid-turn: the motion lease is revoked within one poll.
    const talk = harness({ level: "look", seed: 2 });
    let talkStartedAt = null;
    const unsubscribeTalk = robot.subscribeLooiRobotRuntimeState(() => {
      if (talkStartedAt === null && robot.getLooiRobotRuntimeState().motionActive) {
        talkStartedAt = clock.now;
        talk.yieldReason = "conversation";
      }
    });
    talk.runtime.start();
    await clock.until(() => talkStartedAt !== null, 12 * MINUTE);
    await clock.until(() => !robot.getLooiRobotRuntimeState().motionActive, 1_000);
    unsubscribeTalk();
    assert.ok(clock.now - talkStartedAt <= 100, `wheels stop promptly when a conversation starts (${clock.now - talkStartedAt} ms)`);
    assert.equal(talk.drives.at(-1).result.completed, false);
    const talkStopped = clock.now;
    await advance(MINUTE);
    assert.deepEqual(motionWrites(talkStopped + 100), [], "still while the conversation runs");
    talk.runtime.stop();

    const deaf = harness({ level: "explore", seed: 2, armReady: false });
    deaf.person = { bearing: "center", distance: "far" };
    const from = clock.now;
    deaf.runtime.start();
    await advance(8 * MINUTE);
    deaf.runtime.stop();
    assert.ok(deaf.arms.length >= 1, "it tried to arm the STOP decoder");
    assert.deepEqual(deaf.drives, [], "no wheel action without an armed STOP decoder");
    assert.deepEqual(driveDirections(from), []);

    const noMic = harness({ level: "explore", seed: 2, micLive: false });
    noMic.person = { bearing: "center", distance: "far" };
    noMic.runtime.start();
    await advance(6 * MINUTE);
    noMic.runtime.stop();
    assert.deepEqual([noMic.arms, noMic.drives], [[], []], "no microphone, no wheels");
  }

  // 7. Speech-level sound between search turns ends the episode before the next turn.
  {
    const h = harness({ level: "look", seed: 2 });
    h.runtime.start();
    await clock.until(() => h.runtime.getSnapshot().mode === "seeking_person" && h.drives.length > 0 && !h.runtime.getSnapshot().inFlight, 12 * MINUTE);
    const drivesBefore = h.drives.length;
    await advance(idle.MIN_PAUSE_BETWEEN_ACTIONS_MS / 2);
    const loud = Array.from({ length: 1600 }, (_, index) => Math.sin(index / 5) * 0.2);
    h.samples(loud); h.samples(loud);
    await advance(idle.RESUME_CALM_MS - 2_000);
    assert.equal(h.drives.length, drivesBefore, "no turn right after a voice nearby");
    assert.equal(h.runtime.getSnapshot().mode, "resting");
    h.runtime.stop();
  }

  // 8. Explore without the owner's link-loss check: the same far, centred person gets turns at most, never a step,
  // and a confirmation withdrawn while a step is being prepared is honoured before the wheels move.
  {
    await resetRobot();
    await connectMock("clear");
    const h = harness({ level: "explore", seed: 3, linkLossConfirmed: false });
    h.person = { bearing: "center", distance: "far" };
    const from = clock.now;
    h.runtime.start();
    await advance(6 * MINUTE);
    assert.equal(h.drives.filter((drive) => drive.direction === "forward").length, 0, "no forward step unconfirmed");
    assert.ok(!driveDirections(from).includes("forward"), "the mock robot never received a forward frame");
    assert.ok(h.logs.some((entry) => entry.event === "wait" || entry.event === "action"), "idle life still runs");
    h.runtime.stop();
  }
  {
    await resetRobot();
    await connectMock("clear");
    const h = harness({ level: "explore", seed: 3 });
    h.person = { bearing: "center", distance: "far" };
    // Confirmed when the step is chosen, withdrawn by the time the wheels would move.
    const stepChosen = () => h.logs.some((entry) => entry.event === "action" && entry.detail === "forward");
    Object.defineProperty(h, "linkLossConfirmed", { get: () => !stepChosen() });
    const from = clock.now;
    h.runtime.start();
    await clock.until(() => stepChosen() && h.logs.some((entry) => entry.event === "action-finished" && entry.kind === "step"), 4 * MINUTE);
    h.runtime.stop();
    assert.ok(stepChosen(), "a step was chosen while confirmed");
    assert.equal(h.logs.find((entry) => entry.event === "action-finished" && entry.kind === "step").outcome, "blocked");
    assert.equal(h.drives.filter((drive) => drive.direction === "forward").length, 0, "the pre-drive recheck refused it");
    assert.ok(!driveDirections(from).includes("forward"));
  }

  // 8b. The level drops to "look" while the STOP decoder is being armed: the pre-drive recheck refuses the step.
  {
    await resetRobot();
    await connectMock("clear");
    const h = harness({ level: "explore", seed: 3 });
    h.person = { bearing: "center", distance: "far" };
    h.onArm = () => { if (h.logs.some((entry) => entry.event === "action" && entry.detail === "forward")) h.level = "look"; };
    const from = clock.now;
    h.runtime.start();
    await clock.until(() => h.logs.some((entry) => entry.event === "action-finished" && entry.kind === "step"), 4 * MINUTE);
    h.runtime.stop();
    assert.equal(h.logs.find((entry) => entry.event === "action-finished" && entry.kind === "step").outcome, "blocked");
    assert.equal(h.drives.filter((drive) => drive.direction === "forward").length, 0, "no step once the level is no longer explore");
    assert.ok(!driveDirections(from).includes("forward"));
  }

  // 9. A robot that reports only on change (as community captures describe): after the frames
  // that came with connecting, nothing is fresh any more, so idle life keeps the wheels still.
  {
    await resetRobot();
    connection.setMockLooiSensorCadence({ cadence: "on-change" });
    try {
      await connectMock("clear");
      const h = harness({ level: "explore", seed: 2 });
      const from = clock.now;
      h.runtime.start();
      await advance(10 * MINUTE);
      h.runtime.stop();
      const late = h.drives.filter((drive) => drive.at - from > idle.SURFACE_SENSOR_FRESH_MS);
      assert.deepEqual(late, [], "no wheel action once the last frame is older than the freshness limit");
      assert.ok(h.drives.every((drive) => drive.cliffFrameAgeAtStart !== null && drive.cliffFrameAgeAtStart <= idle.SURFACE_SENSOR_FRESH_MS), "no drive starts more than the freshness limit after the last edge frame");
      assert.ok(h.logs.some((entry) => entry.event === "action" && (entry.kind === "head" || entry.kind === "head_gesture")), "head-only life continues");
    } finally {
      connection.setMockLooiSensorCadence({ cadence: "periodic" });
    }
  }

  // 10. Opt-in quiet basis on a robot that reports only on change: in-place turns continue on the last reported
  // edge state long after the freshness limit, never a step. The same seed with the switch off stays still.
  {
    const late = (h) => h.drives.filter((drive) => drive.cliffFrameAgeAtStart > idle.SURFACE_SENSOR_FRESH_MS);
    try {
      await resetRobot();
      connection.setMockLooiSensorCadence({ cadence: "on-change" });
      await connectMock("clear");
      const quiet = harness({ level: "look", seed: 2, quietBasis: true });
      quiet.runtime.start();
      await advance(10 * MINUTE);
      quiet.runtime.stop();
      assert.ok(late(quiet).length >= 3, `turns later than the freshness limit after the last edge frame: ${late(quiet).length}`);
      assert.ok(quiet.drives.every((drive) => drive.direction !== "forward"), "no step on the quiet basis");
      assert.ok(quiet.logs.some((entry) => entry.event === "quiet-basis-used"), "the quiet basis is logged when used");
      assert.ok(quiet.logs.some((entry) => entry.event === "quiet-basis-setting" && entry.enabled === true), "switching on is logged");

      await resetRobot();
      connection.setMockLooiSensorCadence({ cadence: "on-change" });
      await connectMock("clear");
      const off = harness({ level: "look", seed: 2 });
      off.runtime.start();
      await advance(10 * MINUTE);
      off.runtime.stop();
      assert.deepEqual(late(off), [], "the same run with the switch off has no late drive");
      assert.ok(!off.logs.some((entry) => entry.event.startsWith("quiet-basis")), "nothing about the quiet basis is logged while off");
    } finally {
      connection.setMockLooiSensorCadence({ cadence: "periodic" });
    }
  }

  // 11. A connection that brings no edge frame: no wheels at all, however long the robot is quiet. The first edge
  // frame (here from a scenario change) enables turns only after the ground has been settled for ten seconds.
  {
    try {
      await resetRobot();
      connection.setMockLooiSensorCadence({ cadence: "on-change", cliffFrameOnSubscribe: false });
      await connectMock("clear");
      const h = harness({ level: "look", seed: 2, quietBasis: true });
      h.runtime.start();
      await advance(5 * MINUTE);
      assert.equal(robot.getLooiRobotRuntimeState().sensors.lastCliffFrameAt, null, "this connection brought no edge frame");
      assert.deepEqual(h.drives, [], "no drive without an edge frame on this connection");
      await settle(connection.setMockLooiScenario("obstacle"));
      await advance(500);
      const firstEdgeFrameAt = robot.getLooiRobotRuntimeState().sensors.lastCliffFrameAt;
      assert.notEqual(firstEdgeFrameAt, null, "the scenario change delivered an edge frame");
      await settle(connection.setMockLooiScenario("clear"));
      await advance(5 * MINUTE);
      h.runtime.stop();
      assert.ok(h.drives.length > 0, "turns resumed");
      assert.ok(h.drives[0].at - firstEdgeFrameAt >= idle.QUIET_SURFACE_SETTLED_MS, "the first drive waited for the settled ground");
    } finally {
      connection.setMockLooiSensorCadence({ cadence: "periodic" });
    }
  }

  // 12. The stream goes silent while the link stays up: the missing echo of the next turn suspends the quiet basis
  // until an edge frame arrives after the failure.
  {
    try {
      await resetRobot();
      connection.setMockLooiSensorCadence({ cadence: "on-change" });
      await connectMock("clear");
      const h = harness({ level: "look", seed: 2, quietBasis: true });
      h.runtime.start();
      await clock.until(() => h.drives.some((drive) => drive.cliffFrameAgeAtStart > idle.SURFACE_SENSOR_FRESH_MS), 10 * MINUTE);
      await clock.until(() => robot.getLooiRobotRuntimeState().motionActive === false && h.logs.some((entry) => entry.event === "action-finished" && entry.kind === "turn"), MINUTE);
      const mutedAt = clock.now;
      connection.setMockLooiSensorCadence({ cadence: "on-change", muted: true });
      await advance(5 * MINUTE);
      assert.ok(h.drives.filter((drive) => drive.at > mutedAt).length <= 1, "at most one drive on a silent stream");
      assert.ok(h.logs.some((entry) => entry.event === "quiet-basis-suspended"), "the silent stream suspended the quiet basis");
      connection.setMockLooiSensorCadence({ cadence: "on-change" });
      const unmutedAt = clock.now;
      await settle(connection.setMockLooiScenario("obstacle"));
      await advance(1_000);
      await settle(connection.setMockLooiScenario("clear"));
      await advance(5 * MINUTE);
      h.runtime.stop();
      assert.ok(h.logs.some((entry) => entry.event === "quiet-basis-restored" && entry.at > unmutedAt), "an edge frame restored the quiet basis");
      assert.ok(h.drives.some((drive) => drive.at > unmutedAt), "turns resumed after the settle time");
    } finally {
      connection.setMockLooiSensorCadence({ cadence: "periodic" });
    }
  }

  console.log("Idle autonomy -> real controller/SDK/mock: silent while disconnected, STOP-armed search turns, bounded approach with arrival, front-edge stop without retry, STOP lock, yield on touch, no wheels without STOP decoder, voice guard, no step without the link-loss check, still wheels on an on-change robot, opt-in quiet-sensor turns with settle time, no wheels without an edge frame on the connection, suspension on a silent stream PASS (no model, network or hardware)");
} finally {
  await settle(connection.setLooiConnectionMode("disconnected")).catch(() => undefined);
  await settle(robot.disconnectLooiRobot()).catch(() => undefined);
}
