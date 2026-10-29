import { voiceRuntime } from "../perceivers/voice-runtime";
import { isManagedConversationMode, useUserStore } from "../store/user";
import { useConversationStore } from "../store/conversation";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { getRuntimeProfile } from "./runtime-profile";

const PCM_STARTUP_TIMEOUT_MS = 1200;
const PCM_RETRY_TIMEOUT_MS = 800;
const REPAIR_SETTLE_MS = 120;

type RecoveryContext = {
  isRuntimeActive: () => boolean;
  feeder: typeof import("../voice/kws-audio-feeder").kwsAudioFeeder;
  wakeword: typeof import("../voice/wakeword").wakewordService;
  realtime: typeof import("../voice/realtime-conversation").realtimeConversationService;
};

/** Repair idle wake listening without taking audio away from a conversation. */
export async function recoverWakewordRuntime(isRuntimeActive: () => boolean): Promise<void> {
  if (!isRuntimeActive()) return;
  const context = await loadRecoveryContext(isRuntimeActive);
  if (!isRuntimeActive()) return;
  await resetStaleListening(context);
  if (!isRuntimeActive()) return;
  await waitForInitialPcm(context);
  if (!isRuntimeActive()) return;

  recordDiagnosticEvent("runtime", "foreground-voice-state", {
    expectedWakeword: wakewordExpected(), ...captureStatus(context),
  });
  if (!needsRepair(context)) {
    recordDeferredRepair(context);
    return;
  }
  await retryWakeword(context);
  if (!needsRepair(context)) return;
  await restartWakeword(context);
  if (needsRepair(context)) {
    recordDiagnosticEvent("runtime", "foreground-voice-readiness-failed", captureStatus(context));
  }
}

async function loadRecoveryContext(isRuntimeActive: () => boolean): Promise<RecoveryContext> {
  const startedAt = Date.now();
  const [{ kwsAudioFeeder }, { wakewordService }, { realtimeConversationService }] = await Promise.all([
    import("../voice/kws-audio-feeder"), import("../voice/wakeword"), import("../voice/realtime-conversation"),
  ]);
  recordDiagnosticEvent("performance", "voice-runtime-imports-stage", { durationMs: Date.now() - startedAt });
  return { isRuntimeActive, feeder: kwsAudioFeeder, wakeword: wakewordService, realtime: realtimeConversationService };
}

function wakewordExpected(): boolean {
  return getRuntimeProfile().allowsWakewordAutostart && useUserStore.getState().preferences.wakeWordEnabled;
}

function realtimeOwnsVoiceRuntime(context: RecoveryContext): boolean {
  if (context.realtime.isActive) return true;
  const conversation = useConversationStore.getState();
  return isManagedConversationMode(useUserStore.getState().preferences.conversationMode)
    && (conversation.isListening || conversation.isProcessing || conversation.isSpeaking);
}

function conversationOwnsVoiceRuntime(context: RecoveryContext): boolean {
  const conversation = useConversationStore.getState();
  return context.realtime.isActive || conversation.isListening || conversation.isProcessing || conversation.isSpeaking;
}

function canResumeIdleVoice(context: RecoveryContext): boolean {
  return context.isRuntimeActive() && !conversationOwnsVoiceRuntime(context);
}

function canRepair(context: RecoveryContext): boolean {
  return canResumeIdleVoice(context) && wakewordExpected();
}

function needsRepair(context: RecoveryContext): boolean {
  const status = context.feeder.diagnosticStatus;
  return canRepair(context) && (!status.running || !context.wakeword.isListening || !status.pcmFlowing);
}

function captureStatus(context: RecoveryContext) {
  const status = context.feeder.diagnosticStatus;
  return {
    feederRunning: status.running,
    feederDesired: status.desiredRunning,
    pcmFlowing: status.pcmFlowing,
    pcmAgeMs: status.pcmAgeMs,
    wakewordFeeding: status.wakewordFeedingEnabled,
    wakewordListening: context.wakeword.isListening,
    wakewordState: context.wakeword.state,
  };
}

async function resetStaleListening(context: RecoveryContext): Promise<void> {
  const conversation = useConversationStore.getState();
  if (!wakewordExpected() || realtimeOwnsVoiceRuntime(context) || !conversation.isListening || context.feeder.isRunning) return;
  conversation.setListening(false);
  conversation.setProcessing(false);
  conversation.setSpeaking(false);
  conversation.setOverlayVisible(false);
  useUserStore.getState().setVoiceState("sleeping");
  recordDiagnosticEvent("runtime", "foreground-stale-listening-reset");
  await voiceRuntime.sync();
}

async function waitForInitialPcm(context: RecoveryContext): Promise<void> {
  const status = context.feeder.diagnosticStatus;
  if (!canRepair(context) || !status.running || !context.wakeword.isListening || status.pcmFlowing) return;
  const pcmReady = await context.feeder.waitForFreshPcm(PCM_STARTUP_TIMEOUT_MS);
  if (!context.isRuntimeActive()) return;
  recordDiagnosticEvent("runtime", "voice-readiness-watchdog", {
    pcmReady, ...captureStatus(context), recordingAgeMs: context.feeder.diagnosticStatus.recordingAgeMs,
  });
}

function recordDeferredRepair(context: RecoveryContext): void {
  if (!wakewordExpected() || !conversationOwnsVoiceRuntime(context)) return;
  const conversation = useConversationStore.getState();
  recordDiagnosticEvent("runtime", "foreground-voice-repair-deferred", {
    reason: "conversation-owns-runtime",
    listening: conversation.isListening, processing: conversation.isProcessing, speaking: conversation.isSpeaking,
    ...captureStatus(context),
  });
}

async function retryWakeword(context: RecoveryContext): Promise<void> {
  recordDiagnosticEvent("runtime", "foreground-voice-retry", captureStatus(context));
  await settle();
  if (!needsRepair(context)) return;
  await voiceRuntime.sync();
  if (!canRepair(context)) return;
  if (context.feeder.isRunning) await context.feeder.waitForFreshPcm(PCM_RETRY_TIMEOUT_MS);
  if (!canRepair(context)) return;
  recordDiagnosticEvent("runtime", "foreground-voice-retry-finished", captureStatus(context));
}

async function restartWakeword(context: RecoveryContext): Promise<void> {
  if (!needsRepair(context)) return;
  recordDiagnosticEvent("runtime", "foreground-voice-hard-restart", captureStatus(context));
  await voiceRuntime.stop();
  if (!canResumeIdleVoice(context)) return;
  await settle();
  if (!canResumeIdleVoice(context)) return;
  // start() restores the facade while respecting the latest wakeword opt-in.
  // Disabling wake listening during teardown must not leave the facade stopped.
  await voiceRuntime.start();
  if (!canRepair(context)) return;
  await voiceRuntime.sync();
  if (!canRepair(context)) return;
  if (context.feeder.isRunning) await context.feeder.waitForFreshPcm(PCM_STARTUP_TIMEOUT_MS);
  if (!canRepair(context)) return;
  recordDiagnosticEvent("runtime", "foreground-voice-hard-restart-finished", captureStatus(context));
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, REPAIR_SETTLE_MS));
}
