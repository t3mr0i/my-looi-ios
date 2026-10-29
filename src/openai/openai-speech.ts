import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioStatus,
} from "expo-audio";

import { getOpenAiApiKey, MissingOpenAiApiKeyError } from "./openai-api-key";
import { buildCompanionDeliveryInstructions } from "../character/companion-personality";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import {
  getCloudSpeechStreamRuntime,
  type CloudSpeechPcmPlayer,
  type CloudSpeechResponse,
  type CloudSpeechStreamRuntime,
} from "./openai-speech-stream";
import {
  DEFAULT_TTS_SPEED,
  DEFAULT_TTS_STYLE_ID,
  getTtsStyleInstructions,
  isSupportedRealtimeVoiceId,
  normalizeTtsSpeed,
  type TtsStyleId,
} from "../voice/tts-voices";

export const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts";
export const OPENAI_SPEECH_SHUTDOWN_DATE = "2027-01-06";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const REQUEST_TIMEOUT_MS = 20_000;
const PLAYBACK_TIMEOUT_MS = 90_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 4_096;

export type OpenAiSpeechOptions = {
  voiceId: string;
  styleId?: TtsStyleId;
  personalityContext?: string;
  speed?: number;
  signal?: AbortSignal;
  onStart?: () => void;
  /** Caller must release microphone capture before enabling streamed output. */
  streaming?: boolean;
};

type AudioPlayer = ReturnType<typeof createAudioPlayer>;

type SpeechSession = {
  generation: number;
  controller: AbortController;
  signal?: AbortSignal;
  onStart?: () => void;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
  started: boolean;
  completionQueued: boolean;
  timedOut: boolean;
  requestTimer?: ReturnType<typeof setTimeout>;
  playbackTimer?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
  player?: AudioPlayer;
  pcmPlayer?: CloudSpeechPcmPlayer;
  audioReader?: ReadableStreamDefaultReader<Uint8Array>;
  streamTiming?: { requestMs: number; headersMs?: number; firstByteMs?: number; firstEnqueueMs?: number; downloadDoneMs?: number };
  subscription?: { remove: () => void };
};

let generation = 0;
let currentSession: SpeechSession | null = null;
let playbackOwner: SpeechSession | null = null;
let playbackQueue: Promise<void> = Promise.resolve();

function enqueuePlayback(operation: () => Promise<void> | void): Promise<void> {
  const result = playbackQueue.then(operation, operation);
  playbackQueue = result.then(() => undefined, () => undefined);
  return result;
}

function abortError(): Error {
  const error = new Error("Cloud speech was cancelled");
  error.name = "AbortError";
  return error;
}

function isCurrent(session: SpeechSession): boolean {
  return currentSession === session
    && session.generation === generation
    && !session.settled
    && !session.signal?.aborted;
}

function clearSessionTimers(session: SpeechSession): void {
  if (session.requestTimer) clearTimeout(session.requestTimer);
  if (session.playbackTimer) clearTimeout(session.playbackTimer);
  session.requestTimer = undefined;
  session.playbackTimer = undefined;
}

function clearSessionListeners(session: SpeechSession): void {
  if (session.signal && session.abortHandler) {
    try { session.signal.removeEventListener("abort", session.abortHandler); } catch {}
  }
  session.abortHandler = undefined;
  try { session.subscription?.remove(); } catch {}
  session.subscription = undefined;
}

function settle(session: SpeechSession, error?: Error): void {
  if (session.settled) return;
  session.settled = true;
  clearSessionTimers(session);
  clearSessionListeners(session);
  if (currentSession === session) currentSession = null;
  if (error) session.reject(error);
  else session.resolve();
}

async function disposePlayer(session: SpeechSession, stop: boolean): Promise<void> {
  const player = session.player;
  const pcmPlayer = session.pcmPlayer;
  if (playbackOwner !== session || (!player && !pcmPlayer)) return;
  // Clear ownership before pause/remove because the native module can emit a
  // final status callback synchronously while those calls are in progress.
  playbackOwner = null;
  session.player = undefined;
  session.pcmPlayer = undefined;
  try { session.subscription?.remove(); } catch {}
  session.subscription = undefined;
  if (session.playbackTimer) clearTimeout(session.playbackTimer);
  session.playbackTimer = undefined;
  if (pcmPlayer) {
    try { await pcmPlayer.stop(); } catch {}
  }
  if (stop && player) {
    try { player.pause(); } catch {}
  }
  try { player?.remove(); } catch {}
}

function cancelReader(session: SpeechSession): void {
  try { void session.audioReader?.cancel().catch(() => undefined); } catch {}
}

function rejectSession(session: SpeechSession, error: Error): void {
  if (session.settled) return;
  session.controller.abort();
  cancelReader(session);
  const shouldStopPlayer = playbackOwner === session;
  settle(session, error);
  if (shouldStopPlayer) {
    void enqueuePlayback(() => disposePlayer(session, true)).catch(() => undefined);
  }
}

function cancelSession(session: SpeechSession, scheduleStop = true): void {
  if (session.settled) return;
  session.controller.abort();
  cancelReader(session);
  const shouldStopPlayer = playbackOwner === session;
  settle(session, abortError());
  if (scheduleStop && shouldStopPlayer) {
    void enqueuePlayback(() => disposePlayer(session, true)).catch(() => undefined);
  }
}

function requestTimedOut(session: SpeechSession): void {
  if (session.settled) return;
  session.timedOut = true;
  rejectSession(session, new Error("Cloud speech request timed out"));
}

function playbackTimedOut(session: SpeechSession): void {
  if (!session.settled) rejectSession(session, new Error("Cloud speech playback timed out"));
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function readBoundedAudio(response: CloudSpeechResponse, session: SpeechSession): Promise<Uint8Array> {
  const contentLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
    throw new Error("Cloud speech audio exceeds the 4 MB limit");
  }

  const reader = response.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        if (!isCurrent(session)) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_AUDIO_BYTES) {
          try { void reader.cancel().catch(() => undefined); } catch {}
          throw new Error("Cloud speech audio exceeds the 4 MB limit");
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
    if (totalBytes === 0) throw new Error("Cloud speech returned empty audio");
    const audio = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return audio;
  }

  // Some native fetch implementations do not expose a ReadableStream. Check
  // Content-Length before reading where available, and enforce the same cap on
  // the completed buffer for those runtimes.
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("Cloud speech audio exceeds the 4 MB limit");
  if (audio.length === 0) throw new Error("Cloud speech returned empty audio");
  return audio;
}

/** Stream PCM16/24k without waiting for EOF; only native render establishes speech. */
async function streamPcmAudio(response: CloudSpeechResponse, session: SpeechSession, runtime: CloudSpeechStreamRuntime): Promise<void> {
  const contentLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) throw new Error("Cloud speech audio exceeds the 4 MB limit");
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("Cloud speech PCM stream is unavailable");
  session.audioReader = reader;
  let totalBytes = 0;
  let carry: number | null = null;
  let readComplete = false;
  try {
    while (isCurrent(session)) {
      // After playback starts, bound network stalls rather than the duration
      // of a valid clip. Backpressure waits for the player, not the network.
      if (session.pcmPlayer) session.requestTimer = setTimeout(() => requestTimedOut(session), REQUEST_TIMEOUT_MS);
      const { done, value } = await reader.read();
      if (session.pcmPlayer && session.requestTimer) {
        clearTimeout(session.requestTimer); session.requestTimer = undefined;
      }
      if (!isCurrent(session)) return;
      if (done) { readComplete = true; break; }
      if (!value?.byteLength) continue;
      if (session.streamTiming) session.streamTiming.firstByteMs ??= performance.now();
      totalBytes += value.byteLength;
      if (totalBytes > MAX_AUDIO_BYTES) throw new Error("Cloud speech audio exceeds the 4 MB limit");
      let bytes: Uint8Array = value;
      if (carry !== null) {
        bytes = new Uint8Array(value.length + 1);
        bytes[0] = carry; bytes.set(value, 1);
      }
      const evenLength = bytes.length - bytes.length % 2;
      carry = evenLength < bytes.length ? bytes[bytes.length - 1] : null;
      for (let offset = 0; offset < evenLength && isCurrent(session); offset += 9600) {
        const chunk = bytes.subarray(offset, Math.min(evenLength, offset + 9600));
        await enqueuePlayback(async () => {
          if (!isCurrent(session)) return;
          if (!session.pcmPlayer) {
            if (playbackOwner && playbackOwner !== session) await disposePlayer(playbackOwner, true);
            const player = await runtime.createPlayer({
              onStart(route) {
                if (playbackOwner !== session || !isCurrent(session) || session.started) return;
                session.started = true;
                const timing = session.streamTiming;
                if (timing) {
                  const renderNoticeMs = performance.now();
                  recordDiagnosticEvent("latency", "budget-speech-stream-latency", {
                    generation: session.generation, clock: "js-performance",
                    requestToHeadersMs: timing.headersMs === undefined ? null : timing.headersMs - timing.requestMs,
                    requestToFirstByteMs: timing.firstByteMs === undefined ? null : timing.firstByteMs - timing.requestMs,
                    firstByteToEnqueueMs: timing.firstByteMs === undefined || timing.firstEnqueueMs === undefined ? null : timing.firstEnqueueMs - timing.firstByteMs,
                    enqueueToRenderNoticeMs: timing.firstEnqueueMs === undefined ? null : renderNoticeMs - timing.firstEnqueueMs,
                    requestToRenderNoticeMs: renderNoticeMs - timing.requestMs,
                    downloadCompleteAtRender: timing.downloadDoneMs !== undefined,
                    outputLatencyMs: route?.outputLatencyMs ?? null,
                    ioBufferDurationMs: route?.ioBufferDurationMs ?? null,
                    evidence: "native render callback receipt; not external acoustic onset",
                  });
                }
                try { session.onStart?.(); } catch {}
              },
              onComplete() {
                if (playbackOwner !== session || !isCurrent(session) || session.completionQueued) return;
                session.completionQueued = true;
                void enqueuePlayback(async () => {
                  if (playbackOwner !== session || !isCurrent(session)) return;
                  await disposePlayer(session, false); settle(session);
                }).catch(() => rejectSession(session, new Error("Cloud PCM playback cleanup failed")));
              },
              onError(error) { if (playbackOwner === session && isCurrent(session)) rejectSession(session, error); },
            });
            if (!isCurrent(session)) { await player.stop(); return; }
            session.pcmPlayer = player; playbackOwner = session;
            if (session.requestTimer) clearTimeout(session.requestTimer);
            session.requestTimer = undefined;
            session.playbackTimer = setTimeout(() => playbackTimedOut(session), PLAYBACK_TIMEOUT_MS);
          }
          if (session.streamTiming) session.streamTiming.firstEnqueueMs ??= performance.now();
          session.pcmPlayer.write(chunk);
        });
        while (isCurrent(session) && session.pcmPlayer && session.pcmPlayer.queuedDurationMs() > 2000) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }
    if (!isCurrent(session)) return;
    if (totalBytes === 0) throw new Error("Cloud speech returned empty audio");
    if (carry !== null) throw new Error("Cloud speech returned an incomplete PCM sample");
    if (session.streamTiming) session.streamTiming.downloadDoneMs = performance.now();
    await enqueuePlayback(() => { if (isCurrent(session)) session.pcmPlayer?.finish(); });
  } finally {
    if (!readComplete) { try { void reader.cancel().catch(() => undefined); } catch {} }
    try { reader.releaseLock?.(); } catch {}
    if (session.audioReader === reader) session.audioReader = undefined;
  }
}

function makeAudioStatusHandler(session: SpeechSession) {
  return (status: AudioStatus): void => {
    if (playbackOwner !== session || !isCurrent(session)) return;
    if (status.error) {
      rejectSession(session, new Error("Cloud speech playback failed"));
      return;
    }
    if (status.playing && !session.started) {
      session.started = true;
      try { session.onStart?.(); } catch {}
    }
    if (status.didJustFinish && !session.completionQueued) {
      session.completionQueued = true;
      // Do not resolve the caller until native playback cleanup finishes.
      // Budget mode resumes microphone capture as soon as this promise resolves.
      void enqueuePlayback(async () => {
        if (playbackOwner !== session || !isCurrent(session)) return;
        await disposePlayer(session, false);
        settle(session);
      }).catch(() => rejectSession(session, new Error("Cloud speech playback cleanup failed")));
    }
  };
}

async function startPlayback(session: SpeechSession, audio: Uint8Array): Promise<void> {
  if (!isCurrent(session)) return;
  if (playbackOwner && playbackOwner !== session) await disposePlayer(playbackOwner, true);

  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    });
    if (!isCurrent(session)) return;
    await setIsAudioActiveAsync(true);
    if (!isCurrent(session)) return;

    const player = createAudioPlayer(
      { uri: `data:audio/wav;base64,${bytesToBase64(audio)}` },
      { updateInterval: 80 },
    );
    session.player = player;
    playbackOwner = session;
    session.subscription = player.addListener("playbackStatusUpdate", makeAudioStatusHandler(session));
    if (session.requestTimer) clearTimeout(session.requestTimer);
    session.requestTimer = undefined;
    session.playbackTimer = setTimeout(() => playbackTimedOut(session), PLAYBACK_TIMEOUT_MS);
    player.play();
  } catch {
    if (playbackOwner === session) await disposePlayer(session, true);
    rejectSession(session, new Error("Cloud speech playback could not be started"));
  }
}

async function requestAndPlay(session: SpeechSession, text: string, options: OpenAiSpeechOptions): Promise<void> {
  try {
    const key = await getOpenAiApiKey();
    if (!isCurrent(session)) return;
    if (!key?.trim()) throw new MissingOpenAiApiKeyError();

    const streamRuntime = options.streaming ? getCloudSpeechStreamRuntime() : null;
    if (streamRuntime) session.streamTiming = { requestMs: performance.now() };
    let response: CloudSpeechResponse;
    try {
      response = await (streamRuntime?.fetcher ?? fetch)(OPENAI_SPEECH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_SPEECH_MODEL,
          voice: options.voiceId,
          input: text,
          instructions: [getTtsStyleInstructions(options.styleId ?? DEFAULT_TTS_STYLE_ID), buildCompanionDeliveryInstructions(options.personalityContext)].filter(Boolean).join(" "),
          speed: normalizeTtsSpeed(options.speed ?? DEFAULT_TTS_SPEED),
          response_format: streamRuntime ? "pcm" : "wav",
          ...(streamRuntime ? { stream_format: "audio" } : {}),
        }),
        signal: session.controller.signal,
      });
    } catch {
      if (session.settled) return;
      if (session.signal?.aborted) cancelSession(session);
      else if (session.timedOut) requestTimedOut(session);
      else rejectSession(session, new Error("Cloud speech request failed"));
      return;
    }

    if (!isCurrent(session)) return;
    if (session.streamTiming) session.streamTiming.headersMs = performance.now();
    if (!response.ok) {
      rejectSession(session, new Error(`Cloud speech request failed (HTTP ${response.status})`));
      return;
    }

    if (streamRuntime) {
      await streamPcmAudio(response, session, streamRuntime);
      return;
    }
    const audio = await readBoundedAudio(response, session);
    if (!isCurrent(session)) return;
    await enqueuePlayback(() => startPlayback(session, audio));
  } catch (error) {
    if (session.settled) return;
    if (session.signal?.aborted) cancelSession(session);
    else if (session.timedOut) requestTimedOut(session);
    else rejectSession(session, error instanceof MissingOpenAiApiKeyError
      ? error
      : error instanceof Error
        ? error
        : new Error("Cloud speech request failed"));
  }
}

/**
 * Generate and play one cloud TTS utterance. Call after the caller releases
 * microphone capture. No local/provider fallback is attempted.
 */
export function speakOpenAiText(text: string, options: OpenAiSpeechOptions): Promise<void> {
  const normalizedText = text.trim();
  if (!normalizedText) return Promise.reject(new Error("Cloud speech text is empty"));
  if (normalizedText.length > MAX_TEXT_CHARACTERS) {
    return Promise.reject(new Error("Cloud speech text exceeds the 4096-character limit"));
  }
  if (!isSupportedRealtimeVoiceId(options.voiceId)) {
    return Promise.reject(new Error("Unsupported cloud speech voice"));
  }
  if (options.signal?.aborted) return Promise.reject(abortError());

  const previous = currentSession;
  const sessionGeneration = ++generation;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const session: SpeechSession = {
    generation: sessionGeneration,
    controller: new AbortController(),
    signal: options.signal,
    onStart: options.onStart,
    promise,
    resolve,
    reject,
    settled: false,
    started: false,
    completionQueued: false,
    timedOut: false,
  };

  currentSession = session;
  if (previous) cancelSession(previous);

  if (options.signal) {
    session.abortHandler = () => cancelSession(session);
    options.signal.addEventListener("abort", session.abortHandler, { once: true });
    if (options.signal.aborted) session.abortHandler();
  }
  if (!isCurrent(session)) return promise;
  session.requestTimer = setTimeout(() => requestTimedOut(session), REQUEST_TIMEOUT_MS);
  void requestAndPlay(session, normalizedText, options);
  return promise;
}

/** Cancel pending cloud speech and stop only the player owned by this request. */
export async function stopOpenAiSpeech(): Promise<void> {
  const stopGeneration = ++generation;
  const target = playbackOwner;
  const session = currentSession;
  currentSession = null;
  if (session) cancelSession(session, false);

  await enqueuePlayback(async () => {
    if (!target || playbackOwner !== target || target.generation > stopGeneration) return;
    await disposePlayer(target, true);
  });
}
