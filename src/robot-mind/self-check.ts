/**
 * A passive self-check for the things the robot mind assumes about the real
 * device and that no offline test can show. It only observes: nothing moves,
 * nothing is spoken and no model is called. Each line is a fact measured on
 * this robot and phone, written to the diagnostic log so it can be exported.
 */
export type SelfCheckStatus = "ok" | "problem" | "unknown";
export interface SelfCheckLine {
  id: "base" | "sensor_cadence" | "surface" | "stop_decoder" | "keyword_stop" | "speech_clips" | "camera";
  status: SelfCheckStatus;
  /** Short English fact for the log and the screen; numbers are measurements. */
  detail: string;
  values: Record<string, string | number | boolean | null>;
}
export interface SelfCheckReport { at: number; durationMs: number; lines: SelfCheckLine[]; ok: boolean }

export interface SelfCheckDeps {
  now(): number;
  wait(ms: number): Promise<void>;
  robot(): {
    connected: boolean; driveControlReady: boolean; lastSensorFrameAt: number | null;
    /** Sensor notifications received on this connection, by frame type ("01" edge sensors, "0e", "02", ...). */
    frameCounts: Record<string, number>;
    cliff: Record<string, boolean> | null; obstacleNear: boolean | null;
  };
  /** The longest gap between sensor frames idle autonomy accepts before it treats the surface as unknown. */
  sensorFreshMs: number;
  microphoneLive(): boolean;
  /** Prepares the local STOP decoder exactly as a wheel action would; false when it cannot be made ready. */
  prepareStopDecoder(): Promise<boolean>;
  keywordStopAvailable(): boolean;
  clipCache: { read(key: string): Promise<Uint8Array | null>; write(key: string, audio: Uint8Array): Promise<void> };
  camera(): { enabled: boolean; looking: boolean; faces: number };
  record(report: SelfCheckReport): void;
}

export const SELF_CHECK_OBSERVE_MS = 30_000;
const SAMPLE_MS = 100;

export async function runRobotMindSelfCheck(deps: SelfCheckDeps, observeMs = SELF_CHECK_OBSERVE_MS): Promise<SelfCheckReport> {
  const startedAt = deps.now();
  const lines: SelfCheckLine[] = [];
  const first = deps.robot();

  lines.push(first.connected && first.driveControlReady
    ? { id: "base", status: "ok", detail: "wheel base connected and ready", values: { connected: true, driveControlReady: true } }
    : { id: "base", status: "problem", detail: first.connected ? "wheel base connected but the drive channel is not ready" : "wheel base not connected",
      values: { connected: first.connected, driveControlReady: first.driveControlReady } });

  // Does this robot report its sensors while standing still, and which ones? No source has
  // established whether FED9 frames are periodic or only sent on change; this measures it.
  // Frames are counted exactly; gaps are seen at the sampling resolution.
  let arrivals = 0, maxGapMs = 0, lastFrameAt = first.lastSensorFrameAt, lastChangeAt = startedAt;
  let lastCounts = first.frameCounts;
  if (first.connected) {
    while (deps.now() - startedAt < observeMs) {
      await deps.wait(SAMPLE_MS);
      const state = deps.robot();
      if (!state.connected) break;
      lastCounts = state.frameCounts;
      if (state.lastSensorFrameAt !== null && state.lastSensorFrameAt !== lastFrameAt) {
        if (arrivals > 0 || lastFrameAt !== null) maxGapMs = Math.max(maxGapMs, deps.now() - lastChangeAt);
        arrivals += 1; lastFrameAt = state.lastSensorFrameAt; lastChangeAt = deps.now();
      }
    }
    maxGapMs = Math.max(maxGapMs, deps.now() - lastChangeAt);
  }
  const observedMs = deps.now() - startedAt;
  const byType: Record<string, number> = {};
  for (const [type, count] of Object.entries(lastCounts)) {
    const delta = count - (first.frameCounts[type] ?? 0);
    if (delta > 0) byType[type] = delta;
  }
  const frames = Object.values(byType).reduce((sum, count) => sum + count, 0);
  const edgeFrames = byType["01"] ?? 0;
  const types = Object.keys(byType).sort().map((type) => `${type}:${byType[type]}`).join(",") || "none";
  const seconds = Math.round(observedMs / 1000);
  const cadenceValues = { frames, edgeFrames, types, maxGapMs: frames ? Math.round(maxGapMs) : null, limitMs: deps.sensorFreshMs, sampleMs: SAMPLE_MS };
  if (!first.connected) {
    lines.push({ id: "sensor_cadence", status: "unknown", detail: "not measured without the wheel base",
      values: { frames: 0, edgeFrames: 0, types: "none", maxGapMs: null, limitMs: deps.sensorFreshMs, sampleMs: SAMPLE_MS } });
  } else if (frames === 0) {
    lines.push({ id: "sensor_cadence", status: "problem",
      detail: `with the wheels parked, the robot sent no sensor frame in ${seconds} s; idle autonomy needs one within ${deps.sensorFreshMs} ms, so it will not move the wheels`,
      values: cadenceValues });
  } else {
    const fits = maxGapMs <= deps.sensorFreshMs;
    lines.push({ id: "sensor_cadence", status: fits ? "ok" : "problem",
      detail: `with the wheels parked, the robot sent ${frames} sensor frames in ${seconds} s (${edgeFrames} from the edge sensors; by type ${types}), longest gap ${Math.round(maxGapMs)} ms (autonomy limit ${deps.sensorFreshMs} ms)${fits ? "" : "; idle autonomy will often refuse to move the wheels"}`,
      values: cadenceValues });
  }

  const last = deps.robot();
  const cliffValues = last.cliff ? Object.values(last.cliff) : [];
  lines.push(!last.cliff
    ? { id: "surface", status: "unknown", detail: "no edge sensor reading yet", values: { obstacleNear: last.obstacleNear } }
    : { id: "surface", status: cliffValues.every(Boolean) ? "ok" : "problem",
      detail: cliffValues.every(Boolean) ? "all four edge sensors see ground" : "an edge sensor sees no ground (at an edge, or lifted)",
      values: { ...last.cliff, obstacleNear: last.obstacleNear } });

  const microphone = deps.microphoneLive();
  let decoderReady = false;
  if (microphone) { try { decoderReady = await deps.prepareStopDecoder(); } catch { decoderReady = false; } }
  lines.push({ id: "stop_decoder", status: microphone && decoderReady ? "ok" : "problem",
    detail: !microphone ? "microphone audio is not flowing; idle autonomy keeps the wheels still"
      : decoderReady ? "local STOP decoder can be armed for a wheel action" : "local STOP decoder could not be prepared; idle autonomy keeps the wheels still",
    values: { microphoneLive: microphone, decoderReady } });

  const keyword = deps.keywordStopAvailable();
  lines.push({ id: "keyword_stop", status: keyword ? "ok" : "unknown",
    detail: keyword ? "keyword STOP is available between movements" : "keyword STOP is not available; between movements STOP is only caught by the voice guard",
    values: { available: keyword } });

  // Does a stored speech clip survive a round trip on this phone?
  const key = `self-check:${startedAt}`;
  const sample = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 250, 0, 9]);
  let clipOk = false;
  try {
    await deps.clipCache.write(key, sample);
    const back = await deps.clipCache.read(key);
    clipOk = !!back && back.length === sample.length && back.every((value, index) => value === sample[index]);
  } catch { clipOk = false; }
  lines.push({ id: "speech_clips", status: clipOk ? "ok" : "problem",
    detail: clipOk ? "speech clips can be stored and read back" : "speech clips cannot be stored; fixed lines will be synthesized every time",
    values: { roundTrip: clipOk } });

  const camera = deps.camera();
  lines.push({ id: "camera", status: camera.enabled ? "ok" : "unknown",
    detail: !camera.enabled ? "camera attention is off; LOOI will look around but cannot find people"
      : camera.looking ? `camera is looking and sees ${camera.faces} face(s)` : "camera attention is on and currently not looking",
    values: { enabled: camera.enabled, looking: camera.looking, faces: camera.faces } });

  const report: SelfCheckReport = { at: startedAt, durationMs: deps.now() - startedAt, lines, ok: lines.every((line) => line.status !== "problem") };
  try { deps.record(report); } catch { /* The report is still returned to the screen. */ }
  return report;
}

const MARK: Record<SelfCheckStatus, string> = { ok: "✓", problem: "✗", unknown: "?" };
export function formatSelfCheckReport(report: SelfCheckReport): string {
  return report.lines.map((line) => `${MARK[line.status]} ${line.detail}`).join("\n");
}
