import type { RealtimePcmAudioStatus } from "../../modules/local-realtime-audio-capture/realtime-pcm";

/** Accept only an active native capture path with the PCM contract the server
 * and local command recognizer consume. iOS uses VoiceProcessingIO for AEC. */
export function isRealtimeCaptureReady(status: RealtimePcmAudioStatus, platform: string): boolean {
  const source = platform === "ios" ? "VOICE_PROCESSING_IO"
    : platform === "android" ? "VOICE_COMMUNICATION" : null;
  return source !== null && status.supported && status.captureRunning
    && status.aecAvailable && status.aecEnabled && status.audioSource === source
    && status.captureSampleRate === 16_000 && status.playbackSampleRate === 24_000;
}
