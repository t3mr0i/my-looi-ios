import { createRobotGateway, type RobotProtocol } from "./gateway";
import type { RobotAppMediaServices } from "./app-media-services";
import type { RobotCore } from "./types";
import type { RobotAudioGainDevice, RobotAudioGainStatus, RobotMediaRequest, RobotMediaStatus, RobotVideoInfo } from "./media-broker";
import type { RobotWebRtcPeer, RobotWebRtcPeerOptions } from "./webrtc-peer";

type Socket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
};

export type DeviceConnectionOptions = {
  url: string;
  /** Random per-owner credential, carried as a WebSocket subprotocol, never a URL parameter. */
  token: string;
  allowApproximation?: boolean;
  createSocket?: (url: string, protocols: string[]) => Socket;
  media?: RobotMediaRequest;
  mediaStatus?: RobotMediaStatus;
  central?: { enabled: boolean; url: string; token: string; robotName: string; protocols: ("reachy" | "microduck")[] };
  createPeer?: (options: Omit<RobotWebRtcPeerOptions, "createPeerConnection" | "mediaBroker">) => Promise<RobotWebRtcPeer> | RobotWebRtcPeer;
  onStatus?: (phase: "connected" | "error", message?: string) => void;
  mediaCommand?: (command: { action: "get-volume" | "set-volume"; device: "speaker" | "microphone"; value?: number }) => Promise<unknown>;
};

const UNAVAILABLE_VIDEO: RobotVideoInfo = { width: null, height: null, rotate: 0, available: false, source: "unavailable" };

function isAudioGainStatus(value: unknown): value is RobotAudioGainStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Record<string, unknown>;
  return Number.isInteger(status.percent) && (status.percent as number) >= 0 && (status.percent as number) <= 100
    && status.origin === "webrtc-track-gain" && typeof status.pending === "boolean";
}

function readIceServers(value: unknown): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid ICE servers");
  return value.map(server => {
    if (!server || typeof server !== "object" || Array.isArray(server)) throw new Error("Invalid ICE server");
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > 8 || urls.some((url: unknown) => typeof url !== "string" || url.length > 1024 || !/^(?:stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error("Invalid ICE server URL");
    if ([server.username, server.credential].some(value => value !== undefined && (typeof value !== "string" || value.length > 512))) throw new Error("Invalid ICE credentials");
    return { urls: [...urls], ...(server.username !== undefined ? { username: server.username } : {}), ...(server.credential !== undefined ? { credential: server.credential } : {}) };
  });
}

/**
 * React Native's URL polyfill exposes HTTP(S)-only host/path getters for ws(s) URLs.
 * Parse the same address through its HTTP(S) equivalent, then restore the socket scheme.
 */
export function normalizeRobotBridgeDeviceUrl(input: string): string {
  if (typeof input !== "string" || /\s/.test(input) || input.includes("\\") || input.includes("?") || input.includes("#")) {
    throw new Error("Invalid robot bridge WebSocket URL");
  }
  const match = /^(ws|wss):\/\//i.exec(input);
  if (!match) throw new Error("Invalid robot bridge WebSocket URL");
  const socketProtocol = match[1]!.toLowerCase();
  const httpProtocol = socketProtocol === "wss" ? "https:" : "http:";
  const authorityAndPath = input.slice(match[0].length);
  if (!authorityAndPath || authorityAndPath.startsWith("/")) throw new Error("Invalid robot bridge WebSocket URL");
  let parsed: URL;
  try {
    parsed = new URL(`${httpProtocol}//${authorityAndPath}`);
  } catch {
    throw new Error("Invalid robot bridge WebSocket URL");
  }
  if (parsed.protocol !== httpProtocol || !parsed.hostname || parsed.pathname !== "/device"
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Invalid robot bridge WebSocket URL");
  }
  return `${socketProtocol}:${parsed.href.slice(parsed.protocol.length)}`;
}

/** Outbound native connection: the phone keeps the core, controller and cancellation authority. */
export function connectRobotBridgeDevice(core: RobotCore, options: DeviceConnectionOptions) {
  const url = normalizeRobotBridgeDeviceUrl(options.url);
  if (!/^[a-f0-9]{32,128}$/i.test(options.token)) throw new Error("Robot bridge token must contain 32–128 hexadecimal characters");
  const socket: Socket = (options.createSocket ?? ((address, protocols) => new WebSocket(address, protocols)))(url, ["looi-bridge-v1", `bearer.${options.token}`]) as unknown as Socket;
  let gateway: ReturnType<typeof createRobotGateway> | null = null;
  let clientId: string | null = null;
  let controlProtocol: RobotProtocol | null = null;
  let peer: RobotWebRtcPeer | null = null;
  let peerSessionId: string | null = null;
  let peerGeneration = 0;
  let pendingSignals: unknown[] = [];
  let signalQueue: Promise<unknown> = Promise.resolve();
  let lastInbound = Date.now();
  let disposed = false;
  let generation = 0;
  const send = (value: unknown) => { if (!disposed && socket.readyState === 1) socket.send(JSON.stringify(value)); };
  const createReachyMedia = (isCurrent: () => boolean): RobotAppMediaServices | undefined => {
    if (!options.mediaCommand) return undefined;
    const getGain = async (device: RobotAudioGainDevice): Promise<RobotAudioGainStatus> => {
      if (!isCurrent()) throw new Error("Reachy app media session has ended");
      if (options.media?.[device] !== true) throw new Error(`Robot app ${device} is not enabled for this session`);
      const result = await options.mediaCommand!({ action: "get-volume", device });
      if (!isCurrent()) throw new Error("Reachy app media session has ended");
      if (!isAudioGainStatus(result)) throw new Error("Robot app audio returned an invalid gain status");
      return result;
    };
    const setGain = async (device: RobotAudioGainDevice, percent: number): Promise<RobotAudioGainStatus> => {
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new TypeError("volume must be an integer from 0 to 100");
      if (!isCurrent()) throw new Error("Reachy app media session has ended");
      if (options.media?.[device] !== true) throw new Error(`Robot app ${device} is not enabled for this session`);
      const result = await options.mediaCommand!({ action: "set-volume", device, value: percent });
      if (!isCurrent()) throw new Error("Reachy app media session has ended");
      if (!isAudioGainStatus(result)) throw new Error("Robot app audio returned an invalid gain status");
      return result;
    };
    return {
      videoInfo: () => UNAVAILABLE_VIDEO,
      audio: { getGain, setGain },
      // This companion currently exposes only the phone's configured gain
      // command. Keep sound playback an explicit refusal instead of claiming
      // that an unconfigured local audio player accepted it.
      sound: {
        async play() { return { accepted: false, reason: "Reachy sound playback is unavailable through this companion session" }; },
        async stop() {},
      },
      async stop() {},
      async close() {},
    };
  };
  const rejectExpiredCommand = (owner: string, requestId: unknown, message: string) => {
    // A command that missed its source lease must also stop any earlier bounded motion.
    try { void Promise.resolve(core.stop("bridge-command-expired")).catch(() => undefined); } catch { /* preserve the routable rejection */ }
    send({ type: "error", clientId: owner, requestId, message });
  };
  function closePeer(reason: string): Promise<void> {
    peerGeneration += 1;
    const old = peer, sessionId = peerSessionId;
    peer = null; peerSessionId = null; pendingSignals = [];
    const closing = Promise.resolve(old?.close(reason));
    return closing.finally(() => { if (sessionId) send({ type: "webrtc-closed", sessionId, reason }); });
  }

  function openPeer(input: Record<string, unknown>): void {
    if (!options.createPeer || peerSessionId || typeof input.sessionId !== "string" || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(input.sessionId)
      || !["reachy", "microduck"].includes(String(input.protocol))) {
      send({ type: "webrtc-error", sessionId: input.sessionId, message: "WebRTC is busy or unavailable" }); return;
    }
    const protocol = input.protocol as RobotProtocol, sessionId = input.sessionId;
    const attachment = typeof input.controlClientId === "string" ? input.controlClientId : null;
    if (gateway && (attachment !== clientId || protocol !== controlProtocol)) {
      send({ type: "webrtc-error", sessionId, message: "Robot is owned by another app" }); return;
    }
    if (attachment && !gateway) {
      send({ type: "webrtc-error", sessionId, message: "Control session is no longer available" }); return;
    }
    const allowed = options.media;
    const requested = input.media && typeof input.media === "object" ? input.media as Record<string, unknown> : {};
    const media: RobotMediaRequest = {
      camera: allowed?.camera === true && requested.camera !== false,
      microphone: allowed?.microphone === true && requested.microphone !== false,
      speaker: allowed?.speaker === true && requested.speaker !== false,
      cameraFacing: allowed?.cameraFacing ?? "environment",
    };
    let iceServers: Array<Record<string, unknown>> | undefined;
    try { iceServers = readIceServers(input.iceServers); }
    catch { send({ type: "webrtc-error", sessionId, message: "Invalid ICE configuration" }); return; }
    const turn = ++peerGeneration;
    peerSessionId = sessionId; pendingSignals = [];
    const current = () => !disposed && peerGeneration === turn && peerSessionId === sessionId;
    const closed = (reason: string) => {
      if (!current()) return;
      peer = null; peerSessionId = null; pendingSignals = []; peerGeneration += 1;
      send({ type: "webrtc-closed", sessionId, reason });
    };
    void Promise.resolve().then(() => options.createPeer!({ protocol, sessionId, iceServers,
      remotePeerId: typeof input.remotePeerId === "string" ? input.remotePeerId : undefined,
      media,
      sendSignal: message => { if (current()) send(message); },
      onClosed: closed,
      openGateway: () => {
        if (!current()) throw new Error("WebRTC session is closed");
        if (gateway) {
          if (attachment !== clientId || protocol !== controlProtocol) throw new Error("Robot is owned by another app");
          const borrowed = gateway;
          return { ...borrowed, close: () => core.stop("bridge-media-disconnected") };
        }
        if (attachment) throw new Error("Control session is closed");
        const ownerGeneration = generation;
        let owned: ReturnType<typeof createRobotGateway> | null = null;
        const appMedia = protocol === "reachy"
          ? createReachyMedia(() => current() && generation === ownerGeneration && gateway === owned)
          : undefined;
        const created = createRobotGateway(core, { protocol, sessionId: `rtc:${sessionId}`, allowApproximation: options.allowApproximation, media: appMedia });
        owned = created;
        gateway = created; clientId = `rtc:${sessionId}`; controlProtocol = protocol;
        return { ...created, async close() {
          if (owned && gateway === owned) { gateway = null; clientId = null; controlProtocol = null; }
          await created.close();
        } };
      },
    })).then(async (created) => {
      if (!current()) { await created.close("stale-peer-start"); return; }
      peer = created;
      const offer = requested.offer && typeof requested.offer === "object" ? requested.offer as { type: "offer"; sdp: string } : undefined;
      await created.start({ initiator: requested.initiator !== false, ...(offer ? { offer } : {}) });
      if (!current()) { await created.close("stale-peer-start"); return; }
      send({ type: "webrtc-opened", sessionId, media, snapshot: core.inspect() });
      const signals = pendingSignals; pendingSignals = [];
      for (const signal of signals) { if (current()) await created.handleSignal(signal); }
    }).catch(() => {
      if (!current()) return;
      send({ type: "webrtc-error", sessionId, message: "Camera/audio or WebRTC negotiation failed" });
      void closePeer("peer-start-failed").catch(() => undefined);
    });
  }
  async function close() {
    if (disposed) return;
    disposed = true; generation += 1;
    clearInterval(timer);
    const peerClosing = closePeer("bridge-device-disconnected");
    const old = gateway; gateway = null; clientId = null; controlProtocol = null;
    try { socket.close(); } catch { /* teardown must still stop the controller */ }
    await Promise.all([peerClosing, old?.close(), core.stop("bridge-device-disconnected")]);
  }
  socket.onopen = () => {
    lastInbound = Date.now();
    send({ type: "ready", clockMs: performance.now(), media: options.media ?? { camera: false, microphone: false, speaker: false }, mediaStatus: options.mediaStatus, snapshot: core.inspect() });
    if (options.central) send({ type: "central-config", config: options.central });
    options.onStatus?.("connected");
  };
  socket.onclose = () => { if (!disposed) options.onStatus?.("error", "Companion connection closed"); void close().catch(() => undefined); };
  socket.onerror = () => { if (!disposed) options.onStatus?.("error", "Companion connection failed"); void close().catch(() => undefined); };
  socket.onmessage = (event) => {
    if (disposed || typeof event.data !== "string" || event.data.length > 262_144) return;
    lastInbound = Date.now();
    let input: Record<string, unknown>;
    try { input = JSON.parse(event.data); if (!input || typeof input !== "object" || Array.isArray(input)) return; } catch { return; }
    if (input.type === "ping") { send({ type: "pong", clockMs: performance.now(), snapshot: core.inspect() }); return; }
    if (input.type === "media-command") {
      const command = input.command as Record<string, unknown> | undefined;
      if (!options.mediaCommand || !command || !["get-volume", "set-volume"].includes(String(command.action))
        || !["speaker", "microphone"].includes(String(command.device))
        || (command.action === "set-volume" && (typeof command.value !== "number" || !Number.isFinite(command.value) || command.value < 0 || command.value > 100))) {
        send({ type: "media-reply", requestId: input.requestId, error: "Audio control is invalid or unavailable" }); return;
      }
      const turn = generation;
      void Promise.resolve().then(() => options.mediaCommand!(command as { action: "get-volume" | "set-volume"; device: "speaker" | "microphone"; value?: number }))
        .then(result => { if (!disposed && generation === turn) send({ type: "media-reply", requestId: input.requestId, result }); })
        .catch(() => { if (!disposed && generation === turn) send({ type: "media-reply", requestId: input.requestId, error: "Audio device is not enabled or available" }); });
      return;
    }
    if (input.type === "webrtc-open") { openPeer(input); return; }
    if (input.type === "webrtc-close" && input.sessionId === peerSessionId) { void closePeer("remote-session-ended").catch(() => undefined); return; }
    if (input.type === "signal" && input.sessionId === peerSessionId) {
      if (!peer) {
        if (pendingSignals.length >= 64) { void closePeer("signal-buffer-overflow").catch(() => undefined); return; }
        pendingSignals.push(input.signal);
      } else {
        const currentPeer = peer, turn = peerGeneration;
        signalQueue = signalQueue.then(async () => { if (!disposed && currentPeer === peer && turn === peerGeneration) await currentPeer.handleSignal(input.signal); })
          .catch(() => { if (currentPeer === peer) void closePeer("invalid-peer-signal").catch(() => undefined); });
      }
      return;
    }
    if (input.type === "open") {
      if (gateway || peerSessionId || typeof input.clientId !== "string" || !["reachy", "microduck"].includes(String(input.protocol))) {
        send({ type: "error", clientId: input.clientId, requestId: input.requestId, message: "Bridge is busy or open request is invalid" }); return;
      }
      try {
        const owner = input.clientId;
        const ownerGeneration = generation;
        let owned: ReturnType<typeof createRobotGateway> | null = null;
        const appMedia = input.protocol === "reachy"
          ? createReachyMedia(() => !disposed && generation === ownerGeneration && gateway === owned && clientId === owner && controlProtocol === "reachy")
          : undefined;
        const created = createRobotGateway(core, { protocol: input.protocol as RobotProtocol, sessionId: owner,
          allowApproximation: options.allowApproximation === true, media: appMedia });
        owned = created;
        gateway = created;
        clientId = input.clientId;
        controlProtocol = input.protocol as RobotProtocol;
        send({ type: "opened", clientId, messages: gateway.initialMessages(), snapshot: core.inspect() });
      } catch (error) { send({ type: "error", clientId: input.clientId, message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (input.type === "close" && input.clientId === clientId) {
      generation += 1;
      void closePeer("control-session-ended").catch(() => undefined);
      const old = gateway; gateway = null; clientId = null; controlProtocol = null;
      void old?.close().catch(() => undefined);
      return;
    }
    if (input.type !== "command" || !gateway || typeof clientId !== "string" || input.clientId !== clientId) return;
    const current = gateway, epoch = generation, owner = clientId;
    // No queue or replay: stale app packets retain their source sequence and bounded lifetime.
    const ttl = input.ttlMs;
    if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > 5_000) {
      rejectExpiredCommand(owner, input.requestId, "Invalid command lifetime"); return;
    }
    if (input.sequence !== undefined && (typeof input.sequence !== "number" || !Number.isSafeInteger(input.sequence) || input.sequence < 0)) {
      send({ type: "error", clientId: owner, requestId: input.requestId, message: "Invalid command sequence" }); return;
    }
    const now = performance.now();
    const expiry = input.expiresAtDeviceMs;
    if (typeof expiry !== "number" || !Number.isFinite(expiry) || !Number.isFinite(now)) {
      rejectExpiredCommand(owner, input.requestId, "Missing or invalid command expiry"); return;
    }
    const remaining = Math.floor(expiry - now);
    if (remaining < 1 || remaining > ttl) {
      rejectExpiredCommand(owner, input.requestId, "Command expired before reaching the device"); return;
    }
    void current.handleMessage(input.payload, { ttlMs: Math.min(ttl, remaining),
      ...(typeof input.sequence === "number" ? { sequence: input.sequence } : {}) })
      .then((messages) => { if (!disposed && gateway === current && generation === epoch) send({ type: "reply", clientId: owner, requestId: input.requestId, messages, snapshot: core.inspect() }); })
      .catch((error) => { if (!disposed && gateway === current && generation === epoch) send({ type: "error", clientId: owner, requestId: input.requestId, message: error instanceof Error ? error.message : String(error) }); });
  };
  const timer = setInterval(() => {
    if (Date.now() - lastInbound > 3_000) { void close().catch(() => undefined); return; }
    if (gateway) send({ type: "state", clientId, messages: gateway.stateMessages(), snapshot: core.inspect() });
  }, 100);
  return { close, publishMediaStatus: (mediaStatus: RobotMediaStatus) => send({ type: "media-status", mediaStatus, snapshot: core.inspect() }),
    get sessionPending() { return !disposed && (gateway !== null || peerSessionId !== null); },
    get connected() { return !disposed && socket.readyState === 1; } };
}
