import type { RealtimePcmAudioDataEvent, RealtimePcmPlaybackStartedEvent } from "../../modules/local-realtime-audio-capture/realtime-pcm";

type Fields = Record<string, string | number | boolean | null>;
type Turn = {
  id: number;
  activityStartMs: number | null;
  activityEndMs: number | null;
  serverStartMs: number;
  serverStopMs: number | null;
  responseId: string | null;
  responseCreatedMs: number | null;
  firstPacketMs: number | null;
  enqueuedMs: number | null;
  duringOutput: boolean;
};
const delta = (end: number | null, start: number | null) => end !== null && start !== null && end >= start ? end - start : null;

/** Native host clock throughout. No audio, transcript, tool authorization or VAD changes. */
export function createRealtimeLatencyTracker(emit: (event: string, fields: Fields) => void) {
  let turn: Turn | null = null;
  let nextTurn = 0;
  let activityStartMs: number | null = null;
  let activityEndMs: number | null = null;
  let lastSequence = -1;
  let processing: number[] = [];
  let captureDelivery: number[] = [];
  let captureWindow: number[] = [];
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  function reset() {
    turn = null; nextTurn = 0; activityStartMs = null; activityEndMs = null; lastSequence = -1;
    processing = []; captureDelivery = []; captureWindow = [];
  }
  function capture(frame: RealtimePcmAudioDataEvent, receivedMs: number | null, jsProcessingMs: number, inputOnly: boolean) {
    if (!finite(frame.captureStartMs) || !finite(frame.captureDurationMs) || frame.captureDurationMs <= 0 || frame.sequence <= lastSequence) return;
    lastSequence = frame.sequence;
    if (processing.length < 3000 && finite(jsProcessingMs)) processing.push(jsProcessingMs);
    if (captureWindow.length < 3000) captureWindow.push(frame.captureDurationMs);
    const delivery = delta(receivedMs, frame.captureStartMs);
    if (delivery !== null && captureDelivery.length < 3000) captureDelivery.push(delivery);
    // An energy reference only. It is not a speech classifier or human boundary annotation.
    if (!inputOnly || !finite(frame.rms) || frame.rms < 0.0015) return;
    if (activityEndMs === null || frame.captureStartMs - activityEndMs > 1500) activityStartMs = frame.captureStartMs;
    activityEndMs = frame.captureStartMs + frame.captureDurationMs;
    if (turn && turn.serverStopMs === null) {
      turn.activityStartMs ??= activityStartMs;
      turn.activityEndMs = activityEndMs;
    }
  }
  function speechStarted(atMs: number | null, duringOutput: boolean) {
    if (!finite(atMs)) { turn = null; return; }
    const recent = !duringOutput && activityEndMs !== null && atMs - activityEndMs <= 1500;
    turn = { id: ++nextTurn, activityStartMs: recent ? activityStartMs : null, activityEndMs: recent ? activityEndMs : null,
      serverStartMs: atMs, serverStopMs: null, responseId: null, responseCreatedMs: null,
      firstPacketMs: null, enqueuedMs: null, duringOutput };
  }
  function fields(): Fields {
    return { turn: turn!.id, responseId: turn!.responseId, reference: "local-PCM-energy-rms>=0.0015; not annotated speech",
      clock: "native-audio-host-time", duringOutput: turn!.duringOutput,
      activityStartToServerStartMs: delta(turn!.serverStartMs, turn!.activityStartMs),
      activityEndToServerStopMs: delta(turn!.serverStopMs, turn!.activityEndMs),
      activityEndToFirstPacketMs: delta(turn!.firstPacketMs, turn!.activityEndMs),
      serverStopToFirstPacketMs: delta(turn!.firstPacketMs, turn!.serverStopMs),
      responseCreatedToFirstPacketMs: delta(turn!.firstPacketMs, turn!.responseCreatedMs),
      firstPacketToEnqueueMs: delta(turn!.enqueuedMs, turn!.firstPacketMs) };
  }
  function speechStopped(atMs: number | null) {
    if (turn && finite(atMs)) turn.serverStopMs = atMs;
    activityStartMs = null; activityEndMs = null;
  }
  function responseCreated(id: string, atMs: number | null) {
    if (!turn || !finite(atMs) || turn.serverStopMs === null) return;
    turn.responseId = id; turn.responseCreatedMs = atMs; turn.firstPacketMs = null; turn.enqueuedMs = null;
  }
  function firstPacket(id: string, now: () => number | null) {
    if (!turn || turn.responseId !== id || turn.firstPacketMs !== null) return;
    const atMs = now();
    if (!finite(atMs)) return;
    turn.firstPacketMs = atMs;
  }
  function enqueued(id: string, now: () => number | null) {
    if (!turn || turn.responseId !== id || turn.firstPacketMs === null || turn.enqueuedMs !== null) return;
    const atMs = now();
    if (!finite(atMs)) return;
    turn.enqueuedMs = atMs; emit("pcm-turn-first-packet-latency", fields());
  }
  function playbackStarted(id: string, event: RealtimePcmPlaybackStartedEvent) {
    if (!turn || turn.responseId !== id || turn.firstPacketMs === null || !finite(event.estimatedAudibleStartMs)) return;
    emit("pcm-turn-render-latency", { ...fields(),
      activityEndToEstimatedAudibleMs: delta(event.estimatedAudibleStartMs, turn.activityEndMs),
      firstPacketToRenderMs: delta(event.renderStartMs, turn.firstPacketMs),
      outputLatencyMs: event.outputLatencyMs, ioBufferDurationMs: event.ioBufferDurationMs,
      evidence: "render-clock-plus-route-estimate; requires external acoustic verification" });
  }
  function distribution(values: number[], name: string): Fields {
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    return { [`${name}N`]: n, [`${name}MedianMs`]: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
      [`${name}P95Ms`]: n ? sorted[Math.ceil(n * 0.95) - 1] : null };
  }
  function summary() {
    emit("pcm-local-pipeline-latency", { ...distribution(processing, "jsUplink"), ...distribution(captureDelivery, "captureToJs"),
      ...distribution(captureWindow, "captureWindow"), sampleLimit: 3000 });
  }
  return { reset, capture, speechStarted, speechStopped, responseCreated, firstPacket, enqueued, playbackStarted, summary };
}
