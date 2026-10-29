import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const types = loadTypeScript("src/robot-bridge/types.ts");
const actions = loadTypeScript("src/robot-bridge/action-profile.ts", { "./types": types });
const {
  EMPTY_ROBOT_APP_ACTION_PROFILE,
  ROBOT_APP_ACTIONS,
  availableRobotAppActionNames,
  isRobotAppActionSource,
  normalizeRobotAppActionProfile,
  resolveRobotAppAction,
} = actions;
const { createRobotCore } = loadTypeScript("src/robot-bridge/core.ts", {
  "./types": types,
  "./action-profile": actions,
});

const capabilities = {
  schemaVersion: 1,
  locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
  pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
  gestures: ["nod", "curious", "happy_bob", "sleepy", "thinking", "speaking_soft"],
  light: true,
  media: { camera: false, microphone: false, speaker: false, volume: false },
};

assert.deepEqual(ROBOT_APP_ACTIONS.map(({ id }) => id), [
  "nod", "curious", "happy_bob", "sleepy", "thinking", "speaking_soft",
  "head_up", "head_center", "head_down", "move_forward", "move_back",
  "turn_left", "turn_right", "light_on", "light_off",
]);
assert.equal(EMPTY_ROBOT_APP_ACTION_PROFILE.schemaVersion, 1);
assert.deepEqual(EMPTY_ROBOT_APP_ACTION_PROFILE.mappings, []);

const profile = normalizeRobotAppActionProfile({
  schemaVersion: 1,
  mappings: [
    { source: "celebrate", target: "happy_bob" },
    { source: "go_home", target: "head_center" },
    { source: "drive_ahead", target: "move_forward" },
    { source: "Dance Intro.v2", target: "curious" },
    { source: "gestures/wave", target: "nod" },
  ],
});
const profileBeforeResolution = structuredClone(profile);
assert.deepEqual(resolveRobotAppAction("celebrate", profile, capabilities), {
  command: { kind: "gesture", name: "happy_bob" }, adapted: true,
});
assert.deepEqual(resolveRobotAppAction("Dance Intro.v2", profile, capabilities), {
  command: { kind: "gesture", name: "curious" }, adapted: true,
});
assert.deepEqual(resolveRobotAppAction("gestures/wave", profile, capabilities), {
  command: { kind: "gesture", name: "nod" }, adapted: true,
});
assert.deepEqual(resolveRobotAppAction("nod", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities), {
  command: { kind: "gesture", name: "nod" }, adapted: false,
});
assert.deepEqual(resolveRobotAppAction("drive_ahead", profile, capabilities), {
  command: { kind: "drive", forward: 1, lateral: 0, yawRate: 0, durationMs: 300 }, adapted: true,
});
assert.deepEqual(resolveRobotAppAction("turn_left", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities), {
  command: { kind: "drive", forward: 0, lateral: 0, yawRate: 1, durationMs: 300 }, adapted: false,
});
assert.deepEqual(resolveRobotAppAction("light_off", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities), {
  command: { kind: "light", enabled: false }, adapted: false,
});
const headUp = resolveRobotAppAction("head_up", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities);
const headCenter = resolveRobotAppAction("head_center", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities);
const headDown = resolveRobotAppAction("head_down", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities);
assert.ok(headUp && headCenter && headDown);
assert.ok(Math.abs(headUp.command.pose.head[8] - Math.sin(0.25)) < 1e-12, "head_up is a valid -0.25 rad pitch target");
assert.deepEqual(headCenter.command.pose.head, types.IDENTITY_HEAD);
assert.ok(Math.abs(headDown.command.pose.head[8] + Math.sin(0.25)) < 1e-12, "head_down is a valid +0.25 rad pitch target");
assert.equal(resolveRobotAppAction("kick_left", EMPTY_ROBOT_APP_ACTION_PROFILE, capabilities), null);
assert.deepEqual(availableRobotAppActionNames(capabilities, profile), [
  "nod", "curious", "happy_bob", "sleepy", "thinking", "speaking_soft",
  "head_up", "head_center", "head_down", "move_forward", "move_back",
  "turn_left", "turn_right", "light_on", "light_off",
  "Dance Intro.v2", "celebrate", "drive_ahead", "gestures/wave", "go_home",
]);
assert.deepEqual(profile, profileBeforeResolution, "resolution and menu generation do not mutate stored mappings");

assert.equal(isRobotAppActionSource("Dance Intro.v2"), true);
assert.equal(isRobotAppActionSource("gestures/wave"), true);
assert.equal(isRobotAppActionSource("a".repeat(200)), true);
assert.equal(isRobotAppActionSource("🙂".repeat(200)), true, "the source limit counts Unicode code points");
for (const invalidSource of [
  "", "   ", " leading", "trailing ", "\tdance", "dance\n",
  "tab\there", "line\nbreak", "c1\u0085", "a".repeat(201), "🙂".repeat(201),
]) assert.equal(isRobotAppActionSource(invalidSource), false, JSON.stringify(invalidSource));

for (const invalid of [
  null,
  {},
  { schemaVersion: 2, mappings: [] },
  { schemaVersion: 1, mappings: [{ source: "__proto__", target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: " leading", target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: "trailing ", target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: "tab\there", target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: "a".repeat(201), target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: "nod", target: "happy_bob" }] },
  { schemaVersion: 1, mappings: [{ source: "a", target: "a" }] },
  { schemaVersion: 1, mappings: [{ source: "a", target: "kick_left" }] },
  { schemaVersion: 1, mappings: [{ source: "a", target: "happy_bob" }, { source: "a", target: "nod" }] },
  { schemaVersion: 1, mappings: [{ source: "a", target: "nod" }, ,] },
  { schemaVersion: 1, extra: true, mappings: [] },
  { schemaVersion: 1, mappings: Array.from({ length: 65 }, (_, index) => ({ source: `alias_${index}`, target: "nod" })) },
]) assert.throws(() => normalizeRobotAppActionProfile(invalid), TypeError);

assert.equal(resolveRobotAppAction("head_up", EMPTY_ROBOT_APP_ACTION_PROFILE, {
  ...capabilities, pose: { ...capabilities.pose, head: "none" },
}), null, "head actions require a controllable LOOI head");
const noHeadCapabilities = { ...capabilities, pose: { ...capabilities.pose, head: "none" } };
const noHeadProfile = normalizeRobotAppActionProfile({ schemaVersion: 1, mappings: [{ source: "look_up", target: "head_up" }] });
assert.equal(resolveRobotAppAction("look_up", noHeadProfile, noHeadCapabilities), null);
assert.equal(availableRobotAppActionNames(noHeadCapabilities, noHeadProfile).includes("look_up"), false);
assert.equal(resolveRobotAppAction("move_forward", EMPTY_ROBOT_APP_ACTION_PROFILE, {
  ...capabilities, locomotion: { ...capabilities.locomotion, forward: false },
}), null, "direction actions require the matching backend capability");
assert.equal(resolveRobotAppAction("turn_right", EMPTY_ROBOT_APP_ACTION_PROFILE, {
  ...capabilities, locomotion: { ...capabilities.locomotion, yaw: false },
}), null, "turn actions require yaw capability");
assert.equal(resolveRobotAppAction("light_on", EMPTY_ROBOT_APP_ACTION_PROFILE, { ...capabilities, light: false }), null);
assert.equal(availableRobotAppActionNames({ ...capabilities, light: false }, EMPTY_ROBOT_APP_ACTION_PROFILE).includes("light_on"), false);

function coreFixture(options = {}) {
  let now = 1000, nextTimer = 0, pendingGate = null;
  const timers = new Map(), actions = [], contexts = [], stops = [];
  const backend = {
    id: "test-looi", capabilities,
    inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }),
    async execute(command, context) {
      contexts.push(context);
      const wait = pendingGate;
      pendingGate = null;
      if (wait) await wait.promise;
      if (!context.isCurrent()) return { status: "cancelled", limitations: [] };
      actions.push(command);
      return { status: "applied", limitations: [] };
    },
    stop(reason) { stops.push(reason); return Promise.resolve(); },
  };
  const core = createRobotCore(backend, { ...options,
    clock: {
      now: () => now,
      setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, at: now + ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  return {
    core, actions, contexts, stops,
    block() { pendingGate = deferred(); return pendingGate; },
    async tick() { for (let i = 0; i < 24; i += 1) await Promise.resolve(); },
  };
}

{
  let current = normalizeRobotAppActionProfile({ schemaVersion: 1, mappings: [{ source: "celebrate", target: "happy_bob" }] });
  const f = coreFixture({ getActionProfile: () => current });
  const session = f.core.openSession({ id: "mapped-profile", allowApproximation: false });
  const pending = session.execute({ kind: "gesture", name: "celebrate" });
  current = EMPTY_ROBOT_APP_ACTION_PROFILE;
  const result = await pending;
  assert.equal(result.status, "adapted");
  assert.deepEqual(result.applied, { kind: "gesture", name: "happy_bob" });
  assert.deepEqual(f.actions, [{ kind: "gesture", name: "happy_bob" }]);
  assert.equal(session.inspect().capabilities.gestures.includes("celebrate"), false, "profiles are read dynamically for capability snapshots");
  await f.core.dispose();
}

{
  let current = normalizeRobotAppActionProfile({ schemaVersion: 1, mappings: [{ source: "drive_ahead", target: "move_forward" }] });
  const f = coreFixture({ getActionProfile: () => current });
  const session = f.core.openSession({ id: "mapped-drive", allowApproximation: false });
  const mapped = await session.execute({ kind: "gesture", name: "drive_ahead" }, { sequence: 1 });
  assert.equal(mapped.status, "adapted");
  assert.deepEqual(mapped.applied, { kind: "drive", forward: 1, lateral: 0, yawRate: 0, durationMs: 300 });
  assert.equal(f.contexts.at(-1).allowApproximation, true, "the generated bounded action may approximate without relaxing raw commands");
  const raw = await session.execute({ kind: "drive", forward: 0.1, lateral: 0, yawRate: 0, durationMs: 100 }, { sequence: 2 });
  assert.equal(raw.status, "applied");
  assert.equal(f.contexts.at(-1).allowApproximation, false, "raw SI drive remains strict");
  current = EMPTY_ROBOT_APP_ACTION_PROFILE;
  const unknown = await session.execute({ kind: "gesture", name: "drive_ahead" }, { sequence: 3 });
  assert.equal(unknown.status, "unsupported");
  assert.equal(f.actions.length, 2, "unknown action names never reach backend execution");
  await f.core.dispose();
}

{
  const profile = normalizeRobotAppActionProfile({ schemaVersion: 1, mappings: [{ source: "drive_ahead", target: "move_forward" }] });
  const f = coreFixture({ getActionProfile: () => profile });
  const session = f.core.openSession({ id: "mapped-drive-stop" });
  const wait = f.block();
  const mapped = session.execute({ kind: "gesture", name: "drive_ahead" }, { sequence: 1 });
  await f.tick();
  const directDrive = session.execute({ kind: "drive", forward: 0, lateral: 0, yawRate: 1, durationMs: 100 }, { sequence: 2 });
  assert.equal((await mapped).status, "cancelled", "mapped actions share the normal drive lane and sequence checks");
  wait.resolve();
  assert.equal((await directDrive).status, "applied");
  assert.deepEqual(f.actions, [{ kind: "drive", forward: 0, lateral: 0, yawRate: 1, durationMs: 100 }]);
  const stopWait = f.block();
  const pendingStop = session.execute({ kind: "gesture", name: "drive_ahead" }, { sequence: 3 });
  await f.tick();
  await session.stop("test-stop");
  assert.equal((await pendingStop).status, "cancelled");
  stopWait.resolve();
  await f.tick();
  assert.deepEqual(f.actions, [{ kind: "drive", forward: 0, lateral: 0, yawRate: 1, durationMs: 100 }], "STOP prevents late mapped movement actuation");
  await f.core.dispose();
}

console.log("robot bridge action profiles: strict mappings, capability exposure, typed actions and core safety passed");
