import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createNativeCentralHost } = load(new URL("../src/robot-bridge/native-central.ts", import.meta.url).pathname);
const { createRobotWebRtcPeer } = load(new URL("../src/robot-bridge/webrtc-peer.ts", import.meta.url).pathname);
const { createRobotCore } = load(new URL("../src/robot-bridge/core.ts", import.meta.url).pathname);
const { createRobotGateway } = load(new URL("../src/robot-bridge/gateway.ts", import.meta.url).pathname);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const waitFor = async (predicate, message) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
};

function makeFetchHarness(order = []) {
  const requests = [];
  const eventStreams = [];
  const fetchImpl = async (url, init) => {
    const request = { url, init, body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    if (url.endsWith("/events")) {
      const body = new ReadableStream({
        start(controller) {
          const stream = { controller, request };
          eventStreams.push(stream);
          init.signal?.addEventListener("abort", () => {
            try { controller.close(); } catch { /* stream already closed */ }
          }, { once: true });
        },
      });
      return { status: 200, ok: true, body };
    }
    if (request.body?.type === "endSession") order.push(`network-end:${request.body.sessionId}`);
    return { status: 200, ok: true };
  };
  return { fetchImpl, requests, eventStreams };
}

function sendEvent(stream, type, value = {}) {
  stream.controller.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`));
}

function makeOneTokenCentralFixture(order = []) {
  const requests = [];
  const eventStreams = [];
  const tokenToPeer = new Map();
  const peers = new Map();
  const producers = new Map();
  let currentStream = null;
  let generation = 0;

  const enqueue = (stream, message) => {
    stream.sent.push(message);
    stream.controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
  };

  const fetchImpl = async (url, init = {}) => {
    const token = init.headers?.Authorization?.replace(/^Bearer /, "");
    assert.equal(token, "hf_fixture_token_123456", "fixture calls use the single configured bearer token");
    const request = { url, init, body: init.body ? JSON.parse(init.body) : null, peerId: null };
    requests.push(request);

    if (url.endsWith("/events")) {
      let peerId = tokenToPeer.get(token);
      if (!peerId) {
        peerId = "central-peer-for-token";
        tokenToPeer.set(token, peerId);
        peers.set(peerId, { id: peerId, token, meta: {}, role: null });
      }
      const peer = peers.get(peerId);
      peerId = peer.id;
      const stream = { peerId, token, generation: ++generation, request, controller: null, sent: [], closed: false };
      const body = new ReadableStream({
        start(controller) {
          stream.controller = controller;
          eventStreams.push(stream);
          currentStream = stream;
          const rows = [...producers.values()].map((producer) => ({ id: producer.id, meta: producer.meta, busy: false, activeApp: null }));
          enqueue(stream, { type: "welcome", peerId, username: "fixture-user", recommended_heartbeat_interval_seconds: 60 });
          enqueue(stream, { type: "list", producers: rows });
        },
        cancel() { stream.closed = true; },
      });
      init.signal?.addEventListener("abort", () => {
        stream.closed = true;
        try { stream.controller?.close(); } catch { /* stream already closed */ }
      }, { once: true });
      return { status: 200, ok: true, body };
    }

    if (url.endsWith("/send")) {
      const peerId = tokenToPeer.get(token);
      const peer = peers.get(peerId);
      assert.ok(peer, "Central resolves the bearer to one existing peer");
      request.peerId = peerId;
      if (request.body?.type === "setPeerStatus") {
        peer.meta = request.body.meta;
        peer.role = request.body.roles?.includes("producer") ? "producer" : "listener";
        if (peer.role === "producer") producers.set(peerId, peer);
      }
      if (request.body?.type === "endSession") order.push(`network-end:${request.body.sessionId}`);
      return { status: 200, ok: true };
    }

    throw new Error(`Unexpected fixture request: ${url}`);
  };

  return {
    fetchImpl,
    requests,
    eventStreams,
    peers,
    producers,
    tokenToPeer,
    activeStreams: () => eventStreams.filter((stream) => !stream.closed),
    deliverToCurrentProducer(message) {
      assert.ok(currentStream && !currentStream.closed, "Central has one current live stream");
      enqueue(currentStream, message);
      return currentStream;
    },
  };
}

function makePeerFactory(order = []) {
  const peers = [];
  const createPeer = (options) => {
    const peer = {
      options,
      state: "new",
      started: [],
      incoming: [],
      closeReasons: [],
      inspect() { return { state: this.state }; },
      async start(args) { this.started.push(args); this.state = "active"; },
      async handleSignal(event) { this.incoming.push(event); },
      async close(reason) {
        if (this.state === "closed") return;
        this.closeReasons.push(reason);
        order.push(`local-close:${options.sessionId}`);
        this.state = "closed";
        options.onClosed?.(reason);
      },
    };
    peers.push(peer);
    return peer;
  };
  return { createPeer, peers };
}

class FakeRtcDataChannel {
  constructor(label) { this.label = label; this.readyState = "connecting"; this.bufferedAmount = 0; this.sent = []; this.listeners = new Map(); }
  addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  open() { this.readyState = "open"; this.emit("open"); }
  send(value) { this.sent.push(JSON.parse(value)); }
  sendMessage(value) { this.emit("message", { data: JSON.stringify(value) }); }
  close() { this.readyState = "closed"; this.emit("close"); }
}

class FakeRtcPeerConnection {
  constructor(configuration) { this.configuration = configuration; this.connectionState = "new"; this.listeners = new Map(); this.channels = []; this.remoteDescriptions = []; this.addedCandidates = []; this.closed = false; }
  addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  createDataChannel(label, options) { const channel = new FakeRtcDataChannel(label); channel.options = options; this.channels.push(channel); return channel; }
  async createOffer() { return { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=looi\r\nt=0 0\r\n" }; }
  async createAnswer() { return { type: "answer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=looi\r\nt=0 0\r\n" }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; this.remoteDescriptions.push(description); }
  async addIceCandidate(candidate) { this.addedCandidates.push(candidate); }
  getTransceivers() { return []; }
  close() { this.closed = true; this.connectionState = "closed"; }
}

async function singleUniversalSessionRoutingAndShutdownOrder() {
  const order = [];
  const network = makeFetchHarness(order);
  const peerFactory = makePeerFactory(order);
  const openedGateways = [];
  const errors = [];
  const statuses = [];
  const token = "hf_test_secret_123456789";
  const host = createNativeCentralHost({
    config: {
      url: "https://central.example.test",
      token,
      robotName: "LOOI Home",
      protocols: ["reachy", "microduck", "reachy"],
    },
    media: { camera: true, microphone: false, speaker: true, cameraFacing: "environment" },
    fetchImpl: network.fetchImpl,
    createPeer: peerFactory.createPeer,
    openGateway(protocol, sessionId) {
      const gateway = { protocol, sessionId, close() {} };
      openedGateways.push(gateway);
      return gateway;
    },
    onStatus(protocol, status) { statuses.push({ protocol, status }); },
    onError(protocol, error) { errors.push({ protocol, error }); },
  });

  assert.deepEqual(Object.keys(host.inspect().clients), ["universal"], "legacy multi-family configuration exposes one universal client");
  await host.start();
  await waitFor(() => network.eventStreams.length === 1, "one SSE producer stream opens for a legacy multi-family configuration");
  const stream = network.eventStreams[0];
  sendEvent(stream, "welcome", { peerId: "producer-reachy", lease_seconds: 30 });
  await waitFor(() => network.requests.filter((request) => request.body?.type === "setPeerStatus").length === 1, "the active producer registers after welcome");
  const registrations = network.requests.filter((request) => request.body?.type === "setPeerStatus");
  const universalRegistration = registrations[0];
  assert.equal(universalRegistration.body.meta.kind, "microduck", "the MicroDuck app-store predicate discovers the universal LOOI producer");
  assert.equal(universalRegistration.body.meta.name, "LOOI");
  assert.deepEqual(universalRegistration.body.meta.supported_protocols, ["reachy", "microduck"]);
  assert.equal(universalRegistration.body.meta.robot_family, "looi");
  assert.equal(universalRegistration.body.meta.session_liveness, "peer");
  assert.equal(JSON.stringify(registrations.map((request) => request.body.meta)).includes(token), false, "bearer token is not published as producer metadata");
  assert.equal(network.eventStreams.every(({ request }) => request.init.headers.Authorization === `Bearer ${token}`), true);
  assert.ok(statuses.every(({ protocol }) => protocol === "universal"), "status callbacks report the one universal client");

  sendEvent(stream, "startSession", { peerId: "reachy-app", sessionId: "reachy-session-1" });
  await waitFor(() => peerFactory.peers.length === 1 && peerFactory.peers[0].started.length === 1, "Reachy session creates and starts the native peer");
  const reachyPeer = peerFactory.peers[0];
  assert.equal(reachyPeer.options.protocol, "universal");
  assert.equal(reachyPeer.options.sessionId, "reachy-session-1");
  assert.deepEqual(reachyPeer.options.media, { camera: true, microphone: false, speaker: true, cameraFacing: "environment" });
  assert.deepEqual(reachyPeer.options.iceServers, [{ urls: "stun:stun.l.google.com:19302" }]);
  assert.deepEqual(reachyPeer.started[0], { initiator: true });
  await reachyPeer.options.openGateway("universal", "reachy-session-1");
  assert.equal(openedGateways[0].protocol, "universal");
  assert.equal(openedGateways[0].sessionId, "reachy-session-1");

  const consoleRpc = { jsonrpc: "2.0", id: 41, method: "robot.policies", params: {} };
  sendEvent(stream, "peer", { sessionId: "reachy-session-1", rpc: consoleRpc });
  await waitFor(() => reachyPeer.incoming.length === 1, "MicroDuck Central RPC reaches the active peer without SDP");
  assert.deepEqual(reachyPeer.incoming[0], { type: "peer", sessionId: "reachy-session-1", rpc: consoleRpc },
    "the Central RPC envelope reaches the peer unchanged");
  sendEvent(stream, "peer", {
    sessionId: "reachy-session-1",
    peerId: "spoofed-consumer",
    rpc: { jsonrpc: "2.0", id: 42, method: "robot.stop", params: {} },
  });
  await settle();
  assert.equal(reachyPeer.incoming.length, 1, "a peer-id claim that conflicts with the session owner is ignored");
  sendEvent(stream, "peer", {
    sessionId: "reachy-session-1",
    rpc: { jsonrpc: "2.0", id: 43, method: "robot.policies", params: { padding: "x".repeat(256 * 1024) } },
  });
  await settle();
  assert.equal(reachyPeer.incoming.length, 1, "oversized Central RPC payloads are dropped before reaching the app gateway");
  const consoleRpcResponse = { jsonrpc: "2.0", id: 41, result: { mode: "looi" } };
  await reachyPeer.options.sendSignal({
    type: "signal",
    sessionId: "reachy-session-1",
    signal: { type: "peer", sessionId: "reachy-session-1", rpc: consoleRpcResponse },
  });
  await waitFor(() => network.requests.some((request) => request.body?.type === "peer" && request.body.rpc?.id === 41),
    "MicroDuck RPC response is sent through the authenticated Central peer route");
  const relayedResponse = network.requests.find((request) => request.body?.type === "peer" && request.body.rpc?.id === 41);
  assert.deepEqual(relayedResponse.body, { type: "peer", sessionId: "reachy-session-1", rpc: consoleRpcResponse },
    "the JSON-RPC response is nested in Central's peer envelope");
  await reachyPeer.options.sendSignal({
    type: "signal",
    sessionId: "reachy-session-1",
    signal: { type: "peer", sessionId: "reachy-session-1", rpc: { jsonrpc: "2.0", id: 44, result: { padding: "x".repeat(256 * 1024) } } },
  });
  await settle();
  assert.equal(network.requests.some((request) => request.body?.type === "peer" && request.body.rpc?.id === 44), false,
    "oversized app responses are not posted to Central");

  sendEvent(stream, "startSession", { peerId: "overlapping-app", sessionId: "overlapping-session" });
  await waitFor(() => network.requests.some((request) => request.body?.type === "endSession" && request.body.sessionId === "overlapping-session"), "the active Central client declines an overlapping session");
  assert.equal(peerFactory.peers.length, 1, "overlapping sessions cannot open another physical app owner");

  sendEvent(stream, "peer", {
    sessionId: "reachy-session-1",
    sdp: { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=app\r\nt=0 0\r\n" },
  });
  await waitFor(() => reachyPeer.incoming.length === 2, "Central SDP is routed only to its active family/session peer");
  sendEvent(stream, "peer", { sessionId: "unrelated-session", ice: { candidate: "candidate:wrong" } });
  await settle();
  assert.equal(reachyPeer.incoming.length, 2, "signals from another family's Central client do not cross sessions");

  sendEvent(stream, "endSession", { sessionId: "reachy-session-1", reason: "app-ended" });
  await waitFor(() => reachyPeer.state === "closed", "Central endSession closes local media and peer");
  assert.equal(host.inspect().active, null);
  assert.equal(network.requests.some((request) => request.body?.type === "endSession" && request.body.reason === "app-ended"), false, "remote endSession does not echo recursively");

  sendEvent(stream, "startSession", { peerId: "reachy-app", sessionId: "reachy-session-2" });
  await waitFor(() => peerFactory.peers.length === 2 && peerFactory.peers[1].state === "active", "the active family can acquire the host after the previous session ends");
  assert.equal(peerFactory.peers[1].options.protocol, "universal");
  const stopping = host.stop("app-suspended");
  assert.equal(peerFactory.peers[1].state, "closed", "local peer teardown begins synchronously before stop awaits Central");
  await waitFor(() => order.includes("network-end:reachy-session-2"), "Central stop sends the endSession notice");
  assert.ok(order.indexOf("local-close:reachy-session-2") < order.indexOf("network-end:reachy-session-2"), "local PC/core teardown begins before network endSession");
  await stopping;
  assert.equal(host.inspect().running, false);
  assert.equal(host.inspect().active, null);
  assert.equal(errors.length, 0);
  assert.ok(statuses.some(({ protocol, status }) => protocol === "universal" && status.state === "connected"));
  assert.ok(statuses.every(({ protocol }) => protocol === "universal"), "no family-specific client status is published");
}

async function legacyFamilyConfigurationsNormalizeToOneUniversalPeer() {
  const order = [];
  const central = makeOneTokenCentralFixture(order);
  const peerFactory = makePeerFactory(order);
  const statuses = [];
  const openedGateways = [];
  const token = "hf_fixture_token_123456";
  const sharedOptions = {
    media: { camera: false, microphone: false, speaker: false },
    fetchImpl: central.fetchImpl,
    createPeer: peerFactory.createPeer,
    openGateway(protocol, sessionId) {
      const gateway = { protocol, sessionId, close() {} };
      openedGateways.push(gateway);
      return gateway;
    },
    onStatus(protocol, status) { statuses.push({ protocol, status }); },
  };

  for (const protocols of [["reachy"], ["microduck"], ["reachy", "microduck"]]) {
    const candidate = createNativeCentralHost({
      ...sharedOptions,
      config: { url: "https://central.example.test", token, robotName: "LOOI Home", protocols },
    });
    assert.deepEqual(Object.keys(candidate.inspect().clients), ["universal"],
      `legacy config ${protocols.join("+")} normalizes to a universal client`);
  }

  const host = createNativeCentralHost({
    ...sharedOptions,
    config: {
      url: "https://central.example.test",
      token,
      robotName: "LOOI Home",
      protocols: ["reachy", "microduck"],
    },
  });
  await host.start();
  await waitFor(() => central.eventStreams.length === 1 && central.producers.size === 1, "both legacy families share one universal SSE producer");
  const stream = central.eventStreams[0];
  const producer = central.producers.get(stream.peerId);
  assert.equal(central.tokenToPeer.get(token), stream.peerId);
  assert.equal(central.producers.size, 1);
  assert.equal(central.activeStreams().length, 1);
  assert.equal(producer.meta.kind, "microduck");
  assert.equal(producer.meta.name, "LOOI");
  assert.deepEqual(producer.meta.supported_protocols, ["reachy", "microduck"]);
  assert.equal(producer.meta.robot_family, "looi");
  assert.ok(statuses.every(({ protocol }) => protocol === "universal"));

  central.deliverToCurrentProducer({ type: "startSession", peerId: "any-app", sessionId: "universal-session" });
  await waitFor(() => peerFactory.peers.length === 1 && peerFactory.peers[0].state === "active", "either app family opens the same universal WebRTC gateway");
  const peer = peerFactory.peers[0];
  assert.equal(peer.options.protocol, "universal");
  assert.equal(host.inspect().active.protocol, "universal");
  await peer.options.openGateway("universal", "universal-session");
  assert.deepEqual(openedGateways.map(({ protocol, sessionId }) => ({ protocol, sessionId })), [{ protocol: "universal", sessionId: "universal-session" }]);
  await host.stop("universal-test-finished");
  assert.equal(central.activeStreams().length, 0);
}

async function factoryThatResolvesAfterStopIsClosed() {
  const network = makeFetchHarness();
  let resolveFactory;
  const created = [];
  const closed = [];
  const started = [];
  const openedGateways = [];
  const makePeer = (options) => {
    let gateway = null;
    return {
      state: "new",
      inspect() { return { state: this.state }; },
      async start() { started.push(options.protocol); gateway = options.openGateway(options.protocol, options.sessionId); this.state = "active"; },
      async handleSignal() {},
      async close(reason) {
        if (this.state === "closed") return;
        this.state = "closed";
        closed.push(reason);
        await gateway?.close?.();
        options.onClosed?.(reason);
      },
    };
  };
  const host = createNativeCentralHost({
    config: { url: "https://central.example.test", token: "hf_test_secret_123456789", robotName: "LOOI", protocols: ["reachy", "microduck"] },
    media: { camera: false, microphone: false, speaker: false },
    fetchImpl: network.fetchImpl,
    createPeer(options) {
      if (options.protocol !== "universal") return makePeer(options);
      return new Promise((resolve) => {
        resolveFactory = () => {
          resolveFactory = undefined;
          const peer = makePeer(options);
          created.push(peer);
          resolve(peer);
        };
      });
    },
    openGateway(protocol, sessionId) {
      openedGateways.push({ protocol, sessionId });
      return { handleMessage() { return []; }, close() {} };
    },
  });

  await host.start();
  await waitFor(() => network.eventStreams.length === 1, "one universal producer stream opens");
  sendEvent(network.eventStreams[0], "welcome", { peerId: "producer-reachy", lease_seconds: 30 });
  await waitFor(() => network.requests.filter((request) => request.body?.type === "setPeerStatus").length === 1, "the active producer registers");
  const reachyStream = network.eventStreams[0];
  sendEvent(reachyStream, "startSession", { peerId: "web", sessionId: "pending-session" });
  await waitFor(() => typeof resolveFactory === "function", "peer factory starts");
  const stopping = host.stop("backgrounded");
  assert.equal(host.inspect().active, null, "backgrounding invalidates the pending session immediately");
  await stopping;
  assert.equal(host.inspect().running, false, "host stop completes without waiting for the pending peer factory");
  const resolveLateFactory = resolveFactory;
  resolveLateFactory();
  await waitFor(() => created.length === 1 && created[0].state === "closed", "a peer created after shutdown is closed without starting");
  assert.equal(created[0].state, "closed");
  assert.deepEqual(closed, ["backgrounded"]);
  assert.deepEqual(started, [], "late peer is never allowed to start after stop");
  assert.deepEqual(openedGateways, [], "late peer never opens an obsolete gateway session");
  assert.equal(network.requests.some((request) => request.body?.type === "peer" && request.body.sessionId === "pending-session"), false, "late peer sends no stale signaling");

  await host.start();
  await waitFor(() => network.eventStreams.length === 2, "host can restart while an old factory has resolved late");
  sendEvent(network.eventStreams[1], "welcome", { peerId: "restarted-reachy", lease_seconds: 30 });
  await waitFor(() => network.requests.filter((request) => request.body?.type === "setPeerStatus").length === 2, "restarted producer registers");
  sendEvent(network.eventStreams[1], "startSession", { peerId: "reachy-app", sessionId: "restarted-session" });
  await waitFor(() => typeof resolveFactory === "function", "restarted Reachy peer factory starts");
  const resolveRestartedFactory = resolveFactory;
  resolveRestartedFactory();
  await waitFor(() => started.includes("universal"), "the universal session acquires the host after restart");
  assert.deepEqual(openedGateways, [{ protocol: "universal", sessionId: "restarted-session" }]);
  await host.stop("finished");
}

async function pendingPeerStartAndSignalDoNotBlockCentralStop() {
  const network = makeFetchHarness();
  const peers = [];
  const openedGateways = [];
  const closedGateways = [];
  const errors = [];
  let resolveReachyStart;
  let rejectPendingSignal;

  const host = createNativeCentralHost({
    config: { url: "https://central.example.test", token: "hf_test_secret_123456789", robotName: "LOOI", protocols: ["reachy", "microduck"] },
    media: { camera: false, microphone: false, speaker: false },
    fetchImpl: network.fetchImpl,
    createPeer(options) {
      const peer = {
        state: "new",
        gateway: null,
        inspect() { return { state: this.state }; },
        start() {
          this.gateway = options.openGateway(options.protocol, options.sessionId);
          this.state = "starting";
          if (options.sessionId === "pending-start-session") {
            return new Promise((resolve) => { resolveReachyStart = () => { this.state = "active"; resolve(); }; });
          }
          this.state = "active";
          return Promise.resolve();
        },
        handleSignal() {
          return new Promise((_, reject) => { rejectPendingSignal = reject; });
        },
        async close(reason) {
          if (this.state === "closed") return;
          this.state = "closed";
          await this.gateway?.close?.();
          options.onClosed?.(reason);
        },
      };
      peers.push({ peer, options });
      return peer;
    },
    openGateway(protocol, sessionId) {
      const gateway = { protocol, sessionId, close() { closedGateways.push(sessionId); } };
      openedGateways.push(gateway);
      return gateway;
    },
    onError(_protocol, error) { errors.push(error); },
  });

  await host.start();
  await waitFor(() => network.eventStreams.length === 1, "one universal stream opens for pending-operation coverage");
  sendEvent(network.eventStreams[0], "welcome", { peerId: "producer-reachy", lease_seconds: 30 });
  await waitFor(() => network.requests.filter((request) => request.body?.type === "setPeerStatus").length === 1, "Central producer registers");

  sendEvent(network.eventStreams[0], "startSession", { peerId: "reachy-app", sessionId: "pending-start-session" });
  await waitFor(() => typeof resolveReachyStart === "function", "Reachy peer start is waiting on its deferred native operation");
  const startStop = host.stop("stop-during-start");
  await startStop;
  assert.equal(peers[0].peer.state, "closed", "stop closes the peer and gateway while start remains pending");
  assert.deepEqual(closedGateways, ["pending-start-session"]);
  await peers[0].options.sendSignal({ type: "signal", sessionId: "pending-start-session", signal: { type: "peer", sessionId: "pending-start-session", ice: { candidate: "late" } } });
  resolveReachyStart();
  await settle();
  assert.deepEqual(network.requests.filter((request) => request.body?.type === "peer"), [], "late start cannot send Central signaling");

  await host.start();
  await waitFor(() => network.eventStreams.length === 2, "host restarts after stopping during peer start");
  sendEvent(network.eventStreams[1], "welcome", { peerId: "restart-reachy", lease_seconds: 30 });
  await waitFor(() => network.requests.filter((request) => request.body?.type === "setPeerStatus").length === 2, "restarted producer registers");
  const restartedStream = network.eventStreams[1];
  sendEvent(restartedStream, "startSession", { peerId: "reachy-app", sessionId: "pending-signal-session" });
  await waitFor(() => peers.length === 2 && host.inspect().active?.sessionId === "pending-signal-session", "Reachy session starts after restart");
  sendEvent(restartedStream, "peer", {
    sessionId: "pending-signal-session",
    rpc: { jsonrpc: "2.0", id: 9, method: "robot.policies", params: {} },
  });
  await waitFor(() => typeof rejectPendingSignal === "function", "remote RPC handling is waiting on its deferred operation");
  sendEvent(restartedStream, "endSession", { sessionId: "pending-signal-session", reason: "app-ended-during-rpc" });
  await waitFor(() => peers[1].peer.state === "closed", "Central endSession closes peer immediately while RPC handling remains pending");
  assert.deepEqual(closedGateways, ["pending-start-session", "pending-signal-session"], "the ended app's shared gateway is closed");
  await peers[1].options.sendSignal({ type: "signal", sessionId: "pending-signal-session", signal: { type: "peer", sessionId: "pending-signal-session", ice: { candidate: "late" } } });
  rejectPendingSignal(new Error("late signal teardown"));
  await settle();
  assert.deepEqual(network.requests.filter((request) => request.body?.type === "peer"), [], "late RPC and signal work cannot relay stale signaling");
  await host.stop("stop-after-rpc-test");
  assert.equal(host.inspect().running, false);
  assert.deepEqual(errors, [], "late start and signal rejections are observed without stale error callbacks");
}

async function nativeCentralToWebRtcToMicroDuckCoreIntegration() {
  const network = makeFetchHarness();
  const executed = [];
  const stopped = [];
  const backend = {
    id: "fixture-looi",
    capabilities: {
      schemaVersion: 1,
      locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
      pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
      gestures: [], light: false, media: { camera: false, microphone: false, speaker: false, volume: false },
    },
    inspect() { return { connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }; },
    async execute(command, context) {
      if (context.isCurrent()) executed.push(command);
      return { status: "applied", limitations: [], applied: command };
    },
    async stop(reason) { stopped.push(reason); },
  };
  const core = createRobotCore(backend);
  const pcs = [];
  const host = createNativeCentralHost({
    config: { url: "https://central.example.test", token: "hf_test_secret_123456789", robotName: "LOOI", protocols: ["microduck"] },
    media: { camera: false, microphone: false, speaker: false },
    fetchImpl: network.fetchImpl,
    createPeer(input) {
      return createRobotWebRtcPeer({
        ...input,
        createPeerConnection(configuration) {
          const pc = new FakeRtcPeerConnection(configuration);
          pcs.push(pc);
          return pc;
        },
      });
    },
    openGateway(protocol, sessionId) { return createRobotGateway(core, { protocol, sessionId }); },
  });

  try {
    await host.start();
    await waitFor(() => network.eventStreams.length === 1, "integration fixture opens its Pollen producer stream");
    const stream = network.eventStreams[0];
    sendEvent(stream, "welcome", { peerId: "looi-producer", lease_seconds: 30 });
    await waitFor(() => network.requests.some((request) => request.body?.type === "setPeerStatus"), "integration producer registers");
    sendEvent(stream, "startSession", { peerId: "duck-app", sessionId: "integration-duck-session" });
    await waitFor(() => pcs.length === 1 && pcs[0].channels.length === 1, "host creates a real WebRTC peer with one ordered app channel");
    const pc = pcs[0];
    assert.deepEqual(pc.configuration.iceServers, [{ urls: "stun:stun.l.google.com:19302" }]);
    assert.equal(pc.channels.map((channel) => channel.label).join(","), "data",
      "one data channel satisfies Reachy's expected label and MicroDuck's label-agnostic Console");
    assert.notEqual(pc.channels[0].options?.ordered, false, "universal app channel remains reliable and ordered");
    assert.equal(pc.channels[0].options?.maxRetransmits, undefined, "universal app channel does not use lossy teleop semantics");
    await waitFor(() => network.requests.some((request) => request.body?.type === "peer" && request.body.sdp?.type === "offer"), "real peer's SDP offer is sent through the Pollen client");

    sendEvent(stream, "peer", {
      sessionId: "integration-duck-session",
      rpc: { jsonrpc: "2.0", id: 101, method: "hello", params: { api_version: 44 } },
    });
    await waitFor(() => network.requests.some((request) => request.body?.type === "peer" && request.body.rpc?.id === 101),
      "MicroDuck Policy Playground hello gets an HTTP/SSE RPC response without a data-channel answer");
    const helloResponse = network.requests.find((request) => request.body?.type === "peer" && request.body.rpc?.id === 101).body.rpc;
    assert.equal(helloResponse.jsonrpc, "2.0");
    assert.equal(helloResponse.result.api_version, 44);
    assert.equal(pc.channels[0].readyState, "connecting", "the RPC round trip is independent of an open WebRTC data channel");

    sendEvent(stream, "peer", {
      sessionId: "integration-duck-session",
      rpc: { jsonrpc: "2.0", id: 102, method: "robot.policies", params: {} },
    });
    await waitFor(() => network.requests.some((request) => request.body?.type === "peer" && request.body.rpc?.id === 102),
      "the Playground's ordinary robot.policies request reaches the LOOI MicroDuck adapter");
    const policiesResponse = network.requests.find((request) => request.body?.type === "peer" && request.body.rpc?.id === 102).body.rpc;
    assert.equal(policiesResponse.result.mode, "looi");
    assert.equal(policiesResponse.result.compatibility.origin, "looi");
    assert.equal(pc.channels[0].readyState, "connecting", "the no-datachannel session remains control-only over Central");

    sendEvent(stream, "peer", {
      sessionId: "integration-duck-session",
      sdp: { type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=duck\r\nt=0 0\r\n" },
    });
    await waitFor(() => pc.remoteDescriptions.length === 1, "Pollen answer is routed through the real peer to the same session");

    const dataChannel = pc.channels.find((channel) => channel.label === "data");
    dataChannel.open();
    dataChannel.sendMessage({ jsonrpc: "2.0", id: "move-1", method: "robot.move", params: { vx: 0.2, vy: 0, vyaw: 0 } });
    await waitFor(() => executed.length === 1, "original MicroDuck robot.move reaches the shared LOOI core");
    assert.deepEqual(executed[0], { kind: "drive", forward: 0.2, lateral: 0, yawRate: 0, durationMs: 475 });
    await waitFor(() => dataChannel.sent.some((message) => message.id === "move-1"), "MicroDuck request receives its adapter response on the shared app channel");
    assert.equal(dataChannel.sent.find((message) => message.id === "move-1").result.accepted, true);

    sendEvent(stream, "endSession", { sessionId: "integration-duck-session", reason: "app-ended" });
    await waitFor(() => pc.closed && core.inspect().sessionId === null, "Central endSession closes the native peer and STOPs the shared core session");
    assert.ok(stopped.some((reason) => reason === "gateway-closed"), "session teardown invokes the backend STOP path");
    dataChannel.sendMessage({ jsonrpc: "2.0", id: "stale-after-stop", method: "robot.move", params: { vx: 0.4, vy: 0, vyaw: 0 } });
    await settle();
    assert.equal(executed.length, 1, "closed data-channel work is not replayed after STOP");
    assert.equal(host.inspect().active, null);
  } finally {
    await host.stop("integration-finished");
    await core.dispose();
  }
}

function rejectsInvalidSetupWithoutNetwork() {
  const common = {
    config: { url: "https://central.example.test", token: "hf_test_secret_123456789", robotName: "LOOI", protocols: ["reachy"] },
    media: { camera: false, microphone: false, speaker: false },
    fetchImpl: async () => { throw new Error("network must not start during construction"); },
    createPeer: () => { throw new Error("peer factory should not run during construction"); },
    openGateway: () => ({}),
  };
  assert.throws(() => createNativeCentralHost({ ...common, config: { ...common.config, protocols: [] } }), /at least one/);
  assert.throws(() => createNativeCentralHost({ ...common, config: { ...common.config, url: "http://central.example.test" } }), /HTTPS/);
}

rejectsInvalidSetupWithoutNetwork();
await singleUniversalSessionRoutingAndShutdownOrder();
await legacyFamilyConfigurationsNormalizeToOneUniversalPeer();
await factoryThatResolvesAfterStopIsClosed();
await pendingPeerStartAndSignalDoNotBlockCentralStop();
await nativeCentralToWebRtcToMicroDuckCoreIntegration();
console.log("robot bridge native Central host: registration, exclusivity, signaling, shutdown, late factory/start cleanup and MicroDuck-to-core integration passed");
