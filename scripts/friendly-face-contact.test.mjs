import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const homePath = "app/(tabs)/index.tsx";
const homeSource = fs.readFileSync(homePath, "utf8");
const sourceFile = ts.createSourceFile(homePath, homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tapRouting = loadTypeScript("src/character/face-tap-routing.ts");

// Evaluate the callback expression that HomeScreen actually defines. This lets
// the test provide deterministic app stores and control services without
// reimplementing the callback's routing logic.
function callbackExpression(name) {
  let result = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      const initializer = node.initializer;
      assert.ok(initializer && ts.isCallExpression(initializer), `${name} is a callback declaration`);
      assert.equal(initializer.expression.getText(sourceFile), "useCallback", `${name} remains a React callback`);
      result = initializer.arguments[0];
    }
    if (result === null) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(result && ts.isArrowFunction(result), `found actual ${name} callback in HomeScreen`);
  return result.getText(sourceFile);
}

const handleFaceContactSource = callbackExpression("handleFaceContactStart");
const handleFriendlyStrokeSource = callbackExpression("handleFriendlyStroke");

function readRobotFaceProps() {
  let props = null;
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === "RobotFace") props = node.attributes.properties;
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === "RobotFace") props = node.attributes.properties;
    if (props === null) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(props, "HomeScreen renders RobotFace");
  return props;
}

const faceProps = readRobotFaceProps();
function prop(name) { return faceProps.find((item) => ts.isJsxAttribute(item) && item.name.getText(sourceFile) === name); }
assert.equal(prop("onContactStart")?.initializer?.expression?.getText(sourceFile), "handleFaceContactStart",
  "the face's contact-start callback is connected to Home control routing");
assert.equal(prop("onFriendlyStroke")?.initializer?.expression?.getText(sourceFile), "handleFriendlyStroke",
  "the face's friendly stroke callback is connected to Home behavior");
const onPressProp = prop("onPress");
assert.ok(onPressProp?.initializer && ts.isJsxExpression(onPressProp.initializer) && ts.isArrowFunction(onPressProp.initializer.expression),
  "Home preserves a real press callback for wake and voice attention");
const onPressSource = onPressProp.initializer.expression.getText(sourceFile);

function makeHomeHarness(overrides = {}) {
  const environment = {
    robot: { motionActive: false },
    drivingSessionActive: false,
    conversation: { isProcessing: false, isSpeaking: false, isUserSpeaking: false },
    user: { voiceState: "attention", robotSleeping: false },
    appState: { currentState: "active" },
    focused: true,
    behavior: { feedback: null },
    ...overrides,
  };
  const calls = { triggers: [], reactions: [], diagnostics: [], clearedTimers: [], warnings: [], affection: [] };
  const idleTapTimerRef = { current: null };
  const idleTapCountRef = { current: 0 };
  const bindings = {
    cancelCharacterAction: () => {},
    getLooiRobotRuntimeState: () => environment.robot,
    useConversationStore: { getState: () => environment.conversation },
    useUserStore: { getState: () => environment.user },
    isDrivingControlSessionActive: () => environment.drivingSessionActive,
    classifyFaceTapImmediateRoute: tapRouting.classifyFaceTapImmediateRoute,
    idleTapTimerRef,
    idleTapCountRef,
    clearTimeout: (timer) => calls.clearedTimers.push(timer),
    recordDiagnosticEvent: (...args) => calls.diagnostics.push(args),
    voiceRuntime: { trigger: () => { calls.triggers.push("trigger"); return Promise.resolve(); } },
    AppState: environment.appState,
    isMainScreenFocused: () => environment.focused,
    useBehaviorStore: { getState: () => environment.behavior },
    triggerCharacterReaction: (...args) => calls.reactions.push(args),
    recordFriendlyStroke: () => { calls.affection.push("stroke"); return environment.affection ?? null; },
    handleFaceContactStart: null,
    console: { warn: (...args) => calls.warnings.push(args) },
  };
  bindings.handleFaceContactStart = new Function(...Object.keys(bindings), `return (${handleFaceContactSource});`)(...Object.values(bindings));
  bindings.handleFriendlyStroke = new Function(...Object.keys(bindings), `return (${handleFriendlyStrokeSource});`)(...Object.values(bindings));
  return { environment, calls, idleTapTimerRef, idleTapCountRef, bindings };
}

// Existing hard control ownership is evaluated synchronously on contact. The
// production route classifier is exercised, including its precedence order.
const startRoutes = [
  ["active motor", { robot: { motionActive: true } }, "driving-stop"],
  ["active drive session", { drivingSessionActive: true }, "driving-session-exit"],
  ["assistant output", { conversation: { isProcessing: false, isSpeaking: true, isUserSpeaking: false } }, "classic-interrupt"],
  ["conversation processing", { conversation: { isProcessing: true, isSpeaking: false, isUserSpeaking: false } }, "classic-interrupt"],
  ["speaking voice state", { user: { voiceState: "speaking", robotSleeping: false } }, "classic-interrupt"],
  ["processing voice state", { user: { voiceState: "processing", robotSleeping: false } }, "classic-interrupt"],
  ["verifying voice state", { user: { voiceState: "verifying", robotSleeping: false } }, "classic-interrupt"],
];
for (const [label, overrides, expectedRoute] of startRoutes) {
  const harness = makeHomeHarness(overrides);
  harness.idleTapTimerRef.current = 71;
  harness.idleTapCountRef.current = 3;
  const consumed = harness.bindings.handleFaceContactStart();
  assert.equal(consumed, true, `${label} contact is consumed`);
  assert.deepEqual(harness.calls.triggers, ["trigger"], `${label} routes to voiceRuntime.trigger synchronously`);
  assert.equal(harness.calls.diagnostics[0]?.[2]?.route, expectedRoute, `${label} keeps existing control route`);
  assert.deepEqual(harness.calls.clearedTimers, [71], `${label} clears any pending ordinary tap burst`);
  assert.equal(harness.idleTapTimerRef.current, null);
  assert.equal(harness.idleTapCountRef.current, 0);
  assert.equal(harness.calls.reactions.length, 0, `${label} never creates a friendly reaction`);
}

{
  const harness = makeHomeHarness({ conversation: { isProcessing: false, isSpeaking: false, isUserSpeaking: false }, user: { voiceState: "listening", robotSleeping: false } });
  assert.equal(harness.bindings.handleFaceContactStart(), false, "passive listening remains available for the tap-burst path");
  assert.deepEqual(harness.calls.triggers, [], "passive listening does not interrupt on contact start");
}

{
  const harness = makeHomeHarness({ user: { voiceState: "speaking", robotSleeping: true } });
  assert.equal(harness.bindings.handleFaceContactStart(), false, "stale speech state cannot wake or interrupt a sleeping face without hard control motion");
  assert.deepEqual(harness.calls.triggers, []);
}

{
  const harness = makeHomeHarness({ robot: { motionActive: true }, user: { voiceState: "speaking", robotSleeping: true } });
  assert.equal(harness.bindings.handleFaceContactStart(), true, "real active motion keeps the emergency stop route while asleep");
  assert.deepEqual(harness.calls.triggers, ["trigger"]);
  assert.equal(harness.calls.diagnostics[0]?.[2]?.route, "driving-stop");
}

// A qualifying touch release records local affection and presents its result;
// it never starts a voice turn or robot movement.
{
  const harness = makeHomeHarness({ user: { voiceState: "sleeping", robotSleeping: false } });
  harness.idleTapTimerRef.current = 22;
  harness.idleTapCountRef.current = 2;
  harness.bindings.handleFriendlyStroke();
  assert.deepEqual(harness.calls.reactions, [["petted", { durationMs: 1100, source: "friendly-face-stroke" }]]);
  assert.deepEqual(harness.calls.affection, ["stroke"]);
  assert.deepEqual(harness.calls.triggers, [], "friendly stroke does not open or interrupt voice");
  assert.deepEqual(harness.calls.clearedTimers, [22]);
  assert.equal(harness.idleTapTimerRef.current, null);
  assert.equal(harness.idleTapCountRef.current, 0);
}

{
  const harness = makeHomeHarness({ affection: { durationMs: 1450 } });
  harness.bindings.handleFriendlyStroke();
  assert.equal(harness.calls.reactions[0][1].durationMs, 1450, "Home uses the actual relationship presentation result");
}

// Environmental and conversational states reject petting without a new cue.
for (const [label, overrides] of [
  ["deep sleep", { user: { voiceState: "sleeping", robotSleeping: true } }],
  ["backgrounded app", { appState: { currentState: "background" } }],
  ["unfocused route", { focused: false }],
  ["user is speaking", { conversation: { isProcessing: false, isSpeaking: false, isUserSpeaking: true } }],
  ["pending face repair feedback", { behavior: { feedback: { kind: "repair" } } }],
]) {
  const harness = makeHomeHarness(overrides);
  harness.bindings.handleFriendlyStroke();
  assert.deepEqual(harness.calls.reactions, [], `${label} suppresses petting`);
  assert.deepEqual(harness.calls.affection, [], `${label} cannot record affection`);
  assert.deepEqual(harness.calls.triggers, [], `${label} does not start a voice turn`);
}

// Control can take ownership after a stroke begins but before it ends. Home
// re-reads live stores at release, lets STOP/interruption win, and suppresses
// the friendly reaction.
for (const [label, update] of [
  ["motor motion", (environment) => { environment.robot.motionActive = true; }],
  ["driving session", (environment) => { environment.drivingSessionActive = true; }],
  ["assistant starts speaking", (environment) => { environment.conversation.isSpeaking = true; }],
  ["processing begins", (environment) => { environment.conversation.isProcessing = true; }],
  ["verifying begins", (environment) => { environment.user.voiceState = "verifying"; }],
]) {
  const harness = makeHomeHarness();
  assert.equal(harness.bindings.handleFaceContactStart(), false, `${label}: initial idle contact is not consumed`);
  update(harness.environment);
  harness.bindings.handleFriendlyStroke();
  assert.deepEqual(harness.calls.triggers, ["trigger"], `${label}: release observes fresh hard control ownership`);
  assert.deepEqual(harness.calls.reactions, [], `${label}: control ownership prevents petting`);
}

// Exercise the actual JSX onPress callback so the normal tap still wakes a
// sleeping robot and reaches the existing awake conversation path.
function invokeHomePress(robotSleeping) {
  const calls = { wakes: 0, awakeTaps: 0, warnings: [] };
  const sleepTapAtRef = { current: 8 };
  const callback = new Function("robotSleeping", "sleepTapAtRef", "wakeRobotFromFace", "handleAwakeFaceTap", "console",
    `return (${onPressSource});`)(robotSleeping, sleepTapAtRef, () => { calls.wakes += 1; return Promise.resolve(); },
      () => { calls.awakeTaps += 1; }, { warn: (...args) => calls.warnings.push(args) });
  callback();
  return { ...calls, sleepTapAtRef };
}
const wakePress = invokeHomePress(true);
assert.equal(wakePress.wakes, 1, "normal face press still starts wake flow");
assert.equal(wakePress.awakeTaps, 0, "sleeping press does not route into awake tap handling");
assert.equal(wakePress.sleepTapAtRef.current, 0, "wake press resets the face wake-tap interval");
const awakePress = invokeHomePress(false);
assert.equal(awakePress.awakeTaps, 1, "awake face press still reaches existing voice attention handling");
assert.equal(awakePress.wakes, 0);

console.log("Home face contact and friendly stroke callbacks: live routing, release ownership, sleep guard and wake press PASS");
