import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = createTypeScriptTreeLoader();

const language = load(path.join(root, "src/i18n/ui-language.ts"));
assert.ok(language.INTERFACE_LANGUAGE_OPTIONS.some(({ id, shortLabel, label }) =>
  id === "de" && shortLabel === "DE" && label === "Deutsch"));
assert.equal(language.INTERFACE_LOCALES.de, "de-DE");
assert.equal(language.normalizeInterfaceLanguage("de"), "de");
assert.equal(language.normalizeInterfaceLanguage("fr", "de"), "de");
assert.equal(language.normalizeInterfaceLanguage("es", "en"), "en");

const originalDateTimeFormat = Intl.DateTimeFormat;
try {
  for (const [locale, expected] of [["de-DE", "de"], ["de-AT", "de"], ["ru-RU", "ru"], ["fr-FR", "en"]]) {
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ locale }) };
    };
    assert.equal(language.detectSystemInterfaceLanguage(), expected, `system locale ${locale}`);
  }
} finally {
  Intl.DateTimeFormat = originalDateTimeFormat;
}

function objectTable(file, name) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let table;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      let initializer = node.initializer;
      while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isTypeAssertionExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (initializer && ts.isObjectLiteralExpression(initializer)) {
        table = new Map();
        for (const property of initializer.properties) {
          assert.ok(ts.isPropertyAssignment(property), `${file}: expected a static ${name} entry`);
          assert.ok(ts.isStringLiteralLike(property.initializer), `${file}: expected a literal value`);
          const key = property.name.getText(source).replace(/^['"]|['"]$/g, "");
          const placeholders = [...property.initializer.text.matchAll(/\{(\w+)\}/g)]
            .map((match) => match[1])
            .sort()
            .join(",");
          table.set(key, placeholders);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(table, `${file}: could not find ${name} table`);
  return table;
}

const dictionaryFiles = fs.readdirSync(path.join(root, "src/i18n"))
  .filter((file) => file.endsWith("-strings.ts"))
  .map((file) => `src/i18n/${file}`);

for (const relativeFile of dictionaryFiles) {
  const file = path.join(root, relativeFile);
  const en = objectTable(file, "en");
  const de = objectTable(file, "de");
  assert.deepEqual([...de.keys()].sort(), [...en.keys()].sort(), `${relativeFile}: German keys must match English`);
  for (const [key, placeholders] of en) {
    assert.equal(de.get(key), placeholders, `${relativeFile}: placeholders for ${key}`);
  }
}

const ui = load(path.join(root, "src/i18n/ui-strings.ts"));
const t = ui.createUiTranslator("de");
assert.equal(t("settings.listeningLanguage"), "Sprache, die du verwendest");
assert.equal(t("memory.count", { count: 3 }), "Gespeicherte Erinnerungen: 3");
assert.equal(t("settings.robotNameRow", { name: "Louis" }), "Robotername: Louis");
assert.equal(ui.getLocalizedModelDownloadStage("de", "asr-archive", "fallback"), "Spracherkennungsmodell wird heruntergeladen");
assert.equal(ui.getLocalizedVoiceDescription("de", "cedar", "fallback"), "Klare Stimme — eine gute Standardwahl");
const realtimeModels = load(path.join(root, "src/openai/realtime-models.ts"));
assert.equal(realtimeModels.formatConversationCostPerMinute("gpt-realtime-2.1-mini", "de"), "≈ $0,02/Gesprächsminute");

const agent = load(path.join(root, "src/i18n/agent-strings.ts"));
assert.equal(agent.createAgentTranslator("de")("taskTooLong", { max: 120 }), "Die Aufgabe darf höchstens 120 Zeichen enthalten.");
const research = load(path.join(root, "src/i18n/research-strings.ts"));
assert.equal(research.createResearchTranslator("de")("openSource", { title: "OpenAI" }), "Quelle öffnen: OpenAI");
const behavior = load(path.join(root, "src/i18n/behavior-strings.ts"));
assert.equal(behavior.createBehaviorTranslator("de")("modeA11y", { mode: "Aktiv" }), "Verhaltensmodus: Aktiv");
const rehearsal = load(path.join(root, "src/i18n/behavior-rehearsal-strings.ts"));
assert.equal(rehearsal.createBehaviorRehearsalTranslator("de")("lastRunScenario", { scenario: "Neugier" }), "Letzter Durchlauf: Neugier");
const robotApps = load(path.join(root, "src/i18n/robot-app-strings.ts"));
assert.equal(robotApps.createRobotAppsTranslator("de")("mediaActive", { owner: "Kamera-App" }), "Wird verwendet von Kamera-App");
const robotDebug = load(path.join(root, "src/i18n/robot-debug-strings.ts"));
assert.equal(robotDebug.createRobotDebugTranslator("de")("actionBlocked", { action: "Vorwärts", reason: "Kante" }), "Vorwärts wurde blockiert: Kante");

console.log("German UI localization: PASS");
