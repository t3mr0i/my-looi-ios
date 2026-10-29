import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let photo = deferred();
let search = deferred();
let physical = deferred();
let nativeCapture = deferred();
let startupMemory = deferred();
let memoryRequested = false;
let memoryMutationInProgress = false;
const callbacks = {};
const storeEvents = [];
const sent = [];
const stopped = [];
const assistantSpeechBegin = deferred();
let assistantSpeechBeginResponse = null;
const assistantSpeechCalls = { feeds: [], ends: [], cancels: [] };
const hermesTaskToolDefinitions = { HERMES_TASK_TOOL_NAMES: new Set(["start_hermes_task", "list_hermes_tasks", "get_hermes_task", "retry_pending_hermes_task"]) };
const vosk = {
  addListener() { return { remove() {} }; },
  beginAssistantOutput(_language, responseId) {
    return responseId === assistantSpeechBeginResponse
      ? assistantSpeechBegin.promise
      : Promise.resolve({ ready: false, generation: 1 });
  },
  feedAssistantPcm24(responseId, pcm24Base64) { assistantSpeechCalls.feeds.push([responseId, pcm24Base64]); return true; },
  endAssistantOutput(responseId) { assistantSpeechCalls.ends.push(responseId); },
  cancelAssistantOutput(responseId) { assistantSpeechCalls.cancels.push(responseId); },
};
const audio = {
  addListener(name, callback) { callbacks[name] = callback; return { remove() {} }; },
  stopPlayback() { return { playedDurationMs: 25 }; },
};
const store = new Proxy({}, { get: (_, name) => (...args) => storeEvents.push([name, ...args]) });
const dependencies = {
  "./input-attention": loadTypeScript("src/voice/input-attention.ts"),
  "../behavior/behavior-events": {
    beginBehaviorSession() {}, endBehaviorSession() {}, getBehaviorConversationContext: () => "", isBehaviorGameActive: () => false, requiresBehaviorTurnCommit: () => false,
    // This lifecycle fixture has no registered behavior session.
    getBehaviorInteractionRevision: () => null,
    inspectBehaviorVisual: async () => "", publishBehaviorEvent() {},
  },
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "../core/main-screen-presence": { isMainScreenFocused: () => true },
  "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
  "expo-audio": { async setIsAudioActiveAsync() {} }, "../core/observation": {},
  "../core/robot-inactivity": {},
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../memory/local-memory-database": { localMemoryDatabase: { search: () => search.promise } },
  "../memory/memory-service": {
    isLocalMemoryMutationInProgress: () => memoryMutationInProgress,
    mirrorSessionMessage: (...args) => storeEvents.push(["mirror", ...args]),
    mirrorSessionTouch() {},
    retrieveConversationMemories() { memoryRequested = true; return startupMemory.promise; },
  },
  "../openai/openai-api-key": {},
  "../store/conversation": { useConversationStore: { getState: () => store } },
  "../store/user": { useUserStore: { getState: () => ({ preferences: {}, setVoiceState() {} }) } },
  "../vision/look-here": { captureExplicitLookHereStill: () => photo.promise },
  "../openai/openai-api-status": {}, "../../modules/realtime-audio-route": {},
  "../../modules/local-realtime-audio-capture/realtime-pcm": {
    getRealtimePcmAudioModule: () => audio,
    startPcmCapture: () => nativeCapture.promise,
    async reservePcmCapture() {},
  },
  "../../modules/vosk-command-recognizer": vosk,
  "../character/speech-expression": { createSpeechExpressionTracker: () => ({ setNativeGeneration() {}, setTranscript() {}, acceptRecognition() {}, advancePlayback() {}, invalidate() {} }) },
  "../language/response-language": { normalizeResponseLanguage: (value) => value },
  "./kws-audio-feeder": { kwsAudioFeeder: { diagnosticStatus: { appCaptureAllowed: true }, setAppCaptureAllowed() {} } },
  "./realtime-latency": loadTypeScript("src/voice/realtime-latency.ts"),
  "./realtime-config": { REALTIME_MODEL: "test" }, "./wakeword": {},
  "./hermes-task-tools": { hermesTaskVoiceBridge: { async execute() { return { ok: true }; } } },
  "./hermes-task-tool-definitions": hermesTaskToolDefinitions,
  "./robot-app-skill-tools": { ROBOT_APP_TOOL_NAMES: new Set(), async executeRobotAppTool() { return { ok: true }; } },
  "./robot-app-skill-tool-definitions": { ROBOT_APP_SKILL_TOOL_NAMES: new Set() },
  "./realtime-physical-command": { executeRealtimePhysicalCommand: () => physical.promise },
  "./realtime-visual-command": {},
};
const output = ts.transpileModule(fs.readFileSync("src/voice/realtime-pcm-conversation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  assert.ok(name in dependencies, `Unexpected dependency ${name}`);
  return dependencies[name];
}, module, module.exports);
const service = new module.exports.RealtimePcmConversationService();
service.send = (event) => sent.push(event);
service.stop = async (reason) => { stopped.push(reason); service.active = false; };
service.active = true;
service.sessionId = "old";
service.bindNativeAudioEvents();
const oldCallbacks = { ...callbacks };
service.sessionId = "new";
service.bindNativeAudioEvents();
oldCallbacks.onCaptureError({ stage: "interruption", message: "old event" });
oldCallbacks.onPlaybackError({ message: "old event" });
oldCallbacks.onAudioData({ pcm16Base64: "must not decode", sampleRate: 16000 });
assert.equal(stopped.length, 0);
assert.equal(storeEvents.length, 0);
service.generationActive = true;
service.playbackActive = true;
service.assistantItemId = "heard-partially";
callbacks.onPlaybackError({ message: "device stopped" });
assert.deepEqual(stopped, ["playback-error"]);
assert.ok(sent.some((event) => event.type === "response.cancel"));
assert.ok(sent.some((event) => event.type === "conversation.item.truncate" && event.audio_end_ms === 25));
sent.length = 0; storeEvents.length = 0;

// A delayed photo must neither reach a new conversation nor clear its flags.
service.active = true; service.sessionId = "photo-request";
const capture = service.executeLocalVisualCommand({ kind: "look", cameraFacing: "front" }, "look");
service.sessionId = "next-conversation";
service.localVisualCommandInFlight = true;
photo.resolve({ mimeType: "image/jpeg", base64: "private-photo", width: 10, height: 10 });
await capture;
assert.equal(sent.length, 0);
assert.equal(storeEvents.length, 0);
assert.equal(service.localVisualCommandInFlight, true);

// The same isolation applies to delayed memory and robot command completions.
service.sessionId = "memory-request";
const tool = service.executeToolCall({ call_id: "call-1", name: "search_memory", arguments: '{"query":"hello"}' });
service.sessionId = "next-conversation"; service.toolCallsInFlight = 5;
search.resolve([]); await tool;
assert.equal(sent.length, 0);
assert.equal(service.toolCallsInFlight, 5);
service.sessionId = "physical-request";
const command = service.executeLocalPhysicalCommand({ kind: "stop" }, "stop");
service.sessionId = "next-conversation";
physical.resolve({ acknowledgement: "Old acknowledgement", ok: true, commandKind: "stop" });
await command;
assert.equal(storeEvents.length, 0);

// A late close callback from a replaced socket cannot stop the current session.
const oldSocket = {};
service.webSocket = oldSocket; service.bindWebSocket(oldSocket);
const close = oldSocket.onclose;
service.webSocket = {}; service.active = true;
close({ code: 1006, reason: "old socket" });
assert.deepEqual(stopped, ["playback-error"]);

service.sessionId = "capture-start"; service.captureOwner = "conversation:old";
const pendingCapture = service.handleEvent({ type: "session.updated" });
service.sessionId = "next-conversation"; service.configured = false;
nativeCapture.resolve({ captureRunning: true });
await pendingCapture;
assert.equal(storeEvents.length, 0);
assert.equal(service.configured, false);

// A canceled start that fails later cannot stop the replacement conversation.
service.active = false; service.stopping = false;
memoryMutationInProgress = true;
const beforeBlockedStart = storeEvents.length;
await service.start();
assert.equal(service.active, false, "a memory mutation must block acquiring a new conversation");
assert.equal(storeEvents.length, beforeBlockedStart, "a blocked start must not alter voice state");
memoryMutationInProgress = false;
const startup = service.start();
for (let index = 0; index < 10 && !memoryRequested; index++) await Promise.resolve();
assert.equal(memoryRequested, true);
service.lifecycleGeneration += 1;
service.active = true; service.sessionId = "replacement";
storeEvents.length = 0;
startupMemory.reject(new Error("old database request failed"));
await startup;
assert.deepEqual(stopped, ["playback-error"]);
assert.equal(storeEvents.length, 0);

const currentSocket = {};
service.webSocket = currentSocket; service.bindWebSocket(currentSocket);
service.handleEvent = async () => { throw new Error("unexpected event failure"); };
currentSocket.onmessage({ data: '{"type":"response.failed"}' });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(stopped, ["playback-error", "event-handler-failed"]);

// If output finishes before the asynchronous native begin resolves, already
// admitted PCM still feeds in order before end; no heard phrase is fabricated.
service.active = true;
service.sessionId = "asr-session";
service.lifecycleGeneration = 73;
assistantSpeechBeginResponse = "queued-before-begin";
service.beginSpeechTracking(assistantSpeechBeginResponse);
service.queueSpeechPcm(assistantSpeechBeginResponse, "AQID");
service.endSpeechTrackingInput(assistantSpeechBeginResponse);
assert.equal(service.speechEnded, true);
assert.equal(assistantSpeechCalls.feeds.length, 0);
assistantSpeechBegin.resolve({ ready: true, generation: 41 });
for (let index = 0; index < 12; index += 1) await Promise.resolve();
assert.deepEqual(assistantSpeechCalls.feeds, [["queued-before-begin", "AQID"]]);
assert.deepEqual(assistantSpeechCalls.ends, ["queued-before-begin"]);
service.retireSpeechTracking(true);

// Two taps share the entire selection/import lifecycle. A completed old call
// therefore cannot clear a second picker that has already begun importing.
let pickerResult = deferred();
let pickerCalls = 0;
let clears = 0;
const pickerDependencies = {
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "../../modules/photo-picker-access": { getPhotoPickerAccessModule: () => ({
    selectPhotos() { pickerCalls++; return pickerResult.promise; },
    async clearSelection() { clears++; },
  }) },
  "../core/app-bootstrap": {},
  "../core/background-process-exit": { async withExternalActivityLease(_, operation) { return operation(); } },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../perceivers/voice-runtime": {},
  "../store/conversation": { useConversationStore: { getState: () => ({ messages: [] }) } },
  "../voice/realtime-conversation": {},
};
const pickerOutput = ts.transpileModule(fs.readFileSync("src/vision/photo-picker-context.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pickerModule = { exports: {} };
new Function("require", "module", "exports", pickerOutput)((name) => {
  assert.ok(name in pickerDependencies, `Unexpected picker dependency ${name}`);
  return pickerDependencies[name];
}, pickerModule, pickerModule.exports);
const pick = pickerModule.exports.selectPhotosIntoCurrentDiscussion;
const firstPick = pick();
assert.equal(pick(), firstPick);
assert.equal(pickerCalls, 1);
pickerResult.resolve([]);
assert.deepEqual(await firstPick, { selected: 0, cancelled: true });
assert.equal(clears, 1);
pickerResult = deferred();
const failedPick = pick();
assert.equal(pickerCalls, 2);
pickerResult.reject(new Error("provider failed"));
await assert.rejects(failedPick, /provider failed/);
pickerResult = deferred();
const retry = pick();
pickerResult.resolve([]);
await retry;
assert.equal(pickerCalls, 3);
console.log("Realtime session isolation, error recovery and photo selection serialization passed");
