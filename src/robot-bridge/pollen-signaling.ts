import type { RobotGatewayProtocol, RobotProtocol } from "./gateway";

export const DEFAULT_POLLEN_CENTRAL_URL = "https://pollen-robotics-reachy-mini-central.hf.space";

export type PollenPeerEvent = {
  type: "peer";
  sessionId: string;
  sdp?: { type: "offer" | "answer"; sdp: string };
  ice?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
  /** Central also relays control-only JSON-RPC calls without a WebRTC data channel. */
  rpc?: Record<string, unknown>;
};

export type PollenSessionContext = { transport: "pollen" | "local"; remotePeerId?: string; direction?: "remote-to-phone" };
export type PollenSessionCallbacks = {
  openSession: (input: { protocol: RobotGatewayProtocol; sessionId: string; remotePeerId: string; transport: "pollen" | "local" }) => Promise<unknown> | unknown;
  signal: (sessionId: string, event: PollenPeerEvent, context: PollenSessionContext) => Promise<void> | void;
  closeSession: (sessionId: string, reason?: string, context?: PollenSessionContext) => Promise<void> | void;
};

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<any>;
type PollenClientOptions = PollenSessionCallbacks & {
  centralUrl?: string;
  token: string;
  protocol: RobotGatewayProtocol;
  meta?: Record<string, unknown>;
  fetchImpl?: FetchLike;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  welcomeTimeoutMs?: number;
  sseReadTimeoutMs?: number;
  onError?: (error: Error) => void;
  onState?: (state: { state: "stopped" | "connecting" | "connected" | "reconnecting"; peerId: string | null; sessionId: string | null; reconnectAttempt: number }) => void;
};

const MAX_SESSION_ID_LENGTH = 160;
const MAX_PEER_RPC_BYTES = 256 * 1024;
const MAX_SSE_EVENT_BYTES = MAX_PEER_RPC_BYTES + 4 * 1024;
const MAX_SSE_BUFFER_BYTES = MAX_SSE_EVENT_BYTES * 2;
const MAX_PENDING_RPC = 32;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function encodedByteLength(value: string): number {
  // Match the WebRTC app-message bound without depending on Buffer in React Native.
  return unescape(encodeURIComponent(value)).length;
}

function isBoundedRpc(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return encodedByteLength(JSON.stringify(value)) <= MAX_PEER_RPC_BYTES;
  } catch {
    return false;
  }
}

function makeMeta(protocol: RobotGatewayProtocol, meta?: Record<string, unknown>): Record<string, unknown> {
  if (protocol === "universal") {
    return {
      session_liveness: "peer",
      ...(meta ?? {}),
      kind: "microduck",
      name: "LOOI",
      supported_protocols: ["reachy", "microduck"],
      robot_family: "looi",
    };
  }
  const defaults = protocol === "microduck" ? { kind: "microduck", name: "LOOI", session_liveness: "peer" } : { name: "LOOI", session_liveness: "peer" };
  const supplied = meta ?? {};
  return protocol === "microduck" ? { ...defaults, ...supplied, kind: "microduck" } : { ...defaults, ...supplied };
}

function safeCentralUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Invalid Pollen Central URL"); }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new TypeError("Pollen Central requires HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new TypeError("Pollen Central URL cannot contain credentials, query or fragment");
  return url.toString().replace(/\/$/, "");
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  if (!frame.trim()) return null;
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

async function* readSse(response: any, timeoutMs: number, active: () => boolean): AsyncGenerator<{ event: string; data: string }> {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") throw new Error("Pollen Central response has no readable SSE stream");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let bytes = 0;
  let streamEnded = false;
  try {
    while (active()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedRead = Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Pollen Central SSE read timed out")), timeoutMs); }),
      ]);
      let item: { done: boolean; value?: Uint8Array };
      try { item = await timedRead; } finally { if (timer) clearTimeout(timer); }
      if (item.done) { streamEnded = true; break; }
      const chunk = decoder.decode(item.value ?? new Uint8Array(), { stream: true });
      bytes += encodedByteLength(chunk);
      if (bytes > MAX_SSE_BUFFER_BYTES) throw new Error("Pollen Central SSE buffer exceeded its limit");
      buffer += chunk;
      let split = buffer.search(/\r?\n\r?\n/);
      while (split >= 0) {
        const frame = buffer.slice(0, split);
        const separator = buffer.slice(split).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        buffer = buffer.slice(split + separator.length);
        bytes = encodedByteLength(buffer);
        if (encodedByteLength(frame) > MAX_SSE_EVENT_BYTES) throw new Error("Pollen Central SSE event exceeded its limit");
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
        split = buffer.search(/\r?\n\r?\n/);
      }
    }
    const tail = parseSseFrame(buffer + decoder.decode());
    if (tail) yield tail;
  } finally {
    const releaseLock = () => { try { reader.releaseLock?.(); } catch { /* stream still settling */ } };
    if (!streamEnded && typeof reader.cancel === "function") {
      try {
        // Cancel the stream without awaiting its source's cleanup: a pending
        // native fetch read must not hold reconnect/shutdown open indefinitely.
        void Promise.resolve(reader.cancel()).catch(() => undefined).finally(releaseLock);
      } catch { releaseLock(); }
    } else {
      releaseLock();
    }
  }
}

function heartbeatInterval(message: Record<string, any>): number {
  const recommended = Number(message.recommended_heartbeat_interval_seconds);
  const lease = Number(message.lease_seconds);
  const seconds = Number.isFinite(recommended) && recommended > 0 ? recommended : Number.isFinite(lease) && lease > 0 ? lease / 3 : 5;
  return Math.max(1000, Math.min(60_000, seconds * 1000));
}

/**
 * Implements the pinned Pollen Central protocol: authenticated GET /events
 * (SSE), then authenticated POST /send setPeerStatus/peer/endSession. The
 * bearer token is never put into a URL or handed to app data channels.
 */
export function createPollenCentralClient(options: PollenClientOptions) {
  if (typeof options.token !== "string" || options.token.trim().length < 8) throw new TypeError("A Pollen Central bearer token is required");
  if (options.protocol !== "reachy" && options.protocol !== "microduck" && options.protocol !== "universal") throw new TypeError("Unsupported Pollen protocol");
  const baseUrl = safeCentralUrl(options.centralUrl ?? DEFAULT_POLLEN_CENTRAL_URL);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable for Pollen Central");
  const producerMeta = makeMeta(options.protocol, options.meta);
  const reconnectMinMs = Math.max(100, Math.min(30_000, options.reconnectMinMs ?? 1000));
  const reconnectMaxMs = Math.max(reconnectMinMs, Math.min(120_000, options.reconnectMaxMs ?? 30_000));
  const welcomeTimeoutMs = Math.max(500, options.welcomeTimeoutMs ?? 15_000);
  const sseReadTimeoutMs = Math.max(1000, options.sseReadTimeoutMs ?? 60_000);
  let state: "stopped" | "connecting" | "connected" | "reconnecting" = "stopped";
  let running = false;
  let runPromise: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let peerId: string | null = null;
  let activeSession: { sessionId: string; remotePeerId: string; rpcController: AbortController; pendingRpcCount: number } | null = null;
  let reconnectAttempt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let sendQueue: Promise<void> = Promise.resolve();
  let heartbeatIntervalMs = 5000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeReconnect: (() => void) | null = null;

  const publish = () => {
    try { options.onState?.({ state, peerId, sessionId: activeSession?.sessionId ?? null, reconnectAttempt }); } catch { /* observer cannot alter relay */ }
  };
  const setState = (next: typeof state) => { state = next; publish(); };
  const authHeaders = (json = false) => ({ Authorization: `Bearer ${options.token}`, ...(json ? { "Content-Type": "application/json" } : {}) });

  async function post(message: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const operation = sendQueue.then(async () => {
      const response = await fetchImpl(`${baseUrl}/send`, {
        method: "POST", headers: authHeaders(true), body: JSON.stringify(message), signal, redirect: "manual",
      });
      if (!response?.ok || response.status !== 200) throw new Error(`Pollen Central /send returned HTTP ${response?.status ?? "unknown"}`);
    });
    sendQueue = operation.catch(() => undefined);
    return operation;
  }

  const producerStatus = () => ({ type: "setPeerStatus", roles: ["producer"], meta: { ...producerMeta, session_active: activeSession !== null } });
  const reportError = (error: unknown) => {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* diagnostics cannot own reconnection */ }
  };

  async function closeActive(reason: string, context: PollenSessionContext = { transport: "pollen" }) {
    const active = activeSession;
    if (!active) return;
    activeSession = null;
    active.rpcController.abort();
    publish();
    try { await options.closeSession(active.sessionId, reason, context); } catch { /* phone disconnect cleanup must continue */ }
  }

  function dispatchRpc(
    active: NonNullable<typeof activeSession>,
    event: PollenPeerEvent,
    context: PollenSessionContext,
    requestController: AbortController,
  ) {
    if (!running || controller !== requestController || activeSession !== active || active.rpcController.signal.aborted) return;
    if (active.pendingRpcCount >= MAX_PENDING_RPC) {
      reportError(new Error("Pollen Central peer RPC concurrency limit exceeded"));
      return;
    }

    active.pendingRpcCount += 1;
    const abort = active.rpcController.signal;
    let removeAbortListener: () => void = () => {};
    const cancelled = new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      if (abort.aborted) onAbort();
      else {
        abort.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => abort.removeEventListener("abort", onAbort);
      }
    });
    const operation = Promise.resolve().then(() => {
      if (!running || controller !== requestController || activeSession !== active || abort.aborted) return;
      return options.signal(active.sessionId, event, context);
    }).then(
      () => undefined,
      (error) => {
        if (!abort.aborted && running && controller === requestController && activeSession === active) reportError(error);
      },
    );
    void Promise.race([operation, cancelled]).finally(() => {
      removeAbortListener();
      active.pendingRpcCount = Math.max(0, active.pendingRpcCount - 1);
    });
  }

  async function processMessage(input: unknown, eventName: string, requestController: AbortController) {
    if (!isRecord(input)) return;
    const message = input.type ? input : { ...input, type: eventName };
    switch (message.type) {
      case "welcome": {
        if (!validId(message.peerId)) throw new Error("Pollen Central welcome omitted a valid peerId");
        peerId = message.peerId;
        heartbeatIntervalMs = heartbeatInterval(message);
        await post(producerStatus(), requestController.signal);
        setState("connected");
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (!running || controller !== requestController) return;
          void post(producerStatus(), requestController.signal).catch(() => requestController.abort());
        }, heartbeatIntervalMs);
        break;
      }
      case "startSession": {
        if (!validId(message.sessionId) || !validId(message.peerId)) return;
        if (activeSession) {
          await post({ type: "endSession", sessionId: message.sessionId, reason: "robot_busy_local" }, requestController.signal);
          return;
        }
        const active = {
          sessionId: message.sessionId,
          remotePeerId: message.peerId,
          rpcController: new AbortController(),
          pendingRpcCount: 0,
        };
        activeSession = active;
        publish();
        try {
          await options.openSession({ protocol: options.protocol, sessionId: active.sessionId, remotePeerId: active.remotePeerId, transport: "pollen" });
        } catch (error) {
          if (activeSession === active) {
            activeSession = null;
            active.rpcController.abort();
          }
          publish();
          await post({ type: "endSession", sessionId: active.sessionId, reason: "robot_unavailable" }, requestController.signal).catch(() => undefined);
          reportError(error);
        }
        break;
      }
      case "peer": {
        const active = activeSession;
        if (!active || message.sessionId !== active.sessionId) return;
        // Central does not add the sender id to `peer` events, but if an id is present it must
        // match the peer captured from startSession. The active session also binds the callback
        // context to that same remote peer in Native Central.
        if (message.peerId !== undefined && message.peerId !== active.remotePeerId) return;
        const event: PollenPeerEvent = { type: "peer", sessionId: active.sessionId };
        if (message.sdp !== undefined) {
          if (!isRecord(message.sdp) || (message.sdp.type !== "offer" && message.sdp.type !== "answer") || typeof message.sdp.sdp !== "string") return;
          event.sdp = { type: message.sdp.type, sdp: message.sdp.sdp };
        }
        if (message.ice !== undefined) {
          if (!isRecord(message.ice) || typeof message.ice.candidate !== "string") return;
          event.ice = { candidate: message.ice.candidate, sdpMid: message.ice.sdpMid ?? null, sdpMLineIndex: message.ice.sdpMLineIndex ?? null };
        }
        if (message.rpc !== undefined) {
          if (!isBoundedRpc(message.rpc)) return;
          event.rpc = message.rpc;
        }
        if (event.sdp === undefined && event.ice === undefined && event.rpc === undefined) return;
        const context: PollenSessionContext = {
          transport: "pollen",
          remotePeerId: active.remotePeerId,
          direction: "remote-to-phone",
        };
        if (event.rpc !== undefined && event.sdp === undefined && event.ice === undefined) {
          // Control calls may await robot movement/audio. Do not hold the SSE pump behind one:
          // endSession and other cleanup messages must still be able to reach the core promptly.
          dispatchRpc(active, event, context, requestController);
        } else {
          await options.signal(active.sessionId, event, context);
        }
        break;
      }
      case "endSession": {
        if (activeSession && message.sessionId === activeSession.sessionId) await closeActive(typeof message.reason === "string" ? message.reason : "central-ended-session");
        break;
      }
      default:
        break;
    }
  }

  async function connectOnce() {
    const requestController = new AbortController();
    controller = requestController;
    let welcomed = false;
    const timeout = setTimeout(() => { if (!welcomed) requestController.abort(); }, welcomeTimeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/events`, { method: "GET", headers: { ...authHeaders(), Accept: "text/event-stream" }, signal: requestController.signal, redirect: "manual" });
      if (!response?.ok || response.status !== 200) throw new Error(`Pollen Central /events returned HTTP ${response?.status ?? "unknown"}`);
      for await (const frame of readSse(response, sseReadTimeoutMs, () => running && !requestController.signal.aborted)) {
        let message: unknown;
        try { message = JSON.parse(frame.data); } catch { continue; }
        const effectiveType = isRecord(message) && typeof message.type === "string" ? message.type : frame.event;
        if (effectiveType === "welcome") welcomed = true;
        await processMessage(message, frame.event, requestController);
      }
    } finally {
      clearTimeout(timeout);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      // Expo's stream reader cancellation stops JS delivery but does not stop
      // the native HTTP task. Abort the request while its controller is still
      // published, so every ended stream/error path releases the transport
      // before the reconnect loop can start another request.
      requestController.abort();
      if (controller === requestController) controller = null;
      peerId = null;
      await closeActive("central-disconnected");
    }
    if (running && !requestController.signal.aborted) throw new Error("Pollen Central SSE ended");
  }

  async function run() {
    while (running) {
      setState(reconnectAttempt === 0 ? "connecting" : "reconnecting");
      try {
        await connectOnce();
        reconnectAttempt = 0;
      } catch (error) {
        if (!running) break;
        reportError(error);
        await closeActive("central-disconnected");
      }
      if (!running) break;
      const wait = Math.min(reconnectMaxMs, reconnectMinMs * 2 ** Math.min(reconnectAttempt, 8));
      reconnectAttempt += 1;
      publish();
      await new Promise<void>((resolve) => {
        const finish = () => {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = null;
          wakeReconnect = null;
          resolve();
        };
        reconnectTimer = setTimeout(finish, wait);
        wakeReconnect = finish;
        if (!running) finish();
      });
    }
    setState("stopped");
  }

  return {
    async start() {
      if (running) return;
      running = true;
      reconnectAttempt = 0;
      runPromise = run();
      // The relay runs in the background; startup must not wait for a network
      // credential or transient vendor outage.
      await Promise.resolve();
    },

    async handleDeviceSignal(message: unknown) {
      if (!isRecord(message)) return false;
      if (message.type === "webrtc-close") {
        if (activeSession && message.sessionId === activeSession.sessionId) {
          const active = activeSession;
          activeSession = null;
          publish();
          if (state === "connected") await post({ type: "endSession", sessionId: active.sessionId, reason: typeof message.reason === "string" ? message.reason : "robot-disconnected" }, controller?.signal);
          return true;
        }
        return false;
      }
      if (message.type !== "signal" || !isRecord(message.signal) || message.signal.type !== "peer") return false;
      const active = activeSession;
      if (!active || message.sessionId !== active.sessionId || message.signal.sessionId !== active.sessionId || state !== "connected") return false;
      const outgoing: Record<string, unknown> = { type: "peer", sessionId: active.sessionId };
      if (message.signal.sdp !== undefined) outgoing.sdp = message.signal.sdp;
      if (message.signal.ice !== undefined) outgoing.ice = message.signal.ice;
      if (message.signal.rpc !== undefined) {
        if (!isBoundedRpc(message.signal.rpc)) return false;
        outgoing.rpc = message.signal.rpc;
      }
      if (outgoing.sdp === undefined && outgoing.ice === undefined && outgoing.rpc === undefined) return false;
      await post(outgoing, controller?.signal);
      return true;
    },

    async stop(reason = "relay-stopped") {
      if (!running && !runPromise) return;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      const active = activeSession;
      if (active && state === "connected") {
        const bounded = new AbortController();
        const timeout = setTimeout(() => bounded.abort(), 1500);
        try {
          await Promise.race([
            post({ type: "endSession", sessionId: active.sessionId, reason }, bounded.signal),
            new Promise<void>((resolve) => setTimeout(resolve, 1600)),
          ]);
        } catch { /* bounded notification is best-effort during shutdown */ }
        finally { clearTimeout(timeout); }
      }
      running = false;
      wakeReconnect?.();
      controller?.abort();
      await closeActive(reason);
      await runPromise?.catch(() => undefined);
      runPromise = null;
      peerId = null;
      setState("stopped");
    },

    inspect() { return { state, peerId, sessionId: activeSession?.sessionId ?? null, reconnectAttempt, centralUrl: baseUrl }; },
  };
}

export type GStreamerSocket = {
  readyState?: number;
  send(data: string): void;
  close?: (code?: number, reason?: string) => void;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  on?: (type: string, listener: (...args: any[]) => void) => void;
  onmessage?: ((event: any) => void) | null;
  onclose?: ((event: any) => void) | null;
};

function socketSend(socket: GStreamerSocket, value: unknown) {
  if (socket.readyState !== undefined && socket.readyState !== 1) return;
  socket.send(JSON.stringify(value));
}

function messageText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof (value as any).toString === "function") {
    const text = (value as any).toString();
    return typeof text === "string" ? text : null;
  }
  return null;
}

/**
 * Local Reachy SDK compatible with webrtcsink's signaling WebSocket at
 * ws://localhost:8443. It implements welcome/list/setPeerStatus/startSession,
 * peer and endSession and makes the phone the producer/SDP offerer.
 */
export function createGStreamerSignalingRelay(options: PollenSessionCallbacks & {
  protocol?: RobotProtocol;
  producerId?: string;
  meta?: Record<string, unknown>;
  createSessionId?: () => string;
}) {
  const protocol = options.protocol ?? "reachy";
  const producerId = options.producerId ?? `looi-${Math.random().toString(36).slice(2, 12)}`;
  const producerMeta = makeMeta(protocol, options.meta);
  const sockets = new Set<GStreamerSocket>();
  const sessions = new Map<string, { socket: GStreamerSocket; remotePeerId: string }>();
  const socketPeers = new Map<GStreamerSocket, string>();
  let closed = false;
  let serial = 0;
  const makeSessionId = options.createSessionId ?? (() => `looi-local-${Date.now().toString(36)}-${(++serial).toString(36)}`);

  function forget(sessionId: string) {
    sessions.delete(sessionId);
  }

  async function closeSession(sessionId: string, reason: string, notifyRemote: boolean) {
    const session = sessions.get(sessionId);
    if (!session) return;
    forget(sessionId);
    if (notifyRemote) {
      try { socketSend(session.socket, { type: "endSession", sessionId, ...(reason ? { reason } : {}) }); } catch { /* socket already gone */ }
    }
    try { await options.closeSession(sessionId, reason, { transport: "local" }); } catch { /* stop other sessions regardless */ }
  }

  async function dispatch(socket: GStreamerSocket, raw: unknown) {
    if (closed || !sockets.has(socket)) return;
    const text = messageText(raw);
    if (text === null || text.length > 1_048_576) return;
    let message: unknown;
    try { message = JSON.parse(text); } catch { return; }
    if (!isRecord(message) || typeof message.type !== "string") return;
    const remotePeerId = socketPeers.get(socket)!;
    switch (message.type) {
      case "setPeerStatus": {
        const roles = Array.isArray(message.roles) ? message.roles.filter((role: unknown) => typeof role === "string") : [];
        // Match the GStreamer signaling server's status-change event. The
        // producer identity remains stable for this server lifetime.
        socketSend(socket, { type: "peerStatusChanged", peerId: producerId, roles: ["producer"], meta: producerMeta });
        if (roles.includes("listener")) socketSend(socket, { type: "peerStatusChanged", peerId: remotePeerId, roles: ["listener"], meta: isRecord(message.meta) ? message.meta : {} });
        return;
      }
      case "list":
        socketSend(socket, { type: "list", producers: [{ id: producerId, roles: ["producer"], meta: producerMeta }] });
        return;
      case "startSession": {
        if (message.peerId !== undefined && message.peerId !== producerId) return;
        if (sessions.size > 0) {
          const requested = validId(message.sessionId) ? message.sessionId : `rejected-${++serial}`;
          socketSend(socket, { type: "endSession", sessionId: requested, reason: "robot_busy_local" });
          return;
        }
        const sessionId = makeSessionId();
        if (!validId(sessionId)) return;
        sessions.set(sessionId, { socket, remotePeerId });
        socketSend(socket, { type: "sessionStarted", sessionId });
        try {
          await options.openSession({ protocol, sessionId, remotePeerId, transport: "local" });
        } catch {
          await closeSession(sessionId, "robot_unavailable", true);
        }
        return;
      }
      case "peer": {
        if (!validId(message.sessionId) || typeof message.sessionId !== "string") return;
        const session = sessions.get(message.sessionId);
        if (!session || session.socket !== socket) return;
        const event: PollenPeerEvent = { type: "peer", sessionId: message.sessionId };
        if (message.sdp !== undefined) {
          if (!isRecord(message.sdp) || (message.sdp.type !== "offer" && message.sdp.type !== "answer") || typeof message.sdp.sdp !== "string") return;
          event.sdp = { type: message.sdp.type, sdp: message.sdp.sdp };
        }
        if (message.ice !== undefined) {
          if (!isRecord(message.ice) || typeof message.ice.candidate !== "string") return;
          event.ice = { candidate: message.ice.candidate, sdpMid: message.ice.sdpMid ?? null, sdpMLineIndex: message.ice.sdpMLineIndex ?? null };
        }
        await options.signal(message.sessionId, event, { transport: "local", remotePeerId: session.remotePeerId, direction: "remote-to-phone" });
        return;
      }
      case "endSession":
        if (validId(message.sessionId)) await closeSession(message.sessionId, typeof message.reason === "string" ? message.reason : "local-app-ended", false);
        return;
      default:
        return;
    }
  }

  return {
    handleConnection(socket: GStreamerSocket) {
      if (closed) throw new Error("GStreamer signaling relay is closed");
      const remotePeerId = `client-${Math.random().toString(36).slice(2, 12)}`;
      sockets.add(socket);
      socketPeers.set(socket, remotePeerId);
      socketSend(socket, { type: "welcome", peerId: remotePeerId });
      if (socket.addEventListener) {
        socket.addEventListener("message", (event: any) => { void dispatch(socket, event?.data); });
        socket.addEventListener("close", () => { void disconnect(socket); });
      } else if (socket.on) {
        socket.on("message", (data: unknown) => { void dispatch(socket, data); });
        socket.on("close", () => { void disconnect(socket); });
      } else {
        socket.onmessage = (event: any) => { void dispatch(socket, event?.data); };
        socket.onclose = () => { void disconnect(socket); };
      }
      return { peerId: remotePeerId, close: (reason = "socket-closed") => disconnect(socket, reason) };
    },

    async handleDeviceSignal(sessionId: string, event: unknown) {
      const session = sessions.get(sessionId);
      if (!session || !isRecord(event) || event.type !== "peer") return false;
      const message: Record<string, unknown> = { type: "peer", sessionId };
      if (event.sdp !== undefined) message.sdp = event.sdp;
      if (event.ice !== undefined) message.ice = event.ice;
      socketSend(session.socket, message);
      return true;
    },

    async handleDeviceClose(sessionId: string, reason = "robot-disconnected") {
      await closeSession(sessionId, reason, true);
    },

    async close(reason = "relay-stopped") {
      if (closed) return;
      closed = true;
      const ids = [...sessions.keys()];
      for (const sessionId of ids) await closeSession(sessionId, reason, true);
      for (const socket of sockets) { try { socket.close?.(1001, reason); } catch { /* disconnected */ } }
      sockets.clear();
      socketPeers.clear();
    },

    inspect() { return { producerId, protocol, connectedClients: sockets.size, activeSessions: [...sessions.keys()] }; },
  };

  async function disconnect(socket: GStreamerSocket, reason = "local-client-disconnected") {
    if (!sockets.delete(socket)) return;
    socketPeers.delete(socket);
    for (const [sessionId, session] of [...sessions]) if (session.socket === socket) await closeSession(sessionId, reason, false);
  }
}
