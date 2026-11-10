/**
 * How loud LOOI's own voice is right now, taken from the audio it is about to
 * play. The face's mouth and small head movements follow this instead of a
 * fixed animation or a model decision, so the body moves with the actual
 * speech at no extra cost. Pure: no React Native, audio or network import.
 *
 * Audio is handed over when it is queued for playback. Queued audio plays back
 * to back, so each block is placed on a timeline right after the previous one.
 */
export const SPEECH_LEVEL_FRAME_MS = 40;
/** Full-scale RMS that already counts as a fully open mouth. */
const LOUD_RMS = 0.2;
/** Below this the frame is a pause between words. */
const SILENT_RMS = 0.008;
/** Frames this far behind the playhead are dropped. */
const KEEP_BEHIND_MS = 500;
const TICK_MS = 50;
/** Time without audio information after which the level is no longer live. */
const LIVE_GRACE_MS = 300;

/** One 0..1 level per frame of little-endian mono PCM16. */
export function pcm16Levels(bytes: Uint8Array, sampleRate: number, frameMs = SPEECH_LEVEL_FRAME_MS): number[] {
  const samplesPerFrame = Math.max(1, Math.round(sampleRate * frameMs / 1000));
  const sampleCount = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const levels: number[] = [];
  for (let start = 0; start < sampleCount; start += samplesPerFrame) {
    const end = Math.min(sampleCount, start + samplesPerFrame);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const sample = view.getInt16(i * 2, true) / 0x8000;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (end - start));
    levels.push(rms < SILENT_RMS ? 0 : Math.min(1, Math.sqrt(rms / LOUD_RMS)));
  }
  return levels;
}

/** The sample rate and PCM16 mono data of a RIFF/WAVE file, or null for anything else. */
export function readWavPcm16(bytes: Uint8Array): { sampleRate: number; data: Uint8Array } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let sampleRate = 0, channels = 0, bits = 0, format = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = tag(offset);
    const declared = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (format !== 1 || channels !== 1 || bits !== 16 || sampleRate < 8_000 || sampleRate > 48_000) return null;
      // Streamed WAV headers may declare an unknown length; the data then runs to the end.
      const length = Math.min(declared, bytes.length - body);
      return { sampleRate, data: bytes.subarray(body, body + (length > 0 ? length : bytes.length - body)) };
    }
    offset = body + declared + (declared % 2);
  }
  return null;
}

export type SpeechLevelListener = (level: number, live: boolean) => void;

export function createSpeechLevelTrack(options: {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let frames: number[] = [];
  /** Timeline position of frames[0]. */
  let startAt = 0;
  let timer: unknown = null;
  let live = false;
  let smoothed = 0;
  const listeners = new Set<SpeechLevelListener>();
  const endAt = () => startAt + frames.length * SPEECH_LEVEL_FRAME_MS;
  const notify = (level: number, isLive: boolean) => {
    for (const listener of [...listeners]) {
      try { listener(level, isLive); } catch { /* A broken face listener must not stop the audio path. */ }
    }
  };
  const stopTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const goQuiet = () => {
    stopTimer();
    if (live) { live = false; smoothed = 0; notify(0, false); }
  };
  const levelAt = (time: number): number | null => {
    const index = Math.floor((time - startAt) / SPEECH_LEVEL_FRAME_MS);
    return index >= 0 && index < frames.length ? frames[index] : null;
  };
  const tick = () => {
    const time = now();
    const dropped = Math.floor((time - KEEP_BEHIND_MS - startAt) / SPEECH_LEVEL_FRAME_MS);
    if (dropped > 0) { frames = frames.slice(Math.min(dropped, frames.length)); startAt += dropped * SPEECH_LEVEL_FRAME_MS; }
    const level = levelAt(time);
    if (level === null) {
      if (time - endAt() > LIVE_GRACE_MS) goQuiet();
      else if (live) { smoothed *= 0.5; notify(smoothed, true); }
      return;
    }
    // Open quickly, close a little slower, like a mouth.
    smoothed = level > smoothed ? level : smoothed * 0.55 + level * 0.45;
    live = true;
    notify(smoothed, true);
  };

  return {
    /** Queue levels for audio that will play right after what is already queued. */
    appendLevels(levels: readonly number[]): void {
      if (!levels.length) return;
      const time = now();
      if (!frames.length || endAt() < time) { frames = []; startAt = time; }
      frames.push(...levels);
      if (timer === null) timer = setTimer(tick, TICK_MS);
    },
    appendPcm16(bytes: Uint8Array, sampleRate: number): void {
      if (bytes.length >= 2 && sampleRate > 0) this.appendLevels(pcm16Levels(bytes, sampleRate));
    },
    appendWav(bytes: Uint8Array): void {
      const wav = readWavPcm16(bytes);
      if (wav) this.appendPcm16(wav.data, wav.sampleRate);
    },
    /** Playback stopped or was interrupted: forget what was queued. */
    reset(): void { frames = []; startAt = 0; goQuiet(); },
    levelAt,
    isLive: () => live,
    subscribe(listener: SpeechLevelListener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export type SpeechLevelTrack = ReturnType<typeof createSpeechLevelTrack>;
/** The level of whatever LOOI is saying in this app process. */
export const speechLevel: SpeechLevelTrack = createSpeechLevelTrack();

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Audio-path hooks. They never throw: mouth movement must not break playback. */
export function noteSpeechPcm16Base64(base64: string, sampleRate: number): void {
  try { speechLevel.appendPcm16(base64ToBytes(base64), sampleRate); } catch { /* ignored */ }
}
export function noteSpeechPcm16(bytes: Uint8Array, sampleRate: number): void {
  try { speechLevel.appendPcm16(bytes, sampleRate); } catch { /* ignored */ }
}
export function noteSpeechWav(bytes: Uint8Array): void {
  try { speechLevel.appendWav(bytes); } catch { /* ignored */ }
}

/**
 * Finds the start of a phrase: the voice rising again after a short pause.
 * These are the natural moments for a small head movement.
 */
export function createSpeechOnsetDetector(options: { quietMs?: number; low?: number; high?: number } = {}) {
  const quietMs = options.quietMs ?? 220;
  const low = options.low ?? 0.12;
  const high = options.high ?? 0.4;
  let quietSince: number | null = 0;
  let armed = true;
  return {
    /** Returns true once per phrase start. */
    feed(level: number, time: number): boolean {
      if (level <= low) {
        if (quietSince === null) quietSince = time;
        if (time - quietSince >= quietMs) armed = true;
        return false;
      }
      quietSince = null;
      if (level >= high && armed) { armed = false; return true; }
      return false;
    },
    reset(): void { quietSince = 0; armed = true; },
  };
}

export const SPEECH_WOBBLE_MIN_GAP_MS = 2_800;
export const SPEECH_WOBBLE_MAX_PER_REPLY = 5;
/** The very start of a reply belongs to the expression's own opening gesture. */
export const SPEECH_WOBBLE_START_DELAY_MS = 900;
/** After a reply the wobble still counts as its reaction for this long (Decisions assistant-end window). */
export const SPEECH_WOBBLE_CLAIM_MS = 2_500;

/** Decides which phrase starts get a small head movement. */
export function createSpeechWobble(now: () => number = Date.now) {
  let replyStartedAt: number | null = null;
  let lastNudgeAt = -Infinity;
  let nudges = 0;
  let claimUntil = 0;
  return {
    replyStarted(): void { if (replyStartedAt === null) { replyStartedAt = now(); nudges = 0; } },
    replyEnded(): void {
      if (replyStartedAt !== null && nudges > 0) claimUntil = now() + SPEECH_WOBBLE_CLAIM_MS;
      replyStartedAt = null;
    },
    /** A person spoke or the reply was cut off: nothing is claimed. */
    interrupted(): void { replyStartedAt = null; nudges = 0; claimUntil = 0; },
    /** True when this phrase start should move the head; calm is true for serious or sad delivery. */
    onPhraseStart(calm: boolean): boolean {
      const time = now();
      if (replyStartedAt === null || calm) return false;
      if (time - replyStartedAt < SPEECH_WOBBLE_START_DELAY_MS || time - lastNudgeAt < SPEECH_WOBBLE_MIN_GAP_MS) return false;
      if (nudges >= SPEECH_WOBBLE_MAX_PER_REPLY) return false;
      nudges += 1;
      lastNudgeAt = time;
      return true;
    },
    /** The head already moved with this reply, so no separate reaction is needed for it. */
    ownsReplyReaction(): boolean { return (replyStartedAt !== null && nudges > 0) || now() < claimUntil; },
  };
}
