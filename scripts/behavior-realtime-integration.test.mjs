import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const flush = async () => {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
};

const behaviorEvents = loadTypeScript("src/behavior/behavior-events.ts");
const hermesTaskToolDefinitions = loadTypeScript("src/voice/hermes-task-tool-definitions.ts");
const behaviorEventsSeen = [];
const contextUpdates = [];
const visualInspections = [];
const visualInspectionPlans = [];
let behaviorContext = "initial local task state";
let behaviorGameActive = false;
const detachAdapter = behaviorEvents.registerBehaviorAdapter({
  dispatch(event) {
    behaviorEventsSeen.push({ ...event });
    if (event.type === "session-start" || event.type === "session-end") behaviorGameActive = false;
    if (event.type === "user-turn") {
      if (event.text === "Let's play a guessing game") {
        behaviorGameActive = true;
        behaviorContext = "number game active; ask for one guess from 1 to 3";
      } else if (behaviorGameActive && event.text === "3") {
        behaviorGameActive = false;
        behaviorContext = "number game won; acknowledge the local result";
      } else {
        behaviorContext = `task context after: ${event.text}`;
      }
    }
  },
  getContext: () => behaviorContext,
  isGameActive: () => behaviorGameActive,
  inspectVisual(image, task, sessionId) {
    visualInspections.push({ image, task, sessionId });
    const plan = visualInspectionPlans.shift();
    return plan ? plan.promise : Promise.resolve("brief local visual assessment");
  },
});

const audioListeners = new Map();
const audioEvents = [];
const audio = {
  addListener(name, callback) {
    audioListeners.set(name, callback);
    return { remove: () => { if (audioListeners.get(name) === callback) audioListeners.delete(name); } };
  },
  beginPlayback() { audioEvents.push("begin"); },
  enqueuePlayback(value) { audioEvents.push(["enqueue", value]); },
  finishPlayback() { audioEvents.push("finish"); },
  stopPlayback() { audioEvents.push("stop"); return { playedDurationMs: 0 }; },
};

const conversationEvents = [];
const conversationStore = new Proxy({ realtimeIssue: null, isUserSpeaking: false }, {
  get(target, property) {
    if (property in target) return target[property];
    return (...args) => {
      conversationEvents.push([String(property), ...args]);
      if (property === "setRealtimeIssue") target.realtimeIssue = args[0];
      if (property === "setUserSpeaking") target.isUserSpeaking = args[0] === true;
      if (property === "setHeardSpeechText") target.heardSpeechText = args[0];
    };
  },
});
const preferences = {
  language: "en", listeningLanguage: "en", realtimeModelId: "test-realtime",
  ttsVoiceId: "alloy", ttsSpeed: 1, speechGender: "neutral", robotName: "LOOI",
  robotAddressAliases: [], robotAddressRecognitionAliases: [], customVoiceCommands: {},
  ambientMotionLevel: "normal", voiceOutputGain: 1,
};
const userStore = {
  preferences,
  robotSleeping: false,
  setVoiceState(value) { conversationEvents.push(["voiceState", value]); },
  updatePreferences(patch) { Object.assign(preferences, patch); },
};
const capturedStillRequests = [];
const physicalCalls = [];
const physicalCompletion = deferred();
const sentSessionConfigurations = [];
const sessionUpdates = [];
const sockets = [];
const voskListeners = new Map();
const voskCommandRecognizer = {
  addListener(name, callback) {
    voskListeners.set(name, callback);
    return { remove: () => { if (voskListeners.get(name) === callback) voskListeners.delete(name); } };
  },
  // Native speech recognition is unavailable in this integration harness.
  // Fail closed so no mock transcript or face expression can be inferred.
  async beginAssistantOutput() { return { ready: false, generation: 0 }; },
  feedAssistantPcm24() { return false; },
  endAssistantOutput() {},
  cancelAssistantOutput() {},
};
let observedVisualAdviceLength = null;

class FakeSocket {
  constructor() { this.readyState = 1; this.sent = []; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}

const captureReadyStatus = {
  supported: true, captureRunning: true, captureSampleRate: 16_000,
  audioSource: "test-mock", audioSessionId: 1, aecAvailable: true,
  aecEnabled: true, noiseSuppressorExplicit: false,
  playbackRunning: false, playbackSampleRate: 24_000,
};
const fakeRoute = { supported: false, active: false, speakerSelected: false, modeMatchesCommunication: true };
const pcmDependencies = {
  "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
  "../behavior/behavior-events": behaviorEvents,
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
  "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
  "expo-audio": { async setIsAudioActiveAsync() {} },
  "../core/observation": { createObservation: () => ({}) },
  "../core/robot-inactivity": { markRobotInteraction() {} },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../memory/local-memory-database": { localMemoryDatabase: { async search() { return []; } } },
  "../memory/memory-service": {
    isLocalMemoryMutationInProgress: () => false,
    mirrorSessionMessage() {},
    mirrorSessionTouch() {},
    async retrieveConversationMemories() { return { facts: [], strategy: "test-no-memory" }; },
  },
  "../openai/openai-api-key": {
    async createOpenAiRealtimeClientSecret(configuration) {
      sentSessionConfigurations.push(configuration);
      return { value: "fake-ephemeral-secret", expiresAt: 0 };
    },
    createOpenAiRealtimeEphemeralWebSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  },
  "../store/conversation": { useConversationStore: { getState: () => conversationStore } },
  "../store/user": { useUserStore: { getState: () => userStore } },
  "../vision/look-here": {
    captureExplicitLookHereStill(cameraFacing) {
      const capture = deferred();
      capturedStillRequests.push({ cameraFacing, capture });
      return capture.promise;
    },
  },
  "../openai/openai-api-status": { classifyOpenAiError: () => null, async setOpenAiApiStatus() {} },
  "../../modules/realtime-audio-route": {
    async getRealtimeAudioRouteStatus() { return fakeRoute; },
    async activateRealtimeSpeakerRoute() { return fakeRoute; },
    async deactivateRealtimeSpeakerRoute() { return fakeRoute; },
  },
  "../../modules/local-realtime-audio-capture/realtime-pcm": {
    getRealtimePcmAudioModule: () => audio,
    async startPcmCapture() { return captureReadyStatus; },
    async stopPcmCapture() {},
    async reservePcmCapture() {},
  },
  "../../modules/vosk-command-recognizer": { __esModule: true, default: voskCommandRecognizer },
  "../character/speech-expression": {
    createSpeechExpressionTracker: () => ({
      setNativeGeneration() {}, setTranscript() {}, acceptRecognition() {}, advancePlayback() {}, invalidate() {},
    }),
  },
  "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
  "../language/response-language": { normalizeResponseLanguage: (value) => value },
  "./kws-audio-feeder": {
    kwsAudioFeeder: {
      diagnosticStatus: { appCaptureAllowed: true },
      isRunning: false,
      setAppCaptureAllowed() {},
      setWakewordFeedingEnabled() {},
      getRecentSamples: () => [],
      async stop() { this.isRunning = false; },
      async start() { this.isRunning = true; },
    },
  },
  "./realtime-config": {
    applyRealtimeUplinkGain: (samples) => [...samples],
    base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
    bytesToBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    floatSamplesToPcm16Bytes: () => new Uint8Array(),
    REALTIME_MODEL: "fake-model",
    REALTIME_UPLINK_GAIN: 1,
    resample16kTo24k: (samples) => [...samples],
    buildRealtimeSessionUpdate(_prefs, _summary, _memory, context, manualBehaviorTurns = false) {
      const update = {
        type: "session.update",
        session: {
          instructions: context ?? "",
          audio: { input: { turn_detection: { create_response: !manualBehaviorTurns } } },
        },
        behaviorContext: context ?? "",
        manualBehaviorTurns,
      };
      sessionUpdates.push(update);
      return update;
    },
  },
  "./wakeword": {
    wakewordService: {
      isListening: false,
      async stop() {},
      async waitForFallbackIdle() {},
      async start() {},
    },
  },
  "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute() { return { ok: true }; } } },
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./realtime-physical-command": {
    executeRealtimePhysicalCommand(command, transcript) {
      physicalCalls.push({ command, transcript });
      return physicalCompletion.promise;
    },
    parseRealtimePhysicalCommand(transcript) {
      return transcript === "LOOI stop" ? { kind: "stop" } : null;
    },
  },
  "./realtime-visual-command": {
    parseRealtimeVisualCommand(transcript) {
      return transcript.startsWith("LOOI look") ? { kind: "look-here", cameraFacing: "front" } : null;
    },
  },
  "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute() { return { ok: true }; } } },
  "./robot-app-skill-tool-definitions": { ROBOT_APP_SKILL_TOOL_NAMES: new Set() },
};

const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = { OPEN: 1 };
const { RealtimePcmConversationService } = loadTypeScript("src/voice/realtime-pcm-conversation.ts", pcmDependencies);
const service = new RealtimePcmConversationService();

function eventsOfType(type) {
  return behaviorEventsSeen.filter((event) => event.type === type);
}

async function submitTranscript(transcript, itemId) {
  await service.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript, item_id: itemId });
  await flush();
}

async function submitVisualRequest(transcript, itemId) {
  const priorCaptureCount = capturedStillRequests.length;
  const behaviorEventStart = behaviorEventsSeen.length;
  await submitTranscript(transcript, itemId);
  assert.equal(capturedStillRequests.length, priorCaptureCount + 1, "an explicit visual request starts one local capture");
  assert.deepEqual(behaviorEventsSeen.slice(behaviorEventStart).map((event) => event.type), ["interrupt"], "an explicit visual request interrupts behavior rather than becoming a generic behavior turn");
  assert.equal(behaviorEventsSeen.at(-1).reason, "explicit-visual-command");
  return capturedStillRequests.at(-1);
}

await service.start();
assert.equal(eventsOfType("session-start").length, 1, "PCM startup opens a behavior session through the local seam");
assert.equal(sentSessionConfigurations[0].instructions, "initial local task state", "the initial bounded context reaches session configuration");
assert.equal(sentSessionConfigurations[0].audio.input.turn_detection.create_response, true, "ordinary Realtime VAD retains automatic response creation");
assert.equal(service.isActive, true);

const pcmSessionId = service.sessionId;
assert.ok(pcmSessionId);
await submitTranscript("What should I do next?", "normal-turn-1");
assert.deepEqual(eventsOfType("user-turn").at(-1), {
  type: "user-turn", text: "What should I do next?", sessionId: pcmSessionId, turnId: "normal-turn-1",
});
assert.equal(sessionUpdates.at(-1).behaviorContext, "task context after: What should I do next?", "new local behavior context is sent through the optional fourth session-config argument");
assert.equal(sessionUpdates.at(-1).session.audio.input.turn_detection.create_response, true, "normal conversation keeps server VAD response creation enabled");

// The local number game turns Realtime's automatic VAD response off only for
// its active round. Starting the game and winning it both dispatch one manual
// response, after the synchronous behavior-context/config refresh.
let gameSentStart = sockets.at(-1).sent.length;
let gameUpdateStart = sessionUpdates.length;
await submitTranscript("Let's play a guessing game", "pcm-game-start");
let gameSent = sockets.at(-1).sent.slice(gameSentStart);
let gameUpdate = gameSent.find((event) => event.type === "session.update" && event.session?.audio?.input?.turn_detection?.create_response === false);
let gameResponse = gameSent.findIndex((event) => event.type === "response.create");
assert.ok(gameUpdate, "game activation synchronously configures manual Realtime turns");
assert.ok(gameResponse > gameSent.indexOf(gameUpdate), "the game-start response follows its manual-turn configuration update");
assert.equal(gameSent.filter((event) => event.type === "response.create").length, 1, "starting the game creates exactly one response");
assert.ok(sessionUpdates.slice(gameUpdateStart).some((update) => update.manualBehaviorTurns === true));
assert.equal(behaviorGameActive, true);

gameSentStart = sockets.at(-1).sent.length;
gameUpdateStart = sessionUpdates.length;
await submitTranscript("3", "pcm-game-winning-guess");
gameSent = sockets.at(-1).sent.slice(gameSentStart);
gameUpdate = gameSent.find((event) => event.type === "session.update" && event.session?.audio?.input?.turn_detection?.create_response === true);
gameResponse = gameSent.findIndex((event) => event.type === "response.create");
assert.ok(gameUpdate, "the winning guess synchronously restores ordinary Realtime VAD configuration");
assert.ok(gameResponse > gameSent.indexOf(gameUpdate), "the winning acknowledgment follows the updated game context");
assert.equal(gameSent.filter((event) => event.type === "response.create").length, 1, "the winning final transcript creates exactly one response");
assert.ok(sessionUpdates.slice(gameUpdateStart).some((update) => update.manualBehaviorTurns === false));
assert.equal(behaviorGameActive, false);

// A barge-in can make the server deliver speech B before it finishes the
// transcript for speech A. Keep the game active, but do not manually answer A
// while the user's speech flag is still set.
gameSentStart = sockets.at(-1).sent.length;
await submitTranscript("Let's play a guessing game", "pcm-game-start-before-barge-in");
gameSentStart = sockets.at(-1).sent.length;
await service.handleEvent({ type: "input_audio_buffer.speech_started" });
assert.equal(conversationStore.isUserSpeaking, true, "PCM speech_started marks the user as speaking");
await submitTranscript("2", "pcm-delayed-transcript-after-barge-in");
assert.equal(conversationStore.isUserSpeaking, true, "a delayed transcript must not clear the active speaking flag");
assert.equal(sockets.at(-1).sent.slice(gameSentStart).some((event) => event.type === "response.create"), false, "PCM must not issue a manual game response during barge-in speech");
await service.handleEvent({ type: "input_audio_buffer.speech_stopped" });
assert.equal(conversationStore.isUserSpeaking, false, "PCM speech_stopped clears the speaking flag");

const eventCountBeforePhysical = behaviorEventsSeen.length;
await submitTranscript("LOOI stop", "physical-turn-1");
assert.equal(physicalCalls.length, 1);
assert.deepEqual(behaviorEventsSeen.slice(eventCountBeforePhysical).map((event) => event.type), ["interrupt"], "an explicit local physical command interrupts behavior instead of becoming a generic request");
assert.equal(behaviorEventsSeen.at(-1).reason, "explicit-physical-command");
physicalCompletion.resolve({ ok: true, commandKind: "stop", acknowledgement: "Stopped." });
await flush();

// A response can be generation-complete while its native PCM is still audible.
// The semantic assistant-end arrives only after the captured player's drain event.
const assistantEndCount = eventsOfType("assistant-end").length;
await service.handleEvent({ type: "response.created", response: { id: "pcm-response-1" } });
await service.handleEvent({ type: "response.output_audio.delta", item_id: "pcm-assistant-1", content_index: 0, delta: "AAAA" });
await service.handleEvent({ type: "response.output_audio_transcript.delta", item_id: "pcm-assistant-1", content_index: 0, delta: "A completed answer." });
await service.handleEvent({ type: "response.output_audio.done" });
await service.handleEvent({ type: "response.done", response: { status: "completed", output: [] } });
assert.equal(eventsOfType("assistant-end").length, assistantEndCount, "response.done must not end the semantic turn before audio drains");
assert.equal(typeof audioListeners.get("onPlaybackDrained"), "function");
audioListeners.get("onPlaybackDrained")({ playedDurationMs: 530 });
await flush();
assert.equal(eventsOfType("assistant-end").length, assistantEndCount + 1, "the audible drain completes the behavior turn");
assert.equal(eventsOfType("assistant-end").at(-1).text, "A completed answer.");

// A speech-start during a pending camera capture invalidates it in the same
// conversation. The stale still must not reach visual assessment or Realtime.
const photoSentStart = sockets.at(-1).sent.length;
const inspectionCountBeforePhoto = visualInspections.length;
const delayedPhoto = await submitVisualRequest("LOOI look at this", "visual-photo-bargein");
await service.handleEvent({ type: "input_audio_buffer.speech_started" });
delayedPhoto.capture.resolve({ mimeType: "image/jpeg", base64: "b2xkLXBob3Rv", width: 640, height: 480, lowLightLikely: false });
await flush();
assert.equal(eventsOfType("user-speech-start").at(-1).sessionId, pcmSessionId, "PCM barge-in invalidation is scoped to the current behavior session");
assert.equal(visualInspections.length, inspectionCountBeforePhoto, "barge-in while capture is pending skips assessment");
assert.deepEqual(sockets.at(-1).sent.slice(photoSentStart).filter((event) => event.type === "response.create" || event.type === "conversation.item.create"), []);

// The same-session guard also covers a barge-in while the local visual assessor
// is pending after capture has completed.
const adviceSentStart = sockets.at(-1).sent.length;
const inspectionCountBeforeAdvice = visualInspections.length;
const delayedAdvice = deferred();
visualInspectionPlans.push(delayedAdvice);
const capturedBeforeAdvice = await submitVisualRequest("LOOI look at the label", "visual-advice-bargein");
capturedBeforeAdvice.capture.resolve({ mimeType: "image/jpeg", base64: "bmV3LXBob3Rv", width: 640, height: 480, lowLightLikely: false });
for (let tries = 0; tries < 30 && visualInspections.length === inspectionCountBeforeAdvice; tries += 1) await Promise.resolve();
assert.equal(visualInspections.length, inspectionCountBeforeAdvice + 1, "capture reaches the behavior visual adapter");
await service.handleEvent({ type: "input_audio_buffer.speech_started" });
delayedAdvice.resolve("stale advice must never be sent");
await flush();
assert.deepEqual(sockets.at(-1).sent.slice(adviceSentStart).filter((event) => event.type === "response.create" || event.type === "conversation.item.create"), []);

// Roll a session while visual advice is pending; the old photo/advice cannot
// leak into the replacement conversation even though the service is reused.
const rolloverAdvice = deferred();
visualInspectionPlans.push(rolloverAdvice);
const capturedBeforeRollover = await submitVisualRequest("LOOI look at a diagram", "visual-rollover");
capturedBeforeRollover.capture.resolve({ mimeType: "image/jpeg", base64: "b2xkLWRpYWdyYW0=", width: 800, height: 600, lowLightLikely: false });
for (let tries = 0; tries < 30 && visualInspections.length < inspectionCountBeforeAdvice + 2; tries += 1) await Promise.resolve();
assert.equal(visualInspections.length, inspectionCountBeforeAdvice + 2);
const oldSocket = sockets.at(-1);
const oldSocketSentStart = oldSocket.sent.length;
const priorSessionId = service.sessionId;
await service.stop("visual-session-rollover");
await service.start();
const replacementSessionId = service.sessionId;
assert.notEqual(replacementSessionId, priorSessionId);
const replacementSocket = sockets.at(-1);
const replacementSentStart = replacementSocket.sent.length;
rolloverAdvice.resolve("old session advice");
await flush();
assert.equal(oldSocket.sent.slice(oldSocketSentStart).some((event) => event.type === "response.create"), false);
assert.deepEqual(replacementSocket.sent.slice(replacementSentStart), [], "stale visual advice cannot enter the new conversation");

// Successful visual advice is attached before response.create and bounded even
// when a local adapter returns an unexpectedly long result.
const successSentStart = replacementSocket.sent.length;
const successInspectionCount = visualInspections.length;
const successfulCapture = await submitVisualRequest("LOOI look at this package", "visual-success");
const longAdvice = "local-assessment ".repeat(150);
visualInspectionPlans.push({ promise: Promise.resolve(longAdvice) });
successfulCapture.capture.resolve({ mimeType: "image/jpeg", base64: "c2hhcmVkLWltYWdl", width: 1024, height: 768, lowLightLikely: false });
for (let tries = 0; tries < 30 && !replacementSocket.sent.slice(successSentStart).some((event) => event.type === "response.create"); tries += 1) await Promise.resolve();
assert.equal(visualInspections.length, successInspectionCount + 1);
const visualSent = replacementSocket.sent.slice(successSentStart);
const imageIndex = visualSent.findIndex((event) => event.type === "conversation.item.create" && event.item?.content?.some((part) => part.type === "input_image"));
const responseCreateIndex = visualSent.findIndex((event) => event.type === "response.create");
assert.ok(imageIndex >= 0, "the explicit still is attached to the active conversation");
assert.ok(responseCreateIndex > imageIndex, "response.create follows the image and local visual advice");
const promptText = visualSent[imageIndex].item.content.find((part) => part.type === "input_text").text;
const boundedAdvice = promptText.split("Behavior image assessment: ")[1] ?? "";
assert.ok(boundedAdvice.length > 0, "the local visual assessment is included as bounded context");
observedVisualAdviceLength = boundedAdvice.length;

await service.stop("test-cleanup");
assert.ok(eventsOfType("session-end").length >= 2, "PCM stop closes its behavior session");

// The WebRTC transport uses the same event/session seam. Exercise its actual
// event handler without creating a peer connection or reaching a network.
const webrtcChannelMessages = [];
const webrtcDependencies = {
  "../behavior/behavior-events": behaviorEvents,
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "expo-audio": { async setIsAudioActiveAsync() {} },
  "react-native-webrtc": {
    RTCPeerConnection: class {}, RTCSessionDescription: class {}, mediaDevices: {},
  },
  "../core/observation": { createObservation: () => ({}) },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../openai/openai-api-key": {
    async createOpenAiRealtimeClientSecret() { return { value: "unused-fake-secret", expiresAt: 0 }; },
    async exchangeOpenAiRealtimeSdp() { return "unused-fake-sdp"; },
  },
  "../memory/local-memory-database": { localMemoryDatabase: { async search() { return []; } } },
  "../memory/memory-service": {
    isLocalMemoryMutationInProgress: () => false,
    mirrorSessionMessage() {},
    mirrorSessionTouch() {},
  },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
  "../store/conversation": { useConversationStore: { getState: () => conversationStore } },
  "../store/user": { isPcmRealtimeMode: () => false, useUserStore: { getState: () => userStore } },
  "./kws-audio-feeder": pcmDependencies["./kws-audio-feeder"],
  "../../modules/realtime-audio-route": pcmDependencies["../../modules/realtime-audio-route"],
  "./wakeword": pcmDependencies["./wakeword"],
  "./hermes-task-tools": pcmDependencies["./hermes-task-tools"],
  "./hermes-task-tool-definitions": pcmDependencies["./hermes-task-tool-definitions"],
  "./realtime-config": pcmDependencies["./realtime-config"],
  "./realtime-physical-command": pcmDependencies["./realtime-physical-command"],
  "./realtime-visual-command": pcmDependencies["./realtime-visual-command"],
  "./realtime-pcm-conversation": { realtimePcmConversationService: { isActive: false } },
  "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute() { return { ok: true }; } } },
  "./robot-app-skill-tool-definitions": { ROBOT_APP_SKILL_TOOL_NAMES: new Set() },
};
const { RealtimeConversationService } = loadTypeScript("src/voice/realtime-conversation.ts", webrtcDependencies);
const webrtc = new RealtimeConversationService();
webrtc.active = true;
webrtc.sessionId = "webrtc-behavior-session";
webrtc.dataChannel = {
  readyState: "open",
  send(raw) { webrtcChannelMessages.push(JSON.parse(raw)); },
};
behaviorEvents.beginBehaviorSession(webrtc.sessionId, () => {
  if (webrtc.active && webrtc.sessionId === "webrtc-behavior-session") {
    webrtc.applySessionPreferences("behavior-context");
  }
});
assert.ok(sessionUpdates.some((update) => update.behaviorContext === behaviorContext), "WebRTC session updates include current local behavior context");
await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "What is the next step?", item_id: "webrtc-turn-1" });
assert.equal(eventsOfType("user-turn").at(-1).sessionId, "webrtc-behavior-session", "WebRTC accepted turns reach the shared behavior adapter");
assert.equal(webrtcChannelMessages.filter((event) => event.type === "response.create").length, 0, "ordinary WebRTC VAD does not create a duplicate manual response");
assert.ok(webrtcChannelMessages.some((event) => event.type === "session.update" && event.session?.audio?.input?.turn_detection?.create_response === true), "WebRTC ordinary turns keep server VAD response creation enabled");

// WebRTC follows the same exact-once manual turn protocol: the behavior
// adapter updates game state/context synchronously, then Realtime receives its
// new turn-detection mode before one response.create for each game turn.
let webrtcGameSentStart = webrtcChannelMessages.length;
await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Let's play a guessing game", item_id: "webrtc-game-start" });
let webrtcGameSent = webrtcChannelMessages.slice(webrtcGameSentStart);
let webrtcGameUpdateIndex = webrtcGameSent.findIndex((event) => event.type === "session.update" && event.session?.audio?.input?.turn_detection?.create_response === false);
let webrtcGameResponseIndex = webrtcGameSent.findIndex((event) => event.type === "response.create");
assert.ok(webrtcGameUpdateIndex >= 0, "WebRTC game activation enables manual turn detection");
assert.ok(webrtcGameResponseIndex > webrtcGameUpdateIndex, "WebRTC game response follows updated configuration");
assert.equal(webrtcGameSent.filter((event) => event.type === "response.create").length, 1, "WebRTC game start creates exactly one response");
assert.equal(behaviorGameActive, true);

webrtcGameSentStart = webrtcChannelMessages.length;
await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "3", item_id: "webrtc-game-winning-guess" });
webrtcGameSent = webrtcChannelMessages.slice(webrtcGameSentStart);
webrtcGameUpdateIndex = webrtcGameSent.findIndex((event) => event.type === "session.update" && event.session?.audio?.input?.turn_detection?.create_response === true);
webrtcGameResponseIndex = webrtcGameSent.findIndex((event) => event.type === "response.create");
assert.ok(webrtcGameUpdateIndex >= 0, "the winning WebRTC guess synchronously restores ordinary turn detection");
assert.ok(webrtcGameResponseIndex > webrtcGameUpdateIndex, "WebRTC winning response follows the updated outcome context");
assert.equal(webrtcGameSent.filter((event) => event.type === "response.create").length, 1, "the WebRTC winning transcript creates exactly one response");
assert.equal(behaviorGameActive, false);

// Preserve the same barge-in ordering on WebRTC: speech B starts while the
// number game is active, then a late transcript A arrives before VAD stops.
// The transcript remains semantic, but cannot request a second response while
// the user-speaking flag is true.
webrtcGameSentStart = webrtcChannelMessages.length;
await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Let's play a guessing game", item_id: "webrtc-game-start-before-barge-in" });
assert.ok(webrtcChannelMessages.slice(webrtcGameSentStart).some((event) => event.type === "response.create"));
webrtcGameSentStart = webrtcChannelMessages.length;
await webrtc.handleEvent({ type: "input_audio_buffer.speech_started" });
assert.equal(conversationStore.isUserSpeaking, true, "WebRTC speech_started marks the user as speaking");
await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "2", item_id: "webrtc-delayed-transcript-after-barge-in" });
assert.equal(conversationStore.isUserSpeaking, true, "a delayed WebRTC transcript must not clear the active speaking flag");
assert.equal(webrtcChannelMessages.slice(webrtcGameSentStart).some((event) => event.type === "response.create"), false, "WebRTC must not issue a manual game response during barge-in speech");

// Explicit physical and visual commands must stay out of the semantic user
// turn stream in WebRTC, just as they do for the PCM transport.
for (const [transcript, itemId] of [["LOOI stop", "webrtc-physical"], ["LOOI look at this", "webrtc-visual"]]) {
  const eventStart = behaviorEventsSeen.length;
  const sentStart = webrtcChannelMessages.length;
  await webrtc.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript, item_id: itemId });
  const emitted = behaviorEventsSeen.slice(eventStart);
  assert.deepEqual(emitted.map((event) => event.type), ["interrupt"], `WebRTC ${itemId} must interrupt without publishing a semantic user turn`);
  assert.equal(emitted[0].reason, "explicit-command");
  assert.equal(webrtcChannelMessages.slice(sentStart).some((event) => event.type === "response.create"), false, `WebRTC ${itemId} must not create a game response`);
}

await webrtc.handleEvent({ type: "input_audio_buffer.speech_started" });
assert.equal(eventsOfType("user-speech-start").at(-1).sessionId, "webrtc-behavior-session", "WebRTC barge-in reaches the shared behavior adapter");

const webrtcAssistantEndCount = eventsOfType("assistant-end").length;
await webrtc.handleEvent({ type: "output_audio_buffer.started", response_id: "webrtc-response-1" });
await webrtc.handleEvent({ type: "response.output_audio_transcript.delta", delta: "Audible WebRTC answer." });
await webrtc.handleEvent({ type: "response.done", response: { status: "completed", output: [] } });
assert.equal(eventsOfType("assistant-end").length, webrtcAssistantEndCount, "WebRTC response.done waits while its audio buffer is still playing");
await webrtc.handleEvent({ type: "output_audio_buffer.stopped", response_id: "webrtc-response-1" });
assert.equal(eventsOfType("assistant-end").length, webrtcAssistantEndCount + 1, "WebRTC's audible buffer stop completes the semantic assistant turn");
assert.equal(eventsOfType("assistant-end").at(-1).text, "Audible WebRTC answer.");
assert.ok(webrtcChannelMessages.some((event) => event.type === "session.update"), "behavior context refreshes through a real WebRTC channel send");
behaviorEvents.endBehaviorSession(webrtc.sessionId);
webrtc.active = false;

assert.ok(observedVisualAdviceLength <= 1_000, `visual advice must be capped at 1,000 characters (received ${observedVisualAdviceLength})`);
detachAdapter();
globalThis.WebSocket = originalWebSocket;
console.log("Realtime PCM/WebRTC behavior integration: PASS");
