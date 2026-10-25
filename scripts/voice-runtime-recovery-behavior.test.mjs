import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function harness() {
  const events = [];
  const diagnostics = [];
  const status = { running: false, pcmFlowing: false };
  const conversation = {
    isListening: false, isProcessing: false, isSpeaking: false,
    setListening(value) { this.isListening = value; },
    setProcessing(value) { this.isProcessing = value; },
    setSpeaking(value) { this.isSpeaking = value; },
    setOverlayVisible() {},
  };
  const user = {
    preferences: { wakeWordEnabled: true, conversationMode: "classic" },
    setVoiceState(value) { events.push(`voiceState:${value}`); },
  };
  const hooks = { active: true, onSync: null, onPcm: null, recoverOnStart: false, syncStarted: deferred(), pcmStarted: deferred() };
  const wakeword = { isListening: false, state: "idle" };
  const realtime = { isActive: false };
  const delays = [];
  let delayReady = deferred();
  const feeder = {
    get diagnosticStatus() { return { ...status }; },
    get isRunning() { return status.running; },
    async waitForFreshPcm(timeout) {
      events.push(`waitPcm:${timeout}`); hooks.pcmStarted.resolve();
      return hooks.onPcm ? hooks.onPcm() : status.pcmFlowing;
    },
  };
  const api = loadTypeScript("src/core/voice-runtime-recovery.ts", {
    "../perceivers/voice-runtime": { voiceRuntime: {
      async sync() { events.push("sync"); hooks.syncStarted.resolve(); await hooks.onSync?.(); },
      async stop() { events.push("stop"); status.running = false; wakeword.isListening = false; },
      async start() {
        events.push("start");
        if (hooks.recoverOnStart && user.preferences.wakeWordEnabled) {
          status.running = true; status.pcmFlowing = true; wakeword.isListening = true;
        }
      },
    } },
    "../store/user": { useUserStore: { getState: () => user }, isRealtimeConversationMode: (mode) => mode === "realtime" },
    "../store/conversation": { useConversationStore: { getState: () => conversation } },
    "./runtime-profile": { getRuntimeProfile: () => ({ allowsWakewordAutostart: true }) },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent(_, event, details) { diagnostics.push({ event, details }); } },
    "../voice/kws-audio-feeder": { kwsAudioFeeder: feeder },
    "../voice/wakeword": { wakewordService: wakeword },
    "../voice/realtime-conversation": { realtimeConversationService: realtime },
  }, {
    setTimeout(callback, delay) {
      assert.equal(delay, 120);
      delays.push(callback); delayReady.resolve(); return delays.length;
    },
  });
  return {
    events, diagnostics, status, conversation, user, hooks, wakeword, realtime, delays,
    recover: () => api.recoverWakewordRuntime(() => hooks.active),
    async nextDelay() {
      await delayReady.promise;
      const resume = delays.shift();
      assert.equal(typeof resume, "function");
      if (!delays.length) delayReady = deferred();
      return resume;
    },
  };
}

test("a healthy wakeword pipeline needs no recovery", async () => {
  const h = harness();
  h.status.running = true; h.status.pcmFlowing = true; h.wakeword.isListening = true;
  await h.recover();
  assert.deepEqual(h.events, []);
  assert.equal(h.delays.length, 0);
});

test("fresh PCM during startup avoids repair", async () => {
  const h = harness();
  h.status.running = true; h.wakeword.isListening = true;
  h.hooks.onPcm = () => { h.status.pcmFlowing = true; return true; };
  await h.recover();
  assert.deepEqual(h.events, ["waitPcm:1200"]);
});

test("a conversation acquired while awaiting PCM prevents repair", async () => {
  const h = harness();
  h.status.running = true; h.wakeword.isListening = true;
  const pcm = deferred();
  h.hooks.onPcm = () => pcm.promise;
  const recovery = h.recover();
  await h.hooks.pcmStarted.promise;
  h.conversation.isProcessing = true;
  pcm.resolve(false);
  await recovery;
  assert.deepEqual(h.events, ["waitPcm:1200"]);
});

test("a pending Realtime conversation keeps its listening state", async () => {
  const h = harness();
  h.user.preferences.conversationMode = "realtime";
  h.conversation.isListening = true;
  await h.recover();
  assert.deepEqual(h.events, []);
  assert.equal(h.conversation.isListening, true);
});

for (const owner of ["realtime", "processing", "speaking"]) {
  test(`an existing ${owner} conversation retains its microphone`, async () => {
    const h = harness();
    if (owner === "realtime") h.realtime.isActive = true;
    if (owner === "processing") h.conversation.isProcessing = true;
    if (owner === "speaking") h.conversation.isSpeaking = true;
    await h.recover();
    assert.deepEqual(h.events, []);
    assert.ok(h.diagnostics.some(({ event }) => event === "foreground-voice-repair-deferred"));
  });
}

for (const change of ["conversation", "realtime", "disabled", "background"]) {
  test(`${change} during retry delay prevents microphone repair`, async () => {
    const h = harness();
    const recovery = h.recover();
    const resume = await h.nextDelay();
    if (change === "conversation") h.conversation.isProcessing = true;
    if (change === "realtime") h.realtime.isActive = true;
    if (change === "disabled") h.user.preferences = { ...h.user.preferences, wakeWordEnabled: false };
    if (change === "background") h.hooks.active = false;
    resume();
    await recovery;
    assert.deepEqual(h.events, []);
  });
}

test("a conversation acquired during sync prevents escalation", async () => {
  const h = harness();
  const syncing = deferred();
  h.hooks.onSync = () => syncing.promise;
  const recovery = h.recover();
  (await h.nextDelay())();
  await h.hooks.syncStarted.promise;
  h.conversation.isSpeaking = true;
  syncing.resolve();
  await recovery;
  assert.deepEqual(h.events, ["sync"]);
});

test("a conversation acquired after teardown prevents another start", async () => {
  const h = harness();
  const recovery = h.recover();
  (await h.nextDelay())();
  const resumeRestart = await h.nextDelay();
  assert.deepEqual(h.events, ["sync", "stop"]);
  h.realtime.isActive = true;
  resumeRestart();
  await recovery;
  assert.deepEqual(h.events, ["sync", "stop"]);
});

test("disabling wake listening during teardown still restores the idle facade", async () => {
  const h = harness();
  h.hooks.recoverOnStart = true;
  const recovery = h.recover();
  (await h.nextDelay())();
  const resumeRestart = await h.nextDelay();
  h.user.preferences.wakeWordEnabled = false;
  resumeRestart();
  await recovery;
  assert.deepEqual(h.events, ["sync", "stop", "start"]);
  assert.equal(h.status.running, false);
  assert.equal(h.wakeword.isListening, false);
});

test("successful synchronization avoids a hard restart", async () => {
  const h = harness();
  h.hooks.onSync = () => { h.status.running = true; h.status.pcmFlowing = true; h.wakeword.isListening = true; };
  const recovery = h.recover();
  (await h.nextDelay())();
  await recovery;
  assert.deepEqual(h.events, ["sync", "waitPcm:800"]);
  assert.equal(h.delays.length, 0);
});

test("a hard restart restores capture once", async () => {
  const h = harness();
  h.hooks.recoverOnStart = true;
  const recovery = h.recover();
  (await h.nextDelay())();
  (await h.nextDelay())();
  await recovery;
  assert.deepEqual(h.events, ["sync", "stop", "start", "sync", "waitPcm:1200"]);
  assert.ok(h.diagnostics.some(({ event }) => event === "foreground-voice-hard-restart-finished"));
  assert.equal(h.diagnostics.some(({ event }) => event === "foreground-voice-readiness-failed"), false);
});

test("persistent capture failure stops after the bounded repair sequence", async () => {
  const h = harness();
  const recovery = h.recover();
  (await h.nextDelay())();
  (await h.nextDelay())();
  await recovery;
  assert.deepEqual(h.events, ["sync", "stop", "start", "sync"]);
  assert.ok(h.diagnostics.some(({ event }) => event === "foreground-voice-readiness-failed"));
  assert.equal(h.delays.length, 0);
});

test("stale classic listening state is reset before recovery", async () => {
  const h = harness();
  h.conversation.isListening = true;
  h.hooks.onSync = () => { h.status.running = true; h.status.pcmFlowing = true; h.wakeword.isListening = true; };
  await h.recover();
  assert.deepEqual(h.events, ["voiceState:sleeping", "sync"]);
  assert.equal(h.conversation.isListening, false);
});
