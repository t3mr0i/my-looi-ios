import { Platform } from "react-native";
import { mediaDevices, permissions, type MediaStream, type MediaStreamTrack } from "react-native-webrtc";
import {
  activateRealtimeSpeakerRoute,
  deactivateRealtimeSpeakerRoute,
  getRealtimeAudioRouteStatus,
  type RealtimeAudioRouteStatus,
} from "../../modules/realtime-audio-route";
import type {
  MediaPermissionState,
  RobotMediaBackend,
  RobotMediaBackendStatus,
  RobotMediaRequest,
  RobotMediaResources,
  RobotMediaStream,
  RobotMediaTrack,
} from "./media-broker";

export type RobotMediaOwnershipHooks = {
  /** Suspend LOOI's existing microphone and camera owners before any native
   * permission prompt or getUserMedia call. Must honor the abort signal. */
  acquireOwnership?: (owner: string, signal: AbortSignal) => Promise<void>;
  /** Restore LOOI media only when the app is still foreground and awake. */
  releaseOwnership?: (owner: string, reason: string) => Promise<void> | void;
};

type PermissionApi = {
  query: (descriptor: { name: "camera" | "microphone" }) => Promise<unknown>;
  request: (descriptor: { name: "camera" | "microphone" }) => Promise<unknown>;
};

type NativeMediaDependencies = {
  platform: string;
  mediaDevices: {
    enumerateDevices: () => Promise<unknown>;
    getUserMedia: (constraints: Record<string, unknown>) => Promise<MediaStream>;
  };
  permissions: PermissionApi;
  activateSpeakerRoute: () => Promise<RealtimeAudioRouteStatus>;
  deactivateSpeakerRoute: () => Promise<RealtimeAudioRouteStatus>;
  getAudioRouteStatus: () => Promise<RealtimeAudioRouteStatus>;
};

const nativeDependencies: NativeMediaDependencies = {
  platform: Platform.OS,
  mediaDevices,
  permissions,
  activateSpeakerRoute: activateRealtimeSpeakerRoute,
  deactivateSpeakerRoute: deactivateRealtimeSpeakerRoute,
  getAudioRouteStatus: getRealtimeAudioRouteStatus,
};

function isNativePlatform(platform: string): boolean {
  return platform === "ios" || platform === "android";
}

function normalizePermission(value: unknown): MediaPermissionState {
  if (value === true || value === "granted") return "granted";
  if (value === false || value === "denied" || value === "blocked") return "denied";
  if (value === "prompt" || value === "undetermined" || value === "not-determined") return "prompt";
  return "unknown";
}

function asDeviceList(value: unknown): Array<{ kind?: string }> | null {
  if (Array.isArray(value)) return value.filter((item): item is { kind?: string } => Boolean(item && typeof item === "object"));
  if (value && typeof value === "object" && Array.isArray((value as { devices?: unknown }).devices)) {
    return (value as { devices: unknown[] }).devices.filter((item): item is { kind?: string } => Boolean(item && typeof item === "object"));
  }
  return null;
}

/** React Native WebRTC may conceal devices until their OS permission is
 * granted. A missing item before then means "unknown", not "unavailable". */
function inputAvailable(
  devices: Array<{ kind?: string }> | null,
  kind: "videoinput" | "audioinput",
  permission: MediaPermissionState,
): boolean | null {
  if (!devices) return null;
  if (devices.some((device) => device.kind === kind)) return true;
  return permission === "granted" ? false : null;
}

function stopTrack(track: RobotMediaTrack): void {
  try { track.stop?.(); } catch { /* native tracks can already be ended */ }
}

function abortError(): Error {
  const error = new Error("Robot media acquisition was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Native React Native WebRTC media implementation. All native calls are
 * injected at the edge so the shared bridge remains importable in Node tests. */
export function createNativeMediaBackend(
  hooks: RobotMediaOwnershipHooks = {},
  dependencies: NativeMediaDependencies = nativeDependencies,
): RobotMediaBackend {
  const native = isNativePlatform(dependencies.platform);

  async function readPermission(name: "camera" | "microphone"): Promise<MediaPermissionState> {
    if (!native) return "unavailable";
    try { return normalizePermission(await dependencies.permissions.query({ name })); }
    catch { return "unknown"; }
  }

  async function ensurePermission(name: "camera" | "microphone", signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const status = await readPermission(name);
    throwIfAborted(signal);
    if (status === "granted") return;
    if (status === "denied" || status === "unavailable") throw new Error(`Robot app ${name} permission is ${status}`);

    let result: unknown;
    try { result = await dependencies.permissions.request({ name }); }
    catch (error) {
      throwIfAborted(signal);
      throw new Error(`Could not request ${name} permission: ${error instanceof Error ? error.message : String(error)}`);
    }
    throwIfAborted(signal);
    if (normalizePermission(result) !== "granted") throw new Error(`Robot app ${name} permission was not granted`);
  }

  return {
    async inspect(): Promise<RobotMediaBackendStatus> {
      if (!native) {
        return {
          camera: { supported: false, available: null, permission: "unavailable" },
          microphone: { supported: false, available: null, permission: "unavailable" },
          speaker: { supported: false, available: null, routeActive: false, speakerSelected: null, route: null },
        };
      }

      const [cameraPermission, microphonePermission, deviceResult, routeResult] = await Promise.allSettled([
        readPermission("camera"),
        readPermission("microphone"),
        dependencies.mediaDevices.enumerateDevices(),
        dependencies.getAudioRouteStatus(),
      ]);
      const cameraStatus = cameraPermission.status === "fulfilled" ? cameraPermission.value : "unknown";
      const microphoneStatus = microphonePermission.status === "fulfilled" ? microphonePermission.value : "unknown";
      const devices = deviceResult.status === "fulfilled" ? asDeviceList(deviceResult.value) : null;
      const route = routeResult.status === "fulfilled" ? routeResult.value : null;
      const routeSupported = route?.supported === true;
      return {
        camera: {
          supported: typeof dependencies.mediaDevices.getUserMedia === "function",
          available: inputAvailable(devices, "videoinput", cameraStatus),
          permission: cameraStatus,
        },
        microphone: {
          supported: typeof dependencies.mediaDevices.getUserMedia === "function",
          available: inputAvailable(devices, "audioinput", microphoneStatus),
          permission: microphoneStatus,
        },
        speaker: {
          // WebRTC can play remote audio on native iOS/Android. Route control
          // is required for the opted-in communication-speaker capability.
          // Do not advertise it when the platform cannot select that route.
          supported: route?.supported === true,
          available: typeof route?.speakerDeviceAvailable === "boolean" ? route.speakerDeviceAvailable : null,
          routeActive: route?.active === true,
          speakerSelected: typeof route?.speakerSelected === "boolean" ? route.speakerSelected : null,
          route: routeSupported ? route.routeStrategy : null,
        },
      };
    },

    async acquire(owner: string, request: RobotMediaRequest, signal: AbortSignal): Promise<RobotMediaResources> {
      if (!native) throw new Error("Robot bridge camera and microphone are supported only on iOS and Android");
      let ownershipAttempted = false;
      let routeAttempted = false;
      let stream: MediaStream | null = null;
      let disposed = false;

      const dispose = async (reason: string): Promise<void> => {
        if (disposed) return;
        disposed = true;
        if (stream) {
          const tracks = stream.getTracks() as unknown as RobotMediaTrack[];
          for (const track of tracks) stopTrack(track);
          // RN WebRTC retains a native stream object in addition to its tracks.
          // release(false) drops that wrapper after explicit track.stop().
          try { stream.release(false); } catch { /* Web APIs do not expose release */ }
          stream = null;
        }
        let cleanupError: unknown = null;
        if (routeAttempted) {
          try { await dependencies.deactivateSpeakerRoute(); }
          catch (error) { cleanupError = error; }
          routeAttempted = false;
        }
        if (ownershipAttempted) {
          try { await hooks.releaseOwnership?.(owner, reason); }
          catch (error) { cleanupError ??= error; }
          ownershipAttempted = false;
        }
        if (cleanupError) throw cleanupError;
      };

      try {
        throwIfAborted(signal);
        if (request.speaker) {
          let route: RealtimeAudioRouteStatus;
          try { route = await dependencies.getAudioRouteStatus(); }
          catch (error) {
            throw new Error(`Could not inspect speaker routing: ${error instanceof Error ? error.message : String(error)}`);
          }
          throwIfAborted(signal);
          if (route.supported !== true) throw new Error("Communication speaker routing is not supported on this device");
          if (route.speakerDeviceAvailable === false) throw new Error("The phone speaker is not available for communication audio");
        }
        if (hooks.acquireOwnership) {
          ownershipAttempted = true;
          await hooks.acquireOwnership(owner, signal);
        }
        throwIfAborted(signal);

        // Set the communication route before getUserMedia creates native audio
        // capture. Teardown restores it only after local tracks have stopped.
        if (request.speaker) {
          routeAttempted = true;
          const route = await dependencies.activateSpeakerRoute();
          throwIfAborted(signal);
          if (!route.supported) throw new Error("Communication speaker routing is not supported on this device");
          if (route.speakerDeviceAvailable === false) throw new Error("The phone speaker is not available for communication audio");
          if (!route.active || !route.speakerSelected) {
            throw new Error("The phone could not select its communication speaker route");
          }
        }

        if (request.camera) await ensurePermission("camera", signal);
        if (request.microphone) await ensurePermission("microphone", signal);
        throwIfAborted(signal);

        if (request.camera || request.microphone) {
          const video = request.camera ? {
            facingMode: { ideal: request.cameraFacing ?? "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          } : false;
          stream = await dependencies.mediaDevices.getUserMedia({
            audio: request.microphone ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            } : false,
            video,
          });
          // getUserMedia is not cancellable in React Native. Keep this owner's
          // suspension barrier until it settles, then stop every late track
          // before releasing ownership or allowing a new owner.
          throwIfAborted(signal);
        }

        const allTracks = (stream?.getTracks?.() ?? []) as unknown as RobotMediaTrack[];
        const audioTracks = (stream?.getAudioTracks?.() ?? []).filter((track) => request.microphone) as unknown as RobotMediaTrack[];
        const videoTracks = (stream?.getVideoTracks?.() ?? []).filter((track) => request.camera) as unknown as RobotMediaTrack[];
        if (request.microphone && audioTracks.length === 0) throw new Error("Native WebRTC did not provide the requested microphone track");
        if (request.camera && videoTracks.length === 0) throw new Error("Native WebRTC did not provide the requested camera track");

        for (const track of allTracks) {
          if ((track.kind === "audio" && !request.microphone) || (track.kind === "video" && !request.camera)) stopTrack(track);
        }

        let released = false;
        const resources: RobotMediaResources = {
          stream: stream as unknown as RobotMediaStream | null,
          audioTracks,
          videoTracks,
          release: async (reason = "lease-released") => {
            if (released) return;
            released = true;
            await dispose(reason);
          },
        };
        return resources;
      } catch (error) {
        await dispose(signal.aborted ? "cancelled" : "acquisition-failed").catch(() => undefined);
        throw error;
      }
    },
  };
}

