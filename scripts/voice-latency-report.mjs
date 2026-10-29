#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { summarize } from "./voice-latency-replay.mjs";

export function readDiagnosticEntries(bytes) {
  const text = bytes.toString("utf8");
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.entries)) return json.entries;
  } catch { /* An exported text log or MMKV diagnostic copy follows. */ }
  if (text.startsWith("LOOI diagnostic log")) {
    return text.split("\n").flatMap((line) => {
      const match = line.match(/^(\S+) \| latency \| ([^|]+)(.*)$/);
      if (!match) return [];
      const details = {};
      for (const field of match[3].matchAll(/\| ([A-Za-z][A-Za-z0-9]*)=(null|-?\d+(?:\.\d+)?|true|false|"(?:[^"\\]|\\.)*")/g)) {
        details[field[1]] = JSON.parse(field[2]);
      }
      return [{ timestamp: match[1], category: "latency", event: match[2].trim(), details }];
    });
  }
  // A copied MMKV journal may contain older serialized values and unused tail
  // bytes. Select the complete diagnostic array with the highest event id,
  // rather than assuming that the last printable JSON is the active value.
  let latest = [], offset = 0, highestId = -Infinity;
  while ((offset = text.indexOf('[{"id":', offset)) !== -1) {
    let depth = 0, quoted = false, escaped = false, end = offset;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "[") depth++;
      else if (char === "]" && --depth === 0) { end++; break; }
    }
    try {
      const candidate = JSON.parse(text.slice(offset, end));
      const id = candidate.at(-1)?.id;
      if (Number.isFinite(id) && id > highestId) { highestId = id; latest = candidate; }
    } catch { /* Ignore truncated journal candidates. */ }
    offset = Math.max(offset + 1, end);
  }
  if (!latest.length) throw new Error("No diagnostic entries found; use the app's diagnostic export or its diagnostic MMKV file");
  return latest;
}

export function buildLatencyReport(entries, { since, until = Infinity, variant, warmupTurns = 0 }) {
  if (!Number.isFinite(since) || !variant) throw new Error("A measurement start and variant are required");
  if (!Number.isInteger(warmupTurns) || warmupTurns < 0) throw new Error("Invalid warmup count");
  const records = entries.filter((entry) => entry.category === "latency"
    && /^(input-attention-presentation|budget-(turn-latency|input-attention|speech-stream-latency)|pcm-(turn-first-packet-latency|turn-render-latency|local-pipeline-latency))$/.test(entry.event)
    && Date.parse(entry.timestamp) >= since && Date.parse(entry.timestamp) <= until)
    .map((entry) => ({ timestamp: entry.timestamp, event: entry.event,
      sessionId: typeof entry.details?.sessionId === "string" ? entry.details.sessionId : null,
      ...(entry.event === "input-attention-presentation" ? {
        mode: ["budget", "realtime_pcm"].includes(entry.details?.mode) ? entry.details.mode : null,
      } : {}),
      ...(entry.event === "budget-speech-stream-latency" ? {
        renderedBeforeDownloadEnd: typeof entry.details?.downloadCompleteAtRender === "boolean" ? !entry.details.downloadCompleteAtRender : null,
      } : {}),
      metrics: Object.fromEntries(Object.entries(entry.details ?? {}).filter(([key, value]) =>
        /(?:Ms|N)$/.test(key) && (typeof value === "number" && Number.isFinite(value) || value === null))) }));
  const budget = records.filter((r) => r.event === "budget-turn-latency").slice(warmupTurns);
  const pcm = records.filter((r) => r.event === "pcm-turn-render-latency").slice(warmupTurns);
  const firstInput = records.filter((r) => r.event === "budget-input-attention").slice(warmupTurns);
  const speechStreams = records.filter((r) => r.event === "budget-speech-stream-latency");
  const presentations = records.filter((r) => r.event === "input-attention-presentation").slice(warmupTurns);
  return { variant, since: new Date(since).toISOString(),
    warmupTurnsExcluded: warmupTurns,
    evidence: "internal device clocks and player callbacks; no external acoustic, visible-display or motor-onset measurement",
    limitations: ["VAD segment end is mapped to JS audio receipt in Budget mode; native capture/bridge age is excluded",
      "PCM uses a local energy reference and render/route estimate, not annotated speech or microphone-measured playback",
      "Input receipt to state request excludes microphone capture and visible display latency",
      "Input presentation ends at a React effect, before any proven compositor or visible-pixel boundary",
      "Small pilot p95 is descriptive; incomplete measurements are counted separately"],
    summary: {
      budgetSegmentEndToPlayingEstimate: summarize(budget.map((r) => r.metrics.segmentEndToPlayingEstimateMs)),
      budgetEndpointToCommit: summarize(budget.map((r) => r.metrics.endpointToCommitMs)),
      budgetCommitToPlaying: summarize(budget.map((r) => r.metrics.commitToPlayingMs)),
      pcmActivityEndToEstimatedAudible: summarize(pcm.map((r) => r.metrics.activityEndToEstimatedAudibleMs)),
      budgetInputReceiptToStateRequest: summarize(firstInput.map((r) => r.metrics.receiptToStateMs)),
      budgetInputReceiptToPresentationEffect: summarize(presentations.filter(r => r.mode === "budget").map(r => r.metrics.receiptToPresentationEffectMs)),
      pcmInputReceiptToPresentationEffect: summarize(presentations.filter(r => r.mode === "realtime_pcm").map(r => r.metrics.receiptToPresentationEffectMs)),
      budgetSpeechRequestToRenderNotice: summarize(speechStreams.map((r) => r.metrics.requestToRenderNoticeMs)),
      budgetSpeechRenderedBeforeDownloadEnd: speechStreams.filter((r) => r.renderedBeforeDownloadEnd === true).length,
      incompleteBudgetEndReferences: budget.filter((r) => r.metrics.segmentEndToPlayingEstimateMs == null).length,
    }, records };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const get = (key) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
    if (!get("--input") || !get("--output")) throw new Error("--input FILE --since ISO_DATE --variant A|B --output FILE required");
    const report = buildLatencyReport(readDiagnosticEntries(fs.readFileSync(get("--input"))), {
      since: Date.parse(get("--since")), until: get("--until") ? Date.parse(get("--until")) : Infinity, variant: get("--variant"),
      warmupTurns: get("--warmup-turns") ? Number(get("--warmup-turns")) : 0,
    });
    fs.mkdirSync(path.dirname(path.resolve(get("--output"))), { recursive: true });
    fs.writeFileSync(get("--output"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ records: report.records.length, ...report.summary }));
    if (!report.records.length) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
