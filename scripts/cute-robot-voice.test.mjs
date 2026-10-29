import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const voices = load("src/voice/tts-voices.ts");

assert.equal(voices.DEFAULT_TTS_VOICE_ID, "shimmer", "the default voice should sound light and expressive");

const previouslyPlayableRealtimeVoices = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
];
for (const voiceId of previouslyPlayableRealtimeVoices) {
  assert.ok(voices.isSupportedRealtimeVoiceId(voiceId), `${voiceId} remains available for Realtime and preview`);
}

const playfulInstructions = voices.getTtsStyleInstructions("playful-robot");
assert.match(playfulInstructions, /cute|sweet/iu);
assert.match(playfulInstructions, /robot/iu);
assert.match(playfulInstructions, /slightly higher|light/iu);
assert.match(playfulInstructions, /subtle synthetic cadence/iu);
assert.match(playfulInstructions, /natural word stress.*German/iu);
assert.match(playfulInstructions, /spoken beeps/iu);
assert.match(playfulInstructions, /baby talk/iu);

const naturalInstructions = voices.getTtsStyleInstructions("natural");
assert.match(naturalInstructions, /warm|natural/iu);
assert.doesNotMatch(naturalInstructions, /cute|sweet|slightly higher|synthetic cadence|beep|baby talk/iu);
assert.notEqual(naturalInstructions, playfulInstructions, "natural style remains distinct from the robot character");

const config = load("src/voice/realtime-config.ts");
const realtimePreferences = {
  language: "de",
  listeningLanguage: "de",
  realtimeModelId: "gpt-realtime-2.1-mini",
  ttsVoiceId: "shimmer",
  ttsStyleId: "playful-robot",
  ttsSpeed: 1,
  speechGender: "masculine",
  robotName: "Louis",
  robotAddressAliases: ["Louis"],
  robotAddressRecognitionAliases: [],
};
const playfulSession = config.buildRealtimeSessionUpdate(realtimePreferences).session;
assert.equal(playfulSession.audio.output.voice, "shimmer");
assert.ok(playfulSession.instructions.includes(playfulInstructions));
assert.match(playfulSession.instructions, /German/);
assert.match(playfulSession.instructions, /respond to the particular thing the person just said/u);
assert.match(playfulSession.instructions, /serious or sensitive moments, be calm and direct/u);
assert.match(playfulSession.instructions, /Never invent shared experiences, perceptions, physical actions/u);

const naturalSession = config.buildRealtimeSessionUpdate({
  ...realtimePreferences,
  ttsStyleId: "natural",
}).session;
assert.ok(naturalSession.instructions.includes(naturalInstructions));
assert.ok(!naturalSession.instructions.includes(playfulInstructions), "natural Realtime preferences do not append the playful robot delivery direction");

// Exercise the real voice preview request, including the selected language,
// style, speed, and voice. Playback completes through a tiny fake audio player.
const previewBodies = [];
let playbackListener;
const previewLoad = createTypeScriptTreeLoader({
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "./openai-speech-stream": { getCloudSpeechStreamRuntime: () => null },
  "expo-audio": {
    async setAudioModeAsync() {},
    async setIsAudioActiveAsync() {},
    createAudioPlayer() {
      return {
        addListener(_event, listener) {
          playbackListener = listener;
          return { remove() {} };
        },
        play() { playbackListener?.({ didJustFinish: true }); },
        pause() {},
        remove() {},
      };
    },
  },
  "./openai-api-key": {
    async getOpenAiApiKey() { return "test-key"; },
    MissingOpenAiApiKeyError: class MissingOpenAiApiKeyError extends Error {},
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  previewBodies.push(JSON.parse(options.body));
  return {
    ok: true,
    async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; },
  };
};
try {
  const preview = previewLoad("src/openai/openai-voice-preview.ts");
  await preview.playOpenAiRealtimeVoicePreview("shimmer", "de", "playful-robot", 0.85);
  await preview.playOpenAiRealtimeVoicePreview("shimmer", "de", "natural", 1);
  await preview.playOpenAiRealtimeVoicePreview("shimmer", "de");
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(previewBodies.length, 3);
assert.equal(previewBodies[0].voice, "shimmer");
assert.equal(previewBodies[0].input, voices.getTtsPreviewText("de"));
assert.equal(previewBodies[0].speed, 0.85);
assert.equal(previewBodies[0].instructions, playfulInstructions);
assert.equal(previewBodies[1].voice, "shimmer");
assert.equal(previewBodies[1].speed, 1);
assert.equal(previewBodies[1].instructions, naturalInstructions);
assert.equal(previewBodies[2].voice, "shimmer");
assert.equal(previewBodies[2].input, voices.getTtsPreviewText("de"));
assert.equal(previewBodies[2].speed, 1, "the preview keeps the normal default rate when omitted");
assert.equal(previewBodies[2].instructions, playfulInstructions, "the preview keeps the sweet robot default style when omitted");

const settingsSource = readFileSync("app/(tabs)/settings.tsx", "utf8");
assert.match(
  settingsSource,
  /playOpenAiRealtimeVoicePreview\(voiceId,\s*preferences\.language,\s*preferences\.ttsStyleId,\s*preferences\.ttsSpeed,\s*controller\.signal\)/,
  "voice preview uses the currently selected style and speed",
);

function makeUserStore(storage) {
  const mockZustand = {
    create(initialize) {
      let state;
      const set = (update) => {
        const partial = typeof update === "function" ? update(state) : update;
        state = { ...state, ...partial };
      };
      state = initialize(set);
      return { getState: () => state };
    },
  };
  const mockMmkv = {
    createMMKV() {
      return {
        getString: (key) => storage.get(key),
        getBoolean: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
        remove: (key) => storage.delete(key),
      };
    },
  };
  return createTypeScriptTreeLoader({
    zustand: mockZustand,
    "react-native-mmkv": mockMmkv,
  })("src/store/user.ts").useUserStore;
}

function storedPreferences(version, preferences) {
  return new Map([[
    "looi.user-preferences.v1",
    JSON.stringify({ version, preferences: { language: "de", ...preferences } }),
  ]]);
}

const emptyStorage = new Map();
const freshPreferences = makeUserStore(emptyStorage).getState().preferences;
assert.equal(freshPreferences.ttsVoiceId, "shimmer");
assert.equal(freshPreferences.ttsStyleId, "playful-robot");

const formerDefaults = storedPreferences(18, { ttsVoiceId: "cedar", ttsStyleId: "playful-robot" });
const migratedDefaultStore = makeUserStore(formerDefaults);
assert.equal(migratedDefaultStore.getState().preferences.ttsVoiceId, "shimmer");
const migratedPayload = JSON.parse(formerDefaults.get("looi.user-preferences.v1"));
assert.equal(migratedPayload.version, 19, "the one-time default voice migration is persisted");
assert.equal(migratedPayload.preferences.ttsVoiceId, "shimmer");
assert.equal(makeUserStore(formerDefaults).getState().preferences.ttsVoiceId, "shimmer", "reloading does not repeat the migration");

const missingStyleDefault = storedPreferences(18, { ttsVoiceId: "cedar" });
assert.equal(makeUserStore(missingStyleDefault).getState().preferences.ttsVoiceId, "shimmer", "an old default with no saved style migrates too");

for (const [voiceId, ttsStyleId] of [
  ["alloy", "playful-robot"],
  ["cedar", "natural"],
  ["cedar", "bright"],
  ["shimmer", "natural"],
]) {
  const storage = storedPreferences(18, { ttsVoiceId: voiceId, ttsStyleId });
  const preferences = makeUserStore(storage).getState().preferences;
  assert.equal(preferences.ttsVoiceId, voiceId, `preserve deliberate voice ${voiceId} with style ${ttsStyleId}`);
  assert.equal(preferences.ttsStyleId, ttsStyleId, `preserve deliberate style ${ttsStyleId}`);
}

const selectedVoiceStorage = storedPreferences(19, { ttsVoiceId: "cedar", ttsStyleId: "playful-robot" });
const selectedVoiceStore = makeUserStore(selectedVoiceStorage);
assert.equal(selectedVoiceStore.getState().preferences.ttsVoiceId, "cedar", "the migration does not overwrite a later voice choice");
selectedVoiceStore.getState().updatePreferences({ ttsVoiceId: "alloy", ttsStyleId: "natural" });
const selectedVoiceAfterReload = makeUserStore(selectedVoiceStorage).getState().preferences;
assert.equal(selectedVoiceAfterReload.ttsVoiceId, "alloy");
assert.equal(selectedVoiceAfterReload.ttsStyleId, "natural", "selected style persists through the real preference store");

console.log("Cute robot voice style, Realtime, preview, and preference migration: PASS");
