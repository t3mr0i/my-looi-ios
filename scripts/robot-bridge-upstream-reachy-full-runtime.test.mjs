import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";
import { startRobotGateway } from "../services/robot-bridge/gateway.mjs";

// Starts the exact app already installed by the public Reachy Store path. This
// deliberately does not reinstall, seed, or edit the app's Python package.
const rootDir = process.env.LOOI_REACHY_ACCEPTANCE_FULL_ROOT
  ?? "/private/tmp/looi-upstream-reachy-acceptance-full-runner";
const spaceId = "pollen-robotics/reachy_mini_clock";
const revision = "e8b4a4ea44116d881b940b5ea210fe5e69e162e4";
const port = Number(process.env.LOOI_REACHY_FULL_RUNTIME_PORT ?? 8000);
const signalingPort = Number(process.env.LOOI_REACHY_FULL_RUNTIME_SIGNAL_PORT ?? 18443);
// The preceding install acceptance already resolved this exact SHA from the
// live public catalog. Avoid another external request while testing its runtime.
const item = { spaceId, revision, title: "Reachy Mini Clock", kind: "python", sdk: "reachy-mini" };
const catalog = { resolve: async (requestedId) => {
  assert.equal(requestedId, spaceId);
  return item;
} };

const runtimeLines = [];
const loopbackGuard = String.raw`
_reachy_original_init = ReachyMiniApp.__init__
def _reachy_loopback_init(self, *args, **kwargs):
    app_url = getattr(type(self), "custom_app_url", None)
    if isinstance(app_url, str) and app_url.startswith("http://0.0.0.0:"):
        self.custom_app_url = app_url.replace("http://0.0.0.0:", "http://127.0.0.1:", 1)
    return _reachy_original_init(self, *args, **kwargs)
ReachyMiniApp.__init__ = _reachy_loopback_init
`;
const runner = createAppRunner({
  rootDir,
  catalog,
  commandTimeoutMs: 300_000,
  stopGraceMs: 3_000,
  mediaBackend: "no_media",
  spawnImpl: (command, args, options) => {
    let childArgs = args;
    if (args[0] === "-I" && args[1] === "-u" && args[2] === "-c") {
      childArgs = [...args];
      childArgs[3] = childArgs[3].replace(
        "runpy.run_module(module_name, run_name='__main__', alter_sys=True)",
        `${loopbackGuard}\nrunpy.run_module(module_name, run_name='__main__', alter_sys=True)`,
      );
      assert.notEqual(childArgs[3], args[3], "The test-only loopback bind guard was applied to the app process");
    }
    const child = spawn(command, childArgs, options);
    if (args[0] === "-I") {
      child.stdout?.on("data", (chunk) => runtimeLines.push(String(chunk).trimEnd()));
      child.stderr?.on("data", (chunk) => runtimeLines.push(String(chunk).trimEnd()));
    }
    return child;
  },
});

let gateway;
let appStarted = false;
try {
  await runner.ready;
  const installed = runner.listInstalled().find((app) => app.spaceId === spaceId);
  assert.ok(installed, "The complete App Store install must hydrate from installed.json");
  assert.equal(installed.revision, revision);

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
  appStarted = true;
  assert.ok(["starting", "running"].includes(started.state), `Unexpected runner state: ${started.state}`);
  const deadline = Date.now() + 30_000;
  let state;
  while (Date.now() < deadline) {
    state = await readBridgeState();
    const runnerState = runner.status().running?.state;
    if (["error", "complete"].includes(runnerState)) {
      throw new Error(`Installed Clock process ended before running (${runnerState}): ${runtimeLines.slice(-12).join("\n")}`);
    }
    if ((state.lastResult?.commandId ?? 0) > initialCommandId
      && runtimeLines.some((line) => line.includes("New timezone selected"))) break;
    await delay(250);
  }

  assert.ok((state?.lastResult?.commandId ?? 0) > initialCommandId,
    `Installed Clock app did not send a Reachy movement command; runner=${JSON.stringify(runner.status().running)}; lastBridgeState=${JSON.stringify(state)}; logs=${runtimeLines.slice(-30).join("\n")}`);
  assert.ok(runtimeLines.some((line) => line.includes("New timezone selected")),
    `Installed Clock app did not enter ReachyMiniApp.run; logs=${runtimeLines.slice(-30).join("\n")}`);
  assert.equal(state.lastResult.status, "adapted", "LOOI demo backend did not adapt the installed app command");

  const python = `${rootDir}/${createHashForSpace(spaceId)}/venv/bin/python`;
  const versions = await capture(python, ["-c", "import importlib.metadata as m; print('reachy-mini=' + m.version('reachy-mini')); print('reachy_mini_clock=' + m.version('reachy_mini_clock')); print('pytz=' + m.version('pytz'))"]);
  const runningState = runner.status().running?.state;
  const stopped = await runner.stop();
  appStarted = false;
  assert.equal(stopped.state, "stopped");
  assert.equal(runner.status().running?.state, "stopped");
  const finalState = await readBridgeState();

  console.log(JSON.stringify({
    status: "PASS",
    installMode: "unmodified output of createAppRunner.install; no seeded registry or package reinstall",
    source: { spaceId, revision: item.revision, sdk: item.sdk, kind: item.kind },
    entryPoint: "catalog-hydrated createAppRunner start → reachy_mini_clock.main:ReachyMiniClock",
    installedVersions: versions.trim().split(/\r?\n/),
    companion: { backend: finalState.backend, runningStateDuringApp: runningState, lastResultStatus: state.lastResult.status, commandIdAdvanced: state.lastResult.commandId > initialCommandId, measuredPose: finalState.observed?.measuredPose },
    mediaBackend: "no_media",
    appStop: stopped.state,
    loopbackGuard: "test-only override from 0.0.0.0:8080 to 127.0.0.1:8080; installed app package unchanged",
    output: runtimeLines.filter((line) => line.includes("Starting Reachy Mini app") || line.includes("Using media backend") || line.includes("New timezone selected")).slice(-8),
  }, null, 2));
} finally {
  if (appStarted) await runner.stop().catch(() => {});
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
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Installed-version probe failed (${code}): ${stderr}`)));
  });
}

function createHashForSpace(value) {
  return createHash("sha256").update(value).digest("hex");
}

