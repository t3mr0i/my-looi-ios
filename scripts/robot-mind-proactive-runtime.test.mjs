import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";
import { createHarness } from "./budget-conversation-runtime.test.mjs";

const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const MIN = 60_000;

const bodyModule = loadTypeScript("src/robot-mind/body-state.ts");
const policy = loadTypeScript("src/robot-mind/proactive-speech-policy.ts");
const behaviorPolicy = loadTypeScript("src/behavior/behavior-policy.ts");
const runtimeModule = loadTypeScript("src/robot-mind/proactive-speech-runtime.ts", {
  "../behavior/behavior-policy": behaviorPolicy,
  "./proactive-speech-policy": policy,
});
const idleModule = loadTypeScript("src/robot-mind/proactive-idle-speech.ts");

// ---------------------------------------------------------------------------
// Runtime routing with fakes.
function makeRuntime() {
  let now = 50_000_000;
  const store = bodyModule.createRobotBodyStateStore(() => now);
  const turnListeners = new Set();
  const f = {
    store,
    advance(ms) { now += ms; },
    get now() { return now; },
    level: "reactions",
    route: "idle",
    env: {
      foreground: true, mainScreenFocused: true, robotSleeping: false, mediaExternallyOwned: false, gameActive: false,
      userSpeaking: false, assistantBusy: false, lastConversationSpeechAt: null, conversationActive: false,
    },
    realtime: [], budget: [], idle: [], records: [],
    realtimeResult: true, budgetResult: true, idleResult: true,
    idleGate: null,
    userTurn(text) { for (const listener of turnListeners) listener(text); },
  };
  let ids = 0;
  f.runtime = runtimeModule.createProactiveSpeechRuntime({
    now: () => now,
    getBodyState: store.getState,
    subscribeBodyEvents: store.subscribeEvents,
    subscribeUserTurns(listener) { turnListeners.add(listener); return () => turnListeners.delete(listener); },
    getLevel: () => f.level,
    getEnvironment: () => ({ ...f.env }),
    getRoute: async () => f.route,
    describeOccasion: (occasion, detail) => `${occasion}${detail.edgeSide ? `:${detail.edgeSide}` : ""}`,
    requestRealtimeLine(request) { f.realtime.push(request); return f.realtimeResult; },
    async speakInBudgetSession(request) { f.budget.push(request); return f.budgetResult; },
    async speakWhileIdle(request) {
      f.idle.push(request);
      if (f.idleGate) await f.idleGate.promise;
      return f.idleResult;
    },
    record(category, event, details) { f.records.push({ category, event, ...details }); },
    createId: () => `id-${++ids}`,
  });
  f.stop = f.runtime.start();
  f.publish = async (event) => { store.publishEvent({ at: now, ...event }); await flush(); };
  return f;
}

{
  // Each route receives the accepted occasion with its description and reply hint.
  const f = makeRuntime();
  await f.publish({ type: "person_appeared", bearing: "left" });
  assert.equal(f.idle.length, 1);
  assert.deepEqual(f.idle[0], {
    id: "id-1", occasion: "greet_arrival", detail: {}, occasionText: "greet_arrival", level: "reactions", invitesReply: true,
  });
  assert.ok(f.records.some((r) => r.event === "proactive-speech-delivered" && r.route === "idle"));

  f.advance(5 * MIN);
  f.route = "realtime";
  await f.publish({ type: "edge_reached", side: "rear" });
  assert.equal(f.realtime.length, 1);
  assert.equal(f.realtime[0].occasion, "warn_edge");
  assert.deepEqual(f.realtime[0].detail, { edgeSide: "rear" });
  assert.equal(f.realtime[0].invitesReply, false, "nobody is asked to answer an edge warning");
  assert.ok(f.records.some((r) => r.category === "cost" && r.event === "proactive-realtime-response" && r.occasion === "warn_edge"),
    "a Realtime line shows up in the cost diagnostics");

  f.advance(5 * MIN);
  f.route = "budget";
  await f.publish({ type: "petted" });
  assert.equal(f.budget.length, 1);
  assert.equal(f.budget[0].occasion, "react_petting");

  // A refused delivery is not counted against the cooldown.
  f.advance(5 * MIN);
  f.route = "realtime";
  f.realtimeResult = false;
  f.store.publishEvent({ type: "person_left", at: f.now });
  f.advance(10 * MIN);
  await f.publish({ type: "person_appeared", bearing: "center" });
  assert.equal(f.realtime.length, 2);
  assert.ok(f.records.some((r) => r.event === "proactive-speech-refused" && r.route === "realtime"));
  f.realtimeResult = true;
  f.advance(10_000);
  await f.publish({ type: "person_appeared", bearing: "center" });
  assert.equal(f.realtime.length, 3, "the refused greeting is tried again in the same visit");
  f.advance(10_000);
  await f.publish({ type: "person_appeared", bearing: "center" });
  assert.equal(f.realtime.length, 3, "but only once it was actually delivered");

  // An unavailable route speaks nowhere (after the hourly cap of four has rolled over).
  f.advance(60 * MIN);
  f.route = "unavailable";
  await f.publish({ type: "petted" });
  assert.equal(f.realtime.length + f.budget.length + f.idle.length, 5);
  assert.ok(f.records.some((r) => r.event === "proactive-speech-refused" && r.route === "unavailable"));

  // Silent decisions are recorded with their reason; non-occasions are not noise.
  f.level = "off";
  f.advance(10 * MIN);
  await f.publish({ type: "petted" });
  assert.ok(f.records.some((r) => r.event === "proactive-speech-silent" && r.reason === "setting_off"));
  const before = f.records.length;
  await f.publish({ type: "connected" });
  assert.equal(f.records.length, before);
  f.stop();
  await f.publish({ type: "petted" });
  assert.equal(f.records.length, before, "stopping unsubscribes");
}

{
  // One delivery at a time: a second event during a slow idle line stays silent.
  const f = makeRuntime();
  f.level = "lively";
  f.idleGate = deferred();
  await f.publish({ type: "petted" });
  f.advance(3 * MIN);
  await f.publish({ type: "edge_reached", side: "front" });
  assert.equal(f.idle.length, 1);
  assert.ok(f.records.some((r) => r.event === "proactive-speech-silent" && r.reason === "delivery_in_flight"));
  f.idleGate.resolve();
  await flush();
  f.advance(1_000);
  await f.publish({ type: "edge_reached", side: "front" });
  assert.equal(f.idle.length, 2, "after the line finished the next occasion may speak");
}

{
  // A request for quiet in the conversation silences proactive lines for a while.
  const f = makeRuntime();
  f.userTurn("Wie spät ist es?");
  await f.publish({ type: "petted" });
  assert.equal(f.idle.length, 1);
  f.advance(5 * MIN);
  f.userTurn("Sei ruhiger.");
  await f.publish({ type: "edge_reached", side: "front" });
  assert.equal(f.idle.length, 1);
  assert.ok(f.records.some((r) => r.event === "proactive-quiet-requested"));
  assert.ok(f.records.some((r) => r.reason === "quiet_requested"));
  f.advance(policy.PROACTIVE_QUIET_REQUEST_MS);
  await f.publish({ type: "edge_reached", side: "front" });
  assert.equal(f.idle.length, 2);
  for (const text of ["Be quiet.", "be calmer please", "Shh", "тихо"]) assert.equal(runtimeModule.isProactiveQuietRequest(text), true, text);
  for (const text of ["Be playful", "Tell me a quiet story about a mouse"]) assert.equal(runtimeModule.isProactiveQuietRequest(text), false, text);
}

{
  // Conversation states flow from the environment into the policy.
  const f = makeRuntime();
  f.env.userSpeaking = true;
  await f.publish({ type: "petted" });
  f.env.userSpeaking = false;
  f.env.assistantBusy = true;
  await f.publish({ type: "petted" });
  f.env.assistantBusy = false;
  f.env.gameActive = true;
  await f.publish({ type: "petted" });
  f.env.gameActive = false;
  f.store.update({ activity: { mode: "sleeping", since: f.now } }, "test");
  await f.publish({ type: "petted" });
  assert.equal(f.idle.length, 0);
  assert.deepEqual(f.records.filter((r) => r.event === "proactive-speech-silent").map((r) => r.reason),
    ["person_speaking", "assistant_busy", "game_active", "sleeping"]);
}

// ---------------------------------------------------------------------------
// The idle path with a fake text client and fake TTS.
function makeIdle(overrides = {}) {
  const h = {
    gate: null, feeding: true, mode: "budget", calls: [], records: [], shown: [], opened: 0,
    takeover: null, speakDeferred: null, line: "Oh, hallo du!",
  };
  h.speaker = idleModule.createIdleProactiveSpeaker({
    checkIdle: () => h.gate,
    async generateLine(occasionText, signal) {
      h.calls.push(["text", occasionText]);
      if (h.generateError) throw h.generateError;
      assert.equal(signal.aborted, false);
      return { text: h.line, model: "gpt-6-luna", usage: { inputTokens: 700, outputTokens: 12, cachedInputTokens: 0 } };
    },
    async speak(text, signal) {
      h.calls.push(["speak", text, h.feeding]);
      h.signal = signal;
      if (h.speakDeferred) await h.speakDeferred.promise;
    },
    isWakewordFeeding: () => h.feeding,
    setWakewordFeeding(enabled) { h.calls.push(["feeding", enabled]); h.feeding = enabled; },
    showSpeaking(text, keepOverlay) { h.shown.push([text, Boolean(keepOverlay)]); },
    watchForTakeover(onTakeover) { h.takeover = onTakeover; return () => { h.takeover = null; }; },
    getConversationMode: () => h.mode,
    async openMicrophone() { h.opened += 1; h.calls.push(["open-mic"]); },
    record(category, event, details) { h.records.push({ category, event, ...details }); },
    ...overrides,
  });
  return h;
}
const request = (patch = {}) => ({
  id: "r1", occasion: "greet_arrival", detail: {}, occasionText: "A person just came into view.", level: "reactions", invitesReply: true, ...patch,
});

{
  // Budget mode: one text call, one TTS call with wake-word feeding paused, then the free local microphone opens.
  const h = makeIdle();
  assert.equal(await h.speaker.speak(request()), true);
  assert.deepEqual(h.calls, [
    ["text", "A person just came into view."],
    ["feeding", false],
    ["speak", "Oh, hallo du!", false],
    ["feeding", true],
    ["open-mic"],
  ]);
  assert.deepEqual(h.shown, [["Oh, hallo du!", false], [null, false]]);
  assert.deepEqual(h.records.filter((r) => r.category === "cost").map((r) => r.event), ["proactive-line-text-usage", "proactive-line-speech"]);
  assert.equal(h.records.find((r) => r.event === "proactive-line-text-usage").inputTokens, 700);
  assert.ok(h.records.some((r) => r.event === "proactive-microphone-opened" && r.mode === "budget"));
  assert.equal(h.takeover, null, "the takeover watch is released");
}
{
  // Realtime modes: "reactions" never opens a paid session; the wake word stays the way in.
  const h = makeIdle();
  h.mode = "realtime_pcm";
  assert.equal(await h.speaker.speak(request()), true);
  assert.equal(h.opened, 0);
  assert.ok(h.records.some((r) => r.event === "proactive-microphone-left-to-wake-word"));
  // "lively" opens it, and that is recorded as a cost event.
  const lively = makeIdle();
  lively.mode = "realtime";
  assert.equal(await lively.speaker.speak(request({ level: "lively" })), true);
  assert.equal(lively.opened, 1);
  assert.ok(lively.records.some((r) => r.category === "cost" && r.event === "proactive-realtime-session-opened" && r.mode === "realtime"));
  // An occasion that invites no reply never opens the microphone.
  const edge = makeIdle();
  assert.equal(await edge.speaker.speak(request({ occasion: "warn_edge", invitesReply: false })), true);
  assert.equal(edge.opened, 0);
}
{
  // Unsafe states stay silent without any model call.
  const h = makeIdle();
  h.gate = "wheels-moving";
  assert.equal(await h.speaker.speak(request()), false);
  assert.deepEqual(h.calls, []);
  assert.ok(h.records.some((r) => r.event === "proactive-idle-silent" && r.reason === "wheels-moving"));
  // The state is checked again after the text call: a conversation that started meanwhile wins.
  const late = makeIdle({});
  let checks = 0;
  const lateSpeaker = idleModule.createIdleProactiveSpeaker({
    checkIdle: () => (checks++ === 0 ? null : "voice-busy"),
    async generateLine() { return { text: "Hallo!", model: "m", usage: {} }; },
    async speak() { throw new Error("must not speak"); },
    isWakewordFeeding: () => true, setWakewordFeeding() { throw new Error("must not touch feeding"); },
    showSpeaking() {}, watchForTakeover() { return () => {}; }, getConversationMode: () => "budget",
    async openMicrophone() { throw new Error("must not open"); }, record: (c, e, d) => late.records.push({ event: e, ...d }),
  });
  assert.equal(await lateSpeaker.speak(request()), false);
  assert.ok(late.records.some((r) => r.reason === "voice-busy"));
  // A failed text call speaks nothing.
  const failing = makeIdle();
  failing.generateError = new Error("missing_key");
  assert.equal(await failing.speaker.speak(request()), false);
  assert.ok(failing.records.some((r) => r.reason === "generation-failed:missing_key"));
  assert.equal(failing.calls.some(([kind]) => kind === "speak"), false);
}
{
  // A tap or wake during the line cancels it, leaves the wake-word feed to the new owner and opens nothing.
  const h = makeIdle();
  h.speakDeferred = deferred();
  const pending = h.speaker.speak(request());
  await flush();
  assert.equal(h.speaker.isSpeaking, true);
  assert.equal(await h.speaker.speak(request({ id: "r2" })), false, "one idle line at a time");
  h.takeover();
  assert.equal(h.signal.aborted, true);
  h.speakDeferred.resolve();
  assert.equal(await pending, true, "a line cut short still counts as spoken");
  assert.equal(h.opened, 0);
  assert.deepEqual(h.calls.filter(([kind]) => kind === "feeding"), [["feeding", false]], "feeding is not re-enabled under the new owner");
  assert.deepEqual(h.shown.at(-1), [null, true], "the new conversation keeps its overlay");
  assert.equal(h.speaker.isSpeaking, false);
}
{
  // Previously disabled wake-word feeding is restored as it was.
  const h = makeIdle();
  h.feeding = false;
  await h.speaker.speak(request({ invitesReply: false }));
  assert.deepEqual(h.calls.filter(([kind]) => kind === "feeding"), [["feeding", false], ["feeding", false]]);
}

// ---------------------------------------------------------------------------
// The active Budget session path with the real service, a fake text client and fake TTS.
{
  const h = createHarness({ ttsEnabled: true });
  await h.service.start();
  assert.equal(h.conversation.isListening, true);
  h.modelHandler = async (requestBody) => ({ text: "Hihi, das kitzelt!", model: "gpt-6-luna", usage: { inputTokens: 600, outputTokens: 9 } });
  const capturesBefore = h.captureStopCalls;
  assert.equal(await h.service.speakProactiveLine("Someone just petted you."), true);
  const call = h.modelCalls.at(-1);
  assert.equal(call.occasion, "Someone just petted you.");
  assert.equal(call.runTool, undefined, "a proactive line gets no tools, so it cannot move LOOI");
  assert.deepEqual(h.speechCalls.map((item) => item.text), ["Hihi, das kitzelt!"]);
  assert.ok(h.captureStopCalls > capturesBefore, "capture is released before cloud speech");
  assert.ok(h.diagnosticEvents.some(([category, event]) => category === "cost" && event === "proactive-line-text-usage"));
  assert.ok(h.diagnosticEvents.some(([category, event]) => category === "cost" && event === "proactive-line-speech"));
  assert.deepEqual(h.conversation.messages.at(-1), { role: "assistant", content: "Hihi, das kitzelt!" });
  await flush();
  for (let i = 0; i < 20 && !h.conversation.isListening; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.conversation.isListening, true, "the session listens again so the person can answer");

  // Speech that began while the line was being generated wins: nothing is said.
  const generation = deferred();
  h.modelHandler = async () => { await generation.promise; return { text: "Hallo!", model: "m", usage: {} }; };
  const speechCount = h.speechCalls.length;
  const pending = h.service.speakProactiveLine("A person just came into view.");
  await flush();
  h.vadSequence = [true];
  h.feeder.emit();
  for (let i = 0; i < 20 && !h.conversation.isUserSpeaking; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  generation.resolve();
  assert.equal(await pending, false);
  assert.equal(h.speechCalls.length, speechCount);
  await h.service.stop("explicit");

  // Not listening (inactive session) refuses without a model call.
  const idle = createHarness({ ttsEnabled: true });
  assert.equal(await idle.service.speakProactiveLine("Someone just petted you."), false);
  assert.equal(idle.modelCalls.length, 0);
}

// ---------------------------------------------------------------------------
// The behavior-events seam validates proactive signals and refuses them during a game.
{
  const events = loadTypeScript("src/behavior/behavior-events.ts");
  const received = [];
  let game = false;
  events.registerBehaviorAdapter({ dispatch() {}, getContext: () => "", inspectVisual: async () => "", isGameActive: () => game });
  assert.equal(events.getBehaviorSessionId(), null);
  assert.equal(events.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p1", occasion: "react_petting" }, "s1"), false, "no session");
  events.beginBehaviorSession("s1", () => {}, (signal) => { received.push(signal); return true; });
  assert.equal(events.getBehaviorSessionId(), "s1");
  assert.equal(events.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p1", occasion: "react_petting" }, "s1"), true);
  assert.equal(events.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p2", occasion: "warn_edge", edgeSide: "rear" }, "s1"), true);
  assert.deepEqual(received, [
    { kind: "proactive-occasion", id: "p1", occasion: "react_petting" },
    { kind: "proactive-occasion", id: "p2", occasion: "warn_edge", edgeSide: "rear" },
  ]);
  for (const bad of [
    { kind: "proactive-occasion", id: "p3", occasion: "drive_away" },
    { kind: "proactive-occasion", id: "", occasion: "react_petting" },
    { kind: "proactive-occasion", id: "x".repeat(97), occasion: "react_petting" },
    { kind: "proactive-occasion", id: "p4", occasion: "warn_edge", edgeSide: "left" },
  ]) assert.equal(events.requestBehaviorSignalResponse(bad, "s1"), false, JSON.stringify(bad));
  assert.equal(events.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p5", occasion: "react_petting" }, "other"), false);
  game = true;
  assert.equal(events.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p6", occasion: "react_petting" }, "s1"), false, "no line during a game");
  assert.equal(received.length, 2);
  events.endBehaviorSession("s1");
  assert.equal(events.getBehaviorSessionId(), null);
}

console.log("robot-mind proactive speech runtime: ok");
