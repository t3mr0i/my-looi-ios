import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const COMMIT = /^[a-f0-9]{40}$/i;
const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const skillCore = loadTypeScript("src/robot-bridge/app-skills.ts", { "./app-catalog": { COMMIT, SPACE_ID } });
const REV = "a".repeat(40);
function item(kind = "python") {
  const spaceId = kind === "python" ? "pollen/clock" : "pollen/console";
  return { id: `hf:${spaceId}`, spaceId, revision: REV, family: "reachy", kind,
    title: "Clock", description: "An original app", author: "pollen", sdk: "static", tags: ["robot-app"], private: false,
    url: `https://huggingface.co/spaces/${spaceId}`, installable: kind === "python",
    launch: kind === "python" ? { mode: "install", spaceId, revision: REV } : { mode: "hosted", spaceId, revision: REV, url: "https://pollen-console.hf.space/", appHost: "pollen-console.hf.space", hubUrl: `https://huggingface.co/spaces/${spaceId}`, handoff: "reachy-hosted-shell" },
  };
}
async function flush() { for (let i = 0; i < 45; i++) await Promise.resolve(); }
async function waitUntil(predicate, message, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) assert.fail(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function setup({ preferenceBarrier, initialPreference = null, kind = "python", prepareBarrier, writeBehavior } = {}) {
  const requests = [], writes = [], released = new Set(), appListeners = new Set(), userListeners = new Set();
  let robotListener;
  let dismissed = 0, opened = 0, stopped = 0;
  const browser = deferred();
  const state = { robotSleeping: false };
  const robot = { stopGeneration: 0, safety: { lastSafetyStopReason: null } };
  let configuration = { url: "https://unused.invalid".replace("https:", "wss:") + "/device", token: "b".repeat(48) };
  let preference = initialPreference;
  const AppState = { currentState: "active", addEventListener(_type, fn) { appListeners.add(fn); return { remove() { appListeners.delete(fn); } }; } };
  const catalogItem = item(kind);
  const boundary = {
    loadRobotBridgeConfiguration: async () => ({ ...configuration }),
    getRobotBridgeRuntimeStatus: () => ({ companionConnected: true }),
    prepareRobotAppConnection: async () => { await prepareBarrier?.promise; return true; },
    subscribeRobotBridgeRelease(fn) { released.add(fn); return () => released.delete(fn); },
    stopRobotBridge() { stopped++; for (const fn of released) fn("user-stop"); },
  };
  const client = loadTypeScript("src/robot-bridge/companion-client.ts", { "./runtime": boundary }, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : {};
      const result = path === "/api/apps/status" ? { installed: [], running: null, jobs: [] }
        : path === "/api/apps/ensure-start" ? { id: "native-job", requestId: body.requestId, spaceId: catalogItem.spaceId, revision: REV, phase: "running", state: "running" }
          : path.startsWith("/api/apps/jobs/") ? { id: "native-job", spaceId: catalogItem.spaceId, revision: REV, phase: "running", state: "running" }
            : { state: "stopped" };
      return { ok: true, status: 200, text: async () => JSON.stringify(result) };
    },
  });
  const runtime = loadTypeScript("src/robot-bridge/app-skill-runtime.ts", {
    "react-native": { AppState, Platform: { OS: "ios" } },
    "expo-secure-store": {
      async getItemAsync(key) { assert.equal(key, "looi-robot-app-skills-v1"); await preferenceBarrier?.promise; return preference; },
      async setItemAsync(key, value) { writes.push({ key, value }); await writeBehavior?.(writes.length, key, value); preference = value; },
    },
    "expo-web-browser": { openBrowserAsync() { opened++; return browser.promise; }, dismissBrowser() { dismissed++; browser.resolve({ type: "dismiss" }); } },
    "./app-catalog": { createAppCatalog: () => ({ async list() { return { items: [catalogItem], total: 1, stale: false }; }, async get() { return catalogItem; } }) },
    "./app-skills": skillCore, "./companion-client": client, "./runtime": boundary,
    "../store/user": { useUserStore: { getState: () => state, subscribe(fn) { userListeners.add(fn); return () => userListeners.delete(fn); } } },
    "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => robot, subscribeLooiRobotRuntimeState(fn) { robotListener = fn; return () => { robotListener = undefined; }; } },
  });
  const uninstall = runtime.installRobotAppSkillRuntime();
  return { runtime, uninstall, requests, writes, state, AppState, browser,
    release(cause) { for (const fn of released) fn(cause); },
    config(next) { configuration = next; },
    stopPhysical() { robot.stopGeneration++; robot.safety.lastSafetyStopReason = "voice-stop"; robotListener?.(); },
    counts: () => ({ opened, dismissed, stopped }),
    preference: () => preference,
  };
}

// The actual native facade loads the opted-in policy and uses the production
// engine + authenticated client, with only native storage/network boundaries fake.
{
  const test = setup();
  try {
    assert.deepEqual(await test.runtime.loadRobotAppSkillSettings(), { enabled: true });
    const found = await test.runtime.searchRobotAppSkills("clock");
    assert.equal(found.items[0].spaceId, "pollen/clock");
    assert.equal((await test.runtime.startRobotAppSkill("pollen/clock")).status, "running");
    const admission = test.requests.find(x => x.url.endsWith("/api/apps/ensure-start"));
    assert.ok(admission);
    assert.equal(admission.options.headers.Authorization, `Bearer ${"b".repeat(48)}`);
    assert.equal(JSON.parse(admission.options.body).spaceId, "pollen/clock");
    test.config({ url: "wss://replacement.invalid/device", token: "c".repeat(48) });
    test.stopPhysical(); await flush();
    const stop = test.requests.find(x => x.url.endsWith("/api/apps/stop"));
    assert.equal(new URL(stop.url).host, "unused.invalid", "STOP stays bound to the admitted companion");
    assert.equal(stop.options.headers.Authorization, `Bearer ${"b".repeat(48)}`);
    assert.ok(JSON.parse(stop.options.body).requestId, "STOP targets the admitted operation before/after job response");
    await test.runtime.configureRobotAppSkillSettings({ enabled: false });
    assert.equal(test.writes.at(-1).key, "looi-robot-app-skills-v1", "skill policy never rewrites connection credentials");
    const count = test.requests.length;
    assert.equal((await test.runtime.startRobotAppSkill("pollen/clock")).status, "disabled");
    assert.equal(test.requests.length, count);
  } finally { test.uninstall(); await flush(); }
}

// A STOP during SecureStore loading must invalidate admission before any HTTP.
{
  const barrier = deferred();
  const test = setup({ preferenceBarrier: barrier });
  const pending = test.runtime.startRobotAppSkill("pollen/clock");
  test.release("user-stop");
  barrier.resolve();
  assert.equal((await pending).status, "cancelled");
  assert.equal(test.requests.length, 0);
  test.uninstall(); await flush();
}

// Corrupt settings fail closed until the user explicitly repairs the policy.
{
  const test = setup({ initialPreference: "{invalid" });
  await assert.rejects(test.runtime.loadRobotAppSkillSettings());
  assert.equal(test.runtime.getRobotAppSkillsSnapshot().enabled, false);
  assert.equal(test.requests.length, 0);
  await test.runtime.configureRobotAppSkillSettings({ enabled: false });
  assert.deepEqual(await test.runtime.loadRobotAppSkillSettings(), { enabled: false });
  test.uninstall(); await flush();
}

// A failed OFF write fails closed in memory and the skill facade, even though SecureStore still has ON.
{
  const previous = JSON.stringify({ schemaVersion: 1, enabled: true });
  const test = setup({ initialPreference: previous, writeBehavior: async () => { throw new Error("SecureStore unavailable"); } });
  try {
    assert.deepEqual(await test.runtime.loadRobotAppSkillSettings(), { enabled: true });
    await assert.rejects(test.runtime.configureRobotAppSkillSettings({ enabled: false }));
    assert.equal(test.preference(), previous, "failed native persistence does not pretend to have committed");
    assert.equal(test.runtime.getRobotAppSkillsSnapshot().enabled, false, "the effective snapshot stays off after a failed write");
    const requestCount = test.requests.length;
    assert.equal((await test.runtime.startRobotAppSkill("pollen/clock")).status, "disabled");
    assert.equal(test.requests.length, requestCount, "the AI cannot start another app after fail-closed OFF");
  } finally { test.uninstall(); await flush(); }
}

// Setting updates are serialized as whole operations, so an earlier slow OFF write cannot land after a later ON.
{
  const firstWrite = deferred();
  const secondWrite = deferred();
  const test = setup({
    initialPreference: JSON.stringify({ schemaVersion: 1, enabled: true }),
    writeBehavior: async (number) => { await (number === 1 ? firstWrite.promise : secondWrite.promise); },
  });
  try {
    await test.runtime.loadRobotAppSkillSettings();
    const disable = test.runtime.configureRobotAppSkillSettings({ enabled: false });
    const enable = test.runtime.configureRobotAppSkillSettings({ enabled: true });
    await waitUntil(() => test.writes.length === 1, "first settings write begins");
    assert.equal(test.runtime.getRobotAppSkillsSnapshot().enabled, false, "OFF takes effect before waiting for persistence");
    await flush();
    assert.equal(test.writes.length, 1, "the later write waits for the complete earlier update");
    firstWrite.resolve();
    await disable;
    await waitUntil(() => test.writes.length === 2, "second settings write begins after the first commits");
    secondWrite.resolve();
    await enable;
    assert.deepEqual(JSON.parse(test.preference()), { schemaVersion: 1, enabled: true });
    assert.equal(test.runtime.getRobotAppSkillsSnapshot().enabled, true, "memory and the final persisted choice agree");
  } finally { firstWrite.resolve(); secondWrite.resolve(); test.uninstall(); await flush(); }
}

// The actual panel shows OFF after a load error, a retryable STOP after runtime uncertainty, and a distinct browser-released state.
{
  function loadPanel({ snapshot, loadSettings, configureSettings = async () => undefined }) {
    const values = [];
    let cursor = 0;
    const effects = [];
    const React = {
      createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
      useMemo(factory) { cursor += 1; return factory(); },
      useState(initial) {
        const slot = cursor++;
        if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial;
        return [values[slot], value => { values[slot] = value; }];
      },
      useEffect(effect) { effects.push(effect); },
    };
    const ui = {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", StyleSheet: { create: value => value },
      Switch: "Switch", Text: "Text", View: "View",
    };
    const deps = {
      react: React, "react-native": ui,
      "../i18n/use-ui-text": { useUiText: () => ({ language: "en" }) },
      "../i18n/robot-app-skill-strings": { createRobotAppSkillsTranslator: () => key => key },
      "../robot-bridge/app-skills": {},
      "../robot-bridge/app-skill-runtime": {
        getRobotAppSkillsSnapshot: () => snapshot,
        loadRobotAppSkillSettings: loadSettings,
        configureRobotAppSkillSettings: configureSettings,
        stopRobotAppSkills: async () => ({ status: "stopped" }),
        subscribeRobotAppSkills: () => () => undefined,
      },
      "./looi-theme": { looiTheme: { cyan: "cyan", danger: "danger", line: "line", muted: "muted", rail: "rail", text: "text" } },
    };
    const output = ts.transpileModule(fs.readFileSync("src/ui/RobotAppSkillsPanel.tsx", "utf8"), {
      fileName: "RobotAppSkillsPanel.tsx",
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "React", output)((name) => {
      assert.ok(name in deps, `unexpected panel dependency ${name}`);
      return deps[name];
    }, module, module.exports, React);
    const render = () => { cursor = 0; effects.length = 0; return module.exports.RobotAppSkillsPanel({ onBrowse() {}, onSetup() {}, companionReady: true }); };
    const tree = render();
    for (const effect of effects) effect();
    return { tree, render, flush, values };
  }
  const walk = (node, predicate, found = []) => {
    if (!node || typeof node !== "object") return found;
    if (predicate(node)) found.push(node);
    for (const child of node.children ?? []) walk(child, predicate, found);
    return found;
  };
  const base = { enabled: false, suspended: false, status: "disabled", activeApp: null, errorCode: "disabled", updatedAt: 1 };
  const repairs = [];
  const failedLoad = loadPanel({ snapshot: base, loadSettings: async () => { throw new Error("read failed"); }, configureSettings: async value => repairs.push(value) });
  await failedLoad.flush();
  const failedTree = failedLoad.render();
  const failedSwitch = walk(failedTree, node => node.type === "Switch")[0];
  assert.equal(failedSwitch.props.value, false, "settings load errors cannot render the switch as ON");
  assert.equal(failedSwitch.props.disabled, true);
  assert.equal(walk(failedTree, node => node.type === "Text").some(node => node.children.includes("loadError")), true);
  const repairButton = walk(failedTree, node => node.type === "Pressable" && node.children.some(child => child?.children?.includes("resetSetting")))[0];
  assert.ok(repairButton, "a corrupt setting has an explicit repair route instead of an endless retry-only loop");
  repairButton.props.onPress(); await failedLoad.flush();
  assert.deepEqual(repairs, [{ enabled: false }], "repair saves an explicit OFF policy, without silently enabling AI apps");

  const uncertain = loadPanel({
    snapshot: { ...base, enabled: true, status: "unavailable", activeApp: { spaceId: "pollen/clock", title: "Clock" }, errorCode: "stop_failed" },
    loadSettings: async () => ({ enabled: true }),
  });
  await uncertain.flush();
  const uncertainTree = uncertain.render();
  const uncertainLabels = walk(uncertainTree, node => node.type === "Text").flatMap(node => node.children);
  assert.equal(uncertainLabels.includes("stopFailed"), true, "an unconfirmed stop uses its own error label rather than claiming a start failure or idle");
  assert.equal(walk(uncertainTree, node => node.type === "Pressable" && node.props.accessibilityRole === "button").some(node => node.children.some(child => child?.children?.includes("stop"))), true, "a retained active app still exposes retry STOP");

  const handoff = loadPanel({ snapshot: { ...base, status: "handoff_released", errorCode: null }, loadSettings: async () => ({ enabled: false }) });
  await handoff.flush();
  const handoffLabels = walk(handoff.render(), node => node.type === "Text").flatMap(node => node.children);
  assert.equal(handoffLabels.includes("browserReleased"), true, "handoff_released has a dedicated translated state even when selection is OFF");
}

// Hosted handoff returns promptly while Safari is open; stop dismisses the owned
// browser and the local robot connection without recursive STOP observers.
{
  const test = setup({ kind: "web" });
  assert.equal((await test.runtime.startRobotAppSkill("pollen/console")).status, "handoff_requested");
  assert.equal(test.counts().opened, 1);
  assert.equal((await test.runtime.stopRobotAppSkills()).status, "stopped");
  assert.equal(test.counts().dismissed, 1);
  assert.equal(test.counts().stopped, 1);
  assert.equal(test.requests.length, 0);
  test.uninstall(); await flush();
}

// The app-state release emitted by the owned Safari presentation preserves its handoff.
{
  const test = setup({ kind: "web" });
  assert.equal((await test.runtime.startRobotAppSkill("pollen/console")).status, "handoff_requested");
  test.release("app-state-change");
  await flush();
  assert.equal(test.runtime.getRobotAppSkillsSnapshot().status, "handoff_requested");
  assert.equal(test.counts().dismissed, 0, "the browser's own inactive transition is not a stop");
  await test.runtime.stopRobotAppSkills();
  assert.equal(test.counts().dismissed, 1, "an explicit STOP still dismisses the presentation");
  test.uninstall(); await flush();
}

// Suspension while Central is still preparing prevents a later browser launch.
{
  const barrier = deferred();
  const test = setup({ kind: "web", prepareBarrier: barrier });
  const launch = test.runtime.startRobotAppSkill("pollen/console");
  await flush();
  test.release("user-stop"); barrier.resolve();
  const result = await launch;
  assert.ok(["stopped", "stale_turn", "suspended"].includes(result.status));
  assert.equal(test.counts().opened, 0);
  test.uninstall(); await flush();
}
console.log("robot app native skill runtime: policy, real client/engine admission, pinned STOP, late loads and hosted handoff passed");
