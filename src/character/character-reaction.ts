import { create } from "zustand";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";

export type CharacterMood =
  | "listening"
  | "attentive"
  | "thoughtful"
  | "curious"
  | "repairing"
  | "clarified"
  | "petted"
  | "expectant"
  | "startled"
  | "pleased"
  | "annoyed"
  | "angry"
  | "victory";

type CharacterReactionState = {
  mood: CharacterMood | null;
  reactionId: number;
  expiresAt: number | null;
  /** Who triggered the current reaction, e.g. "friendly-face-stroke". */
  source?: string | null;
  setReaction: (mood: CharacterMood | null, reactionId: number, expiresAt: number | null, source?: string | null) => void;
};

let nextReactionId = 1;
let reactionTimer: ReturnType<typeof setTimeout> | null = null;

export const useCharacterReactionStore = create<CharacterReactionState>((set) => ({
  mood: null,
  reactionId: 0,
  expiresAt: null,
  source: null,
  setReaction: (mood, reactionId, expiresAt, source = null) => set({ mood, reactionId, expiresAt, source }),
}));

export function triggerCharacterReaction(
  mood: CharacterMood,
  options: { durationMs?: number; source?: string } = {}
): number {
  if (reactionTimer) clearTimeout(reactionTimer);
  const reactionId = nextReactionId++;
  const durationMs = Math.max(250, Math.min(5_000, Math.round(options.durationMs ?? 900)));
  const expiresAt = Date.now() + durationMs;
  useCharacterReactionStore.getState().setReaction(mood, reactionId, expiresAt, options.source ?? null);
  recordDiagnosticEvent("character", "reaction-started", {
    mood,
    reactionId,
    durationMs,
    source: options.source ?? "unknown",
  });
  reactionTimer = setTimeout(() => {
    reactionTimer = null;
    const current = useCharacterReactionStore.getState();
    if (current.reactionId !== reactionId) return;
    current.setReaction(null, reactionId, null);
    recordDiagnosticEvent("character", "reaction-finished", { mood, reactionId });
  }, durationMs);
  return reactionId;
}

export function clearCharacterReaction(reason = "explicit"): void {
  if (reactionTimer) clearTimeout(reactionTimer);
  reactionTimer = null;
  const current = useCharacterReactionStore.getState();
  if (!current.mood) return;
  const mood = current.mood;
  const reactionId = current.reactionId;
  current.setReaction(null, reactionId, null);
  recordDiagnosticEvent("character", "reaction-cleared", { mood, reactionId, reason });
}
