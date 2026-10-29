import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { createHarness } from "./budget-conversation-runtime.test.mjs";
import { createRealtimeHarness } from "./realtime-turn-taking-runtime.test.mjs";

const require = createRequire(import.meta.url);
let now = 1000;
const load = createTypeScriptTreeLoader({
  zustand: require("zustand"),
  "../memory/memory-service": { mirrorSessionMessage() { throw new Error("attention must not write memories"); } },
}, { performance: { now: () => now } });
const { InputAttentionDetector, isInputAttentionVisible } = load("src/voice/input-attention.ts");
const { useConversationStore } = load("src/store/conversation.ts");
const { resolveFacePresentation } = load("src/character/face-expression.ts");
const frame = (receivedAtMs, extra = {}) => ({ receivedAtMs, durationMs: 20, rms: 0.004, peak: 0.012, ...extra });

const detector = new InputAttentionDetector();
assert.equal(detector.accept(frame(1000)), false, "one short block is insufficient");
assert.equal(detector.accept(frame(1020)), true, "40ms of input may request a neutral cue before VAD");
assert.equal(detector.accept(frame(1040)), false, "one cue per listening turn");
detector.reset();
assert.equal(detector.accept(frame(2000, { rms: 0.0003 })), false, "quiet baseline does not trigger");
assert.equal(detector.accept(frame(2020, { rms: 0.004, peak: 0.4 })), false, "isolated impulse rejected");
assert.equal(detector.accept(frame(2040)), false);
assert.equal(detector.accept(frame(2040)), false, "batched callback breaks continuity");
assert.equal(detector.accept(frame(2060)), false);
assert.equal(detector.accept(frame(2080)), true);
for (const extra of [{ durationMs: 1000 }, { rms: NaN }, { peak: Infinity }, { receivedAtMs: NaN }, { deliveryAgeMs: 101 }, { deliveryAgeMs: -5 }]) {
  detector.reset();
  assert.equal(detector.accept(frame(3000, extra)), false, "invalid, old or oversized input ignored");
}
detector.reset();
assert.equal(detector.accept(frame(4000, { durationMs: 100 })), true, "Budget block can request without waiting for native VAD");
detector.reset();
assert.equal(detector.accept(frame(5000)), false);
assert.equal(detector.accept(frame(5500)), false, "gap is not continuous audio");
assert.equal(detector.accept(frame(5520)), false);
assert.equal(detector.accept(frame(5540)), true);
detector.reset();
assert.equal(detector.accept(frame(6000, { sequence: 5 })), false);
assert.equal(detector.accept(frame(6020, { sequence: 4 })), false, "out-of-order native block breaks continuity");
assert.equal(detector.accept(frame(6040, { sequence: 6 })), false);
assert.equal(detector.accept(frame(6060, { sequence: 7 })), true);

const store = () => useConversationStore.getState();
store().setActiveSession("test");
assert.equal(store().requestInputAttention("test", now), null, "unready capture cannot show attention");
store().setListening(true); store().setRealtimeReadiness("ready");
const before = { messages: store().messages, isUserSpeaking: store().isUserSpeaking, isListening: store().isListening };
const id = store().requestInputAttention("test", now);
assert.ok(id);
assert.deepEqual({ messages: store().messages, isUserSpeaking: store().isUserSpeaking, isListening: store().isListening }, before,
  "cue cannot claim human speech, change listening or write a message");
assert.equal(store().requestInputAttention("old-session", now), null);
assert.equal(isInputAttentionVisible(store().inputAttention, "test", now), true);
assert.equal(isInputAttentionVisible(store().inputAttention, "test", now + 421), false);
assert.equal(isInputAttentionVisible(store().inputAttention, "other", now), false);
assert.equal(isInputAttentionVisible(store().inputAttention, "test", now - 1), false);
store().clearInputAttention("old-id");
assert.equal(store().inputAttention.id, id, "stale timer cannot clear newer cue");
store().setProcessing(true);
assert.equal(store().inputAttention, null, "processing discards attention");
store().setProcessing(false);
assert.equal(store().requestInputAttention("test", now), null, "cooldown survives suppression");
for (const interrupt of [() => store().setSpeaking(true), () => store().setListening(false), () => store().setRealtimeReadiness("connecting"), () => store().setActiveSession("new")]) {
  now += 1100;
  store().setActiveSession("test"); store().setSpeaking(false); store().setListening(true); store().setRealtimeReadiness("ready");
  assert.ok(store().requestInputAttention("test", now));
  interrupt(); assert.equal(store().inputAttention, null, "state ownership discards old cue");
}

const base = { robotSleeping: false, voiceState: "listening", streamingText: "", characterMood: null, behaviorMood: null, inputAttention: true };
assert.equal(resolveFacePresentation(base).source, "input");
for (const [extra, source] of [
  [{ robotSleeping: true }, "sleep"], [{ assistantSpeaking: true }, "speech"],
  [{ voiceState: "processing" }, "pipeline"], [{ voiceState: "verifying" }, "pipeline"],
  [{ feedbackMood: "repairing" }, "behavior"], [{ characterMood: "happy" }, "reaction"],
  [{ behaviorMood: "expectant" }, "behavior"], [{ voiceState: "sleeping" }, "ready"],
]) assert.equal(resolveFacePresentation({ ...base, ...extra }).source, source);
assert.equal(resolveFacePresentation({ ...base, inputAttention: false }).source, "voice");

// Exercise the production services against the real store, with only native/network
// boundaries mocked. A never-resolved VAD must not hold the presentation request.
now = 20_000;
store().clearSession();
const budget = createHarness({ globals: { performance: { now: () => now } } });
budget.dependencies["../store/conversation"].useConversationStore.getState = store;
let releaseVad;
budget.vadHandler = () => new Promise((resolve) => { releaseVad = resolve; });
await budget.service.start();
try {
  budget.feeder.emit(new Array(1600).fill(0.004), 16_000);
  assert.ok(store().inputAttention, "Budget requests attention synchronously on input receipt");
  assert.equal(budget.vadCalls.length, 0, "input cue precedes even the queued VAD call");
  assert.equal(store().isUserSpeaking, false);
  assert.equal(store().messages.length, 0);
  await Promise.resolve();
  await budget.service.stop("test-stop");
  assert.equal(store().inputAttention, null);
  releaseVad({ isSpeechDetected: true });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  assert.equal(store().inputAttention, null, "late VAD cannot restore stopped attention");
} finally { await budget.service.stop("test-cleanup"); }

now = 30_000;
store().clearSession(); store().setActiveSession("pcm-test");
store().setListening(true); store().setRealtimeReadiness("ready");
const pcm = createRealtimeHarness({ performance: { now: () => now } });
pcm.deps["../store/conversation"].useConversationStore.getState = store;
pcm.fakeAudio.getMonotonicTimeMs = () => 1_000_000 + now;
const service = new pcm.RealtimePcmConversationService();
Object.assign(service, { active: true, configured: true, sessionId: "pcm-test" });
service.send = () => true;
const bytes = Buffer.alloc(640);
for (let i = 0; i < 320; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 5) * 128), i * 2);
function emitPcm(ageMs = 0) {
  service.handleCapturedAudio({ pcm16Base64: bytes.toString("base64"), sampleRate: 16_000, frames: 320, rms: 0.003,
    sequence: now, timestampMs: 1_000_000 + now - ageMs,
    captureStartMs: 1_000_000 + now - ageMs - 20, captureDurationMs: 20 });
}
emitPcm(); assert.equal(store().inputAttention, null);
now += 20; emitPcm();
assert.ok(store().inputAttention, "PCM notices input before a server speech-start event");
assert.equal(store().isUserSpeaking, false, "local attention cannot impersonate server VAD");
await service.handleEvent({ type: "input_audio_buffer.speech_stopped" });
assert.equal(store().inputAttention, null);
store().setProcessing(false); store().setListening(true);
now += 1100; emitPcm(120); now += 20; emitPcm(120);
assert.equal(store().inputAttention, null, "native capture age rejects delayed input");
now += 20; emitPcm(); now += 20; emitPcm();
assert.ok(store().inputAttention, "fresh next-turn input rearms the cue");
store().setSpeaking(true);
assert.equal(store().inputAttention, null);
now += 1100; emitPcm(); now += 20; emitPcm();
assert.equal(store().inputAttention, null, "assistant playback owns the face");
console.log("PASS input attention: early input, freshness, impulse rejection, isolated presentation, expiry and priority");
