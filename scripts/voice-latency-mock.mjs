#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createHarness as createBudgetHarness } from "./budget-conversation-runtime.test.mjs";
import { createRealtimeHarness } from "./realtime-turn-taking-runtime.test.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";
import { summarize } from "./voice-latency-replay.mjs";

const replayPath = "docs/research/evidence/budget-endpoint-native-replay-2026-10-28.json";
const replayBytes = fs.readFileSync(replayPath);
const replay = JSON.parse(replayBytes);
const longReplayPath = "docs/research/evidence/budget-vad-long-turn-2026-10-28.json";
const longReplayBytes = fs.readFileSync(longReplayPath);
const longReplay = JSON.parse(longReplayBytes);
const budgetDevice = JSON.parse(fs.readFileSync("docs/research/evidence/voice-latency-device-B5-2026-10-28.json"));
const deviceTiming = budgetDevice.latency.records.find((r) => r.event === "budget-turn-latency").metrics;
const budgetDelays = { sttMs: deviceTiming.sttMs, memoryMs: deviceTiming.memoryMs,
  textMs: deviceTiming.textReplyMs, speechMs: deviceTiming.speechPreparationMs };
const zeroDelays = { sttMs: 0, memoryMs: 0, textMs: 0, speechMs: 0 };
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

async function budgetTrial(fixture, delays, cancellation = null, injectEndpointHoldMs = 0) {
  const clock = new VirtualClock();
  const h = createBudgetHarness({ ttsEnabled: true, manualSpeechStart: true, globals: clock.globals() });
  if (injectEndpointHoldMs) {
    const commit = h.service.commitTurn.bind(h.service);
    h.service.commitTurn = (epoch) => clock.setTimeout(() => commit(epoch), injectEndpointHoldMs);
  }
  const queue = fixture.frames.slice();
  h.vadHandler = async () => queue.shift(); // Recorded native outputs; no imitation speech classifier.
  h.sttHandler = async (_samples, _rate, signal) => {
    await clock.delay(delays.sttMs, signal); return "Wie heißt du?";
  };
  h.dependencies["../memory/memory-service"].retrieveConversationMemories = async () => {
    await clock.delay(delays.memoryMs); return { facts: [] };
  };
  h.modelHandler = async (request) => {
    await clock.delay(delays.textMs, request.signal); return { text: "Ich bin LOOI.", model: "mock", usage: {} };
  };
  h.speechHandler = async (_text, options) => {
    await clock.delay(delays.speechMs, options.signal);
    options.onStart();
    await clock.delay(2000, options.signal);
  };
  await h.service.start();
  check(h.service.isActive && h.captureRunning, "Budget starts and receives mock microphone data");
  const startedAt = clock.now;
  let committedAt = null;
  for (const frame of fixture.frames) {
    await clock.advanceTo(startedAt + frame.audioEndMs);
    h.feeder.emit(new Array(320).fill(frame.isSpeechDetected ? 0.02 : 0), 16_000);
    await clock.flush();
    if (h.sttCalls.length) { committedAt = clock.now; break; }
  }
  const endpoint = fixture.completedSegments[0].audioEndMs;
  check(committedAt === startedAt + endpoint, fixture.fixture + ": commits at native completed segment without another timer");
  check(committedAt >= startedAt + fixture.referenceAcousticEndMs,
    "native cap must not commit while the synthetic contribution still has audio remaining");
  check(h.sttCalls.length === 1, fixture.fixture + ": one contribution, including its recorded internal pause");
  check(!h.captureRunning, "Budget releases capture before cloud processing/playback");
  if (cancellation === "processing") {
    await h.service.interruptAndListen("mock-tap");
    await clock.advanceTo(clock.now + 10_000);
    check(h.captureRunning && h.conversation.isListening, "tap restores Budget capture during pending work");
    check(h.speechCalls.length === 0 && !h.diagnosticEvents.some((e) => e[1] === "budget-turn-latency"),
      "cancelled Budget request cannot begin stale speech");
    await h.service.stop("background");
    return { fixture: fixture.fixture, cancellation, staleSpeechBlocked: true };
  }
  await clock.until(() => h.diagnosticEvents.some((e) => e[1] === "budget-turn-latency"));
  const timing = h.diagnosticEvents.find((e) => e[1] === "budget-turn-latency")[2];
  const expected = Object.values(delays).reduce((sum, v) => sum + v, 0);
  check(Math.abs(timing.commitToPlayingMs - expected) < 0.001, "Budget critical path equals injected sequential dependency delays");
  check(timing.endpointToCommitMs === 0, "Budget adds zero virtual milliseconds after endpoint");
  if (cancellation === "playback") {
    const stopCount = h.speechStopCalls;
    await h.service.interruptAndListen("mock-tap");
    check(h.speechStopCalls > stopCount && h.captureRunning, "tap stops mocked output and resumes Budget microphone");
    check(!h.conversation.isSpeaking && !h.conversation.isProcessing, "interrupted speech does not hold speaking/processing state");
  } else {
    const calls = h.vadCalls.length;
    h.feeder.emit();
    await clock.flush();
    check(h.vadCalls.length === calls && !h.captureRunning, "Budget cannot hear voice interruption while its microphone is released");
    await clock.until(() => h.captureRunning && h.conversation.isListening);
    check(!h.conversation.isSpeaking, "Budget automatically listens again after playback finishes");
  }
  await h.service.stop("background");
  return { fixture: fixture.fixture, cancellation, endpointToCommitVirtualMs: timing.endpointToCommitMs,
    commitToPlayingVirtualMs: timing.commitToPlayingMs,
    referenceAudioEndToPlayingVirtualMs: clockDifference(timing.commitToPlayingMs + endpoint - fixture.referenceAcousticEndMs),
    injectedDependencies: delays };
}
const clockDifference = (value) => Math.round(value * 1000) / 1000;

async function realtimeTrial(profile, firstPacketDelayMs, cancellation = false) {
  const clock = new VirtualClock();
  const h = createRealtimeHarness(clock.globals());
  Object.assign(h.prefs, { conversationMode: "realtime_pcm", language: "de", listeningLanguage: "de",
    realtimeTurnTaking: profile, voiceOutputGain: 1 });
  for (const [method, property] of Object.entries({ setActiveSession: "activeSessionId", setListening: "isListening",
    setSpeaking: "isSpeaking", setProcessing: "isProcessing", setUserSpeaking: "isUserSpeaking",
    setStreamingText: "streamingText", setRealtimeReadiness: "realtimeReadiness" })) {
    h.conversationState[method] = (value) => { h.conversationState[property] = value; };
  }
  const listeners = new Map();
  const emit = (name, event) => { for (const listener of listeners.get(name) ?? []) listener(event); };
  let playbackGeneration = 0, queuedPackets = 0, outputStops = 0;
  Object.assign(h.fakeAudio, {
    getMonotonicTimeMs: () => clock.now,
    addListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener); return { remove: () => listeners.get(name).delete(listener) };
    },
    beginPlayback: () => ++playbackGeneration,
    enqueuePlayback() {
      queuedPackets++;
      const generation = playbackGeneration;
      clock.setTimeout(() => emit("onPlaybackStarted", { generation, renderStartMs: clock.now,
        estimatedAudibleStartMs: clock.now + 40, outputLatencyMs: 30, ioBufferDurationMs: 10 }), 20);
    },
    stopPlayback() { outputStops++; return { playedDurationMs: 120 }; },
  });
  const service = new h.RealtimePcmConversationService();
  const starting = service.start();
  await clock.until(() => h.diagnostics.some((e) => e[1] === "pcm-openai-connected"));
  await starting;
  const session = h.pcmSockets.at(-1).sent.find((event) => event.type === "session.update").session;
  check(!h.diagnostics.some((e) => e[1] === "pcm-session-configured"), "no profile success before server acknowledgement");
  await service.handleEvent({ type: "session.updated", session });
  check(h.conversationState.realtimeReadiness === "ready", "Realtime reaches ready through mocked capture and server acknowledgement");
  const effective = h.diagnostics.find((e) => e[1] === "pcm-session-configured")[2];
  check(effective.effectiveTurnTakingProfile === profile, "server-acknowledged profile matches requested profile");
  check(session.audio.input.turn_detection.interrupt_response, "server interruption remains enabled");
  const pcm = Buffer.alloc(640); for (let i = 0; i < 320; i++) pcm.writeInt16LE(1000, i * 2);
  const captured = (sequence) => emit("onAudioData", { sequence, sampleRate: 16_000, frames: 320,
    pcm16Base64: pcm.toString("base64"), rms: 1000 / 32768,
    captureStartMs: clock.now - 20, captureDurationMs: 20, nativeEmittedAtMs: clock.now });
  captured(1);
  check(h.pcmSockets.at(-1).sent.some((event) => event.type === "input_audio_buffer.append"),
    "real capture callback forwards synthetic PCM through the mocked transport");
  await service.handleEvent({ type: "input_audio_buffer.speech_started" });
  await clock.advanceTo(clock.now + 500); captured(2);
  const activityEnd = clock.now;
  // The fixed hold comes from the actual config. Semantic endpoint time is unknown:
  // use exactly the same injected stop time to compare local handling only.
  const serverStopDelayMs = profile === "fixed" ? session.audio.input.turn_detection.silence_duration_ms : 1000;
  await clock.advanceTo(clock.now + serverStopDelayMs);
  await service.handleEvent({ type: "input_audio_buffer.speech_stopped" });
  await service.handleEvent({ type: "response.created", response: { id: "mock-response", status: "in_progress" } });
  await clock.advanceTo(clock.now + firstPacketDelayMs);
  await service.handleEvent({ type: "response.output_audio.delta", response_id: "mock-response", delta: pcm.toString("base64") });
  await clock.advanceTo(clock.now + 20);
  const render = h.diagnostics.find((e) => e[1] === "pcm-turn-render-latency")?.[2];
  check(render?.activityEndToEstimatedAudibleMs === serverStopDelayMs + firstPacketDelayMs + 60,
    "Realtime has only injected server and route delays, without Budget text/TTS stages");
  check(render.firstPacketToEnqueueMs === 0, "no virtual holding delay between first packet and native enqueue");
  if (cancellation) {
    const previousStops = outputStops;
    await service.handleEvent({ type: "input_audio_buffer.speech_started" });
    check(outputStops > previousStops, "server speech-start stops current output");
    check(h.conversationState.isListening && !h.conversationState.isSpeaking, "voice interruption resumes input state");
    const queued = queuedPackets;
    await service.handleEvent({ type: "response.output_audio.delta", response_id: "mock-response", delta: pcm.toString("base64") });
    check(queuedPackets === queued, "late packets from interrupted response cannot restart output");
  }
  await service.stop("mock-cleanup");
  check(!service.isActive, "Realtime session stopped after mock");
  return { profile, firstPacketDelayMs, serverStopDelayMs,
    semanticEndpointIsAssumed: profile === "semantic", simulatedRouteDelayMs: 60,
    activityEndToEstimatedAudibleVirtualMs: render.activityEndToEstimatedAudibleMs,
    firstPacketToEnqueueVirtualMs: render.firstPacketToEnqueueMs, cancellation,
    observedProfile: effective.effectiveTurnTakingProfile, activityEndVirtualMs: activityEnd };
}

async function microphoneFailures() {
  const clock = new VirtualClock();
  const budget = createBudgetHarness({ globals: clock.globals() });
  budget.dependencies["expo-audio"].requestRecordingPermissionsAsync = async () => ({ granted: false });
  await budget.service.start();
  check(!budget.service.isActive && budget.conversation.realtimeReadiness === "microphone-error"
    && budget.sttCalls.length === 0 && budget.speechCalls.length === 0,
    "denied Budget microphone permission cannot produce a ready conversation or answer");
  const pcm = createRealtimeHarness(clock.globals());
  const service = new pcm.RealtimePcmConversationService();
  pcm.deps["../../modules/local-realtime-audio-capture/realtime-pcm"].startPcmCapture = async () => { throw new Error("Mock capture failure"); };
  const starting = service.start();
  await clock.until(() => pcm.diagnostics.some((e) => e[1] === "pcm-openai-connected"));
  await starting;
  const session = pcm.pcmSockets.at(-1).sent.find((e) => e.type === "session.update").session;
  await service.handleEvent({ type: "session.updated", session });
  await clock.flush();
  check(pcm.diagnostics.some((e) => e[1] === "pcm-capture-start-failed"), "Realtime records native capture failure");
  check(!pcm.diagnostics.some((e) => e[1] === "pcm-readiness-ready"), "failed Realtime capture cannot claim ready");
  await service.stop("mock-cleanup");
  return { budgetPermissionDenial: "passed", realtimeCaptureFailure: "passed" };
}

const budget = [];
for (const fixture of [...replay.results, longReplay.results.find((r) => r.maxSpeechDurationSeconds === 20)]) {
  budget.push(await budgetTrial(fixture, zeroDelays));
  budget.push(await budgetTrial(fixture, budgetDelays));
}
const budgetCancellation = [await budgetTrial(replay.results[0], budgetDelays, "processing"),
  await budgetTrial(replay.results[0], budgetDelays, "playback")];
await assert.rejects(() => budgetTrial(replay.results[0], zeroDelays, null, 800), /commits at native completed segment/);
check(true, "the oracle rejects a deliberately reintroduced 800ms endpoint hold");
await assert.rejects(() => budgetTrial(longReplay.results.find((r) => r.maxSpeechDurationSeconds === 5), zeroDelays), /native cap must not commit/);
check(true, "the oracle rejects the native five-second cap splitting the long contribution");
const failureChecks = await microphoneFailures();
const realtime = [];
for (const profile of ["fixed", "semantic"]) for (const delay of [250, 500, 1000, 2000]) {
  realtime.push(await realtimeTrial(profile, delay, delay === 500));
}
const report = { kind: "offline runtime simulation, NOT a device or cloud benchmark", createdAt: new Date().toISOString(),
  requestedByUser: "du kannst es mocken", checks,
  actualCode: Object.fromEntries(["src/voice/budget-conversation.ts", "src/voice/realtime-pcm-conversation.ts",
    "src/voice/realtime-config.ts", "src/voice/realtime-latency.ts"].map((file) =>
    [file, { sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }])),
  replaySource: { path: replayPath, sha256: crypto.createHash("sha256").update(replayBytes).digest("hex"),
    origin: replay.platform, fixtures: replay.results.map((r) => r.fixture) },
  longReplaySource: { path: longReplayPath, sha256: crypto.createHash("sha256").update(longReplayBytes).digest("hex"),
    origin: longReplay.platform },
  assumptions: ["All dependency delays use virtual time; virtual zero does not mean zero CPU time",
    "Four Budget stage delays are replayed from ONE B5 pilot; simulated repetition is not a new device distribution; capture-stop and other CPU overhead are excluded",
    "Realtime packet delays 250/500/1000/2000ms are sensitivity inputs, not predictions or measurements",
    "Semantic endpoint delay is deliberately injected as 1000ms, not inferred from semantic_vad auto",
    "Both Realtime profiles receive scripted server events; semantic pause quality cannot be validated without a real server",
    "Render/route delay is injected as 60ms; no audible, display or motor reaction was measured",
    "Budget supports tap interruption here; capture is intentionally stopped during output, so voice barge-in is unavailable"],
  summary: { budgetEndpointToCommitVirtualMs: summarize(budget.map((r) => r.endpointToCommitVirtualMs)),
    budgetFourInjectedStagesVirtualMs: summarize(budget.filter((r) => r.injectedDependencies.sttMs > 0).map((r) => r.commitToPlayingVirtualMs)),
    realtimeFirstPacketToEnqueueVirtualMs: summarize(realtime.map((r) => r.firstPacketToEnqueueVirtualMs)) },
  budget, budgetCancellation, failureChecks, regressionOracle: "rejects injected 800ms endpoint hold and premature native five-second cap", realtime };
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1) {
  assert.ok(process.argv[outputIndex + 1], "--output needs a file path");
  const output = path.resolve(process.argv[outputIndex + 1]); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ kind: report.kind, checks, ...report.summary }, null, 2));
