import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const SAMPLE_RATE = 16_000;
const CHUNK = new Array(6_400).fill(0.02);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function flushMicrotasks() {
  for (let count = 0; count < 8; count += 1) await Promise.resolve();
}

export function createHarness(options = {}) {
  const h = {
    appState: { currentState: "active" },
    focused: true,
    permissionCalls: 0,
    captureStartCalls: 0,
    captureStopCalls: 0,
    captureRunning: false,
    pcmFlowing: false,
    wakewordStartCalls: 0,
    wakewordStopCalls: 0,
    speechStopCalls: 0,
    motionStops: [],
    speechCalls: [],
    modelCalls: [],
    personalityTurns: [],
    interestReads: [],
    personalitySpeech: [],
    personalityContext: JSON.stringify({ tone: "calm", familiarInterests: [] }),
    sttCalls: [],
    vadCalls: [],
    vadSequence: [],
    vadHandler: null,
    sampleListeners: new Set(),
    timeline: [],
    memoryRetrievalCalls: [],
    localMemoryRememberCalls: [],
    localMemoryCommits: [],
    memoryReadinessDeferred: null,
    motorCalls: [],
    robotAppSkillCalls: [],
    diagnosticEvents: [],
    interactionMarks: [],
    voiceStates: [],
    localMemoryMutation: false,
    nextTranscript: "",
    captureStartDeferred: null,
    preferences: {
      conversationMode: "budget",
      language: "de",
      listeningLanguage: "de",
      robotName: "Louis",
      robotSleeping: false,
      ttsEnabled: options.ttsEnabled ?? false,
      ttsVoiceId: "shimmer",
      ttsStyleId: "cute-robot",
      ttsSpeed: 1.07,
    },
    conversation: null,
    sttHandler: null,
    modelHandler: null,
    speechHandler: null,
    physicalByTranscript: new Map(),
  };

  h.conversation = {
    activeSessionId: null,
    messages: [],
    isProcessing: false,
    isListening: false,
    isUserSpeaking: false,
    isSpeaking: false,
    realtimeReadiness: "idle",
    realtimeIssue: null,
    currentTranscript: "",
    streamingText: "",
    heardSpeechText: null,
    overlayVisible: false,
    setActiveSession(sessionId, messages = undefined) {
      this.activeSessionId = sessionId;
      if (messages) this.messages = messages.slice();
    },
    addMessage(message) {
      const saved = { ...message };
      this.messages.push(saved);
      return saved;
    },
    setProcessing(value) { this.isProcessing = value; },
    setListening(value) { this.isListening = value; },
    setUserSpeaking(value) { this.isUserSpeaking = value; },
    requestInputAttention() { return null; },
    setSpeaking(value) { this.isSpeaking = value; },
    setRealtimeReadiness(value) { this.realtimeReadiness = value; },
    setRealtimeIssue(value) { this.realtimeIssue = value; },
    setCurrentTranscript(value) { this.currentTranscript = value; },
    setStreamingText(value) { this.streamingText = value; },
    setHeardSpeechText(value) { this.heardSpeechText = value; },
    setOverlayVisible(value) { this.overlayVisible = value; },
  };

  const feeder = {
    get isRunning() { return h.captureRunning; },
    get diagnosticStatus() { return { pcmFlowing: h.pcmFlowing }; },
    setWakewordFeedingEnabled(enabled) { h.wakewordFeedingEnabled = enabled; },
    subscribeSamples(listener) {
      h.sampleListeners.add(listener);
      return () => h.sampleListeners.delete(listener);
    },
    async start() {
      h.captureStartCalls += 1;
      h.timeline.push("capture-start");
      if (h.captureStartDeferred) await h.captureStartDeferred.promise;
      h.captureRunning = true;
      h.pcmFlowing = false;
    },
    async stop() {
      h.captureStopCalls += 1;
      h.timeline.push("capture-stop");
      h.captureRunning = false;
      h.pcmFlowing = false;
    },
    emit(samples = CHUNK, rate = SAMPLE_RATE) {
      if (h.captureRunning && samples.length > 0 && rate === SAMPLE_RATE) h.pcmFlowing = true;
      for (const listener of [...h.sampleListeners]) listener(samples, rate);
    },
  };

  h.sttHandler = async () => h.nextTranscript;
  h.modelHandler = async () => ({ text: "Hallo, ich bin Louis!", model: "gpt-6-luna", usage: {} });
  h.speechHandler = async () => {};
  h.vadHandler = async () => ({ isSpeechDetected: h.vadSequence.shift() ?? false });

  const dependencies = {
    "../behavior/behavior-events": {
      acceptCompanionPersonalityTurn: (text, sessionId) => h.personalityTurns.push({ text, sessionId }),
      getCompanionPersonalityContext: () => h.personalityContext,
      noteCompanionPersonalitySpeech: (text, sessionId) => h.personalitySpeech.push({ text, sessionId }),
      readCompanionInterests: (text) => { h.interestReads.push(text); return { ok: true, status: "interest-overview", interests: [], total: 0, hasMore: false }; },
    },
    "react-native": { AppState: h.appState },
    "expo-audio": {
      async requestRecordingPermissionsAsync() {
        h.permissionCalls += 1;
        return { granted: true };
      },
    },
    "../character/character-action-runtime": {
      cancelCharacterAction: (reason) => h.timeline.push(["prop-cancel", reason]),
      requestCharacterActionFromVoice: (text, sessionId) => h.timeline.push(["prop-request", text, sessionId]),
      completeCharacterActionReply: (sessionId) => h.timeline.push(["prop-reply", sessionId]),
    },
    "../core/main-screen-presence": { isMainScreenFocused: () => h.focused },
    "../core/robot-inactivity": { markRobotInteraction: (reason) => h.interactionMarks.push(reason) },
    "../core/observation": { createObservation: () => ({ metadata: {} }) },
    "../diagnostics/diagnostic-log": {
      recordDiagnosticEvent: (...event) => h.diagnosticEvents.push(event),
    },
    "../device-tools/looi-robot": {
      async stopLooiMotion(reason) { h.motionStops.push(reason); },
    },
    "../language/response-messages": {
      getVoiceResponseMessage: (language, key) => `${language}:${key}`,
    },
    "../language/listening-language": { normalizeListeningLanguage: (value) => value },
    "../language/response-language": { normalizeResponseLanguage: (value) => value },
    "../memory/memory-service": {
      isLocalMemoryMutationInProgress: () => h.localMemoryMutation,
      memoryService: {
        async search(query) { return { query }; },
        async remember() { return { ok: true }; },
      },
      mirrorSessionMessage() {},
      mirrorSessionTouch() {},
      async retrieveConversationMemories(query) {
        h.memoryRetrievalCalls.push(query);
        return { facts: [] };
      },
    },
    "../memory/local-memory-database": {
      localMemoryDatabase: {
        async remember(messages, metadata, isCurrent = () => true) {
          h.localMemoryRememberCalls.push({ messages, metadata, isCurrent });
          if (h.memoryReadinessDeferred) await h.memoryReadinessDeferred.promise;
          if (!isCurrent()) return { committed: false };
          h.localMemoryCommits.push({ messages, metadata });
          return { committed: true };
        },
      },
    },
    "../openai/budget-conversation": {
      async generateBudgetReply(request) {
        h.modelCalls.push(request);
        return h.modelHandler(request, h.modelCalls.length);
      },
    },
    "../robot-bridge/app-skill-runtime": {
      async searchRobotAppSkills(query, limit) {
        h.robotAppSkillCalls.push({ method: "search", query, limit });
        return { status: "listed", items: [{ spaceId: "pollen/dance-demo", title: "Dance demo" }] };
      },
      async describeRobotAppSkill(spaceId) {
        h.robotAppSkillCalls.push({ method: "describe", spaceId });
        return { status: "described", spaceId };
      },
      async startRobotAppSkill(spaceId) {
        h.robotAppSkillCalls.push({ method: "start", spaceId });
        return { status: "running", spaceId };
      },
      async stopRobotAppSkills() {
        h.robotAppSkillCalls.push({ method: "stop" });
        return { status: "stopped" };
      },
    },
    "../openai/openai-speech": {
      async speakOpenAiText(text, voiceOptions) {
        h.timeline.push("cloud-speech");
        h.speechCalls.push({ text, ...voiceOptions });
        if (!options.manualSpeechStart) voiceOptions.onStart?.();
        return h.speechHandler(text, voiceOptions, h.speechCalls.length);
      },
      async stopOpenAiSpeech() { h.speechStopCalls += 1; },
    },
    "../store/conversation": { useConversationStore: { getState: () => h.conversation } },
    "../store/user": {
      useUserStore: {
        getState: () => ({
          preferences: h.preferences,
          robotSleeping: h.preferences.robotSleeping,
          setVoiceState: (state) => h.voiceStates.push(state),
          updatePreferences: (update) => { h.preferences = { ...h.preferences, ...update }; },
        }),
      },
    },
    "./kws-audio-feeder": { kwsAudioFeeder: feeder },
    "./realtime-physical-command": {
      parseRealtimePhysicalCommand: (transcript) => h.physicalByTranscript.get(transcript) ?? null,
      async executeRealtimePhysicalCommand(parsed, transcript) {
        h.motorCalls.push({ parsed, transcript });
        const commandKind = parsed.kind === "emergency-stop" ? "emergency-stop" : parsed.command.kind;
        return { acknowledgement: `local:${commandKind}`, commandKind, handled: true, ok: true };
      },
    },
    "./stt": {
      sttService: {
        async transcribeCommandSamples(samples, sampleRate, signal) {
          h.sttCalls.push({ sampleCount: samples.length, sampleRate, signal });
          return h.sttHandler(samples, sampleRate, signal, h.sttCalls.length);
        },
      },
    },
    "./vad-service": {
      vadService: {
        async start() {},
        async stop() {},
        async reset() {},
        async acceptSamples(samples, sampleRate) {
          h.vadCalls.push({ sampleCount: samples.length, sampleRate });
          return h.vadHandler(samples, sampleRate, h.vadCalls.length);
        },
      },
    },
    "./wakeword": {
      wakewordService: {
        async stop() { h.wakewordStopCalls += 1; },
        async start() { h.wakewordStartCalls += 1; },
      },
    },
  };
  const load = createTypeScriptTreeLoader(dependencies, options.globals);
  h.dependencies = dependencies;
  const { BudgetConversationService } = load("src/voice/budget-conversation.ts");
  h.service = new BudgetConversationService();
  h.feeder = feeder;
  h.emitTurn = async (transcript) => {
    const sttStart = h.sttCalls.length;
    h.nextTranscript = transcript;
    h.vadSequence = [true, false, false];
    for (const speech of [true, false, false]) {
      const previousVadCalls = h.vadCalls.length;
      feeder.emit(CHUNK, SAMPLE_RATE);
      await waitFor(() => h.vadCalls.length > previousVadCalls, `VAD chunk (${speech ? "speech" : "silence"})`);
    }
    await waitFor(() => h.sttCalls.length > sttStart, "local STT call");
    return h.sttCalls.at(-1);
  };
  return h;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("unexpected direct network request from the conversation runtime");
};

try {
  // The service refuses to acquire capture outside an active, focused budget
  // session. The shared feeder is the only capture interface used afterward.
  const gate = createHarness();
  gate.appState.currentState = "background";
  await gate.service.start();
  assert.equal(gate.service.isActive, false);
  gate.appState.currentState = "active";
  gate.focused = false;
  await gate.service.start();
  assert.equal(gate.service.isActive, false);
  gate.focused = true;
  gate.preferences.conversationMode = "realtime_pcm";
  await gate.service.start();
  assert.equal(gate.service.isActive, false);
  gate.preferences.conversationMode = "budget";
  gate.preferences.robotSleeping = true;
  await gate.service.start();
  assert.equal(gate.service.isActive, false);
  gate.preferences.robotSleeping = false;
  await gate.service.start();
  assert.equal(gate.service.isActive, true);
  assert.equal(gate.permissionCalls, 1);
  assert.equal(gate.captureStartCalls, 1, "one shared feeder owns microphone capture");
  assert.equal(gate.conversation.isListening, true);
  await gate.service.stop("background");
  assert.equal(gate.captureStartCalls, 1, "a background stop must not restart capture");
  assert.equal(gate.wakewordStartCalls, 0);

  // A detected voice turn closes capture before it calls cloud speech, sends
  // the just-transcribed utterance as the latest text history item, and keeps
  // the user's configured voice, character style, and speed.
  const happy = createHarness({ ttsEnabled: true });
  const pendingSpeech = deferred();
  happy.modelHandler = async () => ({ text: "Hallo, ich bin Louis!", model: "gpt-6-luna", usage: {} });
  happy.speechHandler = async () => pendingSpeech.promise;
  await happy.service.start();
  await happy.emitTurn("Hallo Louis, erzähl mir etwas Nettes.");
  await waitFor(() => happy.speechCalls.length === 1, "cloud speech playback");
  assert.equal(happy.speechCalls[0].streaming, true, "Budget enables streamed output after releasing capture");
  assert.equal(happy.modelCalls.length, 1);
  assert.equal(happy.modelCalls[0].history.at(-1).role, "user");
  assert.equal(happy.modelCalls[0].history.at(-1).content, "Hallo Louis, erzähl mir etwas Nettes.");
  assert.equal(happy.modelCalls[0].personalityContext, happy.personalityContext, "the runtime forwards the same stored character to the Budget request");
  assert.equal(happy.speechCalls[0].personalityContext, happy.personalityContext, "the same character tone reaches cloud speech rendering");
  assert.deepEqual(happy.personalityTurns, [{ text: "Hallo Louis, erzähl mir etwas Nettes.", sessionId: happy.conversation.activeSessionId }], "only the committed current user transcript reaches character learning");
  assert.equal(happy.captureRunning, false, "capture stays stopped during speech output");
  assert.ok(happy.timeline.indexOf("capture-stop") < happy.timeline.indexOf("cloud-speech"));
  assert.deepEqual(
    { voiceId: happy.speechCalls[0].voiceId, styleId: happy.speechCalls[0].styleId, speed: happy.speechCalls[0].speed },
    { voiceId: "shimmer", styleId: "cute-robot", speed: 1.07 },
  );
  assert.equal(happy.conversation.isSpeaking, true, "speech start updates the conversation state");
  assert.ok(happy.timeline.some(event => event[0] === "prop-request"), "Budget forwards the committed user request");
  assert.ok(!happy.timeline.some(event => event[0] === "prop-reply"), "visual actions wait while speech is pending");
  assert.equal(happy.conversation.heardSpeechText, "Hallo, ich bin Louis!", "the exact sentence clip is exposed only after its player reports playback start");
  assert.equal(happy.personalitySpeech.some((item) => typeof item.text === "string"), false, "pending playback cannot anchor character learning");
  assert.equal(networkCalls, 0, "the runtime makes no Realtime or direct network request");
  pendingSpeech.resolve();
  await waitFor(() => happy.captureStartCalls === 2, "new local capture after speech");
  assert.ok(happy.personalitySpeech.some((item) => item.text === "Hallo, ich bin Louis!"), "only completed audible output becomes a conversation reference");
  assert.equal(happy.timeline.filter(event => event[0] === "prop-reply").length, 1, "Budget releases the matching visual request once after playback");
  assert.equal(happy.conversation.heardSpeechText, null, "completed playback retires the phrase before listening resumes");
  happy.appState.currentState = "background";
  await happy.service.stop("background");
  assert.equal(happy.captureStartCalls, 2, "stop in background does not start capture again");

  const segmented = createHarness({ ttsEnabled: true });
  const spokenClips = [];
  segmented.modelHandler = async () => ({ text: "Erster Satz. Zweiter Satz? Dritter Satz! Vierter Satz.", model: "gpt-6-luna", usage: {} });
  segmented.speechHandler = async (text) => spokenClips.push({ text, heardSpeechText: segmented.conversation.heardSpeechText });
  await segmented.service.start();
  await segmented.emitTurn("Bitte erzähl etwas.");
  await waitFor(() => segmented.captureStartCalls === 2, "listening after segmented cloud speech");
  assert.deepEqual(spokenClips, [
    { text: "Erster Satz.", heardSpeechText: "Erster Satz." },
    { text: "Zweiter Satz?", heardSpeechText: "Zweiter Satz?" },
    { text: "Dritter Satz! Vierter Satz.", heardSpeechText: null },
  ], "bounded sentence clips show only their own actual playing text, with at most two expression updates");
  assert.equal(segmented.conversation.heardSpeechText, null, "the final clip cannot leave a phrase that was never heard as an expression cue");
  segmented.appState.currentState = "background";
  await segmented.service.stop("background");

  // Empty local recognition gets the short local not-heard response and never
  // consults memory or the text model.
  const unheard = createHarness();
  unheard.sttHandler = async () => "   ";
  await unheard.service.start();
  await unheard.emitTurn("unrecognized filler");
  await waitFor(() => unheard.captureStartCalls === 2, "listening to resume after empty STT");
  assert.equal(unheard.modelCalls.length, 0);
  assert.equal(unheard.memoryRetrievalCalls.length, 0);
  assert.equal(unheard.conversation.messages.some((message) => message.role === "user"), false);
  unheard.appState.currentState = "background";
  await unheard.service.stop("background");

  // Manual finish waits for the final local VAD result, so a last speech chunk
  // remains in the transcript sent to STT instead of being dropped.
  const pendingFinalVad = createHarness();
  const finalVadResult = deferred();
  pendingFinalVad.nextTranscript = "letzter Satz";
  pendingFinalVad.vadHandler = async (_samples, _rate, callNumber) => {
    if (callNumber === 1) return { isSpeechDetected: true };
    if (callNumber === 2) return finalVadResult.promise;
    return { isSpeechDetected: false };
  };
  await pendingFinalVad.service.start();
  pendingFinalVad.feeder.emit(CHUNK, SAMPLE_RATE);
  await waitFor(() => pendingFinalVad.conversation.isUserSpeaking, "first VAD speech result");
  pendingFinalVad.feeder.emit(CHUNK, SAMPLE_RATE);
  await waitFor(() => pendingFinalVad.vadCalls.length === 2, "pending final VAD result");
  pendingFinalVad.service.finishListening();
  assert.equal(pendingFinalVad.sttCalls.length, 0, "manual finish waits for queued VAD work");
  finalVadResult.resolve({ isSpeechDetected: true });
  await waitFor(() => pendingFinalVad.sttCalls.length === 1, "STT after pending final VAD");
  assert.equal(pendingFinalVad.sttCalls[0].sampleCount, CHUNK.length * 2);
  await waitFor(() => pendingFinalVad.modelCalls.length === 1, "text turn from final VAD chunk");
  pendingFinalVad.appState.currentState = "background";
  await pendingFinalVad.service.stop("background");

  // A pending silent chunk followed by manual finish must not become an empty
  // cloud text request or a user message.
  const pendingSilentVad = createHarness();
  const silentVadResult = deferred();
  pendingSilentVad.vadHandler = async () => silentVadResult.promise;
  await pendingSilentVad.service.start();
  pendingSilentVad.feeder.emit(CHUNK, SAMPLE_RATE);
  await waitFor(() => pendingSilentVad.vadCalls.length === 1, "pending silent VAD result");
  pendingSilentVad.service.finishListening();
  silentVadResult.resolve({ isSpeechDetected: false });
  await waitFor(() => pendingSilentVad.captureStartCalls === 2, "local recovery after empty manual finish");
  assert.equal(pendingSilentVad.sttCalls.length, 0);
  assert.equal(pendingSilentVad.modelCalls.length, 0);
  assert.equal(pendingSilentVad.memoryRetrievalCalls.length, 0);
  assert.equal(pendingSilentVad.conversation.messages.some((message) => message.role === "user"), false);
  pendingSilentVad.appState.currentState = "background";
  await pendingSilentVad.service.stop("background");

  // If local STT completes after stop, its stale transcript cannot trigger a
  // text request, memory retrieval, speech, or conversation-store mutation.
  const pendingStt = createHarness({ ttsEnabled: true });
  const sttResult = deferred();
  pendingStt.sttHandler = async () => sttResult.promise;
  await pendingStt.service.start();
  const oldSampleCallback = [...pendingStt.sampleListeners][0];
  await pendingStt.emitTurn("this transcript is pending");
  await waitFor(() => pendingStt.sttCalls.length === 1, "pending local STT");
  const sttSignal = pendingStt.sttCalls[0].signal;
  pendingStt.appState.currentState = "background";
  await pendingStt.service.stop("background");
  assert.equal(sttSignal.aborted, true);
  const stoppedSnapshot = pendingStt.conversation.messages.slice();
  const stoppedVadCalls = pendingStt.vadCalls.length;
  sttResult.resolve("late transcript after stop");
  oldSampleCallback?.(CHUNK, SAMPLE_RATE);
  await flushMicrotasks();
  assert.deepEqual(pendingStt.conversation.messages, stoppedSnapshot);
  assert.equal(pendingStt.vadCalls.length, stoppedVadCalls, "detached sample callbacks cannot reach VAD after stop");
  assert.equal(pendingStt.conversation.isUserSpeaking, false);
  assert.equal(pendingStt.modelCalls.length, 0);
  assert.equal(pendingStt.memoryRetrievalCalls.length, 0);
  assert.equal(pendingStt.speechCalls.length, 0);
  assert.equal(pendingStt.captureStartCalls, 1, "late STT and audio callbacks cannot restart capture");

  // Tapping aborts the model request and starts a fresh turn. A newer request
  // observes the replacement transcript, and a late old answer cannot overwrite
  // its messages or streaming text.
  const replaced = createHarness();
  const staleModel = deferred();
  replaced.modelHandler = async (_request, callNumber) => callNumber === 1
    ? staleModel.promise
    : { text: "Aktuelle Antwort", model: "gpt-6-luna", usage: {} };
  await replaced.service.start();
  await replaced.emitTurn("alte Frage");
  await waitFor(() => replaced.modelCalls.length === 1, "old pending text request");
  const oldModelSignal = replaced.modelCalls[0].signal;
  await replaced.service.interruptAndListen("tap");
  assert.equal(oldModelSignal.aborted, true);
  assert.equal(replaced.conversation.isListening, true);
  await replaced.emitTurn("neue Frage");
  await waitFor(() => replaced.modelCalls.length === 2, "replacement text request");
  assert.equal(replaced.modelCalls[1].history.at(-1).content, "neue Frage");
  await waitFor(() => replaced.conversation.messages.some(
    (message) => message.role === "assistant" && message.content === "Aktuelle Antwort"
  ), "replacement assistant answer");
  const replacementMessages = replaced.conversation.messages.map((message) => ({ ...message }));
  const replacementStreamingText = replaced.conversation.streamingText;
  const replacementCaptureStarts = replaced.captureStartCalls;
  staleModel.resolve({ text: "veraltete Antwort", model: "gpt-6-luna", usage: {} });
  await flushMicrotasks();
  assert.deepEqual(replaced.conversation.messages, replacementMessages);
  assert.equal(replaced.conversation.streamingText, replacementStreamingText);
  assert.equal(replaced.captureStartCalls, replacementCaptureStarts, "a stale response cannot start an extra capture loop");
  assert.equal(replaced.conversation.messages.some((message) => message.content === "veraltete Antwort"), false);
  replaced.appState.currentState = "background";
  const startsBeforeStop = replaced.captureStartCalls;
  await replaced.service.stop("background");
  assert.equal(replaced.captureStartCalls, startsBeforeStop);

  // Durable memory waits for the local database to become ready. If the voice
  // epoch ends while readiness is pending, the database's current-epoch guard
  // must reject the write instead of committing a stale tool result.
  const staleRemember = createHarness();
  const memoryReadiness = deferred();
  staleRemember.memoryReadinessDeferred = memoryReadiness;
  let rememberToolResult;
  staleRemember.modelHandler = async (request) => {
    rememberToolResult = await request.runTool("remember", { note: "Louis mag Geschichten über Sterne." });
    return { text: "Das merke ich mir.", model: "gpt-6-luna", usage: {} };
  };
  await staleRemember.service.start();
  await staleRemember.emitTurn("Merke dir, dass ich Sterne mag.");
  await waitFor(() => staleRemember.localMemoryRememberCalls.length === 1, "pending durable-memory readiness");
  const rememberRequest = staleRemember.localMemoryRememberCalls[0];
  assert.deepEqual(rememberRequest.messages, [{ role: "user", content: "Louis mag Geschichten über Sterne." }]);
  assert.equal(rememberRequest.metadata.origin, "conversation");
  assert.ok(rememberRequest.metadata.sourceSessionId);
  const oldRememberSignal = staleRemember.modelCalls[0].signal;
  staleRemember.appState.currentState = "background";
  await staleRemember.service.stop("background");
  assert.equal(oldRememberSignal.aborted, true);
  memoryReadiness.resolve();
  await waitFor(() => rememberToolResult !== undefined, "stale memory tool completion");
  assert.equal(rememberRequest.isCurrent(), false, "memory guard sees that its conversation epoch ended");
  assert.deepEqual(rememberToolResult, { ok: true });
  assert.equal(staleRemember.localMemoryCommits.length, 0, "stale tool readiness cannot commit durable memory");
  assert.equal(staleRemember.conversation.messages.some((message) => message.content === "Das merke ich mir."), false);
  assert.equal(staleRemember.speechCalls.length, 0);

  // A tap during cloud speech cancels the old playback signal and starts a new
  // local listening turn. Completing the old promise later cannot start a
  // second replacement listener or alter the current listening state.
  const speechTap = createHarness({ ttsEnabled: true });
  const staleSpeech = deferred();
  speechTap.speechHandler = async () => staleSpeech.promise;
  await speechTap.service.start();
  await speechTap.emitTurn("bitte antworte");
  await waitFor(() => speechTap.speechCalls.length === 1, "pending cloud speech");
  const oldSpeechSignal = speechTap.speechCalls[0].signal;
  await speechTap.service.interruptAndListen("tap");
  assert.equal(oldSpeechSignal.aborted, true);
  assert.equal(speechTap.conversation.isListening, true);
  const startsAfterTap = speechTap.captureStartCalls;
  staleSpeech.resolve();
  await flushMicrotasks();
  assert.equal(speechTap.captureStartCalls, startsAfterTap);
  assert.equal(speechTap.conversation.isListening, true);
  assert.equal(speechTap.personalitySpeech.some((item) => typeof item.text === "string"), false, "a late completion of interrupted playback cannot revive an old character reference");
  speechTap.appState.currentState = "background";
  await speechTap.service.stop("background");
  assert.equal(speechTap.captureStartCalls, startsAfterTap);

  // If stop races an asynchronous shared capture start, the completed start is
  // immediately cleaned up and the service finishes in an idle state.
  const startupRace = createHarness({ ttsEnabled: true });
  startupRace.captureStartDeferred = deferred();
  const starting = startupRace.service.start();
  await waitFor(() => startupRace.captureStartCalls === 1, "asynchronous capture start");
  startupRace.appState.currentState = "background";
  const stopping = startupRace.service.stop("background");
  assert.equal(startupRace.service.isActive, false);
  startupRace.captureStartDeferred.resolve();
  await Promise.all([starting, stopping]);
  assert.equal(startupRace.service.isActive, false);
  assert.equal(startupRace.captureRunning, false);
  assert.equal(startupRace.conversation.realtimeReadiness, "idle");
  assert.equal(startupRace.conversation.isListening, false);
  assert.equal(startupRace.speechCalls.length, 0);
  assert.equal(startupRace.wakewordStartCalls, 0);

  // Budget mode refuses wheel movement, turning, and dancing locally while
  // still allowing STOP, a nod, and sleep through the deterministic handler.
  const commands = createHarness();
  const parsed = new Map([
    ["drive forward", { kind: "explicit", command: { kind: "move", direction: "forward" } }],
    ["drive backward", { kind: "explicit", command: { kind: "move", direction: "backward" } }],
    ["turn left", { kind: "explicit", command: { kind: "turn", direction: "left", degrees: 90 } }],
    ["dance", { kind: "explicit", command: { kind: "dance" } }],
    ["stop", { kind: "explicit", command: { kind: "move", direction: "stop" } }],
    ["nod", { kind: "explicit", command: { kind: "gesture", gesture: "nod", count: 1 } }],
    ["sleep", { kind: "explicit", command: { kind: "sleep" } }],
  ]);
  commands.physicalByTranscript = parsed;
  await commands.service.start();
  let expectedMotorCalls = 0;
  for (const [transcript, shouldExecute] of [
    ["drive forward", false],
    ["drive backward", false],
    ["turn left", false],
    ["dance", false],
    ["stop", true],
    ["nod", true],
    ["sleep", true],
  ]) {
    const messageCount = commands.conversation.messages.length;
    const startCount = commands.captureStartCalls;
    await commands.emitTurn(transcript);
    await waitFor(() => commands.conversation.messages.length > messageCount, `local response to ${transcript}`);
    if (shouldExecute) {
      expectedMotorCalls += 1;
      await waitFor(() => commands.motorCalls.length === expectedMotorCalls, `safe local command ${transcript}`);
    } else {
      assert.equal(commands.motorCalls.length, expectedMotorCalls, `${transcript} must not call the local motor handler`);
    }
    await waitFor(() => commands.captureStartCalls > startCount, `next listening turn after ${transcript}`);
  }
  assert.deepEqual(commands.motorCalls.map(({ parsed: command }) => command.command.kind), ["move", "gesture", "sleep"]);
  assert.deepEqual(commands.motorCalls.map(({ transcript }) => transcript), ["stop", "nod", "sleep"]);
  assert.equal(commands.modelCalls.length, 0, "physical intents are handled before the text API");
  assert.equal(commands.memoryRetrievalCalls.length, 0);
  commands.appState.currentState = "background";
  await commands.service.stop("background");

  // Budget can discover apps and stop an active one, but it cannot start an
  // app that may move hardware while continuous voice STOP is unavailable.
  const appSkills = createHarness();
  appSkills.modelHandler = async (request) => {
    appSkills.appSkillResults = {
      search: await request.runTool("search_robot_apps", { query: "dance", limit: null }),
      describe: await request.runTool("describe_robot_app", { space_id: "pollen/dance-demo" }),
      start: await request.runTool("start_robot_app", { space_id: "pollen/dance-demo" }),
      stop: await request.runTool("stop_robot_app", {}),
    };
    return { text: "Ich habe die App geprüft.", model: "gpt-6-luna", usage: {} };
  };
  await appSkills.service.start();
  await appSkills.emitTurn("Finde eine Tanz-App.");
  await waitFor(() => appSkills.appSkillResults !== undefined, "robot-app tool results in Budget mode");
  assert.equal(appSkills.appSkillResults.search.status, "listed");
  assert.equal(appSkills.appSkillResults.describe.status, "described");
  assert.deepEqual(appSkills.appSkillResults.start, {
    ok: false,
    status: "start_requires_realtime",
    reason: "continuous_stop_unavailable",
  });
  assert.deepEqual(appSkills.appSkillResults.stop, { ok: true, status: "stopped" });
  assert.deepEqual(appSkills.robotAppSkillCalls.map(({ method }) => method), ["search", "describe", "stop"]);
  assert.equal(appSkills.robotAppSkillCalls[0].limit, 5, "strict-schema null uses the shared default catalog limit");
  assert.equal(appSkills.robotAppSkillCalls.some(({ method }) => method === "start"), false, "Budget never admits app start");
  assert.deepEqual(appSkills.motorCalls, [], "app tools do not bypass the local physical-command gate");
  appSkills.appState.currentState = "background";
  await appSkills.service.stop("background");

  // Native Sherpa already waits minSilenceDuration before it publishes a
  // completed segment. A finished segment must not start another silence timer.
  const endpoint = createHarness();
  endpoint.nextTranscript = "Wie heißt du?";
  let endpointFrame = 0;
  endpoint.vadHandler = async () => ++endpointFrame === 1
    ? { isSpeechDetected: true, segments: [] }
    : { isSpeechDetected: false, segments: [{ startTime: 0, endTime: 0.3 }] };
  await endpoint.service.start();
  endpoint.feeder.emit();
  await flushMicrotasks();
  endpoint.feeder.emit();
  await flushMicrotasks();
  assert.equal(endpoint.sttCalls.length, 1, "completed native VAD segment commits without an extra 800ms hold");
  endpoint.appState.currentState = "background";
  await endpoint.service.stop("background");

  const resumed = createHarness();
  resumed.vadHandler = async () => ({ isSpeechDetected: true, segments: [{ startTime: 0, endTime: 0.3 }] });
  await resumed.service.start();
  resumed.feeder.emit();
  await flushMicrotasks();
  assert.equal(resumed.sttCalls.length, 0, "speech in the same block keeps the turn open even with an older completed segment");
  resumed.appState.currentState = "background";
  await resumed.service.stop("background");

  const empty = createHarness();
  empty.vadHandler = async () => ({ isSpeechDetected: false, segments: [{ startTime: 0, endTime: 0.3 }] });
  await empty.service.start();
  empty.feeder.emit();
  await flushMicrotasks();
  assert.equal(empty.sttCalls.length, 0, "a segment alone does not authorize processing without observed speech in this turn");
  empty.appState.currentState = "background";
  await empty.service.stop("background");

  const ownInterests = createHarness();
  ownInterests.modelHandler = async (request) => {
    const result = await request.runTool("list_companion_interests", {});
    assert.equal(result.total, 0);
    return { text: "Eine eigene Vorliebe hat sich noch nicht entwickelt.", model: "gpt-6-luna", usage: {} };
  };
  await ownInterests.service.start();
  await ownInterests.emitTurn("Louis, was magst du inzwischen?");
  await waitFor(() => ownInterests.conversation.messages.some((item) => item.role === "assistant"), "the own-interest response");
  assert.deepEqual(ownInterests.interestReads, ["Louis, was magst du inzwischen?"], "Budget reads the robot's interests from the exact committed turn");
  assert.deepEqual(ownInterests.localMemoryRememberCalls, [], "an overview cannot write a personal memory");
  assert.deepEqual(ownInterests.motorCalls, []);
  assert.equal(ownInterests.personalitySpeech.some((item) => typeof item.text === "string"), false, "display-only replies are not heard-speech references");
  ownInterests.appState.currentState = "background";
  await ownInterests.service.stop("background");

  assert.equal(networkCalls, 0, "the budget runtime never opens a Realtime or direct API transport");
  console.log("Budget conversation runtime integration tests passed");
} finally {
  globalThis.fetch = originalFetch;
}

}
