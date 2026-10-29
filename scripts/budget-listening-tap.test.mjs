import assert from "node:assert/strict";
import { createHarness } from "./budget-conversation-runtime.test.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";

const clock = new VirtualClock();
const h = createHarness({ globals: clock.globals() });
await h.service.start();
try {
  let releaseVad;
  h.vadHandler = () => new Promise(resolve => { releaseVad = resolve; });
  h.feeder.emit(new Array(1600).fill(0.02));
  await clock.flush();
  assert.equal(h.conversation.isUserSpeaking, false, "the newest VAD result is still pending");
  const listener = [...h.sampleListeners][0];
  await h.service.interruptAndListen("tap");
  assert.equal(h.captureStopCalls, 0, "tapping healthy listening must not create an input blackout");
  assert.equal(h.captureStartCalls, 1, "retain the already running recorder");
  assert.equal([...h.sampleListeners][0], listener, "retain queued input and its subscriber");
  assert.ok(h.motionStops.includes("budget-tap"), "the tap still stops robot motion");
  releaseVad({ isSpeechDetected: true }); await clock.flush();
  assert.equal(h.conversation.isUserSpeaking, true, "late VAD keeps the speech prefix across a quiet tap");
} finally { await h.service.stop("test-cleanup"); }

const idleClock = new VirtualClock();
const idle = createHarness({ globals: idleClock.globals() });
await idle.service.start();
try {
  await idleClock.advanceTo(idleClock.now + 29_000);
  idle.feeder.emit(new Array(1600).fill(0.0001)); await idleClock.flush();
  await idle.service.interruptAndListen("tap");
  assert.equal(idle.captureStopCalls, 0);
  await idleClock.advanceTo(idleClock.now + 1000);
  assert.equal(idle.service.isActive, true, "a quiet tap renews the idle timeout without restarting capture");
  await idleClock.advanceTo(idleClock.now + 29_000);
  assert.equal(idle.service.isActive, false, "the renewed timeout still releases an idle conversation");
} finally { await idle.service.stop("test-cleanup"); }

const stale = createHarness();
await stale.service.start();
try {
  stale.pcmFlowing = false;
  await stale.service.interruptAndListen("tap");
  assert.equal(stale.captureStopCalls, 1, "a stale or missing PCM stream retains the existing repair path");
  assert.equal(stale.captureStartCalls, 2);
} finally { await stale.service.stop("test-cleanup"); }

const spoken = createHarness();
await spoken.service.start();
try {
  spoken.vadSequence = [true];
  spoken.sttHandler = () => new Promise(() => {});
  spoken.feeder.emit();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(spoken.conversation.isUserSpeaking, true);
  await spoken.service.interruptAndListen("tap");
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(spoken.sttCalls.length, 1, "a tap after confirmed speech still finishes the contribution");
  assert.equal(spoken.captureStartCalls, 1);
} finally { await spoken.service.stop("test-cleanup"); }

console.log("Budget listening tap: continuous healthy input, pending VAD, renewed timeout, stale repair and explicit finish PASS");
