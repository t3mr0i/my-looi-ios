import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const events = [];
const writes = [];

function compileTs(file, customRequire = require) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports, customRequire, module, file, path.dirname(file),
  );
  return module.exports;
}

const timers = new Map();
let nextTimerId = 1;
let fakeNow = 1_000;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realDateNow = Date.now;
const realRandom = Math.random;
Date.now = () => fakeNow;
globalThis.setTimeout = (callback, delay = 0, ...args) => {
  const id = nextTimerId++;
  timers.set(id, { id, at: fakeNow + Math.max(0, Number(delay) || 0), callback: () => callback(...args) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);

async function flushMicrotasks() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

async function advanceClock(ms) {
  const target = fakeNow + ms;
  let guard = 0;
  while (guard++ < 2_000) {
    const next = [...timers.values()].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    timers.delete(next.id);
    fakeNow = next.at;
    next.callback();
    await flushMicrotasks();
  }
  assert.ok(guard < 2_000, "fake clock did not settle");
  fakeNow = target;
  await flushMicrotasks();
}

const sdk = compileTs("packages/looi-sdk/src/index.ts");
const fed9 = compileTs("src/device-tools/fed9-sensors.ts");
const customRobotRequire = (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  if (id === "./fed9-sensors") return fed9;
  if (id === "../diagnostics/diagnostic-log") {
    return { recordDiagnosticEvent: (category, event, details = {}) => events.push({ category, event, details }) };
  }
  return require(id);
};
const robot = compileTs("src/device-tools/looi-robot.ts", customRobotRequire);

let heldHeadWrite = null;
let blockNextUp = false;
let notifyFed9 = null;
const transport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) { return ["dockNotify", "drive", "head"].includes(key); },
  async startNotifications(key, callback) { if (key === "dockNotify") notifyFed9 = callback; },
  async write(key, payload, options) {
    writes.push({ at: fakeNow, key, payload, options });
    if (key === "head" && payload === "00" && blockNextUp) {
      blockNextUp = false;
      await new Promise((resolve) => { heldHeadWrite = resolve; });
    }
  },
};

function sendFed9(bytes) {
  notifyFed9({
    characteristic: "dockNotify",
    hex: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
    bytes: new Uint8Array(bytes),
  });
}

robot.configureLooiRobotTransport(transport);
await robot.connectLooiRobot();

// An explicit position takes ownership during an ambient gesture's wait; the
// old gesture must never restore center after the explicit write.
const ambient = robot.performLooiHeadGesture("curious", 1, { priority: "ambient" });
await flushMicrotasks();
assert.deepEqual(writes.filter((write) => write.key === "head").map((write) => write.payload), ["00"]);
const explicit = robot.setLooiHead("down");
assert.equal((await explicit).completed, true);
await advanceClock(500);
assert.equal((await ambient).completed, false);
assert.deepEqual(writes.filter((write) => write.key === "head").map((write) => write.payload), ["00", "ff"]);

// A BLE write already in progress cannot be recalled. The replacement waits in
// the shared queue and becomes the only successful owner after it completes.
blockNextUp = true;
const queuedAmbient = robot.performLooiHeadGesture("curious", 1, { priority: "ambient" });
await flushMicrotasks();
assert.equal(typeof heldHeadWrite, "function");
const queuedExplicit = robot.setLooiHead("up");
await flushMicrotasks();
assert.equal(writes.filter((write) => write.key === "head").at(-1).payload, "00");
heldHeadWrite();
heldHeadWrite = null;
await flushMicrotasks();
assert.equal((await queuedAmbient).completed, false);
assert.equal((await queuedExplicit).completed, true);
assert.deepEqual(writes.filter((write) => write.key === "head").slice(-2).map((write) => write.payload), ["00", "00"]);

// Social attention outranks an ambient gesture and interrupts its pending center.
const ambientForSocial = robot.performLooiHeadGesture("sleepy", 1, { priority: "ambient" });
await flushMicrotasks();
const social = robot.setLooiHead("up", { priority: "social" });
assert.equal((await social).completed, true);
await advanceClock(600);
assert.equal((await ambientForSocial).completed, false);
assert.notEqual(writes.filter((write) => write.key === "head").at(-1).payload, "87");

const behaviorForSocial = robot.performLooiBehaviorHeadGesture("sleepy", () => true);
await flushMicrotasks();
const socialForBehavior = robot.setLooiHead("up", { priority: "social" });
assert.equal((await socialForBehavior).completed, true, "social attention outranks a behavior cue");
await advanceClock(700);
assert.equal((await behaviorForSocial).completed, false, "a social write cancels a behavior cue's later center step");

// Late cleanup for a preempted behavior macro is scoped to behavior ownership.
// Once an explicit gesture has taken the head, it must still finish its center
// step even if the old macro's cleanup runs during the explicit wait.
const beforeLateBehaviorCleanup = writes.filter((write) => write.key === "head").length;
const behaviorTakenOver = robot.performLooiBehaviorHeadGesture("sleepy", () => true);
await flushMicrotasks();
assert.equal(writes.filter((write) => write.key === "head").at(-1).payload, "ff");
const explicitAfterBehavior = robot.performLooiHeadGesture("curious");
await flushMicrotasks();
assert.equal(writes.filter((write) => write.key === "head").at(-1).payload, "00");
robot.cancelLooiHeadMotion("late-behavior-cleanup", "behavior");
await advanceClock(450);
assert.deepEqual(
  writes.filter((write) => write.key === "head").slice(beforeLateBehaviorCleanup).map((write) => write.payload),
  ["ff", "00", "87"],
  "late behavior cleanup must leave the explicit gesture's delayed center write intact",
);
assert.equal((await explicitAfterBehavior).completed, true);
await advanceClock(150);
assert.equal((await behaviorTakenOver).completed, false);

blockNextUp = true;
const heldExplicit = robot.setLooiHead("up");
await flushMicrotasks();
assert.equal(typeof heldHeadWrite, "function");
const lowerSocial = await robot.setLooiHead("down", { priority: "social" });
assert.equal(lowerSocial.completed, false, "social attention cannot overwrite an in-flight explicit head request");
heldHeadWrite();
heldHeadWrite = null;
assert.equal((await heldExplicit).completed, true);

// STOP invalidates every later gesture step, including a center write after delay.
const beforeStop = writes.filter((write) => write.key === "head").length;
const stoppingGesture = robot.performLooiHeadGesture("happy_bob");
await flushMicrotasks();
await robot.stopLooiMotion("test-stop-during-head-gesture");
await advanceClock(1_000);
assert.equal((await stoppingGesture).completed, false);
assert.deepEqual(
  writes.filter((write) => write.key === "head").slice(beforeStop).map((write) => write.payload),
  ["00"],
  "STOP must leave no delayed down/up/center head writes",
);

// Runtime observers need a monotonically increasing STOP version, even when
// consecutive stops carry the same reason. The state change is published
// synchronously, before awaiting the BLE stop write.
const observedStopGenerations = [];
const unsubscribeRuntime = robot.subscribeLooiRobotRuntimeState(() => {
  observedStopGenerations.push(robot.getLooiRobotRuntimeState().stopGeneration);
});
const firstStopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
const firstRepeatedStop = robot.stopLooiMotion("repeat-stop-test");
assert.equal(robot.getLooiRobotRuntimeState().stopGeneration, firstStopGeneration + 1);
assert.equal(observedStopGenerations.at(-1), firstStopGeneration + 1);
await firstRepeatedStop;
const secondRepeatedStop = robot.stopLooiMotion("repeat-stop-test");
assert.equal(robot.getLooiRobotRuntimeState().stopGeneration, firstStopGeneration + 2);
assert.equal(observedStopGenerations.at(-1), firstStopGeneration + 2);
await secondRepeatedStop;

// Sensor safety STOPs publish the same version transition synchronously after
// latching the stopped state. A fresh safe sensor frame allows this isolated
// fake robot to move before the unsafe frame arrives.
sendFed9([0x0e, 0xe8, 0x03]);
sendFed9([1, 1, 1, 1, 1]);
await advanceClock(300);
await robot.startLooiMotion("forward");
observedStopGenerations.length = 0;
const sensorStopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
sendFed9([1, 0, 1, 1, 1]);
assert.equal(robot.getLooiRobotRuntimeState().motionActive, false);
assert.equal(robot.getLooiRobotRuntimeState().stopGeneration, sensorStopGeneration + 1);
assert.ok(observedStopGenerations.includes(sensorStopGeneration + 1));
await flushMicrotasks();

// Disconnect invalidates the in-flight owner and its completion cannot revive it.
const disconnectGesture = robot.performLooiHeadGesture("sleepy");
await flushMicrotasks();
robot.handleLooiRobotTransportDisconnected(new Error("test disconnect"));
await advanceClock(700);
assert.equal((await disconnectGesture).completed, false);
assert.notEqual(writes.filter((write) => write.key === "head").at(-1).payload, "87");

// A disconnected STOP still invalidates root-owned pending behavior and emits
// the new version even though there is no BLE write to await.
observedStopGenerations.length = 0;
const disconnectedStopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
await robot.stopLooiMotion("disconnected-repeat-stop-test");
assert.deepEqual(observedStopGenerations, [disconnectedStopGeneration + 1]);
unsubscribeRuntime();

// The ambient behavior seam suppresses scheduling only while the local policy
// says a behavior cue owns the moment; null restores the legacy scheduler.
const ambienceState = { preferences: { ambientMotionLevel: "normal" }, robotSleeping: false };
const conversationState = { isProcessing: false, isSpeaking: false, isUserSpeaking: false };
let ambientActions = 0;
const ambientEvents = [];
const ambientRequire = (id) => {
  if (id === "../character/character-reaction") return { useCharacterReactionStore: { getState: () => ({ mood: null }) } };
  if (id === "../device-tools/looi-robot") return {
    getLooiRobotRuntimeState: () => ({ connected: true, motionActive: false, driveControlReady: true }),
    performLooiAmbientPivot: async () => { ambientActions += 1; return { completed: true }; },
    performLooiHeadGesture: async () => { ambientActions += 1; return { completed: true }; },
  };
  if (id === "../diagnostics/diagnostic-log") return { recordDiagnosticEvent: (_category, event, details = {}) => ambientEvents.push({ event, details }) };
  if (id === "../store/conversation") return { useConversationStore: { getState: () => conversationState, subscribe: () => () => undefined } };
  if (id === "../store/user") return { useUserStore: { getState: () => ambienceState, subscribe: () => () => undefined } };
  if (id === "../voice/driving-control-session") return { isDrivingControlSessionActive: () => false };
  if (id === "./main-screen-presence") return { isMainScreenFocused: () => true };
  return require(id);
};
const ambientMotion = compileTs("src/core/ambient-motion.ts", ambientRequire);
Math.random = () => 0.5;
ambientMotion.configureAmbientBehaviorPolicy(() => ({ suppress: true }));
ambientMotion.startAmbientMotionController("fake-clock-test");
await advanceClock(6_000);
assert.equal(ambientActions, 0);
assert.ok(ambientEvents.some((event) => event.event === "ambient-motion-blocked" && event.details.reason === "behavior-hold"));
ambientMotion.stopAmbientMotionController("test-cleanup");

ambientMotion.configureAmbientBehaviorPolicy(null);
ambientMotion.startAmbientMotionController("legacy-policy-test");
await advanceClock(6_000);
assert.ok(ambientActions > 0, "a null policy must preserve legacy ambient actions");
ambientMotion.stopAmbientMotionController("test-cleanup");

await robot.disconnectLooiRobot();
Date.now = realDateNow;
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
Math.random = realRandom;
console.log("Behavior motion arbitration tests passed");
