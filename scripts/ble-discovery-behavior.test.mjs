import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(file, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() { for (let index = 0; index < 100; index++) await Promise.resolve(); }
async function until(predicate) { await flush(); assert.ok(predicate(), "expected BLE stage must be reached"); }

const sdk = load("packages/looi-sdk/src/index.ts");
const states = Object.fromEntries(["PoweredOn", "PoweredOff", "Unauthorized", "Unsupported"].map((state) => [state, state]));

function harness(platform = "ios") {
  const calls = { start: 0, stop: 0, radio: 0, radioRemoved: 0, lifecycleRemoved: 0 };
  const timers = new Map();
  const listeners = new Set();
  let timerId = 0;
  const native = {
    stateValue: states.PoweredOn,
    stopGate: null,
    startFailure: null,
    async state() { return this.stateValue; },
    async enable() {},
    onStateChange(callback) {
      calls.radio++;
      this.radioCallback = callback;
      return { remove() { calls.radioRemoved++; } };
    },
    async connectedDevices() { return []; },
    async devices() { return []; },
    async isDeviceConnected() { return false; },
    async connectToDevice(id) { return { id }; },
    async cancelDeviceConnection() {},
    onDeviceDisconnected() { return { remove() {} }; },
    async discoverAllServicesAndCharacteristicsForDevice() {},
    async servicesForDevice() { return []; },
    async requestMTUForDevice() {},
    async startDeviceScan(_, __, callback) {
      calls.start++;
      this.scanCallback = callback;
      if (this.startFailure) { const error = this.startFailure; this.startFailure = null; throw error; }
    },
    async stopDeviceScan() { calls.stop++; await this.stopGate?.promise; },
  };
  const api = load("src/device-tools/react-native-ble-transport.ts", {
    "react-native": {
      Platform: { OS: platform, Version: 35 },
      AppState: { currentState: "active", addEventListener(_, callback) {
        listeners.add(callback);
        return { remove() { listeners.delete(callback); calls.lifecycleRemoved++; } };
      } },
      PermissionsAndroid: {
        PERMISSIONS: { BLUETOOTH_SCAN: "scan", BLUETOOTH_CONNECT: "connect", ACCESS_FINE_LOCATION: "location" },
        RESULTS: { GRANTED: "granted" },
        async requestMultiple(permissions) { return Object.fromEntries(permissions.map((name) => [name, "granted"])); },
      },
    },
    "react-native-ble-plx": { BleManager: class { constructor() { return native; } }, State: states, ScanMode: {} },
    "@sourcebug/looi-sdk": sdk,
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  }, {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    api, native, calls, timers,
    search: () => api.scanLooiRobotCandidates({ scanTimeoutMs: 125 }),
    transport: () => new api.ReactNativeBleLooiTransport({ deviceId: "robot" }),
    expireScan() {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === 125);
      assert.ok(entry, "scan timeout must be installed");
      const [id, timer] = entry;
      timers.delete(id); timer.callback();
    },
  };
}

for (const platform of ["ios", "android"]) {
  test(`${platform}: disconnect releases only its own scan`, async () => {
    const h = harness(platform);
    const search = h.search();
    await until(() => h.calls.start === 1);
    await h.transport().disconnect();
    assert.equal(h.calls.stop, 0, "unrelated disconnect must leave the Settings search running");
    h.native.scanCallback(null, { id: "robot", name: "LOOI", rssi: -50 });
    h.expireScan();
    assert.equal((await search).length, 1);
    assert.equal(h.calls.stop, 1);
    assert.equal(h.timers.size, 0);
  });
}

test("a second search cannot replace an active scan", async () => {
  const h = harness();
  const first = h.search();
  await until(() => h.calls.start === 1);
  const second = h.search();
  const rejected = assert.rejects(second, /search is already running/);
  await flush();
  assert.equal(h.calls.start, 1);
  await rejected;
  h.expireScan();
  await first;
  assert.equal(h.calls.stop, 1);
});

test("a scan retains ownership until native stop completes", async () => {
  const h = harness();
  h.native.stopGate = deferred();
  const first = h.search();
  await until(() => h.calls.start === 1);
  h.expireScan();
  await until(() => h.calls.stop === 1);
  await assert.rejects(h.search(), /search is already running/);
  h.native.stopGate.resolve();
  await first;
  const next = h.search();
  await until(() => h.calls.start === 2);
  h.expireScan();
  await next;
  assert.equal(h.calls.stop, 2);
});

test("native scan errors release ownership for the next search", async () => {
  const h = harness();
  h.native.startFailure = new Error("radio busy");
  await assert.rejects(h.search(), /radio busy/);
  const next = h.search();
  await until(() => h.calls.start === 2);
  h.expireScan();
  await next;
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.lifecycleRemoved, 2);
});

test("candidate collection filters noise, deduplicates and supplies valid names", async () => {
  const h = harness();
  const search = h.search();
  await until(() => h.calls.start === 1);
  for (const device of [
    { id: "noise", name: "Speaker", rssi: -1 },
    { id: "named", name: "LOOI Alpha", rssi: -80 },
    { id: "local", name: "", localName: " LOOI local ", rssi: -30 },
    { id: "default", name: " ", serviceUUIDs: ["000000ff-0000-1000-8000-00805f9b34fb"] },
    { id: "named", name: "LOOI Alpha", rssi: -10 },
  ]) h.native.scanCallback(null, device);
  h.expireScan();
  const candidates = await search;
  assert.deepEqual(candidates.map(({ id, name, rssi }) => ({ id, name, rssi })), [
    { id: "named", name: "LOOI Alpha", rssi: -10 },
    { id: "local", name: "LOOI local", rssi: -30 },
    { id: "default", name: "LOOI Robot", rssi: null },
  ]);
});

test("connection discovery stops on its first matching robot", async () => {
  const h = harness();
  const transport = new h.api.ReactNativeBleLooiTransport({ manager: h.native, scanTimeoutMs: 125 });
  const connection = transport.connect();
  await until(() => h.calls.start === 1);
  h.native.scanCallback(null, { id: "robot", name: "LOOI" });
  await connection;
  assert.equal(h.calls.stop, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(transport.getGattSnapshot().deviceId, "robot");
  await transport.disconnect();
  assert.equal(h.calls.stop, 1);
});

test("connection discovery reports an empty search and releases its scanner", async () => {
  const h = harness();
  const transport = new h.api.ReactNativeBleLooiTransport({ manager: h.native, scanTimeoutMs: 125 });
  const rejected = assert.rejects(transport.connect(), /not found/);
  await until(() => h.calls.start === 1);
  h.expireScan();
  await rejected;
  assert.equal(h.calls.stop, 1);
  assert.equal(h.timers.size, 0);
});

test("connection discovery cannot interrupt the candidate collector", async () => {
  const h = harness();
  const search = h.search();
  await until(() => h.calls.start === 1);
  const transport = new h.api.ReactNativeBleLooiTransport({ manager: h.native });
  await assert.rejects(transport.connect(), /search is already running/);
  assert.equal(h.calls.start, 1);
  assert.equal(h.calls.stop, 0);
  h.expireScan();
  await search;
});

for (const state of [states.Unauthorized, states.Unsupported]) {
  test(`${state}: search and connection fail without a radio timeout`, async () => {
    const h = harness();
    h.native.stateValue = state;
    const search = assert.rejects(h.search(), /permission|not supported/);
    const connection = assert.rejects(h.transport().connect(), /permission|not supported/);
    await flush();
    assert.equal(h.calls.radio, 0);
    assert.equal(h.timers.size, 0);
    await Promise.all([search, connection]);
  });
  test(`${state}: a terminal radio event releases the pending listener`, async () => {
    const h = harness();
    h.native.stateValue = states.PoweredOff;
    const rejected = assert.rejects(h.search(), /permission|not supported/);
    await until(() => h.calls.radio === 1);
    h.native.radioCallback(state);
    await rejected;
    assert.equal(h.calls.radioRemoved, 1);
    assert.equal(h.timers.size, 0);
  });
}
