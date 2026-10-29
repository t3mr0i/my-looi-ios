import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createRobotCore } from "./core";
import { createLooiBackend } from "./looi-backend";
import { connectRobotBridgeDevice, normalizeRobotBridgeDeviceUrl } from "./device-connection";
import { createRobotGateway, type RobotGatewayProtocol } from "./gateway";
import { createRobotAppMediaServices } from "./app-media-services";
import { EMPTY_ROBOT_APP_ACTION_PROFILE, isRobotAppActionSource, normalizeRobotAppActionProfile, type RobotAppActionProfile } from "./action-profile";
import type { RobotResult } from "./types";
import type { RobotMediaBroker, RobotMediaRequest, RobotMediaStatus } from "./media-broker";
import type { RobotWebRtcPeerOptions } from "./webrtc-peer";
import { useUserStore } from "../store/user";
import { enterDrivingControlSession, exitDrivingControlSession } from "../voice/driving-control-session";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { markRobotInteraction } from "../core/robot-inactivity";

const CONFIG_KEY = "looi-robot-bridge-v1";
const ACTION_PROFILE_KEY = "looi-robot-app-actions-v1";
export const DEFAULT_ROBOT_CENTRAL_URL = "https://pollen-robotics-reachy-mini-central.hf.space";
export type RobotBridgeConfiguration = {
  url: string; token: string; allowApproximation: boolean;
  media?: RobotMediaRequest;
  central?: { enabled: boolean; url: string; token: string; robotName: string; protocols: ("reachy" | "microduck")[] };
};
export type RobotBridgeRuntimeStatus = {
  phase: "disabled" | "connecting" | "connected" | "error";
  message: string | null; mediaOwner: string | null; mediaStatus?: RobotMediaStatus;
  companionConnected: boolean;
  central: Partial<Record<RobotGatewayProtocol, {
    state: "stopped" | "connecting" | "connected" | "reconnecting";
    peerId: string | null; sessionId: string | null; reconnectAttempt: number;
  }>>;
};
export type RobotBridgeReleaseCause =
  | "runtime-start" | "configuration-change" | "reconnect" | "app-state-change" | "sleep-state-change"
  | "user-stop" | "app-launch-cancelled" | "startup-failed" | "external-robot-stop" | "runtime-uninstalled" | "action-profile-change";
let reload: ((cause?: RobotBridgeReleaseCause) => void) | null = null;
let stopRuntime: ((cause?: RobotBridgeReleaseCause) => void) | null = null;
let previewAction: ((name: string) => Promise<RobotResult>) | null = null;
let releaseRevision = 0;
let actionProfileWrites: Promise<void> = Promise.resolve();
let actionProfileWriteSequence = 0;
let status: RobotBridgeRuntimeStatus = { phase: "disabled", message: null, mediaOwner: null, companionConnected: false, central: {} };
const listeners = new Set<(state: RobotBridgeRuntimeStatus) => void>();
const releaseListeners = new Set<(cause: RobotBridgeReleaseCause) => void>();
const publish = (patch: Partial<RobotBridgeRuntimeStatus>) => {
  status = { ...status, ...patch };
  for (const listener of listeners) { try { listener(getRobotBridgeRuntimeStatus()); } catch { /* observers do not own devices */ } }
};
export const getRobotBridgeRuntimeStatus = (): RobotBridgeRuntimeStatus => JSON.parse(JSON.stringify(status));
export function subscribeRobotBridgeRuntimeStatus(listener: (state: RobotBridgeRuntimeStatus) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function subscribeRobotBridgeRelease(listener: (cause: RobotBridgeReleaseCause) => void) {
  releaseListeners.add(listener); return () => { releaseListeners.delete(listener); };
}
export function stopRobotBridge(): void { stopRuntime?.("user-stop"); }
export function reconnectRobotBridge(): void { reload?.("reconnect"); }

/** Action preferences are independent of network setup and never contain credentials. */
export async function loadRobotAppActionProfile(): Promise<RobotAppActionProfile> {
  const raw = await SecureStore.getItemAsync(ACTION_PROFILE_KEY);
  try {
    return normalizeRobotAppActionProfile(raw ? JSON.parse(raw) : EMPTY_ROBOT_APP_ACTION_PROFILE);
  } catch {
    recordDiagnosticEvent("runtime", "robot-app-action-profile-invalid", { reason: "invalid-profile" });
    return normalizeRobotAppActionProfile(EMPTY_ROBOT_APP_ACTION_PROFILE);
  }
}

export async function configureRobotAppActions(input: RobotAppActionProfile): Promise<void> {
  const profile = normalizeRobotAppActionProfile(input);
  const revision = releaseRevision;
  const sequence = ++actionProfileWriteSequence;
  const installedReload = reload;
  const writing = actionProfileWrites.catch(() => undefined)
    .then(() => SecureStore.setItemAsync(ACTION_PROFILE_KEY, JSON.stringify(profile)));
  actionProfileWrites = writing;
  await writing;
  // A delayed preferences write must never reconnect after STOP or suspension.
  if (sequence === actionProfileWriteSequence && releaseRevision === revision && reload === installedReload) reload?.("action-profile-change");
}

export async function previewRobotAppAction(name: string): Promise<RobotResult> {
  if (!previewAction) throw new Error("Robot app runtime is not available");
  return previewAction(name);
}

function normalizeConfiguration(input: RobotBridgeConfiguration): RobotBridgeConfiguration {
  if (typeof input.url !== "string" || typeof input.token !== "string") throw new Error("Invalid robot app connection");
  const url = input.url ? normalizeRobotBridgeDeviceUrl(input.url) : "";
  if ((url && !/^[a-f0-9]{32,128}$/i.test(input.token)) || (!url && input.token)) throw new Error("Invalid robot bridge pairing token");
  const configuration: RobotBridgeConfiguration = { url, token: input.token, allowApproximation: input.allowApproximation === true };
  if (input.media) {
    const media = input.media;
    if ([media.camera, media.microphone, media.speaker].some(value => typeof value !== "boolean")
      || (media.cameraFacing !== undefined && !["user", "environment"].includes(media.cameraFacing))) throw new Error("Invalid robot bridge media configuration");
    configuration.media = { camera: media.camera, microphone: media.microphone, speaker: media.speaker, cameraFacing: media.cameraFacing ?? "environment" };
  }
  if (input.central) {
    const central = input.central;
    const centralUrl = new URL(central.url || DEFAULT_ROBOT_CENTRAL_URL);
    if (centralUrl.protocol !== "https:" || !centralUrl.hostname || centralUrl.username || centralUrl.password || centralUrl.search || centralUrl.hash) throw new Error("Central requires a credential-free HTTPS URL");
    if (central.enabled && (typeof central.token !== "string" || central.token.length < 8 || central.token.length > 4096 || /\s/.test(central.token))) throw new Error("Enter a valid Hugging Face access token");
    if (typeof central.robotName !== "string" || !central.robotName.trim() || central.robotName.length > 64 || /[\x00-\x1f]/.test(central.robotName)) throw new Error("Invalid Central robot name");
    if (!Array.isArray(central.protocols) || central.protocols.some(value => !["reachy", "microduck"].includes(value))) throw new Error("Invalid robot app protocol configuration");
    const enabled = central.enabled === true;
    // Preserve the legacy field for stored-config compatibility, while the
    // enabled Central connection now advertises one universal producer.
    configuration.central = { enabled, url: centralUrl.toString().replace(/\/$/, ""), token: central.token || "", robotName: central.robotName.trim(), protocols: enabled ? ["reachy", "microduck"] : central.protocols.slice() };
  }
  if (!url && !configuration.central?.enabled) throw new Error("Connect Hugging Face Central or enter a companion address");
  return configuration;
}

export async function loadRobotBridgeConfiguration(): Promise<RobotBridgeConfiguration | null> {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  return raw ? normalizeConfiguration(JSON.parse(raw)) : null;
}

/** Secrets stay in native SecureStore; each token is sent only to its configured transport. */
export async function configureRobotBridge(configuration: RobotBridgeConfiguration | null): Promise<void> {
  if (configuration) await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(normalizeConfiguration(configuration)));
  else await SecureStore.deleteItemAsync(CONFIG_KEY);
  reload?.("configuration-change");
}

/** Prepare the shared Central connection and wait for its universal producer. */
export async function prepareRobotAppConnection(options: {
  signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid robot app connection timeout");
  const assertActive = () => { if (options.signal?.aborted) throw new Error("App launch cancelled"); };
  assertActive();
  const config = await loadRobotBridgeConfiguration();
  assertActive();
  if (!config?.central?.enabled) return false;
  if (!reload) throw new Error("Robot app runtime is not available");
  if (getRobotBridgeRuntimeStatus().central.universal?.state !== "connected") {
    await configureRobotBridge({ ...config, central: { ...config.central, protocols: ["reachy", "microduck"] } });
    // A settings write may settle after STOP; revoke its late reconnect too.
    if (options.signal?.aborted) stopRuntime?.("app-launch-cancelled");
  }
  assertActive();
  return new Promise<boolean>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      options.signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve(true);
    };
    const aborted = () => finish(new Error("App launch cancelled"));
    const inspect = (next: RobotBridgeRuntimeStatus) => {
      if (next.central.universal?.state === "connected") finish();
      else if (next.phase === "error") finish(new Error("The app connection could not start. Check App connection and try again."));
    };
    const timer = setTimeout(() => finish(new Error("The app connection did not become ready. Check App connection and try again.")), timeoutMs);
    unsubscribe = subscribeRobotBridgeRuntimeStatus(inspect);
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (options.signal?.aborted) aborted(); else inspect(getRobotBridgeRuntimeStatus());
  });
}

export function installRobotBridgeRuntime(): () => void {
  if (reload) return () => undefined;
  const physical = createLooiBackend();
  let ownsDriving = false, mediaBroker: RobotMediaBroker | null = null;
  let mediaUnsubscribe: (() => void) | null = null;
  let configuration: RobotBridgeConfiguration | null = null;
  let actionProfile = normalizeRobotAppActionProfile(EMPTY_ROBOT_APP_ACTION_PROFILE);
  let mediaState: RobotMediaStatus | undefined;
  const backend = { ...physical,
    get capabilities() {
      const allowed = configuration?.media;
      return { ...physical.capabilities, media: {
        camera: !!allowed?.camera && mediaState?.camera.supported === true && mediaState.camera.available !== false && !["denied", "unavailable"].includes(mediaState.camera.permission),
        microphone: !!allowed?.microphone && mediaState?.microphone.supported === true && mediaState.microphone.available !== false && !["denied", "unavailable"].includes(mediaState.microphone.permission),
        speaker: !!allowed?.speaker && mediaState?.speaker.supported === true && mediaState.speaker.available !== false,
        volume: !!allowed?.speaker && mediaState?.speaker.supported === true && mediaState.speaker.available !== false,
      } };
    },
    stop: (reason: string) => ownsDriving ? physical.stop(`robot-bridge:${reason}`) : Promise.resolve(),
  };
  const core = createRobotCore(backend, { getActionProfile: () => actionProfile });
  let connection: ReturnType<typeof connectRobotBridgeDevice> | null = null;
  let centralHost: ReturnType<typeof import("./native-central").createNativeCentralHost> | null = null;
  let companionPhase: "disabled" | "connecting" | "connected" | "error" = "disabled";
  let companionMessage: string | null = null;
  let centralMessage: string | null = null;
  let centralStates: RobotBridgeRuntimeStatus["central"] = {};
  let centralSessionSequence = 0;
  let releaseBarrier: Promise<void> = Promise.resolve();
  let epoch = 0, disposed = false;
  const isActive = () => AppState.currentState === "active" && !useUserStore.getState().robotSleeping;
  let mediaInitialization: Promise<RobotMediaBroker> | null = null;
  const getMediaBroker = (): Promise<RobotMediaBroker> => {
    if (mediaBroker) return Promise.resolve(mediaBroker);
    mediaInitialization ??= Promise.all([import("./media-broker"), import("./native-media"), import("../core/app-bootstrap")])
      .then(([{ createMediaBroker }, { createNativeMediaBackend }, ownership]) => {
        if (disposed) throw new Error("Robot media runtime is closed");
        const created = createMediaBroker(createNativeMediaBackend({
          acquireOwnership: ownership.acquireExternalMediaOwnership,
          releaseOwnership: ownership.releaseExternalMediaOwnership,
        }));
        mediaBroker = created;
        mediaUnsubscribe = created.subscribe((next) => {
          mediaState = next;
          if (!disposed) {
            publish({ mediaOwner: next.owner, mediaStatus: next });
            connection?.publishMediaStatus(next);
          }
        });
        return created;
      }).catch(error => { mediaInitialization = null; throw error; });
    return mediaInitialization;
  };
  const release = (cause: RobotBridgeReleaseCause) => {
    for (const listener of releaseListeners) {
      try { listener(cause); } catch { /* STOP does not wait for observers. */ }
    }
    recordDiagnosticEvent("runtime", "robot-bridge-release", {
      cause,
      appState: AppState.currentState ?? "unknown",
      ownsDriving,
      centralSessionPending: Object.values(centralStates).some(value => value.sessionId !== null),
    });
    epoch += 1;
    releaseRevision += 1;
    const old = connection; connection = null;
    const oldCentral = centralHost; centralHost = null;
    // Begin local STOP immediately, then finish the previous Central /send and
    // SSE teardown before registering a replacement with the same bearer.
    const closing = [old?.close(), oldCentral?.stop("app-suspended"), core.setActive(false), mediaBroker?.stopAll("bridge-suspended")];
    releaseBarrier = Promise.all([releaseBarrier, ...closing.map(task => Promise.resolve(task).catch(() => undefined))]).then(() => undefined);
    companionPhase = "disabled"; companionMessage = null; centralMessage = null; centralStates = {};
    publish({ phase: "disabled", message: null, companionConnected: false, central: {} });
    return releaseBarrier;
  };
  const publishConnections = () => {
    const states = Object.values(centralStates);
    const connected = companionPhase === "connected" || states.some(value => value.state === "connected");
    const connecting = companionPhase === "connecting" || states.some(value => value.state === "connecting" || value.state === "reconnecting");
    publish({
      phase: connected ? "connected" : connecting ? "connecting" : companionPhase === "error" ? "error" : "disabled",
      message: connected ? null : companionMessage ?? centralMessage,
      companionConnected: companionPhase === "connected",
      central: { ...centralStates },
    });
  };
  const synchronize = (cause: RobotBridgeReleaseCause = "configuration-change") => {
    const released = release(cause);
    if (disposed || !isActive()) return;
    const generation = epoch;
    void released.then(() => Promise.all([loadRobotBridgeConfiguration(), loadRobotAppActionProfile()])).then(async ([config, profile]) => {
      if (disposed || epoch !== generation || !isActive()) return;
      actionProfile = profile;
      configuration = config;
      if (!config) return;
      if (config.media && (config.media.camera || config.media.microphone || config.media.speaker)) {
        mediaState = await (await getMediaBroker()).inspect();
        if (disposed || epoch !== generation || !isActive()) return;
        publish({ mediaOwner: mediaState.owner, mediaStatus: mediaState });
      }
      await core.setActive(true);
      if (disposed || epoch !== generation || !isActive()) return;
      publish({ phase: "connecting", message: null });
      const current = () => !disposed && epoch === generation && isActive();
      const createPeer = async (input: Omit<RobotWebRtcPeerOptions, "createPeerConnection" | "mediaBroker">) => {
        const [{ createRobotWebRtcPeer }, rtc, broker] = await Promise.all([
          import("./webrtc-peer"), import("react-native-webrtc"), getMediaBroker(),
        ]);
        if (!current()) throw new Error("Robot media is suspended");
        const inspected = await broker.inspect();
        if (!current()) throw new Error("Robot media is suspended");
        mediaState = inspected;
        publish({ mediaOwner: inspected.owner, mediaStatus: inspected });
        return createRobotWebRtcPeer({ ...input, mediaBroker: broker,
          createPeerConnection: options => new rtc.RTCPeerConnection(options as never) as unknown as import("./webrtc-peer").RobotRtcPeerConnection,
        });
      };
      if (config.url) {
        companionPhase = "connecting";
        connection = connectRobotBridgeDevice(core, { ...config, mediaStatus: mediaState,
        // Central lives on the phone. Explicitly turn off a paired relay's producer.
        central: config.central ? { enabled: false, url: DEFAULT_ROBOT_CENTRAL_URL, token: "", robotName: "LOOI", protocols: [] } : undefined,
        onStatus: (phase, message) => {
          if (!current()) return;
          companionPhase = phase; companionMessage = message ?? null; publishConnections();
        },
        mediaCommand: async (command) => {
          if (disposed || epoch !== generation || !isActive()) throw new Error("Robot media is suspended");
          if (!config.media?.[command.device === "speaker" ? "speaker" : "microphone"]) throw new Error("This audio device is not enabled for robot apps");
          const broker = await getMediaBroker();
          if (disposed || epoch !== generation || !isActive()) throw new Error("Robot media is suspended");
          return command.action === "get-volume" ? broker.getAudioGain(command.device) : broker.setAudioGain(command.device, command.value!);
        },
        createPeer,
      });
      }
      if (config.central?.enabled) {
        const [{ createNativeCentralHost }, { fetch: streamingFetch }] = await Promise.all([import("./native-central"), import("expo/fetch")]);
        if (!current()) return;
        const host = createNativeCentralHost({ config: config.central,
          media: config.media ?? { camera: false, microphone: false, speaker: false },
          fetchImpl: streamingFetch as never, createPeer,
          openGateway: (protocol, owner) => {
            if (!current()) throw new Error("Robot apps are suspended");
            return createRobotGateway(core, {
              protocol: "universal", sessionId: `central-${protocol}-${++centralSessionSequence}`, allowApproximation: config.allowApproximation,
              media: createRobotAppMediaServices({
                owner,
                request: config.media ?? { camera: false, microphone: false, speaker: false },
                broker: () => mediaBroker,
                isCurrent: current,
                createSounds: async () => (await import("./native-app-sounds")).createNativeAppSounds({
                  volume: () => (mediaBroker?.getAudioGain("speaker").percent ?? 0) / 100,
                }),
              }),
            });
          },
          onStatus: (protocol, next) => {
            if (!current()) return;
            if (next.state === "connected") centralMessage = null;
            centralStates = { ...centralStates, [protocol]: next }; publishConnections();
          },
          onError: (_protocol, error) => {
            if (!current()) return;
            const authorizationFailed = /^Pollen Central \/(?:events|send) returned HTTP (?:401|403)\b/.test(error.message);
            centralMessage = authorizationFailed
              ? "Hugging Face sign-in failed. Check the saved token in Apps settings."
              : "The app connection was interrupted. Reconnecting…";
            publishConnections();
            recordDiagnosticEvent("runtime", "robot-app-central-session-failed", { reason: authorizationFailed ? "authorization-failed" : "session-failed" });
          },
        });
        centralHost = host;
        await host.start();
        if (!current()) await host.stop("stale-central-start");
      }
    }).catch((error) => {
      if (!disposed && epoch === generation) {
        release("startup-failed");
        publish({ phase: "error", message: "Robot app connection could not start. Check the saved connection settings." });
      }
      recordDiagnosticEvent("runtime", "robot-bridge-start-failed", { reason: error instanceof SyntaxError ? "invalid-configuration" : "connection-failed" });
    });
  };
  let lastInteractionCommand: number | null = null;
  const unsubscribe = core.subscribe((snapshot) => {
    if (snapshot.sessionId && !ownsDriving) { ownsDriving = true; enterDrivingControlSession("robot-bridge"); }
    if (!snapshot.sessionId && ownsDriving) { ownsDriving = false; exitDrivingControlSession("robot-bridge"); }
    const result = snapshot.lastResult;
    if (snapshot.sessionId && result?.sessionId === snapshot.sessionId && result.commandId !== lastInteractionCommand) {
      lastInteractionCommand = result.commandId;
      if (result.status === "applied" || result.status === "adapted") markRobotInteraction("robot-bridge-command");
    }
  });
  const refresh = setInterval(() => { if (ownsDriving) enterDrivingControlSession("robot-bridge-active-app"); }, 10_000);
  const appState = AppState.addEventListener("change", () => synchronize("app-state-change"));
  const user = useUserStore.subscribe((state, previous) => { if (state.robotSleeping !== previous.robotSleeping) synchronize("sleep-state-change"); });
  let observedStop = getLooiRobotRuntimeState().stopGeneration;
  const robot = subscribeLooiRobotRuntimeState(() => {
    const state = getLooiRobotRuntimeState();
    if (state.stopGeneration === observedStop) return;
    observedStop = state.stopGeneration;
    // Central accepts the session before its async native peer opens the core.
    // STOP must invalidate that pending session as well as an acquired gateway.
    const centralSessionPending = Object.values(centralStates).some(value => value.sessionId !== null);
    if ((ownsDriving || centralSessionPending) && !state.safety.lastSafetyStopReason?.startsWith("robot-bridge")) {
      const reason = state.safety.lastSafetyStopReason;
      recordDiagnosticEvent("runtime", "robot-bridge-external-stop-observed", {
        stopSource: reason === "cliff" || reason === "obstacle" ? "sensor-safety" : reason ? "manual-or-voice" : "unknown",
        ownsDriving,
        centralSessionPending,
      });
      release("external-robot-stop");
    }
  });
  previewAction = async (name) => {
    if (!isRobotAppActionSource(name)) throw new Error("Enter a valid app action name");
    const turn = epoch;
    const [, profile] = await Promise.all([releaseBarrier, loadRobotAppActionProfile()]);
    const current = () => !disposed && epoch === turn && isActive();
    if (!current()) throw new Error("Keep LOOI awake and the app open to try an action");
    if (!physical.inspect().connected) throw new Error("Connect LOOI before trying an action");
    const anotherAppOwnsControl = () => core.inspect().sessionId !== null || connection?.sessionPending === true
      || Object.values(centralStates).some(value => value.sessionId !== null);
    if (anotherAppOwnsControl()) throw new Error("Stop the running app before trying an action");
    actionProfile = profile;
    if (!core.inspect().capabilities.gestures.includes(name)) throw new Error("This app action has no LOOI assignment");
    await core.setActive(true);
    if (!current()) throw new Error("Action cancelled");
    if (anotherAppOwnsControl()) throw new Error("Stop the running app before trying an action");
    const session = core.openSession({ id: `action-preview-${++centralSessionSequence}` });
    try {
      return await session.execute({ kind: "gesture", name }, { ttlMs: 5_000 });
    } finally {
      await session.close("action-preview-ended");
      if (current() && !configuration) await core.setActive(false);
    }
  };
  reload = synchronize; stopRuntime = (cause = "user-stop") => release(cause);
  synchronize("runtime-start");
  return () => {
    disposed = true; reload = null; stopRuntime = null; previewAction = null; release("runtime-uninstalled");
    clearInterval(refresh); appState.remove(); user(); robot(); unsubscribe(); mediaUnsubscribe?.();
    if (ownsDriving) exitDrivingControlSession("robot-bridge-uninstalled");
    void core.dispose().catch(() => undefined);
  };
}
