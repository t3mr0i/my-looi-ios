import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createAppCatalog } from "../services/robot-bridge/app-catalog.mjs";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";
import { startRobotGateway } from "../services/robot-bridge/gateway.mjs";

// Runs the unmodified official Hugging Face Space through the real app catalog,
// createAppRunner hydration/start/stop lifecycle, ReachyMiniApp.__main__, and the
// local demo bridge. Full AppRunner dependency installation was attempted separately
// and stopped at a disk-full GStreamer wheel; this bounded probe reuses the existing
// isolated upstream SDK venv and installs only the app itself with --no-deps.
const acceptanceRoot = "/private/tmp/looi-upstream-reachy-acceptance";
const appRoot = path.join(acceptanceRoot, "reachy-app-runner");
const appHome = path.join(acceptanceRoot, "reachy-app-home");
const appRepository = path.join(acceptanceRoot, "reachy_mini_clock");
const appVenv = path.join(acceptanceRoot, ".venv");
const python = process.env.REACHY_UPSTREAM_PYTHON
  ?? path.join(appVenv, "bin", "python");
const spaceId = "pollen-robotics/reachy_mini_clock";
const revision = "e8b4a4ea44116d881b940b5ea210fe5e69e162e4";
const port = Number(process.env.LOOI_REACHY_ACCEPTANCE_PORT ?? 8000);
const signalingPort = Number(process.env.LOOI_REACHY_ACCEPTANCE_SIGNAL_PORT ?? 18443);
const sdkBootstrapPatch = String.raw`
_reachy_original_init = ReachyMiniApp.__init__
def _reachy_loopback_init(self, *args, **kwargs):
    app_url = getattr(type(self), "custom_app_url", None)
    if isinstance(app_url, str) and app_url.startswith("http://0.0.0.0:"):
        self.custom_app_url = app_url.replace("http://0.0.0.0:", "http://127.0.0.1:", 1)
    return _reachy_original_init(self, *args, **kwargs)
ReachyMiniApp.__init__ = _reachy_loopback_init
`;

assert.ok(path.isAbsolute(python), "Use the isolated Python 3.12 interpreter from the upstream acceptance environment");
await mkdir(acceptanceRoot, { recursive: true });
await mkdir(appHome, { recursive: true });
const catalog = createAppCatalog({ timeoutMs: 20_000, cacheMs: 0 });
const catalogItem = await catalog.resolve(spaceId, { revision });
assert.equal(catalogItem.kind, "python");
assert.equal(catalogItem.installable, true);
assert.equal(catalogItem.revision, revision);
const sourceRevision = await capture("git", ["-C", appRepository, "rev-parse", "HEAD"]);
assert.equal(sourceRevision.trim(), revision, "The local official app checkout must match the live-catalog SHA");
const dependencyVersions = await capture(python, ["-c", "import importlib.metadata as m; print(m.version('reachy-mini')); print(m.version('pytz'))"]);
assert.deepEqual(dependencyVersions.trim().split(/\r?\n/), ["1.13.0.dev0", "2025.2"], "Use the existing pinned upstream SDK and the clock's small dependency");
await capture(python, ["-m", "pip", "install", "--no-cache-dir", "--no-deps", "--no-build-isolation", "--force-reinstall", appRepository]);

await rm(appRoot, { recursive: true, force: true });
const appFolder = path.join(appRoot, createHash("sha256").update(spaceId).digest("hex"));
await mkdir(appFolder, { recursive: true });
await symlink(appVenv, path.join(appFolder, "venv"), "dir");
await writeFile(path.join(appRoot, "installed.json"), JSON.stringify({
  schemaVersion: 1,
  apps: [{ spaceId, revision, title: "Reachy Mini Clock", installedAt: new Date().toISOString() }],
}, null, 2));

const runtimeLines = [];
const runner = createAppRunner({
  rootDir: appRoot,
  catalog,
  commandTimeoutMs: 300_000,
  stopGraceMs: 3_000,
  mediaBackend: "no_media",
  getRuntimeEnv: () => ({ HOME: appHome, TMPDIR: acceptanceRoot }),
  spawnImpl: (command, args, options) => {
    let childArgs = args;
    if (args[0] === "-I" && args[1] === "-u" && args[2] === "-c") {
      childArgs = [...args];
      childArgs[3] = childArgs[3].replace(
        "runpy.run_module(module_name, run_name='__main__', alter_sys=True)",
        `${sdkBootstrapPatch}\nrunpy.run_module(module_name, run_name='__main__', alter_sys=True)`,
      );
      assert.notEqual(childArgs[3], args[3], "The test-only loopback bind guard was applied to the app process");
    }
    const isolatedOptions = {
      ...options,
      env: { ...options.env, HOME: appHome, TMPDIR: acceptanceRoot, PIP_CACHE_DIR: path.join(acceptanceRoot, "pip-cache") },
    };
    const child = spawn(command, childArgs, isolatedOptions);
    if (args[0] === "-I") {
      child.stdout?.on("data", (chunk) => runtimeLines.push(String(chunk).trimEnd()));
      child.stderr?.on("data", (chunk) => runtimeLines.push(String(chunk).trimEnd()));
    }
    return child;
  },
});

let gateway;
try {
  await runner.ready;
  assert.equal(runner.listInstalled()[0]?.spaceId, spaceId, "AppRunner must hydrate the app entry point from its installed registry");

  gateway = await startRobotGateway({
    host: "127.0.0.1",
    port,
    demo: true,
    allowApproximation: true,
    signalingPort,
    appCatalog: catalog,
    appRunner: runner,
    centralConfig: { enabled: false, protocols: [] },
    iceServers: [],
  });
  const initial = await readBridgeState();
  const initialCommandId = initial.lastResult?.commandId ?? 0;

  const started = await runner.start(spaceId);
  assert.ok(["starting", "running"].includes(started.state), `Unexpected runner app state: ${started.state}`);
  const appDeadline = Date.now() + 20_000;
  let appState;
  while (Date.now() < appDeadline) {
    appState = await readBridgeState();
    const runnerState = runner.status().running?.state;
    if (runnerState === "error" || runnerState === "complete") {
      throw new Error(`Reachy clock process ended before running (${runnerState}): ${runtimeLines.slice(-12).join("\n")}`);
    }
    if ((appState.lastResult?.commandId ?? 0) > initialCommandId && runtimeLines.some((line) => line.includes("New timezone selected"))) break;
    await delay(250);
  }
  assert.ok((appState?.lastResult?.commandId ?? 0) > initialCommandId, "Clock app did not send any Reachy movement command");
  assert.ok(runtimeLines.some((line) => line.includes("New timezone selected")), "Clock app did not enter its official ReachyMiniApp.run loop");
  assert.equal((appState.lastResult ?? {}).status, "adapted", "The demo backend did not report the movement as adapted");

  const installedDirectory = path.join(appRoot, createHash("sha256").update(spaceId).digest("hex"));
  const venvPython = path.join(installedDirectory, "venv", "bin", "python");
  const versions = await capture(venvPython, ["-c", "import importlib.metadata as m; print('reachy_mini=' + m.version('reachy-mini')); print('reachy_mini_clock=' + m.version('reachy_mini_clock')); print('pytz=' + m.version('pytz'))"]);
  const stateWhileRunning = runner.status().running?.state;
  const stopResult = await runner.stop();
  assert.equal(stopResult.state, "stopped");
  assert.equal(runner.status().running?.state, "stopped");
  const finalState = await readBridgeState();

  console.log(JSON.stringify({
    status: "PASS",
    installMode: "local app package --no-deps in the existing isolated upstream SDK venv; full AppRunner dependency install separately failed with [Errno 28] on gstreamer_gtk==1.28.8",
    source: { spaceId, revision: catalogItem.revision, sdk: catalogItem.sdk, kind: catalogItem.kind },
    entryPoint: "reachy_mini_clock.main:ReachyMiniClock via createAppRunner -I/-c runpy __main__",
    installedVersions: versions.trim().split(/\r?\n/),
    companion: { backend: finalState.backend, runningStateDuringApp: stateWhileRunning, lastResultStatus: appState.lastResult?.status, commandIdAdvanced: appState.lastResult?.commandId > initialCommandId, measuredPose: finalState.observed?.measuredPose },
    mediaBackend: "no_media",
    appStop: stopResult.state,
    loopbackGuard: "test-only override from 0.0.0.0:8080 to 127.0.0.1:8080; app package source unchanged",
    output: runtimeLines.filter((line) => line.includes("Starting Reachy Mini app") || line.includes("Using media backend") || line.includes("New timezone selected")).slice(-8),
  }, null, 2));
  console.log("Reachy Mini clock app passed through the live catalog, official runner, and LOOI demo backend.");
} finally {
  if (gateway) await gateway.close();
  else await runner.close();
}

async function readBridgeState() {
  const response = await fetch(`http://127.0.0.1:${port}/api/robot-bridge/state`);
  if (!response.ok) throw new Error(`LOOI demo state returned HTTP ${response.status}`);
  return response.json();
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: appHome, TMPDIR: acceptanceRoot } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Version probe failed (${code}): ${stderr}`)));
  });
}
