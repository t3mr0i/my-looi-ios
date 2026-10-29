import { AppState } from "react-native";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { isMainScreenFocused } from "../core/main-screen-presence";
import { markRobotInteraction } from "../core/robot-inactivity";
import { createObservation } from "../core/observation";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { stopLooiMotion } from "../device-tools/looi-robot";
import { getVoiceResponseMessage } from "../language/response-messages";
import { normalizeListeningLanguage } from "../language/listening-language";
import { normalizeResponseLanguage } from "../language/response-language";
import { isLocalMemoryMutationInProgress, memoryService, mirrorSessionMessage, mirrorSessionTouch, retrieveConversationMemories } from "../memory/memory-service";
import { localMemoryDatabase } from "../memory/local-memory-database";
import { generateBudgetReply, type BudgetConversationToolName } from "../openai/budget-conversation";
import { speakOpenAiText, stopOpenAiSpeech } from "../openai/openai-speech";
import { useConversationStore } from "../store/conversation";
import { splitBudgetSpeechSections } from "../character/speech-expression";
import { cancelCharacterAction, requestCharacterActionFromVoice, completeCharacterActionReply } from "../character/character-action-runtime";
import { useUserStore } from "../store/user";
import { kwsAudioFeeder } from "./kws-audio-feeder";
import { executeRealtimePhysicalCommand, parseRealtimePhysicalCommand } from "./realtime-physical-command";
import { sttService } from "./stt";
import { vadService } from "./vad-service";
import { InputAttentionDetector } from "./input-attention";
import { wakewordService, type WakewordDetection } from "./wakeword";
import { robotAppSkillToolBridge } from "./robot-app-skill-tools";
import { ROBOT_APP_SKILL_TOOL_NAMES } from "./robot-app-skill-tool-definitions";
import { acceptCompanionPersonalityTurn, getCompanionPersonalityContext, noteCompanionPersonalitySpeech, readCompanionInterests } from "../behavior/behavior-events";

const SAMPLE_RATE = 16_000;
const MAX_TURN_SAMPLES = SAMPLE_RATE * 20;
const PREROLL_SAMPLES = SAMPLE_RATE * 0.6;
const SILENCE_SAMPLES = SAMPLE_RATE * 0.8;
const LISTENING_TIMEOUT_MS = 30_000;

type TurnTiming = {
  endpointMs?: number;
  segmentEndEstimateMs?: number;
  commitMs?: number;
  sttStartMs?: number;
  sttDoneMs?: number;
  memoryDoneMs?: number;
  replyDoneMs?: number;
  speechRequestedMs?: number;
  playbackStartedMs?: number;
  maxVadQueueMs: number;
  maxVadProcessingMs: number;
};

/** Turn-based conversation: local STT, a small text model, then cloud speech.
 * The existing feeder is the only recorder. Capture is stopped during playback;
 * tapping interrupts a request or playback and starts a fresh local turn. */
export class BudgetConversationService {
  private active = false;
  private epoch = 0;
  private sessionId: string | null = null;
  private phase: "idle" | "listening" | "processing" | "speaking" = "idle";
  private controller: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private samples: number[] = [];
  private hadSpeech = false;
  private silence = 0;
  private vadQueue: Promise<void> = Promise.resolve();
  private queuedSamples = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private turnTiming: TurnTiming = { maxVadQueueMs: 0, maxVadProcessingMs: 0 };
  private receivedSamples = 0;
  private inputFrames: Array<{ start: number; end: number; receivedMs: number }> = [];
  private healthLoggedMs = 0;
  private healthMaxRms = 0;
  private healthPeak = 0;
  private healthFrames = 0;
  private inputAttention = new InputAttentionDetector();

  get isActive(): boolean { return this.active; }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecycle.then(operation, operation);
    this.lifecycle = next.catch(() => undefined);
    return next;
  }

  private current(epoch: number): boolean {
    return this.active && this.epoch === epoch && AppState.currentState === "active"
      && isMainScreenFocused() && !useUserStore.getState().robotSleeping
      && useUserStore.getState().preferences.conversationMode === "budget"
      && !isLocalMemoryMutationInProgress();
  }

  async start(detection?: WakewordDetection): Promise<void> {
    if (this.active) return;
    if (isLocalMemoryMutationInProgress() || AppState.currentState !== "active" || !isMainScreenFocused()
      || useUserStore.getState().robotSleeping || useUserStore.getState().preferences.conversationMode !== "budget") return;
    this.active = true;
    const epoch = ++this.epoch;
    this.sessionId = `budget_${Date.now()}_${epoch}`;
    noteCompanionPersonalitySpeech(null, this.sessionId);
    const store = useConversationStore.getState();
    store.setActiveSession(this.sessionId, []);
    mirrorSessionTouch(this.sessionId, "system");
    store.setRealtimeIssue(null);
    store.setRealtimeReadiness("preparing-microphone");
    store.setOverlayVisible(true);
    try {
      await this.enqueue(async () => {
        if (!this.current(epoch)) return;
        const permission = await requestRecordingPermissionsAsync();
        if (!this.current(epoch)) return;
        if (!permission.granted) throw new Error("Microphone permission denied");
        await stopLooiMotion("budget-entry");
        if (!this.current(epoch)) return;
        await wakewordService.stop();
        if (!this.current(epoch)) return;
        await vadService.start();
        if (!this.current(epoch)) return;
        await this.listen(epoch, detection?.commandPrerollSamples);
      });
    } catch (error) {
      await this.fail(epoch, error, true);
    }
  }

  async interruptAndListen(source = "tap"): Promise<void> {
    if (!this.active) return this.start();
    if (this.phase === "listening" && this.hadSpeech) {
      this.finishListening();
      return;
    }
    if (this.phase === "listening" && kwsAudioFeeder.isRunning && kwsAudioFeeder.diagnosticStatus.pcmFlowing) {
      // A tap while waiting must not discard pending input or pay another
      // recorder startup. Keep the explicit motion stop and renew idle time.
      const listeningEpoch = this.epoch;
      await stopLooiMotion(`budget-${source}`).catch(() => undefined);
      if (this.current(listeningEpoch) && this.phase === "listening") this.armListeningTimeout(listeningEpoch);
      return;
    }
    const epoch = ++this.epoch;
    if (this.sessionId) noteCompanionPersonalitySpeech(null, this.sessionId);
    useConversationStore.getState().setHeardSpeechText(null);
    this.controller?.abort();
    this.detach();
    await stopLooiMotion(`budget-${source}`).catch(() => undefined);
    try {
      await this.enqueue(async () => {
        await stopOpenAiSpeech();
        await kwsAudioFeeder.stop();
        if (this.current(epoch)) await this.listen(epoch);
      });
    } catch (error) { await this.fail(epoch, error, true); }
  }

  /** Also used by the press-and-release voice control. */
  finishListening(): void {
    const epoch = this.epoch;
    // Include the last microphone chunk whose local VAD result is still pending.
    void this.vadQueue.then(() => this.commitTurn(epoch));
  }

  private commitTurn(epoch: number): void {
    if (!this.active || this.phase !== "listening") return;
    if (!this.current(epoch)) return;
    this.phase = "processing";
    this.turnTiming.commitMs = performance.now();
    const samples = this.hadSpeech ? this.samples.slice() : [];
    this.detach();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const store = useConversationStore.getState();
    store.setListening(false);
    store.setUserSpeaking(false);
    store.setProcessing(true);
    useUserStore.getState().setVoiceState("processing");
    void this.enqueue(() => kwsAudioFeeder.stop())
      .then(() => this.processTurn(epoch, samples, signal))
      .catch((error) => this.fail(epoch, error));
  }

  async stop(reason = "explicit"): Promise<void> {
    cancelCharacterAction(`budget-${reason}`);
    if (!this.active && this.phase === "idle") return;
    if (this.sessionId) noteCompanionPersonalitySpeech(null, this.sessionId);
    this.active = false;
    const epoch = ++this.epoch;
    useConversationStore.getState().setHeardSpeechText(null);
    this.controller?.abort();
    this.controller = null;
    this.detach();
    this.phase = "idle";
    await this.enqueue(async () => {
      await Promise.allSettled([kwsAudioFeeder.stop(), stopOpenAiSpeech(), stopLooiMotion(`budget-${reason}`)]);
      if (this.epoch !== epoch) return;
      const store = useConversationStore.getState();
      store.setListening(false); store.setUserSpeaking(false); store.setSpeaking(false); store.setProcessing(false);
      store.setHeardSpeechText(null);
      store.setRealtimeReadiness("idle"); store.setOverlayVisible(false);
      useUserStore.getState().setVoiceState("sleeping");
      this.sessionId = null;
      if (["idle-timeout", "error", "explicit"].includes(reason) && AppState.currentState === "active"
        && isMainScreenFocused() && !useUserStore.getState().robotSleeping && !isLocalMemoryMutationInProgress()) {
        await wakewordService.start().catch(() => undefined);
        if (this.epoch !== epoch) return;
        kwsAudioFeeder.setWakewordFeedingEnabled(true);
        await kwsAudioFeeder.start().catch(() => undefined);
      }
    });
    recordDiagnosticEvent("runtime", "budget-session-stopped", { reason });
  }

  applySessionPreferences(): boolean { return this.active; }

  private async listen(epoch: number, preroll: number[] = []): Promise<void> {
    if (!this.current(epoch)) return;
    this.detach();
    this.samples = preroll.slice(-PREROLL_SAMPLES);
    this.hadSpeech = false;
    this.silence = 0;
    this.queuedSamples = 0;
    this.vadQueue = Promise.resolve();
    this.turnTiming = { maxVadQueueMs: 0, maxVadProcessingMs: 0 };
    this.receivedSamples = 0;
    this.inputFrames = [];
    this.healthLoggedMs = performance.now();
    this.healthMaxRms = 0; this.healthPeak = 0; this.healthFrames = 0;
    await vadService.reset();
    if (!this.current(epoch)) return;
    kwsAudioFeeder.setWakewordFeedingEnabled(false);
    this.phase = "listening";
    this.unsubscribe = kwsAudioFeeder.subscribeSamples((samples, rate) => {
      if (!this.current(epoch) || this.phase !== "listening") return;
      if (rate !== SAMPLE_RATE || this.queuedSamples > SAMPLE_RATE * 3) {
        void this.fail(epoch, new Error("Local speech input could not keep up"), true);
        return;
      }
      this.queuedSamples += samples.length;
      const receivedMs = performance.now();
      let energy = 0;
      let peak = 0;
      for (const sample of samples) {
        if (!Number.isFinite(sample)) continue;
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(energy / Math.max(1, samples.length));
      const store = useConversationStore.getState();
      if (this.sessionId && store.activeSessionId === this.sessionId && store.isListening && !store.isProcessing && !store.isSpeaking && store.realtimeReadiness === "ready"
        && this.inputAttention.accept({ receivedAtMs: receivedMs, durationMs: samples.length / rate * 1000, rms, peak })) {
        store.requestInputAttention(this.sessionId, receivedMs);
      }
      const frame = { start: this.receivedSamples, end: this.receivedSamples + samples.length, receivedMs };
      this.receivedSamples = frame.end;
      this.inputFrames.push(frame);
      if (this.inputFrames.length > 2000) this.inputFrames.shift();
      this.vadQueue = this.vadQueue.then(async () => {
        if (!this.current(epoch) || this.phase !== "listening") return;
        this.queuedSamples -= samples.length;
        const vadStartedMs = performance.now();
        const result = await vadService.acceptSamples(samples, rate);
        if (!this.current(epoch) || this.phase !== "listening") return;
        const vadFinishedMs = performance.now();
        this.healthPeak = Math.max(this.healthPeak, peak);
        this.healthMaxRms = Math.max(this.healthMaxRms, rms);
        this.healthFrames++;
        if (vadFinishedMs - this.healthLoggedMs >= 1000) {
          recordDiagnosticEvent("microphone", "budget-input-health", {
            sessionId: this.sessionId, frameSamples: samples.length, frameDurationMs: samples.length / rate * 1000,
            windowMs: vadFinishedMs - this.healthLoggedMs, frames: this.healthFrames,
            maxRms: this.healthMaxRms, peak: this.healthPeak, vadSpeech: result.isSpeechDetected,
            completedSegments: result.segments?.length ?? 0,
            vadProcessingMs: vadFinishedMs - vadStartedMs, vadQueueMs: vadStartedMs - receivedMs,
            queuedAudioMs: this.queuedSamples / rate * 1000, hadSpeech: this.hadSpeech,
          });
          this.healthLoggedMs = vadFinishedMs;
          this.healthMaxRms = 0; this.healthPeak = 0; this.healthFrames = 0;
        }
        this.turnTiming.maxVadQueueMs = Math.max(this.turnTiming.maxVadQueueMs, vadStartedMs - receivedMs);
        this.turnTiming.maxVadProcessingMs = Math.max(this.turnTiming.maxVadProcessingMs, vadFinishedMs - vadStartedMs);
        this.samples.push(...samples);
        if (result.isSpeechDetected) {
          if (!this.hadSpeech) {
            markRobotInteraction("budget-speech");
            recordDiagnosticEvent("latency", "budget-input-attention", {
              sessionId: this.sessionId, clock: "js-performance", frameDurationMs: samples.length / rate * 1000,
              receiptToStateMs: performance.now() - receivedMs,
              evidence: "JS input receipt to state request; excludes capture, bridge and visible display",
            });
          }
          this.turnTiming.endpointMs = undefined;
          this.turnTiming.segmentEndEstimateMs = undefined;
          this.hadSpeech = true;
          this.silence = 0;
          useConversationStore.getState().setUserSpeaking(true);
        } else if (this.hadSpeech) {
          this.silence += samples.length;
          const segment = result.segments?.filter((item) => Number.isFinite(item.startTime)
            && Number.isFinite(item.endTime) && item.startTime! >= 0 && item.endTime! > item.startTime!).at(-1);
          if (segment) {
            this.turnTiming.endpointMs = vadFinishedMs;
            const endSample = segment.endTime! * rate;
            const endFrame = this.inputFrames.find((item) => endSample > item.start && endSample <= item.end);
            this.turnTiming.segmentEndEstimateMs = endFrame
              ? endFrame.receivedMs - (endFrame.end - endSample) / rate * 1000 : undefined;
          }
        } else {
          this.samples = this.samples.slice(-PREROLL_SAMPLES);
        }
        // Native VAD has already waited for its endpoint silence. Do not add a
        // second hold, or end the turn while the current block contains speech.
        const completedSegment = this.hadSpeech && !result.isSpeechDetected && Array.isArray(result.segments) && result.segments.length > 0;
        if (completedSegment || this.samples.length >= MAX_TURN_SAMPLES || (this.hadSpeech && this.silence >= SILENCE_SAMPLES)) {
          this.samples = this.samples.slice(0, MAX_TURN_SAMPLES);
          this.commitTurn(epoch);
        }
      }).catch((error) => { void this.fail(epoch, error, true); });
    });
    await kwsAudioFeeder.start();
    if (!this.current(epoch)) return;
    if (!kwsAudioFeeder.isRunning) throw new Error("Local microphone capture did not start");
    const store = useConversationStore.getState();
    store.setListening(true); store.setProcessing(false); store.setSpeaking(false); store.setUserSpeaking(false);
    store.setHeardSpeechText(null);
    store.setRealtimeReadiness("ready"); store.setCurrentTranscript(""); store.setOverlayVisible(true);
    useUserStore.getState().setVoiceState("listening");
    this.armListeningTimeout(epoch);
  }

  private armListeningTimeout(epoch: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.current(epoch)) {
        if (this.hadSpeech) this.finishListening();
        else void this.stop("idle-timeout");
      }
    }, LISTENING_TIMEOUT_MS);
  }

  private async processTurn(epoch: number, samples: number[], signal: AbortSignal): Promise<void> {
    const valid = () => this.current(epoch) && !signal.aborted;
    if (!valid()) return;
    this.turnTiming.sttStartMs = performance.now();
    const transcript = samples.length ? await sttService.transcribeCommandSamples(samples, SAMPLE_RATE, signal) : "";
    if (!valid()) return;
    this.turnTiming.sttDoneMs = performance.now();
    const store = useConversationStore.getState();
    if (!transcript.trim()) {
      await this.speak(epoch, getVoiceResponseMessage(useUserStore.getState().preferences.language, "not-heard"), signal);
      if (valid()) await this.enqueue(() => this.listen(epoch));
      return;
    }
    markRobotInteraction("budget-turn");
    store.setCurrentTranscript(transcript);
    if (this.sessionId) acceptCompanionPersonalityTurn(transcript, this.sessionId);
    store.addMessage({ role: "user", content: transcript });
    if (this.sessionId) mirrorSessionMessage(this.sessionId, { role: "user", content: transcript });
    const preferences = useUserStore.getState().preferences;
    cancelCharacterAction("budget-user-turn");
    if (this.sessionId) requestCharacterActionFromVoice(transcript, this.sessionId, preferences.robotName);
    const physical = parseRealtimePhysicalCommand(transcript, preferences);
    let answer: string;
    if (physical) {
      // Turn-based speech releases the microphone. Do not start wheel motion
      // while the continuous local emergency recognizer is unavailable.
      const needsLiveStop = physical.kind === "explicit" && (physical.command.kind === "dance"
        || physical.command.kind === "turn" || (physical.command.kind === "move" && physical.command.direction !== "stop"));
      if (needsLiveStop) {
        const language = preferences.language;
        answer = language === "de" ? "Für Radbewegungen nutze bitte den Realtime-Modus."
          : language === "uk" ? "Для руху коліс використовуй режим Realtime."
            : language === "ru" ? "Для движения колёс используй режим Realtime."
              : "Please use Realtime mode for wheel movements.";
      } else {
        const result = await executeRealtimePhysicalCommand(physical, transcript);
        if (!valid()) return;
        answer = result.acknowledgement;
      }
    } else {
      const memory = await retrieveConversationMemories(transcript);
      if (!valid()) return;
      this.turnTiming.memoryDoneMs = performance.now();
      const reply = await generateBudgetReply({
        history: useConversationStore.getState().messages.map(({ role, content }) => ({ role, content })),
        language: preferences.language,
        robotName: preferences.robotName,
        personalityContext: getCompanionPersonalityContext(transcript),
        memoryContext: memory.facts.map((fact) => fact.memory).join("\n"),
        signal,
        runTool: (name, args) => this.runTool(epoch, signal, name, args, transcript),
      });
      if (!valid()) return;
      this.turnTiming.replyDoneMs = performance.now();
      answer = reply.text;
      recordDiagnosticEvent("cost", "budget-text-usage", { model: reply.model, ...reply.usage });
    }
    if (!valid()) return;
    store.addMessage({ role: "assistant", content: answer });
    store.setStreamingText(answer);
    if (this.sessionId) mirrorSessionMessage(this.sessionId, { role: "assistant", content: answer });
    await this.speak(epoch, answer, signal);
    if (valid() && this.sessionId) completeCharacterActionReply(this.sessionId);
    if (valid()) await this.enqueue(() => this.listen(epoch));
  }

  private async runTool(epoch: number, signal: AbortSignal, name: BudgetConversationToolName, args: Record<string, unknown>, userText: string): Promise<unknown> {
    if (!this.current(epoch) || signal.aborted) throw new Error("Conversation ended");
    if (name === "list_companion_interests") return readCompanionInterests(userText);
    if (ROBOT_APP_SKILL_TOOL_NAMES.has(name)) {
      return robotAppSkillToolBridge.execute(name, args, {
        sessionId: this.sessionId ?? `budget-${epoch}`,
        userTurnRevision: epoch,
        userText,
        isCurrent: () => this.current(epoch) && !signal.aborted,
        allowAppStart: false,
      });
    }
    if (name === "search_memory") return memoryService.search(String(args.query ?? "").slice(0, 500));
    if (name === "remember") {
      const note = String(args.note ?? "").trim().slice(0, 600);
      if (!note) throw new Error("Empty memory");
      const metadata = { ...createObservation(note, "voice", "note").metadata, origin: "conversation" as const, sourceSessionId: this.sessionId ?? undefined };
      await localMemoryDatabase.remember([{ role: "user", content: note }], metadata,
        () => this.current(epoch) && !signal.aborted);
      return { ok: true };
    }
    if (name === "set_language_preferences") {
      const language = normalizeResponseLanguage(args.response_language);
      const listeningLanguage = args.listening_language == null ? undefined : normalizeListeningLanguage(args.listening_language);
      useUserStore.getState().updatePreferences({ language, ...(listeningLanguage ? { listeningLanguage } : {}) });
      return { response_language: language, listening_language: listeningLanguage ?? useUserStore.getState().preferences.listeningLanguage };
    }
    throw new Error("Unsupported tool");
  }

  private async speak(epoch: number, text: string, signal: AbortSignal): Promise<void> {
    if (!this.current(epoch) || signal.aborted) return;
    const preferences = useUserStore.getState().preferences;
    const store = useConversationStore.getState();
    store.setHeardSpeechText(null);
    store.setProcessing(false);
    if (!preferences.ttsEnabled) return;
    this.phase = "speaking";
    const sections = splitBudgetSpeechSections(text);
    for (let index = 0; index < sections.length; index += 1) {
      if (!this.current(epoch) || signal.aborted) return;
      const section = sections[index];
      if (index === 0) this.turnTiming.speechRequestedMs = performance.now();
      await speakOpenAiText(section, {
        streaming: true,
        voiceId: preferences.ttsVoiceId, styleId: preferences.ttsStyleId, speed: preferences.ttsSpeed, signal,
        personalityContext: getCompanionPersonalityContext(""),
        onStart: () => {
          if (!this.current(epoch) || signal.aborted) return;
          if (index === 0) {
            this.turnTiming.playbackStartedMs = performance.now();
            this.recordTurnTiming();
          }
          useConversationStore.getState().setHeardSpeechText(index < 2 ? section : null);
          useConversationStore.getState().setSpeaking(true);
          useUserStore.getState().setVoiceState("speaking");
        },
      });
      if (!this.current(epoch) || signal.aborted) return;
      // The clip's transcript is known in advance; onStart fires only after
      // native playback reports `playing`, and completion retires the phrase.
      useConversationStore.getState().setHeardSpeechText(null);
    }
    if (this.current(epoch) && !signal.aborted && this.sessionId) noteCompanionPersonalitySpeech(text, this.sessionId);
    if (this.current(epoch)) useConversationStore.getState().setSpeaking(false);
  }

  private recordTurnTiming(): void {
    const timing = this.turnTiming;
    const duration = (end?: number, start?: number) => end !== undefined && start !== undefined && end >= start ? end - start : null;
    recordDiagnosticEvent("latency", "budget-turn-latency", {
      sessionId: this.sessionId, clock: "js-performance",
      segmentEndToPlayingEstimateMs: duration(timing.playbackStartedMs, timing.segmentEndEstimateMs),
      endpointToCommitMs: duration(timing.commitMs, timing.endpointMs),
      commitToPlayingMs: duration(timing.playbackStartedMs, timing.commitMs),
      captureStopMs: duration(timing.sttStartMs, timing.commitMs),
      sttMs: duration(timing.sttDoneMs, timing.sttStartMs),
      memoryMs: duration(timing.memoryDoneMs, timing.sttDoneMs),
      textReplyMs: duration(timing.replyDoneMs, timing.memoryDoneMs),
      speechPreparationMs: duration(timing.playbackStartedMs, timing.speechRequestedMs),
      maxVadQueueMs: timing.maxVadQueueMs, maxVadProcessingMs: timing.maxVadProcessingMs,
      evidence: "VAD segment mapped to JS chunk receipt; player playing callback; external acoustic verification required",
    });
  }

  private detach(): void {
    this.inputAttention.reset();
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async fail(epoch: number, error: unknown, microphone = false): Promise<void> {
    if (!this.current(epoch)) return;
    recordDiagnosticEvent("runtime", "budget-turn-failed", { error: error instanceof Error ? error.message : String(error) });
    await this.stop("error");
    if (this.epoch !== epoch + 1) return;
    const store = useConversationStore.getState();
    store.setRealtimeReadiness(microphone ? "microphone-error" : "error");
    store.setStreamingText(getVoiceResponseMessage(useUserStore.getState().preferences.language, "processing-failed"));
    store.setOverlayVisible(true);
  }
}

export const budgetConversationService = new BudgetConversationService();
