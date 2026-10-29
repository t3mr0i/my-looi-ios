import assert from "node:assert/strict";
import { createStore } from "zustand/vanilla";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const { buildRealtimeSessionUpdate } = load("src/voice/realtime-config.ts");
const preferences = {
  language: "de", listeningLanguage: "de", realtimeModelId: "gpt-realtime-2.1-mini",
  ttsVoiceId: "shimmer", ttsStyleId: "playful-robot", ttsSpeed: 1,
  speechGender: "masculine", robotName: "LOOI", robotAddressAliases: [], robotAddressRecognitionAliases: [],
};

// Exercise the real public configuration builder. Endpointing must never bypass
// the local game's/repair's response gate or disable user interruption.
for (const language of ["en", "de", "uk", "ru"]) {
  for (const manual of [false, true]) {
    const input = buildRealtimeSessionUpdate({
      ...preferences, language, listeningLanguage: language, realtimeTurnTaking: "semantic",
    }, undefined, undefined, "Current local task context", manual).session.audio.input;
    assert.deepEqual(input.turn_detection, {
      type: "semantic_vad", eagerness: "auto", create_response: !manual, interrupt_response: true,
    });
    assert.equal(input.transcription.language, language);
    assert.equal(input.noise_reduction.type, "far_field");
    assert.equal(input.format.rate, 24000);
  }
}
for (const value of [undefined, null, "fixed", "invalid", "semantic_vad"]) {
  const turn = buildRealtimeSessionUpdate({ ...preferences, realtimeTurnTaking: value }).session.audio.input.turn_detection;
  assert.deepEqual(turn, {
    type: "server_vad", threshold: 0.15, prefix_padding_ms: 500, silence_duration_ms: 1000,
    create_response: true, interrupt_response: true,
  }, "existing far-field settings remain the fallback for absent/invalid selection");
}

const STORAGE_KEY = "looi.user-preferences.v1";
function loadUser(stored) {
  const storage = new Map(stored === undefined ? [] : [[STORAGE_KEY, JSON.stringify(stored)]]);
  const moduleLoad = createTypeScriptTreeLoader({
    zustand: { create: createStore },
    "react-native-mmkv": { createMMKV: () => ({
      getString: (key) => typeof storage.get(key) === "string" ? storage.get(key) : undefined,
      getBoolean: (key) => typeof storage.get(key) === "boolean" ? storage.get(key) : undefined,
      set: (key, value) => storage.set(key, value),
      remove: (key) => storage.delete(key),
    }) },
  });
  return { store: moduleLoad("src/store/user.ts").useUserStore, storage };
}

const fresh = loadUser();
const base = fresh.store.getState().preferences;
assert.equal(base.realtimeTurnTaking, "fixed", "new sessions preserve the accepted acoustic baseline by default");
const { realtimeTurnTaking: omitted, ...legacyPreferences } = base;
for (const value of [undefined, null, "unknown", "semantic_vad", 3]) {
  const migrated = loadUser({ version: 19, preferences: {
    ...legacyPreferences, ...(value === undefined ? {} : { realtimeTurnTaking: value }),
  } });
  assert.equal(migrated.store.getState().preferences.realtimeTurnTaking, "fixed");
  assert.equal(JSON.parse(migrated.storage.get(STORAGE_KEY)).preferences.realtimeTurnTaking, "fixed");
}

fresh.store.getState().updatePreferences({ realtimeTurnTaking: "semantic" });
assert.equal(fresh.store.getState().preferences.realtimeTurnTaking, "semantic");
fresh.store.getState().updatePreferences({ language: "uk", conversationMode: "budget" });
assert.equal(fresh.store.getState().preferences.realtimeTurnTaking, "semantic",
  "unrelated voice preferences and Budget mode preserve the next Realtime selection");
const saved = JSON.parse(fresh.storage.get(STORAGE_KEY));
assert.equal(loadUser(saved).store.getState().preferences.realtimeTurnTaking, "semantic", "selection survives restart");
fresh.store.getState().updatePreferences({ realtimeTurnTaking: "unknown" });
assert.equal(fresh.store.getState().preferences.realtimeTurnTaking, "fixed", "invalid updates fail back to the supported baseline");

console.log("Realtime turn taking: semantic/fixed schema, local response gates, interruption and persisted preference migration PASS");
