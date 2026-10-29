import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { getRealtimePcmAudioModule } from "../../modules/local-realtime-audio-capture/realtime-pcm";

export type CloudSpeechResponse = Pick<Response, "ok" | "status" | "headers" | "body" | "arrayBuffer">;
export type CloudSpeechPcmPlayer = {
  write(bytes: Uint8Array): void;
  queuedDurationMs(): number;
  finish(): void;
  stop(): Promise<void> | void;
};
export type CloudSpeechStreamRuntime = {
  fetcher(url: string, options: RequestInit): Promise<CloudSpeechResponse>;
  createPlayer(callbacks: { onStart(route?: { outputLatencyMs: number; ioBufferDurationMs: number }): void;
    onComplete(): void; onError(error: Error): void }): Promise<CloudSpeechPcmPlayer>;
};

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}

/** Output only: this path never acquires or starts microphone capture. */
export function getCloudSpeechStreamRuntime(): CloudSpeechStreamRuntime | null {
  if (Platform.OS !== "ios") return null;
  let audio: ReturnType<typeof getRealtimePcmAudioModule>;
  try { audio = getRealtimePcmAudioModule(); } catch { return null; }
  // Existing installed native builds retain the buffered WAV path until the
  // output-only engine is available. Do not start capture just to play speech.
  if (typeof audio.beginOutputPlayback !== "function" || typeof audio.stopOutputPlayback !== "function") return null;
  return {
    fetcher: (url, options) => expoFetch(url, options),
    async createPlayer(callbacks) {
      const generation = await audio.beginOutputPlayback();
      let disposed = false;
      let writtenBytes = 0;
      const subscriptions = [
        audio.addListener("onPlaybackStarted", (event) => {
          if (!disposed && event.generation === generation) callbacks.onStart(event);
        }),
        audio.addListener("onPlaybackDrained", (event) => {
          if (!disposed && event.generation === generation) callbacks.onComplete();
        }),
        audio.addListener("onPlaybackError", (event) => {
          if (!disposed && event.generation === generation) callbacks.onError(new Error("Cloud PCM playback failed"));
        }),
      ];
      return {
        write(bytes) {
          if (disposed) return;
          audio.enqueuePlayback(base64(bytes));
          writtenBytes += bytes.byteLength;
        },
        queuedDurationMs: () => disposed ? 0 : Math.max(0, writtenBytes / 48 - audio.getPlayedDurationMs()),
        finish() { if (!disposed) audio.finishPlayback(); },
        async stop() {
          if (disposed) return;
          disposed = true;
          for (const subscription of subscriptions) subscription.remove();
          await audio.stopOutputPlayback(generation);
        },
      };
    },
  };
}
