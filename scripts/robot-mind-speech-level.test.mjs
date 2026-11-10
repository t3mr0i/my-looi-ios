import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const api = loadTypeScript("src/robot-mind/speech-level.ts");

// --- Levels from PCM and WAV -------------------------------------------------
function pcm(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), true));
  return bytes;
}
const tone = (ms, amplitude, rate = 24_000) => Array.from({ length: Math.round(rate * ms / 1000) }, (_, i) => amplitude * Math.sin(i * 2 * Math.PI * 220 / rate));
{
  const levels = api.pcm16Levels(pcm([...tone(120, 0.4), ...tone(120, 0), ...tone(120, 0.012)]), 24_000);
  assert.equal(levels.length, 9, "one level per 40 ms");
  assert.ok(levels.slice(0, 3).every((level) => level > 0.9), "loud speech opens the mouth fully");
  assert.deepEqual(levels.slice(3, 6), [0, 0, 0], "silence closes it");
  assert.ok(levels.slice(6).every((level) => level > 0.2 && level < 0.6), "quiet speech opens it a little");
  assert.deepEqual(api.pcm16Levels(new Uint8Array(0), 24_000), []);
  assert.ok(api.pcm16Levels(pcm(tone(40, 0.005)), 24_000).every((level) => level === 0), "below the pause level (-45 dBFS) the mouth stays closed");
  // The mapping is Reachy Mini's speech tapper: 0 at the pause level, rising to 1 at -18 dBFS with +4 dB sensitivity.
  assert.equal(api.speechLevelFromDb(-45), 0);
  assert.ok(api.speechLevelFromDb(-35) > 0.5 && api.speechLevelFromDb(-35) < 0.65);
  assert.equal(api.speechLevelFromDb(-22), 1);
  assert.equal(api.speechLevelFromDb(0), 1);
  assert.equal(api.speechLevelFromDb(-Infinity), 0);
}
function wav(data, { rate = 24_000, channels = 1, bits = 16, dataLength = data.length, extraChunk = false } = {}) {
  const extra = extraChunk ? 12 : 0;
  const bytes = new Uint8Array(44 + extra + data.length);
  const view = new DataView(bytes.buffer);
  const tag = (offset, text) => [...text].forEach((char, i) => { bytes[offset + i] = char.charCodeAt(0); });
  tag(0, "RIFF"); view.setUint32(4, 36 + extra + data.length, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * bits / 8, true); view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
  let offset = 36;
  if (extraChunk) { tag(offset, "LIST"); view.setUint32(offset + 4, 4, true); offset += 12; }
  tag(offset, "data"); view.setUint32(offset + 4, dataLength, true);
  bytes.set(data, offset + 8);
  return bytes;
}
{
  const data = pcm(tone(200, 0.3, 16_000));
  const parsed = api.readWavPcm16(wav(data, { rate: 16_000 }));
  assert.deepEqual([parsed.sampleRate, parsed.data.length], [16_000, data.length]);
  assert.equal(api.readWavPcm16(wav(data, { extraChunk: true })).data.length, data.length, "other chunks before the audio are skipped");
  assert.equal(api.readWavPcm16(wav(data, { dataLength: 0xffffffff })).data.length, data.length, "a streamed header with unknown length reads to the end");
  assert.equal(api.readWavPcm16(wav(data, { channels: 2 })), null);
  assert.equal(api.readWavPcm16(wav(data, { bits: 8 })), null);
  assert.equal(api.readWavPcm16(Uint8Array.from([1, 2, 3])), null);
  assert.equal(api.readWavPcm16(new Uint8Array(64)), null);
}

// --- Timeline ----------------------------------------------------------------
function makeTrack() {
  let now = 10_000, tick = null;
  const track = api.createSpeechLevelTrack({ now: () => now, setTimer: (callback) => { tick = callback; return 1; }, clearTimer: () => { tick = null; } });
  const seen = [];
  track.subscribe((level, live) => seen.push([Math.round(level * 100) / 100, live]));
  return { track, seen, advance(ms) { for (const end = now + ms; now < end;) { now += 50; tick?.(); } }, get ticking() { return tick !== null; }, get now() { return now; } };
}
{
  const h = makeTrack();
  assert.equal(h.track.isLive(), false);
  h.track.appendPcm16(pcm(tone(400, 0.4)), 24_000);
  // Audio that arrives faster than it plays is placed right after what is already queued.
  h.track.appendPcm16(pcm(tone(400, 0)), 24_000);
  h.track.appendPcm16(pcm(tone(400, 0.4)), 24_000);
  assert.ok(h.track.levelAt(h.now + 100) > 0.9);
  assert.equal(h.track.levelAt(h.now + 600), 0);
  assert.ok(h.track.levelAt(h.now + 1_000) > 0.9);
  assert.equal(h.track.levelAt(h.now + 1_300), null, "nothing is known beyond the queued audio");
  h.advance(350);
  assert.ok(h.track.isLive());
  assert.ok(h.seen.at(-1)[0] > 0.9 && h.seen.at(-1)[1] === true);
  h.advance(400);
  assert.ok(h.seen.at(-1)[0] < 0.2, "the mouth closes in the pause");
  h.advance(300);
  assert.ok(h.seen.at(-1)[0] > 0.9, "and opens again with the next phrase");
  h.advance(700);
  assert.deepEqual(h.seen.at(-1), [0, false], "after the audio ends the level is no longer live");
  assert.equal(h.ticking, false, "and the timer stops");
  // A later reply starts a new timeline at the moment it is queued.
  h.track.appendPcm16(pcm(tone(200, 0.4)), 24_000);
  assert.ok(h.track.levelAt(h.now + 50) > 0.9);
  h.advance(100);
  h.track.reset();
  assert.deepEqual(h.seen.at(-1), [0, false], "an interruption closes the mouth at once");
  assert.equal(h.track.levelAt(h.now), null);
}
{
  // Movement is timed to when the audio is heard: the route's output latency shifts the timeline.
  const h = makeTrack();
  h.track.setPlaybackDelayMs(120);
  h.track.appendPcm16(pcm(tone(200, 0.4)), 24_000);
  assert.equal(h.track.levelAt(h.now + 60), null, "nothing is heard yet while the audio is still in the output buffer");
  assert.ok(h.track.levelAt(h.now + 160) > 0.9);
  // A latency reported after playback began moves the running timeline, once.
  const late = makeTrack();
  late.track.appendPcm16(pcm(tone(200, 0.4)), 24_000);
  assert.ok(late.track.levelAt(late.now + 20) > 0.9);
  late.track.setPlaybackDelayMs(80);
  assert.equal(late.track.levelAt(late.now + 20), null);
  assert.ok(late.track.levelAt(late.now + 100) > 0.9);
  late.track.setPlaybackDelayMs(80);
  assert.ok(late.track.levelAt(late.now + 100) > 0.9, "the same latency is not applied twice");
  late.track.setPlaybackDelayMs(Number.NaN); late.track.setPlaybackDelayMs(9_999);
  assert.ok(late.track.levelAt(late.now + 520) > 0.9, "an implausible latency is capped at half a second");
}
{
  // The hooks never throw into the audio path.
  api.noteSpeechOutputLatency(null); api.noteSpeechOutputLatency({ outputLatencyMs: "x" });
  api.noteSpeechPcm16Base64("%%% not base64 %%%", 24_000);
  api.noteSpeechWav(Uint8Array.from([1, 2]));
  api.noteSpeechPcm16(new Uint8Array(0), 24_000);
  api.speechLevel.reset();
}

// --- Phrase starts and head movement ------------------------------------------
{
  const onsets = api.createSpeechOnsetDetector();
  const feed = (levels, from) => levels.map((level, i) => onsets.feed(level, from + i * 50));
  assert.deepEqual(feed([0.8, 0.9, 0.7, 0.5, 0.8], 0), [true, false, false, false, false], "one start per phrase, not per syllable");
  assert.deepEqual(feed([0.05, 0.9], 250), [false, false], "a gap of one frame is not a pause");
  assert.deepEqual(feed([0, 0, 0, 0, 0, 0, 0.3, 0.9], 400), [false, false, false, false, false, false, false, true], "after a real pause the next rise is a phrase start");
}
{
  let now = 0;
  const wobble = api.createSpeechWobble(() => now);
  assert.equal(wobble.onPhraseStart(false), false, "no head movement outside a reply");
  wobble.replyStarted();
  assert.equal(wobble.onPhraseStart(false), false, "the opening belongs to the expression gesture");
  assert.equal(wobble.ownsReplyReaction(), false);
  now = 1_000; assert.equal(wobble.onPhraseStart(false), true);
  assert.equal(wobble.ownsReplyReaction(), true);
  now = 2_000; assert.equal(wobble.onPhraseStart(false), false, "not at every phrase");
  now = 4_000; assert.equal(wobble.onPhraseStart(true), false, "serious or sad delivery keeps the head still");
  let moved = 1;
  for (now = 5_000; now < 60_000; now += 3_000) if (wobble.onPhraseStart(false)) moved += 1;
  assert.equal(moved, api.SPEECH_WOBBLE_MAX_PER_REPLY, "bounded per reply");
  wobble.replyEnded();
  assert.equal(wobble.ownsReplyReaction(), true, "the reply's reaction stays claimed for the Decisions window");
  now += api.SPEECH_WOBBLE_CLAIM_MS + 1;
  assert.equal(wobble.ownsReplyReaction(), false);
  wobble.replyStarted(); now += 1_000; wobble.onPhraseStart(false); wobble.interrupted();
  assert.equal(wobble.ownsReplyReaction(), false, "an interrupted reply claims nothing");
  wobble.replyStarted(); wobble.replyEnded();
  assert.equal(wobble.ownsReplyReaction(), false, "a reply without head movement claims nothing");
}

// --- Decisions: no second request for a reply that was already expressed -------
{
  const policy = loadTypeScript("src/behavior/behavior-policy.ts");
  const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
    "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
    "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
  });
  const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
  function makeEngine(owned) {
    let now = 1_000; const timers = new Map(); let id = 0;
    const engineModule = loadTypeScript("src/behavior/behavior-engine.ts", { "./behavior-policy": policy, "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts") }, {
      setTimeout: (callback, delay) => { timers.set(++id, { at: now + (Number(delay) || 0), callback }); return id; },
      clearTimeout: (handle) => timers.delete(handle),
    });
    const calls = [];
    const engine = engineModule.createBehaviorEngine({
      now: () => now, wallNow: () => Date.UTC(2026, 0, 1) + now, decisionTimeoutMs: 5_000,
      decide: (request) => { const item = { request, deferred: deferred() }; calls.push(item); return item.deferred.promise; },
      executeCue() {},
      ...(owned === undefined ? {} : { reactionOwnedLocally: owned }),
    });
    engine.configure({ mode: "active", dailyBudgetUsd: 1, candidateScoring: true, visualEnabled: false });
    engine.setEnvironment({ foreground: true, focused: true, sleeping: false, connected: true, ambientEnabled: true, cameraEnabled: true, userSpeaking: false, assistantSpeaking: false, motionActive: false });
    engine.dispatch({ type: "session-start", sessionId: "s1" });
    return { engine, calls, async advance(ms) { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); } await flush(); } };
  }
  const resultFor = (request) => ({
    answers: request.questions.map((question) => question.type === "score"
      ? { name: question.name, type: "score", score: 0, confidence: 0.9, probabilities: question.levels.map((level, value) => ({ value, label: level.label, probability: value === 0 ? 1 : 0 })) }
      : { name: question.name, type: "choice", choice: question.choices[0].value, confidence: 0.95, probabilities: question.choices.map((item, i) => ({ value: item.value, probability: i === 0 ? 1 : 0 })) }),
    usage: { inputTokens: 120, cachedTokens: 20, cacheWriteTokens: 5, costUsd: 0.001 }, requestId: "mock-request",
  });
  async function oneTurn(h) {
    h.engine.dispatch({ type: "user-turn", text: "Tell me about the weather", sessionId: "s1" });
    await h.advance(10);
    for (const call of h.calls) call.deferred.resolve(resultFor(call.request));
    await h.advance(2_000);
    h.engine.dispatch({ type: "assistant-start", sessionId: "s1" });
    h.engine.dispatch({ type: "assistant-end", text: "It looks sunny today.", sessionId: "s1" });
    await h.advance(200);
    for (const call of h.calls) call.deferred.resolve(resultFor(call.request));
    await h.advance(2_000);
  }
  const plain = makeEngine(undefined);
  await oneTurn(plain);
  assert.equal(plain.calls.length, 2, "without a local owner a turn asks twice: at the user turn and after the reply");

  let ownerAsked = 0;
  const expressed = makeEngine(() => { ownerAsked += 1; return true; });
  await oneTurn(expressed);
  assert.equal(expressed.calls.length, 1, "a reply that was already expressed is not sent for a second decision");
  assert.equal(ownerAsked, 1);
  assert.ok(expressed.engine.getState().traces.some((trace) => trace.kind === "reaction-owned-locally"));

  const notExpressed = makeEngine(() => false);
  await oneTurn(notExpressed);
  assert.equal(notExpressed.calls.length, 2, "a reply without its own expression keeps the separate reaction");
}

console.log("Robot mind speech level: PCM/WAV levels, timeline, phrase starts, bounded head movement and Decisions skip PASS");
