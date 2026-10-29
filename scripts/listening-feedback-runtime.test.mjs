import assert from "node:assert/strict";
import { createCompanionLiveRuntime } from "./helpers/companion-live-runtime.mjs";

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const original = { performance: Object.getOwnPropertyDescriptor(globalThis, "performance"),
  setTimeout, clearTimeout, setInterval, clearInterval };
let now = 1_000, serial = 0;
const timers = new Map();
function schedule(fn, ms, repeat = false) { const id = ++serial; timers.set(id, { fn, at: now + ms, interval: repeat ? ms : 0 }); return id; }
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
globalThis.setTimeout = (fn, ms = 0) => schedule(fn, ms);
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.setInterval = (fn, ms) => schedule(fn, ms, true);
globalThis.clearInterval = (id) => timers.delete(id);
async function advance(ms) {
  const target = now + ms;
  let guard = 0;
  for (;;) {
    const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    assert.ok(++guard < 5_000, "timers stay bounded");
    const [id, timer] = next; timers.delete(id); now = timer.at;
    if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
    timer.fn(); await flush();
  }
  now = target; await flush();
}

let fixture;
try {
  fixture = createCompanionLiveRuntime({ reducedMotion: false });
  await flush();
  fixture.setRobotRuntimeState({ connected: true });
  const { events, runtime, conversation, user } = fixture;
  const service = new fixture.RealtimePcmConversationService();
  service.active = true; service.configured = true; service.sessionId = "listening-live";
  const sentTypes = [];
  service.send = (event) => { sentTypes.push(event.type); return true; };
  events.beginBehaviorSession(service.sessionId, () => {});
  fixture.bindPcmAudioEventsForOfflineTest(service);
  let sequence = 0, native = 800_000;
  async function wait(ms) { native += ms; await advance(ms); }
  async function feed(rms, count) {
    const pcm = Buffer.alloc(1_600 * 2);
    for (let i = 0; i < 1_600; i++) pcm.writeInt16LE(Math.round(rms * 32_767), i * 2);
    for (let i = 0; i < count; i++) {
      await advance(100); native += 100;
      fixture.emitPcmAudioEvent("onAudioData", { pcm16Base64: pcm.toString("base64"), sampleRate: 16_000,
        frames: 1_600, rms, sequence: ++sequence, timestampMs: native });
      await flush();
    }
  }
  async function beginTurn() {
    await service.handleEvent({ type: "input_audio_buffer.speech_started" }); await flush();
  }
  async function opportunity() { await feed(0.03, 35); await feed(0.001, 3); }
  const presentation = () => runtime.useBehaviorStore.getState().presentation;

  await opportunity();
  assert.notEqual(presentation()?.mood, "listening", "audio alone cannot act without the active server speech gate");
  await beginTurn();
  const beforeDecisions = fixture.behaviorEngine.getState().metrics.requests;
  await feed(0.03, 35);
  assert.notEqual(presentation()?.mood, "listening", "speech alone does not trigger the accent");
  await feed(0.001, 3);
  assert.equal(presentation()?.mood, "listening", "native PCM → session bridge → actual behavior runtime produces the listening face");
  assert.equal(presentation().gesture, "hold"); assert.equal(presentation().presentationOnly, true);
  assert.equal(fixture.behaviorEngine.getState().metrics.requests, beforeDecisions, "frame summaries do not call Decisions");
  assert.equal(fixture.behaviorHeadCalls.length, 0, "the reaction never reaches the physical head executor");
  assert.ok(sentTypes.every((type) => type === "input_audio_buffer.append"), "audio capture continues without any unsolicited voice response");
  await wait(601); assert.equal(presentation()?.mood, "attentive", "the short accent returns to the current listening pose");

  await opportunity();
  assert.notEqual(presentation()?.mood, "listening", "a fast second pause respects the cooldown");
  await wait(3_000); await opportunity();
  assert.equal(presentation()?.mood, "listening");
  events.publishBehaviorEvent({ type: "interrupt", reason: "voice-emergency-kws", sessionId: service.sessionId });
  assert.equal(presentation(), null, "STOP immediately removes the accent");
  await feed(0.001, 5); assert.notEqual(presentation()?.mood, "listening", "packets after STOP cannot revive the cue");

  for (const [name, block, release] of [
    ["Reduce Motion", () => fixture.setReducedMotion(true), () => fixture.setReducedMotion(false)],
    ["background", () => fixture.setAppState("background"), () => fixture.setAppState("active")],
    ["route focus", () => fixture.setMainScreenFocused(false), () => fixture.setMainScreenFocused(true)],
    ["sleep", () => user.setState({ robotSleeping: true }), () => user.setState({ robotSleeping: false })],
    ["motion", () => fixture.setRobotRuntimeState({ motionActive: true }), () => fixture.setRobotRuntimeState({ motionActive: false })],
    ["adaptive off", () => runtime.updateBehaviorSettings({ mode: "off" }), () => runtime.updateBehaviorSettings({ mode: "active" })],
    ["game", () => events.publishBehaviorEvent({ type: "game-command", action: "start", sessionId: service.sessionId }), () => events.publishBehaviorEvent({ type: "game-command", action: "stop", sessionId: service.sessionId })],
    ["assistant output", () => { service.playbackActive = true; conversation.setState({ isSpeaking: true }); }, () => { service.playbackActive = false; conversation.setState({ isSpeaking: false }); }],
  ]) {
    await beginTurn(); await wait(6_100); await opportunity();
    assert.equal(presentation()?.mood, "listening", `${name} fixture starts with a live cue`);
    block(); assert.notEqual(presentation()?.mood, "listening", `${name} clears the current cue`);
    await opportunity(); assert.notEqual(presentation()?.mood, "listening", `${name} blocks new cues`);
    release(); await feed(0.001, 4); assert.notEqual(presentation()?.mood, "listening", `${name} cannot revive buffered evidence`);
  }

  await beginTurn(); await wait(6_100); await opportunity();
  assert.equal(presentation()?.mood, "listening");
  await service.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  assert.notEqual(presentation()?.mood, "listening", "speech-end yields immediately to processing");
  await opportunity(); assert.notEqual(presentation()?.mood, "listening");
  conversation.setState({ isProcessing: false });
  events.endBehaviorSession(service.sessionId);
  await opportunity(); assert.notEqual(presentation()?.mood, "listening", "an ended session refuses remaining capture packets");
  assert.equal(fixture.behaviorHeadCalls.length, 0);
  assert.equal(fixture.externalBridgeCalls.length, 0);
} finally {
  fixture?.uninstallRuntime(); fixture?.behaviorEngine.dispose();
  Object.defineProperty(globalThis, "performance", original.performance);
  Object.assign(globalThis, { setTimeout: original.setTimeout, clearTimeout: original.clearTimeout,
    setInterval: original.setInterval, clearInterval: original.clearInterval });
}
console.log("Listening feedback runtime: actual PCM path, quiet return, no speech/motor/API effects, STOP and lifecycle guards PASS");
