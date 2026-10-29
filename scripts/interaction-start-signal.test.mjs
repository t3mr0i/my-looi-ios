import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
const { createInteractionStartSignalDetector } = loadTypeScript("src/core/interaction-start-signal.ts");
let time = 0;
let native = 0;
const detector = createInteractionStartSignalDetector(() => time);
const palm = { kind: "open_palm", confidence: 0.95, handCount: 1 };
function feed(signal, ms = 120) { time += ms; native += 120; return detector.frame({ timestampMs: native, interactionSignal: signal, interactionHandCount: signal === null ? 0 : signal.handCount }); }
function release() { for (let i = 0; i < 3; i++) assert.equal(feed(null), false); }
detector.arm("one");
for (let i = 0; i < 12; i++) assert.equal(feed(palm), false, "an already visible palm cannot trigger after arming");
release();
for (let i = 0; i < 5; i++) assert.equal(feed(palm), false);
assert.equal(feed(palm), true, "a fresh stable hold triggers once after release");
assert.equal(feed(palm), false);
release(); assert.equal(feed(palm, 700), false, "the same token is consumed");
detector.arm("two"); release();
assert.equal(feed(palm), false); assert.equal(feed(palm), false);
assert.equal(feed(null), false, "a broken hold must restart");
for (let i = 0; i < 5; i++) assert.equal(feed(palm), false);
assert.equal(feed(palm), true);
detector.arm("three"); release();
assert.equal(feed({ ...palm, handCount: 2 }), false);
for (let i = 0; i < 10; i++) assert.equal(feed(palm), false, "multiple hands revoke release eligibility");
release(); assert.equal(feed({ ...palm, confidence: 0.5 }), false);
for (let i = 0; i < 10; i++) assert.equal(feed(palm), false);
detector.arm("four"); release();
assert.equal(feed(palm), false); assert.equal(feed(palm), false);
assert.equal(detector.frame({ timestampMs: native, interactionSignal: palm }), false, "duplicate native timestamps cannot add evidence");
assert.equal(feed(palm, 1_000), false, "a gap invalidates the release and hold");
for (let i = 0; i < 10; i++) assert.equal(feed(palm), false);
detector.reset(); release();
for (let i = 0; i < 10; i++) assert.equal(feed(palm), false, "suspension cannot accumulate an unarmed start");
detector.arm("legacy");
for (let i = 0; i < 10; i++) { time += 120; assert.equal(detector.frame({ timestampMs: ++native }), false); }
for (let i = 0; i < 10; i++) assert.equal(feed(palm), false, "legacy frames do not count as a release");
console.log("Agreed start gesture: fresh release, stable single hand, clock separation, gaps, duplicates, one-shot and reset PASS");
