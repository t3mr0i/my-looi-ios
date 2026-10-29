import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function load(file, dependencies, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let index = 0; index < 100 && !predicate(); index++) await Promise.resolve();
  assert.ok(predicate(), "The expected asynchronous stage must be reached");
}

const diagnostics = { recordDiagnosticEvent() {} };

// A SecureStore read that completes after suspension cannot configure a
// transport, and an old disconnect callback cannot invalidate a new link.
for (const platform of ["ios", "android"]) {
  const appState = { currentState: "active", addEventListener(_, callback) {
    this.onChange = callback; return { remove() {} };
  } };
  let storedRobot = deferred();
  let reads = 0, physicalConfigurations = 0, inertConfigurations = 0;
  let connections = 0, disconnections = 0, connected = false;
  let currentTransport;
  class FakePhysicalTransport {
    constructor(options) { this.options = options; }
  }
  const auto = load("src/device-tools/looi-robot-autoconnect.ts", {
    "react-native": { AppState: appState, Platform: { OS: platform } },
    "expo-secure-store": {
      getItemAsync() { reads++; return storedRobot.promise; },
      async setItemAsync() {}, async deleteItemAsync() {},
    },
    "../diagnostics/diagnostic-log": diagnostics,
    "./looi-robot": {
      configureLooiRobotTransport(transport) {
        currentTransport = transport;
        if (transport instanceof FakePhysicalTransport) physicalConfigurations++;
        if (transport?.constructor?.name === "DisconnectedLooiTransport") inertConfigurations++;
      },
      async connectLooiRobot() { connections++; connected = true; return { ok: true, connected: true }; },
      async disconnectLooiRobot() { connected = false; },
      getLooiRobotRuntimeState: () => ({ connected }),
      handleLooiRobotTransportDisconnected() { disconnections++; connected = false; },
      markLooiDriveControlNeedsRevalidation() {}, async stopLooiMotion() {},
    },
    "./react-native-ble-transport": { ReactNativeBleLooiTransport: FakePhysicalTransport },
  });
  const first = auto.startLooiRobotAutoConnection();
  assert.equal(auto.startLooiRobotAutoConnection(), first, "duplicate starts share an attempt");
  await until(() => reads === 1);
  appState.currentState = "background";
  appState.onChange("background");
  storedRobot.resolve(JSON.stringify({ id: "robot", name: "LOOI" }));
  assert.equal((await first).reason, "superseded");
  assert.equal(inertConfigurations, 1, "background cancellation immediately binds the fail-closed transport");
  assert.equal(physicalConfigurations, 0, "a cancelled startup never configures physical BLE");
  assert.equal(connections, 0);
  assert.equal(currentTransport?.constructor?.name, "DisconnectedLooiTransport");
  await assert.rejects(currentTransport.write("light", "01"), /disabled/,
    "direct tool writes remain blocked while the app is backgrounded");
  assert.equal((await auto.startLooiRobotAutoConnection()).reason, "background-suspended");
  assert.equal(connections, 0, "a background retry cannot revive the cancelled physical connection");
  await assert.rejects(auto.connectSelectedLooiRobot({ id: "other", name: "Other" }), /active native app/);
  appState.currentState = "active";
  await auto.resumeLooiRobotAutoConnection();
  assert.equal(connections, 1);
  const previous = currentTransport;
  await auto.suspendLooiRobotAutoConnection();
  await auto.resumeLooiRobotAutoConnection();
  assert.equal(connections, 2);
  assert.equal(previous.options.isConnectionAllowed(), false);
  previous.options.onDisconnected(new Error("late callback"));
  assert.equal(disconnections, 0);
  assert.equal(connected, true);
  await auto.suspendLooiRobotAutoConnection();

  // A late storage failure belongs to the cancelled startup as well. It cannot
  // schedule retries or turn the replacement lifecycle into a failed connect.
  storedRobot = deferred();
  const readsBefore = reads;
  const cancelledRead = auto.resumeLooiRobotAutoConnection();
  await until(() => reads > readsBefore);
  appState.currentState = "background";
  appState.onChange("background");
  storedRobot.reject(new Error("stale SecureStore read failed"));
  assert.equal((await cancelledRead).reason, "superseded");
}

const sdk = load("packages/looi-sdk/src/index.ts", {});
const fed9 = load("src/device-tools/fed9-sensors.ts", {});
const robot = load("src/device-tools/looi-robot.ts", {
  "@sourcebug/looi-sdk": sdk,
  "./fed9-sensors": fed9,
  "../diagnostics/diagnostic-log": diagnostics,
});
const oldStart = deferred();
let notifyOld;
robot.configureLooiRobotTransport({
  connect: () => oldStart.promise,
  async disconnect() {}, async write() {},
  hasCharacteristic: (key) => key === "dockNotify",
  async startNotifications(_, callback) { notifyOld = callback; },
});
const oldConnection = robot.connectLooiRobot();
const oldRejected = assert.rejects(oldConnection, /superseded/);
await robot.disconnectLooiRobot();
oldStart.resolve();
await oldRejected;
assert.equal(robot.getLooiRobotRuntimeState().connected, false, "late native success cannot revive disconnected state");

robot.configureLooiRobotTransport({
  async connect() {}, async disconnect() {}, async write() {},
  hasCharacteristic: () => false,
});
await robot.connectLooiRobot();
notifyOld({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
assert.equal(robot.getLooiRobotRuntimeState().sensors.cliffSafe, null, "old notifications cannot update the replacement robot");
await robot.disconnectLooiRobot();

const nativeModule = load("src/device-tools/react-native-ble-transport.ts", {
  "react-native": { Platform: { OS: "ios" } },
  "react-native-ble-plx": { BleManager: class {}, State: { PoweredOn: "PoweredOn", PoweredOff: "PoweredOff" }, ScanMode: {} },
  "@sourcebug/looi-sdk": sdk,
  "../diagnostics/diagnostic-log": diagnostics,
});
function manager(overrides = {}) {
  const calls = { cancelled: [], discover: 0, characteristics: 0, removed: 0 };
  return {
    calls,
    async state() { return "PoweredOn"; },
    async connectedDevices() { return []; },
    async devices() { return [{ id: "robot" }]; },
    async isDeviceConnected() { return false; },
    async connectToDevice() { return { id: "robot" }; },
    async cancelDeviceConnection(id) { calls.cancelled.push(id); },
    onDeviceDisconnected() { return { remove() { calls.removed++; } }; },
    async stopDeviceScan() {},
    async discoverAllServicesAndCharacteristicsForDevice() { calls.discover++; },
    async servicesForDevice() { return []; },
    async characteristicsForDevice() { calls.characteristics++; return []; },
    ...overrides,
  };
}
const Transport = nativeModule.ReactNativeBleLooiTransport;

// Cancellation reaches the native device even before connectToDevice resolves.
// If an adapter still returns late success, the link is closed a second time.
{
  const nativeStart = deferred();
  let connecting = false;
  const native = manager({ connectToDevice() { connecting = true; return nativeStart.promise; } });
  const transport = new Transport({ manager: native, deviceId: "robot" });
  const first = transport.connect();
  assert.equal(transport.connect(), first);
  const rejected = assert.rejects(first, /cancelled/);
  await until(() => connecting);
  await transport.disconnect();
  assert.deepEqual(native.calls.cancelled, ["robot"]);
  nativeStart.resolve({ id: "robot" });
  await rejected;
  assert.equal(native.calls.discover, 0);
  assert.deepEqual(native.calls.cancelled, ["robot", "robot"]);
  assert.equal(transport.getGattSnapshot().deviceId, null);
}

// A late GATT provider result cannot repopulate a disconnected session.
{
  const services = deferred();
  let reading = false;
  const native = manager({ servicesForDevice() { reading = true; return services.promise; } });
  const transport = new Transport({ manager: native, deviceId: "robot" });
  const connection = transport.connect();
  const rejected = assert.rejects(connection, /cancelled/);
  await until(() => reading);
  await transport.disconnect();
  services.resolve([{ uuid: "service" }]);
  await rejected;
  assert.equal(native.calls.characteristics, 0);
  assert.deepEqual(transport.getGattSnapshot().availableKeys, []);
}

// Radio and scan waits reject on disconnect rather than hanging until timeout.
{
  let listening = false, removed = 0;
  const native = manager({
    async state() { return "PoweredOff"; },
    onStateChange() { listening = true; return { remove() { removed++; } }; },
  });
  const transport = new Transport({ manager: native, deviceId: "robot" });
  const connection = transport.connect();
  const rejected = assert.rejects(connection, /cancelled/);
  await until(() => listening);
  await transport.disconnect();
  await rejected;
  assert.equal(removed, 1);
}
{
  let scanCallback;
  const native = manager({ async startDeviceScan(_, __, callback) { scanCallback = callback; } });
  const transport = new Transport({ manager: native });
  const connection = transport.connect();
  const rejected = assert.rejects(connection, /cancelled/);
  await until(() => scanCallback);
  await transport.disconnect();
  await rejected;
  scanCallback(null, { id: "late", name: "LOOI" });
  assert.equal(native.calls.discover, 0);
}

// Removed native monitor subscriptions can still have an already queued event.
{
  let notify;
  let delivered = 0;
  const native = manager({
    async servicesForDevice() { return [{ uuid: "service" }]; },
    async characteristicsForDevice() {
      return [{ uuid: "0000fed9-0000-1000-8000-00805f9b34fb", isNotifiable: true }];
    },
    monitorCharacteristicForDevice(_, __, ___, callback) { notify = callback; return { remove() {} }; },
  });
  const transport = new Transport({ manager: native, deviceId: "robot" });
  await transport.connect();
  await transport.startNotifications("dockNotify", () => delivered++);
  await transport.disconnect();
  notify(null, { value: "AQ==" });
  assert.equal(delivered, 0);
}

// A Settings search uses BleManager's existing singleton. Completing or
// cancelling a search must retain an already connected robot and remove only
// the search's own AppState/radio listeners.
for (const outcome of ["complete", "background", "radio-background", "synchronous-radio"]) {
  let onStateChange, scanCallback, radioCallback, radioRemoved = 0;
  let destroyed = 0, listenerRemoved = 0, connected = false;
  const timers = new Map();
  let timerId = 0;
  const appState = {
    currentState: "active",
    addEventListener(_, callback) { onStateChange = callback; return { remove() { listenerRemoved++; } }; },
  };
  const native = manager({
    async connectToDevice() { connected = true; return { id: "robot" }; },
    async destroy() { destroyed++; connected = false; },
    async startDeviceScan(_, __, callback) { scanCallback = callback; },
    onStateChange(callback) {
      radioCallback = callback;
      if (outcome === "synchronous-radio") callback("PoweredOn");
      return { remove() { radioRemoved++; } };
    },
  });
  const api = load("src/device-tools/react-native-ble-transport.ts", {
    "react-native": { Platform: { OS: "ios" }, AppState: appState },
    "react-native-ble-plx": {
      BleManager: class { constructor() { return native; } },
      State: { PoweredOn: "PoweredOn", PoweredOff: "PoweredOff" }, ScanMode: {},
    },
    "@sourcebug/looi-sdk": sdk,
    "../diagnostics/diagnostic-log": diagnostics,
  }, {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const transport = new api.ReactNativeBleLooiTransport({ deviceId: "robot" });
  await transport.connect();
  if (outcome.includes("radio")) native.state = async () => "PoweredOff";
  const search = api.scanLooiRobotCandidates({ scanTimeoutMs: 125 });
  const rejected = outcome.includes("background") ? assert.rejects(search, /background/) : null;
  if (outcome === "radio-background") {
    await until(() => radioCallback);
  } else {
    await until(() => scanCallback);
  }
  if (rejected) {
    appState.currentState = "background";
    onStateChange("background");
    await rejected;
  } else {
    scanCallback(null, { id: "robot", name: "LOOI", rssi: -40 });
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.delay, 125);
    timers.delete(id); timer.callback();
    assert.equal((await search).length, 1);
  }
  assert.equal(destroyed, 0, "a scan does not own the shared Bluetooth manager");
  assert.equal(connected, true, "search cleanup must preserve the connected robot");
  assert.equal(listenerRemoved, 1);
  assert.equal(timers.size, 0);
  if (outcome.includes("radio")) assert.equal(radioRemoved, 1);
  await transport.disconnect();
}
console.log("BLE cancellation, stale callbacks and GATT isolation passed on iOS/Android");
