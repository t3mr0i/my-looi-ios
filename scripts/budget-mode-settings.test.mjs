import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function evaluateTypeScript(source, fileName) {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", output)(module.exports, require, module);
  return module.exports;
}

const storeSource = read("src/store/user.ts");
const storeAst = ts.createSourceFile("user.ts", storeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const helperNames = new Set([
  "normalizeConversationMode",
  "isRealtimeConversationMode",
  "isManagedConversationMode",
]);
const helperSource = storeAst.statements
  .filter((node) => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text ?? ""))
  .map((node) => storeSource.slice(node.getStart(storeAst), node.end))
  .join("\n");
assert.equal(helperNames.size, 3);
const storeHelpers = evaluateTypeScript(helperSource, "conversation-mode-helpers.ts");

for (const mode of ["budget", "realtime", "realtime_pcm"]) {
  assert.equal(storeHelpers.normalizeConversationMode(mode), mode, `${mode} must survive normalization`);
  assert.equal(storeHelpers.isManagedConversationMode(mode), true, `${mode} must be a managed conversation`);
}
assert.equal(storeHelpers.isRealtimeConversationMode("budget"), false);
assert.equal(storeHelpers.isRealtimeConversationMode("realtime"), true);
assert.equal(storeHelpers.isRealtimeConversationMode("realtime_pcm"), true);
assert.equal(storeHelpers.normalizeConversationMode("unknown"), "realtime_pcm");
assert.match(storeSource, /conversationMode: "realtime_pcm"/, "adding Budget must not change the default mode");

const ui = evaluateTypeScript(read("src/i18n/ui-strings.ts"), "ui-strings.ts");
const languages = ["en", "de", "uk", "ru"];
const localized = (language, key) => ui.uiText(language, key);

const requiredTerms = {
  en: ["Chat and memory", "voice STOP", "Images", "wheel movement", "turning", "dancing", "shared rituals", "require Realtime"],
  de: ["Chat und Gedächtnis", "Sprachbefehl STOP", "Bilder", "Radbewegungen", "Drehen", "Tanzen", "gemeinsame Rituale", "benötigen Realtime"],
  uk: ["Чат і пам’ять", "голосова команда STOP", "Зображення", "рух коліс", "повороти", "танці", "спільні ритуали", "потребують Realtime"],
  ru: ["Чат и память", "голосовая команда STOP", "Изображения", "движение колёс", "повороты", "танцы", "общие ритуалы", "требуют Realtime"],
};
const dataTerms = {
  en: ["Microphone audio stays on this device", "text conversation", "relevant memories", "cloud TTS reads the reply", "no fixed per-minute price"],
  de: ["Mikrofon-Audio bleibt auf diesem Gerät", "Textverlauf", "Erinnerungen", "Cloud-Stimme spricht die Antwort", "Minutenpreis gibt es nicht"],
  uk: ["Аудіо з мікрофона залишається на пристрої", "текст розмови", "доречні спогади", "хмарний TTS озвучує відповідь", "фіксованої ціни за хвилину немає"],
  ru: ["Аудио с микрофона остаётся на устройстве", "текст диалога", "релевантные воспоминания", "облачный TTS озвучивает ответ", "фиксированной цены за минуту нет"],
};

for (const language of languages) {
  const detail = localized(language, "settings.modeBudgetDetail");
  const data = localized(language, "settings.modeBudgetData");
  for (const term of requiredTerms[language]) assert.ok(detail.includes(term), `${language} Budget detail must include: ${term}`);
  for (const term of dataTerms[language]) assert.ok(data.includes(term), `${language} Budget data disclosure must include: ${term}`);
  assert.ok(localized(language, "settings.modeBudgetModels").includes("GPT-6 Luna"));
  assert.ok(localized(language, "settings.modeBudgetExperimental").includes("2027"));
  assert.ok(localized(language, "settings.modeRealtimePcm").length > 0);
  assert.doesNotMatch(data, /only recognized text|nur der erkannte Text|лише розпізнаний текст|только распознанный текст/i);
}

const settingsSource = read("app/(tabs)/settings.tsx");
assert.match(settingsSource, /selected=\{preferences\.conversationMode === "budget"\}/);
assert.match(settingsSource, /preferences\.conversationMode === "budget" \? <View style=\{styles\.subCard\}>[\s\S]*settings\.modeBudgetModels[\s\S]*settings\.modeBudgetData[\s\S]*settings\.modeBudgetExperimental/);
assert.match(settingsSource, /preferences\.conversationMode !== "budget" \? <View style=\{styles\.subCard\}>[\s\S]*settings\.model[\s\S]*formatConversationCostPerMinute/);

console.log("Budget mode settings and localization: PASS");
