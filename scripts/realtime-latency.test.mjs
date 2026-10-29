import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { summarize, soundBounds } from "./voice-latency-replay.mjs";
import { readDiagnosticEntries, buildLatencyReport } from "./voice-latency-report.mjs";

const { createRealtimeLatencyTracker } = loadTypeScript("src/voice/realtime-latency.ts");
const records = [];
const trace = createRealtimeLatencyTracker((event, fields) => records.push({ event, fields }));
function frame(sequence, start, rms = 0.04) {
  return { sequence, captureStartMs: start, captureDurationMs: 20, rms };
}
trace.capture(frame(1, 1000), 1024, 0.4, true);
trace.speechStarted(1100, false);
trace.capture(frame(2, 2000), 2026, 0.6, true);
trace.speechStopped(3020);
trace.responseCreated("a", 3050);
trace.firstPacket("stale", () => 3100);
trace.firstPacket("a", () => 3200);
trace.enqueued("stale", () => 3202);
trace.enqueued("a", () => 3204);
trace.enqueued("a", () => 3210);
assert.equal(records.length, 1, "one result per first packet, no per-frame persistence");
assert.equal(records[0].fields.activityEndToServerStopMs, 1000);
assert.equal(records[0].fields.activityEndToFirstPacketMs, 1180);
assert.equal(records[0].fields.serverStopToFirstPacketMs, 180);
assert.equal(records[0].fields.firstPacketToEnqueueMs, 4);
trace.playbackStarted("a", { renderStartMs: 3210, estimatedAudibleStartMs: 3260, outputLatencyMs: 30, ioBufferDurationMs: 20 });
assert.equal(records.at(-1).fields.activityEndToEstimatedAudibleMs, 1240);
assert.match(records.at(-1).fields.evidence, /requires external acoustic verification/);
trace.summary();
assert.equal(records.at(-1).fields.jsUplinkMedianMs, 0.5);
assert.equal(records.at(-1).fields.captureToJsMedianMs, 25);
assert.equal(records.at(-1).fields.captureToJsP95Ms, 26);

trace.speechStarted(4000, true);
trace.capture(frame(3, 3990), 4011, 0.3, false);
trace.speechStopped(5000);
trace.responseCreated("b", 5100);
trace.firstPacket("b", () => 5200);
trace.enqueued("b", () => 5202);
assert.equal(records.at(-1).fields.activityEndToFirstPacketMs, null, "speaker echo is not a speech-end reference");
assert.equal(records.at(-1).fields.serverStopToFirstPacketMs, 200);
trace.speechStarted(null, false);
const before = records.length;
trace.responseCreated("unsupported", 6000);
trace.firstPacket("unsupported", () => 6100);
trace.enqueued("unsupported", () => 6101);
assert.equal(records.length, before, "no mixed-clock or missing-clock measurements");
trace.reset();
trace.enqueued("a", () => 9000);
trace.playbackStarted("a", { renderStartMs: 9000, estimatedAudibleStartMs: 9020 });
assert.equal(records.length, before, "old session callbacks cannot produce a result after reset");
trace.summary();
assert.equal(records.at(-1).fields.jsUplinkN, 0);

assert.deepEqual(summarize([4, 1, 3, 2, null, NaN]), { n: 4, medianMs: 2.5, p95Ms: 4 });
assert.deepEqual(summarize([]), { n: 0, medianMs: null, p95Ms: null });
const pcm = Buffer.alloc(24000 * 2);
pcm.writeInt16LE(1000, 4800 * 2); pcm.writeInt16LE(-1000, 12000 * 2);
assert.deepEqual(soundBounds(pcm), { startMs: 200, endMs: 12001 / 24, thresholdPcm16: 100 });
const old = [{ id: 1, timestamp: "2026-10-26T00:00:00Z", category: "latency", event: "budget-turn-latency", details: { commitToPlayingMs: 9000 } }];
const current = [{ id: 2, timestamp: "2026-10-28T00:00:01Z", category: "latency", event: "budget-turn-latency",
  details: { segmentEndToPlayingEstimateMs: null, commitToPlayingMs: 1200, recognizedText: "PRIVATE", apiKey: "PRIVATE" } }];
const journal = Buffer.from(`binary-prefix${JSON.stringify(current)}unused-tail${JSON.stringify(old)}`);
assert.deepEqual(readDiagnosticEntries(journal), current, "unused MMKV tail must not replace newer diagnostic entries");
const report = buildLatencyReport(readDiagnosticEntries(journal), { since: Date.parse("2026-10-28T00:00:00Z"), variant: "A" });
assert.deepEqual(report.summary.budgetCommitToPlaying, { n: 1, medianMs: 1200, p95Ms: 1200 });
assert.equal(report.summary.incompleteBudgetEndReferences, 1);
assert.equal(report.summary.budgetSegmentEndToPlayingEstimate.n, 0, "missing end references are not zero-latency successes");
assert.ok(!JSON.stringify(report).includes("PRIVATE"), "the latency report excludes transcripts and credentials");
const streamed = buildLatencyReport([{ timestamp: "2026-10-28T00:00:01Z", category: "latency", event: "budget-speech-stream-latency",
  details: { requestToRenderNoticeMs: 180, downloadCompleteAtRender: false, input: "PRIVATE", apiKey: "PRIVATE" } }],
{ since: Date.parse("2026-10-28T00:00:00Z"), variant: "stream" });
assert.equal(streamed.summary.budgetSpeechRequestToRenderNotice.medianMs, 180);
assert.equal(streamed.summary.budgetSpeechRenderedBeforeDownloadEnd, 1);
assert.ok(!JSON.stringify(streamed).includes("PRIVATE"));
const attention = buildLatencyReport([{ timestamp: "2026-10-28T00:00:01Z", category: "latency", event: "input-attention-presentation",
  details: { mode: "budget", receiptToPresentationEffectMs: 4, recognizedText: "PRIVATE" } }],
{ since: Date.parse("2026-10-28T00:00:00Z"), variant: "attention" });
assert.deepEqual(attention.summary.budgetInputReceiptToPresentationEffect, { n: 1, medianMs: 4, p95Ms: 4 });
assert.equal(attention.summary.pcmInputReceiptToPresentationEffect.n, 0);
assert.ok(attention.limitations.some(text => text.includes("React effect")));
assert.ok(!JSON.stringify(attention).includes("PRIVATE"));
const textLog = Buffer.from('LOOI diagnostic log\n2026-10-28T00:00:01Z | latency | budget-input-attention | receiptToStateMs=4.2 | sessionId="test"');
assert.equal(buildLatencyReport(readDiagnosticEntries(textLog), { since: Date.parse("2026-10-28T00:00:00Z"), variant: "A" })
  .summary.budgetInputReceiptToStateRequest.medianMs, 4.2);
console.log("Realtime latency: native-clock boundaries, stale/missing signals, echo exclusion and distribution checks passed");
