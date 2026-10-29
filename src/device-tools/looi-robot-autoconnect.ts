import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import type { LooiTransport, LooiWriteOptions } from "@sourcebug/looi-sdk";
import {
  connectLooiRobot,
  configureLooiRobotTransport,
  disconnectLooiRobot,
  getLooiRobotRuntimeState,
  handleLooiRobotTransportDisconnected,
  markLooiDriveControlNeedsRevalidation,
  subscribeLooiRobotRuntimeState,
} from "./looi-robot";
import type { LooiConnectionDebugSource, LooiConnectionMode } from "./looi-connection-mode";
import type { MockLooiScenario, MockLooiSnapshot, MockLooiTransport } from "./mock-looi-transport";

export type { LooiConnectionDebugSource, LooiConnectionMode } from "./looi-connection-mode";
export type { MockLooiScenario, MockLooiSnapshot, MockLooiTraceEntry } from "./mock-looi-transport";

type MockCharacteristicKey = Parameters<LooiTransport["write"]>[0];
type MockNotificationHandler = NonNullable<Parameters<NonNullable<LooiTransport["startNotifications"]>>[1]>;

class GuardedMockLooiTransport implements LooiTransport {
  constructor(private readonly inner: MockLooiTransport, private readonly allowed: () => boolean) {}

  async connect(): Promise<void> {
    this.assertAllowed();
    await this.inner.connect();
    this.assertAllowed();
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
  }

  hasCharacteristic(characteristicKey: MockCharacteristicKey): boolean {
    return this.allowed() && this.inner.hasCharacteristic(characteristicKey);
  }

  async startNotifications(characteristicKey: MockCharacteristicKey, onValue?: MockNotificationHandler): Promise<void> {
    this.assertAllowed();
    await this.inner.startNotifications(characteristicKey, onValue);
    this.assertAllowed();
  }

  async write(characteristicKey: MockCharacteristicKey, payloadHex: string, options?: LooiWriteOptions): Promise<void> {
    // A mode switch revokes ordinary commands synchronously, but still lets
    // the teardown path send its single best-effort STOP to the live simulator.
    // This is safe because the shared SDK seam is rebound to an inert transport
    // before any caller can issue another command.
    const isTeardownStop = characteristicKey === "drive" && payloadHex.trim().toLowerCase() === "0000";
    if (!this.allowed() && !(isTeardownStop && this.inner.getSnapshot().connected)) this.assertAllowed();
    await this.inner.write(characteristicKey, payloadHex, options);
    if (!this.allowed() && !isTeardownStop) this.assertAllowed();
  }

  private assertAllowed(): void {
    if (!this.allowed()) throw new Error("Simulated LOOI link is disconnected or no longer selected.");
  }
}

class DisconnectedLooiTransport implements LooiTransport {
  async connect(): Promise<void> {
    throw new Error("LOOI connection is disabled in disconnected mode.");
  }

  async disconnect(): Promise<void> {}

  hasCharacteristic(): boolean {
    return false;
  }

  async startNotifications(): Promise<void> {
    throw new Error("LOOI connection is disabled in disconnected mode.");
  }

  async write(): Promise<void> {
    throw new Error("LOOI commands are disabled in disconnected mode.");
  }
}

export type SavedLooiRobot = {
  id: string;
  name: string;
};

export type LooiRobotCandidate = {
  id: string;
  name: string;
  rssi: number | null;
  selected: boolean;
};

type AutoConnectionResult = { ok: true; connected: true } | { ok: false; skipped: true; reason?: string };

const SAVED_ROBOT_KEY = "looi.robot.selected.v1";
const CONNECTION_MODE_KEY = "looi.robot.connection-mode.v1";
const FOREGROUND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

let connectionPromise: Promise<AutoConnectionResult> | null = null;
let motionSafetySubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let disconnectReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let autoConnectionSuspended = false;
let connectionGeneration = 0;
let connectionQueue: Promise<unknown> = Promise.resolve();
let scheduledRetryCount = 0;
let connectionMode: LooiConnectionMode = "hardware";
let modeWasSetExplicitly = false;
let mockConnectedRequested = true;
let mockConnectedWasSetExplicitly = false;
let modeLoadPromise: Promise<void> | null = null;
let modePersistenceQueue: Promise<unknown> = Promise.resolve();
let modeSwitchGeneration = 0;
let modeSwitching = false;
let debugLastError: string | null = null;
let mockScenario: MockLooiScenario = "clear";
let mockTransport: MockLooiTransport | null = null;
let unsubscribeMockTransport: (() => void) | null = null;
const debugStateListeners = new Set<(snapshot: LooiRobotDebugState) => void>();

type RuntimeSnapshot = ReturnType<typeof getLooiRobotRuntimeState>;

export type LooiRobotDebugState = {
  mode: LooiConnectionMode;
  mockConnectedRequested: boolean;
  switching: boolean;
  /** Identifies whether the current command source is physical, simulated, or absent. */
  source: LooiConnectionDebugSource;
  connected: boolean;
  connecting: boolean;
  lastError: string | null;
  safety: RuntimeSnapshot["safety"];
  mock: MockLooiSnapshot | null;
};

let debugStateSnapshot: LooiRobotDebugState | null = null;

function buildDebugState(): LooiRobotDebugState {
  const runtime = getLooiRobotRuntimeState();
  const source: LooiConnectionDebugSource = connectionMode === "mock"
    ? "mock"
    : connectionMode === "disconnected" ? "none" : "hardware";
  return {
    mode: connectionMode,
    mockConnectedRequested,
    switching: modeSwitching,
    source,
    connected: runtime.connected,
    connecting: runtime.connecting,
    lastError: debugLastError ?? runtime.lastError,
    safety: runtime.safety,
    mock: connectionMode === "mock" ? mockTransport?.getSnapshot() ?? null : null,
  };
}

function emitDebugState(): LooiRobotDebugState {
  const snapshot = buildDebugState();
  debugStateSnapshot = snapshot;
  for (const listener of debugStateListeners) {
    try {
      listener(snapshot);
    } catch {
      // Debug observers must never interfere with robot control.
    }
  }
  return snapshot;
}

export function getLooiRobotDebugState(): LooiRobotDebugState {
  void ensureConnectionModeLoaded();
  return debugStateSnapshot ?? emitDebugState();
}

export function subscribeLooiRobotDebugState(listener: (snapshot: LooiRobotDebugState) => void): () => void {
  debugStateListeners.add(listener);
  listener(getLooiRobotDebugState());
  void ensureConnectionModeLoaded();
  return () => debugStateListeners.delete(listener);
}

if (typeof subscribeLooiRobotRuntimeState === "function") {
  subscribeLooiRobotRuntimeState(() => { emitDebugState(); });
}

function enqueueModePersistence(): Promise<void> {
  const mode = connectionMode;
  const mockRequested = mockConnectedRequested;
  const pending = modePersistenceQueue.then(async () => {
    await SecureStore.setItemAsync(CONNECTION_MODE_KEY, JSON.stringify({
      mode,
      mockConnectedRequested: mockRequested,
    }));
  });
  modePersistenceQueue = pending.catch(() => undefined);
  return pending;
}

function ensureConnectionModeLoaded(): Promise<void> {
  if (!modeLoadPromise) {
    modeLoadPromise = Promise.all([
      SecureStore.getItemAsync(CONNECTION_MODE_KEY),
    ]).then(([storedState]) => {
      let parsed: { mode?: unknown; mockConnectedRequested?: unknown } = {};
      try {
        parsed = storedState ? JSON.parse(storedState) as typeof parsed : {};
      } catch {
        // Older releases stored only the physical robot identity in SecureStore.
      }
      if (!modeWasSetExplicitly && (parsed.mode === "hardware" || parsed.mode === "mock" || parsed.mode === "disconnected")) {
        connectionMode = parsed.mode;
      }
      if (!mockConnectedWasSetExplicitly && typeof parsed.mockConnectedRequested === "boolean") {
        mockConnectedRequested = parsed.mockConnectedRequested;
      }
      emitDebugState();
    }).catch((error) => {
      debugLastError = error instanceof Error ? error.message : String(error);
      emitDebugState();
    });
  }
  return modeLoadPromise;
}

function emitMockPersistenceFailure(error: unknown): void {
  debugLastError = error instanceof Error ? error.message : String(error);
  emitDebugState();
}

function releaseMockTransport(): void {
  unsubscribeMockTransport?.();
  unsubscribeMockTransport = null;
  mockTransport?.dispose();
  mockTransport = null;
}

function mockTransportDisconnected(transport: MockLooiTransport, error?: Error): void {
  if (transport !== mockTransport || connectionMode !== "mock") return;
  mockConnectedRequested = false;
  mockConnectedWasSetExplicitly = true;
  debugLastError = error?.message ?? "Mock LOOI disconnected";
  handleLooiRobotTransportDisconnected(error);
  emitDebugState();
  void enqueueModePersistence().catch(emitMockPersistenceFailure);
}

async function configureMockTransport(
  generation: number,
  shouldConnect: boolean,
): Promise<AutoConnectionResult> {
  if (connectionMode !== "mock" || generation !== connectionGeneration) {
    return { ok: false, skipped: true, reason: "superseded" };
  }
  if (AppState.currentState !== "active" || autoConnectionSuspended) {
    return { ok: false, skipped: true, reason: "background-suspended" };
  }

  const { MockLooiTransport } = await import("./mock-looi-transport");
  if (connectionMode !== "mock" || generation !== connectionGeneration) {
    return { ok: false, skipped: true, reason: "superseded" };
  }

  let nextTransport!: MockLooiTransport;
  nextTransport = new MockLooiTransport({
    initialScenario: mockScenario,
    onDisconnected: (error) => mockTransportDisconnected(nextTransport, error),
  });
  releaseMockTransport();
  mockTransport = nextTransport;
  unsubscribeMockTransport?.();
  unsubscribeMockTransport = nextTransport.subscribe(() => { emitDebugState(); });
  configureLooiRobotTransport(new GuardedMockLooiTransport(nextTransport, () => (
    nextTransport === mockTransport &&
    connectionMode === "mock" &&
    mockConnectedRequested &&
    !autoConnectionSuspended &&
    AppState.currentState === "active"
  )));
  debugLastError = null;
  emitDebugState();

  if (!shouldConnect) return { ok: false, skipped: true, reason: "mock-disconnected" };
  if (!mockConnectedRequested) return { ok: false, skipped: true, reason: "mock-disconnected" };

  try {
    const result = await connectLooiRobot();
    if (connectionMode !== "mock" || generation !== connectionGeneration || nextTransport !== mockTransport) {
      return { ok: false, skipped: true, reason: "superseded" };
    }
    debugLastError = null;
    emitDebugState();
    return result;
  } catch (error) {
    if (connectionMode !== "mock" || generation !== connectionGeneration || nextTransport !== mockTransport) {
      return { ok: false, skipped: true, reason: "superseded" };
    }
    debugLastError = error instanceof Error ? error.message : String(error);
    emitDebugState();
    throw error;
  }
}

function switchMode(mode: LooiConnectionMode): Promise<void> {
  if (mode !== "hardware" && mode !== "mock" && mode !== "disconnected") {
    return Promise.reject(new Error(`Unknown LOOI connection mode: ${String(mode)}`));
  }
  ensureMotionSafetyLifecycle();
  const modeReady = ensureConnectionModeLoaded();
  modeWasSetExplicitly = true;
  connectionMode = mode;
  debugLastError = null;
  modeSwitching = true;
  const switchGeneration = ++modeSwitchGeneration;
  autoConnectionSuspended = mode === "disconnected" || AppState.currentState !== "active";

  // Invalidate scans, retries, connections, and motion synchronously. The
  // transport teardown below then drains before a new transport can be bound.
  invalidateConnectionAttempts();
  markLooiDriveControlNeedsRevalidation(`connection-mode-${mode}`);
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
  // The old SDK client is now captured by teardown; rebind the shared seam to
  // a fail-closed transport before any new tool call can reuse that client.
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  const persistence = modeReady.then(() => enqueueModePersistence());
  emitDebugState();

  const transition = enqueueConnection(async () => {
    await teardown;
    await modeReady;
    if (switchGeneration !== modeSwitchGeneration || generation !== connectionGeneration) return;

    releaseMockTransport();
    if (mode === "mock" && AppState.currentState === "active" && !autoConnectionSuspended) {
      await configureMockTransport(generation, mockConnectedRequested);
    } else if (mode === "hardware" && AppState.currentState === "active" && !autoConnectionSuspended) {
      try {
        await connectSavedRobot(generation);
      } catch (error) {
        if (switchGeneration === modeSwitchGeneration && canConnect(generation)) {
          debugLastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }).catch((error) => {
    if (switchGeneration === modeSwitchGeneration) {
      debugLastError = error instanceof Error ? error.message : String(error);
    }
  }).finally(() => {
    if (switchGeneration === modeSwitchGeneration) {
      modeSwitching = false;
      emitDebugState();
    }
  });

  return Promise.all([transition, persistence]).then(() => undefined, (error) => {
    if (switchGeneration === modeSwitchGeneration) {
      debugLastError = error instanceof Error ? error.message : String(error);
      emitDebugState();
    }
    throw error;
  });
}

/** Select physical LOOI, an in-memory simulator, or an intentional offline mode. */
export function setLooiConnectionMode(mode: LooiConnectionMode): Promise<void> {
  return switchMode(mode);
}

function restartMockTransport(shouldConnect: boolean): Promise<void> {
  const switchGeneration = ++modeSwitchGeneration;
  modeSwitching = true;
  autoConnectionSuspended = AppState.currentState !== "active";
  invalidateConnectionAttempts();
  markLooiDriveControlNeedsRevalidation("mock-transport-reconfigured");
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  emitDebugState();

  return enqueueConnection(async () => {
    await teardown;
    if (switchGeneration !== modeSwitchGeneration || connectionMode !== "mock" || generation !== connectionGeneration) return;
    releaseMockTransport();
    if (AppState.currentState === "active" && !autoConnectionSuspended) {
      await configureMockTransport(generation, shouldConnect);
    }
  }).catch((error) => {
    if (switchGeneration === modeSwitchGeneration) debugLastError = error instanceof Error ? error.message : String(error);
  }).finally(() => {
    if (switchGeneration === modeSwitchGeneration) {
      modeSwitching = false;
      emitDebugState();
    }
  });
}

/** Enable or disable the simulated link. Disabling is a persistent link-loss injection. */
export function setMockLooiConnected(connected: boolean): Promise<void> {
  if (connectionMode !== "mock") return Promise.reject(new Error("Select Mock mode before changing the simulated connection."));
  mockConnectedWasSetExplicitly = true;
  mockConnectedRequested = connected;
  debugLastError = null;
  invalidateConnectionAttempts();
  emitDebugState();

  if (!connected) {
    const transport = mockTransport;
    if (transport?.getSnapshot().connected) {
      transport.simulateLinkLoss();
    } else if (getLooiRobotRuntimeState().connected) {
      handleLooiRobotTransportDisconnected(new Error("Simulated LOOI link loss"));
    }
    emitDebugState();
    return enqueueModePersistence().catch((error) => {
      emitMockPersistenceFailure(error);
      throw error;
    });
  }

  const persistence = enqueueModePersistence();
  return Promise.all([restartMockTransport(true), persistence]).then(() => undefined, (error) => {
    emitMockPersistenceFailure(error);
    throw error;
  });
}

/** Change the simulated FED9 sensor environment used by the normal safety pipeline. */
export function setMockLooiScenario(scenario: MockLooiScenario): Promise<void> {
  const supported: readonly MockLooiScenario[] = ["clear", "front-edge", "rear-edge", "obstacle", "unknown"];
  if (!supported.includes(scenario)) return Promise.reject(new Error(`Unknown mock LOOI scenario: ${String(scenario)}`));
  mockScenario = scenario;
  if (connectionMode !== "mock" || !mockTransport) {
    emitDebugState();
    return Promise.resolve();
  }

  if (scenario === "unknown" && mockTransport.getSnapshot().connected) {
    return restartMockTransport(mockConnectedRequested);
  }
  mockTransport.setScenario(scenario);
  emitDebugState();
  return Promise.resolve();
}

export function clearMockLooiTrace(): void {
  mockTransport?.clearTrace();
  emitDebugState();
}

function canConnect(generation: number): boolean {
  return connectionMode === "hardware" && generation === connectionGeneration && !autoConnectionSuspended && AppState.currentState === "active";
}

function assertCanConnect(generation: number): void {
  if (!canConnect(generation)) throw new Error("LOOI connection cancelled by a newer request or lifecycle change");
}

function enqueueConnection<T>(operation: () => Promise<T>): Promise<T> {
  const pending = connectionQueue.then(operation, operation);
  connectionQueue = pending.catch(() => undefined);
  return pending;
}

function invalidateConnectionAttempts(): void {
  connectionGeneration += 1;
  connectionPromise = null;
  scheduledRetryCount = 0;
  clearReconnectTimer();
}

function disconnectPendingConnection(): Promise<void> {
  // Cancel native work immediately. A future connect also waits for this
  // teardown and the superseded attempt, so its GATT session cannot be closed
  // by the previous lifecycle's delayed disconnect.
  const teardown = disconnectLooiRobot();
  connectionQueue = Promise.allSettled([connectionQueue, teardown]);
  return teardown;
}

function clearReconnectTimer(): void {
  if (disconnectReconnectTimer === null) return;
  clearTimeout(disconnectReconnectTimer);
  disconnectReconnectTimer = null;
}

function scheduleForegroundReconnectRetry(reason: string, error?: unknown, initialDelayMs?: number): void {
  if (autoConnectionSuspended || AppState.currentState !== "active" || disconnectReconnectTimer) return;
  if (scheduledRetryCount >= FOREGROUND_RETRY_DELAYS_MS.length) {
    recordDiagnosticEvent("robot", "ble-foreground-reconnect-exhausted", { reason, attempts: scheduledRetryCount });
    return;
  }
  const generation = connectionGeneration;
  const retry = ++scheduledRetryCount;
  const delayMs = initialDelayMs ?? FOREGROUND_RETRY_DELAYS_MS[retry - 1];
  const timer = setTimeout(() => {
    if (disconnectReconnectTimer !== timer) return;
    disconnectReconnectTimer = null;
    void retryForegroundConnection(reason, generation, retry);
  }, delayMs);
  disconnectReconnectTimer = timer;
  recordDiagnosticEvent("robot", "ble-foreground-reconnect-retry-scheduled", {
    reason,
    delayMs,
    retry,
    error: error instanceof Error ? error.message : error ? String(error) : "none",
  });
}

async function retryForegroundConnection(reason: string, generation: number, retry: number): Promise<void> {
  if (!canConnect(generation) || getLooiRobotRuntimeState().connected) return;
  recordDiagnosticEvent("robot", "ble-foreground-reconnect-retry-start", { reason, retry });
  try {
    const result = await startLooiRobotAutoConnection();
    if (!canConnect(generation)) return;
    recordDiagnosticEvent("robot", "ble-foreground-reconnect-retry-finished", {
      reason,
      ok: result.ok,
      skipped: !result.ok,
      skipReason: result.ok ? "none" : result.reason ?? "none",
    });
  } catch (error) {
    if (!canConnect(generation)) return;
    recordDiagnosticEvent("robot", "ble-foreground-reconnect-retry-failed", {
      reason, error: error instanceof Error ? error.message : String(error),
    });
    scheduleForegroundReconnectRetry(reason, error);
  }
}

function ensureMotionSafetyLifecycle(): void {
  if (motionSafetySubscription || Platform.OS === "web") return;
  motionSafetySubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState === "active") return;
    // Mark reconnect suspended synchronously, before the async app lifecycle has
    // time to release audio/BLE. This closes the link-loss auto-reconnect race.
    autoConnectionSuspended = true;
    invalidateConnectionAttempts();
    // disconnectLooiRobot issues STOP before its first await. A separate stop
    // here would send the same command twice and race two failure recoveries.
    const teardown = disconnectPendingConnection();
    configureLooiRobotTransport(new DisconnectedLooiTransport());
    void teardown.catch((error) => {
      console.warn("[LOOI BLE] Cancelling background connection failed", error);
    });
  });
}

export function startLooiRobotAutoConnection(): Promise<AutoConnectionResult> {
  ensureMotionSafetyLifecycle();
  if (autoConnectionSuspended || AppState.currentState !== "active") {
    return Promise.resolve({ ok: false, skipped: true, reason: "background-suspended" });
  }

  if (!connectionPromise) {
    const generation = connectionGeneration;
    const modeReady = ensureConnectionModeLoaded();
    const attempt: Promise<AutoConnectionResult> = enqueueConnection(async (): Promise<AutoConnectionResult> => {
      await modeReady;
      if (generation !== connectionGeneration) return { ok: false, skipped: true, reason: "superseded" };
      if (autoConnectionSuspended || AppState.currentState !== "active") {
        return { ok: false, skipped: true, reason: "background-suspended" };
      }
      if (connectionMode === "disconnected") return { ok: false, skipped: true, reason: "mode-disconnected" };
      if (connectionMode === "mock") {
        if (getLooiRobotRuntimeState().connected && mockTransport) return { ok: true, connected: true };
        return configureMockTransport(generation, mockConnectedRequested);
      }
      if (process.env.EXPO_PUBLIC_LOOI_DISABLE_ROBOT_AUTOCONNECT === "1" || Platform.OS === "web") {
        return { ok: false, skipped: true, reason: "disabled" };
      }
      if (getLooiRobotRuntimeState().connected) return { ok: true, connected: true };
      return connectSavedRobot(generation);
    });
    connectionPromise = attempt;
    const releaseAttempt = () => {
      // Settled results cannot describe a future physical BLE connection.
      if (connectionPromise === attempt) connectionPromise = null;
    };
    void attempt.then(releaseAttempt, releaseAttempt);
  }

  return connectionPromise!;
}

/** Hard lifecycle suspend used for screen-off/background and explicit robot sleep. */
export async function suspendLooiRobotAutoConnection(reason = "background"): Promise<void> {
  ensureMotionSafetyLifecycle();
  autoConnectionSuspended = true;
  invalidateConnectionAttempts();
  recordDiagnosticEvent("robot", "ble-autoconnect-suspended", { reason });
  markLooiDriveControlNeedsRevalidation(`lifecycle-${reason}`);
  const teardown = disconnectPendingConnection();
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  await teardown;
  recordDiagnosticEvent("robot", "ble-background-disconnect-complete", { reason });
}

/** Foreground resume: allow and immediately attempt reconnect of the saved robot. */
export async function resumeLooiRobotAutoConnection(reason = "foreground"): Promise<AutoConnectionResult> {
  ensureMotionSafetyLifecycle();
  await ensureConnectionModeLoaded();
  if (AppState.currentState !== "active") {
    return { ok: false, skipped: true, reason: "not-active" };
  }
  if (connectionMode === "disconnected") {
    autoConnectionSuspended = true;
    return { ok: false, skipped: true, reason: "mode-disconnected" };
  }
  if (connectionMode === "hardware" && Platform.OS === "web") {
    return { ok: false, skipped: true, reason: "web" };
  }
  autoConnectionSuspended = false;
  const generation = connectionGeneration;
  recordDiagnosticEvent("robot", "ble-autoconnect-resumed", { reason });
  try {
    return await startLooiRobotAutoConnection();
  } catch (error) {
    // Radio/GATT restoration can fail transiently after suspension. Retry with
    // a bounded backoff while foregrounded, independently of voice readiness.
    if (canConnect(generation)) scheduleForegroundReconnectRetry(reason, error);
    throw error;
  }
}

/** Main-screen recovery control: discard stale state and reconnect the saved robot now. */
export async function forceReconnectSavedLooiRobot(): Promise<AutoConnectionResult> {
  ensureMotionSafetyLifecycle();
  await ensureConnectionModeLoaded();
  if (AppState.currentState !== "active") return { ok: false, skipped: true, reason: "not-active" };
  if (connectionMode === "disconnected") return { ok: false, skipped: true, reason: "mode-disconnected" };
  if (connectionMode === "mock") {
    await setMockLooiConnected(true);
    return getLooiRobotRuntimeState().connected
      ? { ok: true, connected: true }
      : { ok: false, skipped: true, reason: "mock-disconnected" };
  }
  if (Platform.OS === "web") return { ok: false, skipped: true, reason: "web" };
  if (AppState.currentState !== "active") return { ok: false, skipped: true, reason: "not-active" };
  // Main-screen status is authoritative now. If BLE is already connected, a
  // recovery tap must not tear down a healthy GATT session and reconnect it.
  if (getLooiRobotRuntimeState().connected) {
    recordDiagnosticEvent("robot", "ble-force-reconnect-skipped", { reason: "already-connected" });
    return { ok: true, connected: true };
  }

  invalidateConnectionAttempts();
  autoConnectionSuspended = false;
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  return enqueueConnection(async () => {
    await teardown;
    const saved = await getSavedLooiRobot();
    assertCanConnect(generation);
    if (!saved) return { ok: false, skipped: true, reason: "no-saved-robot" };
    recordDiagnosticEvent("robot", "ble-force-reconnect-start", { robotId: saved.id });
    markLooiDriveControlNeedsRevalidation("force-reconnect");
    const result = await connectRobot(saved, generation);
    recordDiagnosticEvent("robot", "ble-force-reconnect-finished", { robotId: saved.id });
    return result;
  });
}

export async function scanLooiRobotCandidates(): Promise<LooiRobotCandidate[]> {
  await ensureConnectionModeLoaded();
  if (connectionMode !== "hardware" || Platform.OS === "web") return [];
  const generation = connectionGeneration;

  const [{ scanLooiRobotCandidates }, saved] = await Promise.all([
    import("./react-native-ble-transport"),
    getSavedLooiRobot(),
  ]);
  if (connectionMode !== "hardware" || generation !== connectionGeneration) return [];
  const candidates = await scanLooiRobotCandidates();
  if (connectionMode !== "hardware" || generation !== connectionGeneration) return [];
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    rssi: candidate.rssi,
    selected: candidate.id === saved?.id,
  }));
}

export async function connectSelectedLooiRobot(robot: SavedLooiRobot): Promise<{
  ok: true;
  connected: true;
  robot: SavedLooiRobot;
}> {
  ensureMotionSafetyLifecycle();
  await ensureConnectionModeLoaded();
  if (connectionMode !== "hardware") {
    throw new Error(connectionMode === "mock"
      ? "Mock mode is active. Use the simulated connection control instead of selecting a physical robot."
      : "LOOI is set to disconnected mode.");
  }
  if (Platform.OS === "web" || AppState.currentState !== "active") {
    throw new Error("LOOI connection requires an active native app");
  }
  invalidateConnectionAttempts();
  autoConnectionSuspended = false;
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  return enqueueConnection(async () => {
    await teardown;
    const result = await connectRobot(robot, generation);
    assertCanConnect(generation);
    await saveSelectedLooiRobot(robot);
    assertCanConnect(generation);
    return { ...result, robot };
  });
}

export async function getSavedLooiRobot(): Promise<SavedLooiRobot | null> {
  const raw = await SecureStore.getItemAsync(SAVED_ROBOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedLooiRobot> | null;
    if (!parsed) return null;
    if (typeof parsed.id !== "string" || !parsed.id.trim()) return null;
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

export async function clearSavedLooiRobot(): Promise<void> {
  await ensureConnectionModeLoaded();
  if (connectionMode !== "hardware") {
    await SecureStore.deleteItemAsync(SAVED_ROBOT_KEY);
    return;
  }
  invalidateConnectionAttempts();
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
  // `disconnectPendingConnection` may still be awaiting a STOP write. Keep any
  // newly issued direct robot command off the old physical transport during
  // that interval, just as mode switches do above.
  configureLooiRobotTransport(new DisconnectedLooiTransport());
  await enqueueConnection(async () => {
    await teardown;
    await SecureStore.deleteItemAsync(SAVED_ROBOT_KEY);
    if (generation === connectionGeneration && connectionMode === "hardware") {
      configureLooiRobotTransport(new DisconnectedLooiTransport());
    }
  });
  await teardown;
}

async function connectSavedRobot(generation: number): Promise<AutoConnectionResult> {
  if (!canConnect(generation)) return { ok: false, skipped: true, reason: "superseded" };
  try {
    const saved = await getSavedLooiRobot();
    assertCanConnect(generation);
    if (!saved) return { ok: false, skipped: true, reason: "no-saved-robot" };
    await disconnectLooiRobot();
    assertCanConnect(generation);
    return await connectRobot(saved, generation);
  } catch (error) {
    if (!canConnect(generation)) return { ok: false, skipped: true, reason: "superseded" };
    throw error;
  }
}

async function connectRobot(robot: SavedLooiRobot, generation: number): Promise<{ ok: true; connected: true }> {
  assertCanConnect(generation);
  const { ReactNativeBleLooiTransport } = await import("./react-native-ble-transport");
  assertCanConnect(generation);
  configureLooiRobotTransport(new ReactNativeBleLooiTransport({
    deviceId: robot.id,
    robotName: robot.name,
    isConnectionAllowed: () => canConnect(generation),
    onDisconnected: (error) => {
      if (!canConnect(generation)) return;
      handleLooiRobotTransportDisconnected(error);
      connectionPromise = null;
      scheduleForegroundReconnectRetry("link-loss", error, 700);
    },
  }));

  console.log(`[LOOI BLE] Connecting selected robot ${robot.name} (${robot.id})`);
  const result = await connectLooiRobot({
    onDock: ({ docked }) => {
      console.log(`[LOOI BLE] Dock state changed: ${docked ? "docked" : "undocked"}`);
    },
    onRawNotify: ({ characteristic, hex }) => {
      console.log(`[LOOI BLE] Notify ${characteristic}: ${hex}`);
    },
  });
  assertCanConnect(generation);
  scheduledRetryCount = 0;
  clearReconnectTimer();
  console.log("[LOOI BLE] Robot connected and handshake complete");
  return result;
}

async function saveSelectedLooiRobot(robot: SavedLooiRobot): Promise<void> {
  await SecureStore.setItemAsync(SAVED_ROBOT_KEY, JSON.stringify(robot));
}
