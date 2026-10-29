import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const definitions = loadTypeScript("src/voice/robot-app-skill-tool-definitions.ts");
const calls = [];
let current = true;
const catalog = [
  { spaceId: "pollen/dance-demo", title: "Dance demo", description: "A small dance app", kind: "python" },
  { spaceId: "pollen/face-demo", title: "Face demo", description: "A face app", kind: "web" },
];
const runtime = {
  async searchRobotAppSkills(query, limit) {
    calls.push({ method: "search", query, limit });
    return { status: "listed", items: catalog.slice(0, limit) };
  },
  async describeRobotAppSkill(spaceId) {
    calls.push({ method: "describe", spaceId });
    return { status: "described", app: catalog.find((item) => item.spaceId === spaceId) ?? null };
  },
  async startRobotAppSkill(spaceId, options) {
    calls.push({ method: "start", spaceId, isCurrent: options?.isCurrent });
    if (!options?.isCurrent?.()) return { status: "stopped", reason: "stale" };
    return { status: "installing", spaceId };
  },
  async stopRobotAppSkills() {
    calls.push({ method: "stop" });
    return { status: "stopped" };
  },
};
const tools = loadTypeScript("src/voice/robot-app-skill-tools.ts", {
  "./robot-app-skill-tool-definitions": definitions,
  "../robot-bridge/app-skill-runtime": runtime,
});
const bridge = tools.createRobotAppSkillToolBridge(runtime);
const turn = {
  sessionId: "voice-session-1",
  userTurnRevision: 8,
  userText: "Find a suitable dance app and try it.",
  isCurrent: () => current,
};

assert.deepEqual(definitions.ROBOT_APP_SKILL_TOOLS.map((tool) => tool.name), [
  "search_robot_apps", "describe_robot_app", "start_robot_app", "stop_robot_app",
]);
assert.equal(definitions.ROBOT_APP_SKILL_TOOLS.length, 4, "the model sees a small fixed dispatcher, not one tool per catalog app");
assert.match(definitions.ROBOT_APP_SKILL_TOOLS.find((tool) => tool.name === "stop_robot_app").description, /handoff_released.*closure was not confirmed/u);

const found = await bridge.execute("search_robot_apps", { query: "dance", limit: 2 }, turn);
assert.equal(found.ok, true);
assert.equal(found.status, "listed");
assert.deepEqual(calls[0], { method: "search", query: "dance", limit: 2 });
const defaultLimit = await bridge.execute("search_robot_apps", { query: "dance", limit: null }, turn);
assert.equal(defaultLimit.ok, true, "strict Responses schema null uses the shared default limit");
assert.deepEqual(calls[1], { method: "search", query: "dance", limit: 5 });

const described = await bridge.execute("describe_robot_app", { space_id: "pollen/dance-demo" }, turn);
assert.equal(described.ok, true);
assert.equal(described.app.title, "Dance demo");

const started = await bridge.execute("start_robot_app", { space_id: "pollen/dance-demo" }, turn);
assert.equal(started.ok, true);
assert.equal(started.status, "installing", "an install admission must not be reported as a running app");
assert.equal(calls[3].method, "start");
assert.equal(calls[3].isCurrent(), true, "the native runtime receives the live-turn admission guard");

const duplicateStart = await bridge.execute("start_robot_app", { space_id: "pollen/dance-demo" }, turn);
assert.equal(duplicateStart.ok, false);
assert.equal(duplicateStart.status, "already-started-this-turn");
assert.equal(calls.filter((call) => call.method === "start").length, 1);

const stopped = await bridge.execute("stop_robot_app", {}, turn);
assert.deepEqual(stopped, { ok: true, status: "stopped" });

current = false;
const staleStart = await bridge.execute("start_robot_app", { space_id: "pollen/face-demo" }, turn);
assert.equal(staleStart.status, "stale-turn");
assert.equal(calls.filter((call) => call.method === "start").length, 1, "a stale response cannot launch an app");

current = true;
for (const [name, args] of [
  ["search_robot_apps", { query: "x".repeat(121) }],
  ["search_robot_apps", { query: "dance", limit: 11 }],
  ["describe_robot_app", { space_id: "https://huggingface.co/spaces/pollen/dance-demo" }],
  ["start_robot_app", { space_id: "pollen/dance-demo", extra: true }],
  ["stop_robot_app", { all: true }],
]) {
  const result = await bridge.execute(name, args, turn);
  assert.equal(result.ok, false, `${name} rejects invalid arguments`);
}

const failedRuntime = tools.createRobotAppSkillToolBridge({
  ...runtime,
  async searchRobotAppSkills() { throw new Error("private service detail"); },
});
const failed = await failedRuntime.execute("search_robot_apps", { query: "dance" }, turn);
assert.deepEqual(failed, { ok: false, status: "unavailable" }, "internal exception text is not returned to the model");

for (const result of [
  { status: "unavailable", errorCode: "catalog_unavailable" },
  { status: "busy", errorCode: "app_busy" },
  { status: "handoff_failed", errorCode: "hosted_open_failed" },
  { status: "handoff_released" },
  { status: "stale_turn", errorCode: "stale_turn" },
  { status: "not_found" },
  { status: "not_installable" },
]) {
  const statusBridge = tools.createRobotAppSkillToolBridge({
    ...runtime,
    async searchRobotAppSkills() { return result; },
  });
  const normalized = await statusBridge.execute("search_robot_apps", { query: "dance" }, turn);
  assert.equal(normalized.ok, false, `${result.status} is a truthful refusal/failure`);
  assert.equal(normalized.status, result.status);
}

for (const status of ["installing", "starting", "running", "handoff_requested", "complete", "stopped", "listed", "described"]) {
  const statusBridge = tools.createRobotAppSkillToolBridge({
    ...runtime,
    async searchRobotAppSkills() { return { status }; },
  });
  const normalized = await statusBridge.execute("search_robot_apps", { query: "dance" }, turn);
  assert.equal(normalized.ok, true, `${status} is a reported runtime/catalog state, not a failure`);
  assert.equal(normalized.status, status);
}

console.log("Robot app skill voice tools: PASS");
