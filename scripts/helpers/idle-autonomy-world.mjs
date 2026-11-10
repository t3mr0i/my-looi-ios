import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./load-typescript-tree.mjs";
import { VirtualClock } from "./virtual-clock.mjs";

/**
 * LOOI's idle life against the real robot controller, SDK and mock transport on
 * a virtual clock: no network, no physical BLE, no model. Only the microphone
 * (STOP decoder), camera and app state are faked at their ports. Shared by the
 * scenario test and the randomized soak test.
 */
export function createIdleAutonomyWorld() {
  const clock = new VirtualClock();
  const globals = clock.globals();
  const values = new Map();
  const sdk = createTypeScriptTreeLoader({}, globals)("packages/looi-sdk/src/index.ts");
  const load = createTypeScriptTreeLoader({
    "@sourcebug/looi-sdk": sdk,
    "react-native": { AppState: { currentState: "active", addEventListener() { return { remove() {} }; } }, Platform: { OS: "ios" } },
    "expo-secure-store": {
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); },
      deleteItemAsync: async (key) => { values.delete(key); },
    },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "./react-native-ble-transport": {
      ReactNativeBleLooiTransport: class { constructor() { throw new Error("Physical BLE forbidden in mock integration"); } },
      scanLooiRobotCandidates: async () => { throw new Error("Physical scan forbidden in mock integration"); },
    },
  }, globals);
  const connection = load("src/device-tools/looi-robot-autoconnect.ts");
  const robot = load("src/device-tools/looi-robot.ts");
  const { createRobotBodyStateStore } = load("src/robot-mind/body-state.ts");
  const idle = load("src/robot-mind/idle-autonomy.ts");
  const { createIdleAutonomyRuntime } = load("src/robot-mind/idle-autonomy-runtime.ts");

  const MINUTE = 60_000;
  const DRIVE_PAYLOAD = { "7707": "forward", "86fc": "back", "047a": "left", "0082": "right" };

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

  const writes = [];
  const seenTrace = new Set();
  connection.subscribeLooiRobotDebugState((snapshot) => {
    for (const entry of snapshot.mock?.trace ?? []) {
      // Each mock transport numbers its trace from 1 again, so identify entries by time too.
      const key = `${entry.time}:${entry.id}`;
      if (seenTrace.has(key)) continue;
      seenTrace.add(key);
      if (entry.action === "drive" || entry.action === "head") writes.push({ at: clock.now, action: entry.action, detail: entry.detail });
    }
  });
  const motionWrites = (from = 0) => writes.filter((write) => write.at >= from && (write.action === "head" || !/^0+$/u.test(write.detail)));
  const driveDirections = (from = 0) => writes
    .filter((write) => write.at >= from && write.action === "drive" && !/^0+$/u.test(write.detail))
    .map((write) => DRIVE_PAYLOAD[write.detail]);

  /** One runtime with fake microphone, camera and app-state ports around the real motion layer. */
  function harness({ level = "look", seed = 1, micLive = true, armReady = true, linkLossConfirmed = true } = {}) {
    const store = createRobotBodyStateStore(() => clock.now);
    const interactionListeners = new Set();
    const sampleListeners = new Set();
    const h = {
      store, level, micLive, armReady, linkLossConfirmed, yieldReason: null, armed: 0, arms: [], disarms: 0, drives: [], events: [], logs: [],
      person: null,
      interact(source) { for (const listener of [...interactionListeners]) listener(source); },
      samples(values) { for (const listener of [...sampleListeners]) listener(values); },
      /** What the real wakeword STOP path does when the armed Vosk decoder hears STOP. */
      heardStop() {
        assert.ok(h.armed > 0, "STOP can only be heard while the decoder is armed");
        return robot.stopLooiMotion("driving-local-stop");
      },
    };
    store.subscribeEvents((event) => h.events.push(event));
    const runtime = createIdleAutonomyRuntime({
      bodyState: store,
      now: () => clock.now,
      random: seeded(seed),
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(handle),
      getLevel: () => h.level,
      linkLossSelfStopConfirmed: () => h.linkLossConfirmed,
      getYieldReason: () => h.yieldReason,
      subscribeInteractions(listener) { interactionListeners.add(listener); return () => interactionListeners.delete(listener); },
      motion: {
        getState: robot.getLooiRobotRuntimeState,
        subscribe: robot.subscribeLooiRobotRuntimeState,
        async drive(direction, durationMs, options) {
          const state = robot.getLooiRobotRuntimeState();
          const sinceSafe = Object.values(state.sensors.cliffSafeSince);
          const record = {
            at: clock.now, direction, durationMs, linkLossConfirmedAtStart: h.linkLossConfirmed, armedAtStart: h.armed > 0, yieldAtStart: h.yieldReason, levelAtStart: h.level, micLiveAtStart: h.micLive, connectedAtStart: state.connected,
            surfaceAtStart: idle.assessIdleSurface(state, clock.now),
            cliffFrameAgeAtStart: state.sensors.lastCliffFrameAt === null ? null : clock.now - state.sensors.lastCliffFrameAt,
            sensorAgeAtStart: state.sensors.lastFed9At === null ? null : clock.now - state.sensors.lastFed9At,
            lastCliffFrameAtStart: state.sensors.lastCliffFrameAt,
            cliffStableForAtStart: sinceSafe.some((since) => since === null) ? null : Math.min(...sinceSafe.map((since) => clock.now - since)),
          };
          h.drives.push(record);
          record.result = await robot.driveLooiForDuration(direction, durationMs, options);
          return record.result;
        },
        setHead: (position, isCurrent) => robot.setLooiHead(position, { priority: "behavior", isCurrent }),
        headGesture: (gesture, isCurrent) => robot.performLooiBehaviorHeadGesture(gesture, isCurrent),
      },
      stopListener: {
        isLive: () => h.micLive,
        async arm(reason, durationMs) {
          h.arms.push({ reason, durationMs, accepted: h.armReady });
          if (!h.armReady) return false;
          h.armed += 1;
          h.onArm?.();
          return true;
        },
        async disarm() { h.armed = Math.max(0, h.armed - 1); h.disarms += 1; },
        subscribeSamples(listener) { sampleListeners.add(listener); return () => sampleListeners.delete(listener); },
      },
      camera: { available: () => true, request() {}, release() {}, bodyMotionInFlight: () => false, holdMotion() {} },
      ambient: { busy: () => false, hold() {} },
      log: (event, details) => h.logs.push({ at: clock.now, event, ...details }),
    });
    // A synthetic camera/body-sense layer (workstream A's job): keeps the attended face fresh.
    const camera = clock.setInterval(() => {
      if (!h.person) return;
      store.update({ people: { visible: 1, attended: { bearing: h.person.bearing, distance: h.person.distance, since: clock.now }, lastSeenAt: clock.now } }, "test-camera");
    }, 250);
    h.runtime = {
      start: () => runtime.start(),
      stop: () => { runtime.stop(); clock.clearInterval(camera); },
      getSnapshot: () => runtime.getSnapshot(),
    };
    return h;
  }

  /** Let a promise from the real stack settle while virtual time moves on. */
  async function settle(promise, maxMs = 10_000) {
    let done = false;
    let failure = null;
    let value;
    promise.then((result) => { done = true; value = result; }, (error) => { done = true; failure = error; });
    const deadline = clock.now + maxMs;
    await clock.flush();
    while (!done) {
      assert.ok(clock.now < deadline, "the mock stack settled before its deadline");
      await advance(50);
    }
    if (failure) throw failure;
    return value;
  }

  /** Move virtual time in slices so the bounded timer loop of the clock is never exceeded. */
  async function advance(ms) {
    const target = clock.now + ms;
    while (clock.now < target) await clock.advanceTo(Math.min(target, clock.now + 20_000));
  }

  async function connectMock(scenario = "clear") {
    await settle(connection.setLooiConnectionMode("mock"));
    await settle(connection.setMockLooiScenario(scenario));
    await advance(2_000);
    assert.equal(robot.getLooiRobotRuntimeState().connected, true);
  }

  async function resetRobot() {
    await settle(connection.setLooiConnectionMode("disconnected"));
    await settle(robot.disconnectLooiRobot());
    await advance(1_000);
  }

  return { clock, connection, robot, idle, harness, settle, advance, connectMock, resetRobot, writes, motionWrites, driveDirections, seeded, MINUTE, DRIVE_PAYLOAD };
}
