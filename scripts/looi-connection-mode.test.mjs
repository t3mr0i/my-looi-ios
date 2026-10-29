import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire = require) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports,
    customRequire,
    module,
    file,
    path.dirname(file),
  );
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate, message = "the expected asynchronous stage should be reached") {
  for (let index = 0; index < 200 && !predicate(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(predicate(), message);
}

const appState = {
  currentState: "active",
  addEventListener(_event, callback) {
    this.onChange = callback;
    return { remove() {} };
  },
};
const secureValues = new Map([
  ["looi.robot.selected.v1", JSON.stringify({ id: "robot-physical-1", name: "LOOI Physical" })],
  ["looi.robot.connection-mode.v1", JSON.stringify({ mode: "hardware", mockConnectedRequested: true })],
]);
const diagnostics = { recordDiagnosticEvent() {} };
const physicalWrites = [];
const physicalTransports = [];
let physicalConnectCalls = 0;
let physicalModuleRequireCount = 0;
let physicalScanCalls = 0;
let stopWriteGate = null;
let stopWriteStarted = null;

class FakePhysicalTransport {
  constructor(options) {
    this.options = options;
    this.connected = false;
    physicalTransports.push(this);
  }

  async connect() {
    if (!this.options.isConnectionAllowed()) throw new Error("physical connect was cancelled");
    physicalConnectCalls += 1;
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  hasCharacteristic() {
    return true;
  }

  async startNotifications() {}

  async write(characteristic, payload) {
    if (!this.connected) throw new Error("physical transport is disconnected");
    physicalWrites.push({ characteristic, payload });
    if (characteristic === "drive" && payload === "0000" && stopWriteGate) {
      stopWriteStarted?.resolve();
      await stopWriteGate.promise;
      stopWriteGate = null;
    }
  }
}

const sdk = compileTs("packages/looi-sdk/src/index.ts");
const fed9 = compileTs("src/device-tools/fed9-sensors.ts");
const mockModule = compileTs("src/device-tools/mock-looi-transport.ts", (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  return require(id);
});
const mockRequire = (id) => {
  if (id === "react-native") return { AppState: appState, Platform: { OS: "ios" } };
  if (id === "expo-secure-store") {
    return {
      async getItemAsync(key) { return secureValues.get(key) ?? null; },
      async setItemAsync(key, value) { secureValues.set(key, value); },
      async deleteItemAsync(key) { secureValues.delete(key); },
    };
  }
  if (id === "../diagnostics/diagnostic-log") return diagnostics;
  if (id === "@sourcebug/looi-sdk") return sdk;
  if (id === "./fed9-sensors") return fed9;
  if (id === "./looi-robot") return robot;
  if (id === "./mock-looi-transport") return mockModule;
  if (id === "./react-native-ble-transport") {
    physicalModuleRequireCount += 1;
    return {
      ReactNativeBleLooiTransport: FakePhysicalTransport,
      async scanLooiRobotCandidates() { physicalScanCalls += 1; return []; },
    };
  }
  return require(id);
};
const robot = compileTs("src/device-tools/looi-robot.ts", mockRequire);
const auto = compileTs("src/device-tools/looi-robot-autoconnect.ts", mockRequire);

// Begin on the physical default so a mode switch has a real live SDK client to
// release. The delayed STOP makes the direct-tool race observable.
const started = await auto.startLooiRobotAutoConnection();
assert.equal(started.ok, true);
assert.equal(physicalConnectCalls, 1);
assert.equal(physicalTransports[0].options.deviceId, "robot-physical-1");
await robot.setLooiLight(true);
assert.ok(physicalWrites.some((entry) => entry.characteristic === "light" && entry.payload === "01"));

const stopped = deferred();
stopWriteGate = deferred();
stopWriteStarted = stopped;
const toDisconnected = auto.setLooiConnectionMode("disconnected");
await until(() => stopWriteStarted === null || physicalWrites.at(-1)?.payload === "0000");
assert.equal(physicalWrites.at(-1)?.characteristic, "drive", "mode teardown sends only its safety STOP to the old client");
await assert.rejects(robot.setLooiLight(true), /disabled/,
  "a direct robot tool invoked while STOP is draining must use the fail-closed transport");
assert.deepEqual(physicalWrites.slice(-1), [{ characteristic: "drive", payload: "0000" }],
  "no non-STOP write may reach hardware after the mode change starts");
assert.equal(physicalConnectCalls, 1, "disconnected mode cannot reopen the old BLE client");
stopWriteGate.resolve();
await toDisconnected;
assert.equal(auto.getLooiRobotDebugState().source, "none");
await assert.rejects(robot.setLooiLight(true), /disabled/);
assert.deepEqual(await auto.scanLooiRobotCandidates(), [], "disconnected mode does not scan for physical hardware");
assert.equal(physicalScanCalls, 0);
assert.equal(physicalConnectCalls, 1);

// Mock mode uses the production LooiRobot and sensor pipeline while keeping
// the native BLE adapter untouched.
const importsBeforeMock = physicalModuleRequireCount;
await auto.setLooiConnectionMode("mock");
let debug = auto.getLooiRobotDebugState();
assert.equal(debug.mode, "mock");
assert.equal(debug.source, "mock", "the UI can label the runtime as simulated");
assert.equal(debug.connected, true);
assert.equal(debug.mock?.scenario, "clear");
await robot.setLooiLight(true);
assert.equal(auto.getLooiRobotDebugState().mock?.lightEnabled, true);
await auto.setMockLooiScenario("front-edge");
assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSensors.frontLeft, false,
  "mock FED9 cliff frames must feed the real runtime safety state");
assert.equal(physicalModuleRequireCount, importsBeforeMock, "mock connect does not load the native BLE adapter");
assert.deepEqual(await auto.scanLooiRobotCandidates(), []);
assert.equal(physicalScanCalls, 0);

// Re-arm the clear scenario through the same SDK sensor subscription, then
// stop an active motion by switching the transport out from under the tool.
await auto.setMockLooiScenario("clear");
await new Promise((resolve) => setTimeout(resolve, 350));
await robot.startLooiMotion("forward");
assert.equal(robot.getLooiRobotRuntimeState().motionActive, true);
assert.equal(auto.getLooiRobotDebugState().mock?.direction, "forward");
await auto.setLooiConnectionMode("disconnected");
assert.equal(robot.getLooiRobotRuntimeState().motionActive, false,
  "disconnecting the simulator clears active motion immediately");
assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSensors, null,
  "disconnecting the simulator clears stale sensor data");
assert.equal(physicalModuleRequireCount, importsBeforeMock);

// Scenario `unknown` restarts the SDK sensor subscription so prior SAFE data
// cannot remain latched; simulated link loss persists through resume.
await auto.setLooiConnectionMode("mock");
assert.equal(auto.getLooiRobotDebugState().connected, true);
await auto.setMockLooiScenario("unknown");
assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSensors, null);
assert.equal(robot.getLooiRobotRuntimeState().safety.state, "unknown");
await auto.setMockLooiConnected(false);
debug = auto.getLooiRobotDebugState();
assert.equal(debug.mockConnectedRequested, false);
assert.equal(debug.connected, false);
assert.equal(await auto.startLooiRobotAutoConnection().then((result) => result.reason), "mock-disconnected");
assert.deepEqual(await auto.resumeLooiRobotAutoConnection(), { ok: false, skipped: true, reason: "mock-disconnected" });
assert.equal(auto.getLooiRobotDebugState().connected, false, "foreground resume does not override injected link loss");
await assert.rejects(robot.setLooiLight(true), /disconnected/);
await auto.setMockLooiConnected(true);
assert.equal(auto.getLooiRobotDebugState().connected, true, "the explicit mock reconnect control restores the simulation");
assert.equal(physicalConnectCalls, 1);
assert.equal(physicalModuleRequireCount, importsBeforeMock);

// Switching back to hardware uses the original saved identity and performs a
// fresh, authorized BLE connection only after the user selects hardware.
await auto.setLooiConnectionMode("hardware");
assert.equal(physicalConnectCalls, 2);
assert.equal(physicalTransports.at(-1).options.deviceId, "robot-physical-1");
assert.deepEqual(await auto.getSavedLooiRobot(), { id: "robot-physical-1", name: "LOOI Physical" });
assert.equal(auto.getLooiRobotDebugState().source, "hardware");
console.log("LOOI connection-mode behavioral tests passed");
