/** Acoustic timing only. No words, user identity, emotion or agreement. */
export type ListeningAudioFrame = {
  sessionId: string;
  revision: number;
  sequence: number;
  nativeTimestampMs: number;
  durationMs: number;
  rms: number;
};

const MIN_VOICED_MS = 1_600;
const MIN_TURN_MS = 3_000;
const MIN_PAUSE_MS = 220;
const MAX_PAUSE_MS = 500;
const COOLDOWN_MS = 6_000;
const MAX_CUES_PER_TURN = 2;
const MIN_SIGNAL_RMS = 0.006;

/**
 * Conservative pause opportunities inside a server-confirmed spoken turn.
 * Native and JS clock origins differ: compare deltas, never absolute times.
 * Only live, ordered audio can accumulate evidence; silence has no timer.
 * Thresholds are design defaults requiring device/user evaluation.
 */
export function createListeningOpportunityDetector() {
  let scope = "";
  let startedAt = 0;
  let last: { sequence: number; native: number; received: number } | null = null;
  let voicedMs = 0;
  let quietMs = 0;
  let peak = 0;
  let cueCount = 0;
  let lastCueAt = Number.NEGATIVE_INFINITY;
  let bestClockOffset = Number.POSITIVE_INFINITY;

  function clearEvidence() { voicedMs = 0; quietMs = 0; peak = 0; }
  // Cancellation drops evidence but preserves this turn's quota and cooldown.
  function reset() { last = null; clearEvidence(); }

  function frame(value: ListeningAudioFrame, receivedAt: number): boolean {
    if (!value.sessionId || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
      !Number.isFinite(value.nativeTimestampMs) || value.nativeTimestampMs < 0 ||
      !Number.isFinite(receivedAt) || !Number.isFinite(value.durationMs) || value.durationMs < 10 || value.durationMs > 200 ||
      !Number.isFinite(value.rms) || value.rms < 0 || value.rms > 1) { reset(); return false; }

    const nextScope = `${value.sessionId}:${value.revision}`;
    if (nextScope !== scope) {
      reset(); scope = nextScope; startedAt = receivedAt; cueCount = 0; bestClockOffset = Number.POSITIVE_INFINITY;
    }
    const clockOffset = receivedAt - value.nativeTimestampMs;
    bestClockOffset = Math.min(bestClockOffset, clockOffset);
    const before = last;
    last = { sequence: value.sequence, native: value.nativeTimestampMs, received: receivedAt };
    if (!before) return false;
    const nativeDelta = value.nativeTimestampMs - before.native;
    const receivedDelta = receivedAt - before.received;
    if (value.sequence !== before.sequence + 1 || nativeDelta <= 0 || nativeDelta > 350 ||
      receivedDelta < value.durationMs * 0.4 || receivedDelta > 350 || Math.abs(nativeDelta - receivedDelta) > 180 ||
      clockOffset - bestClockOffset > 250) {
      clearEvidence(); return false;
    }
    const duration = Math.min(value.durationMs, nativeDelta, receivedDelta);
    if (value.rms >= Math.max(MIN_SIGNAL_RMS, peak * 0.45)) {
      peak = Math.max(value.rms, peak * 0.995);
      voicedMs += duration; quietMs = 0;
      return false;
    }
    if (peak === 0 || value.rms > Math.min(0.004, peak * 0.25)) { clearEvidence(); return false; }
    quietMs += duration;
    if (quietMs > MAX_PAUSE_MS) { clearEvidence(); return false; }
    if (quietMs < MIN_PAUSE_MS || voicedMs < MIN_VOICED_MS || receivedAt - startedAt < MIN_TURN_MS ||
      receivedAt - lastCueAt < COOLDOWN_MS || cueCount >= MAX_CUES_PER_TURN) return false;
    cueCount++; lastCueAt = receivedAt; clearEvidence();
    return true;
  }
  return { frame, reset };
}
