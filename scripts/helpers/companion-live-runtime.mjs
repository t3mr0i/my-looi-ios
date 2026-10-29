import { createTypeScriptTreeLoader } from "./load-typescript-tree.mjs";

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = (select = (value) => value) => select(state);
  store.getState = () => state;
  store.setState = (patch) => {
    const previous = state;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state, previous);
  };
  store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return store;
}

export function createCompanionLiveRuntime({ robotName = "LOOI", memoryFacts = [], reducedMotion = true } = {}) {
  const { DEFAULT_REALTIME_MODEL_ID } = createTypeScriptTreeLoader()("src/openai/realtime-models.ts");
  const storage = new Map();
  const audioListeners = new Map();
  const assistantRecognitionListeners = new Map();
  const externalBridgeCalls = [];
  const behaviorHeadCalls = [];
  let mainScreenFocused = true;
  const focusListeners = new Set();
  const appListeners = new Set();
  const motionListeners = new Set();
  const appState = { currentState: "active", addEventListener(_name, listener) { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } };
  const audio = { addListener(name, listener) { const listeners = audioListeners.get(name) ?? new Set(); listeners.add(listener); audioListeners.set(name, listeners); return { remove() { listeners.delete(listener); } }; }, emit(name, event) { for (const listener of audioListeners.get(name) ?? []) listener(event); }, beginPlayback() {}, enqueuePlayback() {}, finishPlayback() {}, stopPlayback: () => ({ playedDurationMs: 0 }) };
  const voskCommandRecognizer = {
    addListener(name, listener) {
      const listeners = assistantRecognitionListeners.get(name) ?? new Set();
      listeners.add(listener);
      assistantRecognitionListeners.set(name, listeners);
      return { remove() { listeners.delete(listener); } };
    },
    async beginAssistantOutput() { return { ready: false, generation: 0 }; },
    endAssistantOutput() {},
    cancelAssistantOutput() {},
    feedAssistantPcm24() { return false; },
  };
  const conversation = createStore({ clearInputAttention() {}, isUserSpeaking: false, isSpeaking: false, isProcessing: false, streamingText: "", heardSpeechText: null, setUserSpeaking(v) { this.isUserSpeaking = v; }, setSpeaking(v) { this.isSpeaking = v; }, setProcessing(v) { this.isProcessing = v; }, setListening() {}, setRealtimeReadiness() {}, setRealtimeIssue() {}, setCurrentTranscript() {}, setStreamingText(v) { this.streamingText = v; }, setHeardSpeechText(v) { this.heardSpeechText = v; }, addMessage() {}, setActiveSession() {} });
  const preferences = { language: "de", listeningLanguage: "de", realtimeModelId: DEFAULT_REALTIME_MODEL_ID, ttsVoiceId: "shimmer", ttsSpeed: 1, ttsStyleId: "playful-robot", speechGender: "masculine", robotName, robotAddressAliases: [], robotAddressRecognitionAliases: [], customVoiceCommands: {}, ambientMotionLevel: "normal", voiceOutputGain: 1, cameraAttentionEnabled: false };
  const user = createStore({ preferences, robotSleeping: false, setVoiceState() {}, updatePreferences(patch) { Object.assign(preferences, patch); } });
  const memoryRecords = memoryFacts.map((fact, index) => ({ id: `live-fact-${index + 1}`, memory: fact.memory, metadata: fact.metadata ?? { category: "preference", origin: "synthetic-live-fixture" }, updatedAt: new Date().toISOString() }));
  const localMemoryDatabase = {
    async search(query) {
      const terms = String(query).toLocaleLowerCase().split(/\W+/u).filter(Boolean);
      return memoryRecords.filter((record) => terms.some((term) => record.memory.toLocaleLowerCase().includes(term))).slice(0, 6);
    },
    async remember(messages, metadata, isCurrent = () => true) {
      if (!isCurrent()) return;
      const memory = String(messages?.[0]?.content ?? "").slice(0, 600);
      if (memory) memoryRecords.push({ id: `live-fact-${memoryRecords.length + 1}`, memory, metadata: metadata ?? {}, updatedAt: new Date().toISOString() });
    },
  };
  const events = createTypeScriptTreeLoader()("src/behavior/behavior-events.ts");
  const robotState = { connected: false, motionActive: false, stopGeneration: 0, safety: {} };
  const robotListeners = new Set();
  const setRobotRuntimeState = (patch) => {
    Object.assign(robotState, patch);
    for (const listener of robotListeners) listener();
  };
  const overrides = {
    "react-native": { Platform: { OS: "ios" }, AppState: appState, AccessibilityInfo: { isReduceMotionEnabled: async () => reducedMotion, addEventListener(_name, listener) { motionListeners.add(listener); return { remove: () => motionListeners.delete(listener) }; } } },
    "react-native-webrtc": { RTCPeerConnection: class {}, RTCSessionDescription: class {}, mediaDevices: {} },
    "expo-audio": { async setIsAudioActiveAsync() { throw new Error("native audio disabled in live text evaluation"); } },
    zustand: { create: (initializer) => createStore(initializer()) },
    "react-native-mmkv": { createMMKV: () => ({ getString: (key) => storage.get(key), set: (key, value) => storage.set(key, value) }) },
    "../behavior/behavior-events": events,
    "./behavior-events": events,
    "../store/user": { useUserStore: user },
    "../store/conversation": { useConversationStore: conversation },
    "../memory/local-memory-database": { localMemoryDatabase },
    "../memory/memory-service": { isLocalMemoryMutationInProgress: () => false, mirrorSessionMessage() {}, mirrorSessionTouch() {}, async retrieveConversationMemories() { return { facts: memoryRecords, strategy: "synthetic-live-fixture" }; }, async stopConversationForMemoryChange() {} },
    "../memory/memory-mutation": { async runLocalMemoryMutation(prepare, mutate) { await prepare(); return mutate(); } },
    "../openai/decisions": { async requestDecisions(input) { return { answers: input.questions.map((question) => question.type === "score" ? { name: question.name, type: "score", score: 0, confidence: 1 } : { name: question.name, type: "choice", choice: question.name === "cue" ? "hold" : question.name === "attention" ? "keep_target" : "wait", confidence: 1 }), usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "synthetic-live-local-decision" }; } },
    "../core/main-screen-presence": { isMainScreenFocused: () => mainScreenFocused, subscribeMainScreenFocused: (listener) => { focusListeners.add(listener); return () => focusListeners.delete(listener); } },
    "../core/ambient-motion": { configureAmbientBehaviorPolicy() {}, holdAmbientMotionFor() {}, holdAmbientHeadMotionFor() {} },
    "../core/social-attention": { configureSocialBehaviorPolicy() {}, getSocialAttentionControllerState: () => ({ faces: [], interactionSignalsSupported: false }), holdSocialAttentionMotionFor() {}, setSocialInteractionSignalRequest() {} },
    "../core/interaction-start-signal": { createInteractionStartSignalDetector: () => ({ reset() {}, arm() {}, frame: () => false }) },
    "../device-tools/looi-robot": { cancelLooiHeadMotion() {}, getLooiRobotRuntimeState: () => robotState, async performLooiBehaviorHeadGesture(gesture) { behaviorHeadCalls.push(gesture); return { completed: false }; }, subscribeLooiRobotRuntimeState: (listener) => { robotListeners.add(listener); return () => robotListeners.delete(listener); } },
    "../character/character-reaction": { clearCharacterReaction() {}, triggerCharacterReaction: () => 0, useCharacterReactionStore: createStore({ reactionId: 0 }) },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute(name, args) { externalBridgeCalls.push({ bridge: "hermes", name, args }); return { ok: false, status: "disabled-in-text-evaluation" }; } } },
    "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute(name, args) { externalBridgeCalls.push({ bridge: "robot-app", name, args }); return { ok: false, status: "disabled-in-text-evaluation" }; } } },
    "../../modules/vosk-command-recognizer": { __esModule: true, default: voskCommandRecognizer },
    "../core/observation": { createObservation: () => ({ metadata: {} }) },
    "../core/robot-inactivity": { markRobotInteraction() {} },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../openai/openai-api-key": { async createOpenAiRealtimeClientSecret() { throw new Error("live harness must not request an ephemeral secret"); }, async createOpenAiRealtimeEphemeralWebSocket() { throw new Error("live harness injects its authenticated WebSocket"); } },
    "../openai/openai-api-status": { classifyOpenAiError: () => null, async setOpenAiApiStatus() {} },
    "../../modules/realtime-audio-route": { async activateRealtimeSpeakerRoute() { return {}; }, async deactivateRealtimeSpeakerRoute() { return {}; }, async getRealtimeAudioRouteStatus() { return {}; }, async ensureRealtimeSpeakerRoute() { return {}; } },
    "../../modules/local-realtime-audio-capture/realtime-pcm": { getRealtimePcmAudioModule: () => audio, async startPcmCapture() { throw new Error("native capture disabled in live text evaluation"); }, async stopPcmCapture() {}, async reservePcmCapture() {} },
    "./audio-capture-profile": { isRealtimeCaptureReady: () => false },
    "./kws-audio-feeder": { kwsAudioFeeder: { diagnosticStatus: { appCaptureAllowed: false }, isRunning: false, setAppCaptureAllowed() {}, getRecentSamples: () => [], async stop() {}, async start() {} } },
    "./wakeword": { wakewordService: { isListening: false, async stop() {}, async waitForFallbackIdle() {}, async start() {} } },
    "./realtime-physical-command": { parseRealtimePhysicalCommand: () => null, async executeRealtimePhysicalCommand() { throw new Error("physical commands disabled in live text evaluation"); } },
    "./realtime-visual-command": { parseRealtimeVisualCommand: () => null },
    "../vision/look-here": { async captureExplicitLookHereStill() { throw new Error("camera disabled in live text evaluation"); } },
  };
  const load = createTypeScriptTreeLoader(overrides);
  const runtime = load("src/behavior/behavior-runtime.ts");
  const config = load("src/voice/realtime-config.ts");
  const { RealtimePcmConversationService } = load("src/voice/realtime-pcm-conversation.ts");
  const { RealtimeConversationService } = load("src/voice/realtime-conversation.ts");
  runtime.updateBehaviorSettings({ mode: "active", candidateScoring: false, visualEnabled: false, curiosityEnabled: false, dailyBudgetUsd: 0.25 });
  const uninstallRuntime = runtime.installBehaviorRuntime();
  return { events, runtime, behaviorEngine: runtime.behaviorEngine, config, preferences, user, conversation, localMemoryDatabase, externalBridgeCalls, behaviorHeadCalls, RealtimePcmConversationService, RealtimeConversationService, uninstallRuntime, setRobotRuntimeState,
    setMainScreenFocused(value) { mainScreenFocused = value; for (const listener of focusListeners) listener(value); },
    setAppState(value) { appState.currentState = value; for (const listener of appListeners) listener(value); },
    setReducedMotion(value) { reducedMotion = value; for (const listener of motionListeners) listener(value); },
    bindPcmAudioEventsForOfflineTest: (service) => service.bindNativeAudioEvents(), emitPcmAudioEvent: (name, event) => audio.emit(name, event), emitAssistantRecognitionEvent: (name, event) => { for (const listener of assistantRecognitionListeners.get(name) ?? []) listener(event); } };
}
