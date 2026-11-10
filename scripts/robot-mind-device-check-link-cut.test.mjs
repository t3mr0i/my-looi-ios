import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire = require, transformSource = (source) => source) {
  const source = transformSource(fs.readFileSync(file, "utf8"));
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", output);
  fn(module.exports, customRequire, module, file, path.dirname(file));
  return module.exports;
}

const sdk = compileTs("packages/looi-sdk/src/index.ts");
const fed9 = compileTs("src/device-tools/fed9-sensors.ts");
const events = [];
const writes = [];
let notifyFed9 = null;
let closed = false;

const customRequire = (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  if (id === "./fed9-sensors") return fed9;
  if (id === "../diagnostics/diagnostic-log") {
    return { recordDiagnosticEvent: (category, event, details = {}) => events.push({ category, event, details }) };
  }
  return require(id);
};

const robotSource = fs.readFileSync("src/device-tools/looi-robot.ts", "utf8");
assert.ok(robotSource.includes("export const TURN_180_MS = 1_560;"), "turn constant to shorten must exist");
const robot = compileTs("src/device-tools/looi-robot.ts", customRequire, (source) =>
  source.replace("export const TURN_180_MS = 1_560;", "export const TURN_180_MS = 600;")
);

const transport = {
  async connect() {},
  async disconnect() { closed = true; },
  hasCharacteristic(key) { return key === "dockNotify" || key === "drive"; },
  async startNotifications(key, callback) { if (key === "dockNotify") notifyFed9 = callback; },
  async write(key, payload, options) {
    if (closed) throw new Error("write after close");
    writes.push({ at: Date.now(), key, payload, options, closed });
  },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const feed = (hex) => notifyFed9({ characteristic: "dockNotify", hex, bytes: Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16))) });

robot.configureLooiRobotTransport(transport);
await robot.connectLooiRobot();
assert.ok(notifyFed9, "FED9 callback should be registered");

// 1. Observer.
const seen = [];
const unsubscribe = robot.subscribeLooiFed9Frames((frame) => seen.push(frame));
const unsubscribeThrowing = robot.subscribeLooiFed9Frames(() => { throw new Error("observer bug"); });
feed("0101010101");
feed("0ee803");
assert.deepEqual(seen.map((f) => f.hex), ["0101010101", "0ee803"]);
assert.ok(seen.every((f) => typeof f.at === "number"));
assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSafe, true, "a throwing observer must not break sensor handling");
unsubscribe();
unsubscribeThrowing();
feed("0101010101");
assert.equal(seen.length, 2, "no calls after unsubscribe");

// 2. Idle cut does nothing.
const idleWrites = writes.length;
const idleEvents = events.length;
assert.equal((await robot.cutLooiLinkDuringMotionForDeviceCheck()).cut, false);
assert.equal(writes.length, idleWrites);
assert.ok(!events.slice(idleEvents).some((e) => e.event === "ble-disconnected" || e.event === "device-check-link-cut"));
assert.equal(robot.getLooiRobotRuntimeState().connected, true);

// 3. Cut during a turn writes no STOP and nothing else afterwards.
async function startTurnAndWait() {
  feed("0101010101");
  feed("0ee803");
  await sleep(300);
  const turn = robot.turnLooi("left", 180).catch(() => null);
  for (let waited = 0; !robot.getLooiRobotRuntimeState().motionActive && waited < 1500; waited += 10) await sleep(10);
  assert.equal(robot.getLooiRobotRuntimeState().motionActive, true, "turn should start");
  return { turn };
}
const { turn } = await startTurnAndWait();
await sleep(100);
const cutIndex = writes.length;
const eventsBeforeCut = events.length;
const cut = await robot.cutLooiLinkDuringMotionForDeviceCheck();
assert.deepEqual(cut, { cut: true, direction: "left" });
await sleep(900);
const afterCut = writes.slice(cutIndex);
assert.ok(!afterCut.some((w) => w.payload === "0000"), "no STOP write after the cut");
assert.equal(afterCut.length, 0, "no drive write at all after the cut");
const cutEvents = events.slice(eventsBeforeCut);
const cutAt = cutEvents.findIndex((e) => e.event === "device-check-link-cut" && e.details.direction === "left");
const lostAt = cutEvents.findIndex((e) => e.event === "ble-disconnected" && e.details.previousDirection === "left");
assert.ok(cutAt >= 0 && lostAt > cutAt, "link-cut event followed by ble-disconnected with previousDirection left");
const afterState = robot.getLooiRobotRuntimeState();
assert.equal(afterState.connected, false);
assert.equal(afterState.motionActive, false);
await turn;

// 4. Control: an ordinary stop during a fresh turn does write STOP.
closed = false;
await robot.connectLooiRobot();
const { turn: turn2 } = await startTurnAndWait();
const controlIndex = writes.length;
await robot.stopLooiMotion("test-control");
await turn2;
assert.ok(writes.slice(controlIndex).some((w) => w.payload === "0000"), "control: ordinary stop writes STOP");

await robot.disconnectLooiRobot();
console.log("Device check link-cut tests passed");
