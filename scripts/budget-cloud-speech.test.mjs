import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

function createHarness(apiKey = "test-api-key-that-is-never-logged") {
  const players = [];
  const audioModes = [];
  const activeCalls = [];
  const load = createTypeScriptTreeLoader({
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "./openai-speech-stream": { getCloudSpeechStreamRuntime: () => null },
    "expo-audio": {
      async setAudioModeAsync(mode) { audioModes.push(mode); },
      async setIsAudioActiveAsync(active) { activeCalls.push(active); },
      createAudioPlayer(source, options) {
        const player = {
          source,
          options,
          callbacks: [],
          removeCount: 0,
          pauseCount: 0,
          playCount: 0,
          addListener(_event, callback) {
            player.callbacks.push(callback);
            let subscribed = true;
            return {
              remove() {
                if (!subscribed) return;
                subscribed = false;
                player.removeListenerCount += 1;
              },
            };
          },
          removeListenerCount: 0,
          play() {
            player.playCount += 1;
            player.emit({ playing: true });
          },
          pause() { player.pauseCount += 1; },
          remove() { player.removeCount += 1; },
          emit(status) {
            for (const callback of [...player.callbacks]) callback(status);
          },
        };
        players.push(player);
        return player;
      },
    },
    "./openai-api-key": {
      async getOpenAiApiKey() { return apiKey; },
      MissingOpenAiApiKeyError: class MissingOpenAiApiKeyError extends Error {},
    },
  });
  return { api: load("src/openai/openai-speech.ts"), players, audioModes, activeCalls };
}

function responseWithBytes(bytes, contentLength = String(bytes.length)) {
  return {
    ok: true,
    status: 200,
    headers: { get(name) { return name.toLowerCase() === "content-length" ? contentLength : null; } },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function withFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); }
  finally { globalThis.fetch = original; }
}

{
  const harness = createHarness();
  const requests = [];
  let starts = 0;
  await withFetch(async (url, options) => {
    requests.push({ url, options });
    return responseWithBytes(Uint8Array.from([1, 2, 3, 4]));
  }, async () => {
    const result = harness.api.speakOpenAiText("Hallo Louis!", {
      streaming: true,
      voiceId: "shimmer",
      styleId: "playful-robot",
      personalityContext: JSON.stringify({ tone: "calm", familiarInterests: ["Gerda"] }),
      speed: 0.85,
      onStart: () => { starts += 1; },
    });
    const callerResumedAfterCleanup = result.then(() => {
      assert.equal(harness.players[0]?.removeCount, 1,
        "speech resolves only after the completed player is released");
    });
    await waitFor(() => harness.players.length === 1, "the cloud speech player");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.openai.com/v1/audio/speech");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-api-key-that-is-never-logged");
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.model, "gpt-4o-mini-tts");
    assert.equal(body.voice, "shimmer");
    assert.equal(body.input, "Hallo Louis!");
    assert.equal(body.speed, 0.85);
    assert.equal(body.response_format, "wav");
    assert.match(body.instructions, /cute|sweet/iu);
    assert.match(body.instructions, /robot/iu);
    assert.match(body.instructions, /prefers a calmer manner/u, "the saved manner also reaches the actual TTS request");
    assert.doesNotMatch(body.instructions, /Gerda/u, "speech rendering receives delivery direction without inventing extra content");
    assert.deepEqual(harness.audioModes, [{
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    }]);
    assert.deepEqual(harness.activeCalls, [true]);
    assert.equal(harness.players[0].playCount, 1);
    assert.equal(harness.players[0].source.uri, "data:audio/wav;base64,AQIDBA==");
    assert.equal(starts, 1, "onStart fires on the first playing status");

    harness.players[0].emit({ playing: false, didJustFinish: true });
    await callerResumedAfterCleanup;
    assert.equal(harness.players[0].removeListenerCount, 1, "playback listeners are cleaned up");
    assert.equal(harness.players[0].removeCount, 1, "the completed audio player is released");
  });
}

{
  const harness = createHarness();
  let requestSignal;
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal;
    options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
  }), async () => {
    const controller = new AbortController();
    const result = harness.api.speakOpenAiText("Abbrechen", { voiceId: "shimmer", signal: controller.signal });
    const rejected = assert.rejects(result, { name: "AbortError" });
    await waitFor(() => requestSignal !== undefined, "the cancellable network request");
    controller.abort();
    await rejected;
    assert.equal(requestSignal.aborted, true, "caller cancellation reaches fetch");
    assert.equal(harness.players.length, 0, "cancelled generation never creates an audio player");
  });
}

{
  const originalSetTimeout = globalThis.setTimeout;
  let timerAllocations = 0;
  globalThis.setTimeout = (...args) => {
    timerAllocations += 1;
    return originalSetTimeout(...args);
  };
  try {
    const harness = createHarness();
    const controller = new AbortController();
    const signal = {
      get aborted() { return controller.signal.aborted; },
      addEventListener(event, listener, options) {
        // Simulate abort after the initial validation but during listener setup.
        controller.abort();
        controller.signal.addEventListener(event, listener, options);
      },
      removeEventListener(event, listener) {
        controller.signal.removeEventListener(event, listener);
      },
    };
    let requests = 0;
    await withFetch(async () => {
      requests += 1;
      return responseWithBytes(Uint8Array.from([1, 2, 3]));
    }, async () => {
      await assert.rejects(
        harness.api.speakOpenAiText("Synchroner Abbruch", { voiceId: "shimmer", signal }),
        { name: "AbortError" },
      );
    });
    assert.equal(timerAllocations, 0, "a signal aborted during registration allocates no request timer");
    assert.equal(requests, 0, "a signal aborted during registration starts no request");
    assert.equal(harness.players.length, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

{
  const harness = createHarness();
  await withFetch(async () => responseWithBytes(Uint8Array.from([1, 2, 3])), async () => {
    const first = harness.api.speakOpenAiText("Alter Text", { voiceId: "shimmer" });
    const firstRejected = assert.rejects(first, { name: "AbortError" });
    await waitFor(() => harness.players.length === 1, "the first speech player");
    const oldPlayer = harness.players[0];

    const second = harness.api.speakOpenAiText("Neuer Text", { voiceId: "marin", styleId: "bright" });
    const secondRejected = assert.rejects(second, { name: "AbortError" });
    await firstRejected;
    await waitFor(() => harness.players.length === 2, "the replacement speech player");
    const newPlayer = harness.players[1];
    assert.equal(oldPlayer.pauseCount, 1, "replacement stops the previous owner's player");

    // A queued completion callback from the old player cannot settle or stop
    // whichever request now owns playback.
    oldPlayer.emit({ didJustFinish: true });
    await harness.api.stopOpenAiSpeech();
    await secondRejected;
    assert.equal(newPlayer.pauseCount, 1, "stop targets the current player owner");
    assert.equal(newPlayer.removeCount, 1);
  });
}

{
  const harness = createHarness();
  let cancelReaderCount = 0;
  let readCount = 0;
  const response = {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount === 1) return { done: false, value: new Uint8Array(4 * 1024 * 1024 - 2) };
            if (readCount === 2) return { done: false, value: new Uint8Array(3) };
            return { done: true };
          },
          cancel() { cancelReaderCount += 1; },
          releaseLock() {},
        };
      },
    },
  };
  await withFetch(async () => response, async () => {
    await assert.rejects(
      harness.api.speakOpenAiText("Zu große Audiodatei", { voiceId: "shimmer" }),
      /4 MB limit/u,
    );
    assert.equal(readCount, 2, "the streaming reader stops as soon as the byte limit is crossed");
    assert.equal(cancelReaderCount, 1, "the oversize network stream is cancelled");
    assert.equal(harness.players.length, 0);
  });
}

{
  const harness = createHarness();
  await withFetch(async () => responseWithBytes(new Uint8Array()), async () => {
    await assert.rejects(
      harness.api.speakOpenAiText("Leere Antwort", { voiceId: "shimmer" }),
      /empty audio/u,
    );
    assert.equal(harness.players.length, 0);
  });
}

{
  const harness = createHarness();
  await withFetch(async () => ({
    ok: false,
    status: 401,
    headers: { get() { return null; } },
    async text() { throw new Error("must not read provider diagnostics"); },
  }), async () => {
    await assert.rejects(
      harness.api.speakOpenAiText("Keine Geheimnisse", { voiceId: "shimmer" }),
      (error) => {
        assert.match(error.message, /HTTP 401/u);
        assert.doesNotMatch(error.message, /test-api-key/iu);
        return true;
      },
    );
    assert.equal(harness.players.length, 0);
  });
}

{
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cleared = true; };
  try {
    const harness = createHarness();
    let requestSignal;
    await withFetch((_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options.signal;
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
    }), async () => {
      const result = harness.api.speakOpenAiText("Request timeout", { voiceId: "shimmer" });
      const rejected = assert.rejects(result, /request timed out/u);
      await waitFor(() => requestSignal !== undefined, "request timeout setup");
      const requestTimer = timers.find((timer) => timer.delay === 20_000);
      assert.ok(requestTimer);
      requestTimer.callback();
      await rejected;
      assert.equal(requestSignal.aborted, true);
      assert.equal(timers.find((timer) => timer.delay === 20_000).cleared, true);
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

{
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cleared = true; };
  try {
    const harness = createHarness();
    await withFetch(async () => responseWithBytes(Uint8Array.from([1, 2, 3])), async () => {
      const result = harness.api.speakOpenAiText("Playback timeout", { voiceId: "shimmer" });
      const rejected = assert.rejects(result, /playback timed out/u);
      await waitFor(() => harness.players.length === 1, "playback timeout setup");
      const playbackTimer = timers.find((timer) => timer.delay === 90_000);
      assert.ok(playbackTimer);
      playbackTimer.callback();
      await rejected;
      await flush();
      assert.equal(harness.players[0].pauseCount, 1);
      assert.equal(harness.players[0].removeCount, 1);
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

{
  const harness = createHarness();
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return responseWithBytes(Uint8Array.from([1, 2, 3]));
  }, async () => {
    await assert.rejects(harness.api.speakOpenAiText("   ", { voiceId: "shimmer" }), /text is empty/u);
    await assert.rejects(harness.api.speakOpenAiText("Text", { voiceId: "not-a-voice" }), /Unsupported cloud speech voice/u);
    await assert.rejects(harness.api.speakOpenAiText("x".repeat(4_097), { voiceId: "shimmer" }), /4096-character limit/u);
    assert.equal(calls, 0, "invalid input never starts a cloud request");
  });
}

console.log("Budget cloud speech request, cancellation, playback ownership, and limits: PASS");
