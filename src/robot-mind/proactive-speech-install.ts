/**
 * Production wiring for proactive speech. Voice modules load lazily, as they
 * do elsewhere, so installing at bootstrap adds no audio or WebRTC start-up work.
 */
import { AppState } from "react-native";
import {
  getBehaviorSessionId,
  getCompanionPersonalityContext,
  isBehaviorGameActive,
  requestBehaviorSignalResponse,
  subscribeBehaviorEvents,
} from "../behavior/behavior-events";
import { isMainScreenFocused } from "../core/main-screen-presence";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { voiceRuntime } from "../perceivers/voice-runtime";
import { useConversationStore } from "../store/conversation";
import { normalizeProactiveSpeech, useUserStore } from "../store/user";
import { describeProactiveOccasion } from "../voice/realtime-config";
import { robotBodyState } from "./body-state";
import { createIdleProactiveSpeaker } from "./proactive-idle-speech";
import { createProactiveSpeechRuntime, type ProactiveSpeechRoute } from "./proactive-speech-runtime";

type VoiceModules = {
  conversation: typeof import("../voice/realtime-conversation").realtimeConversationService;
  feeder: typeof import("../voice/kws-audio-feeder").kwsAudioFeeder;
  wakeword: typeof import("../voice/wakeword").wakewordService;
  robot: typeof import("../device-tools/looi-robot");
};

let installed: (() => void) | null = null;
let modules: VoiceModules | null = null;
let modulesPromise: Promise<VoiceModules> | null = null;
let lastConversationSpeechAt: number | null = null;
let nextId = 0;

function loadVoiceModules(): Promise<VoiceModules> {
  modulesPromise ??= Promise.all([
    import("../voice/realtime-conversation"),
    import("../voice/kws-audio-feeder"),
    import("../voice/wakeword"),
    import("../device-tools/looi-robot"),
  ]).then(([conversation, feeder, wakeword, robot]) => {
    modules = {
      conversation: conversation.realtimeConversationService,
      feeder: feeder.kwsAudioFeeder,
      wakeword: wakeword.wakewordService,
      robot,
    };
    return modules;
  });
  modulesPromise.catch(() => { modulesPromise = null; });
  return modulesPromise;
}

function checkIdle(): string | null {
  if (!modules) return "voice-not-ready";
  if (AppState.currentState !== "active") return "background";
  if (!isMainScreenFocused()) return "not-main-screen";
  const user = useUserStore.getState();
  if (user.robotSleeping) return "sleeping";
  if (voiceRuntime.isMediaExternallyOwned) return "external-media";
  if (!user.preferences.ttsEnabled) return "speech-disabled";
  if (modules.conversation.isActive) return "conversation-active";
  const conversation = useConversationStore.getState();
  if (user.voiceState !== "sleeping" || conversation.isListening || conversation.isProcessing || conversation.isSpeaking ||
    conversation.realtimeReadiness === "preparing-microphone" || conversation.realtimeReadiness === "connecting") return "voice-busy";
  // While wheels turn, the microphone must stay free for a spoken STOP.
  if (robotBodyState.getState().wheelsMoving || modules.robot.getLooiRobotRuntimeState().motionActive) return "wheels-moving";
  if (modules.wakeword.isDrivingControlSessionActive) return "driving-session";
  return null;
}

const idleSpeaker = createIdleProactiveSpeaker({
  checkIdle,
  async generateLine(occasionText, signal) {
    const { generateBudgetReply } = await import("../openai/budget-conversation");
    const preferences = useUserStore.getState().preferences;
    const reply = await generateBudgetReply({
      history: [],
      language: preferences.language,
      robotName: preferences.robotName,
      personalityContext: getCompanionPersonalityContext(""),
      occasion: occasionText,
      signal,
    });
    return { text: reply.text, model: reply.model, usage: { ...reply.usage } };
  },
  async speak(text, signal) {
    const { speakOpenAiText } = await import("../openai/openai-speech");
    const preferences = useUserStore.getState().preferences;
    // Not streamed: the wake-word recorder stays warm, as in Classic speech.
    await speakOpenAiText(text, {
      voiceId: preferences.ttsVoiceId, styleId: preferences.ttsStyleId, speed: preferences.ttsSpeed, signal,
      personalityContext: getCompanionPersonalityContext(""),
    });
  },
  isWakewordFeeding: () => modules?.feeder.diagnosticStatus.wakewordFeedingEnabled !== false,
  setWakewordFeeding: (enabled) => modules?.feeder.setWakewordFeedingEnabled(enabled),
  showSpeaking(text, keepOverlay) {
    const store = useConversationStore.getState();
    store.setHeardSpeechText(text);
    store.setSpeaking(text !== null);
    if (text === null && !keepOverlay) store.setOverlayVisible(false);
  },
  watchForTakeover(onTakeover) {
    const check = () => {
      const conversation = useConversationStore.getState();
      if (useUserStore.getState().voiceState !== "sleeping" || conversation.isListening || conversation.isProcessing ||
        modules?.conversation.isActive) onTakeover();
    };
    const unsubscribeUser = useUserStore.subscribe(check);
    const unsubscribeConversation = useConversationStore.subscribe(check);
    return () => { unsubscribeUser(); unsubscribeConversation(); };
  },
  getConversationMode: () => useUserStore.getState().preferences.conversationMode,
  openMicrophone: () => voiceRuntime.trigger(),
  record: (category, event, details) => recordDiagnosticEvent(category, event, details),
});

async function getRoute(): Promise<ProactiveSpeechRoute> {
  const { conversation } = await loadVoiceModules();
  const mode = conversation.activeMode;
  if (mode === "budget") return "budget";
  if (mode === "realtime" || mode === "realtime_pcm") return getBehaviorSessionId() ? "realtime" : "unavailable";
  return conversation.isActive ? "unavailable" : "idle";
}

/** Install once at bootstrap; the runtime checks app state at every event. */
export function installProactiveSpeechRuntime(): () => void {
  if (installed) return installed;
  const unsubscribeSpeech = useConversationStore.subscribe((state, previous) => {
    if (state.isUserSpeaking !== previous.isUserSpeaking || state.isSpeaking !== previous.isSpeaking) {
      lastConversationSpeechAt = robotBodyState.now();
    }
  });
  const runtime = createProactiveSpeechRuntime({
    now: robotBodyState.now,
    getBodyState: robotBodyState.getState,
    subscribeBodyEvents: robotBodyState.subscribeEvents,
    subscribeUserTurns: (listener) => subscribeBehaviorEvents((event) => {
      if (event.type === "user-turn") listener(event.text);
    }),
    getLevel: () => normalizeProactiveSpeech(useUserStore.getState().preferences.proactiveSpeech),
    getEnvironment() {
      const user = useUserStore.getState();
      const conversation = useConversationStore.getState();
      const voiceBusy = user.voiceState === "processing" || user.voiceState === "speaking" || user.voiceState === "verifying";
      return {
        foreground: AppState.currentState === "active",
        mainScreenFocused: isMainScreenFocused(),
        robotSleeping: user.robotSleeping,
        mediaExternallyOwned: voiceRuntime.isMediaExternallyOwned,
        gameActive: isBehaviorGameActive(getBehaviorSessionId()),
        userSpeaking: conversation.isUserSpeaking,
        assistantBusy: conversation.isSpeaking || conversation.isProcessing || voiceBusy || idleSpeaker.isSpeaking,
        lastConversationSpeechAt,
        conversationActive: conversation.isListening || conversation.isProcessing || conversation.isSpeaking ||
          user.voiceState !== "sleeping" || modules?.conversation.isActive === true,
      };
    },
    getRoute,
    describeOccasion: describeProactiveOccasion,
    requestRealtimeLine(request) {
      const sessionId = getBehaviorSessionId();
      return !!sessionId && requestBehaviorSignalResponse({
        kind: "proactive-occasion", id: request.id, occasion: request.occasion,
        ...(request.detail.edgeSide ? { edgeSide: request.detail.edgeSide } : {}),
      }, sessionId);
    },
    async speakInBudgetSession(request) {
      const { budgetConversationService } = await import("../voice/budget-conversation");
      return budgetConversationService.speakProactiveLine(request.occasionText);
    },
    speakWhileIdle: (request) => idleSpeaker.speak(request),
    record: (category, event, details) => recordDiagnosticEvent(category, event, details),
    createId: () => `proactive_${Date.now()}_${++nextId}`,
  });
  const stopRuntime = runtime.start();
  installed = () => { stopRuntime(); unsubscribeSpeech(); installed = null; };
  return installed;
}
