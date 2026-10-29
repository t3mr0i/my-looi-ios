/** A display-only indication of incoming sound, never a speech/intent decision. */
export type InputAttentionCue = {
  id: string;
  sessionId: string;
  receivedAtMs: number;
  requestedAtMs: number;
  expiresAtMs: number;
};

export const INPUT_ATTENTION_DURATION_MS = 420;

export function isInputAttentionVisible(cue: InputAttentionCue | null, sessionId: string | null, nowMs: number): boolean {
  return !!cue && cue.sessionId === sessionId && Number.isFinite(nowMs)
    && nowMs >= cue.requestedAtMs && nowMs < cue.expiresAtMs;
}

type InputFrame = {
  receivedAtMs: number;
  durationMs: number;
  rms: number;
  peak: number;
  /** Only pass a difference from the same native monotonic clock. */
  deliveryAgeMs?: number;
  sequence?: number;
};

/** At most one cue per listening turn. Constant space; no timers or side effects. */
export class InputAttentionDetector {
  private signaled = false;
  private signalMs = 0;
  private previousMs: number | null = null;
  private previousSequence: number | null = null;

  reset(): void { this.signaled = false; this.signalMs = 0; this.previousMs = null; this.previousSequence = null; }

  accept(frame: InputFrame): boolean {
    if (this.signaled) return false;
    const { receivedAtMs, durationMs, rms, peak, deliveryAgeMs, sequence } = frame;
    const elapsed = this.previousMs === null ? null : receivedAtMs - this.previousMs;
    const staleSequence = sequence !== undefined && (!Number.isInteger(sequence) || sequence < 0
      || (this.previousSequence !== null && sequence <= this.previousSequence));
    if (sequence !== undefined && Number.isInteger(sequence)) this.previousSequence = Math.max(this.previousSequence ?? sequence, sequence);
    this.previousMs = Number.isFinite(receivedAtMs) ? receivedAtMs : null;
    if (![receivedAtMs, durationMs, rms, peak].every(Number.isFinite)
      || durationMs < 10 || durationMs > 200 || rms < 0 || peak < rms || peak > 1 || staleSequence
      || (deliveryAgeMs !== undefined && (!Number.isFinite(deliveryAgeMs) || deliveryAgeMs < 0 || deliveryAgeMs > 100))
      || (elapsed !== null && (elapsed < durationMs * 0.4 || elapsed > 400))) {
      this.signalMs = 0;
      return false;
    }
    // A quiet floor and crest-factor guard reject silence and isolated clicks.
    // Sustained ambient sound can still qualify; this deliberately conveys no meaning.
    this.signalMs = rms >= 0.0015 && peak > 0 && rms / peak >= 0.08 ? this.signalMs + durationMs : 0;
    if (this.signalMs < 40) return false;
    this.signaled = true;
    return true;
  }
}
