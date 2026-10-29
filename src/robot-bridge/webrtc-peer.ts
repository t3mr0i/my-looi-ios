import type { RobotMediaBroker, RobotMediaLease, RobotMediaRequest } from "./media-broker";
import type { RobotGatewayProtocol } from "./gateway";

export type RobotRtcSessionDescription = { type: "offer" | "answer"; sdp: string };
export type RobotRtcIceCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

type Listener = (event: any) => void;
export type RobotRtcDataChannel = {
  label: string;
  readyState: string;
  bufferedAmount?: number;
  send(data: string): void;
  close(): void;
  addEventListener?: (type: string, listener: Listener) => void;
  removeEventListener?: (type: string, listener: Listener) => void;
  onopen?: Listener | null;
  onmessage?: Listener | null;
  onclose?: Listener | null;
};
export type RobotRtcPeerConnection = {
  connectionState?: string;
  remoteDescription?: unknown;
  localDescription?: RobotRtcSessionDescription | null;
  addTrack(track: unknown, stream: unknown): unknown;
  addTransceiver?: (source: unknown, init: { direction: "sendonly" | "recvonly" | "sendrecv"; streams?: unknown[] }) => unknown;
  createDataChannel(label: string, options?: { ordered?: boolean; maxRetransmits?: number }): RobotRtcDataChannel;
  createOffer(): Promise<RobotRtcSessionDescription>;
  createAnswer(): Promise<RobotRtcSessionDescription>;
  setLocalDescription(description: RobotRtcSessionDescription): Promise<void>;
  setRemoteDescription(description: RobotRtcSessionDescription): Promise<void>;
  addIceCandidate(candidate: RobotRtcIceCandidate): Promise<void>;
  close(): void;
  getTransceivers?: () => Array<{ stop?: () => void }>;
  addEventListener?: (type: string, listener: Listener) => void;
  removeEventListener?: (type: string, listener: Listener) => void;
  onicecandidate?: Listener | null;
  onconnectionstatechange?: Listener | null;
  ondatachannel?: Listener | null;
  ontrack?: Listener | null;
};

export type RobotGateway = {
  initialMessages?: () => unknown[];
  handleMessage: (raw: unknown) => Promise<unknown[]> | unknown[];
  stateMessages?: () => unknown[];
  close?: () => Promise<void> | void;
};

export type RobotWebRtcPeerOptions = {
  protocol: RobotGatewayProtocol;
  sessionId: string;
  remotePeerId?: string;
  /** The app's media consent/request. Defaults to all three phone media resources. */
  media?: RobotMediaRequest;
  mediaBroker?: RobotMediaBroker;
  /** Kept injectable so the portable signalling state machine can be tested in Node. */
  createPeerConnection: (configuration?: { iceServers?: Array<Record<string, unknown>> }) => RobotRtcPeerConnection;
  iceServers?: Array<Record<string, unknown>>;
  /** Returns the already session-scoped adapter/gateway; parent owns shared local SDK routing. */
  openGateway: (protocol: RobotGatewayProtocol, sessionId: string) => Promise<RobotGateway> | RobotGateway;
  /** Receives the device transport envelope `{type:'signal',sessionId,signal}`. */
  sendSignal: (message: { type: "signal"; sessionId: string; signal: Record<string, unknown> }) => Promise<void> | void;
  onError?: (error: Error) => void;
  /** Called once after peer teardown, allowing the device transport to drop its reference. */
  onClosed?: (reason: string) => void;
  maxIceCandidates?: number;
  maxDataMessageBytes?: number;
  maxPendingMessages?: number;
};

export type RobotWebRtcPeer = {
  start(options?: { initiator?: boolean; offer?: RobotRtcSessionDescription }): Promise<void>;
  handleSignal(signal: unknown): Promise<void>;
  close(reason?: string): Promise<void>;
  inspect(): { sessionId: string; protocol: RobotGatewayProtocol; state: "new" | "starting" | "active" | "closing" | "closed"; pendingLocalIce: number; pendingRemoteIce: number; channels: string[] };
};

const MAX_ICE = 64;
const MAX_DATA_BYTES = 256 * 1024;
const MAX_PENDING_MESSAGES = 32;
const MAX_CHANNEL_BUFFER = 512 * 1024;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeDescription(value: unknown): RobotRtcSessionDescription | null {
  if (!isRecord(value) || (value.type !== "offer" && value.type !== "answer") || typeof value.sdp !== "string" || value.sdp.length < 16 || value.sdp.length > 1_000_000) return null;
  return { type: value.type, sdp: value.sdp };
}

function safeCandidate(value: unknown): RobotRtcIceCandidate | null {
  if (!isRecord(value) || typeof value.candidate !== "string" || value.candidate.length > 4096) return null;
  if (value.sdpMid !== undefined && value.sdpMid !== null && typeof value.sdpMid !== "string") return null;
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null && (!Number.isInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0)) return null;
  if (value.candidate && value.sdpMid == null && value.sdpMLineIndex == null) return null;
  // Browser candidates may identify the media section by index alone. Omit
  // absent fields: react-native-webrtc's iOS converter passes an explicit JSON
  // null sdpMid as NSNull to an NSString API and aborts the whole process.
  return {
    candidate: value.candidate,
    ...(typeof value.sdpMid === "string" ? { sdpMid: value.sdpMid } : {}),
    ...(typeof value.sdpMLineIndex === "number" ? { sdpMLineIndex: value.sdpMLineIndex } : {}),
  };
}

function encodedByteLength(value: string): number {
  // UTF-8 byte count without requiring TextEncoder on older React Native runtimes.
  return unescape(encodeURIComponent(value)).length;
}

/**
 * Phone-side producer peer used by both Pollen Central and the stock local
 * GStreamer SDK wire protocol. A peer owns one media lease and a gateway
 * reference, but the injected gateway may be ref-counted with a local control
 * socket by the host runtime.
 */
export function createRobotWebRtcPeer(options: RobotWebRtcPeerOptions): RobotWebRtcPeer {
  if (!options || !["reachy", "microduck", "universal"].includes(options.protocol)) throw new TypeError("Unsupported robot WebRTC protocol");
  if (typeof options.sessionId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(options.sessionId)) throw new TypeError("Invalid WebRTC session id");
  if (typeof options.createPeerConnection !== "function" || typeof options.openGateway !== "function" || typeof options.sendSignal !== "function") throw new TypeError("WebRTC peer requires injected transport factories");

  const iceLimit = Math.max(1, Math.min(MAX_ICE, options.maxIceCandidates ?? MAX_ICE));
  const messageLimit = Math.max(1, Math.min(MAX_DATA_BYTES, options.maxDataMessageBytes ?? MAX_DATA_BYTES));
  const pendingLimit = Math.max(1, Math.min(MAX_PENDING_MESSAGES, options.maxPendingMessages ?? MAX_PENDING_MESSAGES));
  let state: "new" | "starting" | "active" | "closing" | "closed" = "new";
  let generation = 0;
  let pc: RobotRtcPeerConnection | null = null;
  let lease: RobotMediaLease | null = null;
  let mediaRequest: RobotMediaRequest = options.media ?? { camera: true, microphone: true, speaker: true, cameraFacing: "environment" };
  let gateway: RobotGateway | null = null;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let localIceReady = false;
  let remoteDescriptionReady = false;
  let localIce: RobotRtcIceCandidate[] = [];
  let remoteIce: RobotRtcIceCandidate[] = [];
  let channels = new Set<RobotRtcDataChannel>();
  let pendingMessages = 0;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let closedNotified = false;
  const channelBindings = new Map<RobotRtcDataChannel, Array<() => void>>();
  const pcBindings: Array<() => void> = [];

  const current = (turn: number) => turn === generation && state !== "closing" && state !== "closed";
  const fail = (error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    try { options.onError?.(normalized); } catch { /* diagnostics do not own peer teardown */ }
    void closePeer("webrtc-failed");
  };

  const emit = async (payload: Record<string, unknown>, turn: number) => {
    if (!current(turn)) return;
    await options.sendSignal({ type: "signal", sessionId: options.sessionId, signal: { type: "peer", sessionId: options.sessionId, ...payload } });
  };

  const enqueueLocalIce = (candidate: RobotRtcIceCandidate) => {
    if (!current(generation)) return;
    if (!localIceReady) {
      if (localIce.length >= iceLimit) { fail(new Error("Local ICE candidate buffer limit exceeded")); return; }
      localIce.push(candidate);
      return;
    }
    const turn = generation;
    void emit({ ice: candidate }, turn).catch(fail);
  };

  const attach = <T extends { addEventListener?: (type: string, listener: Listener) => void; removeEventListener?: (type: string, listener: Listener) => void }>(
    target: T, type: string, listener: Listener, fallbackName: "onicecandidate" | "onconnectionstatechange" | "ondatachannel" | "ontrack" | "onopen" | "onmessage" | "onclose",
    cleanup: Array<() => void>,
  ) => {
    if (target.addEventListener) {
      target.addEventListener(type, listener);
      cleanup.push(() => target.removeEventListener?.(type, listener));
    } else {
      const previous = (target as any)[fallbackName] as Listener | null | undefined;
      (target as any)[fallbackName] = listener;
      cleanup.push(() => { if ((target as any)[fallbackName] === listener) (target as any)[fallbackName] = previous ?? null; });
    }
  };

  const sendOn = (channel: RobotRtcDataChannel, value: unknown) => {
    if (channel.readyState !== "open" || (channel.bufferedAmount ?? 0) > MAX_CHANNEL_BUFFER) return;
    const encoded = JSON.stringify(value);
    if (encodedByteLength(encoded) <= messageLimit) channel.send(encoded);
  };

  const channelOpened = (channel: RobotRtcDataChannel, turn: number) => {
    if (!current(turn) || !gateway) return;
    try {
      for (const message of gateway.initialMessages?.() ?? []) sendOn(channel, message);
    } catch (error) { fail(error); }
  };

  const bindChannel = (channel: RobotRtcDataChannel, turn: number) => {
    if (channels.has(channel)) return;
    channels.add(channel);
    const cleanups: Array<() => void> = [];
    channelBindings.set(channel, cleanups);
    attach(channel, "open", () => channelOpened(channel, turn), "onopen", cleanups);
    attach(channel, "message", (event: any) => {
      if (!current(turn) || !gateway || pendingMessages >= pendingLimit) return;
      const raw = event?.data;
      if (typeof raw !== "string" || encodedByteLength(raw) > messageLimit) return;
      let message: unknown;
      try { message = JSON.parse(raw); } catch { return; }
      pendingMessages += 1;
      Promise.resolve().then(() => gateway!.handleMessage(message)).then((responses) => {
        if (!current(turn) || channel.readyState !== "open") return;
        for (const response of responses ?? []) sendOn(channel, response);
      }).catch((error) => { if (current(turn)) fail(error); }).finally(() => { pendingMessages = Math.max(0, pendingMessages - 1); });
    }, "onmessage", cleanups);
    attach(channel, "close", () => { channels.delete(channel); }, "onclose", cleanups);
    if (channel.readyState === "open") channelOpened(channel, turn);
  };

  const ensurePeer = (turn: number): RobotRtcPeerConnection => {
    if (pc) return pc;
    if (!current(turn)) throw new Error("WebRTC peer is closed");
    pc = options.createPeerConnection(options.iceServers ? { iceServers: options.iceServers } : undefined);
    const connection = pc;
    attach(connection, "icecandidate", (event: any) => {
      const native = event?.candidate;
      if (!native) return;
      let value: unknown = native;
      try { value = native.toJSON?.() ?? native; } catch { /* fall back to structural candidate */ }
      const candidate = safeCandidate(value);
      if (candidate) enqueueLocalIce(candidate);
    }, "onicecandidate", pcBindings);
    attach(connection, "connectionstatechange", () => {
      if (!current(turn)) return;
      const status = connection.connectionState;
      if (status === "failed" || status === "closed" || status === "disconnected") void closePeer(`peer-connection-${status}`);
      else if (status === "connected") state = "active";
    }, "onconnectionstatechange", pcBindings);
    attach(connection, "datachannel", (event: any) => {
      if (event?.channel && current(turn)) bindChannel(event.channel, turn);
    }, "ondatachannel", pcBindings);
    attach(connection, "track", (event: any) => {
      // Native WebRTC auto-plays remote audio. A mic-only app must not gain a
      // hidden talkback receive path if its consent excluded the speaker.
      if (event?.track?.kind === "audio" && !mediaRequest.speaker) {
        try { event.track.enabled = false; } catch { /* some native tracks are read-only */ }
        try { event.track.stop?.(); } catch { /* native may already be ended */ }
        return;
      }
      if (event?.track?.kind === "audio" && mediaRequest.speaker) {
        // The broker applies the user's software track gain and owns stopping
        // remote tracks on lease release. Some injected test/native brokers
        // may not implement the optional gain hook yet, so WebRTC playback
        // still works through RN's default audio route in that case.
        try { options.mediaBroker?.registerRemoteAudioTrack(options.sessionId, event.track as never); }
        catch (error) { fail(error); }
      }
    }, "ontrack", pcBindings);
    return connection;
  };

  const prepare = async (turn: number) => {
    gateway = await options.openGateway(options.protocol, options.sessionId);
    if (!current(turn)) { await gateway.close?.(); gateway = null; return; }

    const request = options.media ?? { camera: true, microphone: true, speaker: true, cameraFacing: "environment" as const };
    mediaRequest = request;
    if (options.mediaBroker && (request.camera || request.microphone || request.speaker)) {
      lease = await options.mediaBroker.acquire(options.sessionId, request);
      if (!current(turn)) { await lease.release("peer-stale-start"); lease = null; return; }
    }

    const connection = ensurePeer(turn);
    if (lease) {
      const stream = lease.stream;
      if (stream) {
        const microphone = lease.audioTracks.find((track) => request.microphone && track.kind === "audio");
        const camera = lease.videoTracks.find((track) => request.camera && track.kind === "video");
        // Stock MicroDuck binds event.streams[0]; send-only tracks must keep
        // the capture stream association as well as their consent direction.
        if (microphone && !request.speaker && connection.addTransceiver) connection.addTransceiver(microphone, { direction: "sendonly", streams: [stream] });
        else if (microphone) connection.addTrack(microphone, stream);
        if (camera && connection.addTransceiver) connection.addTransceiver(camera, { direction: "sendonly", streams: [stream] });
        else if (camera) connection.addTrack(camera, stream);
      }
    }
    if (!request.microphone && request.speaker) {
      if (!connection.addTransceiver) throw new Error("This WebRTC runtime cannot receive talkback audio without requesting the microphone");
      connection.addTransceiver("audio", { direction: "recvonly" });
    }
    const activeGateway = gateway;
    const readStateMessages = activeGateway?.stateMessages;
    if (!pumpTimer && readStateMessages) {
      pumpTimer = setInterval(() => {
        if (!current(turn) || !gateway) return;
        const label = options.protocol === "microduck" ? "control" : "data";
        const channel = [...channels].find((candidate) => candidate.label === label && candidate.readyState === "open");
        if (!channel) return;
        try {
          const messages = readStateMessages.call(activeGateway) ?? [];
          for (const message of messages.slice(0, 128)) sendOn(channel, message);
        } catch (error) { fail(error); }
      }, 100);
    }
  };

  const flushLocalIce = async (turn: number) => {
    localIceReady = true;
    const buffered = localIce;
    localIce = [];
    for (const candidate of buffered) await emit({ ice: candidate }, turn);
  };

  const setAndSendLocal = async (description: RobotRtcSessionDescription, turn: number) => {
    const connection = ensurePeer(turn);
    await connection.setLocalDescription(description);
    if (!current(turn)) return;
    const local = connection.localDescription ?? description;
    const candidate = safeDescription(local);
    if (!candidate) throw new Error("Peer connection produced invalid local SDP");
    await emit({ sdp: candidate }, turn);
    await flushLocalIce(turn);
  };

  const processRemoteIce = async (candidate: RobotRtcIceCandidate, turn: number) => {
    const connection = ensurePeer(turn);
    if (!remoteDescriptionReady || !connection.remoteDescription) {
      if (remoteIce.length >= iceLimit) { fail(new Error("Remote ICE candidate buffer limit exceeded")); return; }
      remoteIce.push(candidate);
      return;
    }
    await connection.addIceCandidate(candidate);
  };

  const applyRemoteDescription = async (description: RobotRtcSessionDescription, turn: number) => {
    const connection = ensurePeer(turn);
    await connection.setRemoteDescription(description);
    if (!current(turn)) return;
    remoteDescriptionReady = true;
    const buffered = remoteIce;
    remoteIce = [];
    for (const candidate of buffered) await connection.addIceCandidate(candidate);
    if (description.type === "offer") {
      const answer = await connection.createAnswer();
      if (!current(turn)) return;
      await setAndSendLocal(answer, turn);
    }
  };

  async function closePeer(reason = "peer-closed"): Promise<void> {
    if (closePromise) return closePromise;
    if (state === "closed") return;
    state = "closing";
    generation += 1;
    localIceReady = false;
    closePromise = (async () => {
      if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; }
      for (const [channel, cleanup] of channelBindings) {
        for (const dispose of cleanup) { try { dispose(); } catch { /* best effort */ } }
        try { channel.close(); } catch { /* native may already be closed */ }
      }
      channelBindings.clear();
      channels.clear();
      for (const dispose of pcBindings) { try { dispose(); } catch { /* best effort */ } }
      pcBindings.length = 0;
      const connection = pc;
      pc = null;
      if (connection) {
        try { for (const transceiver of connection.getTransceivers?.() ?? []) transceiver.stop?.(); } catch { /* no transceiver support */ }
        try { connection.close(); } catch { /* idempotent native teardown */ }
      }
      const currentLease = lease; lease = null;
      const currentGateway = gateway; gateway = null;
      // Revoke the robot session immediately, independently of native permission/capture teardown.
      // Both operations start on the next microtask so closePromise is installed before callbacks
      // can re-enter teardown; onClosed still waits until both have settled.
      const mediaCleanup = Promise.resolve().then(async () => {
        if (currentLease) await currentLease.release(reason);
        else if (options.mediaBroker) await options.mediaBroker.release(options.sessionId, reason);
      }).catch(() => { /* media release cancels capture; it must not delay gateway STOP */ });
      const gatewayCleanup = Promise.resolve().then(async () => {
        await currentGateway?.close?.();
      }).catch(() => { /* core STOP is best-effort teardown */ });
      await Promise.all([mediaCleanup, gatewayCleanup]);
      localIce = [];
      remoteIce = [];
      state = "closed";
      if (!closedNotified) {
        closedNotified = true;
        try { options.onClosed?.(reason); } catch { /* parent notification follows cleanup */ }
      }
    })();
    return closePromise;
  }

  return {
    start(startOptions = {}) {
      if (state === "closed" || state === "closing") return Promise.reject(new Error("WebRTC peer is closed"));
      if (startPromise) return startPromise;
      state = "starting";
      const turn = generation;
      const initiator = startOptions.initiator ?? !startOptions.offer;
      startPromise = (async () => {
        await prepare(turn);
        if (!current(turn)) return;
        const connection = ensurePeer(turn);
        if (options.protocol !== "microduck" && initiator) bindChannel(connection.createDataChannel("data", { ordered: true }), turn);
        if (options.protocol === "microduck" && initiator) {
          // The stock mediad producer opens one reliable channel. Console
          // assigns every incoming channel to a single control pointer, so a
          // second lossy channel would replace its RPC path.
          bindChannel(connection.createDataChannel("control", { ordered: true }), turn);
        }
        if (startOptions.offer) {
          const offer = safeDescription(startOptions.offer);
          if (!offer || offer.type !== "offer") throw new TypeError("Invalid remote offer");
          await applyRemoteDescription(offer, turn);
        } else if (initiator) {
          const offer = await connection.createOffer();
          if (!current(turn)) return;
          await setAndSendLocal(offer, turn);
        }
      })().catch((error) => { if (current(turn)) fail(error); throw error; });
      return startPromise;
    },

    async handleSignal(value: unknown) {
      if (state === "closed" || state === "closing") return;
      let event = value;
      if (isRecord(event) && event.type === "signal" && isRecord(event.signal)) event = event.signal;
      if (!isRecord(event) || event.type !== "peer") return;
      if (event.sessionId !== undefined && event.sessionId !== options.sessionId) return;
      const turn = generation;
      if (!pc) await this.start({ initiator: false });
      if (!current(turn) || !pc) return;
      // Some original MicroDuck apps use authenticated Central RPC without a
      // data channel. They share the exact same gateway and STOP owner.
      if (event.rpc !== undefined) {
        if (!isRecord(event.rpc) || event.rpc.jsonrpc !== "2.0" || typeof event.rpc.method !== "string"
          || encodedByteLength(JSON.stringify(event.rpc)) > messageLimit || !gateway || pendingMessages >= pendingLimit) return;
        pendingMessages += 1;
        try {
          const responses = await gateway.handleMessage(event.rpc);
          if (!current(turn)) return;
          for (const response of responses ?? []) {
            if (!isRecord(response) || response.jsonrpc !== "2.0" || !Object.hasOwn(response, "id")) continue;
            if (encodedByteLength(JSON.stringify(response)) <= messageLimit) await emit({ rpc: response }, turn);
          }
        } finally { pendingMessages = Math.max(0, pendingMessages - 1); }
        return;
      }
      try {
        const description = safeDescription(event.sdp);
        if (event.sdp !== undefined && !description) throw new TypeError("Invalid remote session description");
        if (description) await applyRemoteDescription(description, turn);
        if (event.ice !== undefined) {
          const candidate = safeCandidate(event.ice);
          if (!candidate) throw new TypeError("Invalid ICE candidate");
          await processRemoteIce(candidate, turn);
        }
      } catch (error) { if (current(turn)) fail(error); throw error; }
    },

    close: closePeer,

    inspect() {
      return { sessionId: options.sessionId, protocol: options.protocol, state, pendingLocalIce: localIce.length, pendingRemoteIce: remoteIce.length, channels: [...channels].map((channel) => channel.label) };
    },
  };
}
