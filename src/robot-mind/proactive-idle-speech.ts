/**
 * The cheapest honest way for an idle LOOI to say something on its own: one
 * short line from the Budget text model, spoken by the existing cloud TTS,
 * then (when the occasion invites a reply) the microphone opens the same way
 * a wake word would, so the person can simply answer.
 *
 * Like Classic speech, the recorder stays warm and only wake-word feeding is
 * paused while LOOI talks, so it cannot wake itself. A tap or a conversation
 * starting meanwhile cancels the line. App access is injected.
 */
import type { ProactiveLineRequest } from "./proactive-speech-runtime";

export type ConversationModeForProactive = "budget" | "realtime" | "realtime_pcm";

export interface IdleProactiveSpeechDeps {
  /** null when the app is idle and safe to speak in, otherwise the reason it is not. */
  checkIdle(): string | null;
  generateLine(occasionText: string, signal: AbortSignal): Promise<{ text: string; model: string; usage: Record<string, number> }>;
  speak(text: string, signal: AbortSignal): Promise<void>;
  isWakewordFeeding(): boolean;
  setWakewordFeeding(enabled: boolean): void;
  /** Show (text) or clear (null) the speaking face and subtitle; keepOverlay when a conversation took over. */
  showSpeaking(text: string | null, keepOverlay?: boolean): void;
  /** Calls back when a tap, wake or conversation takes the voice pipeline over. */
  watchForTakeover(onTakeover: () => void): () => void;
  getConversationMode(): ConversationModeForProactive;
  openMicrophone(): Promise<void>;
  record(category: "runtime" | "cost", event: string, details: Record<string, string | number | boolean | null>): void;
}

export function createIdleProactiveSpeaker(deps: IdleProactiveSpeechDeps) {
  let speaking = false;

  return {
    get isSpeaking(): boolean { return speaking; },

    async speak(request: ProactiveLineRequest): Promise<boolean> {
      const refuse = (reason: string) => {
        deps.record("runtime", "proactive-idle-silent", { occasion: request.occasion, reason });
        return false;
      };
      if (speaking) return refuse("already-speaking");
      const blocked = deps.checkIdle();
      if (blocked) return refuse(blocked);
      speaking = true;
      const controller = new AbortController();
      try {
        let line: string;
        try {
          const reply = await deps.generateLine(request.occasionText, controller.signal);
          deps.record("cost", "proactive-line-text-usage", { route: "idle", model: reply.model, ...reply.usage });
          line = reply.text.trim();
        } catch (error) {
          return refuse(`generation-failed:${error instanceof Error ? error.message : String(error)}`);
        }
        const blockedAfterGeneration = deps.checkIdle();
        if (!line) return refuse("empty-line");
        if (blockedAfterGeneration) return refuse(blockedAfterGeneration);

        const feeding = deps.isWakewordFeeding();
        let takenOver = false;
        const stopWatching = deps.watchForTakeover(() => { takenOver = true; controller.abort(); });
        deps.setWakewordFeeding(false);
        deps.record("cost", "proactive-line-speech", { route: "idle", characters: line.length });
        let completed = false;
        try {
          deps.showSpeaking(line);
          await deps.speak(line, controller.signal);
          completed = !controller.signal.aborted;
        } catch (error) {
          if (!takenOver) deps.record("runtime", "proactive-idle-speech-failed", { error: error instanceof Error ? error.message : String(error) });
        } finally {
          stopWatching();
          deps.showSpeaking(null, takenOver);
          // A conversation that took over owns the wake-word feed now.
          if (!takenOver) deps.setWakewordFeeding(feeding);
        }
        if (!completed) return takenOver;

        if (!request.invitesReply || deps.checkIdle()) return true;
        const mode = deps.getConversationMode();
        if (mode !== "budget" && request.level !== "lively") {
          deps.record("runtime", "proactive-microphone-left-to-wake-word", { occasion: request.occasion, mode });
          return true;
        }
        if (mode !== "budget") {
          deps.record("cost", "proactive-realtime-session-opened", { occasion: request.occasion, mode });
        } else {
          deps.record("runtime", "proactive-microphone-opened", { occasion: request.occasion, mode });
        }
        await deps.openMicrophone().catch((error) => {
          deps.record("runtime", "proactive-microphone-open-failed", { error: error instanceof Error ? error.message : String(error) });
        });
        return true;
      } finally {
        speaking = false;
      }
    },
  };
}
