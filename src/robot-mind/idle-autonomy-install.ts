/**
 * Production wiring for LOOI's idle life. The runtime itself stays free of
 * React Native and store imports; this file connects it to the real motion
 * layer, the local STOP decoder, the camera controller and the app state.
 */
import { AppState, Platform } from "react-native";
import { useCharacterReactionStore } from "../character/character-reaction";
import {
  getAmbientMotionControllerState,
  holdAmbientMotionFor,
  subscribeAmbientMotionInteractions,
} from "../core/ambient-motion";
import { isMainScreenFocused } from "../core/main-screen-presence";
import {
  getSocialAttentionControllerState,
  holdSocialAttentionMotionFor,
  setSocialIdleLookRequested,
} from "../core/social-attention";
import {
  driveLooiForDuration,
  getLooiRobotRuntimeState,
  performLooiBehaviorHeadGesture,
  setLooiHead,
  subscribeLooiRobotRuntimeState,
} from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { voiceRuntime } from "../perceivers/voice-runtime";
import { subscribeRobotAppSkills } from "../robot-bridge/app-skill-runtime";
import { subscribeRobotBridgeRuntimeStatus } from "../robot-bridge/runtime";
import { useConversationStore } from "../store/conversation";
import { useUserStore } from "../store/user";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";
import { robotBodyState } from "./body-state";
import { createIdleAutonomyRuntime, type IdleAutonomyRuntime } from "./idle-autonomy-runtime";

/** Preparing the Vosk STOP decoder must not hold up an action for long; if it is not ready, the wheels stay still. */
const STOP_LISTENER_PREPARE_TIMEOUT_MS = 2_000;

type VoiceModules = {
  kwsAudioFeeder: typeof import("../voice/kws-audio-feeder").kwsAudioFeeder;
  wakewordService: typeof import("../voice/wakeword").wakewordService;
  voskDrivingCommandRecognizer: typeof import("../voice/vosk-driving-command").voskDrivingCommandRecognizer;
};

let runtime: IdleAutonomyRuntime | null = null;
let voice: VoiceModules | null = null;
let voiceLoading: Promise<void> | null = null;
let robotAppMediaOwner: string | null = null;
let robotAppActive = false;

// Voice modules load lazily, as everywhere else, so cold start stays free of Sherpa and Vosk.
function loadVoiceModules(): void {
  voiceLoading ??= Promise.all([
    import("../voice/kws-audio-feeder"),
    import("../voice/wakeword"),
    import("../voice/vosk-driving-command"),
  ]).then(([feeder, wakeword, vosk]) => {
    voice = {
      kwsAudioFeeder: feeder.kwsAudioFeeder,
      wakewordService: wakeword.wakewordService,
      voskDrivingCommandRecognizer: vosk.voskDrivingCommandRecognizer,
    };
  }).catch((error) => {
    voiceLoading = null;
    recordDiagnosticEvent("character", "idle-autonomy-voice-load-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function appYieldReason(): string | null {
  if (AppState.currentState !== "active") return "app-not-active";
  const user = useUserStore.getState();
  if (user.robotSleeping) return "robot-sleeping";
  if (!isMainScreenFocused()) return "main-not-focused";
  if (user.voiceState !== "sleeping") return `voice-${user.voiceState}`;
  const conversation = useConversationStore.getState();
  if (conversation.isUserSpeaking) return "user-speaking";
  if (conversation.isListening || conversation.isProcessing || conversation.isSpeaking) return "conversation";
  if (isDrivingControlSessionActive()) return "driving-control";
  if (voiceRuntime.isMediaExternallyOwned || robotAppMediaOwner) return "robot-app-media";
  if (robotAppActive) return "robot-app";
  if (useCharacterReactionStore.getState().mood) return "character-reaction";
  return null;
}

/** Start LOOI's idle life once; it pauses itself whenever anything else needs the robot. */
export function installIdleAutonomyRuntime(): () => void {
  if (runtime) return () => undefined;
  loadVoiceModules();
  const unsubscribeBridge = subscribeRobotBridgeRuntimeStatus((status) => { robotAppMediaOwner = status.mediaOwner; });
  const unsubscribeSkills = subscribeRobotAppSkills((snapshot) => { robotAppActive = snapshot.activeApp !== null; });
  const instance = createIdleAutonomyRuntime({
    bodyState: robotBodyState,
    now: () => Date.now(),
    random: Math.random,
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    getLevel: () => useUserStore.getState().preferences.idleAutonomyLevel ?? "look",
    linkLossSelfStopConfirmed: () => useUserStore.getState().preferences.linkLossSelfStopConfirmed === true,
    quietSensorBasisEnabled: () => useUserStore.getState().preferences.edgeFramesOnlyOnChangeConfirmed === true,
    getYieldReason: appYieldReason,
    subscribeInteractions: subscribeAmbientMotionInteractions,
    motion: {
      getState: getLooiRobotRuntimeState,
      subscribe: subscribeLooiRobotRuntimeState,
      drive: (direction, durationMs, options) => driveLooiForDuration(direction, durationMs, options),
      setHead: (position, isCurrent) => setLooiHead(position, { priority: "behavior", isCurrent }),
      headGesture: (gesture, isCurrent) => performLooiBehaviorHeadGesture(gesture, isCurrent),
    },
    stopListener: {
      isLive() {
        if (Platform.OS === "web") return false;
        if (!voice) { loadVoiceModules(); return false; }
        return voice.kwsAudioFeeder.diagnosticStatus.pcmFlowing;
      },
      async arm(reason, durationMs) {
        if (!voice) return false;
        // Registers the local STOP handler (stopLooiMotion + Driving Control Session), exactly as explicit voice moves do.
        const ready = await withTimeout(voice.wakewordService.prepareDrivingControl(), STOP_LISTENER_PREPARE_TIMEOUT_MS, false);
        if (!ready) return false;
        return voice.voskDrivingCommandRecognizer.armEmergencyForMotion(reason, durationMs);
      },
      async disarm(reason) {
        await voice?.voskDrivingCommandRecognizer.disarmEmergency(reason);
      },
      subscribeSamples(listener) {
        return voice ? voice.kwsAudioFeeder.subscribeSamples((samples) => listener(samples)) : () => undefined;
      },
    },
    camera: {
      available() {
        const user = useUserStore.getState();
        return user.preferences.cameraAttentionEnabled && !user.robotSleeping && isMainScreenFocused() &&
          getSocialAttentionControllerState().running;
      },
      request: () => setSocialIdleLookRequested(true),
      release: () => setSocialIdleLookRequested(false),
      bodyMotionInFlight: () => getSocialAttentionControllerState().bodyMotionInFlight,
      holdMotion: (durationMs) => holdSocialAttentionMotionFor(durationMs, "idle-autonomy"),
    },
    ambient: {
      busy: () => getAmbientMotionControllerState().actionInFlight,
      hold: (durationMs, source) => holdAmbientMotionFor(durationMs, source),
    },
    log: (event, details = {}) => recordDiagnosticEvent("character", `idle-autonomy-${event}`, details),
  });
  runtime = instance;
  instance.start();
  return () => {
    instance.stop("uninstalled");
    unsubscribeBridge();
    unsubscribeSkills();
    if (runtime === instance) runtime = null;
  };
}

export function getIdleAutonomyRuntimeSnapshot() {
  return runtime?.getSnapshot() ?? null;
}
