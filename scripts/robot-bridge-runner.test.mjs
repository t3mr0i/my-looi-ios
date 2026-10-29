import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppRunner } from "../services/robot-bridge/app-runner.mjs";

const REVISION = "a".repeat(40);
const SPACE_ID = "pollen-robotics/demo-app";
const app = { id: `hf:${SPACE_ID}`, spaceId: SPACE_ID, title: "Fixture app", revision: REVISION };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeChild extends EventEmitter {
  constructor(pid = 930_000) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.closeOnInterrupt && signal === "SIGINT") this.finish(0, signal);
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

function fixtureCatalog() {
  return { resolve: async () => ({ ...app }) };
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function testCloseCancelsAndWaitsForInstall() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-close-install-"));
  const spawned = deferred();
  const child = new FakeChild();
  let spawnCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    stopGraceMs: 100,
    killProcessGroup: (target, signal) => target.kill(signal),
    spawnImpl: () => { spawnCount += 1; spawned.resolve(); return child; },
  });
  try {
    await runner.ready;
    const job = await runner.install(SPACE_ID);
    await spawned.promise;

    let closeSettled = false;
    const closing = runner.close().then(() => { closeSettled = true; });
    const closingAgain = runner.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closeSettled, false, "close must wait for the install child to exit");
    await Promise.all([closing, closingAgain]);

    assert.deepEqual(child.signals, ["SIGINT", "SIGKILL"]);
    assert.equal(spawnCount, 1, "shutdown must not let the install advance to pip");
    assert.equal(runner.getJob(job.id).phase, "cancelled");
    assert.equal(runner.getJob(job.id).state, "stopped");
    assert.deepEqual(runner.listInstalled(), []);
    await assert.rejects(readFile(path.join(rootDir, "installed.json")), { code: "ENOENT" });
    await assert.rejects(runner.install(SPACE_ID), /runner is closed/);
    await assert.rejects(runner.start(SPACE_ID), /runner is closed/);
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testCloseBetweenInstallCommandsPreventsNextSpawnAndCommit() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-close-race-"));
  const spawned = deferred();
  const child = new FakeChild();
  let spawnCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    killProcessGroup: (target, signal) => target.kill(signal),
    spawnImpl: () => { spawnCount += 1; spawned.resolve(); return child; },
  });
  try {
    await runner.ready;
    const job = await runner.install(SPACE_ID);
    await spawned.promise;

    // The runCommand close continuation is a microtask. Closing in the same stack as this
    // successful child exit proves it checks the lifecycle flag before launching pip/committing.
    child.finish(0);
    const closing = runner.close();
    await closing;

    assert.equal(spawnCount, 1, "no follow-up command may spawn after close starts");
    assert.equal(runner.getJob(job.id).phase, "cancelled");
    assert.deepEqual(runner.listInstalled(), []);
    await assert.rejects(readFile(path.join(rootDir, "installed.json")), { code: "ENOENT" });
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testInstallTimeoutWaitsForHardKillBeforeCleanup() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-timeout-"));
  const spawned = deferred();
  const child = new FakeChild();
  let spawnCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    commandTimeoutMs: 1_000,
    stopGraceMs: 100,
    killProcessGroup: (target, signal) => target.kill(signal),
    spawnImpl: () => { spawnCount += 1; spawned.resolve(); return child; },
  });
  try {
    await runner.ready;
    const job = await runner.install(SPACE_ID);
    await spawned.promise;
    await waitFor(() => runner.getJob(job.id)?.state === "error", "timed-out install did not settle");
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(spawnCount, 1);
    assert.deepEqual(runner.listInstalled(), []);
    await assert.rejects(readFile(path.join(rootDir, "installed.json")), { code: "ENOENT" });
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeInstalledRegistry(rootDir, { entryPoint = true } = {}) {
  await mkdir(rootDir, { recursive: true });
  const directory = path.join(rootDir, createHash("sha256").update(SPACE_ID).digest("hex"));
  const venv = path.join(directory, "venv");
  const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
  const sitePackages = process.platform === "win32"
    ? path.join(venv, "Lib", "site-packages")
    : path.join(venv, "lib", "python3.12", "site-packages");
  await mkdir(sitePackages, { recursive: true });
  await mkdir(path.dirname(python), { recursive: true });
  await writeFile(python, "fixture python executable");
  if (entryPoint) {
    const metadata = path.join(sitePackages, "demo_app-1.0.dist-info");
    await mkdir(metadata, { recursive: true });
    await writeFile(path.join(metadata, "entry_points.txt"), "[reachy_mini_apps]\ndemo-app = demo_pkg.main:DemoApp\n");
  }
  // Path and module values are deliberately untrusted. The runner must derive/re-parse them.
  await writeFile(path.join(rootDir, "installed.json"), JSON.stringify({
    schemaVersion: 1,
    apps: [{ ...app, directory: "/untrusted/app", venv: "/untrusted/venv", python: "/untrusted/python", module: "attacker.module" }],
  }));
}

async function createFixtureVenv(venv) {
  const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
  const sitePackages = process.platform === "win32"
    ? path.join(venv, "Lib", "site-packages")
    : path.join(venv, "lib", "python3.12", "site-packages");
  await mkdir(sitePackages, { recursive: true });
  await mkdir(path.dirname(python), { recursive: true });
  await writeFile(python, "fixture python executable");
  const metadata = path.join(sitePackages, "demo_app-1.0.dist-info");
  await mkdir(metadata, { recursive: true });
  await writeFile(path.join(metadata, "entry_points.txt"), "[reachy_mini_apps]\ndemo-app = demo_pkg.main:DemoApp\n");
}

function appRunnerSpawner({ failPip = false, holdVenv = false } = {}) {
  const commands = [];
  const children = [];
  let nextPid = 940_000;
  let installer = null;
  const spawnImpl = (command, args, options) => {
    commands.push({ command, args, options });
    const child = new FakeChild(nextPid++);
    children.push(child);
    if (args[0] === "-m" && args[1] === "venv") {
      installer = child;
      if (!holdVenv) void createFixtureVenv(args[2]).then(() => {
        child.emit("spawn");
        child.finish(0);
      });
    } else if (args[0] === "-m" && args[1] === "pip") {
      queueMicrotask(() => { child.emit("spawn"); child.finish(failPip ? 1 : 0); });
    } else if (args[0] === "-I") {
      child.closeOnInterrupt = true;
      queueMicrotask(() => child.emit("spawn"));
    } else {
      queueMicrotask(() => { child.emit("spawn"); child.finish(0); });
    }
    return child;
  };
  return { commands, children, get installer() { return installer; }, spawnImpl };
}

async function testCloseDuringRuntimeEnvironmentLookupPreventsAppSpawn() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-start-race-"));
  await writeInstalledRegistry(rootDir);
  const envRequested = deferred();
  const allowEnv = deferred();
  let spawnCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    getRuntimeEnv: () => { envRequested.resolve(); return allowEnv.promise; },
    spawnImpl: () => { spawnCount += 1; return new FakeChild(); },
  });
  try {
    await runner.ready;
    const starting = runner.start(SPACE_ID);
    await envRequested.promise;
    const closing = runner.close();
    allowEnv.resolve({});
    await closing;
    await assert.rejects(starting, /runner is closed/);
    assert.equal(spawnCount, 0, "the app process must not spawn after close begins");
    assert.equal(runner.status().running.state, "stopped");
  } finally {
    allowEnv.resolve({});
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testRestartRebuildsTrustedPythonAndEntryPoint() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-restart-"));
  await writeInstalledRegistry(rootDir);
  let launch;
  const child = new FakeChild();
  child.closeOnInterrupt = true;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    killProcessGroup: (target, signal) => target.kill(signal),
    spawnImpl: (command, args) => { launch = { command, args }; return child; },
  });
  try {
    await runner.ready;
    assert.equal(runner.listInstalled().length, 1);
    await runner.start(SPACE_ID);
    const expectedDir = path.join(rootDir, createHash("sha256").update(SPACE_ID).digest("hex"));
    const expectedPython = process.platform === "win32"
      ? path.join(expectedDir, "venv", "Scripts", "python.exe")
      : path.join(expectedDir, "venv", "bin", "python");
    assert.equal(launch.command, expectedPython);
    assert.equal(launch.args.at(-2), "demo_pkg.main");
    await runner.close();
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testRestartRejectsMissingEntryPointMetadata() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-restart-invalid-"));
  await writeInstalledRegistry(rootDir, { entryPoint: false });
  let spawnCount = 0;
  const runner = createAppRunner({ rootDir, catalog: fixtureCatalog(), spawnImpl: () => { spawnCount += 1; return new FakeChild(); } });
  try {
    await runner.ready;
    assert.deepEqual(runner.listInstalled(), []);
    await assert.rejects(runner.start(SPACE_ID), /No \[reachy_mini_apps\] entry point named 'demo-app'/);
    assert.equal(spawnCount, 0);
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testStopDuringRuntimeEnvironmentLookupPreventsAppSpawn() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-stop-race-"));
  await writeInstalledRegistry(rootDir);
  const envRequested = deferred();
  const allowEnv = deferred();
  let spawnCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    getRuntimeEnv: () => { envRequested.resolve(); return allowEnv.promise; },
    spawnImpl: () => { spawnCount += 1; return new FakeChild(); },
  });
  try {
    await runner.ready;
    const starting = runner.start(SPACE_ID);
    await envRequested.promise;
    const stopping = runner.stop();
    allowEnv.resolve({});
    const stopped = await stopping;
    assert.equal(stopped.state, "stopped");
    await assert.rejects(starting, /App start was stopped/);
    assert.equal(spawnCount, 0, "stop must prevent a pending app startup from spawning later");
    assert.equal(runner.status().running.state, "stopped");
  } finally {
    allowEnv.resolve({});
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testCloseStopsRunningAppAndWaitsForExit() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-close-app-"));
  await writeInstalledRegistry(rootDir);
  const child = new FakeChild();
  child.closeOnInterrupt = true;
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    killProcessGroup: (target, signal) => target.kill(signal),
    spawnImpl: () => child,
  });
  try {
    await runner.ready;
    const started = await runner.start(SPACE_ID);
    assert.equal(started.state, "starting");
    await runner.close();
    assert.deepEqual(child.signals, ["SIGINT"]);
    assert.equal(runner.status().running.state, "stopped");
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testEnsureStartedInstallsOnceAndReusesPinnedRevision() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-ensure-start-"));
  const spawner = appRunnerSpawner();
  let resolveCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: { async resolve(spaceId, options) { resolveCount += 1; assert.equal(spaceId, SPACE_ID); assert.equal(options.revision, undefined); return { ...app }; } },
    spawnImpl: spawner.spawnImpl,
    killProcessGroup: (child, signal) => child.kill(signal),
    stopGraceMs: 100,
  });
  try {
    await runner.ready;
    const first = runner.ensureStarted(SPACE_ID, { requestId: "native-app-run-1" });
    assert.deepEqual(Object.keys(first).sort(), ["error", "finishedAt", "id", "phase", "revision", "spaceId", "startedAt", "state"]);
    assert.equal(first.spaceId, SPACE_ID);
    assert.equal(first.revision, null);
    assert.equal(first.state, "running");
    assert.equal(runner.ensureStarted(SPACE_ID, { requestId: "native-app-run-1" }).id, first.id, "same request ID and app reuse the active composite job");
    assert.throws(() => runner.ensureStarted("pollen-robotics/other-app", { requestId: "native-app-run-1" }), /different app or revision/);
    assert.throws(() => runner.ensureStarted(SPACE_ID, { requestId: "native-app-run-1", revision: "b".repeat(40) }), /different app or revision/);
    assert.throws(() => runner.ensureStarted("pollen-robotics/other-app"), /Another app operation/);
    await assert.rejects(runner.start(SPACE_ID), /ensure-start operation/);
    await assert.rejects(runner.install(SPACE_ID), /ensure-start operation/);
    await waitFor(() => runner.getJob(first.id)?.state === "running" && runner.getJob(first.id)?.phase === "running", "composite app did not reach running");
    assert.equal(runner.getJob(first.id).revision, REVISION);
    assert.deepEqual(runner.listInstalled().map(item => item.revision), [REVISION]);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-m" && call.args[1] === "venv").length, 1);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-m" && call.args[1] === "pip").length, 1);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-I").length, 1);
    assert.equal(resolveCount, 1);

    const stopped = await runner.stop();
    assert.equal(stopped.id, first.id);
    assert.equal(runner.getJob(first.id).state, "stopped");
    assert.deepEqual(runner.listInstalled().map(item => item.revision), [REVISION], "normal stop preserves the installed pinned app");

    const second = runner.ensureStarted(SPACE_ID);
    assert.notEqual(second.id, first.id);
    await waitFor(() => runner.getJob(second.id)?.state === "running" && runner.getJob(second.id)?.phase === "running", "cached app did not restart");
    assert.equal(resolveCount, 1, "a validated installed app reuses its pinned revision without a fresh catalog resolve");
    assert.equal(spawner.commands.filter(call => call.args[0] === "-m" && call.args[1] === "venv").length, 1);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-m" && call.args[1] === "pip").length, 1);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-I").length, 2);
    await runner.stop();
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testEnsureStartedStopDuringInstallNeverSpawnsApp() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-ensure-cancel-"));
  const spawner = appRunnerSpawner({ holdVenv: true });
  const runner = createAppRunner({
    rootDir,
    catalog: fixtureCatalog(),
    spawnImpl: spawner.spawnImpl,
    killProcessGroup: (child, signal) => child.kill(signal),
    stopGraceMs: 100,
  });
  try {
    await runner.ready;
    const job = runner.ensureStarted(SPACE_ID, { requestId: "cancel-install-1" });
    await waitFor(() => !!spawner.installer, "composite install did not spawn its first command");
    assert.equal(runner.getJob(job.id).phase, "creating-venv");
    assert.throws(() => runner.uninstall(SPACE_ID), /Stop the app/, "uninstall cannot race an in-flight first-use installation");
    const stopped = await runner.stop({ requestId: "cancel-install-1" });
    assert.equal(stopped.id, job.id);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.phase, "cancelled");
    assert.deepEqual(spawner.installer.signals, ["SIGINT", "SIGKILL"]);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-m" && call.args[1] === "pip").length, 0);
    assert.equal(spawner.commands.filter(call => call.args[0] === "-I").length, 0, "a cancelled install cannot launch the app after its child exits");
    assert.deepEqual(runner.listInstalled(), []);
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testTargetedStopTombstonesBeforeAdmissionWithoutStoppingAnotherApp() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-request-tombstone-"));
  await writeInstalledRegistry(rootDir);
  const child = new FakeChild();
  child.closeOnInterrupt = true;
  const catalogCalls = [];
  const runner = createAppRunner({
    rootDir,
    catalog: { async resolve(spaceId) { catalogCalls.push(spaceId); return { ...app, spaceId, id: `hf:${spaceId}` }; } },
    killProcessGroup: (target, signal) => target.kill(signal),
    stopGraceMs: 100,
    spawnImpl: (_command, args) => {
      if (args[0] === "-I") queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  try {
    await runner.ready;
    const existing = await runner.start(SPACE_ID);
    await waitFor(() => runner.getJob(existing.id)?.state === "running", "pre-existing app did not start");

    const tombstone = await runner.stop({ requestId: "late-request-1" });
    assert.deepEqual(tombstone, { requestId: "late-request-1", state: "stopped", phase: "cancelled", cancelledBeforeAdmission: true });
    assert.deepEqual(child.signals, [], "targeted cancellation before admission cannot stop a different running app");
    assert.equal(runner.getJob(existing.id).state, "running");

    assert.throws(() => runner.ensureStarted("pollen-robotics/late-app", { requestId: "late-request-1" }), /cancelled before admission/);
    assert.deepEqual(catalogCalls, [], "a tombstoned late request never resolves or installs its app");
    assert.deepEqual(child.signals, [], "late admission remains blocked without stopping the unrelated app");

    const stoppedExisting = await runner.stop();
    assert.equal(stoppedExisting.id, existing.id, "generic STOP retains its existing all-app behavior");
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testRequestTombstonesAreBoundedWithoutEarlyEviction() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-request-capacity-"));
  const originalNow = Date.now;
  let fakeNow = 1_800_000_000_000;
  Date.now = () => fakeNow;
  const runner = createAppRunner({ rootDir, catalog: fixtureCatalog(), spawnImpl: () => { throw new Error("unexpected spawn"); } });
  try {
    await runner.ready;
    for (let index = 0; index < 1_024; index += 1) {
      const result = await runner.stop({ requestId: `bounded-${index}` });
      assert.equal(result.cancelledBeforeAdmission, true);
    }
    await assert.rejects(runner.stop({ requestId: "bounded-overflow" }), error => error.statusCode === 503);
    assert.throws(() => runner.ensureStarted(SPACE_ID, { requestId: "bounded-late-ensure" }), error => error.statusCode === 503,
      "overflow fails closed instead of evicting a live one-hour tombstone");

    fakeNow += 60 * 60 * 1_000 + 1;
    assert.equal((await runner.stop({ requestId: "bounded-after-expiry" })).cancelledBeforeAdmission, true,
      "expired tombstones and the overflow fence are reclaimed after the one-hour window");
  } finally {
    Date.now = originalNow;
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testEnsureStartedRevisionMismatchDoesNotReplaceInstallation() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-ensure-revision-"));
  await writeInstalledRegistry(rootDir);
  const spawner = appRunnerSpawner();
  let resolveCount = 0;
  const runner = createAppRunner({
    rootDir,
    catalog: { async resolve() { resolveCount += 1; return { ...app }; } },
    spawnImpl: spawner.spawnImpl,
  });
  try {
    await runner.ready;
    await assert.rejects(Promise.resolve().then(() => runner.ensureStarted(SPACE_ID, { revision: "b".repeat(40) })), /does not match the installed revision/);
    await assert.rejects(runner.install(SPACE_ID, { revision: "b".repeat(40) }), /does not match the installed revision/);
    assert.equal(resolveCount, 0, "an explicit mismatch is rejected before refreshing or replacing the pinned install");
    assert.equal(spawner.commands.length, 0);
    assert.deepEqual(runner.listInstalled().map(item => item.revision), [REVISION]);
    const directory = path.join(rootDir, createHash("sha256").update(SPACE_ID).digest("hex"));
    const python = process.platform === "win32"
      ? path.join(directory, "venv", "Scripts", "python.exe")
      : path.join(directory, "venv", "bin", "python");
    await readFile(python);
  } finally {
    await runner.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function testEnsureStartedInstallAndReadinessFailuresNeverSpawn() {
  const installRoot = await mkdtemp(path.join(os.tmpdir(), "looi-runner-ensure-install-fail-"));
  const installSpawner = appRunnerSpawner({ failPip: true });
  const failedInstallRunner = createAppRunner({
    rootDir: installRoot,
    catalog: fixtureCatalog(),
    spawnImpl: installSpawner.spawnImpl,
  });
  try {
    await failedInstallRunner.ready;
    const job = failedInstallRunner.ensureStarted(SPACE_ID);
    await waitFor(() => failedInstallRunner.getJob(job.id)?.state === "error", "failed pip install did not fail the composite job");
    assert.equal(failedInstallRunner.getJob(job.id).phase, "failed");
    assert.equal(installSpawner.commands.filter(call => call.args[0] === "-I").length, 0);
    assert.deepEqual(failedInstallRunner.listInstalled(), []);
  } finally {
    await failedInstallRunner.close();
    await rm(installRoot, { recursive: true, force: true });
  }

  const readyRoot = await mkdtemp(path.join(os.tmpdir(), "looi-runner-ensure-readiness-"));
  await writeInstalledRegistry(readyRoot);
  const readySpawner = appRunnerSpawner();
  const readyRunner = createAppRunner({
    rootDir: readyRoot,
    catalog: fixtureCatalog(),
    spawnImpl: readySpawner.spawnImpl,
  });
  try {
    await readyRunner.ready;
    const job = readyRunner.ensureStarted(SPACE_ID, { beforeSpawn() { throw new Error("LOOI phone is not connected"); } });
    await waitFor(() => readyRunner.getJob(job.id)?.state === "error", "late readiness failure did not fail the composite job");
    assert.equal(readyRunner.getJob(job.id).error, "LOOI phone is not connected");
    assert.equal(readySpawner.commands.filter(call => call.args[0] === "-I").length, 0, "the final readiness check runs before app spawn");
    assert.deepEqual(readyRunner.listInstalled().map(item => item.revision), [REVISION], "readiness failure keeps the already installed app");
  } finally {
    await readyRunner.close();
    await rm(readyRoot, { recursive: true, force: true });
  }
}

async function testUninstallRemovesOnlyTheTrustedAppAndPersists() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-uninstall-"));
  await writeInstalledRegistry(rootDir);
  const neighbor = path.join(rootDir, "keep-this-file");
  await writeFile(neighbor, "untouched");
  const appDirectory = path.join(rootDir, createHash("sha256").update(SPACE_ID).digest("hex"));
  await symlink(neighbor, path.join(appDirectory, "untrusted-link"));
  const runner = createAppRunner({ rootDir, catalog: fixtureCatalog() });
  try {
    await runner.ready;
    assert.throws(() => runner.uninstall("../../outside"), /Invalid app Space ID/);
    const removing = runner.uninstall(SPACE_ID);
    await assert.rejects(runner.install(SPACE_ID), /being uninstalled/);
    await assert.rejects(runner.start(SPACE_ID), /being uninstalled/);
    assert.throws(() => runner.ensureStarted(SPACE_ID), /being uninstalled/);
    assert.deepEqual(await removing, { spaceId: SPACE_ID, state: "uninstalled" });
    const directory = path.join(rootDir, createHash("sha256").update(SPACE_ID).digest("hex"));
    await assert.rejects(readFile(path.join(directory, "venv", "bin", "python")), { code: "ENOENT" });
    assert.equal(await readFile(neighbor, "utf8"), "untouched");
    assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, "installed.json"), "utf8")).apps, []);
    assert.deepEqual(runner.listInstalled(), []);
    await runner.close();
    const reopened = createAppRunner({ rootDir, catalog: fixtureCatalog() });
    try { await reopened.ready; assert.deepEqual(reopened.listInstalled(), []); }
    finally { await reopened.close(); }
  } finally { await runner.close(); await rm(rootDir, { recursive: true, force: true }); }
}

async function testUninstallRefusesRunningOrInstallingApps() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "looi-runner-uninstall-busy-"));
  await writeInstalledRegistry(rootDir);
  const spawner = appRunnerSpawner();
  const runner = createAppRunner({ rootDir, catalog: fixtureCatalog(), spawnImpl: spawner.spawnImpl, stopGraceMs: 100,
    killProcessGroup: (child, signal) => child.kill(signal) });
  try {
    await runner.ready;
    await runner.start(SPACE_ID);
    assert.throws(() => runner.uninstall(SPACE_ID), /Stop the app/);
    assert.equal(runner.listInstalled().length, 1);
    await runner.stop();
    assert.equal((await runner.uninstall(SPACE_ID)).state, "uninstalled");
  } finally { await runner.close(); await rm(rootDir, { recursive: true, force: true }); }
}

await testUninstallRemovesOnlyTheTrustedAppAndPersists();
await testUninstallRefusesRunningOrInstallingApps();
await testCloseCancelsAndWaitsForInstall();
await testCloseBetweenInstallCommandsPreventsNextSpawnAndCommit();
await testInstallTimeoutWaitsForHardKillBeforeCleanup();
await testCloseDuringRuntimeEnvironmentLookupPreventsAppSpawn();
await testStopDuringRuntimeEnvironmentLookupPreventsAppSpawn();
await testRestartRebuildsTrustedPythonAndEntryPoint();
await testRestartRejectsMissingEntryPointMetadata();
await testCloseStopsRunningAppAndWaitsForExit();
await testEnsureStartedInstallsOnceAndReusesPinnedRevision();
await testEnsureStartedStopDuringInstallNeverSpawnsApp();
await testTargetedStopTombstonesBeforeAdmissionWithoutStoppingAnotherApp();
await testRequestTombstonesAreBoundedWithoutEarlyEviction();
await testEnsureStartedRevisionMismatchDoesNotReplaceInstallation();
await testEnsureStartedInstallAndReadinessFailuresNeverSpawn();

console.log("robot bridge app runner shutdown tests passed");
