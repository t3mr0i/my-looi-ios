import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tail = deferred();
const calls = [], players = [];
const diagnostics = [];
let reads = 0, starts = 0, cancelled = 0;
const response = { ok: true, status: 200, headers: { get: () => null },
  body: { getReader: () => ({
    async read() {
      reads++;
      if (reads === 1) return { done: false, value: new Uint8Array([1, 2, 3, 4]) };
      await tail.promise;
      return { done: true };
    },
    async cancel() { cancelled++; tail.resolve(); }, releaseLock() {},
  }) },
};
const fetcher = async (_url, options) => { calls.push(options); return response; };
const runtime = {
  fetcher,
  createPlayer(callbacks) {
    const player = { writes: [], finished: false, stopped: false,
      write(bytes) { this.writes.push([...bytes]); }, queuedDurationMs: () => 0,
      finish() { this.finished = true; }, stop() { this.stopped = true; },
      render() { callbacks.onStart({ outputLatencyMs: 30, ioBufferDurationMs: 10 }); }, drain() { callbacks.onComplete(); },
    };
    players.push(player); return player;
  },
};
const load = createTypeScriptTreeLoader({
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (...args) => diagnostics.push(args) },
  "./openai-api-key": { getOpenAiApiKey: async () => "offline-key", MissingOpenAiApiKeyError: class extends Error {} },
  "./openai-speech-stream": { getCloudSpeechStreamRuntime: () => runtime },
  "expo-audio": { setAudioModeAsync: async () => {}, setIsAudioActiveAsync: async () => {},
    createAudioPlayer() { throw new Error("Stream must not wait for a buffered WAV player"); } },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = fetcher;
const api = load("src/openai/openai-speech.ts");
const controller = new AbortController();
const result = api.speakOpenAiText("Hallo LOOI", { voiceId: "shimmer", streaming: true, signal: controller.signal, onStart: () => starts++ });
// Attach a rejection handler immediately because cancellation can settle before
// the assertion's cleanup continuation is reached.
const settled = result.then(() => ({ ok: true }), (error) => ({ error }));
try {
  for (let i = 0; i < 20 && !players[0]?.writes.length; i++) await tick();
  assert.equal(players[0]?.writes.length, 1, "first PCM chunk must reach the player while the network tail is still pending");
  assert.equal(JSON.parse(calls[0].body).response_format, "pcm");
  assert.equal(starts, 0, "receiving audio is not audible playback");
  players[0].render();
  assert.equal(starts, 1, "only the player's render callback starts the spoken section");
  assert.equal(diagnostics[0][1], "budget-speech-stream-latency");
  assert.equal(diagnostics[0][2].downloadCompleteAtRender, false, "device telemetry can distinguish rendering before EOF");
  assert.equal(diagnostics[0][2].outputLatencyMs, 30);
  assert.equal(diagnostics[0][2].ioBufferDurationMs, 10, "native route durations remain separate from JS clock differences");
  assert.equal(players[0].finished, false, "network tail is still pending");
  tail.resolve();
  for (let i = 0; i < 20 && !players[0].finished; i++) await tick();
  assert.equal(players[0].finished, true);
  let completed = false; result.then(() => { completed = true; });
  await tick(); assert.equal(completed, false, "EOF does not finish the utterance before the native player drains");
  players[0].drain();
  assert.equal((await settled).ok, true);
  assert.equal(players[0].stopped, true, "output engine is released before the caller resumes capture");
} finally {
  controller.abort(); tail.resolve(); await settled;
  await api.stopOpenAiSpeech(); globalThis.fetch = originalFetch;
}
console.log("Budget cloud PCM stream: first chunk before EOF, render ownership and drain cleanup passed");

function makeHarness(chunks, options = {}) {
  const h = { players: [], requests: [], reads: 0, cancellations: 0, pending: deferred(), clock: options.clock };
  const reader = {
    async read() {
      h.reads++;
      if (chunks.length) return { done: false, value: chunks.shift() };
      if (options.stall) await h.pending.promise;
      return { done: true };
    },
    async cancel() { h.cancellations++; h.pending.resolve(); }, releaseLock() {},
  };
  const runtime = {
    fetcher: async (_url, request) => {
      h.requests.push(request);
      return { ok: true, status: 200, headers: { get: () => options.contentLength ?? null }, body: { getReader: () => reader } };
    },
    async createPlayer(callbacks) {
      const player = { callbacks, writes: [], finishCount: 0, stopCount: 0, queuedMs: options.queuedMs ?? 0,
        write(bytes) { if (options.writeError) throw new Error("Mock native enqueue failed"); this.writes.push([...bytes]); },
        queuedDurationMs() { return this.queuedMs; },
        finish() { this.finishCount++; }, async stop() { this.stopCount++; if (options.stopPending) await options.stopPending.promise; },
      };
      h.players.push(player);
      if (options.preparePending) await options.preparePending.promise;
      return player;
    },
  };
  const load = createTypeScriptTreeLoader({
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "./openai-api-key": { getOpenAiApiKey: async () => "offline-key", MissingOpenAiApiKeyError: class extends Error {} },
    "./openai-speech-stream": { getCloudSpeechStreamRuntime: () => runtime },
    "expo-audio": { createAudioPlayer() { assert.fail("PCM stream cannot use a buffered player"); } },
  }, options.clock?.globals());
  h.api = load("src/openai/openai-speech.ts");
  h.controller = new AbortController();
  h.promise = h.api.speakOpenAiText("Nur synthetischer Testtext", { voiceId: "shimmer", streaming: true, signal: h.controller.signal });
  h.settled = h.promise.then(() => ({ ok: true }), (error) => ({ error }));
  h.until = async (predicate) => {
    for (let i = 0; i < 50 && !predicate(); i++) await tick();
    assert.ok(predicate(), "expected stream lifecycle event");
  };
  h.cleanup = async () => { h.controller.abort(); h.pending.resolve(); await h.settled; await h.api.stopOpenAiSpeech(); };
  return h;
}

{
  const h = makeHarness([new Uint8Array([1]), new Uint8Array([2, 3, 4, 5]), new Uint8Array([6])]);
  try {
    await h.until(() => h.players[0]?.finishCount);
    assert.deepEqual(h.players[0].writes.flat(), [1, 2, 3, 4, 5, 6], "odd network chunk boundaries preserve complete PCM samples in order");
    assert.ok(h.players[0].writes.every((bytes) => bytes.length % 2 === 0));
    h.players[0].callbacks.onComplete(); await h.settled;
  } finally { await h.cleanup(); }
}
{
  const h = makeHarness([new Uint8Array([1, 2, 3])]);
  try {
    assert.match((await h.settled).error.message, /incomplete PCM sample/);
    await h.until(() => h.players[0]?.stopCount);
    assert.equal(h.players[0].finishCount, 0, "truncated sample cannot mark speech complete");
  } finally { await h.cleanup(); }
}
for (const options of [{ contentLength: String(4 * 1024 * 1024 + 1) }, {}]) {
  const h = makeHarness([new Uint8Array(4 * 1024 * 1024 + 2)], options);
  try {
    assert.match((await h.settled).error.message, /4 MB limit/);
    assert.equal(h.players.length, 0, "oversize audio never enters the native playback queue");
    assert.equal(h.requests[0].signal.aborted, true);
    if (!options.contentLength) assert.ok(h.cancellations > 0, "oversize stream cancels its reader");
  } finally { await h.cleanup(); }
}
{
  const h = makeHarness([new Uint8Array([1, 2])], { stall: true });
  try {
    await h.until(() => h.players[0]?.writes.length);
    h.controller.abort();
    assert.equal((await h.settled).error.name, "AbortError");
    await h.until(() => h.players[0].stopCount);
    assert.ok(h.cancellations > 0, "cancellation reaches a stalled streaming body");
    h.players[0].callbacks.onStart(); h.players[0].callbacks.onComplete();
    assert.equal((await h.settled).error.name, "AbortError", "late render/drain callbacks cannot revive cancelled speech");
  } finally { await h.cleanup(); }
}
{
  const h = makeHarness([new Uint8Array([1, 2])], { stall: true });
  try {
    await h.until(() => h.players[0]?.writes.length);
    h.players[0].callbacks.onError(new Error("Mock speaker route lost"));
    assert.match((await h.settled).error.message, /speaker route lost/);
    await h.until(() => h.players[0].stopCount);
    assert.equal(h.requests[0].signal.aborted, true);
  } finally { await h.cleanup(); }
}
{
  const h = makeHarness([new Uint8Array([1, 2])], { writeError: true });
  try {
    assert.match((await h.settled).error.message, /native enqueue failed/);
    await h.until(() => h.players[0]?.stopCount);
  } finally { await h.cleanup(); }
}
{
  const clock = new VirtualClock();
  const h = makeHarness([new Uint8Array([1, 2])], { clock, stall: true });
  try {
    await h.until(() => h.players[0]?.writes.length);
    await clock.advanceTo(clock.now + 20_000);
    assert.match((await h.settled).error.message, /request timed out/);
    await h.until(() => h.players[0].stopCount);
    assert.ok(h.cancellations > 0);
  } finally { await h.cleanup(); }
}
{
  const clock = new VirtualClock();
  const h = makeHarness([new Uint8Array([1, 2]), new Uint8Array([3, 4])], { clock, queuedMs: 3000 });
  try {
    await h.until(() => h.players[0]?.writes.length);
    assert.equal(h.reads, 1, "backpressure stops reading when the player has more than two seconds queued");
    await clock.advanceTo(clock.now + 40);
    assert.equal(h.reads, 1);
    h.players[0].queuedMs = 0;
    await clock.advanceTo(clock.now + 20);
    await h.until(() => h.players[0].finishCount);
    assert.deepEqual(h.players[0].writes.flat(), [1, 2, 3, 4]);
    h.players[0].callbacks.onComplete(); await h.settled;
  } finally { await h.cleanup(); }
}

// Exercise the actual iOS adapter's generation filtering and capability gate.
{
  const preparePending = deferred();
  const h = makeHarness([new Uint8Array([1, 2])], { preparePending });
  try {
    await h.until(() => h.players.length);
    h.controller.abort();
    assert.equal((await h.settled).error.name, "AbortError");
    let stopped = false;
    const stopping = h.api.stopOpenAiSpeech().then(() => { stopped = true; });
    await tick(); assert.equal(stopped, false, "stop awaits a native output start already in progress");
    preparePending.resolve(); await stopping;
    assert.equal(h.players[0].writes.length, 0, "cancelled asynchronous output initialization cannot enqueue audio");
    assert.equal(h.players[0].stopCount, 1);
  } finally { preparePending.resolve(); await h.cleanup(); }
}
{
  const stopPending = deferred();
  const h = makeHarness([new Uint8Array([1, 2])], { stopPending });
  try {
    await h.until(() => h.players[0]?.finishCount);
    let completed = false; h.promise.then(() => { completed = true; });
    h.players[0].callbacks.onComplete(); await tick();
    assert.equal(completed, false, "capture cannot resume while the output engine is still releasing its route");
    stopPending.resolve(); assert.equal((await h.settled).ok, true);
  } finally { stopPending.resolve(); await h.cleanup(); }
}

// Exercise the actual iOS adapter's generation filtering and capability gate.
{
  const platform = { OS: "ios" }, nativeListeners = new Map(), nativeCalls = [];
  let generation = 0;
  const native = {
    beginOutputPlayback: () => ++generation,
    stopOutputPlayback: (owner) => nativeCalls.push(["stop", owner]),
    enqueuePlayback: (data) => nativeCalls.push(["write", [...Buffer.from(data, "base64")]]),
    finishPlayback: () => nativeCalls.push(["finish"]), getPlayedDurationMs: () => 0,
    startCapture() { assert.fail("Cloud speech must not start microphone capture"); },
    addListener(name, listener) {
      if (!nativeListeners.has(name)) nativeListeners.set(name, new Set());
      nativeListeners.get(name).add(listener);
      return { remove: () => nativeListeners.get(name).delete(listener) };
    },
  };
  const load = createTypeScriptTreeLoader({ "react-native": { Platform: platform }, "expo/fetch": { fetch() {} },
    "../../modules/local-realtime-audio-capture/realtime-pcm": { getRealtimePcmAudioModule: () => native } });
  const adapter = load("src/openai/openai-speech-stream.ts");
  const runtime = adapter.getCloudSpeechStreamRuntime();
  let starts = 0, ends = 0, errors = 0;
  const first = await runtime.createPlayer({ onStart: () => starts++, onComplete: () => ends++, onError: () => errors++ });
  const emit = (name, event) => { for (const callback of nativeListeners.get(name) ?? []) callback(event); };
  emit("onPlaybackStarted", { generation: 99 }); emit("onPlaybackDrained", {});
  assert.equal(starts + ends, 0, "unmatched or unversioned native callbacks cannot claim speech");
  emit("onPlaybackStarted", { generation: 1 }); assert.equal(starts, 1);
  first.write(new Uint8Array([1, 2])); assert.deepEqual(nativeCalls.at(-1), ["write", [1, 2]]);
  await first.stop(); await first.stop(); assert.deepEqual(nativeCalls.at(-1), ["stop", 1]);
  const second = await runtime.createPlayer({ onStart: () => starts++, onComplete: () => ends++, onError: () => errors++ });
  emit("onPlaybackDrained", { generation: 1 }); emit("onPlaybackError", { generation: 1 });
  assert.equal(ends + errors, 0, "previous playback cannot finish or fail its replacement");
  emit("onPlaybackDrained", { generation: 2 }); assert.equal(ends, 1);
  await second.stop();
  platform.OS = "android"; assert.equal(adapter.getCloudSpeechStreamRuntime(), null);
  platform.OS = "ios"; delete native.beginOutputPlayback;
  assert.equal(adapter.getCloudSpeechStreamRuntime(), null, "older iOS native builds retain buffered playback");
}
console.log("Budget cloud PCM stream lifecycle: chunk alignment, limits, cancellation, failures, backpressure and native generation isolation passed");
