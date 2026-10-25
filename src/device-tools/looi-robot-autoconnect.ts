import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import {
  connectLooiRobot,
  configureLooiRobotTransport,
  disconnectLooiRobot,
  getLooiRobotRuntimeState,
  handleLooiRobotTransportDisconnected,
  markLooiDriveControlNeedsRevalidation,
} from "./looi-robot";

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
const FOREGROUND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

let connectionPromise: Promise<AutoConnectionResult> | null = null;
let motionSafetySubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let disconnectReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let autoConnectionSuspended = false;
let connectionGeneration = 0;
let connectionQueue: Promise<unknown> = Promise.resolve();
let scheduledRetryCount = 0;

function canConnect(generation: number): boolean {
  return generation === connectionGeneration && !autoConnectionSuspended && AppState.currentState === "active";
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
    void disconnectPendingConnection().catch((error) => {
      console.warn("[LOOI BLE] Cancelling background connection failed", error);
    });
  });
}

export function startLooiRobotAutoConnection(): Promise<AutoConnectionResult> {
  ensureMotionSafetyLifecycle();
  if (process.env.EXPO_PUBLIC_LOOI_DISABLE_ROBOT_AUTOCONNECT === "1" || Platform.OS === "web") {
    return Promise.resolve({ ok: false, skipped: true, reason: "disabled" });
  }
  if (autoConnectionSuspended || AppState.currentState !== "active") {
    return Promise.resolve({ ok: false, skipped: true, reason: "background-suspended" });
  }

  const runtimeState = getLooiRobotRuntimeState();
  if (runtimeState.connected) {
    return Promise.resolve({ ok: true, connected: true });
  }

  if (!connectionPromise) {
    const generation = connectionGeneration;
    const attempt = enqueueConnection(() => connectSavedRobot(generation));
    connectionPromise = attempt;
    const releaseAttempt = () => {
      // Settled results cannot describe a future physical BLE connection.
      if (connectionPromise === attempt) connectionPromise = null;
    };
    void attempt.then(releaseAttempt, releaseAttempt);
  }

  return connectionPromise;
}

/** Hard lifecycle suspend used for screen-off/background and explicit robot sleep. */
export async function suspendLooiRobotAutoConnection(reason = "background"): Promise<void> {
  ensureMotionSafetyLifecycle();
  autoConnectionSuspended = true;
  invalidateConnectionAttempts();
  recordDiagnosticEvent("robot", "ble-autoconnect-suspended", { reason });
  markLooiDriveControlNeedsRevalidation(`lifecycle-${reason}`);
  await disconnectPendingConnection();
  recordDiagnosticEvent("robot", "ble-background-disconnect-complete", { reason });
}

/** Foreground resume: allow and immediately attempt reconnect of the saved robot. */
export async function resumeLooiRobotAutoConnection(reason = "foreground"): Promise<AutoConnectionResult> {
  ensureMotionSafetyLifecycle();
  if (Platform.OS === "web" || AppState.currentState !== "active") {
    return { ok: false, skipped: true, reason: "not-active" };
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
  if (Platform.OS === "web") return [];

  const [{ scanLooiRobotCandidates }, saved] = await Promise.all([
    import("./react-native-ble-transport"),
    getSavedLooiRobot(),
  ]);
  const candidates = await scanLooiRobotCandidates();
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
  if (Platform.OS === "web" || AppState.currentState !== "active") {
    throw new Error("LOOI connection requires an active native app");
  }
  invalidateConnectionAttempts();
  autoConnectionSuspended = false;
  const generation = connectionGeneration;
  const teardown = disconnectPendingConnection();
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
  invalidateConnectionAttempts();
  const teardown = disconnectPendingConnection();
  await enqueueConnection(() => SecureStore.deleteItemAsync(SAVED_ROBOT_KEY));
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
