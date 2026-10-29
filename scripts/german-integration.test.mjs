import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const require = createRequire(import.meta.url);
const pluginRoot = path.dirname(require.resolve("@expo/config-plugins/package.json", {
  paths: [path.dirname(require.resolve("expo/config-plugins"))],
}));
const { getResolvedLocalesAsync } = require(path.join(pluginRoot, "build/utils/locales.js"));
const app = JSON.parse(fs.readFileSync("app.json", "utf8")).expo;
const { localesMap } = await getResolvedLocalesAsync(process.cwd(), app.locales, "ios");
assert.match(localesMap.de.NSMicrophoneUsageDescription, /Mikrofon/);
assert.match(localesMap.de.NSCameraUsageDescription, /Kamera/);
assert.match(localesMap.de.NSBluetoothAlwaysUsageDescription, /Bluetooth/);
assert.deepEqual(Object.keys(localesMap.de).sort(), Object.keys(localesMap.en).sort());
const androidLocales = await getResolvedLocalesAsync(process.cwd(), app.locales, "android");
assert.deepEqual(androidLocales.localesMap.de, {}, "iOS plist keys stay out of Android resources");

const values = new Map([["looi.user-preferences.v1", JSON.stringify({
  version: 17,
  preferences: {
    interfaceLanguage: "de", listeningLanguage: "de", language: "de",
    customVoiceCommands: { forward: [{ id: "de-forward", language: "de", text: "Fahr los" }] },
  },
})]]);
const loadUserStore = () => createTypeScriptTreeLoader({
  "react-native-mmkv": { createMMKV: () => ({
    getString: (key) => values.get(key), getBoolean: (key) => values.get(key),
    set: (key, value) => values.set(key, value), remove: (key) => values.delete(key),
  }) },
  zustand: { create: (initialize) => {
    let state = initialize((update) => { state = { ...state, ...update(state) }; });
    return { getState: () => state };
  } },
})("src/store/user.ts").useUserStore;
const user = loadUserStore();
assert.equal(user.getState().preferences.interfaceLanguage, "de");
assert.equal(user.getState().preferences.listeningLanguage, "de");
assert.equal(user.getState().preferences.language, "de");
assert.equal(user.getState().preferences.customVoiceCommands.forward[0].language, "de");
user.getState().updatePreferences({ language: "en" });
const reloaded = loadUserStore().getState().preferences;
assert.equal(reloaded.interfaceLanguage, "de", "UI choice survives restart independently");
assert.equal(reloaded.listeningLanguage, "de", "input choice survives restart independently");
assert.equal(reloaded.language, "en", "changing replies does not change German UI/input");

const { interpretBehaviorText } = loadTypeScript("src/behavior/behavior-policy.ts");
for (const [text, field, expected] of [
  ["Hallo Louis", "greeting", true],
  ["Guten Morgen", "greeting", true],
  ["Gut gemacht", "success", true],
  ["Das war lustig", "playful", true],
  ["Ich meinte etwas anderes", "correction", true],
  ["Bitte nick weniger", "style", "less_nod"],
  ["Nick nicht so oft", "style", "less_nod"],
  ["Sei lebendiger", "style", "lively_playful"],
  ["Lass uns ein Ratespiel spielen", "gameStart", true],
  ["Bitte starte ein Spiel", "gameStart", true],
  ["Beende das Spiel", "gameStop", true],
  ["Ich tippe auf zwei", "guess", 2],
  ["Eins", "guess", 1],
  ["Vielleicht drei", "guess", 3],
  ["Starte kein Spiel", "gameStart", false],
  ["Starte das Spiel nicht", "gameStart", false],
  ["Beende das Spiel nicht", "gameStop", false],
  ["Können wir ein Spiel spielen?", "gameStart", false],
  ["Nicht zwei", "guess", null],
  ['Er sagte: „Starte ein Spiel“', "gameStart", false],
]) assert.equal(interpretBehaviorText(text)[field], expected, text);

const { buildMemoryFtsQuery } = loadTypeScript("src/memory/local-memory-search.ts");
assert.equal(buildMemoryFtsQuery("Was ist meine Lieblingsfarbe?"), '"lieblingsfarbe"*');
assert.equal(buildMemoryFtsQuery("Wie ist mein Name?"), '"name"*');
assert.equal(buildMemoryFtsQuery("der die das und oder"), null);

const protocol = loadTypeScript("src/agent/agent-protocol.ts");
const capabilities = loadTypeScript("src/agent/agent-capabilities.ts", { "./agent-protocol": protocol });
const client = loadTypeScript("src/agent/agent-client.ts", { "./agent-protocol": protocol, "./agent-capabilities": capabilities, "./agent-nous": loadTypeScript("src/agent/agent-nous.ts", { "./agent-protocol": protocol }) });
const { createAgentService } = loadTypeScript("src/agent/agent-service-core.ts", {
  "./agent-protocol": protocol, "./agent-client": client,
});
const id = "01234567-1234-4123-8123-123456789abc";
const connection = { url: "https://agent.example.org", token: "a".repeat(64) };
let pending = null;
let fail = true;
let requests = 0;
const service = createAgentService({
  readConnection: async () => connection,
  writeConnection: async () => {},
  readPending: async () => pending,
  writePending: async (_url, value) => { pending = value; },
}, client.createAgentClient({ fetcher: async (_url, options) => {
  requests += 1;
  const body = JSON.parse(options.body);
  assert.equal(body.language, "de");
  if (fail) throw new Error("offline");
  return new Response(JSON.stringify({
    id, ...body, status: "queued", createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z", answer: null, sources: [], error: null,
  }), { status: 201 });
} }), () => id);
await assert.rejects(service.submitAgentTask("Vergleiche zwei Quellen", "de"), { code: "network" });
assert.equal(pending.language, "de", "German survives uncertain submission for retry");
fail = false;
assert.equal((await service.retryPendingAgentTask()).language, "de");
assert.equal(pending, null);
assert.equal(requests, 2);
await assert.rejects(service.submitAgentTask("Vergleiche zwei Quellen", "xx"), { code: "invalid_query" });
assert.equal(requests, 2, "unsupported languages remain rejected");

console.log("German behavior, memory and research integration: PASS");
