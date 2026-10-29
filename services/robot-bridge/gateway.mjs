import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import { createTypeScriptTreeLoader } from "../../scripts/helpers/load-typescript-tree.mjs";
import { createAppCatalog } from "./app-catalog.mjs";
import { createAppRunner } from "./app-runner.mjs";
import { appPortalResponse } from "./app-portal.mjs";
import { handleReachyHttp } from "./reachy-http.mjs";
import { createGStreamerSignalingRelay, createPollenCentralClient, DEFAULT_POLLEN_CENTRAL_URL } from "./pollen-central.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = createTypeScriptTreeLoader();
const { createRobotCore } = load(path.join(root, "src/robot-bridge/core.ts"));
const { createRobotGateway } = load(path.join(root, "src/robot-bridge/gateway.ts"));

function demoCore() {
  return createRobotCore({
    id: "looi-demo-simulation",
    capabilities: {
      schemaVersion: 1,
      locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
      pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
      gestures: ["nod", "curious", "happy_bob"], light: true,
      media: { camera: false, microphone: false, speaker: false, volume: false },
    },
    inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: "simulation-no-hardware" }),
    execute: async (command, context) => context.isCurrent()
      ? { status: "adapted", limitations: ["simulation only; no hardware action"] }
      : { status: "cancelled", limitations: [] },
    stop: async () => {},
  });
}

function tokenMatches(request, expected) {
  const supplied = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization ?? ""))?.[1] ?? "";
  if (!/^[a-f0-9]{32,128}$/i.test(supplied) || supplied.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)); } catch { return false; }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  response.end(JSON.stringify(body));
}

async function readJsonRequest(request, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request body"), { statusCode: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Object.assign(new Error("Request body must be a JSON object"), { statusCode: 400 });
  return parsed;
}

function routePath(request) {
  try { return new URL(request.url, "http://localhost"); } catch { return new URL("http://localhost/"); }
}

function sanitizedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 400);
}

function validateCentralConfig(raw, envToken) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.enabled !== "boolean") throw new Error("Invalid Pollen Central configuration");
  if (!raw.enabled) return { enabled: false, protocols: [] };
  const token = typeof raw.token === "string" && raw.token.length ? raw.token : envToken;
  if (typeof token !== "string" || token.length < 8 || token.length > 4096 || /\s/.test(token)) throw new Error("Pollen Central requires a Hugging Face bearer token");
  const protocols = Array.isArray(raw.protocols) ? [...new Set(raw.protocols)] : ["reachy", "microduck"];
  if (!protocols.length || protocols.some((value) => value !== "reachy" && value !== "microduck")) throw new Error("Invalid Pollen Central protocol selection");
  const requestedUrl = typeof raw.url === "string" && raw.url.length ? raw.url : DEFAULT_POLLEN_CENTRAL_URL;
  if (requestedUrl.length > 2_048) throw new Error("Invalid Pollen Central URL");
  let parsedUrl;
  try { parsedUrl = new URL(requestedUrl); } catch { throw new Error("Invalid Pollen Central URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsedUrl.hostname);
  if ((parsedUrl.protocol !== "https:" && !(loopback && parsedUrl.protocol === "http:"))
    || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) throw new Error("Invalid Pollen Central URL");
  const centralUrl = parsedUrl.toString().replace(/\/$/, "");
  const robotName = typeof raw.robotName === "string" && raw.robotName.trim().length ? raw.robotName.trim().slice(0, 120) : "LOOI";
  return { enabled: true, token, centralUrl, robotName, protocols };
}

const DEFAULT_ICE_SERVERS = Object.freeze([{ urls: "stun:stun.l.google.com:19302" }]);
const APP_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

function validateIceServers(value) {
  let input = value;
  if (typeof input === "string") {
    if (input.length > 8_192) throw new Error("ICE server configuration is too large");
    try { input = JSON.parse(input); } catch { throw new Error("ROBOT_BRIDGE_ICE_SERVERS must be valid JSON"); }
  }
  if (input === undefined || input === null) return DEFAULT_ICE_SERVERS.map((server) => ({ ...server }));
  if (!Array.isArray(input) || input.length > 8) throw new Error("ICE server configuration must be an array of at most eight servers");
  return input.map((server) => {
    if (!server || typeof server !== "object" || Array.isArray(server)) throw new Error("Invalid ICE server entry");
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some((url) => typeof url !== "string" || url.length > 512
      || /[\s\u0000-\u001f]/.test(url) || !/^(?:stun|stuns|turn|turns):[^/?#@]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(url))) {
      throw new Error("ICE URLs must use valid STUN or TURN URLs");
    }
    const needsCredentials = urls.some((url) => /^turns?:/i.test(url));
    const username = server.username;
    const credential = server.credential;
    if ((username !== undefined || credential !== undefined) && (!needsCredentials
      || typeof username !== "string" || !username.length || username.length > 512 || /[\r\n\0]/.test(username)
      || typeof credential !== "string" || !credential.length || credential.length > 512 || /[\r\n\0]/.test(credential))) {
      throw new Error("TURN username and credential must be provided together and bounded");
    }
    const credentialType = server.credentialType;
    if (credentialType !== undefined && !["password", "oauth"].includes(credentialType)) throw new Error("Invalid TURN credential type");
    return {
      urls: Array.isArray(server.urls) ? [...urls] : urls[0],
      ...(username !== undefined ? { username } : {}),
      ...(credential !== undefined ? { credential } : {}),
      ...(credentialType !== undefined ? { credentialType } : {}),
    };
  });
}

/** Local companion: forwards original wire messages; the phone owns all real execution. */
export async function startRobotGateway({
  host = "127.0.0.1",
  port = 8000,
  token = randomBytes(24).toString("hex"),
  demo = false,
  allowApproximation = false,
  signalingPort = false,
  appCatalog,
  appRunner,
  catalogFetchImpl = globalThis.fetch,
  centralFetchImpl = globalThis.fetch,
  appCatalogOptions = {},
  appRunnerOptions = {},
  centralConfig,
  centralToken = process.env.HF_TOKEN,
  iceServers = process.env.ROBOT_BRIDGE_ICE_SERVERS,
} = {}) {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) throw new Error("Invalid device token");
  const validatedIceServers = validateIceServers(iceServers);
  if (signalingPort !== false) {
    const requestedSignalPort = signalingPort === true ? 8443 : signalingPort;
    if (!Number.isInteger(requestedSignalPort) || requestedSignalPort < 0 || requestedSignalPort > 65_535) throw new Error("Invalid local WebRTC signaling port");
  }
  const core = demo ? demoCore() : null;
  const catalog = appCatalog ?? createAppCatalog({ ...appCatalogOptions, fetchImpl: appCatalogOptions.fetchImpl ?? catalogFetchImpl });
  const runner = appRunner ?? createAppRunner({ ...appRunnerOptions, catalog, mediaBackend: appRunnerOptions.mediaBackend ?? "webrtc" });
  await runner.ready;
  let device = null, app = null, gateway = null, counter = 0, commandCounter = 0, snapshot = core?.inspect() ?? null;
  let deviceSeenAt = 0, deviceClockMs = null;
  let deviceRuntimeStatus = null;
  let reachyMediaReleased = false;
  let centralSettings = { enabled: false, protocols: [] };
  const centralClients = new Map();
  const sessionRoutes = new Map();
  const commandWaiters = new Map();
  const mediaWaiters = new Map();
  const deviceClosingSessions = new Set();
  let signalServer = null, signalWss = null, signalAddress = null, localRelay = null;
  let centralConfigSource = "none";
  const send = (socket, value) => {
    if (socket?.readyState !== 1 || socket.bufferedAmount >= 524_288) return false;
    try { socket.send(JSON.stringify(value)); return true; } catch { return false; }
  };
  const deliver = (messages) => { for (const value of messages ?? []) send(app, value); };
  const local = (request) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
  const routeFor = (request) => { try { return new URL(request.url, "http://localhost").pathname; } catch { return null; } };
  const loopbackHost = (request) => {
    try {
      const hostname = new URL(`http://${String(request.headers.host ?? "")}`).hostname.toLowerCase();
      return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
    } catch { return false; }
  };
  function originAllowed(request) {
    if (!request.headers.origin) return true;
    try {
      const u = new URL(request.headers.origin);
      return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
        && u.host.toLowerCase() === String(request.headers.host ?? "").toLowerCase();
    } catch { return false; }
  }
  const paired = (request) => tokenMatches(request, token);
  const loopbackPortal = (request) => local(request) && loopbackHost(request) && originAllowed(request);
  const managementAllowed = (request) => originAllowed(request) && (loopbackPortal(request) || paired(request));
  const mediaStatus = () => {
    const media = deviceRuntimeStatus?.mediaStatus ?? deviceRuntimeStatus?.media ?? null;
    const capabilities = snapshot?.capabilities?.media ?? {};
    const allowed = deviceRuntimeStatus?.requestedMedia ?? deviceRuntimeStatus?.mediaConsent ?? deviceRuntimeStatus?.consent ?? null;
    const mediaKinds = ["camera", "microphone", "speaker"];
    const explicitConsent = allowed && typeof allowed === "object"
      && mediaKinds.some((kind) => typeof allowed[kind] === "boolean");
    const canUse = (kind) => {
      // A native permission or supported device does not imply the user opted
      // in to sharing it with robot apps. Explicit phone consent is the gate.
      if (explicitConsent && allowed[kind] !== true) return false;
      const status = media?.[kind];
      if (status?.available === false || status?.supported === false || ["denied", "unavailable"].includes(status?.permission)) return false;
      return capabilities[kind] === true || status?.available === true
        || (status?.supported === true && !["denied", "unavailable"].includes(status.permission));
    };
    const available = mediaKinds.some(canUse) || (!explicitConsent && media?.available === true);
    const localSignalingReady = signalServer?.listening === true;
    const centralSignalingReady = [...centralClients.values()].some((client) => client.inspect?.().state === "connected");
    const signalingReady = !!device && deviceClockMs !== null && (localSignalingReady || centralSignalingReady);
    const released = reachyMediaReleased || media?.released === true;
    return {
      available: Boolean(available),
      released,
      no_media: !available || !signalingReady || released,
      signalingReady,
      phase: media?.phase ?? "unknown",
      camera: media?.camera ?? null,
      microphone: media?.microphone ?? null,
      speaker: media?.speaker ?? null,
    };
  };

  async function openBridgeSession(input) {
    if (demo || !device || deviceClockMs === null) throw new Error("LOOI phone is not connected");
    if (input.protocol === "reachy" && reachyMediaReleased) throw new Error("Reachy media is released; acquire media before starting another session");
    if (sessionRoutes.size) throw new Error("robot_busy_local");
    let controlClientId;
    if (input.transport === "local") {
      // The stock Python app opens /ws/sdk and GStreamer signalling separately.
      // Only bind the media peer to that already-authenticated Reachy control
      // owner; hosted Central sessions never inherit or replace it.
      if (!app || app.robotProtocol !== input.protocol || input.protocol !== "reachy") throw new Error("robot_busy_local");
      controlClientId = app.clientId;
    } else if (app) throw new Error("robot_busy_local");
    const route = { sessionId: input.sessionId, protocol: input.protocol, transport: input.transport, remotePeerId: input.remotePeerId, controlClientId: controlClientId ?? null };
    sessionRoutes.set(input.sessionId, route);
    const opened = send(device, {
      type: "webrtc-open", protocol: input.protocol, sessionId: input.sessionId, remotePeerId: input.remotePeerId,
      media: { camera: true, microphone: true, speaker: true },
      iceServers: validatedIceServers,
      ...(controlClientId ? { controlClientId } : {}),
    });
    if (!opened) { sessionRoutes.delete(input.sessionId); throw new Error("LOOI phone transport is unavailable"); }
    return route;
  }

  async function signalToPhone(sessionId, event, context = {}) {
    const route = sessionRoutes.get(sessionId);
    if (!route || route.transport !== context.transport || !device) return false;
    return send(device, { type: "signal", sessionId, signal: event });
  }

  async function closeBridgeSession(sessionId, reason = "session-ended", context = {}) {
    const route = sessionRoutes.get(sessionId);
    if (!route || (context.transport && route.transport !== context.transport)) return false;
    sessionRoutes.delete(sessionId);
    if (!deviceClosingSessions.has(sessionId)) send(device, { type: "webrtc-close", sessionId, reason });
    return true;
  }

  localRelay = createGStreamerSignalingRelay({
    protocol: "reachy",
    // The pinned Python SDK discovers its daemon by exact name match.
    meta: { name: "reachymini", display_name: "LOOI", transport: "local", session_liveness: "peer" },
    openSession: openBridgeSession,
    signal: signalToPhone,
    closeSession: closeBridgeSession,
  });

  async function configurePollenCentral(raw, source = "device") {
    const next = validateCentralConfig(raw, centralToken);
    for (const client of centralClients.values()) await client.stop("central-config-replaced").catch(() => undefined);
    centralClients.clear();
    centralSettings = next.enabled
      ? { enabled: true, centralUrl: next.centralUrl, robotName: next.robotName, protocols: [...next.protocols] }
      : { enabled: false, protocols: [] };
    centralConfigSource = source;
    if (!next.enabled) return;
    for (const protocol of next.protocols) {
      const client = createPollenCentralClient({
        centralUrl: next.centralUrl,
        token: next.token,
        protocol,
        meta: { name: next.robotName, transport: "wifi", session_liveness: "peer" },
        fetchImpl: centralFetchImpl,
        openSession: openBridgeSession,
        signal: signalToPhone,
        closeSession: closeBridgeSession,
        onState: (value) => {
          send(device, { type: "central-status", protocol, ...value });
        },
        onError: () => send(device, { type: "central-error", protocol, message: "Pollen Central connection failed" }),
      });
      centralClients.set(protocol, client);
      await client.start();
    }
  }

  async function releaseReachy() {
    reachyMediaReleased = true;
    for (const [sessionId, route] of [...sessionRoutes]) {
      if (route.protocol !== "reachy") continue;
      if (route.transport === "local") {
        await localRelay.handleDeviceClose(sessionId, "reachy-media-released");
      } else {
        const client = centralClients.get(route.protocol);
        if (client) await Promise.resolve(client.handleDeviceSignal({ type: "webrtc-close", sessionId, reason: "reachy-media-released" })).catch(() => undefined);
        await closeBridgeSession(sessionId, "reachy-media-released", { transport: route.transport });
      }
    }
  }

  async function acquireReachy() {
    if (!mediaStatus().available || !mediaStatus().signalingReady) throw Object.assign(new Error("Reachy-compatible media is not available"), { statusCode: 503 });
    reachyMediaReleased = false;
  }

  function getCentralStatus() {
    return Object.fromEntries([...centralClients].map(([protocol, client]) => [protocol, client.inspect()]));
  }

  function appRunnerStatus() {
    try { return runner.status(); } catch { return { installed: [], running: null, jobs: [] }; }
  }

  function assertAppStartReady() {
    if (!device || deviceClockMs === null || signalServer?.listening !== true) {
      throw Object.assign(new Error("Start a Reachy app after the LOOI phone and local WebRTC signaling listener are ready"), { statusCode: 503 });
    }
  }

  function appMediaHooks() {
    return {
      mediaStatus,
      getReachyStatus: mediaStatus,
      releaseReachy,
      acquireReachy,
      getVolume: (deviceName) => sendMediaCommand({ action: "get-volume", device: deviceName }),
      setVolume: (deviceName, value) => sendMediaCommand({ action: "set-volume", device: deviceName, value }),
      getCameraSpecs: undefined,
    };
  }

  async function sendMediaCommand(command) {
    if (!device || deviceClockMs === null) throw Object.assign(new Error("LOOI phone is not connected"), { statusCode: 503 });
    if (!command || !["speaker", "microphone"].includes(command.device)
      || !["get-volume", "set-volume"].includes(command.action)
      || (command.action === "set-volume" && (!Number.isInteger(command.value) || command.value < 0 || command.value > 100))) {
      throw Object.assign(new Error("Invalid media volume request"), { statusCode: 422 });
    }
    if (mediaWaiters.size >= 16) throw Object.assign(new Error("Too many media requests are pending"), { statusCode: 429 });
    const requestId = ++commandCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        mediaWaiters.delete(requestId);
        reject(Object.assign(new Error("LOOI media command timed out"), { statusCode: 504 }));
      }, 5_000);
      mediaWaiters.set(requestId, { resolve, reject, timer });
      if (!send(device, { type: "media-command", requestId, command })) {
        clearTimeout(timer); mediaWaiters.delete(requestId);
        reject(Object.assign(new Error("LOOI phone transport is unavailable"), { statusCode: 503 }));
      }
    });
  }

  function appInvoke(owner) {
    return async (payload, metadata = {}) => {
      if (!app || app.clientId !== owner.clientId || owner.robotProtocol !== "reachy") throw Object.assign(new Error("Reachy app session is unavailable"), { statusCode: 503 });
      const sequence = ++owner.sequence;
      const ttlMs = Number.isInteger(metadata.ttlMs) ? Math.max(1, Math.min(5_000, metadata.ttlMs)) : 1_200;
      if (gateway) {
        const messages = await gateway.handleMessage(payload, { ttlMs, sequence });
        return messages?.[0] ?? null;
      }
      if (!device || deviceClockMs === null) throw Object.assign(new Error("LOOI phone is not connected"), { statusCode: 503 });
      if (owner.httpPending >= 32) throw Object.assign(new Error("Too many HTTP commands are pending"), { statusCode: 429 });
      const requestId = ++commandCounter;
      owner.httpPending += 1;
      return new Promise((resolve, reject) => {
        const timeoutMs = payload?.type === "task" || ["wake_up", "goto_sleep"].includes(payload?.type) ? 65_000 : 5_000;
        const timer = setTimeout(() => {
          commandWaiters.delete(requestId);
          owner.httpPending = Math.max(0, owner.httpPending - 1);
          reject(new Error("LOOI command timed out"));
        }, timeoutMs);
        commandWaiters.set(requestId, { clientId: owner.clientId, resolve, reject, timer, owner });
        const sent = send(device, {
          type: "command", clientId: owner.clientId, requestId, payload, ttlMs,
          expiresAtDeviceMs: deviceClockMs + ttlMs, sequence,
        });
        if (!sent) {
          clearTimeout(timer); commandWaiters.delete(requestId); owner.httpPending = Math.max(0, owner.httpPending - 1);
          reject(new Error("LOOI phone transport is unavailable"));
        }
      });
    };
  }

  async function closeApp() {
    const previous = app; app = null;
    const old = gateway; gateway = null;
    if (previous) {
      for (const [sessionId, route] of [...sessionRoutes]) {
        if (route.transport === "local" && route.controlClientId === previous.clientId) {
          await localRelay.handleDeviceClose(sessionId, "local-control-closed");
        }
      }
      for (const [requestId, pending] of commandWaiters) {
        if (pending.clientId === previous.clientId) { clearTimeout(pending.timer); pending.reject(new Error("App session closed")); commandWaiters.delete(requestId); }
      }
    }
    send(device, { type: "close", clientId: previous?.clientId });
    previous?.close(1000, "app session ended");
    await old?.close();
  }
  const server = http.createServer(async (request, response) => {
    const url = routePath(request);
    const route = url.pathname;
    const json = (status, value, headers = {}) => sendJson(response, status, value, headers);
    try {
      if (request.method === "GET" && route === "/health") {
        if (!loopbackPortal(request)) { response.writeHead(403).end(); return; }
        json(200, { ready: demo || (!!device && deviceClockMs !== null), demo, activeApp: app?.clientId ?? null }); return;
      }

      if (route === "/apps" || route === "/apps/") {
        if (request.method !== "GET" || !loopbackPortal(request)) { response.writeHead(403).end(); return; }
        const result = appPortalResponse();
        response.writeHead(result.status, result.headers).end(result.body); return;
      }

      if (route.startsWith("/api/apps") || route.startsWith("/api/bridge/")) {
        if (!managementAllowed(request)) { json(403, { error: "Pairing authorization required" }); return; }
        if (route === "/api/bridge/status" && request.method === "GET") {
          json(200, {
            connected: !!device && deviceClockMs !== null,
            demo,
            activeApp: app ? { clientId: app.clientId, protocol: app.robotProtocol } : null,
            mediaStatus: mediaStatus(),
            central: { ...centralSettings, clients: getCentralStatus() },
            apps: appRunnerStatus(),
            signaling: { localReady: signalServer?.listening === true, address: signalAddress ? { address: signalAddress.address, port: signalAddress.port } : null },
          }); return;
        }
        if (route === "/api/apps" && request.method === "GET") {
          const rawLimit = url.searchParams.get("limit");
          const limit = rawLimit === null ? 100 : Number(rawLimit);
          const result = await catalog.list({
            query: url.searchParams.get("q") ?? "",
            limit,
            robotFamily: url.searchParams.get("family") || null,
            forceRefresh: url.searchParams.get("refresh") === "1",
          });
          json(200, result); return;
        }
        if (route === "/api/apps/status" && request.method === "GET") { json(200, { ...appRunnerStatus(), mediaStatus: mediaStatus() }); return; }
        if (route === "/api/apps/installed" && request.method === "GET") { json(200, { items: runner.listInstalled() }); return; }
        if (route === "/api/apps/uninstall" && request.method === "POST") {
          const body = await readJsonRequest(request);
          if (typeof body.spaceId !== "string" || Object.keys(body).some(key => key !== "spaceId")) {
            json(422, { error: "Only an installed app Space ID is accepted" }); return;
          }
          json(200, await runner.uninstall(body.spaceId)); return;
        }
        if (route === "/api/apps/install" && request.method === "POST") {
          const body = await readJsonRequest(request);
          if (typeof body.spaceId !== "string" || body.spaceId.length > 160) { json(422, { error: "spaceId must be an owner/name Hugging Face Space ID" }); return; }
          const job = await runner.install(body.spaceId, body.revision === undefined ? {} : { revision: body.revision });
          json(job.alreadyInstalled ? 200 : 202, job); return;
        }
        if (route === "/api/apps/ensure-start" && request.method === "POST") {
          const body = await readJsonRequest(request);
          if (typeof body.spaceId !== "string" || body.spaceId.length > 160) { json(422, { error: "spaceId must be an owner/name Hugging Face Space ID" }); return; }
          if (body.requestId !== undefined && (typeof body.requestId !== "string" || !APP_REQUEST_ID.test(body.requestId))) {
            json(422, { error: "requestId must be 1 to 128 alphanumeric, underscore, or hyphen characters" }); return;
          }
          if (body.revision !== undefined && (typeof body.revision !== "string" || !/^[a-f0-9]{40}$/i.test(body.revision))) {
            json(422, { error: "revision must be a 40-character catalog commit SHA" }); return;
          }
          assertAppStartReady();
          if (typeof runner.ensureStarted !== "function") throw Object.assign(new Error("App ensure-start is unavailable"), { statusCode: 501 });
          const job = await runner.ensureStarted(body.spaceId, {
            ...(body.requestId === undefined ? {} : { requestId: body.requestId }),
            ...(body.revision === undefined ? {} : { revision: body.revision }),
            beforeSpawn: assertAppStartReady,
          });
          json(202, job); return;
        }
        if (route === "/api/apps/start" && request.method === "POST") {
          const body = await readJsonRequest(request);
          if (typeof body.spaceId !== "string" || body.spaceId.length > 160) { json(422, { error: "spaceId must be an owner/name Hugging Face Space ID" }); return; }
          assertAppStartReady();
          json(202, await runner.start(body.spaceId)); return;
        }
        if (route === "/api/apps/stop" && request.method === "POST") {
          const body = await readJsonRequest(request);
          if (body.requestId !== undefined && (typeof body.requestId !== "string" || !APP_REQUEST_ID.test(body.requestId))) {
            json(422, { error: "requestId must be 1 to 128 alphanumeric, underscore, or hyphen characters" }); return;
          }
          json(200, body.requestId === undefined ? await runner.stop() : await runner.stop({ requestId: body.requestId })); return;
        }
        const jobRoute = /^\/api\/apps\/jobs\/([^/]+)$/.exec(route);
        if (jobRoute && request.method === "GET") {
          const job = runner.getJob(decodeURIComponent(jobRoute[1]));
          json(job ? 200 : 404, job ?? { error: "App job not found" }); return;
        }
        const detailRoute = /^\/api\/apps\/(.+)$/.exec(route);
        if (detailRoute && request.method === "GET") {
          const spaceId = decodeURIComponent(detailRoute[1]);
          json(200, await catalog.get(spaceId)); return;
        }
        json(404, { error: "Unsupported app management endpoint" }); return;
      }

      if (!loopbackPortal(request)) { response.writeHead(403).end(); return; }
      if (route.startsWith("/api/")) {
        const compat = await handleReachyHttp({ method: request.method, path: request.url,
          ...(request.method === "POST" ? { body: await readJsonRequest(request) } : {}) }, {
          invoke: app?.robotProtocol === "reachy" ? app.invoke : undefined,
          inspect: () => snapshot,
          apps: appRunnerStatus,
          media: appMediaHooks(),
        });
        if (compat) { response.writeHead(compat.status, compat.headers).end(JSON.stringify(compat.body)); return; }
      }
      if (request.method === "GET" && route === "/api/robot-bridge/state") { json(snapshot ? 200 : 503, snapshot ?? { error: "device unavailable" }); return; }
      json(404, { error: "Unsupported endpoint; use /ws/sdk or /microduck" });
    } catch (error) {
      json(error?.statusCode ?? 400, { error: sanitizedError(error) });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 262_144, perMessageDeflate: false,
    handleProtocols: (protocols) => protocols.has("looi-bridge-v1") ? "looi-bridge-v1" : false });
  server.on("upgrade", (request, socket, head) => {
    const route = routeFor(request);
    if (route === "/device") {
      const supplied = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map(s => s.trim()).find(s => s.startsWith("bearer."))?.slice(7) ?? "";
      if (demo || device || !/^[a-f0-9]{32,128}$/i.test(supplied) || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    } else if (!["/ws/sdk", "/microduck"].includes(route) || !local(request) || !loopbackHost(request) || !originAllowed(request) || app || sessionRoutes.size > 0 || (!demo && (!device || deviceClockMs === null))) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });
  wss.on("connection", (ws, request) => {
    const route = routeFor(request);
    if (route === "/device") {
      device = ws; deviceSeenAt = Date.now(); deviceClockMs = null;
      ws.on("message", (data, binary) => {
        if (device !== ws || binary) return;
        let message; try { message = JSON.parse(data.toString()); } catch { ws.close(1003, "invalid JSON"); return; }
        if (!message || typeof message !== "object" || Array.isArray(message)) { ws.close(1003, "invalid message"); return; }
        deviceSeenAt = Date.now();
        if (["ready", "pong"].includes(message.type) && typeof message.clockMs === "number" && Number.isFinite(message.clockMs) && message.clockMs >= 0) {
          deviceClockMs = message.clockMs;
        }
        if (message.snapshot) snapshot = message.snapshot;
        if (message.mediaStatus && typeof message.mediaStatus === "object") deviceRuntimeStatus = { ...deviceRuntimeStatus, mediaStatus: message.mediaStatus };
        if (message.media && typeof message.media === "object") deviceRuntimeStatus = { ...deviceRuntimeStatus, requestedMedia: message.media };
        if (message.type === "media-status" && message.mediaStatus && typeof message.mediaStatus === "object") {
          deviceRuntimeStatus = { ...deviceRuntimeStatus, mediaStatus: message.mediaStatus };
        }
        if (message.type === "central-config") {
          void configurePollenCentral(message.config, "device").catch(() => send(device, { type: "central-error", message: "Invalid Pollen Central configuration" }));
          return;
        }
        if (message.type === "media-reply") {
          const waiter = mediaWaiters.get(message.requestId);
          if (!waiter) return;
          clearTimeout(waiter.timer); mediaWaiters.delete(message.requestId);
          if (message.error !== undefined) {
            const reason = typeof message.error === "string" ? message.error.slice(0, 200) : "LOOI media command failed";
            waiter.reject(Object.assign(new Error(reason), { statusCode: 503 }));
          } else {
            waiter.resolve(message.result);
          }
          return;
        }
        if (message.type === "signal" && typeof message.sessionId === "string") {
          const route = sessionRoutes.get(message.sessionId);
          if (!route || !message.signal || typeof message.signal !== "object") return;
          if (route.transport === "local") void localRelay.handleDeviceSignal(message.sessionId, message.signal);
          else void centralClients.get(route.protocol)?.handleDeviceSignal(message);
          return;
        }
        if (["webrtc-close", "webrtc-closed"].includes(message.type) && typeof message.sessionId === "string") {
          const route = sessionRoutes.get(message.sessionId);
          if (!route) return;
          deviceClosingSessions.add(message.sessionId);
          const reason = typeof message.reason === "string" ? message.reason.slice(0, 120) : "phone-peer-closed";
          const task = route.transport === "local"
            ? localRelay.handleDeviceClose(message.sessionId, reason)
            : Promise.resolve(centralClients.get(route.protocol)?.handleDeviceSignal({ type: "webrtc-close", sessionId: message.sessionId, reason }))
              .then(() => { sessionRoutes.delete(message.sessionId); });
          void Promise.resolve(task).finally(() => deviceClosingSessions.delete(message.sessionId));
          return;
        }
        if (message.type === "opened" && app?.clientId === message.clientId) deliver(message.messages);
        if (message.type === "reply" && app?.clientId === message.clientId) {
          const waiter = commandWaiters.get(message.requestId);
          if (waiter && waiter.clientId === message.clientId) {
            clearTimeout(waiter.timer); commandWaiters.delete(message.requestId);
            waiter.owner.httpPending = Math.max(0, waiter.owner.httpPending - 1);
            waiter.resolve(Array.isArray(message.messages) ? (message.messages[0] ?? null) : null);
          } else if (app.pendingRequestIds?.delete(message.requestId)) {
            app.pending = Math.max(0, app.pending - 1); deliver(message.messages);
          }
        }
        if (message.type === "state" && app?.clientId === message.clientId) deliver(message.messages);
        if (message.type === "error" && app?.clientId === message.clientId) {
          const waiter = commandWaiters.get(message.requestId);
          if (waiter && waiter.clientId === message.clientId) {
            clearTimeout(waiter.timer); commandWaiters.delete(message.requestId);
            waiter.owner.httpPending = Math.max(0, waiter.owner.httpPending - 1);
            waiter.resolve({ error: typeof message.message === "string" ? message.message : "LOOI command failed" });
          } else {
            if (app.pendingRequestIds?.delete(message.requestId)) app.pending = Math.max(0, app.pending - 1);
            send(app, { error: message.message });
            if (message.requestId === undefined) void closeApp();
          }
        }
      });
      ws.on("close", () => {
        if (device !== ws) return;
        device = null; snapshot = null; deviceClockMs = null; deviceRuntimeStatus = null; reachyMediaReleased = false;
        for (const [requestId, waiter] of mediaWaiters) {
          clearTimeout(waiter.timer); waiter.reject(Object.assign(new Error("LOOI phone disconnected"), { statusCode: 503 }));
          mediaWaiters.delete(requestId);
        }
        void (async () => {
          await closeApp();
          for (const [sessionId, route] of [...sessionRoutes]) {
            if (route.transport === "local") await localRelay.handleDeviceClose(sessionId, "phone-disconnected");
            else {
              const client = centralClients.get(route.protocol);
              if (client) await Promise.resolve(client.handleDeviceSignal({ type: "webrtc-close", sessionId, reason: "phone-disconnected" })).catch(() => undefined);
              await closeBridgeSession(sessionId, "phone-disconnected", { transport: route.transport });
            }
          }
        })();
      });
      ws.on("error", () => ws.close());
      return;
    }
    app = ws; ws.clientId = `app-${++counter}`; ws.pending = 0; ws.pendingRequestIds = new Set();
    const protocol = route === "/ws/sdk" ? "reachy" : "microduck";
    ws.robotProtocol = protocol; ws.sequence = 0; ws.httpPending = 0;
    ws.invoke = appInvoke(ws);
    if (core) {
      gateway = createRobotGateway(core, { protocol, sessionId: ws.clientId, allowApproximation });
      deliver(gateway.initialMessages()); snapshot = core.inspect();
    } else send(device, { type: "open", clientId: ws.clientId, protocol });
    ws.on("message", (data, binary) => {
      if (ws !== app || binary) return;
      let payload; try { payload = JSON.parse(data.toString()); } catch { send(ws, { error: "Invalid JSON" }); return; }
      if (ws.pending >= 64) { void closeApp(); return; }
      ws.pending += 1;
      if (gateway) {
        const currentGateway = gateway;
        const requestId = ++commandCounter;
        const sequence = ++ws.sequence;
        void currentGateway.handleMessage(payload, { ttlMs: 1_200, sequence }).then((messages) => { if (app === ws && gateway === currentGateway) deliver(messages); })
          .catch(() => send(ws, { error: "Command failed" })).finally(() => { ws.pending = Math.max(0, ws.pending - 1); });
      } else {
        const ttlMs = protocol === "microduck" && payload?.method === "robot.move" ? 500 : 1_200;
        // This clock sample originated on the phone. Do not extrapolate it:
        // queueing and transit consume the original lease, without clock sync.
        const requestId = ++commandCounter;
        const sequence = ++ws.sequence;
        ws.pendingRequestIds.add(requestId);
        if (!send(device, { type: "command", clientId: ws.clientId, requestId, payload,
          ttlMs, expiresAtDeviceMs: deviceClockMs + ttlMs, sequence })) { ws.pendingRequestIds.delete(requestId); ws.pending = Math.max(0, ws.pending - 1); send(ws, { error: "LOOI phone transport is unavailable" }); }
      }
    });
    ws.on("close", () => { if (app === ws) void closeApp(); });
    ws.on("error", () => ws.close());
  });
  const poll = setInterval(() => {
    if (gateway) { deliver(gateway.stateMessages()); snapshot = core.inspect(); }
    if (device) { if (Date.now() - deviceSeenAt > 3_000) device.terminate(); else send(device, { type: "ping" }); }
  }, 100);
  if (signalingPort !== false) {
    const localPort = signalingPort === true ? 8443 : signalingPort;
    if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65_535) throw new Error("Invalid local WebRTC signaling port");
    signalServer = http.createServer((_request, response) => { response.writeHead(404, { "cache-control": "no-store" }).end(); });
    signalWss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
    signalServer.on("upgrade", (request, socket, head) => {
      const pathname = routeFor(request);
      if (!["/", "/ws", "/signaling"].includes(pathname) || !local(request) || !loopbackHost(request) || !originAllowed(request)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
      }
      signalWss.handleUpgrade(request, socket, head, (ws) => signalWss.emit("connection", ws, request));
    });
    signalWss.on("connection", (ws) => {
      try { localRelay.handleConnection(ws); } catch { ws.close(1011, "signaling unavailable"); }
    });
    await new Promise((resolve, reject) => { signalServer.once("error", reject); signalServer.listen(localPort, "127.0.0.1", resolve); });
    signalAddress = signalServer.address();
  }
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  if (centralConfig) await configurePollenCentral(centralConfig, "startup");
  else if (centralToken) await configurePollenCentral({ enabled: true, token: centralToken, protocols: ["reachy", "microduck"] }, "environment");
  return { server, token, address: server.address(), signalingAddress: signalAddress, async close() {
    clearInterval(poll);
    for (const [requestId, waiter] of mediaWaiters) {
      clearTimeout(waiter.timer); waiter.reject(Object.assign(new Error("Robot bridge stopped"), { statusCode: 503 }));
      mediaWaiters.delete(requestId);
    }
    for (const client of centralClients.values()) await client.stop("companion-shutdown").catch(() => undefined);
    centralClients.clear();
    await localRelay.close("companion-shutdown");
    for (const [sessionId] of [...sessionRoutes]) await closeBridgeSession(sessionId, "companion-shutdown");
    await closeApp();
    if (typeof runner.close === "function") await Promise.resolve(runner.close()).catch(() => undefined);
    else if (["starting", "running", "stopping"].includes(appRunnerStatus().running?.state)) await runner.stop().catch(() => undefined);
    device?.terminate();
    await core?.dispose();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    if (signalWss) {
      for (const client of signalWss.clients) client.terminate();
      await new Promise(resolve => signalWss.close(resolve));
    }
    if (signalServer?.listening) await new Promise(resolve => signalServer.close(resolve));
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes("--demo");
  const instance = await startRobotGateway({ demo, allowApproximation: process.argv.includes("--approximate"),
    host: process.env.ROBOT_BRIDGE_HOST ?? "127.0.0.1", port: Number(process.env.ROBOT_BRIDGE_PORT ?? 8000),
    signalingPort: process.argv.includes("--no-signaling") ? false : Number(process.env.ROBOT_BRIDGE_SIGNALING_PORT ?? 8443),
    ...(process.env.ROBOT_BRIDGE_TOKEN ? { token: process.env.ROBOT_BRIDGE_TOKEN } : {}) });
  console.log(`Robot bridge ${demo ? "simulation" : "device relay"} on ${instance.address.address}:${instance.address.port}`);
  if (instance.signalingAddress) console.log(`Reachy local signaling on ${instance.signalingAddress.address}:${instance.signalingAddress.port}`);
  if (!demo && !process.env.ROBOT_BRIDGE_TOKEN) console.log(`Device pairing token: ${instance.token}`);
  const shutdown = () => { void instance.close().then(() => process.exit(0)); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}
