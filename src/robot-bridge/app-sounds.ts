/** Sound tags exposed by the pinned MicroDuck robot.sound contract. */
export type MicroDuckSoundTag = "chirp" | "greet" | "inquire" | "alarm" | "peck" | "coo" | "wheee";

export type AppSoundPlayOptions = {
  signal?: AbortSignal;
  /** MicroDuck sends this repeatedly while wheee is held. */
  hold?: boolean;
};

export type AppSoundResult = { accepted: boolean; reason?: string };

export type AppSoundService = {
  play(name: MicroDuckSoundTag, options?: AppSoundPlayOptions): Promise<AppSoundResult>;
  stop(): Promise<void>;
};

export type AppSoundClip = {
  uri: string;
  durationMs: number;
};

/** A player is deliberately injected so protocol tests do not need a native audio session. */
export type AppSoundPlayback = {
  play(clip: AppSoundClip, options: { signal: AbortSignal }): Promise<void>;
  /** Stops and releases the current native player, if any. */
  stop(): Promise<void> | void;
};

export type AppSoundOptions = {
  /** A hold expires shortly after the stock Console's 200ms refreshes stop. */
  holdRefreshTimeoutMs?: number;
  /** Small gap between short wheee segments; it also bounds immediate fake-player loops. */
  holdSegmentGapMs?: number;
};

const SAMPLE_RATE = 22_050;
const MAX_SOUND_MS = 2_000;
const DEFAULT_HOLD_REFRESH_TIMEOUT_MS = 550;
const DEFAULT_HOLD_SEGMENT_GAP_MS = 30;
const ABORTED_RESULT: AppSoundResult = { accepted: false, reason: "cancelled" };

type Note = {
  startMs: number;
  durationMs: number;
  startHz: number;
  endHz: number;
  gain: number;
  harmonic?: number;
  vibratoHz?: number;
  vibratoDepth?: number;
};

const SOUND_NOTES: Record<MicroDuckSoundTag, Note[]> = {
  chirp: [
    { startMs: 0, durationMs: 100, startHz: 760, endHz: 1_180, gain: 0.22 },
    { startMs: 158, durationMs: 126, startHz: 960, endHz: 1_420, gain: 0.19 },
  ],
  greet: [
    { startMs: 0, durationMs: 180, startHz: 510, endHz: 760, gain: 0.24, harmonic: 0.22 },
    { startMs: 246, durationMs: 225, startHz: 480, endHz: 830, gain: 0.22, harmonic: 0.24 },
  ],
  inquire: [
    { startMs: 0, durationMs: 430, startHz: 480, endHz: 1_060, gain: 0.2, harmonic: 0.12, vibratoHz: 5, vibratoDepth: 0.018 },
  ],
  alarm: [
    { startMs: 0, durationMs: 112, startHz: 1_020, endHz: 890, gain: 0.2 },
    { startMs: 150, durationMs: 112, startHz: 720, endHz: 640, gain: 0.2 },
    { startMs: 300, durationMs: 112, startHz: 1_020, endHz: 890, gain: 0.2 },
  ],
  peck: [
    { startMs: 0, durationMs: 188, startHz: 315, endHz: 168, gain: 0.2, harmonic: 0.28 },
  ],
  coo: [
    { startMs: 0, durationMs: 620, startHz: 315, endHz: 425, gain: 0.12, harmonic: 0.14, vibratoHz: 4.2, vibratoDepth: 0.024 },
  ],
  wheee: [
    // Short, fade-ended pieces are repeated only while refreshed by the caller.
    { startMs: 0, durationMs: 460, startHz: 470, endHz: 1_080, gain: 0.16, harmonic: 0.1, vibratoHz: 6, vibratoDepth: 0.02 },
  ],
};

const SOUND_NAMES = new Set<string>(Object.keys(SOUND_NOTES));

function assertSoundName(value: unknown): asserts value is MicroDuckSoundTag {
  if (typeof value !== "string" || !SOUND_NAMES.has(value)) throw new TypeError("Unknown app sound tag");
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function makeWavDataUri(samples: Float32Array): string {
  const pcmBytes = new Uint8Array(samples.length * 2);
  const pcmView = new DataView(pcmBytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcmView.setInt16(i * 2, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
  }

  const wav = new Uint8Array(44 + pcmBytes.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) wav[offset + i] = value.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, wav.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, 44);
  return `data:audio/wav;base64,${base64(wav)}`;
}

/** Build an original, offline procedural tone for a MicroDuck sound tag. */
export function generateAppSoundClip(name: MicroDuckSoundTag): AppSoundClip {
  assertSoundName(name);
  const notes = SOUND_NOTES[name];
  const durationMs = Math.max(...notes.map((note) => note.startMs + note.durationMs));
  if (durationMs <= 0 || durationMs > MAX_SOUND_MS) throw new RangeError("App sound duration is outside its safe limit");

  const samples = new Float32Array(Math.ceil((durationMs * SAMPLE_RATE) / 1_000));
  for (const note of notes) {
    const first = Math.max(0, Math.floor((note.startMs * SAMPLE_RATE) / 1_000));
    const count = Math.min(samples.length - first, Math.ceil((note.durationMs * SAMPLE_RATE) / 1_000));
    if (count <= 0) continue;
    const noteSeconds = note.durationMs / 1_000;
    const fadeSeconds = Math.min(0.012, noteSeconds * 0.14);
    let phase = 0;
    for (let index = 0; index < count; index += 1) {
      const t = index / SAMPLE_RATE;
      const progress = count <= 1 ? 1 : index / (count - 1);
      const frequency = note.startHz + ((note.endHz - note.startHz) * progress);
      const vibrato = 1 + Math.sin(2 * Math.PI * (note.vibratoHz ?? 0) * t) * (note.vibratoDepth ?? 0);
      phase += (2 * Math.PI * frequency * vibrato) / SAMPLE_RATE;
      const fundamental = Math.sin(phase);
      const harmonic = Math.sin(phase * 2.01) * (note.harmonic ?? 0);
      const attack = Math.min(1, t / fadeSeconds);
      const release = Math.min(1, Math.max(0, (noteSeconds - t) / fadeSeconds));
      const envelope = Math.min(attack, release) * (1 - 0.16 * progress);
      samples[first + index] += (fundamental + harmonic) * note.gain * envelope;
    }
  }

  return { uri: makeWavDataUri(samples), durationMs };
}

type ActiveSession = {
  readonly name: MicroDuckSoundTag;
  readonly held: boolean;
  readonly controller: AbortController;
  readonly detachExternalSignal: () => void;
  completion: Promise<AppSoundResult>;
  holdTimer: ReturnType<typeof setTimeout> | null;
};

function abortError(): Error {
  const error = new Error("App sound playback was cancelled");
  error.name = "AbortError";
  return error;
}

function resultFromError(error: unknown): AppSoundResult {
  if (isAbortError(error)) return ABORTED_RESULT;
  return { accepted: false, reason: error instanceof Error ? error.message : "Sound playback failed" };
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

function sleepWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(), milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

/** Serializes starts/stops and owns one bounded native playback at a time. */
export function createAppSounds(player: AppSoundPlayback, options: AppSoundOptions = {}): AppSoundService {
  const holdRefreshTimeoutMs = Math.max(250, Math.min(2_000, options.holdRefreshTimeoutMs ?? DEFAULT_HOLD_REFRESH_TIMEOUT_MS));
  const holdSegmentGapMs = Math.max(0, Math.min(250, options.holdSegmentGapMs ?? DEFAULT_HOLD_SEGMENT_GAP_MS));
  let active: ActiveSession | null = null;
  let transition = Promise.resolve();

  function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = transition.then(operation, operation);
    transition = result.then(() => undefined, () => undefined);
    return result;
  }

  function clearSession(session: ActiveSession): void {
    if (session.holdTimer) clearTimeout(session.holdTimer);
    session.holdTimer = null;
    session.detachExternalSignal();
    if (active === session) active = null;
  }

  async function stopActive(): Promise<void> {
    const session = active;
    if (!session) return;
    active = null;
    if (session.holdTimer) clearTimeout(session.holdTimer);
    session.holdTimer = null;
    session.detachExternalSignal();
    session.controller.abort();
    try { await player.stop(); } catch { /* native player may already have been released */ }
    try { await session.completion; } catch { /* completion is translated to a result */ }
  }

  function createSession(name: MicroDuckSoundTag, held: boolean, signal?: AbortSignal): ActiveSession {
    const controller = new AbortController();
    let detachExternalSignal = () => {};
    if (signal) {
      const onAbort = () => {
        if (!controller.signal.aborted) controller.abort(signal.reason);
        void Promise.resolve(player.stop()).catch(() => undefined);
      };
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        detachExternalSignal = () => signal.removeEventListener("abort", onAbort);
      }
    }
    return { name, held, controller, detachExternalSignal, completion: Promise.resolve(ABORTED_RESULT), holdTimer: null };
  }

  function scheduleHoldExpiry(session: ActiveSession): void {
    if (session.holdTimer) clearTimeout(session.holdTimer);
    session.holdTimer = setTimeout(() => {
      void serialize(async () => {
        if (active === session) await stopActive();
      });
    }, holdRefreshTimeoutMs);
  }

  async function playOneShot(session: ActiveSession, clip: AppSoundClip): Promise<AppSoundResult> {
    try {
      if (session.controller.signal.aborted) return ABORTED_RESULT;
      await player.play(clip, { signal: session.controller.signal });
      return session.controller.signal.aborted ? ABORTED_RESULT : { accepted: true };
    } catch (error) {
      return resultFromError(error);
    } finally {
      clearSession(session);
    }
  }

  async function runHeld(session: ActiveSession, clip: AppSoundClip): Promise<AppSoundResult> {
    try {
      while (!session.controller.signal.aborted) {
        await player.play(clip, { signal: session.controller.signal });
        if (session.controller.signal.aborted) break;
        await sleepWithSignal(holdSegmentGapMs, session.controller.signal);
      }
      return ABORTED_RESULT;
    } catch (error) {
      return resultFromError(error);
    } finally {
      clearSession(session);
    }
  }

  async function play(name: MicroDuckSoundTag, playOptions: AppSoundPlayOptions = {}): Promise<AppSoundResult> {
    try { assertSoundName(name); } catch (error) { return resultFromError(error); }
    if (playOptions.signal?.aborted) return ABORTED_RESULT;
    if (playOptions.hold === true && name !== "wheee") {
      return { accepted: false, reason: "Only wheee supports hold" };
    }

    if (name === "wheee" && playOptions.hold === false) {
      return serialize(async () => {
        if (active?.name === "wheee" && active.held) await stopActive();
        return { accepted: true };
      });
    }

    if (name === "wheee" && playOptions.hold === true) {
      return serialize(async () => {
        if (playOptions.signal?.aborted) return ABORTED_RESULT;
        if (active?.name === "wheee" && active.held && !active.controller.signal.aborted) {
          scheduleHoldExpiry(active);
          return { accepted: true };
        }
        await stopActive();
        if (playOptions.signal?.aborted) return ABORTED_RESULT;
        const session = createSession(name, true, playOptions.signal);
        if (session.controller.signal.aborted) return ABORTED_RESULT;
        active = session;
        const clip = generateAppSoundClip(name);
        scheduleHoldExpiry(session);
        session.completion = runHeld(session, clip);
        // The wire call acknowledges that the bounded, refresh-driven hold was accepted;
        // each individual native segment still runs to completion or cancellation.
        return { accepted: true };
      });
    }

    const session = await serialize(async () => {
      await stopActive();
      if (playOptions.signal?.aborted) return null;
      const created = createSession(name, false, playOptions.signal);
      if (created.controller.signal.aborted) return null;
      active = created;
      created.completion = playOneShot(created, generateAppSoundClip(name));
      return created;
    });
    return session ? session.completion : ABORTED_RESULT;
  }

  return {
    play,
    async stop() {
      await serialize(stopActive);
    },
  };
}
