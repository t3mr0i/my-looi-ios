import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export type LocalFaceRect = {
  /** Ephemeral JS-side track label; it does not identify a person. */
  trackingId?: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type LocalFaceFrameEvent = {
  timestampMs: number;
  faceCount: number;
  primary: LocalFaceRect | null;
  /** Bounded list for local multi-face target selection. Missing on legacy native builds. */
  faces?: LocalFaceRect[];
  /** Ephemeral local signal, emitted only after the interaction-signal toggle is enabled. */
  interactionSignal?: LocalInteractionSignal | null;
  /** Detected hands for this analyzed frame, emitted only while signals are enabled. */
  interactionHandCount?: number;
};

export type LocalInteractionSignal = {
  kind: "open_palm";
  confidence: number;
  handCount: number;
};


export type LocalCameraFacing = "front" | "back";

/** Normalized, unmirrored, top-left-origin rectangle in the selected preview. */
export type LocalObjectRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type LocalObjectPreviewEvent = {
  requestId: string;
  frameId: string;
  timestampMs: number;
  cameraFacing: "front";
  width: number;
  height: number;
  dataUrl: string;
};

export type LocalObjectTrackEvent = {
  requestId: string;
  trackId: string;
  timestampMs: number;
  status: "tracking" | "lost" | "ended";
  rect: LocalObjectRect | null;
  confidence: number | null;
  reason?: string;
};

export type LocalObjectTrackingStartReason =
  | "selection-stale"
  | "selection-unavailable"
  | "selection-invalid"
  | "tracking-failed";

export type LocalObjectTrackingStartResult =
  | { accepted: true }
  | { accepted: false; reason: LocalObjectTrackingStartReason };

export type LocalStillCapture = {
  mimeType: "image/jpeg";
  base64: string;
  width: number;
  height: number;
  timestampMs: number;
  cameraFacing: LocalCameraFacing;
  cameraId: string | null;
  autofocusMode: number;
  flashAvailable: boolean;
  aeState: number | null;
  awbState: number | null;
  afState: number | null;
  exposureTimeMs: number | null;
  sensitivityIso: number | null;
  lowLightLikely: boolean;
};

export type LocalFaceAttentionErrorEvent = {
  stage: string;
  message: string;
};

export type LocalFaceAttentionStatus = {
  supported: boolean;
  running: boolean;
  permissionGranted: boolean;
  cameraId: string | null;
  lensFacing: string;
  framesAnalyzed: number;
  stillWidth?: number | null;
  stillHeight?: number | null;
  autofocusMode?: number;
  flashAvailable?: boolean;
  /** Missing on older native builds; normalized to false by the JS status helper. */
  signalAnalysisSupported?: boolean;
  /** Missing on older native builds; normalized to false by the JS status helper. */
  objectTrackingSupported?: boolean;
};

type Events = {
  onFaceFrame(event: LocalFaceFrameEvent): void;
  onFaceAttentionError(event: LocalFaceAttentionErrorEvent): void;
  onObjectPreview(event: LocalObjectPreviewEvent): void;
  onObjectTrack(event: LocalObjectTrackEvent): void;
};

declare class LocalFaceAttentionNativeModule extends NativeModule<Events> {
  start(): Promise<LocalFaceAttentionStatus>;
  stop(): Promise<LocalFaceAttentionStatus>;
  getStatus(): Promise<LocalFaceAttentionStatus>;
  captureStill(cameraFacing: LocalCameraFacing): Promise<LocalStillCapture>;
  setInteractionSignalsEnabled?: (enabled: boolean) => Promise<boolean>;
  startObjectSelection?: (requestId: string) => Promise<boolean>;
  /** Older native builds return a boolean; current builds return a reasoned result. */
  startObjectTracking?: (requestId: string, frameId: string, rect: LocalObjectRect) => Promise<LocalObjectTrackingStartResult | boolean>;
  stopObjectTracking?: (requestId: string) => Promise<void>;
}

let cached: LocalFaceAttentionNativeModule | null | undefined;

function getModule(): LocalFaceAttentionNativeModule | null {
  if (Platform.OS === "web") return null;
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<LocalFaceAttentionNativeModule>("LocalFaceAttention");
  } catch {
    cached = null;
  }
  return cached;
}

const unsupportedStatus: LocalFaceAttentionStatus = {
  supported: false,
  running: false,
  permissionGranted: false,
  cameraId: null,
  lensFacing: "unsupported",
  framesAnalyzed: 0,
  signalAnalysisSupported: false,
  objectTrackingSupported: false,
};

export function getLocalFaceAttentionModule(): LocalFaceAttentionNativeModule | null {
  return getModule();
}

export async function getLocalFaceAttentionStatus(): Promise<LocalFaceAttentionStatus> {
  const status = await getModule()?.getStatus();
  return status ? {
    ...status,
    signalAnalysisSupported: status.signalAnalysisSupported ?? false,
    objectTrackingSupported: status.objectTrackingSupported ?? false,
  } : unsupportedStatus;
}

/**
 * Enables optional local hand-pose analysis on the existing camera frame stream.
 * This never starts the camera and safely returns false on older native builds.
 */
export async function setLocalInteractionSignalsEnabled(enabled: boolean): Promise<boolean> {
  const module = getModule();
  const setEnabled = module?.setInteractionSignalsEnabled;
  if (!module || typeof setEnabled !== "function") return false;
  return await setEnabled.call(module, enabled);
}

/** Starts a bounded local selection window on the already-running front camera. */
export async function startLocalObjectSelection(requestId: string): Promise<boolean> {
  const module = getModule();
  const start = module?.startObjectSelection;
  if (!module || typeof start !== "function") return false;
  return await start.call(module, requestId);
}

/** Seeds native tracking from the exact, still-retained preview frame. */
export async function startLocalObjectTracking(
  requestId: string,
  frameId: string,
  rect: LocalObjectRect,
): Promise<LocalObjectTrackingStartResult | boolean> {
  const module = getModule();
  const start = module?.startObjectTracking;
  if (!module || typeof start !== "function") return false;
  return await start.call(module, requestId, frameId, rect);
}

/** Ends only this object-selection/tracking lease; the face camera remains running. */
export async function stopLocalObjectTracking(requestId: string): Promise<void> {
  const module = getModule();
  const stop = module?.stopObjectTracking;
  if (!module || typeof stop !== "function") return;
  await stop.call(module, requestId);
}
