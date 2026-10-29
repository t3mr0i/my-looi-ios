import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const geometry = loadTypeScript("src/core/object-attention-policy.ts");
const { createSelectionGesturePin } = loadTypeScript("src/ui/object-attention-gesture.ts", {
  "../core/object-attention-policy": geometry,
});

const preview = (frameId, dataUrl = `data:image/jpeg;base64,${frameId}`) => ({
  requestId: "request-1",
  frameId,
  timestampMs: 100,
  cameraFacing: "front",
  width: 640,
  height: 480,
  dataUrl,
});

const snapshot = (frame, stageSize, imageBounds) => ({
  preview: frame,
  stageSize,
  imageBounds,
});

const gesture = createSelectionGesturePin();
assert.equal(gesture.begin(), null, "a gesture cannot start without a successfully loaded preview");

const frameA = preview("frame-A");
const sizeA = { width: 400, height: 300 };
const boundsA = { x: 20, y: 10, width: 360, height: 270 };
gesture.updateLatest(snapshot(frameA, sizeA, boundsA));
const started = gesture.begin();
assert.equal(started.preview, frameA, "the pin retains the exact loaded preview object");
assert.deepEqual(started.stageSize, sizeA);
assert.deepEqual(started.imageBounds, boundsA);

// Once the drag starts, later loaded frames must not change its preview or coordinate basis.
const frameB = preview("frame-B");
const frameC = preview("frame-C");
gesture.updateLatest(snapshot(frameB, { width: 300, height: 400 }, { x: 0, y: 50, width: 300, height: 300 }));
gesture.updateLatest(snapshot(frameC, { width: 500, height: 300 }, { x: 70, y: 0, width: 360, height: 300 }));
const duringDrag = gesture.current();
assert.equal(duringDrag.preview, frameA);
assert.deepEqual(duringDrag.stageSize, sizeA);
assert.deepEqual(duringDrag.imageBounds, boundsA);
const resolved = gesture.resolve({ x: 92, y: 64 }, { x: 272, y: 226 });
assert.equal(resolved.frameId, "frame-A", "release must submit the pinned frame, not the latest preview");
assert.deepEqual(resolved.rect, { left: 0.2, top: 0.2, right: 0.7, bottom: 0.8 },
  "release geometry must use the image bounds captured with the pinned frame");
assert.equal(gesture.current(), null, "release always clears the active gesture pin");
assert.equal(gesture.resolve({ x: 100, y: 100 }, { x: 200, y: 200 }), null,
  "a second release cannot reuse the previous selection");

// Cancel must clear A; a later gesture may pin the then-current frame C.
gesture.updateLatest(snapshot(frameA, sizeA, boundsA));
assert.equal(gesture.begin().preview, frameA);
gesture.updateLatest(snapshot(frameB, { width: 300, height: 400 }, { x: 0, y: 50, width: 300, height: 300 }));
gesture.clear();
assert.equal(gesture.current(), null, "cancellation clears the active pin");
gesture.updateLatest(snapshot(frameC, { width: 500, height: 300 }, { x: 70, y: 0, width: 360, height: 300 }));
assert.equal(gesture.begin().preview, frameC, "the next gesture starts from the next eligible loaded preview");
assert.equal(gesture.resolve({ x: 160, y: 75 }, { x: 340, y: 225 }).frameId, "frame-C");

// Clearing/releasing an invalid selection still consumes the pin; invalid latest values cannot be pinned.
gesture.updateLatest(snapshot(frameA, sizeA, boundsA));
gesture.begin();
assert.equal(gesture.resolve({ x: 0, y: 0 }, { x: 100, y: 100 }), null,
  "a gesture in the letterbox does not produce a selected region");
assert.equal(gesture.current(), null, "an invalid release also consumes its pinned frame");
gesture.begin();
assert.equal(gesture.resolve({ x: 100, y: 100 }, { x: 101, y: 150 }), null,
  "a non-tap drag under the minimum width can be reported as a failed selection");
assert.equal(gesture.current(), null);
gesture.updateLatest(snapshot(frameA, { width: 0, height: 300 }, boundsA));
assert.equal(gesture.begin(), null, "invalid stage geometry is not pinnable");
gesture.updateLatest(null);
assert.equal(gesture.begin(), null, "clearing latest preview prevents selection from an old frame");

console.log("object attention selection gesture pin tests passed");
