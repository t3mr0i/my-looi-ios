import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { loadRobotCapabilityModules } from "./helpers/robot-capability-modules.mjs";

const { sceneCatalog, definitions } = loadRobotCapabilityModules();
const explicit = loadTypeScript("src/voice/explicit-robot-command.ts");
const tools = loadTypeScript("src/voice/robot-capability-tools.ts", {
  "./robot-capability-tool-definitions": definitions,
  "../character/character-scene-catalog": sceneCatalog,
  "./explicit-robot-command": explicit,
  "../store/user": { useUserStore: { getState: () => ({ preferences: { robotName: "LOOI", listeningLanguage: "de" } }) } },
  "../robot-mind/expression": { robotExpressionConductor: { expressFromModel() { throw new Error("tests inject the runtime"); }, notePhysicalAction() {} } },
});

// --- Manifest: one source for prompt and tools -----------------------------
assert.deepEqual(definitions.ROBOT_CAPABILITY_TOOLS.map((tool) => tool.name), ["play_scene", "perform_gesture", "move_robot", "stop_robot", "express"]);
// The turn-bound action tools; express belongs to the reply, not to a user turn.
assert.deepEqual([...definitions.ROBOT_CAPABILITY_TOOL_NAMES], ["play_scene", "perform_gesture", "move_robot", "stop_robot"]);
assert.equal(definitions.ROBOT_EXPRESSION_TOOL_NAME, "express");
const sceneTool = definitions.ROBOT_CAPABILITY_TOOLS[0];
assert.deepEqual(sceneTool.parameters.properties.scene.enum, sceneCatalog.CHARACTER_SCENES.map((scene) => scene.id), "every catalog scene is selectable and nothing else");
for (const scene of sceneCatalog.CHARACTER_SCENES) {
  assert.ok(sceneTool.description.includes(`${scene.id}=${scene.label.en}`), `the catalog text names ${scene.id}`);
}
const moveTool = definitions.ROBOT_CAPABILITY_TOOLS[2];
assert.deepEqual(Object.keys(moveTool.parameters.properties), ["action"], "no speed, duration or distance can be requested");
assert.ok(definitions.buildStrictRobotCapabilityTools().every((tool) => tool.strict === true
  && tool.parameters.additionalProperties === false
  && tool.parameters.required.length === Object.keys(tool.parameters.properties).length));

const realtimePrompt = definitions.buildRobotCapabilityInstructions({ mode: "realtime" });
assert.match(realtimePrompt, /never as a generic voice assistant/u);
assert.match(realtimePrompt, /call play_scene with the best matching id first/u);
assert.match(realtimePrompt, /If the person says stop, halt or wait, call stop_robot immediately/u);
assert.match(realtimePrompt, /Say you did something only after its result has ok true/u);
const turnBasedPrompt = definitions.buildRobotCapabilityInstructions({ mode: "turn-based" });
assert.match(turnBasedPrompt, /refused with requires_realtime/u);
assert.doesNotMatch(turnBasedPrompt, /drives one short bounded step/u);
const noToolPrompt = definitions.buildRobotCapabilityInstructions({ mode: "turn-based", toolsAvailable: false });
assert.match(noToolPrompt, /You have no action tool in this turn/u);
assert.doesNotMatch(noToolPrompt, /call play_scene/u);

// --- Executor --------------------------------------------------------------
function createHarness(overrides = {}) {
  const calls = [];
  const physicalNotes = [];
  let displayAvailable = true;
  const runtime = {
    isScene: (scene) => sceneCatalog.isCharacterScene(scene),
    async playScene(scene, sessionId) { calls.push(["scene", scene, sessionId]); return displayAvailable; },
    async nod(count) { calls.push(["nod", count]); return { ok: true, completed: true, gesture: "nod", count, wheelsUsed: false }; },
    async dance() { calls.push(["dance"]); return { ok: true, style: "happy-sway-v1", wheelsUsed: true, bounded: true }; },
    async move(direction) { calls.push(["move", direction]); return { ok: true, direction, durationMs: 400, safetyBounded: true, completed: true }; },
    async turn(direction, degrees) { calls.push(["turn", direction, degrees]); return { ok: true, direction, degrees, completed: true }; },
    async stop(reason) { calls.push(["stop", reason]); },
    isStopRequest: (text) => explicit.containsEmergencyStopWord(text, { listeningLanguage: "de" }),
    express(intent, reply) { calls.push(["express", intent, reply.replyId]); return true; },
    notePhysicalAction() { physicalNotes.push(calls.length); },
    ...overrides,
  };
  return { calls, physicalNotes, bridge: tools.createRobotCapabilityToolBridge(runtime), setDisplay(value) { displayAvailable = value; } };
}
let current = true;
const turn = (userText, revision = 1, extra = {}) => ({ sessionId: "voice-1", userTurnRevision: revision, userText, isCurrent: () => current, ...extra });

{
  const { calls, bridge, setDisplay } = createHarness();
  const played = await bridge.execute("play_scene", { scene: "coffee" }, turn("Trink mal einen Kaffee."));
  assert.deepEqual(played, { ok: true, status: "scene_queued", scene: "coffee", kind: "display_animation", starts: "after_reply" });
  assert.deepEqual(calls, [["scene", "coffee", "voice-1"]]);
  assert.equal((await bridge.execute("play_scene", { scene: "espresso-martini" }, turn("x"))).status, "invalid-arguments");
  assert.equal((await bridge.execute("play_scene", { scene: "coffee", loop: true }, turn("x"))).status, "invalid-arguments");
  setDisplay(false);
  const hidden = await bridge.execute("play_scene", { scene: "tea" }, turn("Zeig mir Tee."));
  assert.equal(hidden.ok, false);
  assert.equal(hidden.status, "unavailable", "the model is told when the display cannot show the scene");
  assert.equal(calls.length, 2, "invalid scenes never reach the display");
}

{
  const { calls, bridge } = createHarness();
  const forward = await bridge.execute("move_robot", { action: "forward" }, turn("Komm ein Stück näher."));
  assert.equal(forward.ok, true);
  assert.equal(forward.status, "completed");
  assert.equal(forward.durationMs, 400);
  assert.equal((await bridge.execute("move_robot", { action: "turn_around" }, turn("Komm ein Stück näher."))).ok, true);
  assert.equal((await bridge.execute("perform_gesture", { gesture: "nod", count: 3 }, turn("Komm ein Stück näher."))).ok, true);
  const fourth = await bridge.execute("move_robot", { action: "backward" }, turn("Komm ein Stück näher."));
  assert.deepEqual([fourth.ok, fourth.reason], [false, "too_many_actions_this_turn"]);
  assert.deepEqual(calls, [["move", "forward"], ["turn", "right", 180], ["nod", 3]]);
  assert.equal((await bridge.execute("move_robot", { action: "turn_left" }, turn("Dreh dich nach links.", 2))).ok, true, "a new user turn gets a fresh budget");
  assert.deepEqual(calls.at(-1), ["turn", "left", 90]);
  for (const bad of [{ action: "spin" }, { action: "forward", durationMs: 9000 }, { direction: "forward" }, {}]) {
    assert.equal((await bridge.execute("move_robot", bad, turn("Fahr los.", 3))).status, "invalid-arguments");
  }
  assert.equal((await bridge.execute("perform_gesture", { gesture: "nod", count: 9 }, turn("Nick.", 3))).status, "invalid-arguments");
  assert.equal((await bridge.execute("perform_gesture", { gesture: "wave" }, turn("Wink.", 3))).status, "invalid-arguments");
  assert.equal((await bridge.execute("open_gripper", {}, turn("x", 3))).status, "unsupported-tool");
  assert.equal((await bridge.execute("move_robot", null, turn("x", 3))).status, "invalid-arguments");
}

{
  // STOP always wins: in the user's words, and after the model's own stop call.
  const { calls, bridge } = createHarness();
  const blocked = await bridge.execute("move_robot", { action: "forward" }, turn("Stopp, nicht weiterfahren!"));
  assert.deepEqual([blocked.ok, blocked.reason], [false, "stop_requested"]);
  const stopped = await bridge.execute("stop_robot", {}, turn("Warte mal kurz.", 2));
  assert.deepEqual(stopped, { ok: true, status: "stopped", action: "stop" });
  const afterStop = await bridge.execute("perform_gesture", { gesture: "dance", count: null }, turn("Warte mal kurz.", 2));
  assert.equal(afterStop.reason, "stop_requested");
  assert.deepEqual(calls, [["stop", "assistant-tool-stop"]]);
  assert.equal((await bridge.execute("stop_robot", { force: true }, turn("x", 3))).status, "invalid-arguments");
}

{
  // Movement needs a committed user request and the current turn.
  const { calls, bridge } = createHarness();
  assert.equal((await bridge.execute("move_robot", { action: "forward" }, turn("   "))).reason, "no_current_user_request");
  current = false;
  assert.equal((await bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor."))).status, "stale-turn");
  current = true;
  assert.deepEqual(calls, []);
}

{
  // Turn-based voice: wheels stay parked, nod, scenes and STOP still work.
  const { calls, bridge } = createHarness();
  const parked = { allowWheelMotion: false };
  assert.equal((await bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor.", 1, parked))).status, "requires_realtime");
  assert.equal((await bridge.execute("perform_gesture", { gesture: "dance", count: null }, turn("Tanz.", 2, parked))).status, "requires_realtime");
  assert.equal((await bridge.execute("perform_gesture", { gesture: "nod", count: null }, turn("Nick mal.", 3, parked))).ok, true);
  assert.equal((await bridge.execute("play_scene", { scene: "read" }, turn("Lies ein Buch.", 4, parked))).ok, true);
  assert.equal((await bridge.execute("stop_robot", {}, turn("Halt.", 5, parked))).ok, true);
  assert.deepEqual(calls, [["nod", 1], ["scene", "read", "voice-1"], ["stop", "assistant-tool-stop"]]);
}

{
  // Interlocks and failures are reported, never turned into success.
  const { bridge } = createHarness({
    async move() { return { ok: false, direction: "forward", durationMs: 120, safetyBounded: true, completed: false }; },
    async turn() { throw new Error("BLE device AA:BB:CC not connected"); },
  });
  const cut = await bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor."));
  assert.deepEqual([cut.ok, cut.status], [false, "blocked"]);
  const failed = await bridge.execute("move_robot", { action: "turn_left" }, turn("Fahr vor."));
  assert.deepEqual([failed.ok, failed.status], [false, "failed"]);
  assert.doesNotMatch(JSON.stringify(failed), /AA:BB:CC/u, "internal error text is not passed to the model");
}

{
  // Two calls from one response run one after another on the motors.
  let running = 0, overlap = false;
  const order = [];
  const slow = (label) => async () => { running += 1; overlap ||= running > 1; await new Promise((done) => setTimeout(done, 15)); order.push(label); running -= 1; return { ok: true, completed: true }; };
  const { bridge } = createHarness({ move: slow("move"), turn: slow("turn") });
  await Promise.all([
    bridge.execute("move_robot", { action: "forward" }, turn("Fahr vor und dreh dich um.")),
    bridge.execute("move_robot", { action: "turn_around" }, turn("Fahr vor und dreh dich um.")),
  ]);
  assert.equal(overlap, false);
  assert.deepEqual(order, ["move", "turn"]);
}

// --- Expression: one tool for Realtime, one text tag for turn-based ---------
{
  const intents = ["neutral", "happy", "playful", "agreeing", "curious", "thinking", "surprised", "sad", "calm"];
  assert.deepEqual(definitions.ROBOT_EXPRESSION_INTENTS, intents);
  const expressTool = definitions.ROBOT_CAPABILITY_TOOLS.find((tool) => tool.name === "express");
  assert.deepEqual(expressTool.parameters.properties.intent.enum, intents);
  assert.equal(expressTool.parameters.additionalProperties, false);
  assert.match(expressTool.description, /never instead of speaking/u);
  assert.match(expressTool.description, /needs no answer/u);
  assert.equal(definitions.buildStrictRobotCapabilityTools().some((tool) => tool.name === "express"), false, "turn-based mode gets the tag, not an extra tool round");
  for (const intent of intents) {
    const head = definitions.ROBOT_EXPRESSION_VOCABULARY[intent].head;
    if (head) assert.ok(["nod", "curious", "happy_bob", "thinking", "speaking_soft"].includes(head.gesture), `${intent} uses a head-only gesture`);
  }
  for (const quiet of ["neutral", "sad", "calm"]) assert.equal(definitions.ROBOT_EXPRESSION_VOCABULARY[quiet].head, null, `${quiet} keeps the head still`);
  assert.deepEqual(definitions.ROBOT_EXPRESSION_VOCABULARY.agreeing.head, { gesture: "nod", at: "speech_start" });
  assert.deepEqual(definitions.ROBOT_EXPRESSION_VOCABULARY.curious.head, { gesture: "curious", at: "speech_end" });

  assert.match(realtimePrompt, /call express with the one intent that fits/u);
  assert.match(realtimePrompt, /Serious, sad, worrying or distressing topics always get calm or sad/u);
  assert.doesNotMatch(realtimePrompt, /expression tag in square brackets/u);
  for (const prompt of [turnBasedPrompt, noToolPrompt]) {
    assert.match(prompt, /begin every reply with exactly one expression tag in square brackets/u);
    assert.match(prompt, /\[agreeing\]/u);
    assert.doesNotMatch(prompt, /call express/u);
  }

  assert.deepEqual(definitions.parseRobotExpressionTag("[happy] Oh, das klingt schön!"), { intent: "happy", text: "Oh, das klingt schön!" });
  assert.deepEqual(definitions.parseRobotExpressionTag("  [Curious]Was meinst du?"), { intent: "curious", text: "Was meinst du?" });
  assert.deepEqual(definitions.parseRobotExpressionTag("Ja. [agreeing] Genau. [sad]"), { intent: "agreeing", text: "Ja. Genau." }, "every tag is removed before speech; the first wins");
  assert.deepEqual(definitions.parseRobotExpressionTag("Kein Tag hier [x]."), { intent: null, text: "Kein Tag hier [x]." });

  const express = (name = "express") => ({ type: "function_call", name, call_id: "c" });
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "completed", output: [express()] }), true, "a face without words still owes the reply");
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "completed", output: [express(), { type: "message" }] }), false, "speech in the same response needs no follow-up");
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "completed", output: [{ type: "message" }, express()] }), false);
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "completed", output: [express(), express("play_scene")] }), false, "other tools request their own follow-up");
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "cancelled", output: [express()] }), false);
  assert.equal(definitions.robotExpressionNeedsSpokenFollowup({ status: "completed", output: [] }), false);
}

{
  const { calls, bridge } = createHarness();
  let replyCurrent = true;
  const reply = { sessionId: "voice-1", replyId: "resp-1", isCurrent: () => replyCurrent };
  assert.deepEqual(bridge.express({ intent: "agreeing" }, reply), { ok: true, status: "expressed", intent: "agreeing" });
  assert.equal(bridge.express({ intent: "angry" }, reply).status, "invalid-arguments");
  assert.equal(bridge.express({ intent: "happy", gesture: "dance" }, reply).status, "invalid-arguments");
  assert.equal(bridge.express(null, reply).status, "invalid-arguments");
  replyCurrent = false;
  assert.equal(bridge.express({ intent: "happy" }, reply).status, "stale-turn");
  assert.deepEqual(calls, [["express", "agreeing", "resp-1"]], "only valid, current expressions reach the face");
  const refused = createHarness({ express() { return false; } });
  assert.equal(refused.bridge.express({ intent: "sad" }, { ...reply, isCurrent: () => true }).status, "stale-turn");
}

{
  // An admitted gesture tells the expression that this reply's head is taken.
  const { calls, physicalNotes, bridge } = createHarness();
  await bridge.execute("perform_gesture", { gesture: "nod" }, turn("Nick mal.", 40));
  assert.deepEqual([physicalNotes, calls], [[0], [["nod", 1]]], "the head is claimed before the nod starts");
  await bridge.execute("play_scene", { scene: "coffee" }, turn("Trink Kaffee.", 41));
  assert.equal(physicalNotes.length, 1, "a display scene does not take the head");
}

console.log("Robot capability manifest and tool bridge tests passed");
