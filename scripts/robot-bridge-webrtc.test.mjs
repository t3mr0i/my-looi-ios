import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { createRobotWebRtcPeer } = load(new URL("../src/robot-bridge/webrtc-peer.ts", import.meta.url).pathname);
const { createPollenCentralClient, createGStreamerSignalingRelay, DEFAULT_POLLEN_CENTRAL_URL } = load(new URL("../src/robot-bridge/pollen-signaling.ts", import.meta.url).pathname);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const waitFor = async (predicate, message, timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  do {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  assert.fail(message);
};
const SDP = `v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=LOOI test\r\nt=0 0\r\n`;

function makeChannel(label, init = {}) {
  const listeners = new Map();
  return {
    label, init, readyState: "connecting", bufferedAmount: 0, sent: [], closed: 0,
    addEventListener(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, value = {}) { if (type === "open") this.readyState = "open"; if (type === "close") this.readyState = "closed"; for (const listener of [...(listeners.get(type) ?? [])]) listener(value); },
    send(data) { this.sent.push(data); },
    close() { this.closed++; this.readyState = "closed"; this.emit("close"); },
  };
}

function makePeerConnection(order = []) {
  const listeners = new Map();
  const pc = {
    connectionState: "new", localDescription: null, remoteDescription: null, channels: [], addedTracks: [], transceivers: [], candidates: [],
    addEventListener(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, value = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(value); },
    addTrack(track, stream) { this.addedTracks.push({ track, stream }); },
    addTransceiver(source, init) { this.transceivers.push({ source, init }); },
    createDataChannel(label, init) { const channel = makeChannel(label, init); this.channels.push(channel); return channel; },
    async createOffer() { return { type: "offer", sdp: `${SDP}a=offer\r\n` }; },
    async createAnswer() { return { type: "answer", sdp: `${SDP}a=answer\r\n` }; },
    async setLocalDescription(description) {
      this.localDescription = description;
      // Exercise the real ordering edge: native ICE can fire before the offer is sent.
      this.emit("icecandidate", { candidate: { candidate: "candidate:local 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0, toJSON() { return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex }; } } });
    },
    async setRemoteDescription(description) { this.remoteDescription = description; },
    async addIceCandidate(candidate) { this.candidates.push(candidate); },
    getTransceivers() { return [{ stop() { order.push("transceiver-stop"); } }]; },
    close() { order.push("pc-close"); this.connectionState = "closed"; },
  };
  return pc;
}

async function pollenCentralSseAndDevicePeerSignaling() {
  const requests = [];
  const callbacks = { opened: [], signals: [], closed: [] };
  let controller;
  const token = "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/events")) {
      const body = new ReadableStream({
        start(value) {
          controller = value;
          init.signal?.addEventListener("abort", () => { try { value.close(); } catch { /* already closed */ } }, { once: true });
        },
      });
      return { status: 200, ok: true, body };
    }
    return { status: 200, ok: true };
  };
  const client = createPollenCentralClient({
    centralUrl: "https://central.example.test",
    token,
    protocol: "microduck",
    meta: { name: "LOOI Living Room" },
    fetchImpl,
    reconnectMinMs: 5,
    reconnectMaxMs: 10,
    sseReadTimeoutMs: 5000,
    openSession(input) { callbacks.opened.push(input); },
    signal(sessionId, event, context) { callbacks.signals.push({ sessionId, event, context }); },
    closeSession(sessionId, reason, context) { callbacks.closed.push({ sessionId, reason, context }); },
  });
  await client.start();
  await waitFor(() => !!controller, "central SSE connection opens");
  const sendEvent = (type, value, prefix = "") => controller.enqueue(new TextEncoder().encode(`${prefix}event: ${type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`));
  sendEvent("welcome", { type: "welcome", peerId: "producer-1", lease_seconds: 30, recommended_heartbeat_interval_seconds: 30 }, ": connected\r\n");
  await waitFor(() => requests.some((request) => request.body?.type === "setPeerStatus"), "producer registers after central welcome");
  const getRequest = requests.find((request) => request.url.endsWith("/events"));
  assert.equal(getRequest.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(getRequest.init.headers.Accept, "text/event-stream");
  assert.equal(getRequest.url.includes(token), false, "bearer credentials never enter the URL");
  const registration = requests.find((request) => request.body?.type === "setPeerStatus");
  assert.deepEqual(registration.body.roles, ["producer"]);
  assert.equal(registration.body.meta.kind, "microduck", "the MicroDuck app store filters on this pinned metadata field");
  assert.equal(client.inspect().state, "connected");

  sendEvent("startSession", { type: "startSession", peerId: "consumer-42", sessionId: "central-session-42" });
  await waitFor(() => callbacks.opened.length === 1, "central session creates a phone peer");
  assert.deepEqual(callbacks.opened[0], { protocol: "microduck", sessionId: "central-session-42", remotePeerId: "consumer-42", transport: "pollen" });
  sendEvent("peer", { type: "peer", sessionId: "stale-session", sdp: { type: "answer", sdp: SDP } });
  sendEvent("peer", { type: "peer", sessionId: "central-session-42", ice: { candidate: "candidate:remote 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 } });
  await waitFor(() => callbacks.signals.length === 1, "central candidate reaches the phone peer");
  assert.equal(callbacks.signals[0].context.direction, "remote-to-phone");
  const accepted = await client.handleDeviceSignal({ type: "signal", sessionId: "central-session-42", signal: { type: "peer", sessionId: "central-session-42", sdp: { type: "offer", sdp: SDP } } });
  assert.equal(accepted, true);
  assert.deepEqual(requests.at(-1).body, { type: "peer", sessionId: "central-session-42", sdp: { type: "offer", sdp: SDP } });
  assert.equal(await client.handleDeviceSignal({ type: "signal", sessionId: "stale-session", signal: { type: "peer", sessionId: "stale-session", ice: { candidate: "x" } } }), false);
  sendEvent("endSession", { type: "endSession", sessionId: "central-session-42", reason: "consumer-left" });
  await waitFor(() => callbacks.closed.length === 1, "central endSession closes the phone owner");
  assert.equal(callbacks.closed[0].reason, "consumer-left");
  assert.equal(callbacks.closed[0].context.transport, "pollen");
  await client.stop();

  const defaultUrlClient = createPollenCentralClient({ token, protocol: "reachy", fetchImpl, openSession() {}, signal() {}, closeSession() {} });
  assert.equal(defaultUrlClient.inspect().centralUrl, DEFAULT_POLLEN_CENTRAL_URL);
  await defaultUrlClient.stop();
  assert.throws(() => createPollenCentralClient({ centralUrl: "https://user:secret@localhost/?token=bad", token, protocol: "reachy", fetchImpl, openSession() {}, signal() {}, closeSession() {} }), /cannot contain/);
}

async function stockGStreamerLocalSignalingProtocol() {
  const calls = { opened: [], incoming: [], closed: [] };
  const relay = createGStreamerSignalingRelay({
    protocol: "reachy", producerId: "looi-producer", createSessionId: () => "local-session-1",
    openSession(input) { calls.opened.push(input); },
    signal(sessionId, event, context) { calls.incoming.push({ sessionId, event, context }); },
    closeSession(sessionId, reason, context) { calls.closed.push({ sessionId, reason, context }); },
  });
  const listeners = new Map();
  const socket = {
    readyState: 1, sent: [], closed: 0,
    send(data) { this.sent.push(JSON.parse(data)); },
    on(name, callback) { const group = listeners.get(name) ?? new Set(); group.add(callback); listeners.set(name, group); },
    emit(name, value) { for (const callback of [...(listeners.get(name) ?? [])]) callback(value); },
    close() { this.closed++; this.readyState = 3; },
  };
  const connection = relay.handleConnection(socket);
  assert.deepEqual(socket.sent[0], { type: "welcome", peerId: connection.peerId });
  socket.emit("message", JSON.stringify({ type: "setPeerStatus", roles: ["listener"], meta: { name: "Python SDK" } }));
  socket.emit("message", JSON.stringify({ type: "list" }));
  assert.equal(socket.sent.at(-1).type, "list");
  assert.deepEqual(socket.sent.at(-1).producers[0], { id: "looi-producer", roles: ["producer"], meta: { name: "LOOI", session_liveness: "peer" } });
  socket.emit("message", JSON.stringify({ type: "startSession", peerId: "looi-producer" }));
  await waitFor(() => calls.opened.length === 1, "local SDK startSession opens the shared device session");
  assert.equal(socket.sent.at(-1).type, "sessionStarted");
  assert.deepEqual(calls.opened[0], { protocol: "reachy", sessionId: "local-session-1", remotePeerId: connection.peerId, transport: "local" });
  socket.emit("message", JSON.stringify({ type: "peer", sessionId: "local-session-1", sdp: { type: "answer", sdp: SDP } }));
  await waitFor(() => calls.incoming.length === 1, "local app SDP uses the common peer callback");
  assert.equal(calls.incoming[0].event.sdp.type, "answer");
  assert.equal(calls.incoming[0].context.direction, "remote-to-phone");
  assert.equal(await relay.handleDeviceSignal("local-session-1", { type: "peer", sdp: { type: "offer", sdp: SDP }, ice: { candidate: "candidate:phone 1 udp 1 127.0.0.1 9 typ host" } }), true);
  assert.deepEqual(socket.sent.at(-1), { type: "peer", sessionId: "local-session-1", sdp: { type: "offer", sdp: SDP }, ice: { candidate: "candidate:phone 1 udp 1 127.0.0.1 9 typ host" } });
  socket.emit("message", JSON.stringify({ type: "endSession", sessionId: "local-session-1" }));
  await waitFor(() => calls.closed.length === 1, "local app endSession releases the session");
  assert.equal(calls.closed[0].context.transport, "local");
  await relay.close();
  assert.equal(socket.closed, 1);
}

async function centralStopCancelsReconnectBackoff() {
  let attempts = 0;
  const client = createPollenCentralClient({
    centralUrl: "https://central.example.test", token: "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", protocol: "reachy",
    reconnectMinMs: 5_000, reconnectMaxMs: 5_000,
    async fetchImpl() { attempts += 1; throw new Error("offline"); },
    openSession() {}, signal() {}, closeSession() {},
  });
  await client.start();
  await waitFor(() => client.inspect().reconnectAttempt > 0, "central client enters reconnect backoff after a failed SSE request");
  const startedAt = Date.now();
  await client.stop();
  assert.ok(Date.now() - startedAt < 500, "shutdown wakes a long reconnect backoff instead of waiting for its full delay");
  assert.equal(attempts, 1, "shutdown does not initiate a new attempt after waking the retry timer");
  assert.equal(client.inspect().state, "stopped");
}

async function centralUnauthorizedErrorsReportSafelyAndStopStaysQuiet() {
  const token = "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const errors = [];
  const unauthorizedRequests = [];
  const client = createPollenCentralClient({
    centralUrl: "https://central.example.test", token, protocol: "reachy",
    reconnectMinMs: 5_000, reconnectMaxMs: 5_000,
    async fetchImpl(url, init) {
      unauthorizedRequests.push({ url, init });
      return { status: 401, ok: false, body: null };
    },
    onError(error) { errors.push(error); },
    openSession() {}, signal() {}, closeSession() {},
  });
  await client.start();
  await waitFor(() => errors.length === 1, "an unauthorized Central response is reported to the native UI");
  assert.match(errors[0].message, /HTTP 401/);
  assert.equal(JSON.stringify(errors).includes(token), false, "diagnostics never include the bearer token");
  assert.equal(unauthorizedRequests[0].url.includes(token), false, "the bearer token is absent from the request URL");
  await client.stop();
  assert.equal(errors.length, 1, "intentional stop does not report a second error");

  const stoppedErrors = [];
  let abortSignal;
  const stoppingClient = createPollenCentralClient({
    centralUrl: "https://central.example.test", token, protocol: "reachy",
    async fetchImpl(_url, init) {
      abortSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })), { once: true });
      });
    },
    onError(error) { stoppedErrors.push(error); },
    openSession() {}, signal() {}, closeSession() {},
  });
  await stoppingClient.start();
  await waitFor(() => !!abortSignal, "the pending Central fetch starts before intentional stop");
  await stoppingClient.stop();
  assert.equal(stoppedErrors.length, 0, "intentional abort during stop does not report a connection error");
}

async function centralSseReadTimeoutAbortsBeforeReconnect() {
  const eventRequests = [];
  let streamCanceled = 0;
  let firstSignalAbortedAtReconnect = false;
  const client = createPollenCentralClient({
    centralUrl: "https://central.example.test", token: "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", protocol: "reachy",
    reconnectMinMs: 100, reconnectMaxMs: 100, sseReadTimeoutMs: 1000,
    async fetchImpl(url, init) {
      if (url.endsWith("/events")) {
        eventRequests.push(init);
        if (eventRequests.length === 1) {
          return {
            status: 200,
            ok: true,
            body: new ReadableStream({ cancel() { streamCanceled += 1; } }),
          };
        }
        firstSignalAbortedAtReconnect = eventRequests[0].signal.aborted;
        return { status: 503, ok: false, body: null };
      }
      return { status: 200, ok: true };
    },
    openSession() {}, signal() {}, closeSession() {},
  });

  await client.start();
  await waitFor(() => eventRequests.length >= 2, "a timed-out central stream is replaced after the retry delay", 2500);
  assert.equal(firstSignalAbortedAtReconnect, true, "the original native fetch is aborted before the next events request starts");
  assert.equal(streamCanceled, 1, "the pending readable stream is canceled without waiting for its read to finish");
  await client.stop();
  assert.equal(client.inspect().state, "stopped");
}

async function reachyAndMicroduckPeerNegotiationAndGatewayPump() {
  const order = [];
  const pc = makePeerConnection(order);
  const tracks = [{ kind: "audio", id: "mic" }, { kind: "video", id: "camera" }];
  const stream = { id: "phone-stream" };
  const lease = { stream, audioTracks: [tracks[0]], videoTracks: [tracks[1]], async release(reason) { order.push(`media-release:${reason}`); } };
  let gatewayMessages = [];
  let gatewayClosed = 0;
  const signals = [];
  let closed = [];
  const registeredRemoteTracks = [];
  const peer = createRobotWebRtcPeer({
    protocol: "reachy", sessionId: "reachy-peer-1", remotePeerId: "web-client", media: { camera: true, microphone: true, speaker: true },
    mediaBroker: {
      async acquire(owner, request) { assert.equal(owner, "reachy-peer-1"); assert.deepEqual(request, { camera: true, microphone: true, speaker: true }); return lease; },
      registerRemoteAudioTrack(owner, track) { registeredRemoteTracks.push({ owner, track }); return true; },
    },
    createPeerConnection: (configuration) => { assert.equal(configuration, undefined); return pc; },
    openGateway: () => ({
      initialMessages: () => [{ type: "initial" }],
      handleMessage: (value) => { gatewayMessages.push(value); return [{ type: "reply", value }]; },
      stateMessages: () => [{ type: "poll-state" }],
      async close() { gatewayClosed++; order.push("gateway-close"); },
    }),
    sendSignal(message) { signals.push(message); },
    onClosed(reason) { closed.push(reason); },
  });
  await peer.start();
  assert.deepEqual(pc.addedTracks.map((entry) => entry.track), [tracks[0]]);
  assert.deepEqual(pc.transceivers, [{ source: tracks[1], init: { direction: "sendonly", streams: [stream] } }]);
  assert.equal(pc.addedTracks[0].stream, stream);
  const originalConsoleVideo = { srcObject: null };
  const originalConsoleOnTrack = (event) => { originalConsoleVideo.srcObject = event.streams[0]; };
  // MicroDuck Console 8909b1a assigns event.streams[0] on every track event.
  // Audio arrives with addTrack's stream, then the camera event must preserve
  // that same stream or the console replaces its live video with undefined.
  originalConsoleOnTrack({ track: tracks[0], streams: [pc.addedTracks[0].stream] });
  const cameraSender = pc.transceivers.find((entry) => entry.source === tracks[1]);
  originalConsoleOnTrack({ track: tracks[1], streams: cameraSender?.init.streams ?? [] });
  assert.equal(originalConsoleVideo.srcObject, stream, "the original MicroDuck ontrack handler keeps the camera in the same MediaStream as microphone audio");
  assert.equal(pc.channels.length, 1);
  assert.equal(pc.channels[0].label, "data", "Reachy SDK consumes the original data channel label");
  assert.equal(signals[0].signal.sdp.type, "offer");
  assert.equal(signals[1].signal.ice.candidate.startsWith("candidate:local"), true, "early local ICE follows the SDP offer");

  await peer.handleSignal({ type: "signal", sessionId: "reachy-peer-1", signal: { type: "peer", sessionId: "reachy-peer-1", ice: { candidate: "candidate:remote 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 } } });
  assert.equal(pc.candidates.length, 0, "ICE is buffered until remote SDP arrives");
  await peer.handleSignal({ type: "peer", sessionId: "reachy-peer-1", sdp: { type: "answer", sdp: SDP } });
  assert.equal(pc.remoteDescription.type, "answer");
  assert.equal(pc.candidates.length, 1);
  const remoteTalkback = { kind: "audio", enabled: true };
  pc.emit("track", { track: remoteTalkback });
  assert.deepEqual(registeredRemoteTracks, [{ owner: "reachy-peer-1", track: remoteTalkback }], "the opted-in speaker lease registers talkback audio for software gain and teardown");

  const channel = pc.channels[0];
  channel.emit("open");
  assert.deepEqual(JSON.parse(channel.sent[0]), { type: "initial" });
  channel.emit("message", { data: JSON.stringify({ command: "hello" }) });
  await waitFor(() => gatewayMessages.length === 1, "data-channel messages route to the original adapter gateway");
  assert.deepEqual(JSON.parse(channel.sent.at(-1)), { type: "reply", value: { command: "hello" } });
  await new Promise((resolve) => setTimeout(resolve, 125));
  assert.ok(channel.sent.some((value) => JSON.parse(value).type === "poll-state"), "bounded state pump flushes adapter task/status messages");

  await peer.close("remote-ended");
  assert.deepEqual(order.slice(0, 3), ["transceiver-stop", "pc-close", "media-release:remote-ended"], "native senders close before the phone media lease is released");
  assert.equal(gatewayClosed, 1);
  assert.deepEqual(closed, ["remote-ended"]);
  assert.equal(peer.inspect().state, "closed");

  const duckPc = makePeerConnection();
  const duckPeer = createRobotWebRtcPeer({
    protocol: "microduck", sessionId: "duck-peer-1", createPeerConnection: () => duckPc,
    openGateway: () => ({ handleMessage: () => [], close() {} }), sendSignal() {},
  });
  await duckPeer.start();
  assert.deepEqual(duckPc.channels.map((item) => [item.label, item.init]), [
    ["control", { ordered: true }],
  ], "the stock MicroDuck Console keeps one channel pointer, matching the original producer's single reliable control channel");
  await duckPeer.close();
}

async function nullableBrowserIceNeverReachesNativeBridge() {
  const pc = makePeerConnection();
  const nativeAdd = pc.addIceCandidate.bind(pc);
  pc.addIceCandidate = async candidate => {
    // RCTConvert+WebRTC passes sdpMid straight into an NSString API. JSON null
    // becomes NSNull and aborts iOS with "-[NSNull stdString]".
    assert.notEqual(candidate.sdpMid, null, "nullable browser sdpMid must be omitted before native conversion");
    assert.notEqual(candidate.sdpMLineIndex, null, "nullable browser m-line index must be omitted before native conversion");
    return nativeAdd(candidate);
  };
  const peer = createRobotWebRtcPeer({
    protocol: "universal", sessionId: "nullable-ice",
    mediaBroker: { async acquire() { return { stream: { id: "ice-test" }, audioTracks: [], videoTracks: [], async release() {} }; } },
    createPeerConnection: () => pc,
    openGateway: () => ({ handleMessage: () => [], async close() {} }),
    sendSignal() {},
  });
  await peer.start();
  const indexOnly = { candidate: "candidate:index 1 udp 1 127.0.0.1 9 typ host", sdpMid: null, sdpMLineIndex: 0 };
  await peer.handleSignal({ type: "peer", ice: indexOnly });
  assert.equal(pc.candidates.length, 0, "index-only candidate waits for its SDP");
  await peer.handleSignal({ type: "peer", sdp: { type: "answer", sdp: SDP } });
  assert.deepEqual(pc.candidates, [{ candidate: indexOnly.candidate, sdpMLineIndex: 0 }]);
  await peer.handleSignal({ type: "peer", ice: { candidate: "candidate:mid 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: null } });
  assert.deepEqual(pc.candidates[1], { candidate: "candidate:mid 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0" });
  await assert.rejects(peer.handleSignal({ type: "peer", ice: { candidate: indexOnly.candidate, sdpMid: null, sdpMLineIndex: null } }), /Invalid ICE candidate/);
  assert.equal(pc.candidates.length, 2, "candidates without a media section never reach native conversion");
  await peer.close("ice-regression-complete");
}

async function answererRoleSupportsDirectLocalOffers() {
  const pc = makePeerConnection();
  const signals = [];
  const peer = createRobotWebRtcPeer({
    protocol: "reachy", sessionId: "local-answerer-1", createPeerConnection: () => pc,
    openGateway: () => ({ handleMessage: () => [], close() {} }), sendSignal: (message) => signals.push(message),
  });
  await peer.start({ initiator: false });
  assert.equal(pc.channels.length, 0, "the answerer does not invent the offerer's data channel");
  assert.equal(signals.length, 0, "the answerer waits for the stock producer/consumer offer");
  await peer.handleSignal({ type: "peer", sessionId: "local-answerer-1", sdp: { type: "offer", sdp: SDP } });
  assert.equal(pc.remoteDescription.type, "offer");
  assert.equal(signals[0].signal.sdp.type, "answer");
  await peer.close();
}

async function speakerConsentControlsTalkbackDirection() {
  const micOnlyPc = makePeerConnection();
  const microphone = { kind: "audio", id: "mic" };
  const stream = { id: "mic-stream" };
  const micOnly = createRobotWebRtcPeer({
    protocol: "reachy", sessionId: "mic-only", media: { camera: false, microphone: true, speaker: false },
    mediaBroker: { async acquire() { return { stream, audioTracks: [microphone], videoTracks: [], async release() {} }; } },
    createPeerConnection: () => micOnlyPc, openGateway: () => ({ handleMessage: () => [] }), sendSignal() {},
  });
  await micOnly.start();
  assert.deepEqual(micOnlyPc.transceivers, [{ source: microphone, init: { direction: "sendonly", streams: [stream] } }]);
  const unexpectedRemoteAudio = { kind: "audio", enabled: true, stopped: false, stop() { this.stopped = true; } };
  micOnlyPc.emit("track", { track: unexpectedRemoteAudio });
  assert.equal(unexpectedRemoteAudio.enabled, false);
  assert.equal(unexpectedRemoteAudio.stopped, true, "speaker opt-out disables native remote audio playback");
  await micOnly.close();

  const speakerOnlyPc = makePeerConnection();
  const speakerOnly = createRobotWebRtcPeer({
    protocol: "reachy", sessionId: "speaker-only", media: { camera: false, microphone: false, speaker: true },
    createPeerConnection: () => speakerOnlyPc, openGateway: () => ({ handleMessage: () => [] }), sendSignal() {},
  });
  await speakerOnly.start();
  assert.deepEqual(speakerOnlyPc.transceivers, [{ source: "audio", init: { direction: "recvonly" } }], "talkback audio gets an audio m-line while microphone capture remains off");
  await speakerOnly.close();
}

async function gatewayStopStartsWhileMediaReleaseIsPending() {
  let finishMediaRelease;
  const mediaReleaseDone = new Promise((resolve) => { finishMediaRelease = resolve; });
  const mediaReleaseStarted = { value: false };
  const gatewayClosed = { value: false };
  const closed = [];
  const pc = makePeerConnection();
  const lease = {
    stream: { id: "pending-release-stream" }, audioTracks: [], videoTracks: [],
    release() { mediaReleaseStarted.value = true; return mediaReleaseDone; },
  };
  const peer = createRobotWebRtcPeer({
    protocol: "reachy", sessionId: "stop-ordering",
    mediaBroker: { async acquire() { return lease; } },
    createPeerConnection: () => pc,
    openGateway: () => ({
      handleMessage: () => [],
      async close() {
        assert.equal(mediaReleaseStarted.value, true, "media cleanup has begun before gateway STOP");
        gatewayClosed.value = true;
      },
    }),
    sendSignal() {},
    onClosed(reason) { closed.push(reason); },
  });
  await peer.start();

  let closeResolved = false;
  const closing = peer.close("remote-ended").then(() => { closeResolved = true; });
  await waitFor(() => gatewayClosed.value, "gateway STOP starts without waiting for native media release");
  assert.equal(mediaReleaseStarted.value, true);
  assert.equal(closeResolved, false, "close remains pending until media cleanup completes");
  assert.deepEqual(closed, [], "onClosed waits for both gateway and media teardown");
  assert.equal(peer.inspect().state, "closing");

  finishMediaRelease();
  await closing;
  assert.deepEqual(closed, ["remote-ended"]);
  assert.equal(peer.inspect().state, "closed");
}

await pollenCentralSseAndDevicePeerSignaling();
await stockGStreamerLocalSignalingProtocol();
await centralStopCancelsReconnectBackoff();
await centralUnauthorizedErrorsReportSafelyAndStopStaysQuiet();
await centralSseReadTimeoutAbortsBeforeReconnect();
await reachyAndMicroduckPeerNegotiationAndGatewayPump();
await nullableBrowserIceNeverReachesNativeBridge();
await answererRoleSupportsDirectLocalOffers();
await speakerConsentControlsTalkbackDirection();
await gatewayStopStartsWhileMediaReleaseIsPending();
console.log("robot bridge WebRTC: Pollen SSE, GStreamer wire protocol, SDP/ICE, datachannels and media teardown passed");
