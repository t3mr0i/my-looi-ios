import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const values = new Map();
let nativeImports = 0;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("Offline rehearsal must not use the network"); };
const sdk = createTypeScriptTreeLoader()("packages/looi-sdk/src/index.ts");
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
    ReactNativeBleLooiTransport: class { constructor() { nativeImports++; throw new Error("Physical BLE forbidden in mock rehearsal"); } },
    scanLooiRobotCandidates: async () => { nativeImports++; throw new Error("Physical scan forbidden in mock rehearsal"); },
  },
});
const connection = load("src/device-tools/looi-robot-autoconnect.ts");
const robot = load("src/device-tools/looi-robot.ts");
const { createBehaviorRehearsal } = load("src/behavior/behavior-rehearsal.ts");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, timeoutMs = 1_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < end) await wait(10);
  assert.ok(predicate(), "expected mock event arrived before timeout");
}
const heads = () => connection.getLooiRobotDebugState().mock?.trace.filter((item) => item.action === "head").map((item) => item.detail) ?? [];
let stopGeneration = 0;
const runner = createBehaviorRehearsal({
  canRun: () => {
    const debug = connection.getLooiRobotDebugState();
    return debug.mode === "mock" && debug.source === "mock" && debug.connected &&
      debug.mock?.connected === true && !debug.switching &&
      robot.getLooiRobotRuntimeState().stopGeneration === stopGeneration;
  },
  executeCue: (cue, isCurrent) => robot.performLooiBehaviorHeadGesture(cue.gesture, isCurrent),
});

try {
  await connection.setLooiConnectionMode("mock");
  for (const [scenario, gesture, payloads] of [
    ["curiosity", "curious", ["00", "87"]],
    ["celebration", "happy_bob", ["00", "ff", "00", "87"]],
    ["less-nodding", "hold", []],
    ["interrupted", null, []],
  ]) {
    stopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
    connection.clearMockLooiTrace();
    await runner.run(scenario);
    const result = runner.getState();
    assert.equal(result.status, "passed", `${scenario}: ${result.error ?? ""}`);
    assert.equal(result.observed, gesture);
    assert.equal(result.decisionCount, 1);
    assert.deepEqual(heads(), payloads, `${scenario} must reach the actual controller/SDK head writes`);
    assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop", "behavior rehearsal never drives wheels");
  }

  connection.clearMockLooiTrace();
  stopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
  const stopped = runner.run("celebration");
  await waitUntil(() => heads().length > 0);
  const stop = robot.stopLooiMotion("rehearsal-integration-stop");
  runner.cancel();
  await stop;
  const stoppedHeads = heads();
  await stopped;
  await wait(600);
  assert.equal(runner.getState().status, "cancelled");
  assert.deepEqual(heads(), stoppedHeads, "STOP prevents every remaining behavior head write");

  connection.clearMockLooiTrace();
  stopGeneration = robot.getLooiRobotRuntimeState().stopGeneration;
  const modeChanged = runner.run("curiosity");
  await waitUntil(() => heads().length > 0);
  await connection.setLooiConnectionMode("disconnected");
  await modeChanged;
  assert.notEqual(runner.getState().status, "passed", "a source switch cannot report a successful cue");
  await runner.run("curiosity");
  assert.equal(runner.getState().status, "failed", "disconnected source fails closed");
  assert.equal(networkCalls, 0);
  assert.equal(nativeImports, 0);
  console.log("Behavior rehearsal → real engine/controller/SDK/mock: four scenarios, no wheels/network/BLE, STOP and source-switch isolation PASS");
} finally {
  runner.dispose();
  await connection.setLooiConnectionMode("disconnected");
  await robot.disconnectLooiRobot();
  globalThis.fetch = originalFetch;
}
