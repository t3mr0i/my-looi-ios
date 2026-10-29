import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";
import { startRobotGateway } from "../services/robot-bridge/gateway.mjs";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const REVISION = "c".repeat(40);
const LATEST_CATALOG_REVISION = "d".repeat(40);
const SPACE_ID = "pollen-robotics/e2e-dance-demo";
const TOKEN = "e".repeat(48);
const COMMIT = /^[a-f0-9]{40}$/i;
const VALID_SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

const { createRobotAppSkills } = loadTypeScript("src/robot-bridge/app-skills.ts", {
  "./app-catalog": { COMMIT, SPACE_ID: VALID_SPACE_ID },
});
const { requestConfiguredCompanion } = loadTypeScript("src/robot-bridge/companion-client.ts", {
  "./runtime": { async loadRobotBridgeConfiguration() { return null; } },
});

const app = {
  id: `hf:${SPACE_ID}`,
  spaceId: SPACE_ID,
  revision: REVISION,
  title: "E2E dance fixture",
  description: "Fake-process fixture across app skills, HTTP gateway, and runner.",
  author: "pollen-robotics",
  kind: "python",
  tags: ["dance"],
  installable: true,
  launch: { mode: "install", spaceId: SPACE_ID, revision: REVISION },
};

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.exitCode = null;
  }
  kill(signal) {
    this.signals.push(signal);
    if (signal === "SIGKILL" || signal === "SIGINT") this.finish(0, signal);
    return true;
  }
  finish(code = 0, signal = null) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    queueMicrotask(() => {
      this.emit("close", code, signal);
      this.stdout.end();
      this.stderr.end();
    });
  }
}

async function createFixtureVenv(venv) {
  const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
  const sitePackages = process.platform === "win32"
    ? path.join(venv, "Lib", "site-packages")
    : path.join(venv, "lib", "python3.12", "site-packages");
  const metadata = path.join(sitePackages, "e2e_dance_fixture-1.0.dist-info");
  await mkdir(path.dirname(python), { recursive: true });
  await mkdir(metadata, { recursive: true });
  await writeFile(python, "fixture executable; never invoked by this test");
  await writeFile(path.join(metadata, "entry_points.txt"), "[reachy_mini_apps]\ne2e-dance-demo = fixture_pkg.main:App\n");
}

function connectDevice(url) {
  const socket = new WebSocket(url, ["looi-bridge-v1", `bearer.${TOKEN}`]);
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("open", () => resolve({
      send: (message) => socket.send(JSON.stringify(message)),
      close: () => new Promise((done) => { socket.once("close", done); socket.close(); }),
    }));
  });
}

async function waitFor(predicate, message, timeoutMs = 4_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) assert.fail(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-app-skill-companion-e2e-"));
let resolveCalls = 0;
let appSpawns = 0;
let nextPid = 1_140_000;
let installerGate = null;
const children = [];
const processInvocations = [];
const runnerCatalog = {
  async list() { return { items: [app], total: 1 }; },
  async get(spaceId) { if (spaceId !== SPACE_ID) throw new Error("Space not found"); return app; },
  async resolve(spaceId) {
    resolveCalls += 1;
    assert.equal(spaceId, SPACE_ID);
    return { id: app.id, spaceId, title: app.title, revision: REVISION };
  },
};
const runner = createAppRunner({
  rootDir,
  catalog: runnerCatalog,
  stopGraceMs: 100,
  killProcessGroup: (child, signal) => child.kill(signal),
  spawnImpl(_command, args) {
    processInvocations.push([...args]);
    const child = new FakeChild(nextPid++);
    children.push(child);
    if (args[0] === "-m" && args[1] === "venv") {
      const gate = installerGate;
      void (async () => {
        if (gate) await gate.promise;
        await createFixtureVenv(args[2]);
        child.emit("spawn"); child.finish(0);
      })();
    } else if (args[0] === "-m" && args[1] === "pip") {
      queueMicrotask(() => { child.emit("spawn"); child.finish(0); });
    } else if (args[0] === "-I") {
      appSpawns += 1;
      queueMicrotask(() => child.emit("spawn"));
    } else {
      throw new Error(`Unexpected runner subprocess ${args.join(" ")}`);
    }
    return child;
  },
});
const gateway = await startRobotGateway({
  port: 0,
  token: TOKEN,
  centralToken: "",
  appCatalog: runnerCatalog,
  appRunner: runner,
  signalingPort: 0,
});
let phone;
let engine;
try {
  const base = `http://127.0.0.1:${gateway.address.port}`;
  phone = await connectDevice(`ws://127.0.0.1:${gateway.address.port}/device`);
  phone.send({ type: "ready", clockMs: 10_000, media: { camera: false, microphone: false, speaker: false } });
  const connection = { url: `ws://127.0.0.1:${gateway.address.port}/device`, token: TOKEN };
  const requestCalls = [];
  let requestSequence = 0;
  let gatedEnsure = null;
  let currentCatalogApp = app;
  const client = {
    connected: true,
    async request(requestPath, options = {}) {
      requestCalls.push({ path: requestPath, body: options.body ?? null });
      if (requestPath === "/api/apps/ensure-start" && gatedEnsure) {
        gatedEnsure.entered.resolve(options.body.requestId);
        await gatedEnsure.release.promise;
      }
      return requestConfiguredCompanion(connection, requestPath, options);
    },
  };
  engine = createRobotAppSkills({
    catalog: { async list() { return { items: [currentCatalogApp], total: 1 }; }, async get(spaceId) { if (spaceId !== SPACE_ID) throw new Error("Space not found"); return currentCatalogApp; } },
    getCompanionConnection: async () => client,
    isEnabled: () => true,
    isActive: () => true,
    prepareHosted: async () => true,
    openHosted: () => undefined,
    createRequestId: () => `e2e-request-${++requestSequence}`,
    pollIntervalMs: 50,
  });

  let appProcessSpawned = false;
  const observed = [];
  engine.subscribe((snapshot) => {
    observed.push(snapshot.status);
    if (snapshot.status === "running") appProcessSpawned = appSpawns > 0;
  });

  installerGate = deferred();
  const admission = await engine.start(SPACE_ID);
  assert.equal(admission.status, "installing", "the engine reports the composite job phase, not premature running");
  assert.equal(requestCalls.find((call) => call.path === "/api/apps/ensure-start")?.body?.spaceId, SPACE_ID);
  assert.equal(appSpawns, 0, "admission returns while install work is still blocked before the app process spawn");
  installerGate.resolve();
  await waitFor(() => engine.getSnapshot().activeApp?.status === "running", "pure app-skill core did not observe the spawned runner process");
  assert.equal(appProcessSpawned, true, "running is published only after the real runner emitted process spawn and phase=running");
  assert.equal(resolveCalls, 1, "cold start resolves the catalog exactly once");
  assert.equal(appSpawns, 1, "cold start crosses the HTTP route and launches one fake app process");
  assert.ok(observed.includes("installing"));

  const installedBeforeStop = await requestConfiguredCompanion(connection, "/api/apps/status");
  assert.deepEqual(installedBeforeStop.installed.map((entry) => entry.spaceId), [SPACE_ID]);
  assert.equal(installedBeforeStop.running.phase, "running");
  const stopped = await engine.stop();
  assert.equal(stopped.status, "stopped");
  assert.equal(children.at(-1).signals.includes("SIGINT"), true, "targeted STOP terminates only the real runner's app child");
  const stoppedSnapshot = await requestConfiguredCompanion(connection, "/api/apps/status");
  assert.equal(stoppedSnapshot.installed.length, 1, "STOP preserves the pinned install");
  assert.equal(stoppedSnapshot.running.state, "stopped");

  // A new pure engine sees a newer public catalog revision, but the runner must reuse the
  // validated installed revision after STOP without resolving, reinstalling, or upgrading it.
  await engine.dispose();
  engine = null;
  currentCatalogApp = {
    ...app,
    revision: LATEST_CATALOG_REVISION,
    launch: { ...app.launch, revision: LATEST_CATALOG_REVISION },
  };
  engine = createRobotAppSkills({
    catalog: { async list() { return { items: [currentCatalogApp], total: 1 }; }, async get(spaceId) { if (spaceId !== SPACE_ID) throw new Error("Space not found"); return currentCatalogApp; } },
    getCompanionConnection: async () => client,
    isEnabled: () => true,
    isActive: () => true,
    prepareHosted: async () => true,
    openHosted: () => undefined,
    createRequestId: () => `e2e-request-${++requestSequence}`,
    pollIntervalMs: 50,
  });
  const warmStart = await engine.start(SPACE_ID);
  assert.ok(["starting", "running"].includes(warmStart.status), "warm start is admitted against the already-installed app");
  await waitFor(() => engine.getSnapshot().activeApp?.status === "running", "warm start did not reach the runner process");
  const warmSnapshot = engine.getSnapshot();
  assert.equal(warmSnapshot.activeApp.catalogRevision, LATEST_CATALOG_REVISION);
  assert.equal(warmSnapshot.activeApp.installedRevision, REVISION, "the installed SHA remains pinned while catalog has advanced");
  assert.equal(resolveCalls, 1, "warm start reuses the installed app without another catalog resolution");
  assert.equal(processInvocations.filter((args) => args[0] === "-m" && args[1] === "venv").length, 1,
    "warm start does not create another venv");
  assert.equal(processInvocations.filter((args) => args[0] === "-m" && args[1] === "pip").length, 1,
    "warm start does not invoke pip again");
  assert.equal(appSpawns, 2, "warm start launches a second app process using the pinned install");
  const warmStopped = await engine.stop();
  assert.equal(warmStopped.status, "stopped");

  // Force the request reordering that occurs when local STOP beats an in-flight admission.
  // STOP reaches the real HTTP endpoint and runner first; the delayed ensure-start then receives
  // a 409 from its tombstone and must not trigger a second process.
  gatedEnsure = { entered: deferred(), release: deferred() };
  const lateStart = engine.start(SPACE_ID);
  const lateRequestId = await gatedEnsure.entered.promise;
  const tombstoned = await engine.stop();
  assert.equal(tombstoned.status, "stopped");
  const afterEarlyStop = await requestConfiguredCompanion(connection, "/api/apps/status");
  assert.equal(afterEarlyStop.running.state, "stopped", "the earlier targeted STOP does not disturb the prior terminal job");
  gatedEnsure.release.resolve();
  await lateStart;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(appSpawns, 2, "late admission with a tombstoned request ID never spawns");
  assert.equal(resolveCalls, 1, "cached install plus pre-admission cancellation does not resolve or reinstall");
  assert.equal(requestCalls.filter((call) => call.path === "/api/apps/ensure-start").length, 3);
  assert.equal(requestCalls.some((call) => call.path === "/api/apps/stop" && call.body?.requestId === lateRequestId), true,
    "core sends request-scoped STOP through the same authenticated companion client");
  const finalSnapshot = await requestConfiguredCompanion(connection, "/api/apps/status");
  assert.equal(finalSnapshot.installed.length, 1);
  assert.equal(finalSnapshot.installed[0].revision, REVISION, "the installed record still carries its original SHA");
  assert.equal(finalSnapshot.running.state, "stopped");
  const removed = await requestConfiguredCompanion(connection, "/api/apps/uninstall", { method: "POST", body: { spaceId: SPACE_ID } });
  assert.equal(removed.state, "uninstalled");
  assert.equal((await requestConfiguredCompanion(connection, "/api/apps/status")).installed.length, 0);
  gatedEnsure = null;
  const reinstalled = await engine.start(SPACE_ID);
  assert.equal(reinstalled.status, "installing", "after explicit uninstall, a fresh use installs again");
  await waitFor(() => engine.getSnapshot().activeApp?.status === "running", "fresh use after uninstall did not start");
  assert.equal(processInvocations.filter(args => args[0] === "-m" && args[1] === "pip").length, 2);
  assert.equal(appSpawns, 3);
  await engine.stop();
  console.log("Robot app skill E2E: pure core → authenticated HTTP gateway → real runner; cold install, truthful running report, targeted stop, warm start on pinned installed SHA, and reordered late admission passed");
} finally {
  if (engine) await engine.dispose();
  if (phone) await phone.close();
  await gateway.close();
  await rm(rootDir, { recursive: true, force: true });
}
