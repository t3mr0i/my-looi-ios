/** A single native touch sample in face-local or screen logical (dp) coordinates. */
export type FaceStrokePoint = Readonly<{
  identifier: string;
  x: number;
  y: number;
  timestamp: number;
}>;

export type FaceStrokeResult = "stroke" | "press" | "cancelled";

export interface FaceStrokeRecognizer {
  /** Starts a fresh contact. A multitouch start is cached as cancelled. */
  start(point: FaceStrokePoint, touchCount?: number): void;
  /** Adds a sample while the original contact is active. */
  move(point: FaceStrokePoint, touchCount?: number): void;
  /** Classifies and caches the contact result until the next start. */
  finish(point: FaceStrokePoint, touchCount?: number): FaceStrokeResult;
  /** Cancels the active contact. A completed result remains unchanged. */
  cancel(): void;
  /** True after any valid non-zero movement was observed in this contact. */
  readonly moved: boolean;
}

const MIN_DURATION_MS = 240;
const MAX_DURATION_MS = 1_600;
const MIN_DISPLACEMENT_DP = 44;
const MAX_DISPLACEMENT_DP = 220;
const MAX_SEGMENT_SPEED_DP_PER_MS = 0.9;
const MAX_PATH_TO_DISPLACEMENT = 1.8;
const DISTANCE_EPSILON = 1e-7;

function isValidPoint(point: unknown): point is FaceStrokePoint {
  if (typeof point !== "object" || point === null) return false;
  const candidate = point as Partial<FaceStrokePoint>;
  return typeof candidate.identifier === "string" && candidate.identifier.length > 0
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.timestamp);
}

function distance(a: FaceStrokePoint, b: FaceStrokePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

type Contact = {
  phase: "active" | "finished";
  identifier: string | null;
  start: FaceStrokePoint | null;
  last: FaceStrokePoint | null;
  pathLength: number;
  moved: boolean;
  strokeEligible: boolean;
  result: FaceStrokeResult | null;
};

function cancelledContact(identifier: string | null = null): Contact {
  return {
    phase: "finished",
    identifier,
    start: null,
    last: null,
    pathLength: 0,
    moved: false,
    strokeEligible: false,
    result: "cancelled",
  };
}

function finishAs(contact: Contact, result: FaceStrokeResult): FaceStrokeResult {
  contact.phase = "finished";
  contact.result = result;
  return result;
}

function advance(contact: Contact, point: FaceStrokePoint, touchCount: number): boolean {
  if (
    contact.phase !== "active"
    || contact.last === null
    || contact.identifier === null
    || touchCount !== 1
    || !isValidPoint(point)
    || point.identifier !== contact.identifier
    || point.timestamp < contact.last.timestamp
  ) {
    finishAs(contact, "cancelled");
    return false;
  }

  const segment = distance(contact.last, point);
  const elapsedMs = point.timestamp - contact.last.timestamp;
  // Repeated stationary samples can share a platform timestamp. A spatial
  // move at that same timestamp cannot prove a deliberate, gentle stroke.
  if ((elapsedMs === 0 && segment > 0) || (elapsedMs > 0 && segment / elapsedMs > MAX_SEGMENT_SPEED_DP_PER_MS)) {
    contact.strokeEligible = false;
  }

  contact.pathLength += segment;
  contact.moved ||= segment > 0;
  contact.last = { ...point };
  return true;
}

/**
 * Recognizes deliberate, gentle one-finger strokes using only geometry and
 * touch timing. Readiness, sleep, voice and safety ownership belong to callers.
 * `finish` is safe to call from both native touch-end and Pressable onPress.
 */
export function createFaceStrokeRecognizer(): FaceStrokeRecognizer {
  let contact: Contact | null = null;

  return {
    start(point, touchCount = 1) {
      if (!isValidPoint(point) || touchCount !== 1) {
        contact = cancelledContact(typeof point?.identifier === "string" ? point.identifier : null);
        return;
      }
      const snapshot = { ...point };
      contact = {
        phase: "active",
        identifier: point.identifier,
        start: snapshot,
        last: snapshot,
        pathLength: 0,
        moved: false,
        strokeEligible: true,
        result: null,
      };
    },

    move(point, touchCount = 1) {
      if (contact === null) {
        contact = cancelledContact(typeof point?.identifier === "string" ? point.identifier : null);
        return;
      }
      advance(contact, point, touchCount);
    },

    finish(point, touchCount = 1) {
      if (contact === null) {
        contact = cancelledContact(typeof point?.identifier === "string" ? point.identifier : null);
        return "cancelled";
      }
      if (contact.phase === "finished") return contact.result ?? "cancelled";
      if (!advance(contact, point, touchCount) || contact.start === null || contact.last === null) {
        return finishAs(contact, "cancelled");
      }

      const displacement = distance(contact.start, contact.last);
      const durationMs = contact.last.timestamp - contact.start.timestamp;
      if (
        durationMs < MIN_DURATION_MS
        || durationMs > MAX_DURATION_MS
        || displacement < MIN_DISPLACEMENT_DP
        || displacement > MAX_DISPLACEMENT_DP
        || contact.pathLength > displacement * MAX_PATH_TO_DISPLACEMENT + DISTANCE_EPSILON
        || !contact.strokeEligible
      ) {
        return finishAs(contact, "press");
      }
      return finishAs(contact, "stroke");
    },

    cancel() {
      if (contact === null) {
        contact = cancelledContact();
        return;
      }
      if (contact.phase === "active") finishAs(contact, "cancelled");
    },

    get moved() {
      return contact?.moved ?? false;
    },
  };
}
