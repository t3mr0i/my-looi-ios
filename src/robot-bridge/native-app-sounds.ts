import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import {
  createAppSounds,
  type AppSoundClip,
  type AppSoundService,
} from "./app-sounds";

const MAX_NATIVE_PLAYBACK_MS = 2_000;

export type NativeAppSoundsOptions = {
  /** Current LOOI speaker gain, normalized from 0 (mute) to 1 (full). */
  volume?: () => number;
};

function readVolume(getVolume?: () => number): number {
  if (!getVolume) return 1;
  try {
    const volume = getVolume();
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  } catch {
    return 0;
  }
}

function abortError(): Error {
  const error = new Error("App sound playback was cancelled");
  error.name = "AbortError";
  return error;
}

/** Native Expo Audio driver for short, locally generated sound effects. It never
 * asks for microphone/camera access or changes the app's communication audio route. */
export function createNativeAppSounds(options: NativeAppSoundsOptions = {}): AppSoundService {
  let activePlayer: AudioPlayer | null = null;
  let stopActivePlayer: (() => void) | null = null;

  const sounds = createAppSounds({
    play(clip: AppSoundClip, { signal }): Promise<void> {
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise<void>((resolve, reject) => {
        let player: AudioPlayer | null = null;
        let subscription: { remove: () => void } | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          timer = null;
          signal.removeEventListener("abort", handleAbort);
          try { subscription?.remove(); } catch { /* player may already be gone */ }
          subscription = null;
          if (player) {
            try { player.pause(); } catch { /* player may already be gone */ }
            try { player.remove(); } catch { /* player may already be gone */ }
          }
          if (activePlayer === player) {
            activePlayer = null;
            stopActivePlayer = null;
          }
          if (error) reject(error);
          else resolve();
        };

        const handleAbort = () => finish(abortError());
        try {
          // Keeping the session active prevents a short effect from deactivating a
          // WebRTC session that currently owns the route. No global audio-mode write
          // is made here; native-media remains the route owner.
          player = createAudioPlayer(
            { uri: clip.uri },
            { updateInterval: 60, keepAudioSessionActive: true },
          );
          activePlayer = player;
          stopActivePlayer = handleAbort;
          // Read for every segment so a held wheee follows the latest app speaker gain.
          player.volume = readVolume(options.volume);
          subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
            if (status.error) finish(new Error(`App sound playback failed: ${status.error}`));
            else if (status.didJustFinish) finish();
          });
          const timeoutMs = Math.min(MAX_NATIVE_PLAYBACK_MS, Math.max(900, clip.durationMs + 800));
          timer = setTimeout(() => finish(new Error("App sound playback timed out")), timeoutMs);
          signal.addEventListener("abort", handleAbort, { once: true });
          if (signal.aborted) {
            handleAbort();
            return;
          }
          player.play();
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Could not start app sound playback"));
        }
      });
    },
    stop() {
      stopActivePlayer?.();
      // A stale player is not retained after stop; Expo Audio's remove releases it.
      activePlayer = null;
      stopActivePlayer = null;
    },
  });

  return sounds;
}
