import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const api = loadTypeScript("src/robot-mind/self-check.ts");

/** A fake device whose sensor frames arrive at the given times (ms after start). */
function device({ connected = true, driveControlReady = true, frameTimes = [], frameType = () => "01", earlierFrames = { "01": 3, "11": 1 }, cliff = { frontLeft: true, frontRight: true, rearLeft: true, rearRight: true },
  obstacleNear = false, microphone = true, decoder = true, decoderThrows = false, keyword = true, storage = "ok", camera = { enabled: true, looking: true, faces: 1 }, disconnectAt = null } = {}) {
  let now = 1_000_000;
  const start = now;
  const clips = new Map();
  const recorded = [];
  let prepared = 0;
  const deps = {
    now: () => now,
    async wait(ms) { now += ms; },
    robot() {
      const elapsed = now - start;
      const arrived = frameTimes.filter((time) => time <= elapsed);
      const frameCounts = { ...earlierFrames };
      arrived.forEach((time, index) => { const type = frameType(index, time); frameCounts[type] = (frameCounts[type] ?? 0) + 1; });
      return { connected: connected && (disconnectAt === null || elapsed < disconnectAt), driveControlReady,
        lastSensorFrameAt: arrived.length ? start + arrived.at(-1) : null, frameCounts, cliff, obstacleNear };
    },
    sensorFreshMs: 6_000,
    microphoneLive: () => microphone,
    async prepareStopDecoder() { prepared += 1; if (decoderThrows) throw new Error("model missing"); return decoder; },
    keywordStopAvailable: () => keyword,
    clipCache: {
      async read(key) { if (storage === "throws") throw new Error("no space"); return storage === "corrupt" ? Uint8Array.from([1]) : clips.get(key) ?? null; },
      async write(key, audio) { if (storage !== "lost") clips.set(key, audio); },
    },
    camera: () => camera,
    record: (report) => recorded.push(report),
  };
  return { deps, recorded, get prepared() { return prepared; } };
}
const line = (report, id) => report.lines.find((item) => item.id === id);
const every = (ms, until = 30_000) => Array.from({ length: Math.floor(until / ms) }, (_, i) => (i + 1) * ms);

{
  // A healthy robot: frames every second.
  const d = device({ frameTimes: every(1_000) });
  const report = await api.runRobotMindSelfCheck(d.deps);
  assert.equal(report.ok, true, api.formatSelfCheckReport(report));
  assert.deepEqual(report.lines.map((item) => item.id), ["base", "sensor_cadence", "surface", "stop_decoder", "keyword_stop", "speech_clips", "camera"]);
  const cadence = line(report, "sensor_cadence");
  assert.equal(cadence.status, "ok");
  assert.equal(cadence.values.frames, 30, "frames are counted exactly, not inferred from samples");
  assert.equal(cadence.values.edgeFrames, 30);
  assert.equal(cadence.values.types, "01:30", "frames from before the check are not counted");
  assert.ok(cadence.values.maxGapMs <= 1_100, JSON.stringify(cadence.values));
  assert.ok(report.durationMs >= 30_000 && report.durationMs < 31_000, "observes for 30 seconds");
  assert.deepEqual(d.recorded, [report], "the report goes to the diagnostic log");
  assert.match(api.formatSelfCheckReport(report), /^✓ wheel base connected and ready\n✓ with the wheels parked, the robot sent 30 sensor frames in 30 s \(30 from the edge sensors; by type 01:30\)/u);
}
{
  // Frames about five seconds apart still fit the six-second limit. (A code comment once claimed real captures
  // showed this spacing; no capture backs it, which is why the check measures it.)
  const report = await api.runRobotMindSelfCheck(device({ frameTimes: every(5_000) }).deps);
  assert.equal(line(report, "sensor_cadence").status, "ok");
  assert.ok(line(report, "sensor_cadence").values.maxGapMs <= 5_100);
}
{
  // Frames only every eight seconds: idle autonomy would often refuse the wheels, and the check says so.
  const report = await api.runRobotMindSelfCheck(device({ frameTimes: every(8_000) }).deps);
  const cadence = line(report, "sensor_cadence");
  assert.equal(cadence.status, "problem");
  assert.ok(cadence.values.maxGapMs >= 7_900);
  assert.match(cadence.detail, /often refuse to move the wheels/u);
  assert.equal(report.ok, false);
}
{
  // Frames that stop early: the silence at the end counts as a gap.
  const report = await api.runRobotMindSelfCheck(device({ frameTimes: [1_000, 2_000, 3_000] }).deps);
  assert.equal(line(report, "sensor_cadence").status, "problem");
  assert.ok(line(report, "sensor_cadence").values.maxGapMs >= 26_000);
}
{
  // No frames at all, and a robot that only reports on change.
  const silent = await api.runRobotMindSelfCheck(device({ frameTimes: [] }).deps);
  assert.equal(line(silent, "sensor_cadence").status, "problem");
  assert.match(line(silent, "sensor_cadence").detail, /sent no sensor frame in 30 s; idle autonomy needs one within 6000 ms/u);
  assert.equal(line(silent, "sensor_cadence").values.frames, 0);
}
{
  // Several frames in one sample are all counted, and the line names which types arrived: a robot that only
  // sends motion frames at rest shows zero edge-sensor frames.
  const burst = await api.runRobotMindSelfCheck(device({ frameTimes: [...every(1_000), ...every(1_000)].sort((a, b) => a - b),
    frameType: (index) => (index % 2 ? "0e" : "02") }).deps);
  const cadence = line(burst, "sensor_cadence");
  assert.equal(cadence.values.frames, 60);
  assert.equal(cadence.values.edgeFrames, 0);
  assert.equal(cadence.values.types, "02:30,0e:30");
  assert.match(cadence.detail, /0 from the edge sensors/u);
}
{
  // Without the base nothing is measured, and it takes no 30 seconds.
  const d = device({ connected: false });
  const report = await api.runRobotMindSelfCheck(d.deps);
  assert.equal(line(report, "base").status, "problem");
  assert.equal(line(report, "sensor_cadence").status, "unknown");
  assert.ok(report.durationMs < 1_000);
  const notReady = await api.runRobotMindSelfCheck(device({ driveControlReady: false, frameTimes: every(1_000) }).deps);
  assert.match(line(notReady, "base").detail, /drive channel is not ready/u);
  const dropped = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), disconnectAt: 5_000 }).deps);
  assert.ok(dropped.durationMs < 6_000, "a link that drops ends the observation");
}
{
  // STOP decoder: the microphone must be live, and a decoder that cannot be prepared is a problem, not a crash.
  const noMic = device({ frameTimes: every(1_000), microphone: false });
  const report = await api.runRobotMindSelfCheck(noMic.deps);
  assert.equal(line(report, "stop_decoder").status, "problem");
  assert.equal(noMic.prepared, 0, "the decoder is not prepared without audio");
  for (const options of [{ decoder: false }, { decoderThrows: true }]) {
    const failed = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), ...options }).deps);
    assert.equal(line(failed, "stop_decoder").status, "problem");
    assert.match(line(failed, "stop_decoder").detail, /keeps the wheels still/u);
  }
  const noKeyword = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), keyword: false }).deps);
  assert.equal(line(noKeyword, "keyword_stop").status, "unknown", "a missing keyword STOP is a limitation, not a failure");
  assert.equal(noKeyword.ok, true);
}
{
  // Surface, clip storage and camera.
  const edge = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), cliff: { frontLeft: false, frontRight: true, rearLeft: true, rearRight: true } }).deps);
  assert.equal(line(edge, "surface").status, "problem");
  const noReading = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), cliff: null }).deps);
  assert.equal(line(noReading, "surface").status, "unknown");
  for (const storage of ["lost", "corrupt", "throws"]) {
    const report = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), storage }).deps);
    assert.equal(line(report, "speech_clips").status, "problem", storage);
  }
  const cameraOff = await api.runRobotMindSelfCheck(device({ frameTimes: every(1_000), camera: { enabled: false, looking: false, faces: 0 } }).deps);
  assert.equal(line(cameraOff, "camera").status, "unknown");
  assert.match(line(cameraOff, "camera").detail, /cannot find people/u);
}

console.log("Robot mind self-check: sensor cadence, STOP decoder, clip storage and camera reporting PASS");
