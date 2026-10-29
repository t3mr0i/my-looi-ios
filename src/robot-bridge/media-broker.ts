import type { MediaStream, MediaStreamTrack } from "react-native-webrtc";

/** Exclusive, cancellable ownership of the phone's camera, microphone and
 * communication audio route for a robot app session. */

export type RobotMediaRequest = {
  camera: boolean;
  microphone: boolean;
  speaker: boolean;
  /** Best-effort WebRTC camera preference. Defaults to the outward-facing lens. */
  cameraFacing?: "user" | "environment";
};

export type MediaPermissionState = "granted" | "denied" | "prompt" | "unknown" | "unavailable";
export type MediaBrokerPhase = "idle" | "acquiring" | "active" | "releasing";

export type RobotMediaInputStatus = {
  supported: boolean;
  available: boolean | null;
  permission: MediaPermissionState;
};

export type RobotMediaSpeakerStatus = {
  supported: boolean;
  available: boolean | null;
  routeActive: boolean;
  speakerSelected: boolean | null;
  route: string | null;
};

export type RobotMediaStatus = {
  phase: MediaBrokerPhase;
  owner: string | null;
  request: RobotMediaRequest | null;
  camera: RobotMediaInputStatus;
  microphone: RobotMediaInputStatus;
  speaker: RobotMediaSpeakerStatus;
};

/** Native RTC types make the lease stream directly usable with
 * RTCPeerConnection.addTrack while keeping the import erased at runtime. */
export type RobotMediaTrack = MediaStreamTrack;
export type RobotMediaStream = MediaStream;

export type RobotMediaResources = {
  stream: RobotMediaStream | null;
  audioTracks: RobotMediaTrack[];
  videoTracks: RobotMediaTrack[];
  /** Stops tracks, restores the audio route and returns app media ownership. */
  release: (reason?: string) => Promise<void> | void;
};

export type RobotMediaBackendStatus = Pick<RobotMediaStatus, "camera" | "microphone" | "speaker">;

export type RobotVideoInfo = {
  width: number | null;
  height: number | null;
  /** WebRTC delivers upright frames; no extra client rotation is requested. */
  rotate: 0;
  available: boolean;
  source: "webrtc-track-settings" | "unavailable";
};

export type RobotAudioGainDevice = "speaker" | "microphone";
export type RobotAudioGainStatus = {
  percent: number;
  /** Software gain submitted to a React Native WebRTC audio track. This is
   * never an OS volume reading or confirmation of acoustic output level. */
  origin: "webrtc-track-gain";
  /** True until a live track of this kind exists to receive the configured gain. */
  pending: boolean;
};

export type RobotMediaBackend = {
  inspect: () => Promise<RobotMediaBackendStatus>;
  acquire: (owner: string, request: RobotMediaRequest, signal: AbortSignal) => Promise<RobotMediaResources>;
};

export type RobotMediaLease = {
  readonly owner: string;
  readonly request: Readonly<RobotMediaRequest>;
  readonly stream: RobotMediaStream | null;
  readonly audioTracks: readonly RobotMediaTrack[];
  readonly videoTracks: readonly RobotMediaTrack[];
  release: (reason?: string) => Promise<void>;
};

export type RobotMediaBroker = {
  acquire: (owner: string, request: RobotMediaRequest, options?: { signal?: AbortSignal }) => Promise<RobotMediaLease>;
  /** Cancels a pending getUserMedia request too. Late native streams are stopped
   * by the backend before the broker permits a new owner. */
  release: (owner: string, reason?: string) => Promise<void>;
  stopAll: (reason?: string) => Promise<void>;
  /** Metadata from this owner's live video track, never a requested resolution. */
  getVideoInfo: (owner: string) => RobotVideoInfo;
  getAudioGain: (device: RobotAudioGainDevice) => RobotAudioGainStatus;
  setAudioGain: (device: RobotAudioGainDevice, percent: number) => RobotAudioGainStatus;
  /** Registers an incoming WebRTC audio track for the current opted-in owner. */
  registerRemoteAudioTrack: (owner: string, track: RobotMediaTrack) => boolean;
  inspect: () => Promise<RobotMediaStatus>;
  subscribe: (listener: (status: RobotMediaStatus) => void) => () => void;
};

type LeaseState = {
  owner: string;
  request: RobotMediaRequest;
  phase: Exclude<MediaBrokerPhase, "idle">;
  controller: AbortController;
  resources: RobotMediaResources | null;
  lease: RobotMediaLease | null;
  acquisition: Promise<RobotMediaLease>;
  externalAbort?: () => void;
  externalSignal?: AbortSignal;
  releasePromise: Promise<void> | null;
  releaseReason: string;
  version: number;
  remoteAudioTracks: Set<RobotMediaTrack>;
};

function applyTrackGain(track: RobotMediaTrack, percent: number): void {
  if (track.kind !== "audio" || typeof track._setVolume !== "function") {
    throw new Error("This WebRTC audio track does not support software gain");
  }
  track._setVolume(percent / 100);
}

function muteRemoteTrack(track: RobotMediaTrack): void {
  try { if (track.kind === "audio") track._setVolume?.(0); } catch { /* keep the remote track disabled below */ }
  try { track.enabled = false; } catch { /* native track may already be stopped */ }
}

function stopTrack(track: RobotMediaTrack): void {
  try { track.stop?.(); } catch { /* native track may already be stopped */ }
}

function abortError(): Error {
  const error = new Error("Robot media acquisition was cancelled");
  error.name = "AbortError";
  return error;
}

function sameRequest(a: RobotMediaRequest, b: RobotMediaRequest): boolean {
  return a.camera === b.camera && a.microphone === b.microphone && a.speaker === b.speaker && a.cameraFacing === b.cameraFacing;
}

function normalizeRequest(request: RobotMediaRequest): RobotMediaRequest {
  if (!request || typeof request !== "object" ||
      typeof request.camera !== "boolean" || typeof request.microphone !== "boolean" || typeof request.speaker !== "boolean") {
    throw new TypeError("Robot media request must explicitly select camera, microphone and speaker");
  }
  if (!request.camera && !request.microphone && !request.speaker) throw new Error("Robot media request is empty");
  const cameraFacing = request.cameraFacing ?? "environment";
  if (cameraFacing !== "user" && cameraFacing !== "environment") throw new TypeError("Unsupported camera facing preference");
  return Object.freeze({ camera: request.camera, microphone: request.microphone, speaker: request.speaker, cameraFacing });
}

function idleBackendStatus(): RobotMediaBackendStatus {
  return {
    camera: { supported: false, available: null, permission: "unavailable" },
    microphone: { supported: false, available: null, permission: "unavailable" },
    speaker: { supported: false, available: null, routeActive: false, speakerSelected: null, route: null },
  };
}

/** One app at a time may own phone media. Release invalidates a pending
 * acquisition synchronously; it never waits behind native permission UI. */
export function createMediaBroker(backend: RobotMediaBackend): RobotMediaBroker {
  let current: LeaseState | null = null;
  let generation = 0;
  let speakerGain = 100;
  let microphoneGain = 100;
  const listeners = new Set<(status: RobotMediaStatus) => void>();

  function liveTracks(device: RobotAudioGainDevice): RobotMediaTrack[] {
    const state = current;
    if (!state || state.phase !== "active") return [];
    if (device === "microphone") {
      if (!state.request.microphone) return [];
      return (state.resources?.audioTracks ?? []).filter((track) => track.readyState !== "ended");
    }
    if (!state.request.speaker) return [];
    return [...state.remoteAudioTracks].filter((track) => track.readyState !== "ended");
  }

  function gainStatus(device: RobotAudioGainDevice): RobotAudioGainStatus {
    if (device !== "speaker" && device !== "microphone") throw new TypeError("Unknown audio gain device");
    return {
      percent: device === "speaker" ? speakerGain : microphoneGain,
      origin: "webrtc-track-gain",
      pending: liveTracks(device).length === 0,
    };
  }

  function setGain(device: RobotAudioGainDevice, percent: number): RobotAudioGainStatus {
    if (device !== "speaker" && device !== "microphone") throw new TypeError("Unknown audio gain device");
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new RangeError("Audio gain must be a finite percentage from 0 to 100");
    }
    const tracks = liveTracks(device);
    const previous = device === "speaker" ? speakerGain : microphoneGain;
    const applied: RobotMediaTrack[] = [];
    try {
      for (const track of tracks) {
        applyTrackGain(track, percent);
        applied.push(track);
      }
    } catch (error) {
      for (const track of applied) {
        try { applyTrackGain(track, previous); } catch { /* best-effort rollback after native failure */ }
      }
      throw error;
    }
    if (device === "speaker") speakerGain = percent;
    else microphoneGain = percent;
    notify();
    return gainStatus(device);
  }

  function notify(): void {
    void inspect().then((status) => {
      for (const listener of listeners) {
        try { listener(status); } catch { /* observers cannot block teardown */ }
      }
    }).catch(() => undefined);
  }

  function finishIfCurrent(state: LeaseState): void {
    if (current !== state || state.phase !== "releasing") return;
    if (state.externalAbort && state.externalSignal) state.externalSignal.removeEventListener("abort", state.externalAbort);
    state.externalAbort = undefined;
    state.externalSignal = undefined;
    current = null;
    generation += 1;
    notify();
  }

  async function releaseState(state: LeaseState, reason: string): Promise<void> {
    if (state.releasePromise) return state.releasePromise;
    state.phase = "releasing";
    state.releaseReason = reason;
    state.controller.abort();
    for (const track of state.remoteAudioTracks) {
      muteRemoteTrack(track);
      stopTrack(track);
    }
    state.remoteAudioTracks.clear();
    notify();
    if (!state.resources) {
      // The backend acquisition remains the teardown barrier. Its late native
      // stream is disposed before this owner can be replaced.
      if (state.lease) finishIfCurrent(state);
      return;
    }
    const resources = state.resources;
    state.resources = null;
    state.releasePromise = Promise.resolve().then(() => resources.release(reason)).finally(() => finishIfCurrent(state));
    return state.releasePromise;
  }

  async function releaseOwner(owner: string, reason = "released"): Promise<void> {
    const state = current;
    if (!state || state.owner !== owner) return;
    if (state.externalAbort && state.externalSignal) state.externalSignal.removeEventListener("abort", state.externalAbort);
    state.externalAbort = undefined;
    state.externalSignal = undefined;
    await releaseState(state, reason);
  }

  async function inspect(): Promise<RobotMediaStatus> {
    let media = idleBackendStatus();
    try { media = await backend.inspect(); } catch { /* keep unknown/unsupported values honest */ }
    const state = current;
    return {
      phase: state?.phase ?? "idle",
      owner: state?.owner ?? null,
      request: state ? { ...state.request } : null,
      camera: { ...media.camera },
      microphone: { ...media.microphone },
      speaker: { ...media.speaker },
    };
  }

  return {
    getVideoInfo(owner) {
      const state = current;
      const empty: RobotVideoInfo = { width: null, height: null, rotate: 0, available: false, source: "unavailable" };
      if (!state || state.owner !== owner || state.phase !== "active" || !state.request.camera) return empty;
      const camera = state.resources?.videoTracks.find(track => track.kind === "video" && track.readyState !== "ended");
      if (!camera) return empty;
      let settings: Record<string, unknown> = {};
      try { settings = camera.getSettings?.() as Record<string, unknown> ?? {}; } catch { /* track settings can be unavailable during native teardown */ }
      const dimension = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16384 ? value : null;
      return { width: dimension(settings.width), height: dimension(settings.height), rotate: 0, available: true, source: "webrtc-track-settings" };
    },
    getAudioGain(device) {
      return gainStatus(device);
    },
    setAudioGain(device, percent) {
      return setGain(device, percent);
    },
    registerRemoteAudioTrack(owner, track) {
      if (track?.kind !== "audio") return false;
      const state = current;
      if (!state || state.owner !== owner || state.phase !== "active" || !state.request.speaker) {
        muteRemoteTrack(track);
        return false;
      }
      if (state.remoteAudioTracks.has(track)) return true;
      try {
        applyTrackGain(track, speakerGain);
        state.remoteAudioTracks.add(track);
        notify();
        return true;
      } catch {
        muteRemoteTrack(track);
        stopTrack(track);
        return false;
      }
    },
    acquire(owner, request, options = {}) {
      if (typeof owner !== "string" || owner.trim().length === 0 || owner.length > 160) throw new TypeError("Robot media owner is invalid");
      const normalized = normalizeRequest(request);
      if (options.signal?.aborted) return Promise.reject(abortError());

      if (current) {
        if (current.owner !== owner) return Promise.reject(new Error("Robot media is already owned by another app"));
        if (!sameRequest(current.request, normalized)) return Promise.reject(new Error("Robot media owner cannot change its request without releasing its lease"));
        if (current.phase === "releasing") return Promise.reject(abortError());
        return current.acquisition;
      }

      const controller = new AbortController();
      const state: LeaseState = {
        owner,
        request: normalized,
        phase: "acquiring" as const,
        controller,
        resources: null,
        lease: null,
        acquisition: Promise.resolve(null as unknown as RobotMediaLease),
        releasePromise: null,
        releaseReason: "released",
        version: ++generation,
        remoteAudioTracks: new Set(),
      };
      current = state;
      if (options.signal) {
        const cancel = () => { void releaseState(state, "caller-aborted"); };
        state.externalAbort = cancel;
        state.externalSignal = options.signal;
        options.signal.addEventListener("abort", cancel, { once: true });
      }
      notify();

      state.acquisition = Promise.resolve().then(() => backend.acquire(owner, normalized, controller.signal)).then(async (resources) => {
        state.resources = resources;
        if (current !== state || state.controller.signal.aborted || state.phase === "releasing") {
          await releaseState(state, state.releaseReason || "cancelled-after-acquire");
          throw abortError();
        }
        if (state.request.microphone) {
          for (const track of resources.audioTracks) applyTrackGain(track, microphoneGain);
        }
        state.phase = "active";
        const lease: RobotMediaLease = Object.freeze({
          owner,
          request: normalized,
          stream: resources.stream,
          audioTracks: Object.freeze(resources.audioTracks.slice()),
          videoTracks: Object.freeze(resources.videoTracks.slice()),
          release: (reason = "lease-released") => releaseOwner(owner, reason),
        });
        state.lease = lease;
        notify();
        return lease;
      }).catch(async (error) => {
        if (state.resources) {
          const resources = state.resources;
          state.resources = null;
          await Promise.resolve(resources.release("acquisition-failed")).catch(() => undefined);
        }
        if (current === state) {
          if (state.phase === "releasing") finishIfCurrent(state);
          else {
            if (state.externalAbort && options.signal) options.signal.removeEventListener("abort", state.externalAbort);
            current = null;
            generation += 1;
            notify();
          }
        }
        throw error;
      });

      return state.acquisition;
    },
    release: releaseOwner,
    async stopAll(reason = "stopped") {
      const state = current;
      if (state) await releaseState(state, reason);
    },
    inspect,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

