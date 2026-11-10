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
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports,
    customRequire,
    module,
    file,
    path.dirname(file)
  );
  return module.exports;
}

const sdk = compileTs("packages/looi-sdk/src/index.ts");
const fed9 = compileTs("src/device-tools/fed9-sensors.ts");
const events = [];
const writes = [];
let notifyFed9 = null;

const customRequire = (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  if (id === "./fed9-sensors") return fed9;
  if (id === "../diagnostics/diagnostic-log") {
    return { recordDiagnosticEvent: (category, event, details = {}) => events.push({ category, event, details, at: Date.now() }) };
  }
  return require(id);
};

const robot = compileTs("src/device-tools/looi-robot.ts", customRequire, (source) =>
  source
    .replace("export const CONTINUOUS_MOTION_DEADMAN_MS = 5_000;", "export const CONTINUOUS_MOTION_DEADMAN_MS = 600;")
    .replace("export const CLIFF_ESCAPE_CLEAR_MS = 650;", "export const CLIFF_ESCAPE_CLEAR_MS = 120;")
    .replace("export const MANUAL_REPOSITION_SAFE_MS = 900;", "export const MANUAL_REPOSITION_SAFE_MS = 120;")
    .replace("export const TURN_90_MS = 650;", "export const TURN_90_MS = 160;")
    .replace("export const TURN_180_MS = 1_560;", "export const TURN_180_MS = 320;")
);

const transport = {
  async connect() {},
  async disconnect() {},
  hasCharacteristic(key) {
    return key === "dockNotify" || key === "drive";
  },
  async startNotifications(key, callback) {
    if (key === "dockNotify") notifyFed9 = callback;
  },
  async write() {},
};

function frame(bytes) {
  notifyFed9({
    characteristic: "dockNotify",
    hex: Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join(""),
    bytes: new Uint8Array(bytes),
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Leaves lastCliffFrameAt, cliffSafeSince and the front near-edge latch populated on a live connection.
async function populate() {
  robot.configureLooiRobotTransport(transport);
  await robot.connectLooiRobot();
  frame([0x0e, 0xe8, 0x03]);
  frame([1, 1, 1, 1, 1]);
  await wait(280);
  await robot.startLooiMotion("forward");
  frame([1, 0, 1, 1, 1]);
  await wait(40);
  frame([1, 1, 1, 1, 1]);
  const state = robot.getLooiRobotRuntimeState();
  assert.notEqual(state.sensors.lastCliffFrameAt, null, "setup: an edge frame was seen");
  assert.ok(Object.values(state.sensors.cliffSafeSince).some((value) => value !== null), "setup: the safe-since timestamps are set");
  assert.equal(state.nearEdge.front, true, "setup: the front latch is set");
}

function assertReset(label) {
  const state = robot.getLooiRobotRuntimeState();
  assert.equal(state.sensors.lastCliffFrameAt, null, `${label}: lastCliffFrameAt is cleared`);
  assert.deepEqual(state.sensors.cliffSafeSince, { frontLeft: null, frontRight: null, rearLeft: null, rearRight: null }, `${label}: cliffSafeSince is cleared`);
  assert.equal(state.nearEdge.front, false, `${label}: the front near-edge latch is cleared`);
  assert.equal(state.nearEdge.rear, false, `${label}: the rear near-edge latch is cleared`);
}

// Each per-connection sensor reset has to work on its own: with the quiet basis there is no age cap, so a stale
// edge frame of an earlier link must never survive into the next one.
await populate();
robot.configureLooiRobotTransport(transport);
assertReset("configureLooiRobotTransport");

await populate();
robot.handleLooiRobotTransportDisconnected(new Error("test link loss"));
assertReset("handleLooiRobotTransportDisconnected");

await populate();
await robot.disconnectLooiRobot();
assertReset("disconnectLooiRobot");

console.log("LOOI robot: edge-frame time, safe-since timestamps and near-edge latch are cleared by configure, link loss and disconnect each on their own PASS");
