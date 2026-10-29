/** Geometry and lifecycle policy for one explicitly selected local image region. */

export type LocalObjectRect = {
  /** Normalized coordinates in the unmirrored camera image. */
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DisplayRect = { x: number; y: number; width: number; height: number };
export type DisplayPoint = { x: number; y: number };

export type ObjectAttentionStatus = "idle" | "selecting" | "tracking" | "lost" | "ended";

export type ObjectAttentionSnapshot = {
  status: ObjectAttentionStatus;
  requestId: string | null;
  sessionId: string | null;
  trackId: string | null;
  rect: LocalObjectRect | null;
  gaze: DisplayPoint | null;
  reason: string | null;
  /** Deadline from the injected JavaScript monotonic clock. */
  deadline: number | null;
};

export type ObjectAttentionFrameEvent = {
  requestId: string;
  sessionId?: string | null;
  trackId: string;
  /** Native monotonic timestamp; only ordering is compared. */
  timestampMs: number;
  status: "tracking" | "lost" | "ended";
  rect?: LocalObjectRect | null;
  confidence?: number;
  reason?: string;
};

const SELECTING_TTL_MS = 15_000;
const TRACKING_TTL_MS = 10_000;
const FRAME_GAP_LIMIT_MS = 500;
const MIN_CONFIDENCE = 0.7;
const MAX_CENTER_JUMP = 0.28;
const MAX_DIMENSION_RATIO = 4;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validDisplayRect(rect: DisplayRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && isFinitePositive(rect.width) && isFinitePositive(rect.height);
}

function validObjectRect(rect: LocalObjectRect | null | undefined): rect is LocalObjectRect {
  return !!rect
    && Number.isFinite(rect.left) && Number.isFinite(rect.top)
    && Number.isFinite(rect.right) && Number.isFinite(rect.bottom)
    && rect.left >= 0 && rect.top >= 0 && rect.right <= 1 && rect.bottom <= 1
    && rect.left < rect.right && rect.top < rect.bottom;
}

/** Returns the actual image bounds after `contain` scaling, including letterboxing. */
export function containedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): DisplayRect | null {
  if (![containerWidth, containerHeight, imageWidth, imageHeight].every(isFinitePositive)) return null;
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** Converts a drag selection to unmirrored normalized image coordinates. */
export function selectionRect(
  start: DisplayPoint,
  end: DisplayPoint,
  image: DisplayRect,
): LocalObjectRect | null {
  if (!validDisplayRect(image)
    || !Number.isFinite(start.x) || !Number.isFinite(start.y)
    || !Number.isFinite(end.x) || !Number.isFinite(end.y)) return null;

  const imageRight = image.x + image.width;
  const imageBottom = image.y + image.height;
  if (start.x < image.x || start.x > imageRight || start.y < image.y || start.y > imageBottom) return null;

  const normalizedX = (start.x - image.x) / image.width;
  const normalizedY = (start.y - image.y) / image.height;
  if (Math.hypot(end.x - start.x, end.y - start.y) < 12) {
    const left = Math.min(0.75, Math.max(0, normalizedX - 0.125));
    const top = Math.min(0.75, Math.max(0, normalizedY - 0.125));
    return { left, top, right: left + 0.25, bottom: top + 0.25 };
  }

  const clippedEndX = Math.min(imageRight, Math.max(image.x, end.x));
  const clippedEndY = Math.min(imageBottom, Math.max(image.y, end.y));
  const left = Math.min(start.x, clippedEndX);
  const right = Math.max(start.x, clippedEndX);
  const top = Math.min(start.y, clippedEndY);
  const bottom = Math.max(start.y, clippedEndY);
  const rect = {
    left: (left - image.x) / image.width,
    top: (top - image.y) / image.height,
    right: (right - image.x) / image.width,
    bottom: (bottom - image.y) / image.height,
  };
  if (rect.right - rect.left < 0.05 || rect.bottom - rect.top < 0.05) return null;
  return rect;
}

/** Maps a normalized camera target through the existing front-camera gaze convention. */
export function objectGaze(rect: LocalObjectRect): DisplayPoint | null {
  if (!validObjectRect(rect)) return null;
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const gazeX = clamp(-((centerX - 0.5) / 0.32));
  return {
    x: gazeX === 0 ? 0 : gazeX,
    y: clamp((centerY - 0.5) / 0.34),
  };
}

function copySnapshot(state: ObjectAttentionSnapshot): ObjectAttentionSnapshot {
  return {
    ...state,
    rect: state.rect ? { ...state.rect } : null,
    gaze: state.gaze ? { ...state.gaze } : null,
  };
}

function center(rect: LocalObjectRect): DisplayPoint {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function plausibleSuccessor(previous: LocalObjectRect, next: LocalObjectRect): boolean {
  const a = center(previous);
  const b = center(next);
  if (Math.hypot(a.x - b.x, a.y - b.y) > MAX_CENTER_JUMP) return false;
  const widthRatio = next.right - next.left > previous.right - previous.left
    ? (next.right - next.left) / (previous.right - previous.left)
    : (previous.right - previous.left) / (next.right - next.left);
  const heightRatio = next.bottom - next.top > previous.bottom - previous.top
    ? (next.bottom - next.top) / (previous.bottom - previous.top)
    : (previous.bottom - previous.top) / (next.bottom - next.top);
  return widthRatio <= MAX_DIMENSION_RATIO && heightRatio <= MAX_DIMENSION_RATIO;
}

/**
 * A one-shot, local-only target lease. Native timestamps establish frame order;
 * all deadlines and frame-gap durations use the injected JavaScript clock.
 */
export function createObjectAttentionPolicy(now: () => number = () => performance.now()) {
  let state: ObjectAttentionSnapshot = {
    status: "idle",
    requestId: null,
    sessionId: null,
    trackId: null,
    rect: null,
    gaze: null,
    reason: null,
    deadline: null,
  };
  let lastNativeTimestamp: number | null = null;
  let lastFreshAt: number | null = null;
  let expectedRect: LocalObjectRect | null = null;

  const finish = (status: "lost" | "ended", reason: string): void => {
    state = { ...state, status, rect: null, gaze: null, reason, deadline: null };
  };

  const readNow = (): number | null => {
    const value = now();
    return Number.isFinite(value) ? value : null;
  };

  const tick = (): ObjectAttentionSnapshot => {
    const current = readNow();
    if (current === null) return copySnapshot(state);
    if (state.status === "selecting" && state.deadline !== null && current >= state.deadline) {
      finish("ended", "selection-timeout");
    } else if (state.status === "tracking" && state.deadline !== null && current >= state.deadline) {
      finish("ended", "tracking-timeout");
    } else if (state.status === "tracking" && lastFreshAt !== null
      && current >= lastFreshAt && current - lastFreshAt > FRAME_GAP_LIMIT_MS) {
      finish("lost", "frame-gap");
    }
    return copySnapshot(state);
  };

  return {
    begin(requestId: string, sessionId?: string | null): ObjectAttentionSnapshot {
      const current = readNow();
      if (current === null || typeof requestId !== "string" || !requestId.trim()
        || (sessionId !== undefined && sessionId !== null && (typeof sessionId !== "string" || !sessionId.trim()))) {
        return copySnapshot(state);
      }
      lastNativeTimestamp = null;
      lastFreshAt = null;
      expectedRect = null;
      state = {
        status: "selecting",
        requestId,
        sessionId: sessionId ?? null,
        trackId: null,
        rect: null,
        gaze: null,
        reason: null,
        deadline: current + SELECTING_TTL_MS,
      };
      return copySnapshot(state);
    },

    arm(trackId: string, selectedRect?: LocalObjectRect): ObjectAttentionSnapshot {
      const currentState = tick();
      const current = readNow();
      if (current === null || currentState.status !== "selecting"
        || typeof trackId !== "string" || !trackId.trim()
        || (selectedRect !== undefined && !validObjectRect(selectedRect))) return currentState;
      lastNativeTimestamp = null;
      lastFreshAt = null;
      expectedRect = selectedRect ? { ...selectedRect } : null;
      state = {
        ...state,
        status: "tracking",
        trackId,
        rect: null,
        gaze: null,
        reason: null,
        deadline: current + TRACKING_TTL_MS,
      };
      return copySnapshot(state);
    },

    update(event: ObjectAttentionFrameEvent): ObjectAttentionSnapshot {
      const currentState = tick();
      const current = readNow();
      if (current === null || currentState.status !== "tracking"
        || !event || event.requestId !== state.requestId || event.trackId !== state.trackId
        || (event.sessionId ?? null) !== state.sessionId
        || !Number.isFinite(event.timestampMs) || event.timestampMs < 0
        || (lastNativeTimestamp !== null && event.timestampMs <= lastNativeTimestamp)
        || !["tracking", "lost", "ended"].includes(event.status)) return currentState;

      lastNativeTimestamp = event.timestampMs;
      if (event.status === "lost") {
        finish("lost", typeof event.reason === "string" && event.reason ? event.reason : "native-lost");
        return copySnapshot(state);
      }
      if (event.status === "ended") {
        finish("ended", typeof event.reason === "string" && event.reason ? event.reason : "native-ended");
        return copySnapshot(state);
      }

      if (lastFreshAt !== null && current < lastFreshAt) return currentState;
      if (typeof event.confidence !== "number" || !Number.isFinite(event.confidence)
        || event.confidence < 0 || event.confidence > 1 || event.confidence < MIN_CONFIDENCE) {
        finish("lost", "low-confidence");
        return copySnapshot(state);
      }
      if (!validObjectRect(event.rect)) {
        finish("lost", "invalid-bounds");
        return copySnapshot(state);
      }
      const previous = state.rect ?? expectedRect;
      if (previous && !plausibleSuccessor(previous, event.rect)) {
        finish("lost", "implausible-motion");
        return copySnapshot(state);
      }

      lastFreshAt = current;
      state = {
        ...state,
        rect: { ...event.rect },
        gaze: objectGaze(event.rect),
        reason: null,
      };
      expectedRect = null;
      return copySnapshot(state);
    },

    tick,

    end(reason = "stopped"): ObjectAttentionSnapshot {
      if (state.status !== "lost" && state.status !== "ended") finish("ended", reason);
      return copySnapshot(state);
    },

    snapshot(): ObjectAttentionSnapshot {
      return copySnapshot(state);
    },
  };
}
