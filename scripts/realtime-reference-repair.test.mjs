import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => { for (let index = 0; index < 36; index += 1) await Promise.resolve(); };
function store(initial) {
  let state = initial;
  const listeners = new Set();
  const use = (select = (value) => value) => select(state);
  use.getState = () => state;
  use.setState = (patch) => { const previous = state; state = { ...state, ...patch }; for (const listener of listeners) listener(state, previous); };
  use.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return use;
}

const events = createTypeScriptTreeLoader()("src/behavior/behavior-events.ts");
const preferences = { language: "en", listeningLanguage: "en", realtimeModelId: "test-realtime", ttsVoiceId: "alloy", ttsSpeed: 1, speechGender: "neutral", robotName: "LOOI", robotAddressAliases: [], robotAddressRecognitionAliases: [], customVoiceCommands: {}, ambientMotionLevel: "normal", voiceOutputGain: 1, cameraAttentionEnabled: true };
const userStore = store({ preferences, robotSleeping: false, setVoiceState() {}, updatePreferences(patch) { Object.assign(preferences, patch); } });
const conversationStore = store({ clearInputAttention() {}, isUserSpeaking: false, isSpeaking: false, isProcessing: false, streamingText: "", heardSpeechText: null, setUserSpeaking(value) { this.isUserSpeaking = value; }, setSpeaking(value) { this.isSpeaking = value; }, setListening() {}, setProcessing(value) { this.isProcessing = value; }, setRealtimeReadiness() {}, setRealtimeIssue() {}, setCurrentTranscript() {}, addMessage() {}, setStreamingText(value) { this.streamingText = value; }, setHeardSpeechText(value) { this.heardSpeechText = value; }, setActiveSession() {} });
const storage = new Map();
let forceVisualCommand = false;
const rememberedNotes = [];
let pendingRememberCommit = null;
let deferMemorySearch = false;
let pendingMemorySearch = null;
const localMemoryDatabase = {
  search() {
    if (!deferMemorySearch) return Promise.resolve([]);
    return new Promise((resolve) => { pendingMemorySearch = () => resolve([]); });
  },
  remember(messages, _metadata, isCurrent = () => true) {
    return new Promise((resolve) => {
      pendingRememberCommit = () => {
        const current = isCurrent();
        if (current) rememberedNotes.push(messages[0]?.content ?? "");
        resolve();
        return current;
      };
    });
  },
};
const behaviorEngineModule = createTypeScriptTreeLoader()("src/behavior/behavior-engine.ts");
const runtime = loadTypeScript("src/behavior/behavior-runtime.ts", {
  "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) } },
  zustand: { create: (init) => store(init()) },
  "react-native-mmkv": { createMMKV: () => ({ getString: (key) => storage.get(key), set: (key, value) => storage.set(key, value) }) },
  "./behavior-engine": behaviorEngineModule,
  "./game-face-feedback": loadTypeScript("src/behavior/game-face-feedback.ts"),
  "./listening-opportunity": loadTypeScript("src/behavior/listening-opportunity.ts"),
  "./behavior-face-feedback": loadTypeScript("src/behavior/behavior-face-feedback.ts"),
  "./behavior-expression": loadTypeScript("src/behavior/behavior-expression.ts"),
  "./behavior-events": events,
  "../memory/memory-mutation": { runLocalMemoryMutation: async (prepare, mutate) => { await prepare(); return mutate(); } },
  "../memory/memory-service": { async stopConversationForMemoryChange() {} },
  "../openai/decisions": { async requestDecisions(input) { return { answers: input.questions.map((question) => question.type === "score"
    ? { name: question.name, type: "score", score: 0, confidence: 1 }
    : { name: question.name, type: "choice", choice: question.name === "cue" ? "hold" : question.name === "attention" ? "keep_target" : "wait", confidence: 1 }), usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, requestId: "offline-repair" }; } },
  "../store/user": { useUserStore: userStore },
  "../store/conversation": { useConversationStore: conversationStore },
  "../core/main-screen-presence": { isMainScreenFocused: () => true, subscribeMainScreenFocused: () => () => {} },
  "../core/ambient-motion": { configureAmbientBehaviorPolicy() {}, holdAmbientMotionFor() {}, holdAmbientHeadMotionFor() {} },
  "../core/social-attention": { configureSocialBehaviorPolicy() {}, getSocialAttentionControllerState: () => ({ faces: [] }), holdSocialAttentionMotionFor() {}, setSocialInteractionSignalRequest() {} },
  "../core/interaction-start-signal": { createInteractionStartSignalDetector: () => ({ reset() {}, arm() {}, frame: () => false }) },
  "../device-tools/looi-robot": { cancelLooiHeadMotion() {}, getLooiRobotRuntimeState: () => ({ connected: true, motionActive: false, stopGeneration: 0, safety: {} }), performLooiBehaviorHeadGesture: async () => ({ completed: true }), subscribeLooiRobotRuntimeState: () => () => {} },
  "../character/character-reaction": { clearCharacterReaction() {}, triggerCharacterReaction: () => 1, useCharacterReactionStore: store({ reactionId: 0 }) },
  "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
});

const hermesTaskToolDefinitions = loadTypeScript("src/voice/hermes-task-tool-definitions.ts");
const robotAppSkillToolDefinitions = loadTypeScript("src/voice/robot-app-skill-tool-definitions.ts");
const config = loadTypeScript("src/voice/realtime-config.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "../openai/realtime-models": { DEFAULT_REALTIME_MODEL_ID: "test-realtime", normalizeRealtimeModelId: (value) => value, supportsRealtimeReasoning: () => false },
  "./tts-voices": { DEFAULT_TTS_VOICE_ID: "alloy", getTtsStyleInstructions: () => "" },
  "./hermes-completion-copy": loadTypeScript("src/voice/hermes-completion-copy.ts"),
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
});
let pcmEnqueueCount = 0;
let pcmFinishCount = 0;
const audio = { addListener: () => ({ remove() {} }), beginPlayback() {}, enqueuePlayback() { pcmEnqueueCount += 1; }, finishPlayback() { pcmFinishCount += 1; }, stopPlayback: () => ({ playedDurationMs: 0 }) };
const deps = {
  "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
  "../behavior/behavior-events": events,
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "expo-audio": { async setIsAudioActiveAsync() {} },
  "react-native-webrtc": { RTCPeerConnection: class {}, RTCSessionDescription: class {}, mediaDevices: {} },
  "../core/observation": { createObservation: () => ({}) },
  "../core/robot-inactivity": { markRobotInteraction() {} },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../memory/local-memory-database": { localMemoryDatabase },
  "../memory/memory-service": { isLocalMemoryMutationInProgress: () => false, mirrorSessionMessage() {}, mirrorSessionTouch() {}, async retrieveConversationMemories() { return { facts: [], strategy: "test" }; } },
  "../openai/openai-api-key": { async createOpenAiRealtimeClientSecret() { return { value: "offline", expiresAt: 0 }; }, async exchangeOpenAiRealtimeSdp() { return "offline"; }, createOpenAiRealtimeEphemeralWebSocket: () => ({ readyState: 1, send() {}, close() {} }) },
  "../store/conversation": { useConversationStore: { getState: () => conversationStore.getState() } },
  "../store/user": { useUserStore: { getState: () => userStore.getState() }, isPcmRealtimeMode: () => false },
  "../vision/look-here": { async captureExplicitLookHereStill() { throw new Error("not used"); } },
  "../openai/openai-api-status": { classifyOpenAiError: () => null, async setOpenAiApiStatus() {} },
  "../../modules/realtime-audio-route": { async activateRealtimeSpeakerRoute() {}, async deactivateRealtimeSpeakerRoute() {}, async getRealtimeAudioRouteStatus() { return {}; }, async ensureRealtimeSpeakerRoute() { return {}; } },
  "../../modules/local-realtime-audio-capture/realtime-pcm": { getRealtimePcmAudioModule: () => audio, async startPcmCapture() { return {}; }, async stopPcmCapture() {}, async reservePcmCapture() {} },
  "../../modules/vosk-command-recognizer": { __esModule: true, default: { addListener: () => ({ remove() {} }), async beginAssistantOutput() { return { ready: false, generation: 1 }; }, feedAssistantPcm24() { return false; }, endAssistantOutput() {}, cancelAssistantOutput() {} } },
  "../character/speech-expression": loadTypeScript("src/character/speech-expression.ts"),
  "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
  "../language/response-language": { normalizeResponseLanguage: (value) => value },
  "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
  "./kws-audio-feeder": { kwsAudioFeeder: { diagnosticStatus: { appCaptureAllowed: true }, isRunning: false, setAppCaptureAllowed() {}, setWakewordFeedingEnabled() {}, getRecentSamples: () => [], async stop() {}, async start() {} } },
  "./realtime-config": config,
  "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute() { return { ok: true }; } } },
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tools": { robotAppSkillToolBridge: { async execute() { return { ok: true }; } } },
  "./robot-app-skill-tool-definitions": robotAppSkillToolDefinitions,
  "./wakeword": { wakewordService: { isListening: false, async stop() {}, async waitForFallbackIdle() {}, async start() {} } },
  "./realtime-physical-command": { parseRealtimePhysicalCommand: () => null, async executeRealtimePhysicalCommand() {} },
  "./realtime-visual-command": { parseRealtimeVisualCommand: (text) => forceVisualCommand && text.includes("look at this") ? { kind: "look_here", cameraFacing: "rear" } : null },
  "./realtime-pcm-conversation": { realtimePcmConversationService: { isActive: false } },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
};
const { RealtimePcmConversationService } = loadTypeScript("src/voice/realtime-pcm-conversation.ts", deps);
const { RealtimeConversationService } = loadTypeScript("src/voice/realtime-conversation.ts", deps);

runtime.updateBehaviorSettings({ mode: "active", candidateScoring: false });
const uninstallRuntime = runtime.installBehaviorRuntime();

async function assertCorrectionRecovery(transport, name) {
  const messages = [];
  const sessionId = `repair-${name}`;
  transport.active = true;
  transport.sessionId = sessionId;
  if (name === "pcm") transport.webSocket = { readyState: 1, send(raw) { messages.push(JSON.parse(raw)); }, close() {} };
  else transport.dataChannel = { readyState: "open", send(raw) { messages.push(JSON.parse(raw)); } };
  events.beginBehaviorSession(sessionId, () => { if (transport.active && transport.sessionId === sessionId) transport.applySessionPreferences("behavior-context"); });
  const initialUpdate = config.buildRealtimeSessionUpdate(preferences, undefined, undefined, events.getBehaviorConversationContext(sessionId), events.requiresBehaviorTurnCommit(sessionId));
  messages.push(initialUpdate);
  assert.equal(initialUpdate.session.audio.input.turn_detection.create_response, true, `${name}: ordinary initial turns keep VAD automatic`);

  let episode = runtime.behaviorEngine.getState().companion.episodes[0];
  if (!episode) {
    const title = `Gerda ${name}`;
    const historyText = `We built the kite ${title} together and it finally flew.`;
    events.publishBehaviorEvent({ type: "user-turn", text: historyText, sessionId, turnId: `${name}-seed` });
    const proposal = events.performBehaviorCompanionAction({ type: "propose_experience", title, detail: "We built a paper kite.", outcome: "It flew.", motif: "happy_bob", evidence: historyText.slice(0, -1) }, sessionId);
    assert.equal(proposal.status, "proposed", `${name}: a confirmed episode is present to detect an accidental stale action`);
    events.publishBehaviorEvent({ type: "assistant-end", text: `Should I remember ${title}?`, sessionId });
    events.publishBehaviorEvent({ type: "user-turn", text: "Yes", sessionId, turnId: `${name}-seed-confirmation` });
    episode = runtime.behaviorEngine.getState().companion.episodes[0];
  }
  const episodeId = episode.id;
  assert.ok(episodeId);
  assert.equal(events.requiresBehaviorTurnCommit(sessionId), false, `${name}: an ordinary turn is automatic before correction`);

  // Real transport sees VAD's early response before it receives the transcript.
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-early-response` } });
  if (name === "pcm") await transport.handleEvent({ type: "response.output_audio.delta", delta: "AAAA", item_id: `${name}-assistant-item`, content_index: 0 });
  else await transport.handleEvent({ type: "output_audio_buffer.started", response_id: `${name}-early-response` });
  assert.equal(transport.playbackActive, true, `${name}: early VAD response is already playing before the correction transcript`);
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-early-response`, item: { type: "function_call", call_id: `${name}-queued-old-tool`, name: "forget_shared_experience", arguments: JSON.stringify({ id: episodeId }) } });
  assert.equal(messages.some((event) => event.item?.call_id === `${name}-queued-old-tool`), false, `${name}: early tool waits for its matching transcript`);
  if (name === "webrtc") {
    const assistantTextBeforeBargeIn = runtime.behaviorEngine.getState().moment.assistantText;
    await transport.handleEvent({ type: "response.output_audio_transcript.delta", response_id: `${name}-early-response`, delta: "Discarded response prefix. " });
    await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
    assert.equal(transport.playbackActive, false, `${name}: barge-in retires the interrupted playback owner immediately`);
    assert.equal(transport.playbackTerminal, "interrupted", `${name}: interrupted output is terminal locally without waiting on server playback events`);
    assert.equal(transport.generationActive, false, `${name}: invalidated generation is no longer left busy`);
    assert.equal(transport.pendingAssistantCompletion, null, `${name}: interrupted response cannot retain a completion awaiting playback`);
    assert.equal(transport.remotePlaybackMuted, true, `${name}: remote track stays muted until fresh output starts`);
    await transport.handleEvent({ type: "output_audio_buffer.stopped", response_id: `${name}-early-response` });
    await transport.handleEvent({ type: "output_audio_buffer.cleared", response_id: `${name}-early-response` });
    assert.equal(transport.playbackActive, false, `${name}: old stopped/cleared events cannot restore stale playback ownership`);
    assert.equal(runtime.behaviorEngine.getState().moment.assistantText, assistantTextBeforeBargeIn, `${name}: unheard interrupted audio does not publish assistant-end text`);
    await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  }
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "No, I meant the other one.", item_id: `${name}-correction` });
  await flush();

  const engine = runtime.behaviorEngine;
  assert.equal(engine.getState().repairRequired, true, `${name}: local engine recognizes the reference correction`);
  const correctionUpdateIndex = messages.findIndex((event) => event.type === "session.update" && event.session.instructions?.includes("referenceRepair"));
  const cancelIndex = messages.findIndex((event) => event.type === "response.cancel");
  const createIndex = messages.findIndex((event) => event.type === "response.create");
  assert.ok(correctionUpdateIndex >= 0, `${name}: latest repair context reached Realtime`);
  assert.ok(cancelIndex > correctionUpdateIndex, `${name}: stale auto-response canceled after updated context`);
  assert.ok(createIndex > cancelIndex, `${name}: exactly one replacement response follows the cancellation`);
  assert.equal(messages.slice(0, createIndex + 1).filter((event) => event.type === "response.create").length, 1, `${name}: one fresh response is created`);
  assert.equal(messages.slice(0, createIndex + 1).filter((event) => event.type === "response.cancel").length, 1, `${name}: the early response is canceled exactly once even while playback was active`);
  assert.equal(messages[correctionUpdateIndex].session.audio.input.turn_detection.create_response, false, `${name}: correction response uses manual turn commit`);
  assert.match(messages[correctionUpdateIndex].session.instructions, /referenceRepair/i, `${name}: the actual Realtime instructions contain the corrected reference context`);

  // A canceled auto response can report response.created only after the
  // correction transcript. It must not inherit the correction's authorization.
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-late-old-response` } });
  assert.equal(transport.responseCompanionContexts.get(`${name}-late-old-response`), null, `${name}: an unrequested late response.created stays unauthorized during correction recovery`);
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-late-old-response`, item: { type: "function_call", call_id: `${name}-late-old-tool`, name: "forget_shared_experience", arguments: JSON.stringify({ id: episodeId }) } });
  await flush();
  const lateToolOutput = messages.find((event) => event.type === "conversation.item.create" && event.item?.type === "function_call_output" && event.item.call_id === `${name}-late-old-tool`);
  assert.ok(lateToolOutput, `${name}: late old tool gets a rejected result rather than being discarded`);
  assert.equal(JSON.parse(lateToolOutput.item.output).status, "stale-turn", `${name}: late old response cannot act on the correction turn`);
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-late-old-response`, item: { type: "function_call", call_id: `${name}-late-old-language-tool`, name: "set_language_preferences", arguments: JSON.stringify({ response_language: "de" }) } });
  await flush();
  const lateLanguageOutput = messages.find((event) => event.type === "conversation.item.create" && event.item?.type === "function_call_output" && event.item.call_id === `${name}-late-old-language-tool`);
  assert.equal(JSON.parse(lateLanguageOutput.item.output).status, "stale-turn", `${name}: a non-companion stale tool is rejected too`);
  assert.equal(preferences.language, "en", `${name}: stale set_language_preferences cannot mutate settings`);

  const turnBeforeStaleEvent = runtime.behaviorEngine.getState().turnId;
  events.publishBehaviorEvent({ type: "user-turn", text: "stale other-session text", sessionId: `${sessionId}-old` });
  assert.equal(runtime.behaviorEngine.getState().turnId, turnBeforeStaleEvent, `${name}: stale session event cannot alter the repair state`);
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-early-response`, item: { type: "function_call", call_id: `${name}-stale-tool`, name: "forget_shared_experience", arguments: JSON.stringify({ id: "ep_not-a-real-episode" }) } });
  await flush();
  const staleToolOutput = messages.find((event) => event.type === "conversation.item.create" && event.item?.type === "function_call_output" && event.item.call_id === `${name}-stale-tool`);
  assert.ok(staleToolOutput, `${name}: canceled response still receives a bounded stale-tool result`);
  assert.equal(JSON.parse(staleToolOutput.item.output).status, "stale-turn", `${name}: old response cannot apply an action after correction`);
  const queuedToolOutput = messages.find((event) => event.type === "conversation.item.create" && event.item?.type === "function_call_output" && event.item.call_id === `${name}-queued-old-tool`);
  assert.ok(queuedToolOutput, `${name}: queued early tool is explicitly released as stale, not replayed onto the correction turn`);
  assert.equal(JSON.parse(queuedToolOutput.item.output).status, "stale-turn");
  assert.ok(runtime.behaviorEngine.getState().companion.episodes.some((item) => item.id === episodeId), `${name}: neither early nor late tool can forget the episode`);

  const beforeDuplicate = messages.length;
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "No, I meant the other one.", item_id: `${name}-correction` });
  assert.equal(messages.length, beforeDuplicate, `${name}: duplicate transcript cannot create another response`);

  // The following ordinary turn transitions back to auto VAD and still gets one response.
  const replacementRequest = messages.find((event) => event.type === "response.create" && event.response?.metadata?.looi_companion_request);
  const replacementMetadata = replacementRequest?.response?.metadata;
  assert.ok(replacementMetadata?.looi_companion_request, `${name}: replacement request carries a response-correlation nonce`);
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-repair-response`, metadata: replacementMetadata } });
  assert.equal(transport.responseCompanionContexts.get(`${name}-repair-response`)?.itemId, `${name}-correction`, `${name}: replacement response remains bound to the accepted correction turn`);
  if (name === "pcm") {
    const beforeLateAudio = pcmEnqueueCount;
    const beforeLateFinish = pcmFinishCount;
    await transport.handleEvent({ type: "response.output_audio.delta", response_id: `${name}-early-response`, item_id: `${name}-stale-item`, delta: "AAAA" });
    await transport.handleEvent({ type: "response.output_audio_transcript.delta", response_id: `${name}-early-response`, delta: "stale canceled text" });
    await transport.handleEvent({ type: "response.output_audio.done", response_id: `${name}-early-response` });
    await transport.handleEvent({ type: "response.done", response: { id: `${name}-early-response`, status: "completed", output: [] } });
    assert.equal(pcmEnqueueCount, beforeLateAudio, `${name}: canceled audio cannot enter the replacement PCM playback queue`);
    assert.equal(pcmFinishCount, beforeLateFinish, `${name}: canceled output-audio.done cannot finish replacement playback`);
    assert.equal(transport.activeResponseId, `${name}-repair-response`, `${name}: canceled response.done cannot clear replacement response ownership`);
    assert.equal(transport.assistantTranscript.includes("stale canceled text"), false, `${name}: canceled transcript cannot contaminate replacement output`);
  } else {
    await transport.handleEvent({ type: "output_audio_buffer.started", response_id: `${name}-repair-response` });
    assert.equal(transport.playbackActive, true, `${name}: replacement audio playback has started`);
    await transport.handleEvent({ type: "response.output_audio_transcript.delta", response_id: `${name}-repair-response`, delta: "Fresh corrected reply." });
    assert.equal(conversationStore.getState().streamingText, "Fresh corrected reply.", `${name}: replacement transcript starts fresh without the interrupted prefix`);
    await transport.handleEvent({ type: "response.output_audio_transcript.delta", response_id: `${name}-early-response`, delta: "stale canceled text" });
    await transport.handleEvent({ type: "response.done", response: { id: `${name}-early-response`, status: "completed", output: [] } });
    await transport.handleEvent({ type: "output_audio_buffer.stopped", response_id: `${name}-early-response` });
    await transport.handleEvent({ type: "output_audio_buffer.cleared", response_id: `${name}-early-response` });
    assert.equal(transport.activeResponseId, `${name}-repair-response`, `${name}: canceled response.done cannot clear replacement response ownership`);
    assert.equal(transport.playbackActive, true, `${name}: canceled buffer-stopped cannot end replacement playback`);
    assert.equal(transport.assistantTranscript.includes("stale canceled text"), false, `${name}: canceled transcript cannot contaminate replacement output`);
  }
  await transport.handleEvent({ type: "response.done", response: { id: `${name}-repair-response`, status: "completed", output: [] } });
  forceVisualCommand = true;
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "LOOI look at this", item_id: `${name}-visual-after-correction` });
  forceVisualCommand = false;
  await flush();
  if (name === "pcm") {
    assert.ok(messages.some((event) => event.type === "response.create" && event.response?.instructions?.includes("camera snapshot failed")), `${name}: failed explicit visual recovery sends its safe untagged response`);
  }
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-visual-recovery-response` } });
  assert.equal(transport.responseCompanionContexts.get(`${name}-visual-recovery-response`), null, `${name}: explicit visual recovery is accepted without inheriting the corrected turn's tool authorization`);
  const beforeVisualSearch = messages.length;
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-visual-recovery-response`, item: { type: "function_call", call_id: `${name}-visual-search`, name: "search_memory", arguments: JSON.stringify({ query: "kite" }) } });
  await flush();
  const visualSearchOutputIndex = messages.findIndex((event) => event.item?.call_id === `${name}-visual-search` && event.item?.type === "function_call_output");
  assert.ok(visualSearchOutputIndex >= beforeVisualSearch, `${name}: accepted visual response can use ordinary memory search`);
  assert.equal(JSON.parse(messages[visualSearchOutputIndex].item.output).ok, true, `${name}: null visual companion context does not disable ordinary read tools`);
  assert.equal(messages.slice(visualSearchOutputIndex + 1).filter((event) => event.type === "response.create").length, 1, `${name}: successful visual search schedules one follow-up response`);
  await transport.handleEvent({ type: "response.done", response: { id: `${name}-visual-recovery-response`, status: "completed", output: [] } });

  const beforeNext = messages.length;
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-next-auto-response` } });
  assert.equal(transport.responseCompanionContexts.get(`${name}-next-auto-response`), null, `${name}: auto-VAD response is held for its not-yet-committed transcript`);
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about the blue one.", item_id: `${name}-ordinary-next` });
  await flush();
  assert.equal(transport.responseCompanionContexts.get(`${name}-next-auto-response`)?.itemId, `${name}-ordinary-next`, `${name}: response created before ordinary transcript binds only after that transcript`);
  const nextMessages = messages.slice(beforeNext);
  assert.equal(nextMessages.filter((event) => event.type === "response.create").length, 1, `${name}: next ordinary turn receives exactly one response`);
  assert.ok(nextMessages.some((event) => event.type === "session.update" && event.session.audio.input.turn_detection.create_response === true), `${name}: ordinary VAD is restored on the next turn`);

  const beforeMemory = rememberedNotes.length;
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-next-auto-response`, item: { type: "function_call", call_id: `${name}-remember-after-done`, name: "remember", arguments: JSON.stringify({ note: `The user likes tea ${name}.` }) } });
  await transport.handleEvent({ type: "response.done", response: { id: `${name}-next-auto-response`, status: "completed", output: [{ type: "function_call" }] } });
  await flush();
  assert.equal(typeof pendingRememberCommit, "function", `${name}: the valid remember write is deferred at the database boundary`);
  pendingRememberCommit();
  pendingRememberCommit = null;
  await flush();
  assert.equal(rememberedNotes.length, beforeMemory + 1, `${name}: completed response can finish a legitimate asynchronous memory write`);
  assert.ok(messages.some((event) => event.item?.call_id === `${name}-remember-after-done` && JSON.parse(event.item.output).ok), `${name}: valid async remember receives success`);

  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-search-response` } });
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Search my notes for tea", item_id: `${name}-search-turn` });
  await flush();
  deferMemorySearch = true;
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-search-response`, item: { type: "function_call", call_id: `${name}-search-canceled`, name: "search_memory", arguments: JSON.stringify({ query: "tea" }) } });
  await flush();
  assert.equal(typeof pendingMemorySearch, "function", `${name}: async memory read is in flight`);
  const beforeCanceledSearchOutput = messages.length;
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  pendingMemorySearch();
  pendingMemorySearch = null;
  deferMemorySearch = false;
  await flush();
  const canceledSearchOutputIndex = messages.findIndex((event) => event.item?.call_id === `${name}-search-canceled` && event.item?.type === "function_call_output");
  assert.ok(canceledSearchOutputIndex >= beforeCanceledSearchOutput, `${name}: expired search returns an explicit result`);
  assert.equal(JSON.parse(messages[canceledSearchOutputIndex].item.output).status, "stale-turn", `${name}: search that finishes after new speech is rejected as stale`);
  assert.equal(messages.slice(canceledSearchOutputIndex + 1).some((event) => event.type === "response.create"), false, `${name}: stale search cannot schedule a follow-up response`);

  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-cancel-memory-response` } });
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: `Remember that I prefer tea ${name}.`, item_id: `${name}-cancel-memory-turn` });
  await transport.handleEvent({ type: "response.output_item.done", response_id: `${name}-cancel-memory-response`, item: { type: "function_call", call_id: `${name}-remember-canceled`, name: "remember", arguments: JSON.stringify({ note: `I prefer tea ${name}.` }) } });
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await flush();
  assert.equal(typeof pendingRememberCommit, "function", `${name}: interrupted write reached the guarded database boundary`);
  const memoryCountAtCancel = rememberedNotes.length;
  pendingRememberCommit();
  pendingRememberCommit = null;
  await flush();
  assert.equal(rememberedNotes.length, memoryCountAtCancel, `${name}: interruption revokes the deferred memory insert`);
  assert.ok(messages.some((event) => event.item?.call_id === `${name}-remember-canceled` && JSON.parse(event.item.output).status === "stale-turn"), `${name}: canceled remember reports stale instead of claiming it saved`);
  const canceledOutputIndex = messages.findIndex((event) => event.item?.call_id === `${name}-remember-canceled` && event.item?.type === "function_call_output");
  assert.equal(messages.slice(canceledOutputIndex + 1).some((event) => event.type === "response.create"), false, `${name}: canceled remember does not start a follow-up response`);

  // A manual game response can include the same token in quoted task data;
  // only the structured top-level repair flag may activate correction fencing.
  events.publishBehaviorEvent({ type: "game-command", action: "start", sessionId });
  events.publishBehaviorEvent({ type: "intention", action: "pause", goal: "The user quoted referenceRepair as text", sessionId });
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  const beforeQuotedManual = messages.length;
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Let's play a number", item_id: `${name}-quoted-reference-turn` });
  await flush();
  const quotedManualMessages = messages.slice(beforeQuotedManual);
  assert.equal(events.requiresBehaviorTurnCommit(sessionId), true, `${name}: active game still uses the manual-response path`);
  const quotedManualCreate = quotedManualMessages.find((event) => event.type === "response.create");
  assert.ok(quotedManualCreate, `${name}: manual game turn still receives a response`);
  assert.equal(quotedManualCreate.response?.metadata?.looi_companion_request, undefined, `${name}: quoted text cannot opt an ordinary manual response into correction correlation`);
  assert.equal(transport.correctionResponseFence, null, `${name}: unrelated manual turn does not install the correction fence`);
  await transport.handleEvent({ type: "response.created", response: { id: `${name}-quoted-manual-response` } });
  assert.ok(transport.responseCompanionContexts.get(`${name}-quoted-manual-response`), `${name}: normal manual response keeps its valid turn context`);
  await transport.handleEvent({ type: "response.done", response: { id: `${name}-quoted-manual-response`, status: "completed", output: [] } });
  events.publishBehaviorEvent({ type: "game-command", action: "stop", sessionId });
  events.publishBehaviorEvent({ type: "intention", action: "drop", sessionId });

  events.endBehaviorSession(sessionId);
  transport.active = false;
}

await assertCorrectionRecovery(new RealtimePcmConversationService(), "pcm");
await assertCorrectionRecovery(new RealtimeConversationService(), "webrtc");

async function assertGamePauseThroughTransport(transport, name) {
  const messages = [];
  const sessionId = `game-pause-${name}`;
  runtime.behaviorEngine.resetLearning();
  conversationStore.getState().setUserSpeaking(false);
  transport.active = true;
  transport.sessionId = sessionId;
  if (name === "pcm") transport.webSocket = { readyState: 1, send(raw) { messages.push(JSON.parse(raw)); }, close() {} };
  else transport.dataChannel = { readyState: "open", send(raw) { messages.push(JSON.parse(raw)); } };
  events.beginBehaviorSession(sessionId, () => transport.applySessionPreferences("game-pause-state"));
  try {
    events.publishBehaviorEvent({ type: "game-command", action: "start", sessionId });
    const original = { ...runtime.behaviorEngine.getState().game };
    const turn = async (text, id) => {
      const before = messages.length;
      await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
      await transport.handleEvent({ type: "input_audio_buffer.speech_stopped" });
      await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: text, item_id: `${sessionId}-${id}` });
      await flush();
      const updates = messages.slice(before);
      assert.equal(updates.filter((event) => event.type === "response.create").length, 1,
        `${name}: ${id} creates one response after the local game turn is committed`);
      assert.equal(events.requiresBehaviorTurnCommit(sessionId), true, `${name}: both active and paused game turns remain manual`);
      const latestUpdate = updates.filter((event) => event.type === "session.update").at(-1);
      if (latestUpdate) assert.equal(latestUpdate.session.audio.input.turn_detection.create_response, false);
      const responseId = `${sessionId}-${id}-response`;
      await transport.handleEvent({ type: "response.created", response: { id: responseId } });
      await transport.handleEvent({ type: "response.done", response: { id: responseId, status: "completed", output: [] } });
      return updates;
    };
    await turn("Warte kurz.", "pause");
    assert.equal(runtime.behaviorEngine.getState().game.status, "paused");
    assert.equal(runtime.behaviorEngine.getState().pendingIntention, null, `${name}: pausing a game creates no phantom task`);
    const context = JSON.parse(events.getBehaviorConversationContext(sessionId));
    assert.equal(context.numberGame.status, "paused");
    assert.equal(Object.hasOwn(context.numberGame, "secretAnswer"), false);
    await turn("2", "number-while-paused");
    assert.equal(runtime.behaviorEngine.getState().game.status, "paused");
    assert.equal(runtime.behaviorEngine.getState().game.attemptsLeft, original.attemptsLeft);
    await turn("Ich bin wieder da.", "resume");
    const resumed = runtime.behaviorEngine.getState().game;
    assert.equal(resumed.status, "active", `${name}: the transport's local-manual-turn interruption does not re-pause a resumed game`);
    for (const field of ["secretAnswer", "attemptsLeft", "round", "lastOutcome"]) assert.equal(resumed[field], original[field]);
  } finally {
    events.endBehaviorSession(sessionId);
    transport.active = false;
  }
}

await assertGamePauseThroughTransport(new RealtimePcmConversationService(), "pcm");
await assertGamePauseThroughTransport(new RealtimeConversationService(), "webrtc");

for (const scenario of [
  { bridge: "robot-app", tool: "start_robot_app", text: "Please start the robot app hf/example.", args: { space_id: "hf/example" } },
  { bridge: "hermes", tool: "start_hermes_task", text: "Please ask Hermes to research robot companions.", args: { request: "Please ask Hermes to research robot companions." } },
]) {
  const fixture = createCompanionLiveRuntime();
  const transport = new fixture.RealtimePcmConversationService();
  const sessionId = `disabled-bridge-${scenario.bridge}`;
  const sent = [];
  transport.active = true;
  transport.sessionId = sessionId;
  transport.webSocket = { readyState: 1, send(raw) { sent.push(JSON.parse(raw)); }, close() {} };
  fixture.events.beginBehaviorSession(sessionId, () => {});
  await transport.handleEvent({ type: "input_audio_buffer.speech_started" });
  await transport.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: scenario.text, item_id: `${sessionId}-turn` });
  const responseId = `${sessionId}-response`;
  await transport.handleEvent({ type: "response.created", response: { id: responseId } });
  await transport.handleEvent({
    type: "response.output_item.done", response_id: responseId,
    item: { type: "function_call", call_id: `${sessionId}-call`, name: scenario.tool, arguments: JSON.stringify(scenario.args) },
  });
  await flush();
  const output = sent.find((event) => event.item?.call_id === `${sessionId}-call` && event.item?.type === "function_call_output");
  assert.ok(output, `${scenario.tool}: actual PCM router returns a tool result`);
  assert.deepEqual(JSON.parse(output.item.output), { ok: false, status: "disabled-in-text-evaluation" }, `${scenario.tool}: text harness never claims an external task started`);
  assert.deepEqual(fixture.externalBridgeCalls, [{ bridge: scenario.bridge, name: scenario.tool, args: scenario.args }], `${scenario.tool}: only the disabled external bridge fixture receives the call`);
  fixture.events.endBehaviorSession(sessionId);
  transport.active = false;
  fixture.uninstallRuntime();
}

uninstallRuntime();
console.log("Realtime reference repair, game pause, and PCM external-bridge boundary: response ordering, turn isolation, disabled app/Hermes starts, manual pause/resume through PCM and WebRTC PASS");
