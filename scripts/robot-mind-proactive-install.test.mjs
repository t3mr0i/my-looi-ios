import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

// Production wiring of proactive speech against fake app modules: routing,
// idle safety gate, cost diagnostics and the wake-like microphone hand-off.
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

function fakeStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState(patch) { const previous = state; state = { ...state, ...patch }; for (const listener of [...listeners]) listener(state, previous); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const world = {
  diagnostics: [], signals: [], textCalls: [], speechCalls: [], triggers: 0, budgetLines: [],
  activeMode: null, behaviorSession: null, motionActive: false, feeding: true,
};
const conversation = fakeStore({
  isUserSpeaking: false, isSpeaking: false, isProcessing: false, isListening: false, realtimeReadiness: "idle", overlayVisible: false, heardSpeechText: null,
});
const conversationActions = {
  setHeardSpeechText: (text) => conversation.setState({ heardSpeechText: text }),
  setSpeaking: (value) => conversation.setState({ isSpeaking: value }),
  setOverlayVisible: (value) => conversation.setState({ overlayVisible: value }),
};
const conversationModule = { useConversationStore: { getState: () => ({ ...conversation.getState(), ...conversationActions }), subscribe: conversation.subscribe } };
const user = fakeStore({
  robotSleeping: false, voiceState: "sleeping",
  preferences: { proactiveSpeech: "reactions", conversationMode: "budget", language: "de", robotName: "Louis", ttsEnabled: true, ttsVoiceId: "alloy", ttsStyleId: "cute-robot", ttsSpeed: 1 },
});
const body = loadTypeScript("src/robot-mind/body-state.ts");
let now = 90_000_000;
const bodyStore = body.createRobotBodyStateStore(() => now);
const policy = loadTypeScript("src/robot-mind/proactive-speech-policy.ts");
const behaviorEventsListeners = new Set();

const dependencies = {
  "react-native": { AppState: { currentState: "active" } },
  "../behavior/behavior-events": {
    getBehaviorSessionId: () => world.behaviorSession,
    getCompanionPersonalityContext: () => "",
    isBehaviorGameActive: () => false,
    requestBehaviorSignalResponse: (signal, sessionId) => { world.signals.push({ signal, sessionId }); return true; },
    subscribeBehaviorEvents: (listener) => { behaviorEventsListeners.add(listener); return () => behaviorEventsListeners.delete(listener); },
  },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (category, event, details) => world.diagnostics.push({ category, event, ...details }) },
  "../perceivers/voice-runtime": { voiceRuntime: { isMediaExternallyOwned: false, async trigger() { world.triggers += 1; } } },
  "../store/conversation": conversationModule,
  "../store/user": {
    normalizeProactiveSpeech: (value) => (value === "off" || value === "lively" ? value : "reactions"),
    useUserStore: { getState: () => ({ ...user.getState() }), subscribe: user.subscribe },
  },
  "../voice/realtime-config": { describeProactiveOccasion: (occasion) => `situation:${occasion}` },
  "./body-state": { robotBodyState: bodyStore },
  "./proactive-idle-speech": loadTypeScript("src/robot-mind/proactive-idle-speech.ts"),
  "./proactive-speech-runtime": loadTypeScript("src/robot-mind/proactive-speech-runtime.ts", {
    "../behavior/behavior-policy": loadTypeScript("src/behavior/behavior-policy.ts"),
    "./proactive-speech-policy": policy,
  }),
  "../voice/realtime-conversation": { realtimeConversationService: {
    get activeMode() { return world.activeMode; }, get isActive() { return world.activeMode !== null; },
  } },
  "../voice/kws-audio-feeder": { kwsAudioFeeder: {
    get diagnosticStatus() { return { wakewordFeedingEnabled: world.feeding }; },
    setWakewordFeedingEnabled(enabled) { world.feeding = enabled; },
  } },
  "../voice/wakeword": { wakewordService: { isDrivingControlSessionActive: false } },
  "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => ({ motionActive: world.motionActive }) },
  "../openai/budget-conversation": { async generateBudgetReply(request) {
    world.textCalls.push(request);
    return { text: "Oh, hallo!", model: "gpt-6-luna", usage: { inputTokens: 650, outputTokens: 5, cachedInputTokens: 0 } };
  } },
  "../openai/openai-speech": { async speakOpenAiText(text, options) {
    world.speechCalls.push({ text, streaming: options.streaming, feeding: world.feeding, speaking: conversation.getState().isSpeaking });
  } },
  "../voice/budget-conversation": { budgetConversationService: { async speakProactiveLine(text) { world.budgetLines.push(text); return true; } } },
};
const install = loadTypeScript("src/robot-mind/proactive-speech-install.ts", dependencies);
const uninstall = install.installProactiveSpeechRuntime();
assert.equal(install.installProactiveSpeechRuntime(), uninstall, "installing twice keeps one runtime");

const publish = async (event) => { bodyStore.publishEvent({ at: now, ...event }); await settle(); };

// Idle in Budget mode: text line, non-streamed TTS with wake feeding paused, then the free local microphone.
await publish({ type: "person_appeared", bearing: "center" });
assert.equal(world.textCalls.length, 1);
assert.equal(world.textCalls[0].occasion, "situation:greet_arrival");
assert.deepEqual(world.textCalls[0].history, [], "an idle line does not drag in an old conversation");
assert.deepEqual(world.speechCalls, [{ text: "Oh, hallo!", streaming: undefined, feeding: false, speaking: true }]);
assert.equal(world.feeding, true, "wake-word feeding is restored");
assert.equal(conversation.getState().isSpeaking, false);
assert.equal(world.triggers, 1, "the microphone opens like a wake word");
assert.ok(world.diagnostics.some((d) => d.category === "cost" && d.event === "proactive-line-text-usage" && d.route === "idle"));
assert.ok(world.diagnostics.some((d) => d.category === "cost" && d.event === "proactive-line-speech"));

// Idle while the wheels move: silent, no model call.
now += 5 * 60_000;
world.motionActive = true;
await publish({ type: "petted" });
assert.equal(world.textCalls.length, 1);
assert.ok(world.diagnostics.some((d) => d.event === "proactive-idle-silent" && d.reason === "wheels-moving"));
world.motionActive = false;
now += 5 * 60_000;
bodyStore.update({ wheelsMoving: true }, "test");
await publish({ type: "petted" });
assert.equal(world.textCalls.length, 1, "the body-state wheel flag also blocks idle speech");
bodyStore.update({ wheelsMoving: false }, "test");

// Realtime mode, idle, "reactions": speaks but leaves the paid session closed.
now += 5 * 60_000;
user.setState({ preferences: { ...user.getState().preferences, conversationMode: "realtime_pcm" } });
await publish({ type: "petted" });
assert.equal(world.speechCalls.length, 2);
assert.equal(world.triggers, 1);

// Active Realtime session: the behavior signal carries the occasion; cost is recorded.
now += 5 * 60_000;
world.activeMode = "realtime_pcm";
world.behaviorSession = "s-1";
await publish({ type: "edge_reached", side: "front" });
assert.deepEqual(world.signals.at(-1), { signal: { kind: "proactive-occasion", id: world.signals.at(-1).signal.id, occasion: "warn_edge", edgeSide: "front" }, sessionId: "s-1" });
assert.ok(world.diagnostics.some((d) => d.category === "cost" && d.event === "proactive-realtime-response"));

// The person speaking blocks it; afterwards the settle window still holds it back.
now += 5 * 60_000;
conversation.setState({ isUserSpeaking: true });
await publish({ type: "edge_reached", side: "front" });
conversation.setState({ isUserSpeaking: false });
await publish({ type: "edge_reached", side: "front" });
assert.equal(world.signals.length, 1);
assert.deepEqual(world.diagnostics.filter((d) => d.event === "proactive-speech-silent").slice(-2).map((d) => d.reason), ["person_speaking", "conversation_settling"]);

// A quiet request heard in the conversation silences the next occasion.
now += 5 * 60_000;
for (const listener of behaviorEventsListeners) listener({ type: "user-turn", text: "Sei still.", sessionId: "s-1" });
await publish({ type: "petted" });
assert.equal(world.signals.length, 1);
assert.equal(world.diagnostics.filter((d) => d.event === "proactive-speech-silent").at(-1).reason, "quiet_requested");

// Active Budget session: the line goes to the session itself.
now += 25 * 60_000;
world.activeMode = "budget";
world.behaviorSession = null;
await publish({ type: "petted" });
assert.deepEqual(world.budgetLines, ["situation:react_petting"]);

// Setting off: nothing.
now += 70 * 60_000;
user.setState({ preferences: { ...user.getState().preferences, proactiveSpeech: "off" } });
await publish({ type: "petted" });
assert.equal(world.budgetLines.length, 1);

uninstall();
console.log("robot-mind proactive speech install: ok");
