import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createFaceStrokeRecognizer } = loadTypeScript("src/character/face-stroke.ts");
const point = (x, y, timestamp, identifier = "touch-1") => ({ identifier, x, y, timestamp });

function recognizeStroke({ start = point(0, 0, 0), moves = [], end }) {
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(start);
  for (const move of moves) recognizer.move(move);
  return recognizer.finish(end);
}

// A deliberate stroke is accepted at the minimum, maximum, and representative
// interior timing and displacement boundaries.
assert.equal(recognizeStroke({ end: point(44, 0, 240) }), "stroke", "inclusive minimum duration and distance");
assert.equal(recognizeStroke({ end: point(60, 0, 600) }), "stroke");
assert.equal(recognizeStroke({ end: point(220, 0, 1600) }), "stroke", "inclusive maximum duration and distance");
assert.equal(recognizeStroke({ end: point(216, 0, 240) }), "stroke", "inclusive maximum sampled speed");
assert.equal(recognizeStroke({ end: point(216.1, 0, 240) }), "press", "a sampled speed above the maximum cannot become petting");
assert.equal(recognizeStroke({ end: point(216, 0, 240) }), "stroke", "inclusive maximum sampled speed");

// Duration or endpoint displacement outside the intentional-stroke window is a
// normal press when the input is otherwise a coherent, single-touch movement.
assert.equal(recognizeStroke({ end: point(60, 0, 239.999) }), "press", "too short");
assert.equal(recognizeStroke({ end: point(60, 0, 1600.001) }), "press", "too long");
assert.equal(recognizeStroke({ end: point(43.999, 0, 600) }), "press", "too little displacement");
assert.equal(recognizeStroke({ end: point(220.001, 0, 600) }), "press", "too much displacement");

// The average speed can be low while one sampled segment is a fast flick.
assert.equal(recognizeStroke({
  moves: [point(50, 0, 50), point(50, 0, 300)],
  end: point(50, 0, 300),
}), "press", "a fast segment cannot become a pet stroke by waiting afterwards");

// Modest curvature is allowed, but a loop or wandering path is not.
assert.equal(recognizeStroke({
  moves: [point(40, 0, 400), point(60, 10, 600)],
  end: point(60, 0, 700),
}), "stroke", "small path curvature is allowed within the path ratio");
assert.equal(recognizeStroke({
  moves: [point(70, 0, 700)],
  end: point(50, 0, 1_000),
}), "stroke", "a path exactly 1.8 times its displacement is allowed");
assert.equal(recognizeStroke({
  moves: [point(71, 0, 710)],
  end: point(50, 0, 1_000),
}), "press", "a path beyond the 1.8 ratio remains a press");
assert.equal(recognizeStroke({
  moves: [point(70, 0, 700), point(0, 10, 1400)],
  end: point(45, 10, 1500),
}), "press", "a long loop cannot be mistaken for a friendly stroke");

// Direction is intentionally not constrained: vertical and diagonal strokes
// are still one-finger strokes over the same bounded distance and time.
assert.equal(recognizeStroke({ end: point(0, -60, 600) }), "stroke");
assert.equal(recognizeStroke({ end: point(42, 42, 800) }), "stroke");

for (const invalidPoint of [
  undefined,
  null,
  point(Number.NaN, 0, 0),
  point(0, Number.POSITIVE_INFINITY, 0),
  point(0, 0, Number.NaN),
  { identifier: "", x: 0, y: 0, timestamp: 0 },
]) {
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(invalidPoint);
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "invalid start cancels this contact");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  recognizer.move(point(60, 0, 400, "touch-2"));
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "touch identifier changes invalidate the contact");
}

for (const touchCount of [0, 2, 3]) {
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0), touchCount);
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", `touch count ${touchCount} at start cancels`);
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  assert.equal(recognizer.finish(point(60, 0, 600), 2), "cancelled", "multitouch at release cancels");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  recognizer.move(point(20, 0, 200), 2);
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "multitouch during movement cancels the whole contact");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 300));
  recognizer.move(point(20, 0, 250));
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "out-of-order move timestamp cancels");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 300));
  assert.equal(recognizer.finish(point(60, 0, 299)), "cancelled", "out-of-order end timestamp cancels");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  recognizer.move(point(Number.POSITIVE_INFINITY, 0, 300));
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "invalid movement coordinates cancel");
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  recognizer.move(point(1, 0, 0));
  assert.equal(recognizer.finish(point(60, 0, 600)), "press", "displacement at a non-advancing timestamp cannot qualify as petting");
}

// Both TouchEnd and Pressable onPress can call finish for the same physical
// touch. The first classification wins until another start replaces it.
for (const expected of ["stroke", "press", "cancelled"]) {
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  if (expected === "cancelled") recognizer.cancel();
  const end = expected === "press" ? point(10, 0, 600) : point(60, 0, 600);
  assert.equal(recognizer.finish(end), expected);
  assert.equal(recognizer.finish(point(Number.NaN, 0, -1, "touch-2")), expected, `duplicate finish preserves ${expected}`);
}

{
  const recognizer = createFaceStrokeRecognizer();
  recognizer.start(point(0, 0, 0));
  recognizer.move(point(1, 0, 1));
  assert.equal(recognizer.moved, true, "movement is exposed for long-press arbitration");
  recognizer.cancel();
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled");
  recognizer.start(point(0, 0, 10, "touch-2"));
  assert.equal(recognizer.moved, false, "a new contact resets movement state");
  assert.equal(recognizer.finish(point(60, 0, 610, "touch-2")), "stroke", "a new contact resets cancellation and finish cache");
}

{
  const recognizer = createFaceStrokeRecognizer();
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled", "release without a started contact cannot be a stroke");
  assert.equal(recognizer.finish(point(60, 0, 600)), "cancelled");
}

console.log("Face stroke recognition: thresholds, single-touch safety, cancellation and idempotent finish PASS");
