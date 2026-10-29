import { BasePerceiver } from "../core/perceiver";
import { getRuntimeProfile } from "../core/runtime-profile";
import { isManagedConversationMode, useUserStore } from "../store/user";
import { getVoiceModule } from "../voice/lazy-services";

/**
 * Lightweight voice runtime facade. It keeps cold start free of Sherpa,
 * AudioStudio, and expo-audio until voice is explicitly needed.
 */
export class VoiceRuntime extends BasePerceiver {
  name = "voice";
  private loaded = false;
  private unsubscribeVoice: (() => void) | null = null;
  private mainScreenTransitionQueue: Promise<void> = Promise.resolve();
  private externalMediaOwner: string | null = null;

  get isMediaExternallyOwned(): boolean { return this.externalMediaOwner !== null; }

  /** Close the admission gate synchronously before the lifecycle queue drains. */
  blockForExternalMedia(owner: string): void {
    if (this.externalMediaOwner && this.externalMediaOwner !== owner) throw new Error("Voice media is owned by another app");
    this.externalMediaOwner = owner;
  }

  releaseExternalMedia(owner: string): void {
    if (this.externalMediaOwner === owner) this.externalMediaOwner = null;
  }

  async start(): Promise<void> {
    if (this.isMediaExternallyOwned) return;
    if (this.isActive) {
      await this.sync();
      return;
    }
    this.isActive = true;

    const prefs = useUserStore.getState().preferences;
    if (!getRuntimeProfile().allowsWakewordAutostart || !prefs.wakeWordEnabled) {
      return;
    }

    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.start();
  }

  async sync(): Promise<void> {
    if (!this.isActive || this.isMediaExternallyOwned) return;
    const prefs = useUserStore.getState().preferences;
    if (!getRuntimeProfile().allowsWakewordAutostart || !prefs.wakeWordEnabled) {
      if (!this.loaded) return;
      const { voicePerceiver } = await getVoiceModule();
      if (this.isMediaExternallyOwned || !this.isActive) return;
      await voicePerceiver.syncWakewordRuntime();
      return;
    }

    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.start();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.syncConversationMode();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.syncWakewordRuntime();
  }

  async rearmWakewordAfterNavigation(): Promise<void> {
    if (!this.isActive || useUserStore.getState().robotSleeping || this.isMediaExternallyOwned) return;
    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.start();
    if (this.isMediaExternallyOwned || !this.isActive) return;
    await voicePerceiver.rearmWakewordAfterNavigation();
  }

  async suspendMainScreenConversation(reason = "main-screen-blur"): Promise<void> {
    return this.enqueueMainScreenTransition(async () => {
      if (!this.loaded) return;
      const { realtimeConversationService } = await import("../voice/realtime-conversation");
      if (!realtimeConversationService.isActive) return;
      await realtimeConversationService.stop(reason);
    });
  }

  async resumeMainScreenConversation(
    source: "navigation-return" | "foreground-resume"
  ): Promise<void> {
    return this.enqueueMainScreenTransition(async () => {
      if (!this.isActive || useUserStore.getState().robotSleeping || this.isMediaExternallyOwned) return;
      await this.ensureLoaded();
      const { voicePerceiver } = await getVoiceModule();
      if (this.isMediaExternallyOwned || !this.isActive) return;
      await voicePerceiver.start();
      if (this.isMediaExternallyOwned || !this.isActive) return;

      const { realtimeConversationService } = await import("../voice/realtime-conversation");
      if (realtimeConversationService.isActive) {
        const { recordDiagnosticEvent } = await import("../diagnostics/diagnostic-log");
        recordDiagnosticEvent("navigation", "main-return-auto-listen-skipped", {
          source,
          reason: "realtime-already-active",
        });
        return;
      }

      const conversation = (await import("../store/conversation")).useConversationStore.getState();
      const voiceState = useUserStore.getState().voiceState;
      if (
        conversation.isListening ||
        conversation.isProcessing ||
        conversation.isSpeaking ||
        voiceState === "processing" ||
        voiceState === "speaking" ||
        voiceState === "verifying"
      ) {
        const { recordDiagnosticEvent } = await import("../diagnostics/diagnostic-log");
        recordDiagnosticEvent("navigation", "main-return-auto-listen-skipped", {
          source,
          reason: "conversation-busy",
          voiceState,
          listening: conversation.isListening,
          processing: conversation.isProcessing,
          speaking: conversation.isSpeaking,
        });
        return;
      }

      const { recordDiagnosticEvent } = await import("../diagnostics/diagnostic-log");
      // Imports above may settle after an external app has acquired the devices.
      if (this.isMediaExternallyOwned || !this.isActive || useUserStore.getState().robotSleeping) return;
      const conversationMode = useUserStore.getState().preferences.conversationMode;
      recordDiagnosticEvent("navigation", "main-return-auto-listen", {
        source,
        conversationMode,
        realtimeEntryPreparation: isManagedConversationMode(conversationMode) ? "pcm-stability-gate" : "n/a",
      });
      if (isManagedConversationMode(conversationMode)) {
        await voicePerceiver.resumeRealtimeConversationFromMain(source);
        return;
      }
      await voicePerceiver.trigger();
    });
  }

  async stop(): Promise<void> {
    this.isActive = false;
    if (!this.loaded) return;

    const { voicePerceiver } = await getVoiceModule();
    await voicePerceiver.stop();
  }

  async trigger(): Promise<void> {
    if (this.isMediaExternallyOwned) return;
    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned) return;
    await voicePerceiver.start();
    if (this.isMediaExternallyOwned) return;
    await voicePerceiver.trigger();
  }

  async interruptAndListen(): Promise<void> {
    if (this.isMediaExternallyOwned) return;
    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned) return;
    await voicePerceiver.start();
    if (this.isMediaExternallyOwned) return;
    await voicePerceiver.interruptAndListen("tap");
  }

  async applyLiveRealtimePreferences(source: string): Promise<boolean> {
    const { realtimeConversationService } = await import("../voice/realtime-conversation");
    if (!realtimeConversationService.isActive) return false;
    realtimeConversationService.applySessionPreferences(source);
    return true;
  }

  async prepareIdleCharacterReaction(): Promise<{ ok: boolean; reason: string }> {
    if (this.isMediaExternallyOwned) return { ok: false, reason: "external-robot-app" };
    await this.ensureLoaded();
    const { voicePerceiver } = await getVoiceModule();
    if (this.isMediaExternallyOwned) return { ok: false, reason: "external-robot-app" };
    await voicePerceiver.start();
    if (this.isMediaExternallyOwned) return { ok: false, reason: "external-robot-app" };
    return voicePerceiver.prepareIdleCharacterReaction();
  }

  async finishListening(): Promise<void> {
    if (!this.loaded) return;

    const { voicePerceiver } = await getVoiceModule();
    await voicePerceiver.finishListening();
  }

  private enqueueMainScreenTransition(task: () => Promise<void>): Promise<void> {
    const queued = this.mainScreenTransitionQueue.then(task, task);
    this.mainScreenTransitionQueue = queued.catch(() => undefined);
    return queued;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const { voicePerceiver } = await getVoiceModule();
    this.unsubscribeVoice = voicePerceiver.onObservation((observation) => {
      this.emit(observation);
    });
  }
}

export const voiceRuntime = new VoiceRuntime();
