import { createPollenCentralClient, DEFAULT_POLLEN_CENTRAL_URL } from "./pollen-signaling";
import type { RobotGatewayProtocol, RobotProtocol } from "./gateway";
import type { RobotMediaRequest } from "./media-broker";
import type { RobotGateway, RobotWebRtcPeer, RobotWebRtcPeerOptions } from "./webrtc-peer";

export type NativeCentralClientStatus = {
  state: "stopped" | "connecting" | "connected" | "reconnecting";
  peerId: string | null;
  sessionId: string | null;
  reconnectAttempt: number;
  centralUrl: string;
};

export type NativeCentralConfig = {
  url: string;
  token: string;
  robotName: string;
  protocols: RobotProtocol[];
};

export type NativeCentralPeerInput = Omit<RobotWebRtcPeerOptions, "createPeerConnection" | "mediaBroker">;

export type NativeCentralHostOptions = {
  /** The token is used only by the authenticated Pollen SSE/HTTP client. */
  config: NativeCentralConfig;
  /** Explicit user consent for the phone's media devices. */
  media: RobotMediaRequest;
  fetchImpl?: (input: string, init?: Record<string, unknown>) => Promise<any>;
  /** Inject the native RTCPeerConnection and media broker through the app runtime. */
  createPeer: (options: NativeCentralPeerInput) => Promise<RobotWebRtcPeer> | RobotWebRtcPeer;
  /** Return a session-scoped adapter over the shared robot core. */
  openGateway: (protocol: RobotGatewayProtocol, sessionId: string) => Promise<RobotGateway> | RobotGateway;
  iceServers?: Array<Record<string, unknown>>;
  onStatus?: (protocol: RobotGatewayProtocol, status: NativeCentralClientStatus) => void;
  onError?: (protocol: RobotGatewayProtocol, error: Error) => void;
};

export type NativeCentralActiveSession = {
  protocol: RobotGatewayProtocol;
  sessionId: string;
  remotePeerId: string;
  peerState: string;
};

export type NativeCentralHost = {
  start(): Promise<void>;
  stop(reason?: string): Promise<void>;
  inspect(): {
    running: boolean;
    clients: Partial<Record<RobotGatewayProtocol, NativeCentralClientStatus>>;
    active: NativeCentralActiveSession | null;
  };
};

type PollenClient = ReturnType<typeof createPollenCentralClient>;
type PeerOptions = Parameters<NativeCentralHostOptions["createPeer"]>[0];
type PeerFactoryOutcome = { kind: "peer"; peer: RobotWebRtcPeer } | { kind: "error"; error: unknown } | { kind: "invalidated" };
type SessionInput = { protocol: RobotGatewayProtocol; sessionId: string; remotePeerId: string; transport: "pollen" | "local" };
type SessionEntry = {
  protocol: RobotGatewayProtocol;
  sessionId: string;
  remotePeerId: string;
  generation: number;
  peer: RobotWebRtcPeer | null;
  factoryPromise: Promise<RobotWebRtcPeer> | null;
  sessionInvalidated: Promise<void>;
  invalidateSession: (() => void) | null;
  peerClosePromise: Promise<void> | null;
  closeReason: string | null;
  ready: boolean;
  suppressCloseSignal: boolean;
  closedBeforeReady: string | null;
  closePromise: Promise<void> | null;
};

const DEFAULT_ICE_SERVERS = Object.freeze([{ urls: "stun:stun.l.google.com:19302" }]);

function normalizeProtocols(protocols: unknown): RobotProtocol[] {
  if (!Array.isArray(protocols)) throw new TypeError("Pollen Central protocols must be an array");
  const normalized = [...new Set(protocols)];
  if (normalized.length === 0 || normalized.some((protocol) => protocol !== "reachy" && protocol !== "microduck")) {
    throw new TypeError("Pollen Central requires at least one legacy Reachy or MicroDuck protocol entry");
  }
  return normalized as RobotProtocol[];
}

function normalizeConfig(config: NativeCentralConfig): NativeCentralConfig {
  if (!config || typeof config !== "object") throw new TypeError("Pollen Central configuration is required");
  if (typeof config.token !== "string" || config.token.trim().length < 8 || config.token.length > 4096 || /\s/.test(config.token)) {
    throw new TypeError("A valid Pollen Central bearer token is required");
  }
  if (typeof config.robotName !== "string" || !config.robotName.trim() || config.robotName.length > 64 || /[\x00-\x1f]/.test(config.robotName)) {
    throw new TypeError("A valid Pollen robot name is required");
  }

  // createPollenCentralClient performs the stricter URL validation, including
  // HTTPS enforcement and refusing credential-bearing or query URLs.
  return {
    url: typeof config.url === "string" && config.url.trim() ? config.url.trim() : DEFAULT_POLLEN_CENTRAL_URL,
    token: config.token,
    robotName: config.robotName.trim(),
    protocols: normalizeProtocols(config.protocols),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Registers this phone as one universal Pollen producer discoverable by both
 * Reachy and MicroDuck apps. The stored protocol list is validated only for
 * backwards compatibility; one universal gateway handles every app session.
 * The Hugging Face token is retained by this host solely for Central HTTPS
 * requests; it is never included in session data, peer options, or diagnostics.
 */
export function createNativeCentralHost(options: NativeCentralHostOptions): NativeCentralHost {
  if (!options || typeof options.createPeer !== "function" || typeof options.openGateway !== "function") {
    throw new TypeError("Native Central host requires peer and gateway factories");
  }
  const config = normalizeConfig(options.config);
  if (!options.media || [options.media.camera, options.media.microphone, options.media.speaker].some((value) => typeof value !== "boolean")) {
    throw new TypeError("Native Central host requires an explicit media consent request");
  }

  // Central maps a bearer token to one peer ID and one current SSE queue.
  // The legacy protocols array is preserved in config for compatibility, but
  // it never selects an app family: this host always advertises and opens the
  // single universal gateway.
  const activeProtocol: RobotGatewayProtocol = "universal";
  const protocols: RobotGatewayProtocol[] = [activeProtocol];
  const clients: Partial<Record<RobotGatewayProtocol, PollenClient>> = {};
  let active: SessionEntry | null = null;
  let hostGeneration = 0;
  let sessionGeneration = 0;
  let running = false;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const publish = (protocol: RobotGatewayProtocol, status: NativeCentralClientStatus) => {
    try { options.onStatus?.(protocol, status); } catch { /* observers cannot affect Central */ }
  };
  const report = (protocol: RobotGatewayProtocol, error: unknown) => {
    try { options.onError?.(protocol, asError(error)); } catch { /* diagnostics cannot affect relay */ }
  };

  const isCurrent = (entry: SessionEntry) => active === entry && running;

  function inspectActive(): NativeCentralActiveSession | null {
    if (!active) return null;
    let peerState = "creating";
    try { peerState = active.peer?.inspect().state ?? (active.factoryPromise ? "creating" : "starting"); }
    catch { peerState = "unknown"; }
    return {
      protocol: active.protocol,
      sessionId: active.sessionId,
      remotePeerId: active.remotePeerId,
      peerState,
    };
  }

  function closePeerOnce(entry: SessionEntry, peer: RobotWebRtcPeer, reason: string): Promise<void> {
    if (entry.peerClosePromise) return entry.peerClosePromise;
    try {
      entry.peerClosePromise = Promise.resolve(peer.close(reason)).catch((error) => { report(entry.protocol, error); });
    } catch (error) {
      report(entry.protocol, error);
      entry.peerClosePromise = Promise.resolve();
    }
    return entry.peerClosePromise;
  }

  function clearEntry(entry: SessionEntry, reason: string, suppressCloseSignal: boolean): Promise<void> {
    if (active === entry) active = null;
    entry.suppressCloseSignal ||= suppressCloseSignal;
    entry.closeReason ??= reason;
    entry.ready = false;
    entry.invalidateSession?.();
    entry.invalidateSession = null;
    if (entry.closePromise) return entry.closePromise;

    // Calling close() synchronously begins RTCPeerConnection teardown and core
    // STOP before any Central /send or reconnect operation is awaited.
    const peerClose = entry.peer ? closePeerOnce(entry, entry.peer, reason) : Promise.resolve();
    // If factory or peer start is pending, openSession observes invalidation;
    // its late factory result is closed without starting.
    entry.closePromise = peerClose.catch((error) => { report(entry.protocol, error); });
    publishCurrent(entry.protocol);
    return entry.closePromise;
  }

  function publishCurrent(protocol: RobotGatewayProtocol) {
    const status = clients[protocol]?.inspect();
    if (status) publish(protocol, status);
  }

  function peerClosed(entry: SessionEntry, reason: string) {
    if (active !== entry) return;
    active = null;
    entry.invalidateSession?.();
    entry.invalidateSession = null;
    if (!entry.ready) entry.closedBeforeReady = reason;
    publishCurrent(entry.protocol);
    if (entry.ready && !entry.suppressCloseSignal && running) {
      void clients[entry.protocol]?.handleDeviceSignal({ type: "webrtc-close", sessionId: entry.sessionId, reason })
        .catch((error) => report(entry.protocol, error));
    }
  }

  async function openSession(input: SessionInput): Promise<void> {
    if (input.transport !== "pollen") throw new Error("Native Central only accepts Pollen sessions");
    if (!running) return;
    if (active) {
      // Preserve the single native media/core owner if Central delivers an
      // overlapping session before the current one has been closed.
      await clients[input.protocol]?.handleDeviceSignal({
        type: "webrtc-close",
        sessionId: input.sessionId,
        reason: "robot_busy_local",
      });
      return;
    }
    if (input.protocol !== activeProtocol) throw new Error("Pollen requested a protocol that is not active");

    let invalidateSession!: () => void;
    const sessionInvalidated = new Promise<void>((resolve) => { invalidateSession = resolve; });
    const entry: SessionEntry = {
      protocol: input.protocol,
      sessionId: input.sessionId,
      remotePeerId: input.remotePeerId,
      generation: ++sessionGeneration,
      peer: null,
      factoryPromise: null,
      sessionInvalidated,
      invalidateSession,
      peerClosePromise: null,
      closeReason: null,
      ready: false,
      suppressCloseSignal: false,
      closedBeforeReady: null,
      closePromise: null,
    };
    active = entry;
    publishCurrent(entry.protocol);

    const client = clients[entry.protocol];
    if (!client) {
      active = null;
      throw new Error("Universal Pollen Central client is not configured");
    }

    const peerOptions: PeerOptions = {
      protocol: entry.protocol,
      sessionId: entry.sessionId,
      remotePeerId: entry.remotePeerId,
      media: { ...options.media },
      iceServers: (options.iceServers ?? DEFAULT_ICE_SERVERS).map((server) => ({ ...server })),
      openGateway: (protocol, sessionId) => {
        if (!isCurrent(entry)) throw new Error("Pollen session has ended");
        return options.openGateway(protocol, sessionId);
      },
      sendSignal: async (message) => {
        if (!isCurrent(entry)) return;
        await client.handleDeviceSignal(message);
      },
      onError: (error) => report(entry.protocol, error),
      onClosed: (reason) => peerClosed(entry, reason),
    };

    entry.factoryPromise = Promise.resolve().then(() => {
      if (!isCurrent(entry)) throw new Error("Pollen session has ended");
      return options.createPeer(peerOptions);
    });
    try {
      // Pollen's SSE loop awaits this callback. Race the async native factory
      // against session invalidation so stop() can unblock that loop even if
      // a module import or native factory never settles. The factory remains
      // observed: if it resolves later, close the unused peer without starting
      // it; factory failures after invalidation are consumed as well.
      const factoryPromise = entry.factoryPromise;
      if (!factoryPromise) throw new Error("WebRTC peer factory was not started");
      const factoryOutcome: Promise<PeerFactoryOutcome> = factoryPromise.then<PeerFactoryOutcome, PeerFactoryOutcome>(
        (peer) => {
          if (!isCurrent(entry)) {
            return closePeerOnce(entry, peer, entry.closeReason ?? "central-session-ended")
              .then((): PeerFactoryOutcome => ({ kind: "invalidated" }));
          }
          return { kind: "peer", peer };
        },
        (error: unknown): PeerFactoryOutcome => ({ kind: "error", error }),
      );
      const outcome = await Promise.race([
        factoryOutcome,
        sessionInvalidated.then((): PeerFactoryOutcome => ({ kind: "invalidated" })),
      ]);
      if (outcome.kind === "invalidated") return;
      if (outcome.kind === "error") throw outcome.error;
      const peer = outcome.peer;
      entry.peer = peer;
      if (!isCurrent(entry)) {
        await closePeerOnce(entry, peer, entry.closeReason ?? "central-session-ended");
        return;
      }
      // Capture permissions and SDP negotiation may await native work. Keep
      // the Pollen SSE callback cancellable through start, and consume a late
      // rejection if shutdown wins the race.
      const peerStarting = Promise.resolve().then(() => isCurrent(entry) ? peer.start({ initiator: true }) : undefined).then(
        () => ({ kind: "started" as const }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      const startOutcome = await Promise.race([
        peerStarting,
        sessionInvalidated.then(() => ({ kind: "invalidated" as const })),
      ]);
      if (startOutcome.kind === "invalidated") {
        if (entry.closedBeforeReady && running && !entry.suppressCloseSignal) {
          void client.handleDeviceSignal({ type: "webrtc-close", sessionId: entry.sessionId, reason: entry.closedBeforeReady })
            .catch((error) => report(entry.protocol, error));
        }
        return;
      }
      if (startOutcome.kind === "error") throw startOutcome.error;
      if (!isCurrent(entry)) {
        if (entry.closeReason) await closePeerOnce(entry, peer, entry.closeReason);
        if (entry.closedBeforeReady && running && !entry.suppressCloseSignal) {
          void client.handleDeviceSignal({ type: "webrtc-close", sessionId: entry.sessionId, reason: entry.closedBeforeReady })
            .catch((error) => report(entry.protocol, error));
        }
        return;
      }
      entry.ready = true;
      publishCurrent(entry.protocol);
    } catch (error) {
      const shouldRejectToCentral = running && !entry.suppressCloseSignal;
      if (active === entry) await clearEntry(entry, "central-peer-start-failed", true);
      if (shouldRejectToCentral) {
        report(entry.protocol, error);
        throw error;
      }
    }
  }

  async function signalSession(protocol: RobotGatewayProtocol, sessionId: string, remotePeerId: string | undefined, event: unknown): Promise<void> {
    const entry = active;
    if (!entry || entry.protocol !== protocol || entry.sessionId !== sessionId || entry.remotePeerId !== remotePeerId || !entry.peer || !isCurrent(entry)) return;
    const signaling = Promise.resolve().then(() => isCurrent(entry) ? entry.peer!.handleSignal(event) : undefined).then(
      () => ({ kind: "handled" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    const outcome = await Promise.race([
      signaling,
      entry.sessionInvalidated.then(() => ({ kind: "invalidated" as const })),
    ]);
    if (outcome.kind === "error" && isCurrent(entry)) {
      const error = outcome.error;
      report(protocol, error);
      throw error;
    }
  }

  async function closeSession(protocol: RobotGatewayProtocol, sessionId: string, reason = "central-ended-session"): Promise<void> {
    const entry = active;
    if (!entry || entry.protocol !== protocol || entry.sessionId !== sessionId) return;
    await clearEntry(entry, reason, true);
  }

  const meta = { name: config.robotName, session_liveness: "peer" };
  const client = createPollenCentralClient({
    centralUrl: config.url,
    token: config.token,
    protocol: activeProtocol,
    meta,
    fetchImpl: options.fetchImpl,
    openSession,
    signal: (sessionId, event, context) => signalSession(activeProtocol, sessionId, context.remotePeerId, event),
    closeSession: (sessionId, reason) => closeSession(activeProtocol, sessionId, reason),
    onError: (error) => report(activeProtocol, error),
    onState: (status) => publish(activeProtocol, { ...status, centralUrl: config.url }),
  });
  clients[activeProtocol] = client;
  publish(activeProtocol, client.inspect());

  return {
    async start() {
      if (running) return startPromise ?? Promise.resolve();
      if (stopPromise) await stopPromise.catch(() => undefined);
      running = true;
      const generation = ++hostGeneration;
      const starting = (async () => {
        for (const protocol of protocols) {
          if (!running || generation !== hostGeneration) break;
          await clients[protocol]?.start();
        }
      })();
      startPromise = starting;
      try { await starting; } finally { if (startPromise === starting) startPromise = null; }
    },

    stop(reason = "native-central-stopped") {
      if (stopPromise) return stopPromise;
      if (!running && !active) return Promise.resolve();
      running = false;
      hostGeneration += 1;
      const entry = active;
      const localClose = entry ? clearEntry(entry, reason, true) : Promise.resolve();
      // Start all relay stops only after local peer.close() has synchronously
      // closed its channels/PC and scheduled the shared-core STOP.
      const relayStops = protocols.map((protocol) => Promise.resolve(clients[protocol]?.stop(reason)).catch((error) => {
        report(protocol, error);
      }));
      const stopping = Promise.all([localClose, ...relayStops]).then(() => undefined);
      stopPromise = stopping;
      void stopping.finally(() => { if (stopPromise === stopping) stopPromise = null; });
      return stopping;
    },

    inspect() {
      const snapshot: Partial<Record<RobotGatewayProtocol, NativeCentralClientStatus>> = {};
      for (const protocol of protocols) {
        const client = clients[protocol];
        if (client) snapshot[protocol] = client.inspect();
      }
      return { running, clients: snapshot, active: inspectActive() };
    },
  };
}
