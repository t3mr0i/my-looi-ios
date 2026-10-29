import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  AppState,
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { RobotAppsShell } from "./RobotAppsShell";
import { RobotAppsGlyph, type AppsGlyphName } from "./RobotAppsGlyph";
import { RobotAppActionsPanel } from "./RobotAppActionsPanel";
import { RobotAppSkillsPanel } from "./RobotAppSkillsPanel";
import { looiTheme } from "./looi-theme";
import { useUiText } from "../i18n/use-ui-text";
import { createRobotAppsTranslator } from "../i18n/robot-app-strings";
import { createRobotAppSkillsTranslator } from "../i18n/robot-app-skill-strings";
import {
  configureRobotBridge,
  DEFAULT_ROBOT_CENTRAL_URL,
  getRobotBridgeRuntimeStatus,
  loadRobotBridgeConfiguration,
  prepareRobotAppConnection,
  reconnectRobotBridge,
  stopRobotBridge,
  subscribeRobotBridgeRuntimeStatus,
  type RobotBridgeConfiguration,
} from "../robot-bridge/runtime";
import { requestCompanion, requestConfiguredCompanion } from "../robot-bridge/companion-client";
import { createAppCatalog } from "../robot-bridge/app-catalog";
import { normalizeRobotBridgeDeviceUrl } from "../robot-bridge/device-connection";
import { createNativeMediaBackend } from "../robot-bridge/native-media";
import type { RobotMediaBackendStatus } from "../robot-bridge/media-broker";

type Family = "reachy" | "microduck";
type AppsPage = "menu" | "discover" | "library" | "connection" | "media" | "actions" | "skills";
type CentralConnectionStatus = {
  state: "connecting" | "connected" | "reconnecting" | "stopped";
  peerId?: string | null;
  sessionId?: string | null;
  reconnectAttempt?: number;
};
type RuntimeStatus = ReturnType<typeof getRobotBridgeRuntimeStatus> & {
  companionConnected?: boolean;
  central?: { universal?: CentralConnectionStatus };
  mediaStatus?: RobotMediaBackendStatus & {
    phase?: string;
    owner?: string | null;
    request?: { camera?: boolean; microphone?: boolean; speaker?: boolean } | null;
  };
};
type CatalogApp = {
  id: string;
  spaceId: string;
  revision: string | null;
  family: Family;
  kind: "python" | "web";
  title: string;
  description: string;
  author?: string;
  sdk?: string;
  url: string;
  installable: boolean;
  launch?: { url?: string; appHost?: string | null };
};
type CatalogResponse = { items?: CatalogApp[]; total?: number; stale?: boolean; warnings?: string[] };
type AppJob = { id: string; spaceId: string; phase: string; state: string; title?: string; error?: string | null };
type InstalledApp = { spaceId: string; title?: string; state?: string };
type RunnerStatus = { installed?: InstalledApp[]; running?: AppJob | null; jobs?: AppJob[] };
type CentralDraft = { enabled: boolean; url: string; token: string; robotName: string };
type MediaDraft = { camera: boolean; microphone: boolean; speaker: boolean; cameraFacing: "user" | "environment" };

const DEFAULT_MEDIA: MediaDraft = { camera: false, microphone: false, speaker: false, cameraFacing: "environment" };
const DEFAULT_CENTRAL: CentralDraft = { enabled: false, url: DEFAULT_ROBOT_CENTRAL_URL, token: "", robotName: "LOOI" };
const nativeMediaBackend = createNativeMediaBackend();
const publicAppCatalog = createAppCatalog();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function canonicalCentralEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim() || DEFAULT_ROBOT_CENTRAL_URL);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function safeHttpsUrl(value: unknown, appHost?: string | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const canonicalAppHost = typeof appHost === "string" && /^(?=.{1,63}\.hf\.space$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.hf\.space$/.test(appHost) ? appHost : null;
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !["huggingface.co", "www.huggingface.co", canonicalAppHost].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

export function RobotAppsScreen() {
  const { language } = useUiText();
  const t = useMemo(() => createRobotAppsTranslator(language), [language]);
  const skillText = useMemo(() => createRobotAppSkillsTranslator(language), [language]);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [savedConfiguration, setSavedConfiguration] = useState<RobotBridgeConfiguration | null>(null);
  const [companionUrl, setCompanionUrl] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [allowApproximation, setAllowApproximation] = useState(false);
  const [media, setMedia] = useState<MediaDraft>(DEFAULT_MEDIA);
  const [central, setCentral] = useState<CentralDraft>(DEFAULT_CENTRAL);
  const [page, setPage] = useState<AppsPage>("discover");
  const lastPrimary = useRef<AppsPage>("discover");
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [actionsDirty, setActionsDirty] = useState(false);
  const actionsDirtyRef = useRef(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus>(() => getRobotBridgeRuntimeStatus());
  const [mediaStatus, setMediaStatus] = useState<RobotMediaBackendStatus | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const actionLock = useRef(false);
  const stopGeneration = useRef(0);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [catalogStale, setCatalogStale] = useState(false);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [runner, setRunner] = useState<RunnerStatus>({ installed: [], running: null, jobs: [] });
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const catalogSequence = useRef(0);
  const runnerAbort = useRef<AbortController | null>(null);
  const launchAbort = useRef<AbortController | null>(null);

  const navigate = useCallback((next: AppsPage) => {
    setFeedback(null);
    if (page === "actions" && next !== "actions" && actionsDirtyRef.current) {
      Alert.alert(t("actionDiscardTitle"), t("actionDiscardMessage"), [
        { text: t("actionKeepEditing"), style: "cancel" },
        {
          text: t("actionDiscard"),
          style: "destructive",
          onPress: () => {
            actionsDirtyRef.current = false;
            setActionsDirty(false);
            setPage(next);
          },
        },
      ]);
      return;
    }
    if (page === "actions" && next !== "actions") {
      actionsDirtyRef.current = false;
      setActionsDirty(false);
    }
    if (["discover", "library", "skills"].includes(next)) lastPrimary.current = next;
    setPage(next);
  }, [page, t]);

  const updateActionsDirty = useCallback((dirty: boolean) => {
    actionsDirtyRef.current = dirty;
    setActionsDirty(dirty);
  }, []);

  useEffect(() => {
    if (["discover", "library", "skills"].includes(page)) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      navigate(page === "menu" ? lastPrimary.current : "menu");
      return true;
    });
    return () => subscription.remove();
  }, [navigate, page]);

  const refreshMedia = useCallback(async () => {
    setMediaLoading(true);
    try {
      const status = await nativeMediaBackend.inspect();
      setMediaStatus(status);
      setMediaError(null);
    } catch (error) {
      setMediaError(errorText(error));
    } finally {
      setMediaLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let previousMediaSignature: string | undefined;
    const unsubscribe = subscribeRobotBridgeRuntimeStatus((next) => {
      if (mounted) {
        setRuntime(next as RuntimeStatus);
        const mediaSnapshot = (next as RuntimeStatus).mediaStatus;
        const mediaSignature = [
          next.mediaOwner,
          mediaSnapshot?.phase,
          mediaSnapshot?.owner,
          mediaSnapshot?.request?.camera,
          mediaSnapshot?.request?.microphone,
          mediaSnapshot?.request?.speaker,
          mediaSnapshot?.camera.permission,
          mediaSnapshot?.camera.available,
          mediaSnapshot?.microphone.permission,
          mediaSnapshot?.microphone.available,
          mediaSnapshot?.speaker.routeActive,
        ].join("|");
        if (mediaSignature !== previousMediaSignature) {
          previousMediaSignature = mediaSignature;
          void refreshMedia();
        }
      }
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMedia();
    });
    void loadRobotBridgeConfiguration().then((config) => {
      if (!mounted) return;
      setSavedConfiguration(config);
      setCompanionUrl(config?.url ?? "");
      setAllowApproximation(config?.allowApproximation === true);
      setMedia({ ...DEFAULT_MEDIA, ...config?.media });
      setCentral({
        enabled: config?.central?.enabled ?? DEFAULT_CENTRAL.enabled,
        url: config?.central?.url ?? DEFAULT_CENTRAL.url,
        token: "",
        robotName: config?.central?.robotName ?? DEFAULT_CENTRAL.robotName,
      });
      setAdvancedExpanded(false);
      setConfigurationLoaded(true);
    }).catch((error) => {
      if (mounted) {
        setFeedback({ kind: "error", text: t("actionFailed", { error: errorText(error) }) });
        setPage("connection");
        setConfigurationLoaded(true);
      }
    });
    void refreshMedia();
    return () => {
      mounted = false;
      unsubscribe();
      appStateSubscription.remove();
      catalogSequence.current += 1;
      runnerAbort.current?.abort();
      launchAbort.current?.abort();
    };
  }, [refreshMedia, t]);

  const runtimeMedia = runtime.mediaStatus;
  const actualMedia = mediaStatus ?? runtimeMedia;
  const mediaOwner = runtimeMedia?.owner ?? runtime.mediaOwner;
  const hasSavedCompanionToken = (() => {
    if (!savedConfiguration?.url || !savedConfiguration.token || !companionUrl.trim()) return false;
    try { return normalizeRobotBridgeDeviceUrl(companionUrl.trim()) === savedConfiguration.url; }
    catch { return false; }
  })();

  const refreshRunnerStatus = useCallback(async () => {
    if (!savedConfiguration?.url || runtime.companionConnected !== true) return;
    runnerAbort.current?.abort();
    const controller = new AbortController();
    runnerAbort.current = controller;
    try {
      const next = await requestCompanion<RunnerStatus>("/api/apps/status", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRunner(next);
      setRunnerError(null);
    } catch (error) {
      if (!controller.signal.aborted) setRunnerError(errorText(error));
    }
  }, [savedConfiguration?.url, runtime.companionConnected]);

  useEffect(() => {
    if (runtime.companionConnected === true) void refreshRunnerStatus();
  }, [runtime.companionConnected, refreshRunnerStatus]);

  const loadCatalog = useCallback(async (force = false) => {
    const sequence = ++catalogSequence.current;
    setCatalogState("loading");
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setCatalogStale(false);
    setCatalogWarnings([]);
    setCatalogError(null);
    setFeedback(null);
    try {
      const result = await publicAppCatalog.list({
        limit: 60,
        query: catalogQuery.trim() || undefined,
        forceRefresh: force,
      });
      if (sequence !== catalogSequence.current) return;
      const items = Array.isArray(result.items) ? result.items as CatalogApp[] : [];
      setCatalog(items);
      setCatalogTotal(result.total ?? items.length);
      setCatalogStale(result.stale === true);
      setCatalogWarnings(Array.isArray(result.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === "string") : []);
      setCatalogState(items.length ? "ready" : "empty");
    } catch (error) {
      if (sequence !== catalogSequence.current) return;
      setCatalog([]);
      setCatalogState("error");
      setCatalogError(errorText(error));
      setCatalogWarnings([]);
    }
  }, [catalogQuery]);

  useEffect(() => {
    if (!configurationLoaded) return;
    const timer = setTimeout(() => { void loadCatalog(); }, catalogQuery ? 300 : 0);
    return () => {
      clearTimeout(timer);
      catalogSequence.current += 1;
    };
  }, [configurationLoaded, catalogQuery, loadCatalog]);

  const loadMoreCatalog = async () => {
    if (loadingMoreRef.current || catalog.length >= catalogTotal) return;
    const sequence = catalogSequence.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await publicAppCatalog.list({ query: catalogQuery.trim(), limit: 60, offset: catalog.length });
      if (sequence !== catalogSequence.current) return;
      setCatalog(previous => [...new Map([...previous, ...((result.items ?? []) as CatalogApp[])].map(app => [app.id, app])).values()]);
      setCatalogTotal(result.total ?? catalog.length);
    } catch (error) {
      if (sequence === catalogSequence.current) setFeedback({ kind: "error", text: t("appFailed", { error: errorText(error) }) });
    } finally {
      if (sequence === catalogSequence.current) { loadingMoreRef.current = false; setLoadingMore(false); }
    }
  };

  const activeJob = runner.running;
  const queuedInstall = runner.jobs?.find((job) => job.state === "running") ?? null;
  const runnerBusy = Boolean(activeJob && ["starting", "running", "stopping"].includes(activeJob.state) || queuedInstall);
  useEffect(() => {
    if (!runnerBusy) return;
    const timer = setInterval(() => { void refreshRunnerStatus(); }, 1500);
    return () => clearInterval(timer);
  }, [runnerBusy, refreshRunnerStatus]);

  const runAction = async (name: string, operation: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(name);
    setFeedback(null);
    try { await operation(); }
    catch (error) { setFeedback({ kind: "error", text: name.startsWith("app-") ? t("appFailed", { error: errorText(error) }) : t("actionFailed", { error: errorText(error) }) }); }
    finally { actionLock.current = false; setBusy(null); }
  };

  const saveConfiguration = async () => {
    const companionAddress = companionUrl.trim();
    let url = "";
    if (companionAddress) {
      try { url = normalizeRobotBridgeDeviceUrl(companionAddress); } catch {
        setPage("connection");
        setAdvancedExpanded(true);
        setFeedback({ kind: "error", text: t("urlInvalid") });
        return;
      }
    } else if (!central.enabled) {
      setPage("connection");
      setAdvancedExpanded(true);
      setFeedback({ kind: "error", text: t("setupCompanionFirst") });
      return;
    }
    const savedCompanionToken = savedConfiguration?.url === url ? savedConfiguration.token : "";
    const token = url ? tokenDraft.trim() || savedCompanionToken : "";
    if (url && !/^[a-f0-9]{32,128}$/i.test(token)) {
      setPage("connection");
      setAdvancedExpanded(true);
      setFeedback({ kind: "error", text: t("tokenInvalid") });
      return;
    }
    if (!url && tokenDraft.trim()) {
      setPage("connection");
      setAdvancedExpanded(true);
      setFeedback({ kind: "error", text: t("companionUrlForToken") });
      return;
    }
    const centralEndpoint = canonicalCentralEndpoint(central.url);
    const savedCentralEndpoint = savedConfiguration?.central
      ? canonicalCentralEndpoint(savedConfiguration.central.url)
      : null;
    const savedCentralToken = centralEndpoint !== null && centralEndpoint === savedCentralEndpoint
      ? savedConfiguration?.central?.token || ""
      : "";
    const centralToken = central.token.trim() || savedCentralToken;
    if (central.enabled && (!centralToken || central.robotName.trim().length < 2)) {
      setPage("connection");
      setFeedback({ kind: "error", text: t("centralMissing") });
      return;
    }
    if (central.enabled) {
      if (!centralEndpoint) {
        setPage("connection");
        setAdvancedExpanded(true);
        setFeedback({ kind: "error", text: t("centralUrlInvalid") });
        return;
      }
    }
    const config: RobotBridgeConfiguration = {
      url,
      token,
      allowApproximation,
      media: { ...media },
      central: {
        enabled: central.enabled,
        url: centralEndpoint || central.url.trim() || DEFAULT_ROBOT_CENTRAL_URL,
        token: centralToken,
        robotName: central.robotName.trim(),
        protocols: ["reachy", "microduck"],
      },
    };
    await runAction("save", async () => {
      const saveGeneration = stopGeneration.current;
      await configureRobotBridge(config);
      setSavedConfiguration(config);
      setTokenDraft("");
      setCentral((previous) => ({ ...previous, token: "" }));
      if (saveGeneration !== stopGeneration.current) { stopRobotBridge(); return; }
      setRuntime(getRobotBridgeRuntimeStatus());
      setFeedback({ kind: "success", text: t("saved") });
      void refreshMedia();
    });
  };

  const disableBridge = async () => {
    await runAction("disable", async () => {
      await Promise.resolve(stopRobotBridge());
      await configureRobotBridge(null);
      setSavedConfiguration(null);
      setPage("connection");
      setTokenDraft("");
      setRuntime(getRobotBridgeRuntimeStatus());
      setFeedback({ kind: "success", text: t("disabledDone") });
      setRunner({ installed: [], running: null, jobs: [] });
      setRunnerError(null);
    });
  };

  const stopRobot = () => {
    // STOP never waits for a catalog request or settings write to finish.
    stopGeneration.current += 1;
    launchAbort.current?.abort();
    stopRobotBridge();
    setRuntime(getRobotBridgeRuntimeStatus());
    setFeedback({ kind: "success", text: t("stopDone") });
    void refreshRunnerStatus();
  };

  const reconnect = async () => {
    await runAction("reconnect", async () => {
      await Promise.resolve(reconnectRobotBridge());
      setRuntime(getRobotBridgeRuntimeStatus());
    });
  };

  const appAction = async (path: string, body: unknown, app: CatalogApp, pinned?: { url: string; token: string }) => {
    if (!savedConfiguration?.url || runtime.companionConnected !== true) {
      setPage("connection");
      setAdvancedExpanded(true);
      setFeedback({ kind: "error", text: t("connectForAction") });
      return;
    }
    await runAction(`app-${app.spaceId}`, async () => {
      if (pinned) await requestConfiguredCompanion(pinned, path, { method: "POST", body });
      else await requestCompanion(path, { method: "POST", body });
      await refreshRunnerStatus();
      if (path === "/api/apps/uninstall") setFeedback({ kind: "success", text: t("appUninstalled") });
    });
  };

  const confirmInstall = (app: CatalogApp) => {
    if (!savedConfiguration?.url || runtime.companionConnected !== true) {
      setPage("connection");
      setAdvancedExpanded(true);
      setFeedback({ kind: "error", text: t("connectForAction") });
      return;
    }
    Alert.alert(t("installConfirmTitle"), t("installConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("installNow"), onPress: () => { void appAction("/api/apps/install", { spaceId: app.spaceId, revision: app.revision }, app); } },
    ]);
  };

  const confirmUninstall = (app: InstalledApp) => {
    if (!savedConfiguration?.url) return;
    const pinned = { url: savedConfiguration.url, token: savedConfiguration.token };
    Alert.alert(t("uninstallTitle"), t("uninstallBody", { app: app.title ?? app.spaceId }), [
      { text: t("cancel"), style: "cancel" },
      { text: t("uninstall"), style: "destructive", onPress: () => {
        void appAction("/api/apps/uninstall", { spaceId: app.spaceId }, app as CatalogApp, pinned);
      } },
    ]);
  };

  const openExternal = async (value: unknown, appHost?: string | null) => {
    const url = safeHttpsUrl(value, appHost);
    if (!url) {
      setFeedback({ kind: "error", text: t("catalogOffline") });
      return;
    }
    try { await Linking.openURL(url); }
    catch (error) { setFeedback({ kind: "error", text: t("appFailed", { error: errorText(error) }) }); }
  };

  const openHosted = async (value: unknown, appHost: string | null | undefined) => {
    const url = safeHttpsUrl(value, appHost);
    if (!url) {
      setFeedback({ kind: "error", text: t("catalogOffline") });
      return;
    }
    await runAction("open-hosted", async () => {
      const controller = new AbortController();
      launchAbort.current?.abort();
      launchAbort.current = controller;
      const generation = stopGeneration.current;
      try {
        const prepared = await prepareRobotAppConnection({ signal: controller.signal });
        if (controller.signal.aborted || generation !== stopGeneration.current) return;
        if (!prepared) {
          setPage("connection");
          setFeedback({ kind: "error", text: t("centralMissing") });
          return;
        }
        if (controller.signal.aborted || generation !== stopGeneration.current) return;
        await WebBrowser.openBrowserAsync(url);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (launchAbort.current === controller) launchAbort.current = null;
      }
    });
  };

  const installed = runner.installed ?? [];
  const managedApps = [...installed];
  if (runner.running?.spaceId && !managedApps.some((app) => app.spaceId === runner.running?.spaceId)) {
    managedApps.unshift({ spaceId: runner.running.spaceId, title: runner.running.title, state: runner.running.state });
  }
  const savedCentral = savedConfiguration?.central;
  const centralStatus = runtime.central?.universal?.state;
  const centralPreparationBusy = (busy === "save" && central.enabled) || busy === "open-hosted";
  const centralStatusLabel = centralStatus && centralStatus !== "stopped"
    ? centralConnectionLabel(centralStatus)
    : centralPreparationBusy ? t("stateConnecting")
      : runtime.phase === "error" && (savedCentral?.enabled || central.enabled)
        ? t("stateError")
        : centralConnectionLabel(centralStatus);
  const centralConnected = savedCentral?.enabled === true && centralStatus === "connected";
  const anyConnected = runtime.phase === "connected" || runtime.companionConnected === true || centralConnected;
  const stateLabel = anyConnected ? t("stateConnected")
    : runtime.phase === "connecting" ? t("stateConnecting")
      : runtime.phase === "error" ? t("stateError") : t("stateDisabled");
  const stateColor = anyConnected ? looiTheme.ok
    : runtime.phase === "connecting" ? looiTheme.warn
      : runtime.phase === "error" ? looiTheme.danger : looiTheme.muted;

  function centralConnectionLabel(state: CentralConnectionStatus["state"] | undefined): string {
    switch (state) {
      case "connected": return t("stateConnected");
      case "connecting": return t("stateConnecting");
      case "reconnecting": return t("stateReconnecting");
      default: return t("stateDisabled");
    }
  }

  function permissionLabel(permission: string | undefined): string {
    switch (permission) {
      case "granted": return t("permissionGranted");
      case "denied": return t("permissionDenied");
      case "prompt": return t("permissionPrompt");
      case "unavailable": return t("permissionUnavailable");
      default: return t("permissionUnknown");
    }
  }

  function mediaSummary(kind: "camera" | "microphone" | "speaker"): string {
    const requested = runtimeMedia?.request?.[kind];
    if (mediaOwner && requested === true) return t("mediaActive", { owner: mediaOwner });
    if (!media[kind]) return t("mediaDisabled");
    if (kind === "speaker") {
      if (actualMedia && (!actualMedia.speaker.supported || actualMedia.speaker.available === false)) return t("permissionUnavailable");
      return t("mediaWaiting");
    }
    const permission = actualMedia?.[kind].permission;
    if (permission === "denied") return t("mediaPermission", { state: permissionLabel(permission) });
    if (actualMedia && (!actualMedia[kind].supported || actualMedia[kind].available === false)) return t("permissionUnavailable");
    return t("mediaWaiting");
  }

  const isPrimary = page === "discover" || page === "library" || page === "skills";
  const pageTitle = isPrimary ? t("title") : page === "menu" ? t("appSetup")
    : t(page === "connection" ? "connectionSettings" : page === "media" ? "cameraAudio" : "actionMapping");
  const enabledMediaCount = [savedConfiguration?.media?.camera, savedConfiguration?.media?.microphone, savedConfiguration?.media?.speaker].filter(Boolean).length;

  const connectionStrip = (
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusCopy}>
              <View style={styles.statusHead}>
                {runtime.phase === "connecting" ? <ActivityIndicator color={looiTheme.cyan} size="small" /> : <View style={[styles.statusDot, { backgroundColor: stateColor }]} />}
                <Text style={styles.statusTitle}>{stateLabel}</Text>
              </View>
              {runner.running?.state === "running" ? <Text style={styles.help}>{runner.running.title ?? runner.running.spaceId}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("stopRobot")} onPress={stopRobot} style={styles.stopControl}><RobotAppsGlyph name="stop" size={13} color={looiTheme.danger} /><Text style={styles.stopControlText}>{t("appStopShort")}</Text></Pressable>
          </View>
          {runtime.message ? <Text style={styles.help}>{runtime.message}</Text> : null}
          {page === "connection" ? <>
            {savedConfiguration?.url ? <Text style={styles.help}>{t("companionStatusLine", { state: runtime.companionConnected === true ? t("stateConnected") : t("stateDisabled") })}</Text> : null}
            {savedCentral?.enabled ? <Text style={styles.help}>{t("centralStatusLine", { state: centralStatusLabel })}</Text> : null}
          </> : null}
        </View>
  );

  return (
    <RobotAppsShell key={page} title={pageTitle}
      backLabel={isPrimary ? "LOOI" : page === "menu" ? t("title") : t("appSetup")}
      onBack={() => isPrimary ? router.replace("/") : navigate(page === "menu" ? lastPrimary.current : "menu")}
      status={connectionStrip} compactTitle={!isPrimary && page !== "menu"} setupLabel={t("appSetup")} onSetup={isPrimary ? () => navigate("menu") : undefined}
      tabs={isPrimary ? <View style={[styles.segmented, wide && styles.segmentedWide]}>
        {([ ["discover", "discoverTab"], ["library", "libraryTab"], ["skills", "smartApps"] ] as const).map(([next, label]) =>
          <Pressable key={next} accessibilityRole="tab" accessibilityState={{ selected: page === next }}
            aria-selected={page === next} onPress={() => navigate(next)} style={[styles.segment, page === next && styles.segmentActive]}>
            <Text style={[styles.segmentText, page === next && styles.segmentTextActive]}>{t(label)}</Text>
          </Pressable>)}
      </View> : undefined}>
      <View style={styles.content}>
        {page === "menu" ? <View style={styles.menuSections}>
          <Text style={styles.intro}>{t("setupIntro")}</Text>
          <View style={styles.menuGroup}>
            <MenuRow title={t("connectionSettings")} detail={!savedConfiguration ? t("setupConnection") : t("connectionSettingsDetail")} glyph="link" onPress={() => navigate("connection")} />
            <View style={styles.menuDivider} />
            <MenuRow title={t("cameraAudio")} detail={enabledMediaCount ? t("enabledDevices", { count: enabledMediaCount }) : t("cameraAudioDetail")} glyph="camera" onPress={() => navigate("media")} />
            <View style={styles.menuDivider} />
            <MenuRow title={t("actionMapping")} detail={actionsDirty ? t("actionUnsaved") : t("actionMappingDetail")} glyph="actions" onPress={() => navigate("actions")} />
          </View>
        </View> : null}

        {page === "discover" ? <View style={styles.stack}>
          <Text style={styles.intro}>{t("discoverIntro")}</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <RobotAppsGlyph name="search" size={20} color={looiTheme.muted} />
              <TextInput accessibilityLabel={t("searchApps")} value={catalogQuery} onChangeText={setCatalogQuery} placeholder={t("searchApps")}
                placeholderTextColor={looiTheme.muted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.searchInput} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={catalogState === "loading"}
              onPress={() => void loadCatalog(true)} style={styles.refreshButton}>
              <RobotAppsGlyph name="refresh" size={21} color={looiTheme.cyan} />
            </Pressable>
          </View>
          {catalogState === "loading" ? <StatusMessage loading text={t("loadingCatalog")} /> : null}
          {catalogStale && catalogState === "ready" ? <Text style={styles.help}>{t("catalogStale")}</Text> : null}
          {catalogWarnings.length && (catalogState === "ready" || catalogState === "empty") ? <View style={styles.catalogWarnings}><Text style={styles.fieldLabel}>{t("catalogSourcesFailed")}</Text>{catalogWarnings.map((warning, index) => <Text key={`catalog-warning-${index}`} style={styles.error}>{warning}</Text>)}</View> : null}
          {catalogState === "error" ? <StatusMessage error text={t("catalogOffline")} /> : null}
          {catalogError && catalogState === "error" ? <Text style={styles.error}>{catalogError}</Text> : null}
          {catalogState === "empty" ? <Text style={styles.help}>{t("catalogEmpty")}</Text> : null}
          <View style={styles.appGrid}>
          {(catalogState === "ready" ? catalog : []).map((app) => {
            const installation = installed.find((item) => item.spaceId === app.spaceId);
            const launchUrl = safeHttpsUrl(app.launch?.url ?? app.url, app.launch?.appHost);
            const isRunning = runner.running?.spaceId === app.spaceId && runner.running.state === "running";
            return <View key={app.id} style={[styles.appCard, wide && styles.appCardWide]}>
              <View style={styles.appIdentity}>
                <AppMark title={app.title} web={app.kind === "web"} />
                <View style={styles.appIdentityCopy}><Text style={styles.appTitle}>{app.title}</Text>
                  <Text style={styles.appMeta}>{t("appFrom", { author: app.author ?? app.spaceId.split("/")[0] ?? "" })}</Text></View>
              </View>
              {app.description ? <Text numberOfLines={3} style={styles.appDescription}>{app.description}</Text> : null}
              <View style={styles.appFooter}>
                <Pressable accessibilityRole="button" onPress={() => void openExternal(app.url)} style={styles.detailLink}><Text style={styles.detailText}>{t("appDetails")}</Text></Pressable>
                <View style={styles.appPrimaryAction}>
                  {app.kind === "web" && launchUrl ? <Action label={t("openHosted")} onPress={() => void openHosted(launchUrl, app.launch?.appHost)} disabled={Boolean(busy)} /> : null}
                  {app.kind === "python" && installation ? <Action label={isRunning ? t("stopApp") : t("start")} danger={isRunning}
                    onPress={() => void appAction(isRunning ? "/api/apps/stop" : "/api/apps/start", isRunning ? {} : { spaceId: app.spaceId }, app)} disabled={Boolean(busy) || (!isRunning && runnerBusy)} /> : null}
                  {app.kind === "python" && app.installable && !installation ? <Action label={busy === `app-${app.spaceId}` ? "…" : t("install")} onPress={() => confirmInstall(app)} disabled={Boolean(busy) || runnerBusy} /> : null}
                </View>
              </View>
            </View>;
          })}
          </View>
          {catalogState === "ready" && catalog.length < catalogTotal ? <Action label={loadingMore ? t("loadingCatalog") : t("moreApps")} secondary onPress={() => void loadMoreCatalog()} disabled={loadingMore} /> : null}
        </View> : null}

        {page === "library" ? <View style={styles.stack}>
          {managedApps.length ? <View style={styles.menuGroup}>{managedApps.map((app) => {
            const isCurrent = runner.running?.spaceId === app.spaceId;
            const currentState = isCurrent ? runner.running?.state : null;
            const isRunning = currentState === "running";
            const isTransitioning = currentState === "starting" || currentState === "stopping";
            return <View key={app.spaceId} style={styles.installedRow}>
              <AppMark title={app.title ?? app.spaceId} />
              <View style={styles.installedCopy}>
                <Text style={styles.appTitle}>{app.title ?? app.spaceId}</Text>
                <Text style={styles.help}>{isRunning ? t("appRunning", { app: app.title ?? app.spaceId }) : currentState === "starting" ? t("appStarting", { app: app.title ?? app.spaceId }) : currentState === "stopping" ? t("appStopping") : t("installed")}</Text>
              </View>
              <View style={styles.installedActions}>
                {isRunning ? <Action label={t("stopApp")} danger onPress={() => void appAction("/api/apps/stop", {}, app as CatalogApp)} disabled={Boolean(busy)} /> : <Action label={isTransitioning ? t("stateConnecting") : t("start")} onPress={() => void appAction("/api/apps/start", { spaceId: app.spaceId }, app as CatalogApp)} disabled={Boolean(busy) || runnerBusy} />}
                <Pressable accessibilityRole="button" accessibilityLabel={`${t("uninstall")}: ${app.title ?? app.spaceId}`} onPress={() => confirmUninstall(app)} disabled={Boolean(busy) || runnerBusy} style={[styles.removeButton, (Boolean(busy) || runnerBusy) && styles.disabled]}>
                  <RobotAppsGlyph name="trash" size={20} color={looiTheme.muted} />
                </Pressable>
              </View>
            </View>;
          })}</View> : <View style={styles.emptyLibrary}>
            <SymbolView name={{ ios: "square.stack.3d.up", android: "apps" }} size={36} tintColor={looiTheme.cyan} />
            <Text style={styles.emptyLibraryText}>{t(runtime.companionConnected === true ? "libraryEmpty" : "libraryConnect")}</Text>
            <Action label={t(runtime.companionConnected === true ? "browseApps" : "connectionSettings")} onPress={() => navigate(runtime.companionConnected === true ? "discover" : "connection")} />
          </View>}
          {managedApps.length ? <Action label={t("browseApps")} secondary onPress={() => navigate("discover")} /> : null}
          {managedApps.length && runnerBusy ? <Text style={styles.help}>{t("uninstallStopFirst")}</Text> : null}
        </View> : null}

        {page === "discover" || page === "library" ? <>
          {queuedInstall ? <Text style={styles.help}>{t("installRunning", { app: queuedInstall.spaceId, phase: queuedInstall.phase })}</Text> : null}
          {runner.jobs?.filter(job => job.state === "error" && job.error).slice(-1).map(job => <Text key={job.id} accessibilityRole="alert" style={styles.error}>{t("appFailed", { error: `${job.spaceId}: ${job.error}` })}</Text>)}
          {runner.running?.error ? <Text accessibilityRole="alert" style={styles.error}>{t("appFailed", { error: runner.running.error })}</Text> : null}
          {runnerError ? <Text style={styles.error}>{t("appFailed", { error: runnerError })}</Text> : null}
        </> : null}

        {page === "media" ? <View style={styles.stack}>
          <Text style={styles.help}>{t("mediaHelp")}</Text>
          <Toggle label={t("camera")} value={media.camera} onValueChange={(camera) => setMedia((previous) => ({ ...previous, camera }))} detail={mediaSummary("camera")} />
          <Toggle label={t("microphone")} value={media.microphone} onValueChange={(microphone) => setMedia((previous) => ({ ...previous, microphone }))} detail={mediaSummary("microphone")} />
          <Toggle label={t("speaker")} value={media.speaker} onValueChange={(speaker) => setMedia((previous) => ({ ...previous, speaker }))} detail={mediaSummary("speaker")} />
          {media.camera ? <View style={styles.choiceBlock}>
            <Text style={styles.fieldLabel}>{t("cameraFacing")}</Text>
            <View style={styles.choiceRow}>
              <Choice label={t("facingEnvironment")} selected={media.cameraFacing === "environment"} onPress={() => setMedia((previous) => ({ ...previous, cameraFacing: "environment" }))} />
              <Choice label={t("facingUser")} selected={media.cameraFacing === "user"} onPress={() => setMedia((previous) => ({ ...previous, cameraFacing: "user" }))} />
            </View>
          </View> : null}
          <View style={styles.mediaStatusLine}>
            {mediaLoading ? <ActivityIndicator size="small" color={looiTheme.cyan} /> : <View style={[styles.statusDot, { backgroundColor: mediaError ? looiTheme.danger : looiTheme.ok }]} />}
            <Text style={styles.help}>{mediaLoading ? t("mediaLoading") : mediaError ? t("mediaError") : `${t("camera")}: ${permissionLabel(actualMedia?.camera.permission)} · ${t("microphone")}: ${permissionLabel(actualMedia?.microphone.permission)}`}</Text>
          </View>
          {mediaError ? <Text style={styles.error}>{mediaError}</Text> : null}
          {actualMedia?.camera.permission === "denied" || actualMedia?.microphone.permission === "denied" ? <Action label={t("openSettings")} secondary onPress={() => void Linking.openSettings()} /> : null}
          <Action label={t("saveSettings")} secondary onPress={() => void saveConfiguration()} disabled={Boolean(busy) || !configurationLoaded} />
        </View> : null}

        {page === "actions" ? <RobotAppActionsPanel onDirtyChange={updateActionsDirty} /> : null}
        {page === "skills" ? <RobotAppSkillsPanel companionReady={runtime.companionConnected === true} onBrowse={() => navigate("discover")} onSetup={() => { navigate("connection"); setAdvancedExpanded(true); }} /> : null}

        {page === "connection" ? <View style={styles.stack}>
          <Section title={t("central")}>
              <Toggle label={t("centralEnable")} value={central.enabled} onValueChange={(enabled) => setCentral((previous) => ({ ...previous, enabled }))} />
              <Field label={t("centralName")} value={central.robotName} onChangeText={(robotName) => setCentral((previous) => ({ ...previous, robotName }))} placeholder="LOOI" autoCapitalize="words" />
              <Field label={t("centralToken")} value={central.token} onChangeText={(token) => setCentral((previous) => ({ ...previous, token }))} placeholder={savedConfiguration?.central?.token ? "••••••••••••••••" : "hf_…"} secureTextEntry autoCapitalize="none" autoCorrect={false} />
              {savedConfiguration?.central?.token ? <Text style={styles.help}>{t("tokenSaved")}</Text> : null}
              {savedCentral?.enabled || central.enabled ? <Text style={styles.help}>{t("centralStatusLine", { state: centralStatusLabel })}</Text> : null}
          </Section>
          <View style={styles.advancedSection}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: advancedExpanded }} onPress={() => setAdvancedExpanded((value) => !value)} style={styles.disclosure}>
              <Text style={styles.disclosureTitle}>{t("advancedSettings")}</Text>
              <SymbolView name={{ ios: advancedExpanded ? "chevron.up" : "chevron.down", android: advancedExpanded ? "expand_less" : "expand_more" }} size={17} tintColor={looiTheme.muted} />
            </Pressable>
            {advancedExpanded ? <View style={styles.stack}>
              <Field label={t("centralUrl")} value={central.url} onChangeText={(url) => setCentral((previous) => ({ ...previous, url }))} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("companionSettings")}</Text>
              <Field label={t("companionUrl")} value={companionUrl} onChangeText={setCompanionUrl} placeholder="ws://companion.local:8000/device" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Field label={t("companionToken")} value={tokenDraft} onChangeText={setTokenDraft} placeholder={hasSavedCompanionToken ? "••••••••••••••••" : t("tokenNeeded")} secureTextEntry autoCapitalize="none" autoCorrect={false} />
              <Text style={styles.help}>{hasSavedCompanionToken ? t("tokenSaved") : t("tokenNeeded")}</Text>
              <Toggle label={t("movementAdaptation")} value={allowApproximation} onValueChange={setAllowApproximation} />
              <Text style={styles.help}>{t("movementAdaptationHelp")}</Text>
            </View> : null}
          </View>
          <Action label={busy === "save" ? t("stateConnecting") : t("connect")} onPress={() => void saveConfiguration()} disabled={Boolean(busy) || !configurationLoaded} />
          {savedConfiguration ? <View style={styles.actionRow}>
            <Action label={t("reconnect")} secondary onPress={() => void reconnect()} disabled={Boolean(busy)} />
            <Action label={t("disable")} secondary onPress={() => void disableBridge()} disabled={Boolean(busy)} />
          </View> : null}
        </View> : null}

        {feedback ? <Text accessibilityRole="alert" style={feedback.kind === "error" ? styles.error : styles.success}>{feedback.text}</Text> : null}
        {busy ? <View style={styles.busyLine}><ActivityIndicator color={looiTheme.cyan} size="small" /><Text style={styles.help}>{t("actionBusy")}</Text></View> : null}
      </View>
    </RobotAppsShell>
  );
}

function AppMark({ title, web = false }: { title: string; web?: boolean }) {
  return <View style={[styles.appMark, web && styles.appMarkWeb]}>
    <SymbolView name={{ ios: web ? "globe" : "square.stack.3d.up.fill", android: web ? "language" : "apps" }} size={26}
      tintColor={web ? "#95d9bf" : looiTheme.cyan} fallback={<Text style={styles.appMarkText}>{Array.from(title.trim())[0]?.toUpperCase()}</Text>} />
  </View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text><View style={styles.stack}>{children}</View></View>;
}

function MenuRow({ title, detail, glyph = "settings", onPress, primary }: {
  title: string; detail: string; glyph?: AppsGlyphName; onPress: () => void; primary?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={[styles.menuRow, pressed && styles.menuRowPressed]}>
    <View style={[styles.menuIcon, primary && styles.menuIconPrimary]}>
      <RobotAppsGlyph name={glyph} size={24} color={primary ? looiTheme.cyan : looiTheme.text} />
    </View>
    <View style={styles.menuCopy}>
      <Text style={styles.menuTitle}>{title}</Text>
      <Text style={styles.menuDetail}>{detail}</Text>
    </View>
    <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={16} tintColor={looiTheme.muted} />
  </Pressable>;
}

function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} accessibilityLabel={label} placeholderTextColor={looiTheme.muted} style={styles.input} /></View>;
}

function Toggle({ label, value, onValueChange, detail }: { label: string; value: boolean; onValueChange: (value: boolean) => void; detail?: string }) {
  return <View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.fieldLabel}>{label}</Text>{detail ? <Text style={styles.help}>{detail}</Text> : null}</View><Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{ false: looiTheme.line, true: "rgba(40,213,255,0.42)" }} thumbColor={value ? looiTheme.cyan : looiTheme.muted} /></View>;
}

function Choice({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected, disabled && styles.disabled]}>{selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={13} tintColor={looiTheme.cyan} /> : null}<Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function Action({ label, onPress, disabled, secondary, danger }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && styles.disabled]}><Text style={[styles.actionText, secondary && styles.actionSecondaryText, danger && styles.actionDangerText]}>{label}</Text></Pressable>;
}

function StatusMessage({ text, loading, error }: { text: string; loading?: boolean; error?: boolean }) {
  return <View style={styles.statusMessage}>{loading ? <ActivityIndicator color={looiTheme.cyan} size="small" /> : null}<Text style={error ? styles.error : styles.help}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  segmentedWide: { maxWidth: 600 },
  segmented: { flexDirection: "row", borderRadius: 12, padding: 4, backgroundColor: "#122332", gap: 4 },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 10, borderRadius: 9 },
  segmentActive: { backgroundColor: "#284050" },
  segmentText: { color: looiTheme.muted, fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  segmentTextActive: { color: looiTheme.text },
  intro: { color: looiTheme.muted, fontSize: 17, lineHeight: 25 },
  stopControl: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, backgroundColor: "rgba(255,92,122,0.1)" },
  stopControlText: { color: looiTheme.danger, fontWeight: "600", fontSize: 14 },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  searchBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52, borderRadius: 14, backgroundColor: "#122332" },
  searchInput: { flex: 1, minWidth: 0, color: looiTheme.text, minHeight: 52, fontSize: 16, paddingVertical: 12 },
  refreshButton: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
  appIdentity: { flexDirection: "row", gap: 14, alignItems: "center" },
  appIdentityCopy: { flex: 1, minWidth: 0, gap: 4 },
  appMark: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#123744" },
  appMarkWeb: { backgroundColor: "#173b36" },
  appMarkText: { color: looiTheme.cyan, fontSize: 22, fontWeight: "600" },
  appFooter: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", marginTop: "auto" },
  appPrimaryAction: { flexShrink: 1 },
  detailLink: { minHeight: 44, paddingRight: 12, justifyContent: "center" },
  detailText: { color: looiTheme.cyan, fontSize: 15, fontWeight: "500" },
  removeButton: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  content: { gap: 24, paddingBottom: 16, width: "100%", alignSelf: "center" },
  menuSections: { gap: 24 },
  menuGroup: { borderRadius: 16, backgroundColor: "#0d1b29", overflow: "hidden" },
  menuRow: { minHeight: 84, flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  menuRowPressed: { backgroundColor: looiTheme.whiteSoft },
  menuIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: looiTheme.whiteSoft },
  menuIconPrimary: { backgroundColor: "rgba(40,213,255,0.12)" },
  menuCopy: { flex: 1, minWidth: 0, gap: 5 },
  menuTitle: { color: looiTheme.text, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  menuDetail: { color: looiTheme.muted, fontSize: 13, lineHeight: 19 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: looiTheme.line, marginLeft: 54 },
  emptyLibrary: { alignItems: "center", paddingHorizontal: 20, paddingVertical: 36, gap: 20 },
  emptyLibraryText: { color: looiTheme.muted, fontSize: 15, lineHeight: 23, textAlign: "center", maxWidth: 320 },
  section: { borderRadius: 16, backgroundColor: "#0d1b29", padding: 20, gap: 16 },
  sectionTitle: { color: looiTheme.text, fontSize: 17, fontWeight: "800" },
  stack: { gap: 12 },
  statusCard: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: looiTheme.whiteSoft, paddingBottom: 16, gap: 8 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  statusCopy: { flex: 1, flexBasis: 120, gap: 5, minWidth: 100 },
  statusHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusTitle: { color: looiTheme.text, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  help: { color: looiTheme.muted, fontSize: 15, lineHeight: 22 },
  field: { gap: 6 },
  fieldLabel: { color: looiTheme.text, fontSize: 16, lineHeight: 23, fontWeight: "500" },
  input: { color: looiTheme.text, minHeight: 52, borderRadius: 12, backgroundColor: "#122332", paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  toggleRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 12 },
  toggleCopy: { flex: 1, gap: 3 },
  choiceBlock: { gap: 8 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  choice: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 },
  choiceSelected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40,213,255,0.08)" },
  choiceText: { color: looiTheme.muted, fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: looiTheme.text },
  actionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  action: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: looiTheme.cyan, paddingHorizontal: 13, paddingVertical: 9 },
  actionText: { color: looiTheme.bg, fontWeight: "600", fontSize: 15, lineHeight: 21, textAlign: "center" },
  actionSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: looiTheme.line },
  actionSecondaryText: { color: looiTheme.text },
  actionDanger: { backgroundColor: "transparent", borderWidth: 1, borderColor: looiTheme.danger },
  actionDangerText: { color: looiTheme.danger },
  disabled: { opacity: 0.45 },
  mediaStatusLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  advancedSection: { gap: 12 },
  disclosure: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  disclosureTitle: { color: looiTheme.muted, fontWeight: "600", fontSize: 14 },
  installedRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, padding: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: looiTheme.whiteSoft },
  installedCopy: { flex: 1, minWidth: 120, gap: 5 },
  installedActions: { width: "100%", flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center", gap: 12 },
  appGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  appCard: { width: "100%", backgroundColor: "#0d1b29", borderRadius: 16, padding: 20, gap: 16 },
  appCardWide: { width: "48%" },
  appTitle: { color: looiTheme.text, fontSize: 18, lineHeight: 24, fontWeight: "600" },
  appMeta: { color: looiTheme.muted, fontSize: 13, lineHeight: 19 },
  appDescription: { color: looiTheme.muted, fontSize: 15, lineHeight: 22 },
  catalogWarnings: { gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: looiTheme.line, paddingTop: 8 },
  statusMessage: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  busyLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingVertical: 5 },
  success: { color: looiTheme.ok, fontSize: 13, lineHeight: 18 },
  error: { color: looiTheme.danger, fontSize: 12, lineHeight: 17 },
});

