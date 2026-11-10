import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// --- Fixed lines -------------------------------------------------------------
const policy = loadTypeScript("src/robot-mind/proactive-speech-policy.ts");
const phrases = loadTypeScript("src/robot-mind/proactive-phrases.ts");
for (const occasion of policy.PROACTIVE_OCCASIONS) {
  for (const language of ["de", "en", "uk", "ru"]) {
    const sides = occasion === "warn_edge" ? [undefined, "front", "rear"] : [undefined];
    for (const edgeSide of sides) {
      const lines = phrases.listProactivePhrases(occasion, language, { edgeSide });
      assert.ok(lines.length >= 3, `${occasion}/${language} has variety`);
      assert.equal(new Set(lines).size, lines.length, `${occasion}/${language} has no duplicate line`);
      for (const line of lines) {
        assert.ok(line.length >= 4 && line.length <= 60, `${occasion}/${language} stays one short line: ${line}`);
        assert.doesNotMatch(line, /[\n{}<>]/u);
      }
    }
  }
}
// Russian and Ukrainian lines must fit both grammatical genders: no first-person past tense.
for (const occasion of policy.PROACTIVE_OCCASIONS) {
  for (const language of ["uk", "ru"]) {
    for (const line of [...phrases.listProactivePhrases(occasion, language), ...phrases.listProactivePhrases(occasion, language, { edgeSide: "front" })]) {
      assert.doesNotMatch(line, /(?:^|\s)я\s+\S+(?:л|ла|в|вся|лась|лся)(?=$|[\s.,!?])/iu, `gender-neutral wording: ${line}`);
    }
  }
}
assert.equal(phrases.normalizeProactivePhraseLanguage("fr"), "ru");
{
  let roll = 0;
  const picker = phrases.createProactivePhrasePicker(() => roll);
  const first = picker.pick("greet_arrival", "de");
  const second = picker.pick("greet_arrival", "de");
  assert.notEqual(first, second, "the same line is not said twice in a row");
  roll = 0.999;
  assert.ok(phrases.listProactivePhrases("greet_arrival", "de").includes(picker.pick("greet_arrival", "de")));
  assert.match(picker.pick("warn_edge", "en", { edgeSide: "rear" }), /behind|back/iu);
  assert.match(picker.pick("warn_edge", "de", { edgeSide: "front" }), /vor|weiter/iu);
}

// --- Clip cache --------------------------------------------------------------
const cacheModule = loadTypeScript("src/robot-mind/speech-clip-cache.ts");
function memoryStorage() {
  const files = new Map();
  let index = null;
  return {
    files, get index() { return index; }, set index(value) { index = value; }, failWrites: false,
    async readBase64(name) { return files.get(name) ?? null; },
    async writeBase64(name, base64) { if (this.failWrites) throw new Error("disk full"); files.set(name, base64); },
    async remove(name) { files.delete(name); },
    async readIndex() { return index; },
    async writeIndex(json) { index = json; },
  };
}
{
  let now = 1_000;
  const storage = memoryStorage();
  const cache = cacheModule.createSpeechClipCache(storage, () => now);
  assert.equal(await cache.read("a"), null);
  await cache.write("a", Uint8Array.from([1, 2, 3, 250]));
  assert.deepEqual([...await cache.read("a")], [1, 2, 3, 250], "bytes survive the round trip");
  assert.equal(await cache.read("b"), null, "a different request is a different clip");
  assert.match(cacheModule.speechClipName("a"), /^[0-9a-f]{16}$/u);
  assert.notEqual(cacheModule.speechClipName("Hallo!|alloy"), cacheModule.speechClipName("Hallo!|coral"));

  // A second cache over the same storage finds the clip again (app restart).
  const restarted = cacheModule.createSpeechClipCache(storage, () => now);
  assert.deepEqual([...await restarted.read("a")], [1, 2, 3, 250]);

  // A clip whose file the OS removed is forgotten, not returned empty.
  storage.files.clear();
  assert.equal(await restarted.read("a"), null);
  assert.equal(JSON.parse(storage.index)[cacheModule.speechClipName("a")], undefined);

  // Long audio is not a repeated remark; a damaged index or a failing disk never throws.
  await cache.write("long", new Uint8Array(cacheModule.SPEECH_CLIP_MAX_BYTES + 1));
  assert.equal(await cache.read("long"), null);
  storage.index = "{not json";
  const damaged = cacheModule.createSpeechClipCache(storage, () => now);
  assert.equal(await damaged.read("a"), null);
  storage.failWrites = true;
  await damaged.write("c", Uint8Array.from([9]));
  assert.equal(await damaged.read("c"), null);
}
{
  // The least recently used clips make room.
  let now = 0;
  const storage = memoryStorage();
  const cache = cacheModule.createSpeechClipCache(storage, () => now);
  for (let i = 0; i < cacheModule.SPEECH_CLIP_CACHE_MAX_CLIPS; i += 1) { now += 1; await cache.write(`clip-${i}`, Uint8Array.from([i % 250])); }
  now += 1; assert.ok(await cache.read("clip-0"), "reading marks a clip as used");
  now += 1; await cache.write("newest", Uint8Array.from([7]));
  assert.equal(storage.files.size, cacheModule.SPEECH_CLIP_CACHE_MAX_CLIPS);
  assert.ok(await cache.read("clip-0"), "a recently used clip stays");
  assert.equal(await cache.read("clip-1"), null, "the least recently used clip went");
  assert.ok(await cache.read("newest"));
}

// --- Cloud speech with the cache ---------------------------------------------
function speechHarness() {
  const players = [];
  const load = createTypeScriptTreeLoader({
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "./openai-speech-stream": { getCloudSpeechStreamRuntime: () => null },
    "expo-audio": {
      async setAudioModeAsync() {}, async setIsAudioActiveAsync() {},
      createAudioPlayer(source) {
        const player = { source, callbacks: [], addListener(_e, cb) { player.callbacks.push(cb); return { remove() {} }; },
          play() { for (const cb of [...player.callbacks]) cb({ playing: true }); queueMicrotask(() => { for (const cb of [...player.callbacks]) cb({ didJustFinish: true }); }); },
          pause() {}, remove() {} };
        players.push(player);
        return player;
      },
    },
    "./openai-api-key": { async getOpenAiApiKey() { return keyAvailable ? "test-key" : null; }, MissingOpenAiApiKeyError: class extends Error {} },
  });
  return { api: load("src/openai/openai-speech.ts"), players };
}
let keyAvailable = true;
const wav = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4]);
const originalFetch = globalThis.fetch;
try {
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => String(wav.length) }, async arrayBuffer() { return wav.buffer.slice(0); } };
  };
  const { api, players } = speechHarness();
  const storage = memoryStorage();
  const cache = cacheModule.createSpeechClipCache(storage);
  const sources = [];
  const options = { voiceId: "shimmer", styleId: "cute-robot", speed: 1, cache, onAudioSource: (fromCache) => sources.push(fromCache) };

  await api.speakOpenAiText("Oh, hallo!", options);
  assert.equal(requests.length, 1, "the first time the line is synthesized");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.files.size, 1, "and its audio is stored");

  await api.speakOpenAiText("Oh, hallo!", options);
  assert.equal(requests.length, 1, "the second time it plays from the device");
  assert.deepEqual(sources, [false, true]);
  assert.equal(players.at(-1).source.uri, players[0].source.uri, "the stored clip is the same audio");

  // Offline and without a key, a stored line still plays.
  keyAvailable = false;
  globalThis.fetch = async () => { throw new Error("offline"); };
  await api.speakOpenAiText("Oh, hallo!", options);
  assert.deepEqual(sources, [false, true, true]);
  keyAvailable = true;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => String(wav.length) }, async arrayBuffer() { return wav.buffer.slice(0); } };
  };

  // Another voice, speed, style or text is another clip.
  await api.speakOpenAiText("Oh, hallo!", { ...options, voiceId: "coral" });
  await api.speakOpenAiText("Oh, hallo!", { ...options, speed: 1.15 });
  await api.speakOpenAiText("Oh, hallo!", { ...options, styleId: "natural" });
  await api.speakOpenAiText("Hey, da bist du ja!", options);
  assert.equal(requests.length, 5);

  // Without a cache every call is a request, as before.
  await api.speakOpenAiText("Oh, hallo!", { voiceId: "shimmer", styleId: "cute-robot", speed: 1 });
  assert.equal(requests.length, 6);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Robot mind local speech: fixed lines, clip cache and cached cloud speech PASS");
