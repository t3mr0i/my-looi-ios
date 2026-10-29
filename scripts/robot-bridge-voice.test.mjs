import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

function harness(options = {}) {
  const events = [];
  const diagnostics = [];
  let runtime;
  let getVoiceModuleCalls = 0;
  const user = {
    robotSleeping: false,
    voiceState: "sleeping",
    preferences: { wakeWordEnabled: true, conversationMode: "classic" },
  };
  const conversation = { isListening: false, isProcessing: false, isSpeaking: false };
  const realtimeConversationService = {
    isActive: false,
    async stop(reason) { events.push(`realtime.stop:${reason}`); },
  };
  const voicePerceiver = {
    async start() { events.push("voice.start"); },
    async stop() { events.push("voice.stop"); },
    async syncWakewordRuntime() { events.push("voice.syncWakeword"); },
    async syncConversationMode() { events.push("voice.syncConversation"); },
    async trigger() { events.push("voice.trigger"); },
    async interruptAndListen(reason) { events.push(`voice.interrupt:${reason}`); },
    async rearmWakewordAfterNavigation() { events.push("voice.rearm"); },
    async prepareIdleCharacterReaction() { events.push("voice.idleReaction"); return { ok: true, reason: "ready" }; },
    async resumeRealtimeConversationFromMain(source) { events.push(`voice.resumeRealtime:${source}`); },
    onObservation() { events.push("voice.subscribe"); return () => events.push("voice.unsubscribe"); },
  };

  const dependencies = {
    "../core/perceiver": {
      BasePerceiver: class BasePerceiver {
        isActive = false;
        onObservation() { return () => undefined; }
      },
    },
    "../core/runtime-profile": { getRuntimeProfile: () => ({ allowsWakewordAutostart: true }) },
    "../store/user": {
      useUserStore: { getState: () => user },
      isRealtimeConversationMode: (mode) => mode === "realtime",
    },
    "../voice/lazy-services": {
      getVoiceModule() {
        getVoiceModuleCalls++;
        return options.getVoiceModule
          ? options.getVoiceModule({ calls: getVoiceModuleCalls, voicePerceiver })
          : Promise.resolve({ voicePerceiver });
      },
    },
    "../store/conversation": { useConversationStore: { getState: () => conversation } },
    "../diagnostics/diagnostic-log": {
      recordDiagnosticEvent(_category, event, details) { diagnostics.push({ event, details }); },
    },
  };
  Object.defineProperty(dependencies, "../voice/realtime-conversation", {
    get() {
      options.onRealtimeImport?.();
      return { realtimeConversationService };
    },
  });

  const module = loadTypeScript("src/perceivers/voice-runtime.ts", dependencies);
  runtime = new module.VoiceRuntime();
  return {
    runtime,
    user,
    conversation,
    events,
    diagnostics,
    voicePerceiver,
    realtimeConversationService,
    get getVoiceModuleCalls() { return getVoiceModuleCalls; },
  };
}

test("external media ownership closes voice admission for every microphone-start path", async () => {
  const h = harness();
  h.runtime.blockForExternalMedia("robot-app-a");

  await h.runtime.start();
  assert.equal(h.runtime.isActive, false, "a blocked cold start does not mark voice active");

  // Simulate an already-registered facade so each operation reaches its own gate.
  h.runtime.isActive = true;
  await h.runtime.sync();
  await h.runtime.trigger();
  await h.runtime.interruptAndListen();
  await h.runtime.rearmWakewordAfterNavigation();
  await h.runtime.resumeMainScreenConversation("navigation-return");
  await h.runtime.resumeMainScreenConversation("foreground-resume");
  const reaction = await h.runtime.prepareIdleCharacterReaction();

  assert.deepEqual(reaction, { ok: false, reason: "external-robot-app" });
  assert.deepEqual(h.events, [], "no lazy voice service or microphone-start method runs while media is owned");
  assert.equal(h.getVoiceModuleCalls, 0);
});

test("only the owner that closed the gate can reopen it", async () => {
  const h = harness();
  h.runtime.blockForExternalMedia("robot-app-a");

  h.runtime.releaseExternalMedia("robot-app-b");
  assert.equal(h.runtime.isMediaExternallyOwned, true);
  assert.throws(() => h.runtime.blockForExternalMedia("robot-app-b"), /owned by another app/);
  await h.runtime.trigger();
  assert.equal(h.getVoiceModuleCalls, 0);

  h.runtime.releaseExternalMedia("robot-app-a");
  assert.equal(h.runtime.isMediaExternallyOwned, false);
});

test("releasing external ownership allows normal voice startup again", async () => {
  const h = harness();
  h.runtime.blockForExternalMedia("robot-app-a");
  h.runtime.releaseExternalMedia("robot-app-a");

  await h.runtime.start();
  assert.deepEqual(h.events, ["voice.subscribe", "voice.start"]);
  assert.equal(h.runtime.isActive, true);
});

for (const operation of ["start", "trigger"]) {
  test(`external ownership acquired during lazy loading cancels a late ${operation}`, async () => {
    const loading = deferred();
    const loadingStarted = deferred();
    const h = harness({
      getVoiceModule({ calls, voicePerceiver }) {
        if (calls === 1) {
          loadingStarted.resolve();
          return loading.promise;
        }
        return Promise.resolve({ voicePerceiver });
      },
    });

    const pending = h.runtime[operation]();
    await loadingStarted.promise;
    h.runtime.blockForExternalMedia("robot-app-race");
    loading.resolve({ voicePerceiver: h.voicePerceiver });
    await pending;

    assert.equal(h.runtime.isMediaExternallyOwned, true);
    assert.equal(h.events.includes("voice.start"), false, "the late lazy import cannot start normal capture");
    assert.equal(h.events.includes("voice.trigger"), false, "the late lazy import cannot trigger a listening session");
    assert.equal(h.getVoiceModuleCalls, 2);
  });
}

for (const conversationMode of ["classic", "realtime"]) {
  test(`external ownership acquired during navigation import blocks deferred ${conversationMode} auto-listen`, async () => {
    let onRealtimeImport;
    const h = harness({ onRealtimeImport: () => onRealtimeImport?.() });
    h.runtime.isActive = true;
    h.user.preferences.conversationMode = conversationMode;
    onRealtimeImport = () => h.runtime.blockForExternalMedia("robot-app-navigation-race");

    await h.runtime.resumeMainScreenConversation("navigation-return");

    assert.equal(h.runtime.isMediaExternallyOwned, true);
    assert.equal(h.events.includes("voice.trigger"), false, "navigation's deferred classic trigger must recheck the external owner gate");
    assert.equal(h.events.some((event) => event.startsWith("voice.resumeRealtime:")), false, "navigation's deferred Realtime resume must recheck the external owner gate");
  });
}
