import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire, globals) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", ...Object.keys(globals), output)(
    module.exports,
    customRequire,
    module,
    file,
    path.dirname(file),
    ...Object.values(globals)
  );
  return module.exports;
}

let onStateChange;
const appState = {
  currentState: "active",
  addEventListener(_, callback) { onStateChange = callback; return { remove() {} }; },
};
let savedRaw = JSON.stringify({ id: "02:00:00:00:00:01", name: "LOOI Robot" });
let connected = false;
let connectCalls = 0;
let failuresRemaining = 0;
const events = [];
const timers = new Map();
let timerId = 0;
async function flush() { for (let index = 0; index < 100; index++) await Promise.resolve(); }
async function runRetry(expectedDelay) {
  assert.equal(timers.size, 1);
  const [id, timer] = timers.entries().next().value;
  assert.equal(timer.delay, expectedDelay);
  timers.delete(id);
  timer.callback();
  await flush();
}

const robotMock = {
  async connectLooiRobot() {
    connectCalls += 1;
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw new Error("Operation was cancelled");
    }
    connected = true;
    return { ok: true, connected: true };
  },
  configureLooiRobotTransport() {},
  async disconnectLooiRobot() { connected = false; },
  getLooiRobotRuntimeState() { return { connected }; },
  markLooiDriveControlNeedsRevalidation() {},
  handleLooiRobotTransportDisconnected() { connected = false; },
  async stopLooiMotion() {},
};

class FakeTransport { constructor(options) { this.options = options; } }

const customRequire = (id) => {
  if (id === "react-native") return { AppState: appState, Platform: { OS: "android" } };
  if (id === "expo-secure-store") {
    return {
      getItemAsync: async () => savedRaw,
      setItemAsync: async (_key, value) => { savedRaw = value; },
      deleteItemAsync: async () => { savedRaw = null; },
    };
  }
  if (id === "../diagnostics/diagnostic-log") {
    return { recordDiagnosticEvent: (category, event, details = {}) => events.push({ category, event, details }) };
  }
  if (id === "./looi-robot") return robotMock;
  if (id === "./react-native-ble-transport") {
    return { ReactNativeBleLooiTransport: FakeTransport, scanLooiRobotCandidates: async () => [] };
  }
  return require(id);
};

const auto = compileTs("src/device-tools/looi-robot-autoconnect.ts", customRequire, {
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
});

await auto.startLooiRobotAutoConnection();
assert.equal(connectCalls, 1);
await auto.suspendLooiRobotAutoConnection("sleep");
assert.equal(connected, false);

failuresRemaining = 1;
await assert.rejects(auto.resumeLooiRobotAutoConnection("wake-from-sleep"), /Operation was cancelled/);
assert.equal(connectCalls, 2, "first foreground reconnect should be attempted immediately");
assert.ok(events.some((event) => event.event === "ble-foreground-reconnect-retry-scheduled"));

await runRetry(1000);
assert.equal(connectCalls, 3, "transient foreground failure should trigger one clean retry");
assert.equal(connected, true, "scheduled retry should restore the BLE link");
assert.ok(events.some((event) => event.event === "ble-foreground-reconnect-retry-start"));
assert.ok(events.some((event) => event.event === "ble-foreground-reconnect-retry-finished" && event.details.ok === true));
assert.equal(timers.size, 0);

// Recovery survives more than one transient failure, with an explicit cap.
await auto.suspendLooiRobotAutoConnection("backoff");
failuresRemaining = 3;
await assert.rejects(auto.resumeLooiRobotAutoConnection(), /Operation was cancelled/);
await runRetry(1000);
await runRetry(2000);
await runRetry(4000);
assert.equal(connected, true);
assert.equal(timers.size, 0);

await auto.suspendLooiRobotAutoConnection("retry-limit");
failuresRemaining = 100;
const callsBeforeExhaustion = connectCalls;
await assert.rejects(auto.resumeLooiRobotAutoConnection(), /Operation was cancelled/);
await runRetry(1000);
await runRetry(2000);
await runRetry(4000);
assert.equal(connectCalls - callsBeforeExhaustion, 4, "one immediate attempt plus three retries");
assert.equal(timers.size, 0, "persistent failure must not retry forever");
assert.ok(events.some((event) => event.event === "ble-foreground-reconnect-exhausted"));

// A later background transition must cancel any pending retry and keep BLE quiet.
await auto.suspendLooiRobotAutoConnection("new-session");
await assert.rejects(auto.resumeLooiRobotAutoConnection(), /Operation was cancelled/);
assert.equal(timers.size, 1, "a new foreground lifecycle restores the retry budget");
const lateCallback = timers.values().next().value.callback;
appState.currentState = "background";
onStateChange("background");
const callsBefore = connectCalls;
assert.equal(timers.size, 0);
lateCallback();
await flush();
assert.equal(connectCalls, callsBefore, "background must not run a foreground retry");
appState.currentState = "active";
await assert.rejects(auto.resumeLooiRobotAutoConnection(), /Operation was cancelled/);
const callsAfterResume = connectCalls;
lateCallback();
await runRetry(1000);
assert.equal(connectCalls, callsAfterResume + 1, "an old queued timer cannot clear a replacement lifecycle's timer");
await auto.suspendLooiRobotAutoConnection();
assert.equal(timers.size, 0);

console.log("BLE foreground retry behavioral tests passed");
