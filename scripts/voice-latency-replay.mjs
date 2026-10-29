#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// This measures a paced synthetic microphone -> real server path on the Mac.
// It cannot establish iPhone, acoustic playback, visible-face or motor latency.
export function readPcmWave(file) {
  const wave = fs.readFileSync(file);
  assert.equal(wave.toString("ascii", 0, 4), "RIFF");
  assert.equal(wave.toString("ascii", 8, 12), "WAVE");
  let pcm, format;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const size = wave.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= wave.length, "truncated wave chunk");
    const name = wave.toString("ascii", offset, offset + 4);
    const chunk = wave.subarray(offset + 8, offset + 8 + size);
    if (name === "fmt ") format = chunk;
    if (name === "data") pcm = chunk;
    offset += 8 + size + (size % 2);
  }
  assert.ok(format?.length >= 16 && pcm?.length && pcm.length % 2 === 0);
  assert.equal(format.readUInt16LE(0), 1, "PCM16 required");
  assert.equal(format.readUInt16LE(2), 1, "mono required");
  assert.equal(format.readUInt32LE(4), 24000, "24kHz required");
  assert.equal(format.readUInt16LE(14), 16, "PCM16 required");
  return pcm;
}

export function soundBounds(pcm) {
  let first = null, last = null;
  // Explicit acoustic-energy reference, NOT a human annotation of speech.
  for (let i = 0; i < pcm.length / 2; i++) {
    if (Math.abs(pcm.readInt16LE(i * 2)) >= 100) { first ??= i; last = i; }
  }
  assert.notEqual(first, null, "fixture must contain sound");
  return { startMs: first / 24, endMs: (last + 1) / 24, thresholdPcm16: 100 };
}

export function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, medianMs: null, p95Ms: null };
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function trial({ pcm, profile, apiKey, session }) {
  const bounds = soundBounds(pcm);
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const events = [], errors = [];
  let acknowledged = false, closed = false, startedAt = null, speechEndSentAt = null;
  let effectiveTurnDetection = null;
  const timeout = setTimeout(() => socket.terminate(), 30000);
  socket.on("error", () => { errors.push("websocket-error"); });
  socket.on("close", () => { closed = true; });
  socket.on("message", (raw) => {
    const event = JSON.parse(String(raw));
    if (event.type === "error") errors.push(String(event.error?.code ?? "api-error"));
    if (event.type === "session.updated") {
      acknowledged = true;
      effectiveTurnDetection = event.session?.audio?.input?.turn_detection ?? null;
    }
    if (event.type === "input_audio_buffer.speech_started" || event.type === "input_audio_buffer.speech_stopped"
      || event.type === "response.created" || event.type === "response.output_audio.delta" || event.type === "response.done") {
      // Keep only the first audio packet per response. Never persist audio/text.
      if (event.type !== "response.output_audio.delta" || !events.some((e) => e.type === event.type && e.responseId === event.response_id)) {
        events.push({ type: event.type, atMs: performance.now(), responseId: event.response_id ?? event.response?.id ?? null,
          audioStartMs: event.audio_start_ms ?? null, audioEndMs: event.audio_end_ms ?? null });
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve); socket.once("error", () => reject(new Error("connection failed")));
      socket.once("close", () => reject(new Error("connection closed")));
    });
    socket.send(JSON.stringify({ type: "session.update", session }));
    const ackDeadline = performance.now() + 10000;
    while (!acknowledged && !closed && !errors.length && performance.now() < ackDeadline) await delay(10);
    assert.ok(acknowledged && !errors.length, `session configuration failed: ${errors.join(",")}`);
    const prefix = Buffer.alloc(24000); // 500ms before the known fixture.
    const stream = Buffer.concat([prefix, pcm, Buffer.alloc(24000 * 2 * 8)]);
    const referenceEnd = 500 + bounds.endMs;
    let maxPacingLatenessMs = 0;
    startedAt = performance.now();
    for (let offset = 0; offset < stream.length && !closed && !errors.length; offset += 960) {
      // 20ms mono PCM frames, paced as capture would be, not uploaded in a burst.
      const audioMs = offset / 48;
      await delay(startedAt + audioMs - performance.now());
      const sentAt = performance.now();
      maxPacingLatenessMs = Math.max(maxPacingLatenessMs, sentAt - startedAt - audioMs);
      if (speechEndSentAt === null && audioMs + 20 >= referenceEnd) speechEndSentAt = sentAt + referenceEnd - audioMs;
      socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: stream.subarray(offset, offset + 960).toString("base64") }));
      const completed = events.filter((e) => e.type === "response.done");
      if (audioMs > referenceEnd + 1000 && completed.some((e) => e.atMs > speechEndSentAt)) break;
    }
    const firstAudio = events.find((e) => e.type === "response.output_audio.delta" && e.atMs >= speechEndSentAt);
    const firstStop = events.find((e) => e.type === "input_audio_buffer.speech_stopped" && e.atMs >= speechEndSentAt);
    return { profile, effectiveTurnDetection, reference: { ...bounds, method: "synthetic-wave-energy-threshold" },
      endToFirstPacketMs: firstAudio ? firstAudio.atMs - speechEndSentAt : null,
      endToServerStopReceiptMs: firstStop ? firstStop.atMs - speechEndSentAt : null,
      stopReceiptToFirstPacketMs: firstStop && firstAudio ? firstAudio.atMs - firstStop.atMs : null,
      prematureResponses: events.filter((e) => e.type === "response.created" && e.atMs < speechEndSentAt).length,
      responses: events.filter((e) => e.type === "response.created").length,
      maxPacingLatenessMs, errors, events: events.map((e) => ({ ...e, atMs: e.atMs - startedAt })) };
  } finally { clearTimeout(timeout); socket.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.includes("--live"), "Explicit --live is required; uses OPENAI_API_KEY, maximum 12 trials");
  const value = (name) => args[args.indexOf(name) + 1];
  assert.ok(args.includes("--fixtures") && args.includes("--output"), "--fixtures MANIFEST.json --output REPORT.json required");
  const manifestPath = path.resolve(value("--fixtures"));
  const fixtures = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const repeat = args.includes("--repeat") ? Number(value("--repeat")) : 1;
  assert.ok(Array.isArray(fixtures) && fixtures.length > 0 && Number.isInteger(repeat) && repeat >= 1 && repeat * fixtures.length * 2 <= 12);
  assert.ok(process.env.OPENAI_API_KEY, "OPENAI_API_KEY missing");
  const load = createTypeScriptTreeLoader();
  const { buildRealtimeSessionUpdate } = load("src/voice/realtime-config.ts");
  const { DEFAULT_REALTIME_MODEL_ID } = load("src/openai/realtime-models.ts");
  const report = { measuredAt: new Date().toISOString(), platform: "Mac paced synthetic PCM -> real Realtime API",
    limitations: ["No physical iPhone/LOOI", "First network audio packet is not audible playback", "Energy threshold is not human speech annotation", "Small controlled German synthetic sample; no population p95 or human naturalness claim"],
    model: DEFAULT_REALTIME_MODEL_ID, trials: [] };
  for (let run = 0; run < repeat; run++) for (const fixture of fixtures) {
    for (const profile of run % 2 ? ["semantic", "fixed"] : ["fixed", "semantic"]) {
      const prefs = { language: "de", listeningLanguage: "de", realtimeModelId: DEFAULT_REALTIME_MODEL_ID,
        ttsVoiceId: "shimmer", ttsSpeed: 1, speechGender: "masculine", robotName: "LOOI", robotAddressAliases: [],
        robotAddressRecognitionAliases: [], realtimeTurnTaking: profile };
      const session = buildRealtimeSessionUpdate(prefs).session;
      session.max_output_tokens = 256;
      let result;
      try {
        result = await trial({ pcm: readPcmWave(path.resolve(path.dirname(manifestPath), fixture.file)), profile,
          apiKey: process.env.OPENAI_API_KEY, session });
      } catch (error) {
        // Persist a failed attempt as such; never turn authentication failure
        // into a missing row or an apparently successful latency measurement.
        report.trials.push({ fixture: fixture.id, run, profile, status: "failed",
          reason: String(error.message).slice(0, 300) });
        fs.mkdirSync(path.dirname(path.resolve(value("--output"))), { recursive: true });
        fs.writeFileSync(value("--output"), `${JSON.stringify(report, null, 2)}\n`);
        throw error;
      }
      report.trials.push({ fixture: fixture.id, run, ...result });
      report.summary = Object.fromEntries(["fixed", "semantic"].map((p) => [p, {
        endToFirstPacket: summarize(report.trials.filter((t) => t.profile === p).map((t) => t.endToFirstPacketMs)),
        prematureResponses: report.trials.filter((t) => t.profile === p).reduce((sum, t) => sum + t.prematureResponses, 0),
      }]));
      fs.mkdirSync(path.dirname(path.resolve(value("--output"))), { recursive: true });
      fs.writeFileSync(value("--output"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ fixture: fixture.id, profile, endToFirstPacketMs: result.endToFirstPacketMs,
        prematureResponses: result.prematureResponses, errors: result.errors }));
      assert.ok(!result.errors.length && result.endToFirstPacketMs !== null, "Incomplete trial; partial report saved");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
