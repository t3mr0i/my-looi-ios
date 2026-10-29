import { perceiverManager } from "./perceiver-manager";
import { voiceRuntime } from "../perceivers/voice-runtime";
import { useUserStore } from "../store/user";
import {
  getLoadedSttModule,
  getLoadedTtsModule,
} from "../voice/lazy-services";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { recordPerformanceSnapshot } from "../diagnostics/performance-monitor";
import { setIsAudioActiveAsync } from "expo-audio";
import { AppState } from "react-native";
import { recoverWakewordRuntime } from "./voice-runtime-recovery";
import { isMainScreenFocused } from "./main-screen-presence";
import {
  resumeLooiRobotAutoConnection,
  suspendLooiRobotAutoConnection,
} from "../device-tools/looi-robot-autoconnect";
import { removeRetiredExperimentalVoiceAssets } from "../voice/retired-experimental-voice-assets";
import { retireLegacyNetworkCredentials } from "./legacy-network-credentials-retirement";
import { startAmbientMotionController, stopAmbientMotionController } from "./ambient-motion";
import { startSocialAttentionController, stopSocialAttentionController } from "./social-attention";

let bootstrapped = false;
let paused = false;
let desiredForegroundActive = true;
let runtimeLifecycleQueue: Promise<void> = Promise.resolve();
let ownerEnrollmentPromise: Promise<void> | null = null;
let bootstrapPromise: Promise<void> | null = null;

/**
 * Initialize all perceivers and wire observation events.
 * Called once at app startup.
 */
export function bootstrapApp(): Promise<void> {
  bootstrapPromise ??= enqueueRuntimeLifecycle(performBootstrapApp);
  return bootstrapPromise;
}

function runtimeShouldBeActive(): boolean {
  return desiredForegroundActive && AppState.currentState === "active"
    && !useUserStore.getState().robotSleeping && !voiceRuntime.isMediaExternallyOwned;
}

/** Transfer camera/audio to a robot app while keeping its BLE control alive. */
export async function acquireExternalMediaOwnership(
  owner: string,
  signal: AbortSignal,
  options: { allowWhileSleeping?: boolean } = {}
): Promise<void> {
  const sleepBlocksAcquire = () => !options.allowWhileSleeping && useUserStore.getState().robotSleeping;
  if (signal.aborted || AppState.currentState !== "active" || sleepBlocksAcquire()) throw new Error("Robot media is suspended");
  voiceRuntime.blockForExternalMedia(owner);
  try {
    await enqueueRuntimeLifecycle(async () => {
      if (signal.aborted || AppState.currentState !== "active" || sleepBlocksAcquire()) throw new Error("Robot media was cancelled");
      await stopRuntimeComponents("external-robot-app", false, true);
      await setIsAudioActiveAsync(false);
      if (signal.aborted || AppState.currentState !== "active" || sleepBlocksAcquire()) throw new Error("Robot media was cancelled");
      recordDiagnosticEvent("runtime", "external-media-acquired", { owner });
    });
  } catch (error) {
    await releaseExternalMediaOwnership(owner);
    throw error;
  }
}

export async function releaseExternalMediaOwnership(owner: string): Promise<void> {
  voiceRuntime.releaseExternalMedia(owner);
  await enqueueRuntimeLifecycle(async () => {
    if (!bootstrapped || !runtimeShouldBeActive()) return;
    paused = false;
    await setIsAudioActiveAsync(true);
    if (!runtimeShouldBeActive()) return;
    const { kwsAudioFeeder } = await import("../voice/kws-audio-feeder");
    if (!runtimeShouldBeActive()) return;
    kwsAudioFeeder.setAppCaptureAllowed(true);
    await startRuntimePerceivers();
    if (!runtimeShouldBeActive()) return;
    startAmbientMotionController("external-media-released");
    startSocialAttentionController("external-media-released");
  });
}

async function performBootstrapApp(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const bootstrapStartedAt = Date.now();
  recordDiagnosticEvent("app", "bootstrap-start");
  void recordPerformanceSnapshot("bootstrap-start");

  // v2.1.105 removes the Local-ASR experiment. Cleanup is best-effort and
  // deliberately preserves shared wake/command Whisper Tiny, KWS and VAD.
  void removeRetiredExperimentalVoiceAssets().catch((error) => {
    recordDiagnosticEvent("runtime", "retired-experimental-voice-assets-cleanup-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Voice remains the only general perceiver. Camera attention is a separate,
  // opt-in local-only social controller that activates only during interaction;
  // calendar/reminder pipelines remain disabled.
  perceiverManager.register(voiceRuntime);

  void retireLegacyNetworkCredentials().catch((error) => {
    recordDiagnosticEvent("app", "legacy-network-credential-retirement-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const bootSleeping = useUserStore.getState().robotSleeping;
  if (bootSleeping || !desiredForegroundActive || AppState.currentState !== "active") {
    paused = true;
    desiredForegroundActive = false;
    useUserStore.getState().setVoiceState("sleeping");
    recordDiagnosticEvent("app", bootSleeping ? "sleep-mode-restored-on-boot" : "bootstrap-deferred-until-foreground");
  } else if (voiceRuntime.isMediaExternallyOwned) {
    // The external owner will start the normal runtime when it releases media.
    paused = false;
    recordDiagnosticEvent("app", "bootstrap-deferred-for-robot-media");
  } else {
    try {
      await setIsAudioActiveAsync(true);
      recordDiagnosticEvent("audio", "subsystem-activated-bootstrap");
    } catch (error) {
      console.warn("[Bootstrap] Failed to activate audio subsystem on boot:", error);
      recordDiagnosticEvent("audio", "subsystem-activate-bootstrap-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!runtimeShouldBeActive()) {
      await setIsAudioActiveAsync(false).catch(() => undefined);
      paused = true;
      return;
    }
    const voiceStartupStartedAt = Date.now();
    await startRuntimePerceivers();
    if (!runtimeShouldBeActive()) return;
    recordDiagnosticEvent("performance", "voice-runtime-startup-finished", {
      durationMs: Date.now() - voiceStartupStartedAt,
    });
    void recordPerformanceSnapshot("after-voice-runtime-startup");
    startAmbientMotionController("bootstrap");
    startSocialAttentionController("bootstrap");

    // Prewarm STT model so first wakeword doesn't pay 1.2s cold-start penalty.
    prewarmOfflineStt();
  }

  console.log("[Bootstrap] App initialized. Active perceivers:", perceiverManager.getRegisteredNames());
  recordDiagnosticEvent("app", "bootstrapped", {
    perceivers: perceiverManager.getRegisteredNames().join(","),
    durationMs: Date.now() - bootstrapStartedAt,
  });
  void recordPerformanceSnapshot("bootstrapped");

  runOptInOwnerEnrollmentOnBoot();
  runOptInLiveVoiceAcceptanceOnBoot();
}

export async function pauseAppRuntime(reason: "background" | "sleep" = "background"): Promise<void> {
  desiredForegroundActive = false;
  if (!bootstrapped) return;

  return enqueueRuntimeLifecycle(async () => {
    // BLE's synchronous AppState listener has already invalidated its session.
    // Honour this pause even if a resume was queued immediately afterwards;
    // otherwise that resume sees paused=false and never restores BLE/audio.
    if (paused) return;
    paused = true;
    recordDiagnosticEvent("app", reason === "sleep" ? "sleep-runtime-pause-start" : "background-entered");
    await stopRuntimeComponents(reason);

    try {
      await setIsAudioActiveAsync(false);
      recordDiagnosticEvent("audio", "subsystem-deactivated");
    } catch (error) {
      console.warn("[Bootstrap] Failed to deactivate audio subsystem:", error);
      recordDiagnosticEvent("audio", "subsystem-deactivate-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    useUserStore.getState().setVoiceState("sleeping");
    console.log("[Bootstrap] App runtime paused");
    recordDiagnosticEvent("app", "runtime-paused");
  });
}

export async function resumeAppRuntime(): Promise<void> {
  desiredForegroundActive = AppState.currentState === "active" && !useUserStore.getState().robotSleeping;
  if (!bootstrapped) return;
  if (AppState.currentState !== "active") return;
  if (useUserStore.getState().robotSleeping) {
    desiredForegroundActive = false;
    recordDiagnosticEvent("app", "runtime-resume-blocked-by-sleep");
    return;
  }
  desiredForegroundActive = true;

  return enqueueRuntimeLifecycle(async () => {
    if (!desiredForegroundActive || !paused || useUserStore.getState().robotSleeping || voiceRuntime.isMediaExternallyOwned) return;
    // A queued pause must tear down an in-progress resume as well as a fully
    // resumed runtime, including cancellation while audio activation is pending.
    paused = false;

    try {
      await setIsAudioActiveAsync(true);
      recordDiagnosticEvent("audio", "subsystem-activated");
    } catch (error) {
      console.warn("[Bootstrap] Failed to activate audio subsystem:", error);
      recordDiagnosticEvent("audio", "subsystem-activate-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!runtimeShouldBeActive()) return;
    const { kwsAudioFeeder } = await import("../voice/kws-audio-feeder");
    if (!runtimeShouldBeActive()) return;
    kwsAudioFeeder.setAppCaptureAllowed(true);
    await startRuntimePerceivers();
    if (!runtimeShouldBeActive()) return;
    startAmbientMotionController("foreground-resume");
    startSocialAttentionController("foreground-resume");

    // Do not make voice readiness wait on BLE. Reconnect the saved robot in
    // parallel once the app is definitely foreground-active again.
    void resumeLooiRobotAutoConnection("foreground-runtime-resume").catch((error) => {
      console.warn("[Bootstrap] Failed to resume LOOI BLE auto-connection:", error);
      recordDiagnosticEvent("robot", "ble-foreground-reconnect-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    console.log("[Bootstrap] App runtime resumed");
    recordDiagnosticEvent("app", "runtime-resumed");

    if (isMainScreenFocused()) {
      // A true Android foreground resume is distinct from Main <-> Settings
      // navigation. If the face is still the focused route, returning to the app
      // is an attention signal and should open a fresh conversation immediately.
      void voiceRuntime.resumeMainScreenConversation("foreground-resume").catch((error) => {
        recordDiagnosticEvent("navigation", "main-foreground-auto-listen-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}

function enqueueRuntimeLifecycle(task: () => Promise<void>): Promise<void> {
  const queued = runtimeLifecycleQueue.then(task, task);
  runtimeLifecycleQueue = queued.catch(() => undefined);
  return queued;
}

async function stopRuntimeComponents(reason: string, suspendRobot = true, requireMediaRelease = false): Promise<void> {
  const failures: unknown[] = [];
  const stop = (component: string, action: () => unknown) => stopRuntimeComponent(component, reason, action, failures);
  // Peripheral teardown starts immediately, independently of loading the capture
  // facade. Every stop settles before the audio session is deactivated.
  const peripheralStops = [
    stop("ambient-motion", () => stopAmbientMotionController(reason)),
    stop("social-attention", () => stopSocialAttentionController(reason)),
    ...(suspendRobot ? [stop("robot", () => suspendLooiRobotAutoConnection(reason))] : []),
  ];
  const feeder = await closeCaptureIngress(reason);
  recordDiagnosticEvent("audio", "capture-release-start", { feederRunning: feeder?.isRunning ?? null });
  await Promise.all([
    ...peripheralStops,
    stop("perceivers", () => perceiverManager.stopAll()),
    stop("microphone", () => feeder?.stop()),
    stop("speech-recognition", () => getLoadedSttModule()
      ?.then(({ sttService }) => sttService.cancel({ resumeWakeword: false }))),
    stop("speech-output", () => getLoadedTtsModule()
      ?.then(({ ttsService }) => ttsService.stop())),
  ]);
  recordDiagnosticEvent("audio", "capture-release-finished", {
    feederRunning: feeder?.isRunning ?? null,
    feederDesired: feeder?.diagnosticStatus.desiredRunning ?? null,
  });
  if (requireMediaRelease && (failures.length > 0 || !feeder || feeder.isRunning)) {
    throw new Error("Existing camera/audio could not be released for the robot app");
  }
}

async function closeCaptureIngress(reason: string) {
  try {
    const { kwsAudioFeeder } = await import("../voice/kws-audio-feeder");
    kwsAudioFeeder.setAppCaptureAllowed(false);
    return kwsAudioFeeder;
  } catch (error) {
    recordStopFailure("capture-ingress", reason, error);
    return null;
  }
}

async function stopRuntimeComponent(component: string, reason: string, stop: () => unknown, failures?: unknown[]): Promise<void> {
  try { await stop(); }
  catch (error) { failures?.push(error); recordStopFailure(component, reason, error); }
}

function recordStopFailure(component: string, reason: string, error: unknown): void {
  recordDiagnosticEvent("runtime", "runtime-component-stop-failed", {
    component, reason, error: error instanceof Error ? error.message : String(error),
  });
}

/** Retry wakeword startup after setup changed models or microphone access. */
export function syncVoiceRuntime(): Promise<void> {
  return enqueueRuntimeLifecycle(async () => {
    if (!bootstrapped || paused || !runtimeShouldBeActive()) return;
    await voiceRuntime.sync();
    if (!runtimeShouldBeActive()) return;
    const [{ kwsAudioFeeder }, { wakewordService }] = await Promise.all([
      import("../voice/kws-audio-feeder"),
      import("../voice/wakeword"),
    ]);
    if (!runtimeShouldBeActive()) return;
    const status = kwsAudioFeeder.diagnosticStatus;
    recordDiagnosticEvent("runtime", "voice-sync", {
      feederRunning: status.running,
      feederDesired: status.desiredRunning,
      wakewordFeeding: status.wakewordFeedingEnabled,
      wakewordListening: wakewordService.isListening,
      nativeKwsAvailable: wakewordService.isNativeKwsAvailable,
      wakewordState: wakewordService.state,
    });
  });
}

async function startRuntimePerceivers(): Promise<void> {
  if (!runtimeShouldBeActive()) return;
  const startedAt = Date.now();
  try {
    const perceiverStartAt = Date.now();
    await perceiverManager.start("voice");
    if (!runtimeShouldBeActive()) return;
    recordDiagnosticEvent("performance", "voice-perceiver-start-stage", { durationMs: Date.now() - perceiverStartAt });
    // A foreground resume must restore the actual wakeword pipeline, not only
    // mark the facade active. sync() is idempotent and repairs a stopped native
    // feeder/wakeword service after lifecycle races.
    const voiceSyncAt = Date.now();
    await voiceRuntime.sync();
    if (!runtimeShouldBeActive()) return;
    recordDiagnosticEvent("performance", "voice-runtime-sync-stage", { durationMs: Date.now() - voiceSyncAt });

    await recoverWakewordRuntime(runtimeShouldBeActive);
    if (!runtimeShouldBeActive()) return;
    recordDiagnosticEvent("performance", "voice-runtime-perceivers-total", { durationMs: Date.now() - startedAt });
  } catch (error) {
    console.warn("[Bootstrap] Failed to start voice perceiver:", error);
    recordDiagnosticEvent("runtime", "foreground-voice-start-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function prewarmOfflineStt(): void {
  const delayMs = 12_000;
  recordDiagnosticEvent("performance", "offline-stt-prewarm-scheduled", { delayMs });
  setTimeout(() => {
    if (paused || !runtimeShouldBeActive()) return;
    const startedAt = Date.now();
    void recordPerformanceSnapshot("before-offline-stt-prewarm");
    void import("../voice/stt")
      .then(async ({ sttService }) => {
        if (paused || !runtimeShouldBeActive()) return;
        await sttService.initialize();
        recordDiagnosticEvent("performance", "offline-stt-prewarm-finished", {
          durationMs: Date.now() - startedAt,
        });
        void recordPerformanceSnapshot("after-offline-stt-prewarm");
        console.log("[Bootstrap] Offline Whisper prewarmed");
      })
      .catch((error) => {
        recordDiagnosticEvent("performance", "offline-stt-prewarm-failed", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn("[Bootstrap] STT prewarm failed (will retry on first use):", error);
      });
  }, delayMs);
}


function runOptInLiveVoiceAcceptanceOnBoot(): void {
  if (process.env.EXPO_PUBLIC_LOOI_RUN_LIVE_VOICE_ACCEPTANCE_ON_BOOT !== "1") return;

  void runLiveVoiceAcceptanceSequence().catch((error) => {
    console.error("[Diagnostics] Live voice acceptance failed:", error);
  });
}

function runOptInOwnerEnrollmentOnBoot(): void {
  if (process.env.EXPO_PUBLIC_LOOI_ENROLL_OWNER_ON_BOOT !== "1") return;

  ownerEnrollmentPromise = runOwnerEnrollmentSequence().catch((error) => {
    console.error("[Diagnostics] Owner enrollment failed:", error);
  });
}

async function runOwnerEnrollmentSequence(): Promise<void> {
  const delayMs = getOwnerEnrollmentStartDelayMs();
  const durationMs = getOwnerEnrollmentDurationMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const { sttService } = await import("../voice/stt");
  const { speakerIdService } = await import("../voice/speaker-id");

  console.log(
    `[Diagnostics] Owner enrollment: speak after this log; recording ${durationMs}ms for owner voice.`
  );
  useUserStore.getState().setVoiceState("listening");
  await sttService.startRecording();

  try {
    await sleep(durationMs);
    useUserStore.getState().setVoiceState("verifying");
    const audioUri = await sttService.stopRecording();
    await speakerIdService.enrollFromFile(audioUri);
    useUserStore.getState().setVoiceEnrolled(true);
    console.log(`[Diagnostics] Owner enrollment succeeded: audioUri=${audioUri}`);
  } finally {
    await sttService.resumeWakewordFeederIfPaused();
    useUserStore.getState().setVoiceState("sleeping");
  }
}

async function runLiveVoiceAcceptanceSequence(): Promise<void> {
  await ownerEnrollmentPromise;
  const repeat = getLiveVoiceAcceptanceRepeatCount();
  const delayMs = getLiveVoiceAcceptanceStartDelayMs();

  for (let index = 0; index < repeat; index += 1) {
    await waitForVoiceIdle();
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    console.log(
      `[Diagnostics] Live voice acceptance ${index + 1}/${repeat}: ` +
        "speak after this log; VAD should finish the recording automatically."
    );
    await voiceRuntime.trigger();
    await waitForVoiceIdle();
  }
}

function getLiveVoiceAcceptanceRepeatCount(): number {
  const raw = process.env.EXPO_PUBLIC_LOOI_LIVE_VOICE_ACCEPTANCE_REPEAT;
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 5));
}

function getLiveVoiceAcceptanceStartDelayMs(): number {
  const raw = process.env.EXPO_PUBLIC_LOOI_LIVE_VOICE_ACCEPTANCE_START_DELAY_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : 5000;
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(0, Math.min(parsed, 30_000));
}

function getOwnerEnrollmentStartDelayMs(): number {
  const raw = process.env.EXPO_PUBLIC_LOOI_OWNER_ENROLLMENT_START_DELAY_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : 5000;
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(0, Math.min(parsed, 30_000));
}

function getOwnerEnrollmentDurationMs(): number {
  const raw = process.env.EXPO_PUBLIC_LOOI_OWNER_ENROLLMENT_DURATION_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : 3000;
  if (!Number.isFinite(parsed)) return 3000;
  return Math.max(1000, Math.min(parsed, 10_000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForVoiceIdle(timeoutMs = 45_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const userState = useUserStore.getState();
    if (userState.voiceState === "sleeping") {
      return;
    }
    await sleep(500);
  }
  throw new Error("Live voice acceptance timed out waiting for the voice pipeline to return idle");
}
