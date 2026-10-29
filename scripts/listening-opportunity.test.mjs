import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { createListeningOpportunityDetector } = loadTypeScript("src/behavior/listening-opportunity.ts");
function harness() {
  const detector = createListeningOpportunityDetector();
  let time = 1_000, native = 500_000, sequence = 0, revision = 1;
  const cues = [];
  function feed(rms, patch = {}, elapsed = 100) {
    time += elapsed; native += 100;
    const value = { sessionId: "s", revision, sequence: ++sequence, nativeTimestampMs: native, durationMs: 100, rms, ...patch };
    const result = detector.frame(value, time);
    if (result) cues.push(time);
    return result;
  }
  function run(rms, chunks) { for (let i = 0; i < chunks; i++) feed(rms); }
  return { detector, feed, run, cues, nextTurn: () => { revision++; }, gap: (ms) => { time += ms; native += ms; } };
}

const live = harness();
live.run(0.03, 35); assert.equal(live.cues.length, 0, "sustained speech alone is not an opportunity");
live.run(0.001, 2); assert.equal(live.cues.length, 0, "a brief dip is not a pause");
live.feed(0.001); assert.equal(live.cues.length, 1, "a short pause after a longer spoken segment is eligible");
live.run(0.001, 100); assert.equal(live.cues.length, 1, "silence cannot repeatedly generate cues");
live.run(0.03, 65); live.run(0.001, 3); assert.equal(live.cues.length, 2);
live.run(0.03, 65); live.run(0.001, 3); assert.equal(live.cues.length, 2, "at most two accents per spoken turn");
live.detector.reset(); live.run(0.03, 65); live.run(0.001, 3);
assert.equal(live.cues.length, 2, "a cancellation cannot reset the turn quota");
live.nextTurn(); live.run(0.03, 35); live.run(0.001, 3); assert.equal(live.cues.length, 3);

for (const [label, rms] of [["silence", 0], ["weak signal", 0.002]]) {
  const h = harness(); h.run(rms, 70); h.run(0, 4);
  assert.equal(h.cues.length, 0, `${label} supplies no spoken-segment evidence`);
}
const short = harness(); short.run(0.03, 10); short.run(0.001, 3);
assert.equal(short.cues.length, 0, "short utterances need no extra cue");
const cooldown = harness(); cooldown.run(0.03, 35); cooldown.run(0.001, 3);
cooldown.nextTurn(); cooldown.run(0.03, 35); cooldown.run(0.001, 3);
assert.equal(cooldown.cues.length, 1, "the cooldown survives a new user turn");

for (const patch of [{ sequence: 1 }, { nativeTimestampMs: 1 }, { rms: NaN }, { durationMs: 500 }, { revision: -1 }]) {
  const h = harness(); h.run(0.03, 35); h.feed(0.03, patch); h.run(0.001, 3);
  assert.equal(h.cues.length, 0, `invalid or reordered metadata clears accumulated evidence: ${JSON.stringify(patch)}`);
}
const gap = harness(); gap.run(0.03, 35); gap.gap(1_000); gap.run(0.001, 3);
assert.equal(gap.cues.length, 0, "a dropped audio interval cannot be mistaken for a pause");
const burst = harness();
for (let i = 0; i < 35; i++) burst.feed(0.03, {}, 1);
for (let i = 0; i < 3; i++) burst.feed(0.001, {}, 1);
assert.equal(burst.cues.length, 0, "queued audio replayed in a burst never accumulates live evidence");
const slowQueue = harness();
for (let i = 0; i < 40; i++) slowQueue.feed(0.03, {}, 250);
slowQueue.run(0.001, 3);
assert.equal(slowQueue.cues.length, 0, "cumulative delivery delay cannot pass as a live pause");
const scope = harness(); scope.run(0.03, 35); scope.nextTurn(); scope.run(0.001, 3);
assert.equal(scope.cues.length, 0, "a new turn cannot inherit earlier acoustic evidence");
console.log("Listening opportunities: live pause evidence, clock separation, cancellation, dose and invalid data PASS");
