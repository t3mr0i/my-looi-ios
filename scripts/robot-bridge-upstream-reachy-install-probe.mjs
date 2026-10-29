import { setTimeout as delay } from "node:timers/promises";
import { rm } from "node:fs/promises";
import { createAppCatalog } from "../services/robot-bridge/app-catalog.mjs";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";

// Reproduces the real App Store installation path for the pinned upstream
// Reachy clock app. This can download the full SDK/media dependency tree.
const spaceId = "pollen-robotics/reachy_mini_clock";
const revision = "e8b4a4ea44116d881b940b5ea210fe5e69e162e4";
const rootDir = process.env.LOOI_REACHY_ACCEPTANCE_FULL_ROOT
  ?? "/private/tmp/looi-upstream-reachy-acceptance-full-runner";
const keepInstalledEnvironment = process.env.LOOI_KEEP_REACHY_INSTALL === "1";
const catalog = createAppCatalog({ timeoutMs: 20_000, cacheMs: 0 });
const runner = createAppRunner({
  rootDir,
  catalog,
  mediaBackend: "no_media",
  commandTimeoutMs: 15 * 60_000,
});

let result;
try {
  await runner.ready;
  const job = await runner.install(spaceId, { revision });
  const deadline = Date.now() + 15 * 60_000;
  let current = job;
  let reportedPhase = null;
  while (current.state === "running" && Date.now() < deadline) {
    if (current.phase !== reportedPhase) {
      reportedPhase = current.phase;
      console.error(`Reachy Store install phase: ${reportedPhase}`);
    }
    await delay(500);
    current = runner.getJob(job.id) ?? current;
  }
  if (current.state === "running") {
    result = { status: "TIMEOUT", phase: current.phase };
  } else {
    result = { status: current.state === "complete" ? "PASS" : "FAIL", phase: current.phase, error: current.error ?? null };
  }
} catch (error) {
  result = { status: "FAIL", error: error instanceof Error ? error.message : String(error) };
} finally {
  await runner.close();
  // Keep a successful install only when explicitly requested so it can be used
  // for a separate full-runtime acceptance before cleanup.
  if (!(keepInstalledEnvironment && result?.status === "PASS")) {
    await rm(rootDir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ spaceId, revision, rootDirKept: keepInstalledEnvironment && result?.status === "PASS" ? rootDir : null, result }, null, 2));
if (result?.status !== "PASS") process.exitCode = 1;
