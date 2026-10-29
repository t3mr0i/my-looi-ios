import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const {
  containedImageRect,
  selectionRect,
  objectGaze,
  createObjectAttentionPolicy,
} = loadTypeScript("src/core/object-attention-policy.ts");

// Contain-fit geometry leaves the preview's letterbox outside the selectable image.
const image = containedImageRect(400, 400, 1920, 1080);
assert.deepEqual(image, { x: 0, y: 87.5, width: 400, height: 225 });
assert.equal(containedImageRect(0, 400, 100, 100), null);
assert.equal(containedImageRect(Number.NaN, 400, 100, 100), null);

const tap = selectionRect({ x: 200, y: 200 }, { x: 205, y: 203 }, image);
assert.deepEqual(tap, { left: 0.375, top: 0.375, right: 0.625, bottom: 0.625 });
assert.deepEqual(
  selectionRect({ x: 0, y: 87.5 }, { x: 2, y: 88 }, image),
  { left: 0, top: 0, right: 0.25, bottom: 0.25 },
  "a tap near a corner must keep the bounded target box inside the image",
);
assert.equal(selectionRect({ x: -1, y: 200 }, { x: 100, y: 200 }, image), null,
  "a touch that begins in the letterbox must not select an object");
assert.equal(selectionRect({ x: 120, y: 160 }, { x: 121, y: 180 }, image), null,
  "a small but non-tap drag without meaningful width must be rejected");
assert.deepEqual(
  selectionRect({ x: 250, y: 220 }, { x: 500, y: 350 }, image),
  { left: 0.625, top: 0.5888888888888889, right: 1, bottom: 1 },
  "a drag beyond the preview must clip to the visible image bounds",
);
assert.deepEqual(
  selectionRect({ x: 200, y: 200 }, { x: 80, y: 120 }, image),
  { left: 0.2, top: 0.14444444444444443, right: 0.5, bottom: 0.5 },
  "reverse drags preserve top-left, unmirrored camera coordinates",
);
assert.deepEqual(objectGaze({ left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }), { x: 0, y: 0 });
assert.deepEqual(objectGaze({ left: 0, top: 0, right: 0.1, bottom: 0.1 }), { x: 1, y: -1 });
assert.equal(objectGaze({ left: -0.1, top: 0, right: 0.2, bottom: 0.2 }), null);

let now = 1_000;
const policy = createObjectAttentionPolicy(() => now);
const selected = { left: 0.2, top: 0.25, right: 0.4, bottom: 0.5 };
assert.deepEqual(policy.begin("request-a", "session-a"), {
  status: "selecting", requestId: "request-a", sessionId: "session-a", trackId: null,
  rect: null, gaze: null, reason: null, deadline: 16_000,
});
assert.equal(policy.arm("track-a", selected).status, "tracking");
assert.equal(policy.snapshot().deadline, 11_000, "tracking gets a fixed ten-second lease");

const frame = (overrides = {}) => ({
  requestId: "request-a",
  sessionId: "session-a",
  trackId: "track-a",
  timestampMs: 10,
  status: "tracking",
  rect: { ...selected },
  confidence: 0.9,
  ...overrides,
});
assert.equal(policy.update(frame({ requestId: "old-request" })).status, "tracking");
assert.equal(policy.update(frame({ sessionId: "old-session" })).status, "tracking");
assert.equal(policy.update(frame({ trackId: "old-track" })).status, "tracking");
assert.equal(policy.update(frame({ timestampMs: Number.NaN })).status, "tracking");
assert.deepEqual(policy.update(frame()).rect, selected);
assert.ok(Math.abs(policy.snapshot().gaze.x - 0.625) < 1e-9);
assert.ok(Math.abs(policy.snapshot().gaze.y + 0.36764705882352944) < 1e-9);
assert.deepEqual(policy.update(frame({ rect: null })).rect, selected,
  "a duplicate native timestamp cannot replace or clear the last accepted box");

// Strictly increasing native timestamps are required, while frame freshness uses JS time.
now = 1_400;
assert.equal(policy.update(frame({ timestampMs: 9 })).status, "tracking", "reordered frames are ignored");
assert.equal(policy.update(frame({ timestampMs: 10 })).status, "tracking", "duplicate frames are ignored");
now = 1_501;
assert.equal(policy.tick().status, "lost", "duplicates do not extend the 500ms receive-time lease");
assert.equal(policy.snapshot().reason, "frame-gap");
assert.equal(policy.update(frame({ timestampMs: 11 })).status, "lost", "a lost track cannot reacquire itself");

// Wrong selected geometry, low confidence, and out-of-image boxes all fail closed.
for (const [badEvent, reason] of [
  [frame({ confidence: 0.69 }), "low-confidence"],
  [frame({ rect: { left: -0.1, top: 0.2, right: 0.2, bottom: 0.4 } }), "invalid-bounds"],
  [frame({ rect: { left: 0.7, top: 0.7, right: 0.8, bottom: 0.8 } }), "implausible-motion"],
]) {
  now = 2_000;
  const guarded = createObjectAttentionPolicy(() => now);
  guarded.begin("request-a", "session-a");
  guarded.arm("track-a", selected);
  assert.equal(guarded.update(badEvent).status, "lost");
  assert.equal(guarded.snapshot().reason, reason);
  assert.equal(guarded.update(frame({ timestampMs: 11 })).status, "lost");
}

// A large per-frame jump or scale change ends the current identity hypothesis.
now = 3_000;
const moving = createObjectAttentionPolicy(() => now);
moving.begin("r", "s");
moving.arm("t");
assert.equal(moving.update(frame({ requestId: "r", sessionId: "s", trackId: "t", rect: selected })).status, "tracking");
assert.equal(moving.update(frame({ requestId: "r", sessionId: "s", trackId: "t", timestampMs: 11,
  rect: { left: 0.65, top: 0.3, right: 0.85, bottom: 0.5 } })).status, "lost");

// Explicit stop and native terminal events cannot be undone by late frames.
const stopped = createObjectAttentionPolicy(() => now);
stopped.begin("r", "s");
stopped.arm("t");
stopped.end("user-cancelled");
assert.equal(stopped.update(frame({ requestId: "r", sessionId: "s", trackId: "t" })).status, "ended");
assert.equal(stopped.snapshot().reason, "user-cancelled");
const nativeLost = createObjectAttentionPolicy(() => now);
nativeLost.begin("r", "s");
nativeLost.arm("t");
assert.equal(nativeLost.update(frame({ requestId: "r", sessionId: "s", trackId: "t", status: "lost", reason: "occluded" })).status, "lost");

// Selection and tracking have independent fixed TTLs and do not renew on events.
const selectionTimeout = createObjectAttentionPolicy(() => now);
selectionTimeout.begin("r");
now += 15_000;
assert.equal(selectionTimeout.tick().status, "ended");
assert.equal(selectionTimeout.snapshot().reason, "selection-timeout");
const trackingTimeout = createObjectAttentionPolicy(() => now);
trackingTimeout.begin("r");
trackingTimeout.arm("t");
now += 9_999;
assert.equal(trackingTimeout.update(frame({ requestId: "r", trackId: "t", timestampMs: 10, sessionId: null })).status, "tracking");
now += 1;
assert.equal(trackingTimeout.tick().status, "ended");
assert.equal(trackingTimeout.snapshot().reason, "tracking-timeout");

console.log("Object attention policy tests passed");
