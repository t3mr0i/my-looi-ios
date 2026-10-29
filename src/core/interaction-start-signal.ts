export interface InteractionSignalFrame {
  timestampMs: number;
  interactionSignal?: { kind: "open_palm"; confidence: number; handCount: number } | null;
  interactionHandCount?: number;
}

/**
 * A local agreed gesture must be newly made after arming, not a hand already in
 * view. Native timestamps establish ordering only; JS receipt time measures the
 * hold, avoiding subtraction between the native and JavaScript clock domains.
 */
export function createInteractionStartSignalDetector(now: () => number = () => performance.now()) {
  let token: string | null = null;
  let lastNative = Number.NEGATIVE_INFINITY;
  let lastReceived = Number.NEGATIVE_INFINITY;
  let releasedAt: number | null = null;
  let releaseFrames = 0;
  let ready = false;
  let heldAt: number | null = null;
  let heldFrames = 0;
  let consumed = false;

  function reset() {
    token = null; lastNative = Number.NEGATIVE_INFINITY; lastReceived = Number.NEGATIVE_INFINITY;
    releasedAt = null; releaseFrames = 0; ready = false; heldAt = null; heldFrames = 0; consumed = false;
  }
  function arm(id: string) {
    if (token === id) return;
    reset(); token = id;
  }
  function frame(value: InteractionSignalFrame): boolean {
    if (!token || consumed || !Object.hasOwn(value, "interactionSignal") || !Number.isFinite(value.timestampMs) || value.timestampMs <= lastNative) return false;
    const received = now();
    if (!Number.isFinite(received) || received < lastReceived) { reset(); return false; }
    if (received - lastReceived > 450) { releasedAt = null; releaseFrames = 0; ready = false; heldAt = null; heldFrames = 0; }
    lastNative = value.timestampMs; lastReceived = received;
    const signal = value.interactionSignal;
    const open = signal?.kind === "open_palm" && signal.handCount === 1 && Number.isFinite(signal.confidence) && signal.confidence >= 0.7;
    if (!open) {
      heldAt = null; heldFrames = 0;
      // A supported empty frame establishes a release. Multiple hands and low
      // confidence are ambiguous, so they cannot serve as a release either.
      if (signal === null && value.interactionHandCount === 0) {
        releasedAt ??= received; releaseFrames++;
        if (releaseFrames >= 3 && received - releasedAt >= 200) ready = true;
      } else { releasedAt = null; releaseFrames = 0; ready = false; }
      return false;
    }
    if (!ready) return false;
    heldAt ??= received; heldFrames++;
    if (heldFrames < 5 || received - heldAt < 600) return false;
    consumed = true;
    return true;
  }
  return { arm, frame, reset };
}
