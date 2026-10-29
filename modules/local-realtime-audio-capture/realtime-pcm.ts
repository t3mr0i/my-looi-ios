import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";
import { createCaptureController } from "../../src/voice/capture-owner";
import { deactivateRealtimeSpeakerRoute } from "../realtime-audio-route";

export type RealtimePcmAudioDataEvent = {
  pcm16Base64: string;
  sampleRate: number;
  frames: number;
  rms: number;
  sequence: number;
  timestampMs: number;
  /** iOS audio host clock; never subtract these from JS performance.now(). */
  captureStartMs?: number;
  captureDurationMs?: number;
  nativeEmittedAtMs?: number;
  captureTimeSource?: "audio-host-time" | "tap-receipt-estimate";
};

export type RealtimePcmPlaybackStartedEvent = {
  generation: number;
  renderStartMs: number;
  estimatedAudibleStartMs: number;
  outputLatencyMs: number;
  ioBufferDurationMs: number;
};

export type RealtimePcmCaptureErrorEvent = {
  stage: string;
  message: string;
};

export type RealtimePcmPlaybackEvent = {
  playedDurationMs: number;
  generation?: number;
};

export type RealtimePcmPlaybackErrorEvent = {
  message: string;
  generation?: number;
};

export type RealtimePcmAudioStatus = {
  supported: boolean;
  captureRunning: boolean;
  captureSampleRate: number;
  audioSource: string;
  audioSessionId: number | null;
  aecAvailable: boolean;
  aecEnabled: boolean;
  noiseSuppressorExplicit: boolean;
  captureChunks: number;
  captureFrames?: number;
  playbackRunning: boolean;
  playbackSampleRate: number;
  playedDurationMs: number;
  playbackQueuedChunks: number;
};

type Events = {
  onAudioData(event: RealtimePcmAudioDataEvent): void;
  onCaptureError(event: RealtimePcmCaptureErrorEvent): void;
  onPlaybackDrained(event: RealtimePcmPlaybackEvent): void;
  onPlaybackError(event: RealtimePcmPlaybackErrorEvent): void;
  onPlaybackStarted(event: RealtimePcmPlaybackStartedEvent): void;
};

declare class RealtimePcmAudioNativeModule extends NativeModule<Events> {
  startCapture(): Promise<RealtimePcmAudioStatus>;
  stopCapture(): Promise<RealtimePcmAudioStatus>;
  getStatus(): Promise<RealtimePcmAudioStatus>;
  getMonotonicTimeMs(): number;
  beginPlayback(): number;
  /** iOS output without acquiring microphone capture; absent in older builds. */
  beginOutputPlayback(): Promise<number>;
  stopOutputPlayback(generation: number): Promise<void>;
  enqueuePlayback(pcm24Base64: string): void;
  finishPlayback(): void;
  stopPlayback(): { playedDurationMs: number };
  getPlayedDurationMs(): number;
}

let cached: RealtimePcmAudioNativeModule | null = null;

export function getRealtimePcmAudioModule(): RealtimePcmAudioNativeModule {
  if (Platform.OS === "web") throw new Error("Realtime PCM requires a native runtime");
  cached ??= requireNativeModule<RealtimePcmAudioNativeModule>("RealtimePcmAudio");
  return cached;
}

const captureController = createCaptureController({
  async start() {
    try { return await getRealtimePcmAudioModule().startCapture(); }
    catch (error) {
      if (Platform.OS === "ios") await deactivateRealtimeSpeakerRoute().catch(() => undefined);
      throw error;
    }
  },
  async stop() {
    const status = await getRealtimePcmAudioModule().stopCapture();
    // Include route teardown in the ownership queue: the next adapter must not
    // activate its session until the previous one has finished releasing it.
    if (Platform.OS === "ios") await deactivateRealtimeSpeakerRoute();
    return status;
  },
  status: () => getRealtimePcmAudioModule().getStatus(),
});
export const startPcmCapture = captureController.start;
export const stopPcmCapture = captureController.stop;
export const reservePcmCapture = captureController.reserve;
