import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startRobotGateway } from "../services/robot-bridge/gateway.mjs";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createRobotCore } = load("src/robot-bridge/core.ts");
const { connectRobotBridgeDevice } = load("src/robot-bridge/device-connection.ts");
const token = "a".repeat(48);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function rejectedDeviceUpgrade(port, credential) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/device", headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": Buffer.alloc(16).toString("base64"),
      "Sec-WebSocket-Protocol": `looi-bridge-v1, bearer.${credential}`,
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.once("error", reject); request.end();
  });
}
async function connect(url, protocols) {
  const ws = new WebSocket(url, protocols), messages = [], waiters = new Set();
  ws.on("message", data => { const m = JSON.parse(data.toString()); messages.push(m); for (const f of waiters) f(); });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return {
    ws, messages,
    send: value => ws.send(JSON.stringify(value)),
    wait(predicate) {
      return new Promise((resolve, reject) => {
        const match = () => { const value = messages.find(predicate); if (value !== undefined) { clearTimeout(timeout); waiters.delete(match); resolve(value); } };
        const timeout = setTimeout(() => { waiters.delete(match); reject(new Error(`message timeout; received ${JSON.stringify(messages).slice(0,800)}`)); }, 2500);
        waiters.add(match); match();
      });
    },
    close: () => new Promise(resolve => { ws.once("close", resolve); ws.close(); }),
  };
}

{
  const server = await startRobotGateway({ port: 0, demo: true, allowApproximation: true });
  const base = `ws://127.0.0.1:${server.address.port}`;
  try {
    const app = await connect(`${base}/ws/sdk`);
    await app.wait(m => m.type === "joint_positions");
    await app.wait(m => m.type === "head_pose");
    app.send({ type: "get_state" });
    const state = await app.wait(m => m.state?.pose_origin === "virtual");
    assert.equal(state.state.hardware_motors_available, false);
    app.send({ type: "set_motor_mode", mode: "enabled" });
    assert.equal((await app.wait(m => m.motor_mode === "enabled")).motor_mode_origin, "virtual");
    const uuid = "bbed64d9-3d48-4fc0-8433-2e4ea645846f";
    app.send({ type: "task", uuid, timestamp: new Date().toISOString(), req: {
      head: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], antennas: null, body_yaw: null, duration: .08, method: "minjerk",
    } });
    assert.equal((await app.wait(m => m.type === "task_progress" && m.uuid === uuid && m.finished === true)).error, null);
    await app.close();
    const duck = await connect(`${base}/microduck`);
    duck.send({ jsonrpc: "2.0", id: 7, method: "robot.move", params: { vx: .1, vy: 0, vyaw: 0 } });
    assert.equal((await duck.wait(m => m.id === 7)).result.accepted, true);
    duck.send({ jsonrpc: "2.0", id: 8, method: "robot.stop" });
    assert.equal((await duck.wait(m => m.id === 8)).result.accepted, true);
    duck.send({ jsonrpc: "2.0", id: 9, method: "policy.install", params: {} });
    assert.ok((await duck.wait(m => m.id === 9)).error);
    await duck.close();
    const status = await fetch(`http://127.0.0.1:${server.address.port}/api/daemon/status`).then(r => r.json());
    assert.equal(status.type, "daemon_status", "HTTP status must not inherit the last app's protocol");
    assert.equal(status.state, "running");
    assert.equal(status.no_media, true);
  } finally { await server.close(); }
}
{
  const server = await startRobotGateway({ port: 0, token });
  const port = server.address.port, actions = [], stops = [], forwarded = [], phoneClockSamples = [];
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/daemon/status`)).status, 503);
  assert.equal(await rejectedDeviceUpgrade(port, "0".repeat(48)), 403);
  assert.equal(await rejectedDeviceUpgrade(port, "é".repeat(48)), 403, "non-ASCII credentials must not crash timing-safe comparison");
  const core = createRobotCore({
    id: "test-phone", capabilities: {
      schemaVersion: 1, locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
      pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
      gestures: [], light: true, media: { camera: false, microphone: false, speaker: false, volume: false },
    },
    inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }),
    execute: async (command, context) => { if (context.isCurrent()) actions.push(command); return { status: "adapted", limitations: ["test"] }; },
    stop: async reason => { stops.push(reason); },
  });
  const phone = connectRobotBridgeDevice(core, { url: `ws://127.0.0.1:${port}/device`, token, allowApproximation: true,
    createSocket: (url, protocols) => {
      const socket = new WebSocket(url, protocols), send = socket.send.bind(socket);
      socket.send = (data) => {
        const message = JSON.parse(data);
        if (typeof message.clockMs === "number") phoneClockSamples.push(message.clockMs);
        send(data);
      };
      socket.on("message", data => { const message = JSON.parse(data.toString()); if (message.type === "command") forwarded.push(message); });
      return socket;
    } });
  try {
    for (let i=0; i<100 && !phone.connected; i++) await sleep(10);
    assert.equal(phone.connected, true);
    const app = await connect(`ws://127.0.0.1:${port}/microduck`);
    app.send({ jsonrpc: "2.0", id: 11, method: "robot.move", params: { vx: .2, vy: 0, vyaw: 0 } });
    assert.equal((await app.wait(m => m.id === 11)).result.accepted, true);
    assert.equal(actions[0].kind, "drive");
    assert.equal(forwarded[0].ttlMs, 500);
    assert.ok(phoneClockSamples.some(sample => forwarded[0].expiresAtDeviceMs === sample + 500), "relay must use the phone's original clock sample without renewing it");
    app.send({ jsonrpc: "2.0", id: 12, method: "robot.stop" });
    await app.wait(m => m.id === 12);
    assert.ok(stops.length > 0);
    await phone.close();
    await new Promise(resolve => app.ws.readyState === 3 ? resolve() : app.ws.once("close", resolve));
    assert.equal(core.inspect().sessionId, null, "device disconnection releases the app owner");
  } finally { await phone.close(); await core.dispose(); await server.close(); }
}

function appServices(calls = []) {
  const ensureChecks = [];
  const catalog = {
    async list(options) { calls.push(["catalog-list", options]); return { items: [{ id: "pollen/demo" }], options }; },
    async get(spaceId) { return { id: spaceId, sdk: "reachy-mini" }; },
    async resolve(spaceId, options) { return { id: spaceId, options }; },
    async refresh() { return { refreshed: true }; },
  };
  const runner = {
    ready: Promise.resolve(),
    status() { return { installed: [], running: null, jobs: [] }; },
    listInstalled() { return []; },
    async install(spaceId, options) { calls.push(["install", spaceId, options]); return { jobId: "job-1", spaceId }; },
    async start(spaceId) { calls.push(["start", spaceId]); return { state: "starting", spaceId }; },
    async ensureStarted(spaceId, options = {}) {
      calls.push(["ensure-start", spaceId, {
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
        ...(options.revision === undefined ? {} : { revision: options.revision }),
      }]);
      ensureChecks.push(options.beforeSpawn);
      return { id: "ensure-1", spaceId, revision: options.revision ?? null, phase: "resolving", state: "running", startedAt: "now", finishedAt: null, error: null };
    },
    async stop(options = {}) { calls.push(["stop", options]); return { state: "stopped" }; },
    async uninstall(spaceId) { calls.push(["uninstall", spaceId]); return { spaceId, state: "uninstalled" }; },
    getJob(jobId) { return jobId === "job-1" ? { jobId, state: "complete" } : jobId === "ensure-1" ? { id: jobId, spaceId: "pollen/demo", phase: "running", state: "running", logs: [] } : null; },
    async close() {},
  };
  return { catalog, runner, ensureChecks };
}

await assert.rejects(startRobotGateway({ iceServers: [{ urls: "turn:turn.example.test:3478", username: "looi", credential: "x".repeat(513) }] }),
  /TURN username and credential must be provided together and bounded/, "server TURN credentials share the phone's 512-character bound");

async function managementRoutesEnforceOriginAndRunnerReadiness() {
  const calls = [];
  const { catalog, runner } = appServices(calls);
  const server = await startRobotGateway({ port: 0, token, centralToken: "", appCatalog: catalog, appRunner: runner, signalingPort: false });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const portal = await fetch(`${base}/apps`);
    assert.equal(portal.status, 200);
    assert.match(portal.headers.get("content-type"), /text\/html/);
    const catalogResponse = await fetch(`${base}/api/apps?q=conversation&family=reachy-mini`);
    assert.equal(catalogResponse.status, 200);
    assert.deepEqual(calls[0], ["catalog-list", { query: "conversation", limit: 100, robotFamily: "reachy-mini", forceRefresh: false }]);
    const denied = await fetch(`${base}/api/apps`, { headers: { Origin: "https://attacker.example", Authorization: `Bearer ${token}` } });
    assert.equal(denied.status, 403, "pairing auth does not override a cross-origin browser request");
    const rebound = await fetch(`${base}/health`, { headers: { Host: "rebind.example", Origin: "http://rebind.example" } });
    assert.equal(rebound.status, 403, "loopback routes reject DNS-rebinding Host headers even when Origin matches");
    const install = await fetch(`${base}/api/apps/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo", revision: "abc123" }) });
    assert.equal(install.status, 202);
    assert.deepEqual(calls.find(call => call[0] === "install"), ["install", "pollen/demo", { revision: "abc123" }]);
    const blockedStart = await fetch(`${base}/api/apps/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(blockedStart.status, 503, "Python app startup is gated until its local media signaling listener is bound");
    assert.equal(calls.some(call => call[0] === "start"), false);
    const blockedEnsure = await fetch(`${base}/api/apps/ensure-start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(blockedEnsure.status, 503, "ensure-start rejects before reserving or installing while device/signaling readiness is absent");
    assert.equal(calls.some(call => call[0] === "ensure-start"), false);
    const invalidRevisionEnsure = await fetch(`${base}/api/apps/ensure-start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo", revision: "abc123" }) });
    assert.equal(invalidRevisionEnsure.status, 422, "ensure-start accepts only a pinned commit SHA");
    assert.equal(calls.some(call => call[0] === "ensure-start"), false);
    const invalidRequestEnsure = await fetch(`${base}/api/apps/ensure-start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo", requestId: "not/opaque" }) });
    assert.equal(invalidRequestEnsure.status, 422, "ensure-start validates the opaque cancellation key");
    assert.equal(calls.some(call => call[0] === "ensure-start"), false);
    const deniedEnsure = await fetch(`${base}/api/apps/ensure-start`, { method: "POST", headers: { "content-type": "application/json", Origin: "https://attacker.example", Authorization: `Bearer ${token}` }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(deniedEnsure.status, 403, "ensure-start uses the existing origin and pairing authorization gate");
    const deniedRemoval = await fetch(`${base}/api/apps/uninstall`, { method: "POST", headers: { "content-type": "application/json", Origin: "https://attacker.example", Authorization: `Bearer ${token}` }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(deniedRemoval.status, 403);
    const injectedRemoval = await fetch(`${base}/api/apps/uninstall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo", directory: "/untrusted" }) });
    assert.equal(injectedRemoval.status, 422, "no caller-selected directory is accepted");
    assert.equal(calls.some(call => call[0] === "uninstall"), false);
    const removal = await fetch(`${base}/api/apps/uninstall`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(removal.status, 200);
    assert.deepEqual(await removal.json(), { spaceId: "pollen/demo", state: "uninstalled" });
    assert.deepEqual(calls.find(call => call[0] === "uninstall"), ["uninstall", "pollen/demo"]);
    const status = await fetch(`${base}/api/bridge/status`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
    assert.equal(status.connected, false);
    assert.equal(JSON.stringify(status).includes(token), false, "bridge status never discloses pairing or Pollen credentials");
  } finally { await server.close(); }
}

async function localGStreamerSessionSharesTheReachyControlOwnerAndMediaRpc() {
  const calls = [];
  const { catalog, runner, ensureChecks } = appServices(calls);
  const server = await startRobotGateway({ port: 0, token, centralToken: "", appCatalog: catalog, appRunner: runner, signalingPort: 0 });
  const base = `ws://127.0.0.1:${server.address.port}`;
  const phone = await connect(`${base}/device`, ["looi-bridge-v1", `bearer.${token}`]);
  let controlClientId = null;
  phone.ws.on("message", data => {
    const message = JSON.parse(data.toString());
    if (message.type === "ping") phone.send({ type: "pong", clockMs: 10_000 });
    if (message.type === "open") {
      controlClientId = message.clientId;
      phone.send({ type: "opened", clientId: message.clientId, messages: [{ type: "control-ready" }], snapshot: { state: "running" } });
    }
    if (message.type === "media-command") phone.send({ type: "media-reply", requestId: message.requestId, result: { percent: message.command.value ?? 43, origin: "webrtc-track-gain", pending: message.command.action === "set-volume" } });
  });
  try {
    phone.send({ type: "ready", clockMs: 10_000, media: { camera: true, microphone: true, speaker: true }, mediaStatus: {
      phase: "idle", camera: { supported: true, available: null, permission: "prompt" },
      microphone: { supported: true, available: null, permission: "prompt" },
      speaker: { supported: true, available: null, routeActive: false, speakerSelected: null, route: null },
    } });
    const app = await connect(`${base}/ws/sdk`);
    await app.wait(message => message.type === "control-ready");
    assert.ok(controlClientId);
    const signalPort = server.signalingAddress.port;
    const local = await connect(`ws://127.0.0.1:${signalPort}/`);
    const welcome = await local.wait(message => message.type === "welcome");
    local.send({ type: "list" });
    const listing = await local.wait(message => message.type === "list");
    assert.equal(listing.producers[0].meta.name, "reachymini", "stock SDK exact-match discovery uses its pinned producer name");
    assert.equal(listing.producers[0].meta.display_name, "LOOI");
    local.send({ type: "startSession", peerId: listing.producers[0].id });
    const started = await local.wait(message => message.type === "sessionStarted");
    const open = await phone.wait(message => message.type === "webrtc-open" && message.sessionId === started.sessionId);
    assert.equal(open.protocol, "reachy");
    assert.equal(open.controlClientId, controlClientId, "local media borrows the matching Reachy control owner");
    assert.deepEqual(open.iceServers, [{ urls: "stun:stun.l.google.com:19302" }]);
    phone.send({ type: "signal", sessionId: started.sessionId, signal: { type: "peer", sessionId: started.sessionId, sdp: { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n" } } });
    const relayed = await local.wait(message => message.type === "peer" && message.sessionId === started.sessionId);
    assert.equal(relayed.sdp.type, "offer");
    local.send({ type: "endSession", sessionId: started.sessionId });
    await phone.wait(message => message.type === "webrtc-close" && message.sessionId === started.sessionId);
    await local.close(); await app.close();

    const volume = await fetch(`http://127.0.0.1:${server.address.port}/api/volume/current`).then(response => response.json());
    assert.deepEqual(volume, { volume: 43, platform: "LOOI WebRTC software gain", device: "speaker", origin: "webrtc-track-gain", pending: false });
    const setVolumeResponse = await fetch(`http://127.0.0.1:${server.address.port}/api/volume/microphone/set`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ volume: 72 }),
    });
    assert.equal(setVolumeResponse.status, 200);
    assert.equal((await setVolumeResponse.json()).volume, 72);
    const status = await fetch(`http://127.0.0.1:${server.address.port}/api/media/status`).then(response => response.json());
    assert.equal(status.available, true, "configured native consent can be available before the OS permission prompt is accepted");
    assert.equal(status.no_media, false);
    phone.send({ type: "pong", clockMs: 10_000, media: { camera: false, microphone: false, speaker: false } });
    let optedOut = null;
    for (let index = 0; index < 20; index++) {
      optedOut = await fetch(`http://127.0.0.1:${server.address.port}/api/media/status`).then(response => response.json());
      if (optedOut.available === false) break;
      await sleep(10);
    }
    assert.equal(optedOut.available, false, "native supported metadata cannot override explicit phone opt-out");
    assert.equal(optedOut.no_media, true);
    phone.send({ type: "pong", clockMs: 10_000, media: { camera: false, microphone: false, speaker: true }, mediaStatus: {
      phase: "idle", speaker: { supported: true, available: false },
    } });
    let unavailableSpeaker = null;
    for (let index = 0; index < 20; index++) {
      unavailableSpeaker = await fetch(`http://127.0.0.1:${server.address.port}/api/media/status`).then(response => response.json());
      if (unavailableSpeaker.speaker?.available === false) break;
      await sleep(10);
    }
    assert.equal(unavailableSpeaker.available, false, "speaker consent cannot override an explicitly unavailable native route");
    assert.equal(unavailableSpeaker.no_media, true);

    const requestedRevision = "b".repeat(40);
    const requestId = "native-app-run-1";
    const ensureResponse = await fetch(`http://127.0.0.1:${server.address.port}/api/apps/ensure-start`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: "pollen/demo", requestId, revision: requestedRevision }),
    });
    assert.equal(ensureResponse.status, 202, "ensure-start always returns its pollable composite job");
    const ensureJob = await ensureResponse.json();
    assert.deepEqual(ensureJob, {
      id: "ensure-1", spaceId: "pollen/demo", revision: requestedRevision, phase: "resolving", state: "running",
      startedAt: "now", finishedAt: null, error: null,
    });
    assert.deepEqual(calls.find(call => call[0] === "ensure-start"), ["ensure-start", "pollen/demo", { requestId, revision: requestedRevision }]);
    assert.equal(typeof ensureChecks.at(-1), "function", "gateway supplies a private readiness callback for the runner's final pre-spawn check");
    ensureChecks.at(-1)();
    const polledJob = await fetch(`http://127.0.0.1:${server.address.port}/api/apps/jobs/ensure-1`).then(response => response.json());
    assert.equal(polledJob.id, ensureJob.id);
    assert.equal(polledJob.state, "running");

    const startResponse = await fetch(`http://127.0.0.1:${server.address.port}/api/apps/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/demo" }) });
    assert.equal(startResponse.status, 202, "app runner starts only after device and local signaling readiness are established");
  } finally {
    await phone.close();
    for (let index = 0; index < 30; index += 1) {
      const status = await fetch(`http://127.0.0.1:${server.address.port}/api/bridge/status`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
      if (!status.connected) break;
      await sleep(10);
    }
    if (ensureChecks.length) assert.throws(ensureChecks.at(-1), /LOOI phone and local WebRTC signaling listener are ready/, "the same final-spawn readiness callback rejects after the phone disconnects");
    await server.close();
  }
}

async function httpStopBeforeEnsureTombstonePreventsLateAdmission() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-gateway-request-tombstone-"));
  let resolveCount = 0;
  let spawnCount = 0;
  const catalog = {
    async list() { return { items: [], total: 0 }; },
    async get(spaceId) { return { id: spaceId }; },
    async resolve(spaceId) {
      resolveCount += 1;
      return { id: `hf:${spaceId}`, spaceId, title: "Late fixture", revision: "a".repeat(40) };
    },
  };
  const runner = createAppRunner({
    rootDir,
    catalog,
    spawnImpl() { spawnCount += 1; throw new Error("unexpected spawn after targeted STOP"); },
  });
  const server = await startRobotGateway({ port: 0, token, centralToken: "", appCatalog: catalog, appRunner: runner, signalingPort: 0 });
  const phone = await connect(`ws://127.0.0.1:${server.address.port}/device`, ["looi-bridge-v1", `bearer.${token}`]);
  const requestId = "late-native-request-1";
  try {
    phone.send({ type: "ready", clockMs: 10_000, media: { camera: false, microphone: false, speaker: false } });
    let bridgeStatus = null;
    for (let index = 0; index < 30; index += 1) {
      bridgeStatus = await fetch(`http://127.0.0.1:${server.address.port}/api/bridge/status`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
      if (bridgeStatus.connected) break;
      await sleep(10);
    }
    assert.equal(bridgeStatus.connected, true, "HTTP route test has a connected phone and bound signaling listener");

    const stoppedResponse = await fetch(`http://127.0.0.1:${server.address.port}/api/apps/stop`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }),
    });
    assert.equal(stoppedResponse.status, 200);
    assert.deepEqual(await stoppedResponse.json(), {
      requestId, state: "stopped", phase: "cancelled", cancelledBeforeAdmission: true,
    });

    const lateEnsure = await fetch(`http://127.0.0.1:${server.address.port}/api/apps/ensure-start`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "pollen/late-app", requestId }),
    });
    assert.equal(lateEnsure.status, 409, "a real HTTP STOP received first tombstones the later HTTP ensure-start");
    assert.match((await lateEnsure.json()).error, /cancelled before admission/);
    assert.equal(resolveCount, 0, "late admission is rejected before catalog resolution");
    assert.equal(spawnCount, 0, "late admission never reaches a process spawn");
  } finally {
    await phone.close();
    await server.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

await managementRoutesEnforceOriginAndRunnerReadiness();
await localGStreamerSessionSharesTheReachyControlOwnerAndMediaRpc();
await httpStopBeforeEnsureTombstonePreventsLateAdmission();
console.log("robot bridge gateway: original wire startup/tasks and phone relay round trip passed");
