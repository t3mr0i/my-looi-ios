import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { loadRobotCapabilityModules, inertRobotCapabilityToolBridge } from "./helpers/robot-capability-modules.mjs";

const robotCapabilityModules = loadRobotCapabilityModules();
const OCCASIONS = ["greet_arrival", "welcome_back_after_quiet", "react_petting", "warn_edge", "gave_up_search", "arrived"];

// ---------------------------------------------------------------------------
// Instructions for a proactive Realtime response.
const hermesTaskToolDefinitions = loadTypeScript("src/voice/hermes-task-tool-definitions.ts");
const robotAppSkillToolDefinitions = loadTypeScript("src/voice/robot-app-skill-tool-definitions.ts");
const config = loadTypeScript("src/voice/realtime-config.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "../openai/realtime-models": {
    DEFAULT_REALTIME_MODEL_ID: "test-realtime",
    normalizeRealtimeModelId: (value) => value || "test-realtime",
    supportsRealtimeReasoning: () => false,
  },
  "./tts-voices": loadTypeScript("src/voice/tts-voices.ts"),
  "./hermes-completion-copy": loadTypeScript("src/voice/hermes-completion-copy.ts"),
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
  "./robot-capability-tool-definitions": robotCapabilityModules.definitions,
});
const prefs = { language: "de", robotName: "Louis", speechGender: "masculine", ttsStyleId: "cute-robot" };
for (const occasion of OCCASIONS) {
  const description = config.describeProactiveOccasion(occasion);
  assert.ok(description && description.length < 200, occasion);
  const response = config.buildProactiveOccasionResponse(occasion, prefs, {}, `id-${occasion}`);
  assert.equal(response.tool_choice, "none", `${occasion}: no tool, so no movement and no follow-up turn`);
  assert.equal(response.tools, undefined);
  assert.deepEqual(response.metadata, { looi_proactive: `id-${occasion}` });
  assert.match(response.instructions, /in German/u);
  assert.match(response.instructions, /You are Louis/u);
  assert.match(response.instructions, /exactly one short, natural line/u);
  assert.match(response.instructions, /Do not claim to have seen, felt, done or remembered more than this description says/u);
  assert.ok(response.instructions.includes(description), `${occasion} carries its situation`);
}
assert.match(config.describeProactiveOccasion("greet_arrival"), /You do not know who it is/u);
assert.match(config.describeProactiveOccasion("warn_edge", { edgeSide: "rear" }), /edge of the table behind you/u);
assert.match(config.describeProactiveOccasion("warn_edge", { edgeSide: "front" }), /in front of you/u);
assert.equal(config.describeProactiveOccasion("drive_away"), null);
assert.equal(config.buildProactiveOccasionResponse("drive_away", prefs), null);
assert.match(config.buildProactiveOccasionInstructions("react_petting", { ...prefs, language: "uk", speechGender: "feminine" }), /in Ukrainian.*|feminine/su);
// The base rule against unrelated speech stays, with one narrow exception.
const base = config.buildRealtimeInstructions({ language: "en", listeningLanguage: "en", speechGender: "masculine", robotName: "LOOI" }, undefined, undefined, "{\"x\":1}");
assert.match(base, /Do not initiate unrelated speech merely because this context changed\. The only exception is a response the local app itself starts for a body event/u);

// ---------------------------------------------------------------------------
// Both Realtime transports send it only when nobody is speaking and nothing is in flight.
const behaviorEvents = loadTypeScript("src/behavior/behavior-events.ts");
let gameActive = false;
let manualResponse = false;
behaviorEvents.registerBehaviorAdapter({
  dispatch() {}, getContext: () => "", inspectVisual: async () => "",
  isGameActive: () => gameActive, requiresManualResponse: () => manualResponse,
});
const conversationStore = {
  isUserSpeaking: false,
  setCurrentTranscript() {}, addMessage() {}, setListening() {}, setProcessing() {}, setSpeaking() {},
  setUserSpeaking() {}, setHeardSpeechText() {}, setStreamingText() {}, setOverlayVisible() {}, setRealtimeReadiness() {},
  setActiveSession() {}, setRealtimeIssue() {},
};
const userStore = {
  preferences: { ...prefs, listeningLanguage: "de", realtimeModelId: "test-realtime", ttsVoiceId: "alloy", ttsSpeed: 1,
    robotAddressAliases: [], robotAddressRecognitionAliases: [], ambientMotionLevel: "normal", voiceOutputGain: 1, customVoiceCommands: {} },
  robotSleeping: false,
  setVoiceState() {},
  updatePreferences() {},
};
const appState = { currentState: "active" };
let focused = true;

function commonDependencies() {
  return {
    "../behavior/behavior-events": behaviorEvents,
    "react-native": { Platform: { OS: "ios" }, AppState: appState },
    "expo-audio": { async setIsAudioActiveAsync() {} },
    "../core/observation": { createObservation: () => ({ metadata: {} }) },
    "../core/robot-inactivity": { markRobotInteraction() {} },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../memory/local-memory-database": { localMemoryDatabase: { async search() { return []; }, async remember() {} } },
    "../memory/memory-service": {
      isLocalMemoryMutationInProgress: () => false, mirrorSessionMessage() {}, mirrorSessionTouch() {},
      async retrieveConversationMemories() { return { facts: [] }; },
    },
    "../openai/openai-api-key": {
      async createOpenAiRealtimeClientSecret() { return { value: "local-test-secret", expiresAt: 0 }; },
      async exchangeOpenAiRealtimeSdp() { return ""; },
      createOpenAiRealtimeEphemeralWebSocket() { return {}; },
    },
    "../store/conversation": { useConversationStore: { getState: () => conversationStore } },
    "../store/user": { isPcmRealtimeMode: () => false, useUserStore: { getState: () => userStore } },
    "../../modules/vosk-command-recognizer": { __esModule: true, default: {
      addListener: () => ({ remove() {} }), async beginAssistantOutput() { return { ready: false, generation: 0 }; },
      cancelAssistantOutput() {}, endAssistantOutput() {}, feedAssistantPcm24() { return false; },
    } },
    "../character/speech-expression": {
      createSpeechExpressionTracker: () => ({ acceptRecognition() {}, setNativeGeneration() {}, advancePlayback() {}, setTranscript() {}, invalidate() {} }),
    },
    "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
    "../language/response-language": { normalizeResponseLanguage: (language) => language },
    "../core/main-screen-presence": { isMainScreenFocused: () => focused },
    "../vision/look-here": { captureExplicitLookHereStill: async () => null },
    "../openai/openai-api-status": { classifyOpenAiError: () => null, async setOpenAiApiStatus() {} },
    "../../modules/realtime-audio-route": {
      async activateRealtimeSpeakerRoute() { return {}; }, async deactivateRealtimeSpeakerRoute() { return {}; },
      async ensureRealtimeSpeakerRoute() { return {}; }, async getRealtimeAudioRouteStatus() { return { supported: false }; },
    },
    "./kws-audio-feeder": { kwsAudioFeeder: {
      diagnosticStatus: { appCaptureAllowed: true }, isRunning: false, setAppCaptureAllowed() {}, setWakewordFeedingEnabled() {},
      getRecentSamples: () => [], async start() {}, async stop() {}, subscribeSamples() { return () => {}; },
    } },
    "./wakeword": { wakewordService: { async start() {}, async stop() {}, async waitForFallbackIdle() {}, isListening: false } },
    "./realtime-config": {
      REALTIME_MODEL: "test-realtime", REALTIME_UPLINK_GAIN: 1,
      applyRealtimeUplinkGain: (samples) => [...samples], base64ToBytes: () => new Uint8Array(),
      buildRealtimeSessionUpdate: () => ({ type: "session.update", session: {} }), bytesToBase64: () => "",
      buildSharedCountdownInstructions: config.buildSharedCountdownInstructions,
      buildHermesCompletionInstructions: config.buildHermesCompletionInstructions,
      buildProactiveOccasionResponse: config.buildProactiveOccasionResponse,
      floatSamplesToPcm16Bytes: () => new Uint8Array(), resample16kTo24k: (samples) => [...samples],
    },
    "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute() { return { ok: false }; } } },
    "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
    "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute() { return { ok: false }; } } },
    "./robot-capability-tools": { robotCapabilityToolBridge: inertRobotCapabilityToolBridge },
    "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
    "./robot-capability-tool-definitions": robotCapabilityModules.definitions,
    "./realtime-physical-command": { parseRealtimePhysicalCommand: () => null, executeRealtimePhysicalCommand: async () => ({ ok: true }) },
    "./realtime-visual-command": { parseRealtimeVisualCommand: () => null },
  };
}

function assertProactiveGate(service, sent, sessionId, label, busyFlags) {
  let next = 0;
  const ask = (patch = {}) => behaviorEvents.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: `${label}-${++next}`, occasion: "react_petting", ...patch }, sessionId);
  const creates = () => sent.filter((event) => event.type === "response.create");

  sent.length = 0;
  assert.equal(ask(), true, `${label} speaks when idle`);
  assert.equal(creates().length, 1);
  const { response } = creates()[0];
  assert.equal(response.tool_choice, "none");
  assert.deepEqual(response.metadata, { looi_proactive: `${label}-1` });
  assert.match(response.instructions, /Someone just petted you\./u);
  assert.match(response.instructions, /in German/u);
  assert.ok(sent.findIndex((event) => event.type === "session.update") < sent.findIndex((event) => event.type === "response.create"),
    `${label} refreshes session preferences first, as other local signals do`);

  sent.length = 0;
  assert.equal(ask({ occasion: "warn_edge", edgeSide: "rear" }), true);
  assert.match(creates()[0].response.instructions, /edge of the table behind you/u);

  const refusals = [
    ["the person is speaking", () => { conversationStore.isUserSpeaking = true; }, () => { conversationStore.isUserSpeaking = false; }],
    ["a response is being generated", () => { service.generationActive = true; }, () => { service.generationActive = false; }],
    ["the answer is still playing", () => { service.playbackActive = true; }, () => { service.playbackActive = false; }],
    ["a tool call is running", () => { service.toolCallsInFlight = 1; }, () => { service.toolCallsInFlight = 0; }],
    ["a confirmation awaits a transcript", () => { manualResponse = true; }, () => { manualResponse = false; }],
    ["a game is active", () => { gameActive = true; }, () => { gameActive = false; }],
    ["LOOI is asleep", () => { userStore.robotSleeping = true; }, () => { userStore.robotSleeping = false; }],
    ["the app is in the background", () => { appState.currentState = "background"; }, () => { appState.currentState = "active"; }],
    ["the main screen is not focused", () => { focused = false; }, () => { focused = true; }],
    ["the session is not configured", () => { service.configured = false; }, () => { service.configured = true; }],
    ...busyFlags,
  ];
  for (const [reason, set, reset] of refusals) {
    sent.length = 0;
    set();
    assert.equal(ask(), false, `${label} refuses while ${reason}`);
    reset();
    assert.equal(creates().length, 0, `${label} sends nothing while ${reason}`);
  }
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "x", occasion: "react_petting" }, "other-session"), false);
  sent.length = 0;
  assert.equal(ask(), true, `${label} speaks again once everything settled`);
}

{
  const sessionId = "webrtc-proactive";
  const deps = {
    ...commonDependencies(),
    "react-native-webrtc": { RTCPeerConnection: class {}, RTCSessionDescription: class {}, mediaDevices: {} },
    "./realtime-pcm-conversation": { realtimePcmConversationService: {} },
  };
  const { RealtimeConversationService } = loadTypeScript("src/voice/realtime-conversation.ts", deps);
  const service = new RealtimeConversationService();
  behaviorEvents.beginBehaviorSession(sessionId, () => {}, (signal) => service.requestSharedCountdown(signal, sessionId));
  const sent = [];
  service.send = (event) => { sent.push(event); return true; };
  service.active = true;
  service.configured = true;
  service.sessionId = sessionId;
  service.dataChannel = { readyState: "open" };
  assertProactiveGate(service, sent, sessionId, "WebRTC", [
    ["an assistant item awaits completion", () => { service.pendingAssistantCompletion = {}; }, () => { service.pendingAssistantCompletion = null; }],
    ["the data channel is not open", () => { service.dataChannel = { readyState: "connecting" }; }, () => { service.dataChannel = { readyState: "open" }; }],
  ]);
  behaviorEvents.endBehaviorSession(sessionId);
}

{
  const sessionId = "pcm-proactive";
  const audio = { beginPlayback() {}, enqueuePlayback() {}, finishPlayback() {}, stopPlayback() { return { playedDurationMs: 0 }; }, addListener() { return { remove() {} }; } };
  const deps = {
    ...commonDependencies(),
    "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
    "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
    "../../modules/local-realtime-audio-capture/realtime-pcm": {
      getRealtimePcmAudioModule: () => audio,
      async startPcmCapture() { return { captureRunning: true }; }, async stopPcmCapture() {}, async reservePcmCapture() {},
    },
  };
  const { RealtimePcmConversationService } = loadTypeScript("src/voice/realtime-pcm-conversation.ts", deps);
  const service = new RealtimePcmConversationService();
  behaviorEvents.beginBehaviorSession(sessionId, () => {}, (signal) => service.requestSharedCountdown(signal, sessionId, service.lifecycleGeneration));
  const sent = [];
  service.send = (event) => { sent.push(event); return true; };
  service.active = true;
  service.configured = true;
  service.sessionId = sessionId;
  service.webSocket = { readyState: 1 };
  assertProactiveGate(service, sent, sessionId, "PCM", [
    ["a local motor command is running", () => { service.localPhysicalCommandInFlight = true; }, () => { service.localPhysicalCommandInFlight = false; }],
    ["a local look command is running", () => { service.localVisualCommandInFlight = true; }, () => { service.localVisualCommandInFlight = false; }],
    ["the socket is not open", () => { service.webSocket = { readyState: 0 }; }, () => { service.webSocket = { readyState: 1 }; }],
  ]);
  // A signal bound to an older lifecycle generation is refused.
  const staleGeneration = service.lifecycleGeneration;
  behaviorEvents.endBehaviorSession(sessionId);
  behaviorEvents.beginBehaviorSession(sessionId, () => {}, (signal) => service.requestSharedCountdown(signal, sessionId, staleGeneration - 1));
  assert.equal(behaviorEvents.requestBehaviorSignalResponse({ kind: "proactive-occasion", id: "p-old", occasion: "react_petting" }, sessionId), false);
  behaviorEvents.endBehaviorSession(sessionId);
}

// ---------------------------------------------------------------------------
// The Budget text client: one bounded request with the occasion as a developer message and no tools.
{
  const api = loadTypeScript("src/openai/budget-conversation.ts", {
    "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
    "./openai-api-key": { getOpenAiApiKey: async () => "unused-test-key" },
    "../voice/robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
    "../voice/robot-capability-tool-definitions": robotCapabilityModules.definitions,
    "../character/character-scene-catalog": robotCapabilityModules.sceneCatalog,
  });
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: "Oh, hallo!" }] }],
      usage: { input_tokens: 640, output_tokens: 6, input_tokens_details: { cached_tokens: 0 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const reply = await api.generateBudgetReply({
    history: [], language: "de", robotName: "Louis", occasion: "A person just came into view of your camera. You do not know who it is.",
    dependencies: { fetcher, getApiKey: async () => "key" },
  });
  assert.equal(reply.text, "Oh, hallo!");
  assert.equal(requests.length, 1, "one text request per line");
  const body = requests[0];
  assert.equal(body.tools, undefined, "no tools: a proactive line cannot move LOOI");
  assert.deepEqual(body.input.map((item) => item.role), ["developer"]);
  assert.match(body.input[0].content, /^Local app event, not words from the person: A person just came into view/u);
  assert.match(body.input[0].content, /in German/u);
  // Inside a session the history may end with LOOI's own line.
  await api.generateBudgetReply({
    history: [{ role: "user", content: "Hallo" }, { role: "assistant", content: "Hallo!" }], language: "de", robotName: "Louis",
    occasion: "Someone just petted you.", dependencies: { fetcher, getApiKey: async () => "key" },
  });
  assert.deepEqual(requests[1].input.map((item) => item.role), ["user", "assistant", "developer"]);
  // Without an occasion the existing contract is unchanged.
  await assert.rejects(api.generateBudgetReply({ history: [], language: "de", robotName: "Louis", dependencies: { fetcher, getApiKey: async () => "key" } }),
    (error) => error.code === "invalid_input");
  assert.match(api.buildBudgetOccasionMessage("<b>x</b>", "en"), /&lt;b&gt;x&lt;\/b&gt;/u, "the occasion text is escaped");
}

console.log("robot-mind proactive speech transports: ok");
