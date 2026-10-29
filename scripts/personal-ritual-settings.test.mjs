import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const projectRoot = path.resolve(".");
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const nativeWeb = nodeRequire("react-native-web");
const { useStore } = nodeRequire("zustand");
const { createStore } = nodeRequire("zustand/vanilla");
const componentPath = path.join(projectRoot, "src/ui/BehaviorSettings.tsx");
const disableCalls = [];
const ritualButtons = [];
const gameButtons = [];
const gameCommands = [];
let activeLanguage = "de";

const episodeSource = { evidence: "Wir haben den Flieger gemeinsam gefaltet", sessionId: "ssr-test", at: 1_792_000_000_000 };
const episodeBase = { detail: "Wir haben ihn gemeinsam gefaltet.", outcome: "Er ist bis zur Fensterbank geflogen.", source: episodeSource, createdAt: 1_792_000_000_000, updatedAt: 1_792_000_000_000, lastUsedAt: null, confirmedAt: 1_792_000_000_000 };
const behaviorStore = createStore(() => ({
  settings: { mode: "active", visualEnabled: true, curiosityEnabled: true, candidateScoring: true, dailyBudgetUsd: 1 },
  state: {
    sessionId: "ssr-test-session", posture: "attend",
    metrics: { requests: 9, completed: 8, failed: 1, stale: 0, costUsd: 0.02 }, game: null,
    companion: {
      episodes: [
        { ...episodeBase, id: "ep-active", title: "Unser Papierflieger", motif: "happy_bob", ritualPreference: { mode: "active", motif: "nod", phrase: "Schau, die Spitze ist jetzt anders", confirmedAt: episodeBase.confirmedAt, source: { origin: "voice", evidence: "Lass uns ein eigenes kleines Ritual vereinbaren", sessionId: "ssr-test-session", at: episodeBase.confirmedAt }, lastOfferedAt: null }, visualMemory: { description: "Ein roter Papierflieger mit breiten Flügeln." } },
        { ...episodeBase, id: "ep-silent", title: "Der kleine Garten", motif: "curious", ritualPreference: { mode: "silent", confirmedAt: episodeBase.confirmedAt, source: { origin: "voice", evidence: "Bitte ohne persönliche Geste", sessionId: "ssr-test-session", at: episodeBase.confirmedAt }, lastOfferedAt: null } },
        { ...episodeBase, id: "ep-legacy", title: "Der Regentag", motif: "curious" },
      ],
      scene: { status: "idle", match: null, baselineDescription: null, currentDescription: null, change: null, signal: null, episodeTitle: null },
    },
  },
}));
// Each server render represents a fresh screen opened with the selected
// fixture. Zustand's default SSR snapshot otherwise stays at the first fixture.
behaviorStore.getInitialState = () => behaviorStore.getState();
const useBehaviorStore = Object.assign((selector) => useStore(behaviorStore, selector), behaviorStore);

const fixture = {
  useBehaviorStore,
  disableBehaviorPersonalRitual: async (id) => { disableCalls.push(id); },
  forgetBehaviorExperience: async () => {},
  resetBehaviorLearning: async () => {},
  updateBehaviorSettings: () => {},
  publishBehaviorEvent: (event) => gameCommands.push(event),
};

const CapturingPressable = (props) => {
  if (["Stop the number guessing game", "Zahlenratespiel beenden", "Зупинити гру з числами", "Остановить игру с числами",
    "Start the number guessing game from one to three", "Zahlenratespiel von eins bis drei starten", "Почати гру: вгадати число від одного до трьох", "Начать игру: угадать число от одного до трёх"].includes(props.accessibilityLabel)) {
    gameButtons.push(props);
  }
  if (props.accessibilityLabel?.startsWith("Persönliches Ritual ausschalten")
    || props.accessibilityLabel?.startsWith("Persönliches Ritual für ")) {
    ritualButtons.push(props);
  }
  return React.createElement(nativeWeb.Pressable, props, props.children);
};
const nativeShim = { ...nativeWeb, Pressable: CapturingPressable };
const cache = new Map();

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const extension of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

function loadModule(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = fs.readFileSync(file, "utf8");
  const code = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const localRequire = (specifier) => {
    if (file === componentPath) {
      if (specifier === "react-native") return nativeShim;
      if (specifier === "../behavior/behavior-runtime") {
        return { ...fixture, disableBehaviorPersonalRitual: async (id) => { disableCalls.push(id); } };
      }
      if (specifier === "../behavior/behavior-events") return fixture;
      if (specifier === "../i18n/use-ui-text") {
        const locales = { de: "de-DE", en: "en-US", uk: "uk-UA", ru: "ru-RU" };
        return { useUiText: () => ({ language: activeLanguage, locale: locales[activeLanguage] }) };
      }
    }
    return specifier.startsWith(".") ? loadModule(resolveRelative(file, specifier)) : nodeRequire(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const { BehaviorSettings } = loadModule(componentPath);

function render(language) {
  activeLanguage = language;
  ritualButtons.length = 0;
  gameButtons.length = 0;
  return renderToStaticMarkup(React.createElement(BehaviorSettings));
}

const de = render("de");
assert.match(de, /Persönliches Ritual aktiv · Nicken/u);
assert.match(de, /Vereinbarte Formulierung: „Schau, die Spitze ist jetzt anders“/u, "the user-approved phrase is shown as quoted data");
assert.match(de, /Höchstens eine Gelegenheit pro 24 Stunden/u);
assert.match(de, /Eine Geste beweist nicht, dass sich etwas bewegt hat/u);
assert.match(de, /Keine persönliche Geste ausgewählt/u, "silent is a quiet status rather than an enable control");
assert.equal((de.match(/Unsere gemeinsame Geste:/gu) ?? []).length, 1, "legacy motif is shown only for an experience without a ritual preference");
assert.equal(ritualButtons.length, 1, "only the active preference has a disable action");
assert.match(de, /Beim Ausschalten wird die aktuelle Unterhaltung beendet und ihr aktives Transkript gelöscht/u);

ritualButtons[0].onPress();
await Promise.resolve();
assert.deepEqual(disableCalls, ["ep-active"], "the active preference button calls the runtime mutation for its matching episode id");

const localizedExpectations = [
  ["en", "Personal ritual active", "No personal gesture selected", "At most one opportunity every 24 hours"],
  ["uk", "Особистий ритуал активний", "Особистий жест не вибрано", "Не більше однієї нагоди за 24 години"],
  ["ru", "Личный ритуал активен", "Личный жест не выбран", "Не более одной возможности за 24 часа"],
];
for (const [language, active, silent, limit] of localizedExpectations) {
  const html = render(language);
  assert.ok(html.includes(active), `${language} active status is translated`);
  assert.ok(html.includes(silent), `${language} silent status is translated`);
  assert.ok(html.includes(limit), `${language} 24-hour limit is translated`);
}

// A paused game is still the same unfinished round. The existing settings
// control must end it rather than silently starting a replacement round.
const baseState = useBehaviorStore.getState().state;
for (const [language, label, text] of [
  ["de", "Zahlenratespiel beenden", "Spiel beenden"],
  ["en", "Stop the number guessing game", "Stop game"],
  ["uk", "Зупинити гру з числами", "Зупинити гру"],
  ["ru", "Остановить игру с числами", "Остановить игру"],
]) {
  useBehaviorStore.setState({ state: { ...baseState, game: { status: "paused" } } });
  const html = render(language);
  assert.ok(html.includes(text));
  assert.equal(gameButtons.length, 1);
  assert.equal(gameButtons[0].accessibilityLabel, label);
  gameButtons[0].onPress();
  assert.deepEqual(gameCommands.at(-1), { type: "game-command", action: "stop", sessionId: baseState.sessionId });
}
useBehaviorStore.setState({ state: { ...baseState, game: { status: "stopped" } } });
render("de");
assert.equal(gameButtons[0].accessibilityLabel, "Zahlenratespiel von eins bis drei starten");
gameButtons[0].onPress();
assert.equal(gameCommands.at(-1).action, "start");

console.log("personal ritual and paused-game settings SSR, localization, and action checks passed (no visual/native verification)");
