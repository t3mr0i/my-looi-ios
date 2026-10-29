import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperSource = path.join(repoRoot, "modules/local-face-attention/ios/LocalObjectTrackingSession.swift");
const driverSource = path.join(repoRoot, "scripts/native/vision-object-tracking-probe.swift");
const outputPath = process.argv[2];

if (!outputPath) {
  throw new Error("Usage: node scripts/vision-object-tracking-probe.mjs <output-report.json>");
}
if (process.platform !== "darwin") {
  throw new Error("This probe requires macOS Vision and CoreVideo frameworks.");
}

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "looi-vision-object-probe-"));
try {
  const mainPath = path.join(temporaryDirectory, "main.swift");
  const moduleCachePath = path.join(temporaryDirectory, "module-cache");
  const executablePath = path.join(temporaryDirectory, "vision-object-tracking-probe");
  await fs.mkdir(moduleCachePath, { recursive: true });
  const helperStat = await fs.stat(helperSource);
  const driverStat = await fs.stat(driverSource);
  assert.ok(helperStat.size > 0 && driverStat.size > 0, "production helper and probe driver must exist");
  const [helperBytes, driverBytes] = await Promise.all([fs.readFile(helperSource), fs.readFile(driverSource)]);
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  await fs.copyFile(driverSource, mainPath);

  await execFileAsync("swiftc", [
    "-module-cache-path", moduleCachePath,
    "-framework", "Vision", "-framework", "CoreVideo", "-framework", "CoreGraphics",
    helperSource, mainPath, "-o", executablePath,
  ], { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 });
  const { stdout } = await execFileAsync(executablePath, [], { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 });
  const report = JSON.parse(stdout);
  report.metadata.sourceHashes = {
    helperPath: "modules/local-face-attention/ios/LocalObjectTrackingSession.swift",
    helperSha256: sha256(helperBytes),
    probeDriverPath: "scripts/native/vision-object-tracking-probe.swift",
    probeDriverSha256: sha256(driverBytes),
  };
  report.metadata.fixtureInterpretationNote = "The similar-distractor fixture is procedurally similar and intentionally overlapping; association metrics describe this ambiguous synthetic input and do not prove reliable identity discrimination for distinguishable real objects.";
  const acceptedStarts = report.scenarios.filter(({ start }) => start?.status === "accepted").length;
  const acceptedFrames = report.scenarios.reduce((total, scenario) => total + scenario.frames.filter(({ accepted }) => accepted === true).length, 0);
  report.measurementStatus = acceptedStarts > 0 && acceptedFrames > 0
    ? "frames-collected"
    : "no-tracking-frames-collected";
  assert.equal(report.metadata?.measurementOnly, true, "the report must remain an evaluation, not a pass claim");
  assert.equal(report.metadata?.tracker, "LocalObjectTrackingSession.start/step", "measurements must come from the production helper");
  assert.equal(report.metadata?.passClaim, "none; successful process means measurements were collected");
  assert.equal(report.scenarios?.length, 6, "all deterministic fixture scenarios must be measured");
  for (const scenario of report.scenarios) {
    assert.ok(Array.isArray(scenario.frames), `${scenario.id}: report includes per-frame observations`);
    for (const frame of scenario.frames) {
      assert.ok(typeof frame.elapsedMs === "number", `${scenario.id} frame timing is captured`);
      assert.ok("lossReason" in frame || frame.accepted === true, `${scenario.id}: each frame records acceptance or loss`);
    }
  }

  const resolvedOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await fs.writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const summary = report.scenarios.map(({ id, start, frames, postLoss }) => ({
    id, start: start.status, samples: frames.length,
    lostAt: frames.find(({ accepted }) => !accepted)?.index ?? null,
    postLoss: postLoss?.lossReason ?? null,
  }));
  process.stdout.write(`${JSON.stringify({ output: resolvedOutputPath, measurementStatus: report.measurementStatus,
    metadata: report.metadata, scenarios: summary }, null, 2)}\n`);
  if (report.measurementStatus !== "frames-collected") {
    process.stderr.write("The helper compiled and returned start results, but no accepted frame samples were collected; treat this run as inconclusive.\n");
    process.exitCode = 2;
  }
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
