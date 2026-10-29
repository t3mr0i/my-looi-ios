import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const loadCharacterModule = createTypeScriptTreeLoader();
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const api = loadCharacterModule("src/character/character-action.ts");
for (const [text, kind] of [
  ["LOOI, hol einen Drink raus!", "drink"], ["Louis, kannst du bitte einen Drink nehmen?", "drink"],
  ["Bitte trink einen Schluck Wasser.", "drink"], ["Nimm einen Drink raus", "drink"],
  ["Mach eine Kaffeepause", "coffee"], ["Knabbere einen Keks", "snack"], ["Schlage ein Buch auf", "read"],
  ["Could you take a sip, please?", "drink"], ["Have a coffee", "coffee"], ["Eat a cookie", "snack"], ["Open a book", "read"],
  ["Выпей воды", "drink"], ["Выпей кофе", "coffee"], ["Съешь печенье", "snack"], ["Почитай книгу", "read"],
  ["Випий води", "drink"], ["Випий кави", "coffee"], ["З’їж печиво", "snack"], ["Відкрий книжку", "read"],
  ["Trink nicht etwas", null], ["Don't take a drink", null], ["Не выпей воды", null], ["Не випий води", null],
  ["Ich nehme einen Drink", null], ["Er sagte: ‘Trink etwas’", null], ["\"Trink etwas\"", null],
  ["Was ist eine Kaffeepause?", null], ["Lies ein Buch und fahr vorwärts", null],
]) assert.equal(api.parseCharacterActionRequest(text), kind, text);
assert.equal(api.parseCharacterActionRequest("R2.0, lies ein Buch", "R2.0"), "read");
assert.equal(api.parseCharacterActionRequest("x".repeat(601)), null);

function clock() {
  let now = 0, serial = 0;
  const jobs = new Map(), retired = [];
  return { now: () => now, jobs, retired,
    schedule(fn, delay) { const id = ++serial; jobs.set(id, { fn, at: now + delay }); return id; },
    unschedule(id) { const job = jobs.get(id); if (job) retired.push(job.fn); jobs.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const job = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!job) break;
        now = job[1].at; jobs.delete(job[0]); job[1].fn();
      }
      now = end;
    },
  };
}
for (const kind of api.CHARACTER_ACTIONS) {
  const timer = clock(), frames = [];
  const controller = api.createCharacterActionController({ ...timer, publish: s => frames.push(s.active?.phase ?? null) });
  assert.equal(controller.request(kind, "menu"), null, "uninstalled scene refuses requests");
  controller.setAvailability({ allowed: true, busy: false });
  controller.request(kind, "menu");
  timer.advance(6000);
  assert.deepEqual(frames.filter(Boolean), api.CHARACTER_ACTION_PHASES);
  assert.equal(controller.getState().active, null);
  assert.equal(timer.jobs.size, 0);
  for (const phase of api.CHARACTER_ACTION_PHASES) {
    const pose = api.getCharacterPropPose(kind, phase, true);
    assert.equal(pose.rotation, phase === "put-away" ? 16 : 0);
    assert.equal(pose.opacity, phase === "put-away" ? 0 : 1);
  }
}
{
  const timer = clock();
  const c = api.createCharacterActionController({ ...timer, publish() {} });
  c.setAvailability({ allowed: true, busy: true });
  c.request("drink", "voice", "s1");
  c.replyHeard("old-session"); c.setAvailability({ allowed: true, busy: false });
  assert.equal(c.getState().active, null, "voice request waits for matching completed reply");
  c.replyHeard("s1"); assert.equal(c.getState().active?.kind, "drink");
  c.setAvailability({ allowed: true, busy: true });
  assert.deepEqual(c.getState(), { active: null, pending: null }, "new speech retires scene");
  c.setAvailability({ allowed: true, busy: false });
  c.request("coffee", "menu"); c.request("snack", "menu");
  timer.retired.forEach(fn => fn());
  assert.equal(c.getState().active?.kind, "snack", "stale timers cannot replace latest request");
  c.setAvailability({ allowed: false, busy: false });
  timer.advance(6000); assert.deepEqual(c.getState(), { active: null, pending: null });
  c.setAvailability({ allowed: true, busy: true }); c.request("read", "voice", "s1");
  timer.advance(30_000); c.replyHeard("s1"); c.setAvailability({ allowed: true, busy: false });
  assert.equal(c.getState().active, null, "late reply cannot revive expired request");
}

// Run the real lifecycle adapter against observable stores and session events.
function store(initial) {
  let state = initial; const listeners = new Set();
  const fn = selector => selector(state);
  fn.getState = () => state;
  fn.setState = value => { state = { ...state, ...(typeof value === "function" ? value(state) : value) }; listeners.forEach(fn => fn()); };
  fn.subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  return fn;
}
{
  const timer = clock(), user = store({ robotSleeping: false, voiceState: "attention", preferences: { robotName: "LOOI" } });
  const conversation = store({ isSpeaking: false, isUserSpeaking: false, isProcessing: false });
  const robot = { motionActive: false, stopGeneration: 0 }; let focused = true, driving = false, gameActive = false;
  const listeners = {}, app = { currentState: "active", addEventListener: (_, fn) => { listeners.app = fn; return { remove() {} }; } };
  const runtime = loadTypeScript("src/character/character-action-runtime.ts", {
    zustand: { create: init => store(init()) }, "react-native": { AppState: app },
    "../store/user": { useUserStore: user }, "../store/conversation": { useConversationStore: conversation },
    "../core/main-screen-presence": { isMainScreenFocused: () => focused, subscribeMainScreenFocused: fn => { listeners.focus = fn; return () => {}; } },
    "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => robot, subscribeLooiRobotRuntimeState: fn => { listeners.robot = fn; return () => {}; } },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => driving },
    "../behavior/behavior-events": { isBehaviorGameActive: () => gameActive, subscribeBehaviorEvents: fn => { listeners.event = fn; return () => {}; } },
    "./character-action": api,
    "./character-scene-selection": loadCharacterModule("src/character/character-scene-selection.ts"),
  }, { Date: { now: timer.now }, setTimeout: timer.schedule, clearTimeout: timer.unschedule });
  const dispose = runtime.installCharacterActionRuntime(), state = () => runtime.useCharacterActionStore.getState();
  for (const reason of ["stop", "sleep", "background", "route", "motor", "driving", "user", "speech", "processing"]) {
    runtime.requestCharacterAction("drink"); assert.equal(state().active?.kind, "drink", reason);
    if (reason === "stop") { robot.stopGeneration++; listeners.robot(); }
    if (reason === "sleep") user.setState({ robotSleeping: true });
    if (reason === "background") { app.currentState = "background"; listeners.app(); }
    if (reason === "route") { focused = false; listeners.focus(); }
    if (reason === "motor") { robot.motionActive = true; listeners.robot(); }
    if (reason === "driving") { driving = true; assert.equal(runtime.requestCharacterAction("coffee"), null); }
    if (reason === "user") conversation.setState({ isUserSpeaking: true });
    if (reason === "speech") conversation.setState({ isSpeaking: true });
    if (reason === "processing") user.setState({ voiceState: "processing" });
    assert.equal(state().active, null, `${reason} clears action`);
    robot.motionActive = false; driving = false; focused = true; app.currentState = "active";
    conversation.setState({ isUserSpeaking: false, isSpeaking: false }); user.setState({ robotSleeping: false, voiceState: "attention" });
  }
  listeners.event({ type: "user-turn", text: "Trink etwas", sessionId: "s1" });
  assert.equal(state().pending?.kind, "drink");
  conversation.setState({ isSpeaking: true });
  listeners.event({ type: "assistant-end", sessionId: "s1" });
  assert.equal(state().active, null, "does not interrupt ongoing playback");
  conversation.setState({ isSpeaking: false });
  assert.equal(state().active?.kind, "drink");
  listeners.event({ type: "user-turn", text: "Wie ist das Wetter?", sessionId: "s1" });
  assert.deepEqual(state(), { active: null, pending: null });
  for (const type of ["interrupt", "session-end", "session-start", "user-speech-start", "correction"]) {
    runtime.requestCharacterAction("read"); listeners.event({ type, sessionId: "s1" }); assert.equal(state().active, null, type);
  }
  gameActive = true;
  assert.equal(runtime.requestCharacterActionFromVoice("Ich bin traurig", "s1"), null, "automatic pictures leave the number game's face alone");
  gameActive = false;
  runtime.requestCharacterActionFromVoice("Ich bin traurig", "s1");
  assert.equal(state().pending?.kind, "sadness");
  assert.equal(state().pending?.source, "context");
  runtime.completeCharacterActionReply("s1");
  assert.equal(state().active?.kind, "sadness");
  timer.advance(5000);
  assert.equal(runtime.requestCharacterActionFromVoice("Mir ist kalt", "s1"), null, "automatic context has a quiet interval");
  assert.notEqual(runtime.requestCharacterActionFromVoice("Zeig mir Kälte", "s1"), null, "explicit picture selection bypasses the interval");
  runtime.cancelCharacterAction(); timer.advance(8000);
  assert.notEqual(runtime.requestCharacterActionFromVoice("Mir ist kalt", "s1"), null);
  dispose(); assert.equal(runtime.requestCharacterAction("drink"), null);
}
const face = loadCharacterModule("src/character/face-expression.ts");
const input = { robotSleeping: false, voiceState: "attention", streamingText: "", characterMood: "angry", behaviorMood: "victory", action: { id: 1, kind: "drink", phase: "use" } };
assert.equal(face.resolveFacePresentation(input).expression.emotion, "drinking");
for (const override of [{ robotSleeping: true }, { assistantSpeaking: true }, { voiceState: "processing" }, { feedbackMood: "repairing" }]) {
  assert.notEqual(face.resolveFacePresentation({ ...input, ...override }).source, "action");
}
for (const kind of api.CHARACTER_ACTIONS) assert.ok(fs.readFileSync(`assets/character-props/${{ drink: "cup-soda", coffee: "coffee", snack: "cookie", read: "book-open" }[kind]}.svg`, "utf8").includes("<svg"));
console.log("PASS character props: explicit requests, bounded scenes, reply ownership, lifecycle cancellation and face priority");
