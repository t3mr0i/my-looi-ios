import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

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
const callbacks = {};
const storeEvents = [];
const sent = [];
const stopped = [];
const audio = {
  addListener(name, callback) { callbacks[name] = callback; return { remove() {} }; },
  stopPlayback() { return { playedDurationMs: 25 }; },
};
const store = new Proxy({}, { get: (_, name) => (...args) => storeEvents.push([name, ...args]) });
const dependencies = {
  "react-native": { Platform: { OS: "ios" }, AppState: { currentState: "active" } },
  "./audio-capture-profile": { isRealtimeCaptureReady: () => true },
  "expo-audio": { async setIsAudioActiveAsync() {} }, "../core/observation": {},
  "../core/robot-inactivity": {},
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../memory/local-memory-database": { localMemoryDatabase: { search: () => search.promise } },
  "../memory/memory-service": {
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
  "./kws-audio-feeder": { kwsAudioFeeder: { diagnosticStatus: { appCaptureAllowed: true }, setAppCaptureAllowed() {} } },
  "./realtime-config": { REALTIME_MODEL: "test" }, "./wakeword": {},
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
console.log("Realtime session isolation and playback error recovery passed");
