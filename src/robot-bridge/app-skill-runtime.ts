import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { createAppCatalog } from "./app-catalog";
import { createRobotAppSkills, type RobotAppSkillsSnapshot } from "./app-skills";
import { requestConfiguredCompanion } from "./companion-client";
import {
  getRobotBridgeRuntimeStatus,
  loadRobotBridgeConfiguration,
  prepareRobotAppConnection,
  stopRobotBridge,
  subscribeRobotBridgeRelease,
} from "./runtime";
import { useUserStore } from "../store/user";
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";

const SETTINGS_KEY = "looi-robot-app-skills-v1";
export type RobotAppSkillSettings = { enabled: boolean };
let settings: RobotAppSkillSettings = { enabled: true };
let settingsLoaded = false;
let settingsLoading: Promise<RobotAppSkillSettings> | null = null;
let settingsUpdates: Promise<void> = Promise.resolve();
let startRevision = 0;
let hostedPreparations = 0;
let stoppingHosted = false;
let engine: ReturnType<typeof createRobotAppSkills> | null = null;
let uninstall: (() => void) | null = null;

function active(): boolean {
  return AppState.currentState === "active" && !useUserStore.getState().robotSleeping;
}

function getEngine() {
  engine ??= createRobotAppSkills({
    catalog: createAppCatalog(),
    isEnabled: () => settingsLoaded && settings.enabled,
    isActive: active,
    getCompanionConnection: async () => {
      const configuration = await loadRobotBridgeConfiguration();
      if (!configuration?.url) return null;
      // Keep credentials in this closure. Polling and STOP must reach the same
      // companion even if the user changes their connection during installation.
      const connection = { url: configuration.url, token: configuration.token };
      return {
        connected: getRobotBridgeRuntimeStatus().companionConnected,
        request: <T = unknown>(path: string, options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}) =>
          requestConfiguredCompanion<T>(connection, path, options),
      };
    },
    prepareHosted: async ({ signal }) => {
      hostedPreparations += 1;
      try {
        if (!await prepareRobotAppConnection({ signal })) throw new Error("central_not_configured");
      } finally { hostedPreparations -= 1; }
    },
    openHosted: (url) => WebBrowser.openBrowserAsync(url),
    stopHosted: async () => {
      stoppingHosted = true;
      try {
        stopRobotBridge();
        if (Platform.OS !== "ios") return false;
        await WebBrowser.dismissBrowser();
        return true;
      } finally { stoppingHosted = false; }
    },
  });
  return engine;
}

export async function loadRobotAppSkillSettings(): Promise<RobotAppSkillSettings> {
  settingsLoading ??= (async () => {
    try {
      const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
          || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
          || typeof (parsed as { enabled?: unknown }).enabled !== "boolean") throw new Error("invalid_settings");
        settings = { enabled: (parsed as { enabled: boolean }).enabled };
      }
      settingsLoaded = true;
      await engine?.setEnabled(settings.enabled);
      return { ...settings };
    } catch (error) {
      settings = { enabled: false };
      settingsLoaded = true;
      await engine?.setEnabled(false);
      settingsLoading = null;
      throw error;
    }
  })();
  return { ...await settingsLoading };
}

export async function configureRobotAppSkillSettings(next: RobotAppSkillSettings): Promise<void> {
  if (!next || typeof next.enabled !== "boolean" || Object.keys(next).some(key => key !== "enabled")) throw new Error("Invalid app skill settings");
  const requested = { enabled: next.enabled };
  const update = settingsUpdates.catch(() => undefined).then(() => configureRobotAppSkillSettingsSerial(requested));
  settingsUpdates = update;
  return update;
}

async function configureRobotAppSkillSettingsSerial(value: RobotAppSkillSettings): Promise<void> {
  // A user can repair unreadable preferences by explicitly choosing a value.
  await loadRobotAppSkillSettings().catch(() => undefined);
  // Stop first, then persist OFF. An unsuccessful write must never leave the
  // in-memory policy or the AI runtime enabled while the UI reports failure.
  if (!value.enabled) await getEngine().setEnabled(false);
  try {
    await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify({ schemaVersion: 1, ...value }));
  } catch (error) {
    settings = { enabled: false };
    settingsLoaded = true;
    settingsLoading = Promise.resolve({ ...settings });
    await getEngine().setEnabled(false);
    throw error;
  }
  settings = value;
  settingsLoaded = true;
  settingsLoading = Promise.resolve({ ...value });
  await getEngine().setEnabled(value.enabled);
}

export function getRobotAppSkillsSnapshot(): RobotAppSkillsSnapshot { return getEngine().getSnapshot(); }
export function subscribeRobotAppSkills(listener: (snapshot: RobotAppSkillsSnapshot) => void) { return getEngine().subscribe(listener); }

export async function searchRobotAppSkills(query: string, limit?: number) {
  await loadRobotAppSkillSettings();
  return getEngine().search(query, limit);
}
export async function describeRobotAppSkill(spaceId: string) {
  await loadRobotAppSkillSettings();
  return getEngine().describe(spaceId);
}
export async function startRobotAppSkill(spaceId: string, options: { isCurrent?: () => boolean } = {}) {
  const revision = startRevision;
  await loadRobotAppSkillSettings();
  if (revision !== startRevision || (options.isCurrent && !options.isCurrent())) return { status: "cancelled" as const, errorCode: "stale_turn" as const };
  installRobotAppSkillRuntime();
  if (active()) getEngine().resume();
  return getEngine().start(spaceId, options);
}
export function stopRobotAppSkills() { startRevision += 1; return getEngine().stop(); }

/** Root lifetime only; the engine owns pending installs, not a settings screen. */
export function installRobotAppSkillRuntime(): () => void {
  if (uninstall) return () => undefined;
  const current = getEngine();
  const stopPending = (reason: string) => {
    startRevision += 1;
    void Promise.resolve(current.suspend(reason)).catch(() => undefined);
  };
  const release = subscribeRobotBridgeRelease(cause => {
    if (stoppingHosted) return;
    if (cause === "runtime-start") return;
    if (cause === "app-state-change" || cause === "sleep-state-change") {
      if (active()) current.resume(); else stopPending(cause);
    } else if (cause !== "configuration-change" || hostedPreparations === 0) stopPending(cause);
  });
  const appState = AppState.addEventListener("change", () => {
    if (active()) current.resume(); else stopPending("app-background");
  });
  const user = useUserStore.subscribe((next, previous) => {
    if (next.robotSleeping === previous.robotSleeping) return;
    if (active()) current.resume(); else stopPending("robot-sleeping");
  });
  let stopGeneration = getLooiRobotRuntimeState().stopGeneration;
  const robot = subscribeLooiRobotRuntimeState(() => {
    const state = getLooiRobotRuntimeState();
    if (state.stopGeneration === stopGeneration) return;
    stopGeneration = state.stopGeneration;
    if (!state.safety.lastSafetyStopReason?.startsWith("robot-bridge:")) stopPending("local-stop");
  });
  void loadRobotAppSkillSettings().catch(() => undefined);
  uninstall = () => {
    startRevision += 1;
    release(); appState.remove(); user(); robot();
    void Promise.resolve(current.dispose()).catch(() => undefined);
    if (engine === current) engine = null;
    uninstall = null;
  };
  return uninstall;
}
