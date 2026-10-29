import { selectionRect, type DisplayPoint, type DisplayRect } from "../core/object-attention-policy";
import type { LocalObjectPreviewEvent } from "../../modules/local-face-attention";

export type ObjectAttentionStageSize = { width: number; height: number };

/** The loaded preview and the exact geometry used to display it. */
export type ObjectAttentionSelectionSnapshot = {
  preview: LocalObjectPreviewEvent;
  stageSize: ObjectAttentionStageSize;
  imageBounds: DisplayRect;
};

export type PinnedObjectAttentionSelection = ObjectAttentionSelectionSnapshot;

export type ResolvedObjectAttentionSelection = {
  frameId: string;
  rect: NonNullable<ReturnType<typeof selectionRect>>;
};

function validSnapshot(value: ObjectAttentionSelectionSnapshot | null): value is ObjectAttentionSelectionSnapshot {
  if (!value || !value.preview || typeof value.preview.frameId !== "string" || !value.preview.frameId.trim()) return false;
  const { width, height } = value.stageSize;
  const bounds = value.imageBounds;
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width) && bounds.width > 0
    && Number.isFinite(bounds.height) && bounds.height > 0;
}

function copySnapshot(value: ObjectAttentionSelectionSnapshot): PinnedObjectAttentionSelection {
  return {
    // Preserve the exact image object that completed onLoad; only the layout geometry is copied.
    preview: value.preview,
    stageSize: { ...value.stageSize },
    imageBounds: { ...value.imageBounds },
  };
}

/**
 * Keeps a drag tied to the exact loaded preview it began on, even while newer
 * camera previews arrive. A successful release and every cancellation clear
 * the active pin; only a later begin can pin another preview.
 */
export function createSelectionGesturePin() {
  let latest: ObjectAttentionSelectionSnapshot | null = null;
  let active: PinnedObjectAttentionSelection | null = null;

  return {
    updateLatest(snapshot: ObjectAttentionSelectionSnapshot | null): void {
      latest = validSnapshot(snapshot) ? copySnapshot(snapshot) : null;
    },

    begin(): PinnedObjectAttentionSelection | null {
      active = latest ? copySnapshot(latest) : null;
      return active ? copySnapshot(active) : null;
    },

    current(): PinnedObjectAttentionSelection | null {
      return active ? copySnapshot(active) : null;
    },

    resolve(start: DisplayPoint, end: DisplayPoint): ResolvedObjectAttentionSelection | null {
      const pinned = active;
      active = null;
      if (!pinned) return null;
      const rect = selectionRect(start, end, pinned.imageBounds);
      return rect ? { frameId: pinned.preview.frameId, rect } : null;
    },

    clear(): void {
      active = null;
    },
  };
}
