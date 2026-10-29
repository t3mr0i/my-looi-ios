import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { getLocalFaceAttentionModule, type LocalObjectPreviewEvent, type LocalObjectRect, type LocalObjectTrackEvent } from "../../modules/local-face-attention";
import { createObjectAttentionPolicy, objectGaze } from "./object-attention-policy";
import { createObjectActivityGazeDirector, isObjectActivityReferenceCurrent, type ObjectActivityReferenceCandidate } from "./object-activity-reference";
import { publishBehaviorEvent } from "../behavior/behavior-events";
import { acquireSocialObjectAttention, releaseSocialObjectAttention, getSocialAttentionControllerState } from "./social-attention";
import { isMainScreenFocused, subscribeMainScreenFocused } from "./main-screen-presence";
import { setAmbientObjectAttentionHeld } from "./ambient-motion";
import { requestCameraAccess } from "../permissions/camera";
import { useUserStore } from "../store/user";
import { useConversationStore } from "../store/conversation";
import { useBehaviorStore } from "../behavior/behavior-runtime";
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";

type Status = "idle" | "preparing" | "selecting" | "starting" | "tracking" | "lost" | "ended" | "error" | "unsupported";
export interface ObjectAttentionState {
  status: Status;
  preview: LocalObjectPreviewEvent | null;
  rect: LocalObjectRect | null;
  trackId: string | null;
  reason: string | null;
  /** JavaScript monotonic deadline, never a native timestamp or wall-clock date. */
  deadline: number | null;
  gaze: { x: number; y: number } | null;
  activityReference: (ObjectActivityReferenceCandidate & { trackId: string; expiresAt: number }) | null;
  activityAttention: "person" | "object" | null;
}

export const useObjectAttentionStore = create<ObjectAttentionState>(() => ({
  status: "idle", preview: null, rect: null, trackId: null, reason: null, deadline: null, gaze: null, activityReference: null, activityAttention: null,
}));

const monotonicNow = () => typeof performance !== "undefined" ? performance.now() : Date.now();
// A receive-time cap is only an early rejection. Native independently checks
// the exact frame's capture age, including delivery and bridge latency.
const MAX_SELECTION_RECEIVE_AGE_MS = 500;
const policy = createObjectAttentionPolicy(monotonicNow);
const activityGaze = createObjectActivityGazeDirector(monotonicNow);
let serial = 0;
type Native = NonNullable<ReturnType<typeof getLocalFaceAttentionModule>>;
type Request = {
  id: string;
  native: Native;
  cleanup: Array<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  frames: Map<string, number>;
  lastPreviewTimestamp: number;
  stopGeneration: number;
  selectionExpires: number;
  permissionPending: boolean;
  activityCandidate: ObjectActivityReferenceCandidate | null;
  referencePublished: boolean;
  selectionAccepted: boolean;
};
let current: Request | null = null;

function blockedReason(): string | null {
  const user = useUserStore.getState();
  if (AppState.currentState !== "active" || !isMainScreenFocused() || user.robotSleeping) return "interrupted";
  if (!user.preferences.cameraAttentionEnabled) return "camera-disabled";
  const robot = getLooiRobotRuntimeState();
  if (robot.motionActive || isDrivingControlSessionActive() || useBehaviorStore.getState().state.companion.scene?.status === "armed") return "busy";
  if (!getSocialAttentionControllerState().running) return "unavailable";
  return null;
}

function finish(status: Status, reason: string): void {
  const request = current;
  current = null;
  activityGaze.reset();
  policy.end(reason);
  useObjectAttentionStore.setState({ status, reason, preview: null, rect: null, gaze: null, deadline: null, trackId: null, activityReference: null, activityAttention: null });
  if (!request) return;
  if (request.timer !== null) clearInterval(request.timer);
  request.frames.clear();
  setAmbientObjectAttentionHeld(request.id, false);
  request.cleanup.forEach((remove) => remove());
  if (request.referencePublished && request.activityCandidate) publishBehaviorEvent({ type: "object-reference", sessionId: request.activityCandidate.sessionId, trackId: request.id, reference: null });
  releaseSocialObjectAttention(request.id);
  // This clears only the matching object lease. It never stops another camera owner.
  try { void request.native.stopObjectTracking?.(request.id).catch(() => undefined); } catch { /* Lifecycle cancellation remains authoritative. */ }
  recordDiagnosticEvent("vision", "object-attention-ended", { status, reason });
}

export function stopObjectAttention(): void { finish("ended", "cancelled"); }

function candidateIsCurrent(candidate: ObjectActivityReferenceCandidate): boolean {
  const behavior = useBehaviorStore.getState();
  return isObjectActivityReferenceCurrent(candidate, behavior.state, behavior.settings.mode);
}

function syncActivityAttention(request: Request): void {
  if (current !== request) return;
  const state = useObjectAttentionStore.getState();
  const candidate = request.activityCandidate;
  if (!candidate || !request.selectionAccepted || !state.gaze || state.status !== "tracking" || state.deadline === null) return;
  if (!request.referencePublished) {
    request.referencePublished = true;
    const reference = { ...candidate, trackId: request.id, expiresAt: state.deadline };
    useObjectAttentionStore.setState({ activityReference: reference });
    publishBehaviorEvent({ type: "object-reference", sessionId: candidate.sessionId, trackId: request.id, reference });
    if (current !== request) return;
  }
  const task = useBehaviorStore.getState().state.pendingIntention;
  const activity = task?.activity;
  const conversation = useConversationStore.getState();
  const target = activityGaze.update({
    bindingKey: request.id, phaseKey: `${activity?.phase ?? "unknown"}:${activity?.confirmed.length ?? 0}`,
    phase: activity?.phase ?? "unknown", tracked: true,
    busy: conversation.isUserSpeaking || conversation.isSpeaking || conversation.isProcessing,
    pendingConfirmation: !!activity?.pending,
  });
  if (useObjectAttentionStore.getState().activityAttention !== target) useObjectAttentionStore.setState({ activityAttention: target });
}

function checkEnvironment(): void {
  const request = current;
  if (!request) return;
  // An OS permission prompt may make the app inactive before it owns any frames.
  if (request.permissionPending && AppState.currentState === "inactive" && isMainScreenFocused() && !useUserStore.getState().robotSleeping) return;
  const reason = blockedReason();
  const robot = getLooiRobotRuntimeState();
  if (reason || robot.stopGeneration !== request.stopGeneration) {
    finish("ended", reason ?? "interrupted");
    return;
  }
  if (request.activityCandidate && !candidateIsCurrent(request.activityCandidate)) {
    finish("ended", "activity-reference-changed"); return;
  }
  const state = useObjectAttentionStore.getState();
  if (monotonicNow() >= request.selectionExpires && (state.status === "preparing" || state.status === "selecting")) {
    finish("ended", state.status === "preparing" ? "unavailable" : "selection-timeout"); return;
  }
  const next = policy.tick();
  if (state.status === "starting" || state.status === "tracking") {
    if (next.status === "lost" || next.status === "ended") finish(next.status, next.reason ?? "lost");
  }
  if (current === request) syncActivityAttention(request);
}

function previewFrame(request: Request, frame: LocalObjectPreviewEvent): void {
  if (current !== request || useObjectAttentionStore.getState().status !== "selecting") return;
  checkEnvironment();
  if (current !== request || frame.requestId !== request.id || frame.cameraFacing !== "front") return;
  if (!frame.frameId || frame.frameId.length > 128 || !Number.isFinite(frame.timestampMs) || frame.timestampMs <= request.lastPreviewTimestamp) return;
  if (!(frame.width > 0 && frame.width <= 1024 && frame.height > 0 && frame.height <= 1024)
    || typeof frame.dataUrl !== "string" || frame.dataUrl.length > 500_000 || !frame.dataUrl.startsWith("data:image/jpeg;base64,")) return;
  const received = monotonicNow();
  request.lastPreviewTimestamp = frame.timestampMs;
  request.frames.set(frame.frameId, received);
  for (const [id, at] of request.frames) if (received - at > 1_000 || request.frames.size > 4) request.frames.delete(id);
  useObjectAttentionStore.setState({ preview: { ...frame }, reason: null });
}

function trackedFrame(request: Request, frame: LocalObjectTrackEvent): void {
  if (current !== request || frame.requestId !== request.id || frame.trackId !== request.id) return;
  checkEnvironment(); if (current !== request) return;
  const state = useObjectAttentionStore.getState();
  if (frame.status === "ended" && (state.status === "selecting" || state.status === "preparing")) {
    finish("ended", frame.reason ?? "selection-timeout"); return;
  }
  if (state.status !== "starting" && state.status !== "tracking") return;
  const next = policy.update({ ...frame, sessionId: request.activityCandidate?.sessionId ?? null, confidence: frame.confidence ?? undefined });
  if (next.status === "lost" || next.status === "ended") { finish(next.status, next.reason ?? "lost"); return; }
  if (next.status !== "tracking" || !next.rect || !next.gaze) return;
  request.frames.clear();
  useObjectAttentionStore.setState({ status: request.selectionAccepted ? "tracking" : "starting", preview: null, rect: next.rect, gaze: next.gaze, trackId: next.trackId, reason: null, deadline: next.deadline });
  syncActivityAttention(request);
}

/** A deliberate UI action starts a bounded local preview; no Realtime request is made. */
export async function startObjectAttentionSelection(): Promise<void> {
  if (current) finish("ended", "replaced");
  const blocked = blockedReason();
  if (blocked) { finish("error", blocked); return; }
  const native = getLocalFaceAttentionModule();
  if (Platform.OS !== "ios" || !native?.startObjectSelection || !native.startObjectTracking || !native.stopObjectTracking) {
    finish("unsupported", "unsupported"); return;
  }
  const request: Request = {
    id: `object-${++serial}-${Math.floor(monotonicNow()).toString(36)}`, native,
    cleanup: [], timer: null, frames: new Map(), lastPreviewTimestamp: Number.NEGATIVE_INFINITY,
    stopGeneration: getLooiRobotRuntimeState().stopGeneration,
    selectionExpires: monotonicNow() + 15_000, permissionPending: true, activityCandidate: null, referencePublished: false, selectionAccepted: false,
  };
  current = request;
  useObjectAttentionStore.setState({ status: "preparing", preview: null, rect: null, gaze: null, trackId: null, reason: null, deadline: request.selectionExpires, activityReference: null, activityAttention: null });
  request.cleanup.push(subscribeMainScreenFocused(checkEnvironment), useUserStore.subscribe(checkEnvironment),
    useConversationStore.subscribe(checkEnvironment), useBehaviorStore.subscribe(checkEnvironment), subscribeLooiRobotRuntimeState(checkEnvironment));
  const appSubscription = AppState.addEventListener("change", checkEnvironment);
  request.cleanup.push(() => appSubscription.remove());
  request.timer = setInterval(checkEnvironment, 100);
  try {
    const granted = await requestCameraAccess();
    request.permissionPending = false;
    if (current !== request) return;
    if (!granted) { finish("error", "permission-denied"); return; }
    checkEnvironment(); if (current !== request) return;
    setAmbientObjectAttentionHeld(request.id, true);
    const acquired = await acquireSocialObjectAttention(request.id, () => {
      if (current === request) finish("ended", "interrupted");
    });
    if (current !== request) { releaseSocialObjectAttention(request.id); return; }
    if (!acquired) { finish("unsupported", getSocialAttentionControllerState().running ? "unsupported" : "unavailable"); return; }
    checkEnvironment(); if (current !== request) return;
    const previewSubscription = native.addListener("onObjectPreview", (frame) => previewFrame(request, frame));
    const trackSubscription = native.addListener("onObjectTrack", (frame) => trackedFrame(request, frame));
    const errorSubscription = native.addListener("onFaceAttentionError", () => {
      if (current === request) finish("error", "error");
    });
    request.cleanup.push(() => previewSubscription.remove(), () => trackSubscription.remove(), () => errorSubscription.remove());
    policy.begin(request.id);
    request.selectionExpires = monotonicNow() + 15_000;
    useObjectAttentionStore.setState({ status: "selecting", deadline: request.selectionExpires });
    const started = await native.startObjectSelection(request.id);
    if (current !== request) { void native.stopObjectTracking(request.id).catch(() => undefined); return; }
    if (!started) finish("error", "unavailable");
    else recordDiagnosticEvent("vision", "object-selection-started", { localOnly: true });
  } catch {
    if (current === request) finish("error", "error");
  }
}

export async function selectObjectAttention(frameId: string, rect: LocalObjectRect, activityCandidate?: ObjectActivityReferenceCandidate): Promise<boolean> {
  const request = current;
  if (!request || useObjectAttentionStore.getState().status !== "selecting" || !objectGaze(rect)) return false;
  checkEnvironment(); if (current !== request) return false;
  const receivedAt = request.frames.get(frameId);
  if (receivedAt === undefined || monotonicNow() - receivedAt > MAX_SELECTION_RECEIVE_AGE_MS) {
    useObjectAttentionStore.setState({ reason: "selection-stale" }); return false;
  }
  if (activityCandidate && !candidateIsCurrent(activityCandidate)) {
    finish("ended", "activity-reference-changed"); return false;
  }
  request.activityCandidate = activityCandidate ? { ...activityCandidate } : null;
  request.selectionAccepted = false;
  request.referencePublished = false;
  activityGaze.reset();
  policy.begin(request.id, activityCandidate?.sessionId);
  policy.arm(request.id, rect);
  useObjectAttentionStore.setState({ status: "starting", reason: null, rect: null, gaze: null, trackId: request.id, deadline: policy.snapshot().deadline });
  try {
    const result = await request.native.startObjectTracking!(request.id, frameId, rect);
    if (current !== request) { void request.native.stopObjectTracking!(request.id).catch(() => undefined); return false; }
    checkEnvironment(); if (current !== request) return false;
    const accepted = result === true || (typeof result === "object" && result !== null && result.accepted === true);
    if (!accepted) {
      const reason = typeof result === "object" && result !== null && result.accepted === false ? result.reason : null;
      if (reason === "selection-unavailable") {
        finish("error", "selection-unavailable");
        return false;
      }
      policy.begin(request.id);
      request.activityCandidate = null;
      useObjectAttentionStore.setState({ status: "selecting", reason: reason === "selection-stale" ? "selection-stale" : "selection-failed", rect: null, gaze: null, trackId: null, deadline: request.selectionExpires, activityReference: null, activityAttention: null });
      return false;
    }
    request.frames.clear();
    request.selectionAccepted = true;
    useObjectAttentionStore.setState({ status: "tracking", preview: null, deadline: policy.snapshot().deadline });
    syncActivityAttention(request);
    recordDiagnosticEvent("vision", "object-tracking-started", { localOnly: true });
    return true;
  } catch {
    if (current === request) finish("error", "error");
    return false;
  }
}
