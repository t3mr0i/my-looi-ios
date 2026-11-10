import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// The model's action tools against the real robot controller, SDK and mock
// transport: no network, no physical BLE, no model.
const values = new Map();
let nativeImports = 0;
const sceneRequests = [];
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
    ReactNativeBleLooiTransport: class { constructor() { nativeImports++; throw new Error("Physical BLE forbidden in mock integration"); } },
    scanLooiRobotCandidates: async () => { nativeImports++; throw new Error("Physical scan forbidden in mock integration"); },
  },
  "../store/user": { useUserStore: { getState: () => ({ preferences: { robotName: "LOOI", listeningLanguage: "de" } }) } },
  "../character/character-action-runtime": {
    requestCharacterSceneFromAssistant(kind, sessionId) { sceneRequests.push([kind, sessionId]); return sceneRequests.length; },
  },
});
const connection = load("src/device-tools/looi-connection-mode.ts") && load("src/device-tools/looi-robot-autoconnect.ts");
const robot = load("src/device-tools/looi-robot.ts");
const { createRobotCapabilityToolBridge } = load("src/voice/robot-capability-tools.ts");
const bridge = createRobotCapabilityToolBridge();

const trace = (action) => connection.getLooiRobotDebugState().mock?.trace.filter((item) => item.action === action).map((item) => item.detail) ?? [];
let revision = 0;
const turn = (userText, extra = {}) => ({ sessionId: "voice-1", userTurnRevision: ++revision, userText, isCurrent: () => true, ...extra });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, timeoutMs = 3_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < end) await wait(10);
  assert.ok(predicate(), "expected mock event arrived before timeout");
}

try {
  // Not connected: the model is told it failed.
  const offline = await bridge.execute("move_robot", { action: "forward" }, turn("Fahr ein Stück vor."));
  assert.deepEqual([offline.ok, offline.status], [false, "failed"], "a disconnected robot never reports a completed movement");

  await connection.setLooiConnectionMode("mock");
  await connection.setMockLooiScenario("clear");
  await wait(400); // let the mock sensor stream report a safe surface

  connection.clearMockLooiTrace();
  const nod = await bridge.execute("perform_gesture", { gesture: "nod", count: 2 }, turn("Nick mal zweimal."));
  assert.deepEqual([nod.ok, nod.status, nod.count, nod.wheelsUsed], [true, "completed", 2, false]);
  assert.ok(trace("head").length >= 4, "two nods reach the head characteristic");
  assert.deepEqual(trace("drive").filter((payload) => !/^0+$/u.test(payload)), [], "a nod never drives the wheels");

  connection.clearMockLooiTrace();
  const forward = await bridge.execute("move_robot", { action: "forward" }, turn("Komm ein Stück näher."));
  assert.deepEqual([forward.ok, forward.status, forward.safetyBounded], [true, "completed", true], JSON.stringify(forward));
  assert.ok(forward.durationMs > 0 && forward.durationMs <= robot.LOOI_DRIVE_DURATION_LIMITS.maximumMs, "the step is time-bounded");
  assert.ok(trace("drive").length >= 2, "the step writes a drive command and a stop");
  assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop", "the wheels are parked after the step");

  connection.clearMockLooiTrace();
  const around = await bridge.execute("move_robot", { action: "turn_around" }, turn("Dreh dich um."));
  assert.deepEqual([around.ok, around.degrees], [true, 180], JSON.stringify(around));
  assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");

  connection.clearMockLooiTrace();
  const left = await bridge.execute("move_robot", { action: "turn_left" }, turn("Dreh dich nach links."));
  assert.deepEqual([left.ok, left.degrees], [true, 90], JSON.stringify(left));

  // STOP from the model interrupts a running dance and nothing restarts.
  connection.clearMockLooiTrace();
  const danceTurn = turn("Tanz für mich.");
  const dance = bridge.execute("perform_gesture", { gesture: "dance" }, danceTurn);
  await waitUntil(() => trace("head").length + trace("drive").length > 0);
  const stopped = await bridge.execute("stop_robot", {}, danceTurn);
  assert.deepEqual(stopped, { ok: true, status: "stopped", action: "stop" });
  const danceResult = await dance;
  assert.equal(danceResult.ok, false, "an interrupted dance is not reported as done");
  const afterStop = trace("drive").length + trace("head").length;
  await wait(500);
  assert.equal(trace("drive").length + trace("head").length, afterStop, "no further motor write after STOP");
  assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");
  assert.equal((await bridge.execute("move_robot", { action: "forward" }, danceTurn)).reason, "stop_requested");

  // A table edge in front blocks forward motion; the model hears that it did not happen.
  await connection.setMockLooiScenario("front-edge");
  await wait(500);
  connection.clearMockLooiTrace();
  const edge = await bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor."));
  assert.equal(edge.ok, false, `forward at a front edge must not complete: ${JSON.stringify(edge)}`);
  assert.ok(["failed", "blocked"].includes(edge.status));
  assert.equal(connection.getLooiRobotDebugState().mock.direction, "stop");

  // Turn-based voice keeps the wheels parked even with a clear surface.
  await connection.setMockLooiScenario("clear");
  await wait(400);
  connection.clearMockLooiTrace();
  const parked = await bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor.", { allowWheelMotion: false }));
  assert.equal(parked.status, "requires_realtime");
  assert.deepEqual(trace("drive"), []);

  // Display scenes go to the character layer with the voice session.
  const scene = await bridge.execute("play_scene", { scene: "coffee" }, turn("Trink mal einen Kaffee."));
  assert.equal(scene.status, "scene_queued");
  assert.deepEqual(sceneRequests, [["coffee", "voice-1"]]);

  assert.equal(nativeImports, 0);
  console.log("Robot capability tools -> real controller/SDK/mock: nod, step, turns, dance STOP, edge block, parked turn-based wheels, scene PASS (no model, network or hardware)");
} finally {
  await connection.setLooiConnectionMode("disconnected");
  await robot.disconnectLooiRobot();
}
