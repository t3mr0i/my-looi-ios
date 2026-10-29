import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const TOKEN = "a".repeat(48);
const NativeURL = globalThis.URL;

class ReactNativeUrlStub {
  constructor(value) {
    this.original = String(value);
    this.isSocketUrl = /^wss?:/i.test(this.original);
    const normalized = this.original.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    this.parsed = new NativeURL(normalized);
  }
  get protocol() { return this.isSocketUrl ? this.original.match(/^[^:]+:/)[0].toLowerCase() : this.parsed.protocol; }
  get hostname() { return this.isSocketUrl ? "" : this.parsed.hostname; }
  get pathname() { return this.isSocketUrl ? "/" : this.parsed.pathname; }
  get username() { return this.parsed.username; }
  get password() { return this.parsed.password; }
  get search() { return this.parsed.search; }
  get hash() { return this.parsed.hash; }
  get href() { return this.isSocketUrl ? this.original : this.parsed.href; }
  toString() { return this.href; }
}

function makeClock() {
  let now = 10_000;
  let nextTimer = 0;
  const intervals = new Map();
  return {
    Date: { now: () => now },
    performance: { now: () => now },
    setInterval(callback, delay) {
      const id = ++nextTimer;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    advance(ms) {
      now += ms;
      for (const timer of [...intervals.values()]) timer.callback();
    },
    get intervalCount() { return intervals.size; },
  };
}

function makeSocket() {
  return {
    readyState: 1,
    sent: [],
    closeCount: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) { this.sent.push(JSON.parse(data)); },
    close() { this.closeCount += 1; this.readyState = 3; },
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); },
  };
}

function makeFixture({ createGateway, clock = makeClock(), urlConstructor = NativeURL, url = "ws://127.0.0.1:8000/device",
  token = TOKEN, autoOpen = true, media, mediaStatus, central, createPeer, onStatus, mediaCommand } = {}) {
  const socket = makeSocket();
  const socketOptions = {};
  const stopped = [];
  const core = { inspect: () => ({ schemaVersion: 1 }), stop: async (reason) => stopped.push(reason) };
  const gateways = [];
  const factory = createGateway ?? ((_core, options) => {
    const gateway = {
      options,
      closed: 0,
      commands: [],
      initialMessages: () => [{ type: "initial", clientId: options.sessionId }],
      stateMessages: () => [],
      handleMessage(payload, meta) {
        this.commands.push({ payload, meta });
        return Promise.resolve([{ type: "result", clientId: options.sessionId }]);
      },
      async close() { this.closed += 1; },
    };
    gateways.push(gateway);
    return gateway;
  });
  const { connectRobotBridgeDevice } = loadTypeScript(
    "src/robot-bridge/device-connection.ts",
    { "./gateway": { createRobotGateway: (...args) => {
      const gateway = factory(...args);
      if (!gateways.includes(gateway)) gateways.push(gateway);
      return gateway;
    } } },
    { Date: clock.Date, performance: clock.performance, setInterval: clock.setInterval, clearInterval: clock.clearInterval, URL: urlConstructor },
  );
  const connection = connectRobotBridgeDevice(core, {
    url,
    token,
    createSocket: (address, protocols) => { socketOptions.url = address; socketOptions.protocols = protocols; return socket; },
    ...(media !== undefined ? { media } : {}),
    ...(mediaStatus !== undefined ? { mediaStatus } : {}),
    ...(central !== undefined ? { central } : {}),
    ...(createPeer !== undefined ? { createPeer } : {}),
    ...(onStatus !== undefined ? { onStatus } : {}),
    ...(mediaCommand !== undefined ? { mediaCommand } : {}),
  });
  if (autoOpen) socket.onopen?.();
  return { connection, socket, core, stopped, gateways, clock, socketOptions };
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const open = (clientId, protocol = "microduck") => ({ type: "open", clientId, protocol });
const command = (clientId, requestId, fields = {}) => ({
  type: "command", clientId, requestId, ttlMs: 1_200, expiresAtDeviceMs: 11_200,
  payload: { method: "robot.stop", id: requestId }, ...fields,
});
const webRtcOpen = (sessionId, protocol = "reachy", fields = {}) => ({ type: "webrtc-open", sessionId, protocol, ...fields });

function makePeerFactory({ startGate } = {}) {
  const created = [];
  const createPeer = (options) => {
    const peer = {
      options,
      startCalls: [],
      signals: [],
      closeCalls: [],
      gateway: null,
      async start(value) {
        this.startCalls.push(value);
        if (startGate) await startGate.promise;
        this.gateway = options.openGateway(options.protocol, options.sessionId);
      },
      async handleSignal(value) { this.signals.push(value); },
      async close(reason) {
        this.closeCalls.push(reason);
        await this.gateway?.close?.();
        options.onClosed?.(reason);
      },
      inspect: () => ({ sessionId: options.sessionId, state: "active" }),
    };
    created.push(peer);
    return peer;
  };
  return { createPeer, created };
}

async function testNormalizeWebSocketUrlWithHttpOnlyReactNativeUrl() {
  const { normalizeRobotBridgeDeviceUrl } = loadTypeScript(
    "src/robot-bridge/device-connection.ts",
    { "./gateway": {} },
    { URL: ReactNativeUrlStub },
  );
  const brokenNativeUrl = new ReactNativeUrlStub("ws://robot.local/device");
  assert.equal(brokenNativeUrl.pathname, "/", "the test stub reproduces RN's HTTP(S)-only ws getters");
  assert.equal(brokenNativeUrl.hostname, "");

  assert.equal(normalizeRobotBridgeDeviceUrl("ws://robot.local/device"), "ws://robot.local/device");
  assert.equal(normalizeRobotBridgeDeviceUrl("WSS://robot.local:8443/device"), "wss://robot.local:8443/device");
  assert.throws(() => normalizeRobotBridgeDeviceUrl("https://robot.local/device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws:/robot.local/device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws:robot.local/device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://robot.local/other"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://user:secret@localhost/device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://robot.local/device?token=x"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://robot.local/device#frag"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://robot local/device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws://robot.local\\device"), /Invalid robot bridge/);
  assert.throws(() => normalizeRobotBridgeDeviceUrl("ws:///device"), /Invalid robot bridge/);

  const fixture = makeFixture({ urlConstructor: ReactNativeUrlStub, url: "wss://robot.local:8443/device" });
  assert.equal(fixture.socketOptions.url, "wss://robot.local:8443/device", "connect uses the normalized socket URL");
  assert.deepEqual(fixture.socketOptions.protocols, ["looi-bridge-v1", `bearer.${TOKEN}`]);
  await fixture.connection.close();
}

async function testOpenErrorsEchoClientId() {
  const fixture = makeFixture();
  fixture.socket.receive(open("invalid-protocol", "nope"));
  assert.deepEqual(fixture.socket.sent.at(-1), {
    type: "error",
    clientId: "invalid-protocol",
    message: "Bridge is busy or open request is invalid",
  });
  fixture.socket.receive(open("owner-one"));
  fixture.socket.receive(open("owner-two"));
  assert.equal(fixture.socket.sent.at(-1).type, "error");
  assert.equal(fixture.socket.sent.at(-1).clientId, "owner-two", "busy-open errors retain the requesting app identity");
  assert.equal(fixture.gateways.length, 1);
  await fixture.connection.close();

  const thrown = makeFixture({ createGateway: () => { throw new Error("session id rejected"); } });
  thrown.socket.receive(open("bad-session-id"));
  assert.equal(thrown.socket.sent.at(-1).type, "error");
  assert.equal(thrown.socket.sent.at(-1).clientId, "bad-session-id", "gateway construction errors remain routable to the requester");
  assert.match(thrown.socket.sent.at(-1).message, /session id rejected/);
  await thrown.connection.close();
}

async function testPresentInvalidTtlCannotReachGateway() {
  const fixture = makeFixture();
  fixture.socket.receive(open("owner"));
  const gateway = fixture.gateways[0];
  fixture.socket.receive(command("owner", 41, { ttlMs: null }));
  assert.equal(gateway.commands.length, 0, "an explicitly invalid lifetime must not be treated as the default");
  assert.deepEqual(fixture.socket.sent.at(-1), {
    type: "error", clientId: "owner", requestId: 41, message: "Invalid command lifetime",
  });
  assert.deepEqual(fixture.stopped, ["bridge-command-expired"]);
  await fixture.connection.close();
}

async function testMissingMalformedAndExpiredDeadlinesFailClosed() {
  const fixture = makeFixture();
  fixture.socket.receive(open("owner"));
  const gateway = fixture.gateways[0];
  fixture.socket.receive(command("owner", 42, { expiresAtDeviceMs: undefined }));
  assert.equal(fixture.socket.sent.at(-1).message, "Missing or invalid command expiry");
  fixture.socket.receive(command("owner", 43, { expiresAtDeviceMs: "11200" }));
  assert.equal(fixture.socket.sent.at(-1).message, "Missing or invalid command expiry");
  fixture.socket.receive(command("owner", 44, { ttlMs: 500, expiresAtDeviceMs: 10_999 }));
  assert.equal(fixture.socket.sent.at(-1).message, "Command expired before reaching the device");
  fixture.socket.receive(command("owner", 45, { ttlMs: 500, expiresAtDeviceMs: 10_000 + 501 }));
  assert.equal(fixture.socket.sent.at(-1).message, "Command expired before reaching the device", "future leases beyond their source TTL are not renewed");
  assert.equal(gateway.commands.length, 0, "none of the invalid freshness envelopes reaches the adapter");
  assert.equal(fixture.stopped.length, 4, "each rejected freshness envelope fail-safe stops prior motion");
  await fixture.connection.close();
}

async function testDelayedFirstMoveReceivesOnlyRemainingLease() {
  const fixture = makeFixture();
  fixture.socket.receive(open("owner"));
  fixture.clock.advance(420);
  fixture.socket.receive(command("owner", 46, { ttlMs: 500, expiresAtDeviceMs: 10_500 }));
  await settle();
  assert.equal(fixture.gateways[0].commands.length, 1);
  assert.deepEqual(fixture.gateways[0].commands[0].meta, { ttlMs: 80 },
    "a move received 420 ms after the phone clock sample keeps only its original 80 ms lease");
  await fixture.connection.close();
}

async function testReadyAndPongPublishPhoneMonotonicClock() {
  const fixture = makeFixture();
  const ready = fixture.socket.sent.find((message) => message.type === "ready");
  assert.equal(ready.clockMs, 10_000);
  fixture.clock.advance(25);
  fixture.socket.receive({ type: "ping" });
  const pong = fixture.socket.sent.at(-1);
  assert.equal(pong.type, "pong");
  assert.equal(pong.clockMs, 10_025);
  await fixture.connection.close();
}

async function testClosingOwnerSuppressesLateReplyToSuccessor() {
  const delayed = deferred();
  let created = 0;
  const fixture = makeFixture({ createGateway: (_core, options) => {
    const index = ++created;
    return {
      options,
      closed: 0,
      initialMessages: () => [],
      stateMessages: () => [],
      handleMessage: () => index === 1 ? delayed.promise : Promise.resolve([{ owner: options.sessionId }]),
      async close() { this.closed += 1; },
    };
  } });
  fixture.socket.receive(open("old-owner"));
  fixture.socket.receive(command("old-owner", 51));
  fixture.socket.receive({ type: "close", clientId: "old-owner" });
  assert.equal(fixture.gateways[0].closed, 1, "the prior gateway is closed immediately on its matching close message");
  fixture.socket.receive(open("new-owner"));
  delayed.resolve([{ owner: "old-owner" }]);
  await settle();
  assert.equal(fixture.socket.sent.some((message) => message.type === "reply" && message.requestId === 51), false,
    "a late result from a closed owner is not delivered after a successor opens");

  fixture.socket.receive(command("new-owner", 52));
  await settle();
  const reply = fixture.socket.sent.find((message) => message.type === "reply" && message.requestId === 52);
  assert.equal(reply.clientId, "new-owner");
  assert.deepEqual(reply.messages, [{ owner: "new-owner" }]);
  await fixture.connection.close();
}

async function testHeartbeatExpiryClosesGatewayAndStopsCore() {
  const fixture = makeFixture();
  fixture.socket.receive(open("owner"));
  const gateway = fixture.gateways[0];
  fixture.clock.advance(3_001);
  await settle();
  assert.equal(fixture.connection.connected, false);
  assert.equal(fixture.socket.closeCount, 1);
  assert.equal(gateway.closed, 1);
  assert.deepEqual(fixture.stopped, ["bridge-device-disconnected"]);
  assert.equal(fixture.clock.intervalCount, 0, "heartbeat timer is cleared after expiry");
}

async function testLatePeerFactoryResultIsClosedWithoutStartingCapture() {
  const factoryResult = deferred();
  const created = { starts: 0, closes: [], async start() { this.starts += 1; }, async handleSignal() {}, async close(reason) { this.closes.push(reason); } };
  const fixture = makeFixture({ createPeer: () => factoryResult.promise });
  fixture.socket.receive(webRtcOpen("late-peer"));
  await settle();
  fixture.socket.receive({ type: "webrtc-close", sessionId: "late-peer" });
  await settle();
  assert.ok(fixture.socket.sent.some(message => message.type === "webrtc-closed" && message.sessionId === "late-peer"));
  factoryResult.resolve(created);
  await settle();
  assert.deepEqual(created.closes, ["stale-peer-start"]);
  assert.equal(created.starts, 0, "a peer factory completing after release never starts WebRTC or requests camera/microphone capture");
  await fixture.connection.close();
}

async function testMediaAttachmentBorrowsControlGatewayAndControlOwnsPeerLifetime() {
  const peers = makePeerFactory();
  const fixture = makeFixture({ createPeer: peers.createPeer });
  fixture.socket.receive(open("phone-control", "reachy"));
  const controlGateway = fixture.gateways[0];

  fixture.socket.receive(webRtcOpen("media-one", "reachy", { controlClientId: "phone-control" }));
  await settle();
  const firstPeer = peers.created[0];
  assert.equal(firstPeer.startCalls.length, 1);
  assert.equal(firstPeer.gateway.initialMessages()[0].clientId, "phone-control", "media and control use the same Reachy app session");
  fixture.socket.receive({ type: "webrtc-close", sessionId: "media-one" });
  await settle();
  assert.equal(controlGateway.closed, 0, "ending the WebRTC lease does not close the still-owned SDK control gateway");
  fixture.socket.receive(command("phone-control", 80));
  await settle();
  assert.equal(controlGateway.commands.length, 1, "the SDK control connection remains routable after media disconnect");

  fixture.socket.receive(webRtcOpen("media-two", "reachy", { controlClientId: "phone-control" }));
  await settle();
  const secondPeer = peers.created[1];
  fixture.socket.receive({ type: "close", clientId: "phone-control" });
  await settle();
  assert.deepEqual(secondPeer.closeCalls, ["control-session-ended"], "the control owner tears down its attached media peer");
  assert.equal(controlGateway.closed, 1, "only the control close destroys the shared gateway");
  await fixture.connection.close();
}

async function testHostedPeerCannotBorrowControlAndOnlyOnePeerCanOwnMedia() {
  const peers = makePeerFactory();
  const fixture = makeFixture({ createPeer: peers.createPeer });
  fixture.socket.receive(open("local-owner", "reachy"));
  fixture.socket.receive(webRtcOpen("hosted-unauthorized", "reachy", { remotePeerId: "hosted-peer" }));
  assert.equal(fixture.socket.sent.at(-1).type, "webrtc-error");
  fixture.socket.receive(webRtcOpen("hosted-wrong-owner", "reachy", { remotePeerId: "hosted-peer", controlClientId: "other-owner" }));
  assert.equal(fixture.socket.sent.at(-1).type, "webrtc-error");
  assert.equal(peers.created.length, 0, "a hosted WebRTC peer cannot borrow the phone's local control session");

  fixture.socket.receive({ type: "close", clientId: "local-owner" });
  fixture.socket.receive(webRtcOpen("standalone-one", "reachy", { remotePeerId: "one" }));
  await settle();
  fixture.socket.receive(webRtcOpen("standalone-two", "reachy", { remotePeerId: "two" }));
  assert.equal(fixture.socket.sent.at(-1).type, "webrtc-error");
  assert.equal(peers.created.length, 1, "the device accepts only one WebRTC peer at a time");
  await fixture.connection.close();
}

async function testMalformedIceIsRejectedBeforePeerCreation() {
  let creations = 0;
  const fixture = makeFixture({ createPeer: () => { creations += 1; return makePeerFactory().createPeer({}); } });
  fixture.socket.receive(webRtcOpen("bad-ice", "reachy", { iceServers: [{ urls: "https://attacker.invalid/stun" }] }));
  assert.equal(fixture.socket.sent.at(-1).type, "webrtc-error");
  assert.match(fixture.socket.sent.at(-1).message, /ICE/);
  assert.equal(creations, 0);
  await fixture.connection.close();
}

async function testMediaRequestsAreIntersectedWithPairedConsent() {
  const peers = makePeerFactory();
  const fixture = makeFixture({
    createPeer: peers.createPeer,
    media: { camera: true, microphone: false, speaker: true, cameraFacing: "user" },
  });
  fixture.socket.receive(webRtcOpen("consented-media", "reachy", {
    media: { camera: true, microphone: true, speaker: false, cameraFacing: "environment" },
  }));
  await settle();
  assert.deepEqual(peers.created[0].options.media, {
    camera: true, microphone: false, speaker: false, cameraFacing: "user",
  }, "requested resources are intersected with device consent and cannot change its camera-facing choice");
  await fixture.connection.close();
}

async function testQueuedSignalsAreBoundedAndDiscardedAcrossPeerGenerations() {
  const factoryResult = deferred();
  const created = [];
  const fixture = makeFixture({ createPeer: () => factoryResult.promise });
  fixture.socket.receive(webRtcOpen("buffered-peer"));
  await settle();
  for (let index = 0; index < 64; index += 1) {
    fixture.socket.receive({ type: "signal", sessionId: "buffered-peer", signal: { index } });
  }
  assert.equal(fixture.socket.sent.some(message => message.type === "webrtc-closed" && message.sessionId === "buffered-peer"), false,
    "the bounded pre-peer queue accepts at most 64 signals");
  fixture.socket.receive({ type: "signal", sessionId: "buffered-peer", signal: { index: 64 } });
  await settle();
  assert.ok(fixture.socket.sent.some(message => message.type === "webrtc-closed" && message.sessionId === "buffered-peer" && message.reason === "signal-buffer-overflow"));
  const stale = { starts: 0, closeReasons: [], async start() { this.starts += 1; }, async handleSignal() {}, async close(reason) { this.closeReasons.push(reason); } };
  factoryResult.resolve(stale);
  await settle();
  assert.equal(stale.starts, 0, "buffer overflow invalidates the original peer generation");
  assert.deepEqual(stale.closeReasons, ["stale-peer-start"]);
  await fixture.connection.close();

  const peers = makePeerFactory();
  const fresh = makeFixture({ createPeer: peers.createPeer });
  fresh.socket.receive(webRtcOpen("old-generation"));
  fresh.socket.receive({ type: "signal", sessionId: "old-generation", signal: { marker: "stale" } });
  fresh.socket.receive({ type: "webrtc-close", sessionId: "old-generation" });
  fresh.socket.receive(webRtcOpen("new-generation"));
  fresh.socket.receive({ type: "signal", sessionId: "old-generation", signal: { marker: "stale-after-close" } });
  fresh.socket.receive({ type: "signal", sessionId: "new-generation", signal: { marker: "fresh" } });
  await settle();
  assert.deepEqual(peers.created[0].signals, [], "old ICE cannot flow into a successor's peer");
  assert.deepEqual(peers.created[1].signals, [{ marker: "fresh" }]);
  await fresh.connection.close();
}

async function testCentralCredentialsGoOnlyOverThePairedOpenSocket() {
  const central = {
    enabled: true, url: "https://central.example/", token: "hf_secret_token", robotName: "LOOI",
    protocols: ["reachy"],
  };
  const fixture = makeFixture({ central, autoOpen: false });
  assert.deepEqual(fixture.socket.sent, [], "pairing credentials are not sent before the authenticated socket opens");
  assert.equal(fixture.socketOptions.url.includes(central.token), false);
  assert.deepEqual(fixture.socketOptions.protocols, ["looi-bridge-v1", `bearer.${TOKEN}`]);
  fixture.socket.onopen?.();
  const config = fixture.socket.sent.find(message => message.type === "central-config");
  assert.deepEqual(config.config, central, "Central configuration is sent only after the paired WebSocket is open");
  assert.equal(JSON.stringify(fixture.socketOptions).includes(central.token), false, "the Central credential is absent from connection URL and protocols");
  await fixture.connection.close();
}

async function testReachyVolumeAdapterUsesConfiguredMediaCommand() {
  const calls = [];
  const fixture = makeFixture({
    media: { camera: false, microphone: false, speaker: true },
    mediaCommand: async command => {
      calls.push(command);
      return { percent: command.action === "set-volume" ? command.value : 43, origin: "webrtc-track-gain", pending: true };
    },
  });
  fixture.socket.receive(open("reachy-volume-owner", "reachy"));
  const audio = fixture.gateways[0].options.media?.audio;
  assert.ok(audio, "Reachy companion sessions receive an audio service backed by the configured phone media command");
  assert.deepEqual(await audio.getGain("speaker"), { percent: 43, origin: "webrtc-track-gain", pending: true });
  assert.deepEqual(await audio.setGain("speaker", 61), { percent: 61, origin: "webrtc-track-gain", pending: true });
  assert.deepEqual(calls, [
    { action: "get-volume", device: "speaker" },
    { action: "set-volume", device: "speaker", value: 61 },
  ]);
  await assert.rejects(audio.getGain("microphone"), /microphone is not enabled/);
  await assert.rejects(audio.setGain("microphone", 52), /microphone is not enabled/);
  await assert.rejects(audio.setGain("speaker", 101), /integer from 0 to 100/);
  assert.equal(calls.length, 2, "unconsented or out-of-range gain calls never reach the phone media channel");
  await fixture.connection.close();

  const waiting = deferred();
  const late = makeFixture({
    media: { camera: false, microphone: false, speaker: true },
    mediaCommand: () => waiting.promise,
  });
  late.socket.receive(open("reachy-volume-lifetime", "reachy"));
  const pending = late.gateways[0].options.media.audio.getGain("speaker");
  await settle();
  late.socket.receive({ type: "close", clientId: "reachy-volume-lifetime" });
  waiting.resolve({ percent: 50, origin: "webrtc-track-gain", pending: false });
  await assert.rejects(pending, /session has ended/);
  assert.equal(late.socket.sent.some(message => message.type === "media-reply"), false,
    "a late Reachy volume result is not accepted by a closed app-session adapter");
  await late.connection.close();

  const invalid = makeFixture({
    media: { camera: false, microphone: false, speaker: true },
    mediaCommand: async () => ({ percent: 50, origin: "physical-device-volume", pending: false }),
  });
  invalid.socket.receive(open("reachy-volume-invalid", "reachy"));
  await assert.rejects(invalid.gateways[0].options.media.audio.getGain("speaker"), /invalid gain status/);
  await invalid.connection.close();
}

async function testMediaCommandsRpcValidationErrorsAndLateReplySuppression() {
  const calls = [];
  const fixture = makeFixture({ mediaCommand: async command => { calls.push(command); return { percent: 55, origin: "webrtc-track-gain", pending: false }; } });
  fixture.socket.receive({ type: "media-command", requestId: "volume-read", command: { action: "get-volume", device: "speaker" } });
  await settle();
  assert.deepEqual(calls, [{ action: "get-volume", device: "speaker" }]);
  assert.deepEqual(fixture.socket.sent.at(-1), {
    type: "media-reply", requestId: "volume-read", result: { percent: 55, origin: "webrtc-track-gain", pending: false },
  });
  fixture.socket.receive({ type: "media-command", requestId: "invalid-volume", command: { action: "set-volume", device: "microphone", value: 101 } });
  assert.equal(fixture.socket.sent.at(-1).type, "media-reply");
  assert.equal(fixture.socket.sent.at(-1).requestId, "invalid-volume");
  assert.equal(typeof fixture.socket.sent.at(-1).error, "string");
  assert.equal(calls.length, 1, "invalid volume is rejected before reaching native gain control");

  const failed = makeFixture({ mediaCommand: async () => { throw new Error("track unavailable"); } });
  failed.socket.receive({ type: "media-command", requestId: "failed-volume", command: { action: "get-volume", device: "microphone" } });
  await settle();
  assert.equal(failed.socket.sent.at(-1).type, "media-reply");
  assert.equal(failed.socket.sent.at(-1).requestId, "failed-volume");
  assert.equal(typeof failed.socket.sent.at(-1).error, "string");
  await failed.connection.close();

  const waiting = deferred();
  const late = makeFixture({ mediaCommand: () => waiting.promise });
  late.socket.receive({ type: "media-command", requestId: "late-volume", command: { action: "get-volume", device: "speaker" } });
  await settle();
  await late.connection.close();
  waiting.resolve({ percent: 50, origin: "webrtc-track-gain", pending: true });
  await settle();
  assert.equal(late.socket.sent.some(message => message.type === "media-reply" && message.requestId === "late-volume"), false,
    "a phone RPC result cannot be delivered after its paired connection has closed");
}

await testOpenErrorsEchoClientId();
await testNormalizeWebSocketUrlWithHttpOnlyReactNativeUrl();
await testPresentInvalidTtlCannotReachGateway();
await testMissingMalformedAndExpiredDeadlinesFailClosed();
await testDelayedFirstMoveReceivesOnlyRemainingLease();
await testReadyAndPongPublishPhoneMonotonicClock();
await testClosingOwnerSuppressesLateReplyToSuccessor();
await testHeartbeatExpiryClosesGatewayAndStopsCore();
await testLatePeerFactoryResultIsClosedWithoutStartingCapture();
await testMediaAttachmentBorrowsControlGatewayAndControlOwnsPeerLifetime();
await testHostedPeerCannotBorrowControlAndOnlyOnePeerCanOwnMedia();
await testMalformedIceIsRejectedBeforePeerCreation();
await testMediaRequestsAreIntersectedWithPairedConsent();
await testQueuedSignalsAreBoundedAndDiscardedAcrossPeerGenerations();
await testCentralCredentialsGoOnlyOverThePairedOpenSocket();
await testReachyVolumeAdapterUsesConfiguredMediaCommand();
await testMediaCommandsRpcValidationErrorsAndLateReplySuppression();
console.log("robot bridge device connection: open routing, TTL rejection, stale replies and heartbeat teardown passed");
