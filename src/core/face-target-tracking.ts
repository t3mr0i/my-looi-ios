/** Geometry from local face detection. IDs are temporary track labels, not identities. */
export type FaceTargetRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type TrackedFaceTarget = FaceTargetRect & { id: string };

type Track = {
  id: string;
  rect: FaceTargetRect;
  lastSeenAt: number;
};

const DEFAULT_TRACK_TTL_MS = 1_800;
const MAX_TRACKS = 8;
const MAX_CENTER_DISTANCE = 0.24;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function normalizeRect(rect: FaceTargetRect): FaceTargetRect | null {
  if (!rect || ![rect.left, rect.top, rect.right, rect.bottom].every(finite)) return null;
  const left = Math.max(0, Math.min(1, rect.left));
  const top = Math.max(0, Math.min(1, rect.top));
  const right = Math.max(left, Math.min(1, rect.right));
  const bottom = Math.max(top, Math.min(1, rect.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width,
    height,
  };
}

function intersectionOverUnion(a: FaceTargetRect, b: FaceTargetRect): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = width * height;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function matchScore(previous: FaceTargetRect, next: FaceTargetRect): number | null {
  const dx = next.centerX - previous.centerX;
  const dy = next.centerY - previous.centerY;
  const distance = Math.hypot(dx, dy);
  const previousArea = previous.width * previous.height;
  const nextArea = next.width * next.height;
  const areaRatio = Math.max(previousArea, nextArea) / Math.max(0.0001, Math.min(previousArea, nextArea));
  const overlap = intersectionOverUnion(previous, next);
  if (distance > MAX_CENTER_DISTANCE || areaRatio > 7 || (overlap < 0.015 && distance > 0.11)) return null;
  return overlap * 3 - distance * 1.5 - Math.abs(Math.log(areaRatio)) * 0.16;
}

/**
 * Assigns deterministic temporary IDs by local geometry and forgets unseen
 * tracks after a short TTL. It makes no claim that a track belongs to a person.
 */
export class FaceTargetTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(private readonly ttlMs = DEFAULT_TRACK_TTL_MS, private readonly maxTracks = MAX_TRACKS) {}

  update(rectangles: readonly FaceTargetRect[], nowMs: number): TrackedFaceTarget[] {
    const valid = rectangles
      .map((rect, index) => ({ index, rect: normalizeRect(rect) }))
      .filter((entry): entry is { index: number; rect: FaceTargetRect } => entry.rect !== null)
      .slice(0, Math.max(1, this.maxTracks));

    this.tracks = this.tracks.filter((track) => nowMs - track.lastSeenAt <= this.ttlMs);
    const candidates: Array<{ trackIndex: number; faceIndex: number; score: number }> = [];
    for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex += 1) {
      for (let faceIndex = 0; faceIndex < valid.length; faceIndex += 1) {
        const score = matchScore(this.tracks[trackIndex]!.rect, valid[faceIndex]!.rect);
        if (score !== null) candidates.push({ trackIndex, faceIndex, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    const trackForFace = new Map<number, Track>();
    const usedTracks = new Set<number>();
    for (const candidate of candidates) {
      if (usedTracks.has(candidate.trackIndex) || trackForFace.has(candidate.faceIndex)) continue;
      usedTracks.add(candidate.trackIndex);
      trackForFace.set(candidate.faceIndex, this.tracks[candidate.trackIndex]!);
    }

    const result: TrackedFaceTarget[] = valid.map(({ rect }, faceIndex) => {
      let track = trackForFace.get(faceIndex);
      if (!track) {
        track = { id: `face-${this.nextId++}`, rect, lastSeenAt: nowMs };
        this.tracks.push(track);
      } else {
        track.rect = rect;
        track.lastSeenAt = nowMs;
      }
      return { ...rect, id: track.id };
    });

    this.tracks = this.tracks
      .filter((track) => nowMs - track.lastSeenAt <= this.ttlMs)
      .slice(-Math.max(1, this.maxTracks));
    return result;
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }
}

export function createFaceTargetTracker(ttlMs = DEFAULT_TRACK_TTL_MS, maxTracks = MAX_TRACKS): FaceTargetTracker {
  return new FaceTargetTracker(ttlMs, maxTracks);
}
