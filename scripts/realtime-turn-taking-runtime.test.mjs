import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

export function createRealtimeHarness(clockGlobals = {}) {
const diagnostics = [];
const configsMinted = [];
const prefs = {
  language: "en", listeningLanguage: "en", realtimeModelId: "test", ttsVoiceId: "alloy", ttsSpeed: 1,
  speechGender: "neutral", robotName: "LOOI", robotAddressAliases: [], robotAddressRecognitionAliases: [],
  realtimeTurnTaking: "semantic",
};
const conversationState = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
const userState = { preferences: prefs, robotSleeping: false, setVoiceState() {} };
const store = { getState: () => userState };
const events = {
  beginBehaviorSession() {}, endBehaviorSession() {}, getBehaviorConversationContext: () => "",
  getBehaviorInteractionRevision: () => null, getBehaviorInteractionSnapshot: () => null,
  requiresBehaviorTurnCommit: () => false, performBehaviorCompanionAction() {}, publishBehaviorEvent() {},
};
const hermesTaskToolDefinitions = loadTypeScript("src/voice/hermes-task-tool-definitions.ts");
const robotAppSkillToolDefinitions = loadTypeScript("src/voice/robot-app-skill-tool-definitions.ts");
const voskCommandRecognizer = {
  addListener: () => ({ remove() {} }),
  async beginAssistantOutput() { return { ready: false, generation: 0 }; },
  cancelAssistantOutput() {}, endAssistantOutput() {}, feedAssistantPcm24() { return false; },
};
const config = loadTypeScript("src/voice/realtime-config.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "../openai/realtime-models": { DEFAULT_REALTIME_MODEL_ID: "test", normalizeRealtimeModelId: (v) => v, supportsRealtimeReasoning: () => false },
  "./tts-voices": { DEFAULT_TTS_VOICE_ID: "alloy", getTtsStyleInstructions: () => "" },
  "./hermes-completion-copy": loadTypeScript("src/voice/hermes-completion-copy.ts"),
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
});
const fakeAudio = {
  addListener: () => ({ remove() {} }), beginPlayback() {}, enqueuePlayback() {}, finishPlayback() {},
  stopPlayback: () => ({ playedDurationMs: 0 }),
};
const captureStatus = {
  supported: true, captureRunning: true, captureSampleRate: 16_000, audioSource: "mock",
  audioSessionId: 1, aecAvailable: true, aecEnabled: true, noiseSuppressorExplicit: false,
  playbackRunning: false, playbackSampleRate: 24_000,
};
const feeder = {
  diagnosticStatus: { appCaptureAllowed: true, pcmFlowing: false }, isRunning: false,
  setAppCaptureAllowed() {}, setWakewordFeedingEnabled() {}, getRecentSamples: () => [],
  subscribeSamples: () => () => {},
  async stop() { this.isRunning = false; }, async start() { this.isRunning = true; },
};
const wakeword = { isListening: false, async stop() {}, async start() {}, async waitForFallbackIdle() {} };
const route = { supported: false, active: false, speakerSelected: false, modeMatchesCommunication: true };
const pcmSockets = [];
class FakeWebSocket {
  constructor() { this.readyState = 1; this.sent = []; pcmSockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}
const peers = [];
class FakePeer {
  constructor() { this.signalingState = "stable"; this.connectionState = "connected"; this.iceConnectionState = "connected"; peers.push(this); }
  addTrack() {}
  createDataChannel() { return { readyState: "open", send: (raw) => this.sent.push(JSON.parse(raw)), close() {}, sent: (this.sent = []) }; }
  async createOffer() { return { type: "offer", sdp: "mock-offer" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
  getStats() { return Promise.resolve(new Map()); }
}
const deps = {
  "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
  "../behavior/behavior-events": events,
  "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, Platform: { OS: "ios" } },
  "expo-audio": { setIsAudioActiveAsync: async () => {} },
  "react-native-webrtc": {
    RTCPeerConnection: FakePeer, RTCSessionDescription: class { constructor(value) { Object.assign(this, value); } },
    mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [{ enabled: true, stop() {} }], getTracks: () => [{ stop() {} }] }) },
  },
  "../core/observation": { createObservation: () => ({}) },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (...args) => diagnostics.push(args) },
  "../openai/openai-api-key": {
    async createOpenAiRealtimeClientSecret(session) { configsMinted.push(structuredClone(session)); return { value: "offline-mock", expiresAt: 0 }; },
    async exchangeOpenAiRealtimeSdp() { return "mock-answer"; },
    createOpenAiRealtimeEphemeralWebSocket() { return new FakeWebSocket(); },
  },
  "../memory/local-memory-database": { localMemoryDatabase: { async search() { return []; } } },
  "../memory/memory-service": {
    isLocalMemoryMutationInProgress: () => false, mirrorSessionMessage() {}, mirrorSessionTouch() {},
    retrieveConversationMemories: async () => ({ facts: [], strategy: "mock" }),
  },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
  "../store/conversation": { useConversationStore: { getState: () => conversationState } },
  "../store/user": { useUserStore: store, isPcmRealtimeMode: () => false },
  "./kws-audio-feeder": { kwsAudioFeeder: feeder },
  "../../modules/realtime-audio-route": {
    activateRealtimeSpeakerRoute: async () => route, deactivateRealtimeSpeakerRoute: async () => route,
    ensureRealtimeSpeakerRoute: async () => route, getRealtimeAudioRouteStatus: async () => route,
  },
  "./wakeword": { wakewordService: wakeword },
  "./realtime-config": config,
  "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute() { return { ok: true }; } } },
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute() { return { ok: true }; } } },
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
  "./realtime-physical-command": { parseRealtimePhysicalCommand: () => null, executeRealtimePhysicalCommand: async () => ({}) },
  "./realtime-visual-command": { parseRealtimeVisualCommand: () => null },
  "./realtime-pcm-conversation": { realtimePcmConversationService: { isActive: false } },
  "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
  "../../modules/local-realtime-audio-capture/realtime-pcm": {
    getRealtimePcmAudioModule: () => fakeAudio, startPcmCapture: async () => captureStatus,
    stopPcmCapture: async () => {}, reservePcmCapture: async () => {},
  },
  "../../modules/vosk-command-recognizer": voskCommandRecognizer,
  "../character/speech-expression": {
    createSpeechExpressionTracker: () => ({
      acceptRecognition() {}, setNativeGeneration() {}, advancePlayback() {}, setTranscript() {}, invalidate() {},
    }),
  },
  "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
  "../language/response-language": { normalizeResponseLanguage: (language) => language },
  "../core/robot-inactivity": { markRobotInteraction() {} },
  "../vision/look-here": { captureExplicitLookHereStill: async () => ({}) },
  "../openai/openai-api-status": { classifyOpenAiError: () => null, setOpenAiApiStatus: async () => {} },
};
const globals = { WebSocket: { OPEN: 1 }, ...clockGlobals };
const { RealtimeConversationService } = loadTypeScript("src/voice/realtime-conversation.ts", deps, globals);
const { RealtimePcmConversationService } = loadTypeScript("src/voice/realtime-pcm-conversation.ts", deps, globals);

return { diagnostics, configsMinted, prefs, conversationState, userState, events, fakeAudio, captureStatus,
  feeder, wakeword, pcmSockets, peers, deps, RealtimeConversationService, RealtimePcmConversationService };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
const { diagnostics, configsMinted, prefs, events, pcmSockets, peers,
  RealtimeConversationService, RealtimePcmConversationService } = createRealtimeHarness();

function turnDetection(session) { return session.audio.input.turn_detection; }
function acknowledged(name) { return diagnostics.filter(([area, event]) => area === "realtime" && event === name).map(([, , fields]) => fields); }

for (const [name, Service] of [["webrtc", RealtimeConversationService], ["pcm", RealtimePcmConversationService]]) {
  diagnostics.length = 0;
  configsMinted.length = 0;
  prefs.realtimeTurnTaking = "semantic";
  const service = new Service();

  await service.start();
  assert.equal(service.isActive ?? service.active, true, `${name}: real start lifecycle became active`);
  assert.equal(turnDetection(configsMinted[0]).type, "semantic_vad", `${name}: start mints semantic session config`);
  const channel = name === "pcm" ? pcmSockets.at(-1) : peers.at(-1).sent && service.dataChannel;
  const sent = name === "pcm" ? channel.sent : channel.sent;
  const initialUpdate = sent.find((event) => event.type === "session.update");
  assert.equal(turnDetection(initialUpdate.session).type, "semantic_vad", `${name}: initial transport update is semantic`);

  const noAckName = name === "pcm" ? "pcm-session-configured" : "session-configured";
  assert.deepEqual(acknowledged(noAckName), [], `${name}: profile is not reported before server acknowledgement`);
  const semanticAck = { audio: { input: { turn_detection: { type: "semantic_vad", eagerness: "auto", interrupt_response: true } } } };
  await service.handleEvent({ type: "session.updated", session: semanticAck });
  assert.equal(acknowledged(noAckName).at(-1).effectiveTurnTakingProfile, "semantic", `${name}: diagnostic reports acknowledged profile`);
  assert.equal(acknowledged(noAckName).at(-1).semanticEagerness, "auto");

  // A setting changed mid-session applies only after the next session starts.
  prefs.realtimeTurnTaking = "fixed";
  assert.equal(service.applySessionPreferences("preference-changed"), true);
  assert.equal(turnDetection(sent.at(-1).session).type, "semantic_vad", `${name}: no mid-turn/profile switch`);
  events.requiresBehaviorTurnCommit = () => true;
  assert.equal(service.applySessionPreferences("manual-behavior-gate"), true);
  const manualUpdate = turnDetection(sent.at(-1).session);
  assert.equal(manualUpdate.type, "semantic_vad");
  assert.equal(manualUpdate.create_response, false, `${name}: manual authoritative response gate is retained`);
  assert.equal(manualUpdate.interrupt_response, true);
  events.requiresBehaviorTurnCommit = () => false;

  await service.stop("turn-taking-test-restart");
  await service.start();
  assert.equal(turnDetection(configsMinted.at(-1)).type, "server_vad", `${name}: restart captures the newly selected fixed profile`);
  const restartedChannel = name === "pcm" ? pcmSockets.at(-1) : service.dataChannel;
  const restartedSent = restartedChannel.sent;
  assert.equal(turnDetection(restartedSent.find((event) => event.type === "session.update").session).type, "server_vad");
  assert.deepEqual(acknowledged(noAckName).at(-1).effectiveTurnTakingProfile, "semantic", `${name}: no fixed success is claimed before its acknowledgement`);
  await service.handleEvent({ type: "session.updated", session: { audio: { input: { turn_detection: { type: "server_vad", threshold: 0.15, interrupt_response: true } } } } });
  assert.equal(acknowledged(noAckName).at(-1).effectiveTurnTakingProfile, "fixed", `${name}: fixed profile is reported after server acknowledgement`);
  await service.stop("test-cleanup");
}

console.log("Realtime turn-taking transport lifecycle: passed (semantic start, frozen updates, acknowledged profile, fixed restart; WebRTC + PCM)");

}
