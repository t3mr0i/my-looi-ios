import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire = require) {
  const source = fs.readFileSync(file, "utf8");
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
const mockModule = compileTs("src/device-tools/mock-looi-transport.ts", (id) => {
  if (id === "@sourcebug/looi-sdk") return sdk;
  return require(id);
});
const { MockLooiTransport } = mockModule;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let index = 0; index < 100 && !predicate(); index += 1) await Promise.resolve();
  assert.ok(predicate(), "the expected mock transport lifecycle stage should be reached");
}

assert.equal(typeof MockLooiTransport, "function");
assert.doesNotMatch(
  fs.readFileSync("src/device-tools/mock-looi-transport.ts", "utf8"),
  /react-native-ble-plx|react-native-ble-transport/,
  "the mock transport must not import the native BLE stack",
);

const callbacks = [];
const disconnects = [];
const transport = new MockLooiTransport({
  initialScenario: "clear",
  onDisconnected: (error) => disconnects.push(error),
});
const robot = new sdk.LooiRobot(transport);
const observedNotifications = [];

await robot.connect({
  initTimeHex: "4132303236203036203234203030203535203432",
  onRawNotify: (event) => observedNotifications.push(event),
});

assert.equal(transport.getSnapshot().connected, true);
assert.equal(transport.getGattSnapshot().deviceId, "mock-looi");
assert.deepEqual(
  transport.getSnapshot().trace.filter((item) => item.action === "handshakeControl" || item.action === "handshakeData")
    .map(({ action, detail }) => [action, detail]),
  [["handshakeControl", "03"], ["handshakeData", "4132303236203036203234203030203535203432"], ["handshakeControl", "8101"]],
  "the real SDK handshake should traverse mock transport writes",
);

const latestFrame = () => observedNotifications.filter((event) => event.characteristic === "fed9").at(-1);
const decodeLatest = () => fed9.decodeFed9SensorFrame(latestFrame().bytes);
assert.equal(decodeLatest().kind, "tof");
assert.equal(decodeLatest().distanceMm, null, "clear scenario should use the FED9 no-target value");
const initialCliff = fed9.decodeFed9SensorFrame(
  observedNotifications.find((event) => event.characteristic === "fed9" && event.bytes.length === 5).bytes,
);
assert.equal(initialCliff.kind, "cliff");
assert.equal(initialCliff.safe, true, "clear scenario should report all four ground sensors");

transport.setScenario("front-edge");
const front = fed9.decodeFed9SensorFrame(
  observedNotifications.filter((event) => event.characteristic === "fed9" && event.bytes.length === 5).at(-1).bytes,
);
assert.equal(front.kind, "cliff");
assert.equal(front.sensors.frontLeft, false);
assert.equal(front.sensors.frontRight, false);
assert.equal(front.sensors.rearLeft, true);
assert.equal(front.sensors.rearRight, true);

transport.setScenario("rear-edge");
const rear = fed9.decodeFed9SensorFrame(
  observedNotifications.filter((event) => event.characteristic === "fed9" && event.bytes.length === 5).at(-1).bytes,
);
assert.equal(rear.kind, "cliff");
assert.equal(rear.sensors.frontLeft, true);
assert.equal(rear.sensors.frontRight, true);
assert.equal(rear.sensors.rearLeft, false);
assert.equal(rear.sensors.rearRight, false);

transport.setScenario("obstacle");
const obstacle = decodeLatest();
assert.equal(obstacle.kind, "tof");
assert.equal(obstacle.distanceMm, 80);
assert.equal(obstacle.obstacleNear, true);

transport.setScenario("unknown");
const countAtUnknown = observedNotifications.length;
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(observedNotifications.length, countAtUnknown, "unknown scenario should suppress sensor notifications");

// Exercise actual SDK writes and confirm they update the observable transport state.
await robot.move("forward");
assert.equal(transport.getSnapshot().direction, "forward");
await robot.stop();
assert.equal(transport.getSnapshot().direction, "stop");
await robot.setHead("up");
assert.equal(transport.getSnapshot().head, "up");
await robot.setHead("center");
assert.equal(transport.getSnapshot().head, "center");
await robot.setHead("down");
assert.equal(transport.getSnapshot().head, "down");
await robot.setHead("92");
assert.deepEqual(transport.getSnapshot().head, { raw: "92" });
await robot.setLight(true);
assert.equal(transport.getSnapshot().lightEnabled, true);
await robot.setLight(false);
assert.equal(transport.getSnapshot().lightEnabled, false);

await assert.rejects(transport.write("head", "xyz", { expectedBytes: 1 }), /Invalid hex payload/);
await assert.rejects(transport.write("head", "0102", { expectedBytes: 1 }), /Expected 1 bytes/);

const stopFollowing = transport.subscribe((snapshot) => callbacks.push(snapshot));
await robot.move("left");
assert.equal(callbacks.at(-1).direction, "left", "snapshot listeners receive real SDK write state");
stopFollowing();

// Repeated SDK drive frames coalesce, while unrelated entries are strictly bounded.
transport.clearTrace();
for (let index = 0; index < 300; index += 1) {
  await robot.move("forward");
}
const repeatedDrive = transport.getSnapshot().trace.find((item) => item.action === "drive");
assert.equal(repeatedDrive.repetitions, 300);
for (let index = 0; index < 140; index += 1) {
  await transport.write("rawFe00", index.toString(16).padStart(2, "0"), { expectedBytes: 1 });
}
assert.ok(transport.getSnapshot().trace.length <= 120);

let notificationsAfterDisconnect = observedNotifications.length;
await robot.disconnect();
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(transport.getSnapshot().connected, false);
assert.equal(observedNotifications.length, notificationsAfterDisconnect, "disconnect must stop callbacks and sensor timers");
await assert.rejects(transport.write("drive", "7707", { expectedBytes: 2 }), /disconnected/);

// Link loss follows the native adapter callback and stops the stream immediately.
const lossy = new MockLooiTransport({ initialScenario: "clear", onDisconnected: (error) => disconnects.push(error) });
const lossyRobot = new sdk.LooiRobot(lossy);
let lateNotifications = 0;
await lossyRobot.connect({ onRawNotify: () => { lateNotifications += 1; } });
const notificationCountAtLoss = lateNotifications;
lossy.simulateLinkLoss();
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(lossy.getSnapshot().connected, false);
assert.equal(lateNotifications, notificationCountAtLoss, "link loss must stop late callbacks");
assert.equal(disconnects.at(-1)?.message, "Simulated LOOI link loss");
await assert.rejects(lossyRobot.move("forward"), /disconnected/);
await lossyRobot.disconnect();

// Unknown starts without a sensor stream and therefore remains distinguishable from clear.
const unknown = new MockLooiTransport();
const unknownRobot = new sdk.LooiRobot(unknown);
const unknownFrames = [];
await unknownRobot.connect({ onRawNotify: (event) => unknownFrames.push(event) });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(unknownFrames.length, 0);
await unknownRobot.disconnect();

// A native connection may finish after its owner requested disconnect. The SDK
// must not handshake against or revive the released transport after that race.
const delayedConnect = new MockLooiTransport({ initialScenario: "clear" });
const connectGate = deferred();
const realMockConnect = delayedConnect.connect.bind(delayedConnect);
delayedConnect.connect = async () => {
  await realMockConnect();
  await connectGate.promise;
};
const delayedConnectRobot = new sdk.LooiRobot(delayedConnect);
const lateConnect = delayedConnectRobot.connect({ onRawNotify: () => observedNotifications.push({ characteristic: "late" }) });
await until(() => delayedConnect.getSnapshot().connected);
await delayedConnectRobot.disconnect();
connectGate.resolve();
await assert.rejects(lateConnect, /disconnected/);
assert.equal(delayedConnect.getSnapshot().connected, false, "late SDK connect must not revive a disconnected mock");
assert.equal(delayedConnect.getSnapshot().trace.some((entry) => entry.action === "handshakeControl"), false,
  "a connection cancelled before handshake must not write stale handshake frames");

// A queued first drive frame released only after disconnect must be rejected by
// the transport, and the SDK must not arm its periodic drive loop afterward.
const delayedWrite = new MockLooiTransport({ initialScenario: "clear" });
const delayedWriteRobot = new sdk.LooiRobot(delayedWrite);
await delayedWriteRobot.connect();
const writeGate = deferred();
const originalWrite = delayedWrite.write.bind(delayedWrite);
let driveWriteEntered = false;
const acceptedDriveWrites = [];
delayedWrite.write = async (key, payload, options) => {
  if (key === "drive" && payload === "7707") {
    driveWriteEntered = true;
    await writeGate.promise;
  }
  const result = await originalWrite(key, payload, options);
  if (key === "drive") acceptedDriveWrites.push(payload);
  return result;
};
const queuedDriveStart = delayedWriteRobot.startMoveLoop("forward");
await until(() => driveWriteEntered);
await delayedWriteRobot.disconnect();
writeGate.resolve();
await assert.rejects(queuedDriveStart, /disconnected/);
assert.deepEqual(acceptedDriveWrites, [], "stale queued motor frames must not reach the disconnected mock");
assert.equal(delayedWriteRobot.driveTimer, null, "a cancelled first frame must not arm the SDK repeat timer");

console.log("Mock LOOI transport behavioral tests passed");
