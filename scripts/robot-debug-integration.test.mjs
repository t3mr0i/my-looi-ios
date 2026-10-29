import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const values = new Map();
const listeners = new Set();
let nativeImports = 0;
const appState = { currentState: "active", addEventListener(_event, listener) {
  listeners.add(listener); return { remove: () => listeners.delete(listener) };
} };
const sdk = createTypeScriptTreeLoader()("packages/looi-sdk/src/index.ts");
const load = createTypeScriptTreeLoader({
  "@sourcebug/looi-sdk": sdk,
  "react-native": { AppState: appState, Platform: { OS: "ios" } },
  "expo-secure-store": {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "./react-native-ble-transport": {
    ReactNativeBleLooiTransport: class { constructor() { nativeImports++; throw new Error("Physical BLE must not be reached"); } },
    scanLooiRobotCandidates: async () => { nativeImports++; throw new Error("Physical scan must not be reached"); },
  },
});
const connection = load("src/device-tools/looi-robot-autoconnect.ts");
const robot = load("src/device-tools/looi-robot.ts");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitUntil = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await wait(25);
  return predicate();
};
try {
  await connection.setLooiConnectionMode("mock");
  const observedSensorStates = [];
  const unsubscribeRuntime = robot.subscribeLooiRobotRuntimeState(() => {
    const runtime = robot.getLooiRobotRuntimeState();
    observedSensorStates.push({ safety: runtime.safety.state, obstacleNear: runtime.sensors.obstacleNear });
  });
  assert.equal(await waitUntil(() => observedSensorStates.some((snapshot) => snapshot.safety === "safe") &&
    connection.getLooiRobotDebugState().safety.state === "safe"), true,
  "FED9 updates publish the re-armed safe state to the cached UI snapshot without a controller command");
  assert.equal(connection.getLooiRobotDebugState().connected, true);
  assert.equal(connection.getLooiRobotDebugState().source, "mock");
  assert.equal(robot.getLooiRobotRuntimeState().safety.state, "safe");
  await connection.setMockLooiScenario("obstacle");
  assert.equal(await waitUntil(() => observedSensorStates.some((snapshot) => snapshot.obstacleNear === true)), true,
    "FED9 observer publication exposes a ToF obstacle update without a controller command");
  unsubscribeRuntime();
  await connection.setMockLooiScenario("clear");
  await wait(300);
  await robot.performLooiHeadGesture("nod", 1);
  await robot.setLooiLight(true);
  assert.equal(connection.getLooiRobotDebugState().mock.lightEnabled, true);
  assert.ok(connection.getLooiRobotDebugState().mock.trace.filter((entry) => entry.action === "head").length >= 2);
  await robot.driveLooiForDuration("forward", 120);
  assert.equal(robot.getLooiRobotRuntimeState().motionActive, false);
  assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");
  assert.ok(connection.getLooiRobotDebugState().mock.trace.some((entry) => entry.action === "drive" && entry.detail === "7707"));

  await connection.setMockLooiScenario("obstacle");
  const beforeBlockedDrive = connection.getLooiRobotDebugState().mock.trace.at(-1)?.id ?? 0;
  await assert.rejects(robot.driveLooiForDuration("forward", 120), /obstacle/i);
  assert.equal(connection.getLooiRobotDebugState().mock.trace.filter((entry) => entry.id > beforeBlockedDrive)
    .some((entry) => entry.action === "drive" && entry.detail === "7707"), false);

  await connection.setMockLooiScenario("front-edge");
  await assert.rejects(robot.driveLooiForDuration("forward", 120), /cliff/i);
  await connection.setMockLooiScenario("unknown");
  assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSafe, null);
  assert.equal(robot.getLooiRobotRuntimeState().safety.state, "unknown");
  await assert.rejects(robot.driveLooiForDuration("forward", 120), /fed9-never-seen/);

  await connection.setMockLooiScenario("clear");
  await wait(300);
  const moving = robot.driveLooiForDuration("forward", 500);
  await wait(40);
  await connection.setMockLooiConnected(false);
  await moving.catch(() => undefined);
  assert.equal(robot.getLooiRobotRuntimeState().motionActive, false);
  assert.equal(connection.getLooiRobotDebugState().connected, false);
  assert.equal(connection.getLooiRobotDebugState().mockConnectedRequested, false);
  assert.equal((await connection.startLooiRobotAutoConnection()).ok, false);
  await assert.rejects(robot.setLooiHead("up"), /disconnect|disabled|inactive|cancel|unavailable|mock/i);

  await connection.setMockLooiConnected(true);
  assert.equal(connection.getLooiRobotDebugState().connected, true);
  await connection.setLooiConnectionMode("disconnected");
  await assert.rejects(robot.setLooiLight(true), /disconnect|disabled|inactive|cancel|unavailable/i);
  assert.equal((await connection.startLooiRobotAutoConnection()).ok, false);
  assert.equal(nativeImports, 0);
  console.log("Robot debug integration: actual SDK/controller, head/light/drive, safety blocks, unknown reset, link loss and offline isolation PASS");
} finally {
  await connection.setLooiConnectionMode("disconnected");
  await robot.disconnectLooiRobot();
}
