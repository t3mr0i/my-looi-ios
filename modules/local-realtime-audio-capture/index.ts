import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";
import { getRealtimePcmAudioModule, startPcmCapture, stopPcmCapture, type RealtimePcmAudioStatus } from "./realtime-pcm";

export type LocalRealtimeAudioDataEvent = {
  pcm16Base64: string;
  sampleRate: number;
  frames: number;
  rms: number;
  sequence: number;
  timestampMs: number;
};

export type LocalRealtimeCaptureErrorEvent = {
  stage: string;
  message: string;
};

export type LocalRealtimeCaptureStatus = {
  supported: boolean;
  running: boolean;
  sampleRate: number;
  audioSource: string;
  audioSessionId: number | null;
  aecAvailable: boolean;
  aecEnabled: boolean;
  nsAvailable: boolean;
  nsEnabled: boolean;
  chunksEmitted: number;
  framesCaptured: number;
};

type Events = {
  onAudioData(event: LocalRealtimeAudioDataEvent): void;
  onCaptureError(event: LocalRealtimeCaptureErrorEvent): void;
};

declare class LocalRealtimeAudioCaptureNativeModule extends NativeModule<Events> {
  start(): Promise<LocalRealtimeCaptureStatus>;
  stop(): Promise<LocalRealtimeCaptureStatus>;
  getStatus(): Promise<LocalRealtimeCaptureStatus>;
}

let cached: LocalRealtimeAudioCaptureNativeModule | null = null;
type CaptureApi = Pick<LocalRealtimeAudioCaptureNativeModule, "start" | "stop" | "getStatus" | "addListener">;
let appleAdapter: CaptureApi | null = null;

function createAppleCaptureAdapter(): CaptureApi {
  const audio = getRealtimePcmAudioModule();
  let ownsCapture = false;
  let frames = 0;
  const status = (value: RealtimePcmAudioStatus): LocalRealtimeCaptureStatus => {
    if (ownsCapture) frames = value.captureFrames ?? frames;
    return {
      supported: value.supported, running: ownsCapture && value.captureRunning,
      sampleRate: value.captureSampleRate, audioSource: value.audioSource,
      audioSessionId: value.audioSessionId, aecAvailable: value.aecAvailable,
      aecEnabled: value.aecEnabled, nsAvailable: false, nsEnabled: false,
      chunksEmitted: ownsCapture ? value.captureChunks : 0, framesCaptured: frames,
    };
  };
  const dataListeners = new Set<Events["onAudioData"]>();
  const errorListeners = new Set<Events["onCaptureError"]>();
  audio.addListener("onAudioData", (data) => {
    if (!ownsCapture) return;
    frames += data.frames;
    for (const listener of dataListeners) listener(data);
  });
  audio.addListener("onCaptureError", (error) => {
    if (!ownsCapture) return;
    ownsCapture = false;
    void stopPcmCapture("capture-only").catch(() => undefined);
    for (const listener of errorListeners) listener(error);
  });
  return {
    async start() {
      if (!ownsCapture) frames = 0;
      const started = await startPcmCapture("capture-only");
      ownsCapture = started.captureRunning;
      return status(started);
    },
    async stop() {
      if (!ownsCapture) return status(await audio.getStatus());
      const stopped = await stopPcmCapture("capture-only");
      const result = status(stopped);
      ownsCapture = false;
      return result;
    },
    async getStatus() { return status(await audio.getStatus()); },
    addListener(event, listener) {
      if (event === "onAudioData") {
        const callback = listener as Events["onAudioData"];
        dataListeners.add(callback);
        return { remove() { dataListeners.delete(callback); } };
      }
      const callback = listener as Events["onCaptureError"];
      errorListeners.add(callback);
      return { remove() { errorListeners.delete(callback); } };
    },
  };
}

function getModule(): CaptureApi {
  if (Platform.OS === "web") throw new Error("Realtime PCM capture requires a native runtime");
  if (Platform.OS === "ios") return appleAdapter ??= createAppleCaptureAdapter();
  cached ??= requireNativeModule<LocalRealtimeAudioCaptureNativeModule>("LocalRealtimeAudioCapture");
  return cached;
}

export function getLocalRealtimeAudioCaptureModule(): CaptureApi {
  return getModule();
}
