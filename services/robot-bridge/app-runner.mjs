import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ENTRY_GROUP = "reachy_mini_apps";
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const ENV_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST_RECORD_TTL_MS = 60 * 60 * 1_000;
const MAX_RETAINED_REQUEST_RECORDS = 1_024;
const MEDIA_BACKENDS = new Set(["default", "local", "webrtc", "no_media"]);
const APP_BOOTSTRAP = [
  "import runpy, sys",
  "module_name, requested_backend = sys.argv[1], sys.argv[2]",
  "sys.argv = [module_name]",
  "from reachy_mini.apps.app import ReachyMiniApp",
  "if ReachyMiniApp.request_media_backend is None:",
  "    ReachyMiniApp.request_media_backend = requested_backend",
  "runpy.run_module(module_name, run_name='__main__', alter_sys=True)",
].join("\n");

function slugFromSpaceId(spaceId) {
  const slug = spaceId.split("/").at(-1);
  if (!APP_NAME.test(slug)) throw new Error("Invalid app name in Space ID");
  return slug;
}

function appFolder(rootDir, spaceId) {
  const key = createHash("sha256").update(spaceId).digest("hex");
  return path.join(rootDir, key);
}

function publicJob(job) {
  return { id: job.id, spaceId: job.spaceId, revision: job.revision ?? null, phase: job.phase, state: job.state, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error };
}

function requestedRevision(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) throw new Error("Requested revision must be a 40-character commit SHA");
  return value.toLowerCase();
}

function requestedId(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw Object.assign(new Error("requestId must be 1 to 128 alphanumeric, underscore, or hyphen characters"), { statusCode: 422 });
  }
  return value;
}

function requestConflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function boundedLine(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 2000);
}

function baseEnvironment(source = process.env) {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USERPROFILE", "SYSTEMROOT", "WINDIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"]) {
    if (typeof source[key] === "string") env[key] = source[key];
  }
  env.PIP_NO_INPUT = "1";
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  env.PYTHONNOUSERSITE = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_LFS_SKIP_SMUDGE = "1";
  return env;
}

function parseAppModule(entriesText, expectedName) {
  let inGroup = false;
  for (const rawLine of entriesText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const group = /^\[([^\]]+)\]$/.exec(line);
    if (group) { inGroup = group[1] === ENTRY_GROUP; continue; }
    if (!inGroup || !line || line.startsWith("#")) continue;
    const row = /^([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)(?::[^\s[]+)?(?:\s*\[[^\]]*\])?$/.exec(line);
    if (row?.[1] === expectedName && MODULE_NAME.test(row[2])) return row[2];
  }
  return null;
}

async function findAppModule(sitePackages, appName) {
  let dirs;
  try { dirs = await readdir(sitePackages, { withFileTypes: true }); }
  catch { throw new Error("Installed Python package metadata is missing"); }
  for (const entry of dirs) {
    if (!entry.isDirectory() || !entry.name.endsWith(".dist-info")) continue;
    const metadataPath = path.join(sitePackages, entry.name, "entry_points.txt");
    try {
      const stat = await readFile(metadataPath);
      if (stat.byteLength > 64 * 1024) continue;
      const module = parseAppModule(stat.toString("utf8"), appName);
      if (module) return module;
    } catch { /* Other distributions need not define Reachy app entry points. */ }
  }
  throw new Error(`No [${ENTRY_GROUP}] entry point named '${appName}' was installed`);
}

function collectLines(stream, append) {
  if (!stream?.on) return;
  let buffer = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk) => {
    buffer += String(chunk);
    if (buffer.length > 8_000) buffer = buffer.slice(-8_000);
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      append(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  });
  stream.on("end", () => { if (buffer) append(buffer); buffer = ""; });
}

function sendSignal(child, signal, spawnImpl = nodeSpawn) {
  if (!child?.pid) return false;
  if (process.platform === "win32") {
    if (signal === "SIGINT") {
      try { child.kill("SIGINT"); return true; } catch { return false; }
    }
    try {
      const killer = spawnImpl("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
      killer.once?.("error", () => {});
      return true;
    } catch { return false; }
  }
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    try { child.kill(signal); return true; } catch { return false; }
  }
}

/**
 * Companion-side lifecycle for Reachy Python Spaces. All install/start calls are explicit.
 * Spaces must first be resolved by the live public catalog; revisions are pinned to its SHA.
 * Python packages execute third-party code, so this uses per-app venvs and a clean environment
 * but is not a security sandbox.
 */
export function createAppRunner({
  rootDir = path.join(os.homedir(), ".looi", "robot-bridge", "apps"),
  catalog,
  spawnImpl = nodeSpawn,
  killProcessGroup = sendSignal,
  pythonExecutable = process.env.PYTHON || "python3",
  commandTimeoutMs = 180_000,
  stopGraceMs = 3_000,
  maxLogLines = 200,
  mediaBackend = "webrtc",
  getRuntimeEnv = () => ({}),
} = {}) {
  if (!catalog || typeof catalog.resolve !== "function") throw new Error("A validated app catalog is required");
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new Error("App runner root must be an absolute path");
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs < 1_000 || commandTimeoutMs > 30 * 60_000) throw new Error("Invalid install timeout");
  if (!Number.isFinite(stopGraceMs) || stopGraceMs < 100 || stopGraceMs > 60_000) throw new Error("Invalid stop timeout");
  if (!Number.isInteger(maxLogLines) || maxLogLines < 10 || maxLogLines > 2_000) throw new Error("Invalid log limit");
  if (!MEDIA_BACKENDS.has(mediaBackend)) throw new Error("Unsupported Reachy Mini media backend");
  const root = path.resolve(rootDir);
  const installed = new Map();
  const invalidInstalled = new Map();
  const jobs = new Map();
  const processes = new Set();
  // Request IDs bridge the native admission/STOP ordering. Retain terminal IDs for
  // longer than the phone HTTP deadline so a late ensure-start cannot resurrect a
  // request which STOP already cancelled before it reached this process.
  const requestRecords = new Map();
  let requestAdmissionBlockedUntil = 0;
  let installBusy = false;
  let running = null;
  let closed = false;
  let closePromise = null;
  let activeInstallPromise = null;
  let activeStartPromise = null;
  let activeCompositeJob = null;
  let activeCompositePromise = null;
  let activeRemovalPromise = null;

  function assertNotRemoving() {
    if (activeRemovalPromise) throw Object.assign(new Error("An app is being uninstalled; retry when it finishes"), { statusCode: 409 });
  }

  function assertOpen() {
    if (closed) throw new Error("App runner is closed");
  }

  function assertJobActive(job) {
    assertOpen();
    if (job.stopRequested) throw new Error("App start was stopped");
  }

  function requestRecordIsActive(record) {
    return Boolean(record.job && ["starting", "running", "stopping"].includes(record.job.state));
  }

  function requestRecordRetainedAt(record) {
    const finishedAt = record.job?.finishedAt ? Date.parse(record.job.finishedAt) : NaN;
    return Number.isFinite(finishedAt) ? Math.max(record.createdAt, finishedAt) : record.createdAt;
  }

  function pruneRequestRecords() {
    const now = Date.now();
    if (requestAdmissionBlockedUntil <= now) requestAdmissionBlockedUntil = 0;
    for (const [requestId, record] of requestRecords) {
      if (!requestRecordIsActive(record) && now - requestRecordRetainedAt(record) >= REQUEST_RECORD_TTL_MS) requestRecords.delete(requestId);
    }
  }

  function retainedRequestRecordCount() {
    let count = 0;
    for (const record of requestRecords.values()) if (!requestRecordIsActive(record)) count += 1;
    return count;
  }

  function ensureRequestRecordCapacity() {
    pruneRequestRecords();
    if (retainedRequestRecordCount() >= MAX_RETAINED_REQUEST_RECORDS) {
      throw Object.assign(new Error("App request cancellation history is full; retry after it expires"), { statusCode: 503 });
    }
  }

  function registerRequestJob(requestId, spaceId, revision, job) {
    if (!requestId) return;
    if (requestAdmissionBlockedUntil > Date.now()) {
      throw Object.assign(new Error("App starts are temporarily blocked while cancellation history is full"), { statusCode: 503 });
    }
    ensureRequestRecordCapacity();
    requestRecords.set(requestId, { spaceId, revision, job, cancelledBeforeAdmission: false, createdAt: Date.now() });
    job.requestId = requestId;
    job.requestedRevision = revision;
  }

  function trackProcess(child, onClose) {
    let resolveDone;
    const record = {
      child,
      closed: false,
      reason: null,
      terminationPromise: null,
      done: new Promise((resolve) => { resolveDone = resolve; }),
    };
    const settle = (result) => {
      if (record.closed) return;
      record.closed = true;
      record.result = result;
      processes.delete(record);
      resolveDone(result);
      onClose?.(result, record);
    };
    record.settle = settle;
    processes.add(record);
    child.once("error", (error) => {
      record.error = error;
      // Spawn failures have no process to wait for. Later errors can be kill failures; keep
      // tracking those children until the actual close event confirms the process has exited.
      if (child.pid == null) settle({ error, code: null, signal: null });
    });
    child.once("close", (code, signal) => settle({ code, signal, error: record.error || null }));
    return record;
  }

  function signalProcess(record, signal) {
    if (record.closed) return;
    let sent = false;
    try { sent = killProcessGroup(record.child, signal) !== false; } catch { /* Fall back to the child handle. */ }
    if (!sent) {
      try { record.child.kill?.(signal); } catch { /* The child may already have exited. */ }
    }
  }

  function waitForProcess(record, timeoutMs) {
    if (record.closed) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (closedNow) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(closedNow);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      record.done.then(() => finish(true));
    });
  }

  function terminateProcess(record, reason, initialSignal = "SIGINT") {
    if (record.closed) return Promise.resolve();
    if (record.terminationPromise) return record.terminationPromise;
    record.reason ||= reason;
    record.terminationPromise = (async () => {
      signalProcess(record, initialSignal);
      if (await waitForProcess(record, stopGraceMs)) return;
      signalProcess(record, "SIGKILL");
      await record.done;
    })();
    return record.terminationPromise;
  }

  function append(job, line) {
    job.logs.push(boundedLine(line));
    if (job.logs.length > maxLogLines) job.logs.splice(0, job.logs.length - maxLogLines);
  }

  function runCommand(command, args, { cwd, env, job, timeoutMs = commandTimeoutMs } = {}) {
    assertOpen();
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(command, args, { cwd, env, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { reject(error); return; }
      collectLines(child.stdout, (line) => append(job, line));
      collectLines(child.stderr, (line) => append(job, line));
      const record = trackProcess(child, (_result, tracked) => {
        if (job.installRecord === tracked) job.installRecord = null;
      });
      job.installRecord = record;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateProcess(record, "install-timeout", "SIGTERM");
      }, timeoutMs);
      timer.unref?.();
      record.done.then(({ error, code, signal }) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error("App installation timed out"));
        else if (record.reason === "app-runner-closed") reject(new Error("App runner is closed"));
        else if (error) reject(error);
        else if (code !== 0) reject(new Error(`${path.basename(command)} exited (${signal || (code ?? "unknown")})`));
        else resolve();
      });
    });
  }

  async function saveInstalled({ allowClosed = false } = {}) {
    if (!allowClosed) assertOpen();
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (!allowClosed) assertOpen();
    const target = path.join(root, "installed.json");
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ schemaVersion: 1, apps: [...installed.values()] }, null, 2), { mode: 0o600 });
      if (!allowClosed) assertOpen();
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function hydrateInstalled(app, { verifyPython = false } = {}) {
    const dir = appFolder(root, app.spaceId);
    const venv = path.join(dir, "venv");
    const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
    const sitePackages = await findSitePackages(venv);
    const module = await findAppModule(sitePackages, slugFromSpaceId(app.spaceId));
    if (verifyPython) await access(python);
    return {
      spaceId: app.spaceId,
      id: `hf:${app.spaceId}`,
      title: boundedLine(app.title || app.spaceId),
      revision: app.revision.toLowerCase(),
      directory: dir,
      venv,
      python,
      module,
      installedAt: app.installedAt || null,
    };
  }

  async function loadInstalled() {
    try {
      const raw = JSON.parse(await readFile(path.join(root, "installed.json"), "utf8"));
      if (raw?.schemaVersion !== 1 || !Array.isArray(raw.apps)) return;
      for (const app of raw.apps) {
        if (typeof app?.spaceId !== "string" || !/^[-A-Za-z0-9._]{1,64}\/[A-Za-z0-9._-]{1,96}$/.test(app.spaceId)
          || typeof app.revision !== "string" || !/^[a-f0-9]{40}$/i.test(app.revision)) continue;
        try {
          const hydrated = await hydrateInstalled(app, { verifyPython: true });
          installed.set(app.spaceId, hydrated);
          invalidInstalled.delete(app.spaceId);
        } catch (error) {
          // The registry contains display metadata only. Rebuild executable paths from the
          // content-addressed app directory and re-parse entry_points.txt on every restart.
          invalidInstalled.set(app.spaceId, boundedLine(error?.message || "Installed app metadata is invalid"));
        }
      }
    } catch { /* The registry is created on first successful install. */ }
  }

  const ready = loadInstalled();

  async function startInstall(job, item, { completeJob = true } = {}) {
    assertJobActive(job);
    const dir = appFolder(root, item.spaceId);
    const venv = path.join(dir, "venv");
    const localEnv = baseEnvironment();
    job.phase = "creating-venv";
    await mkdir(root, { recursive: true, mode: 0o700 });
    assertJobActive(job);
    await rm(dir, { recursive: true, force: true });
    assertJobActive(job);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    assertJobActive(job);
    await runCommand(pythonExecutable, ["-m", "venv", venv], { cwd: dir, env: localEnv, job });
    assertJobActive(job);
    const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
    job.phase = "installing-space";
    const repo = `git+https://huggingface.co/spaces/${item.spaceId}@${item.revision}`;
    await runCommand(python, ["-m", "pip", "install", "--no-input", "--disable-pip-version-check", repo], { cwd: dir, env: localEnv, job });
    assertJobActive(job);
    job.phase = "checking-entry-point";
    const appName = slugFromSpaceId(item.spaceId);
    const sitePackages = await findSitePackages(venv);
    const module = await findAppModule(sitePackages, appName);
    assertJobActive(job);
    const row = { spaceId: item.spaceId, id: item.id, title: item.title, revision: item.revision, directory: dir, venv, python, module, installedAt: new Date().toISOString() };
    installed.set(item.spaceId, row);
    try {
      await saveInstalled();
      if (closed) {
        installed.delete(item.spaceId);
        await saveInstalled({ allowClosed: true });
        throw new Error("App runner is closed");
      }
    } catch (error) {
      installed.delete(item.spaceId);
      throw error;
    }
    job.installCommitted = true;
    assertJobActive(job);
    invalidInstalled.delete(item.spaceId);
    if (completeJob) {
      job.phase = "complete";
      job.state = "complete";
      job.finishedAt = new Date().toISOString();
    }
  }

  async function findSitePackages(venv) {
    const libRoot = process.platform === "win32" ? path.join(venv, "Lib") : path.join(venv, "lib");
    if (process.platform === "win32") return path.join(libRoot, "site-packages");
    let names;
    try { names = await readdir(libRoot); } catch { throw new Error("Python venv did not contain a library directory"); }
    const version = names.filter((name) => /^python3\.\d+$/.test(name)).sort().at(-1);
    if (!version) throw new Error("Python venv version could not be resolved");
    return path.join(libRoot, version, "site-packages");
  }

  async function install(spaceId, { revision } = {}) {
    assertOpen();
    assertNotRemoving();
    if (activeCompositeJob) throw new Error("An app ensure-start operation is already in progress");
    const pinnedRevision = requestedRevision(revision);
    const existing = installed.get(spaceId);
    if (existing) {
      if (pinnedRevision && pinnedRevision !== existing.revision) {
        throw new Error("Requested revision does not match the installed revision; replace the installation explicitly first");
      }
      return { alreadyInstalled: true, app: sanitizeInstalled(existing) };
    }
    if (installBusy) throw new Error("An app installation is already running");
    installBusy = true;
    let item;
    try { item = await catalog.resolve(spaceId, pinnedRevision ? { revision: pinnedRevision } : {}); assertOpen(); }
    catch (error) { installBusy = false; throw error; }
    if (installed.has(item.spaceId)) { installBusy = false; return { alreadyInstalled: true, app: sanitizeInstalled(installed.get(item.spaceId)) }; }
    const job = { id: randomUUID(), spaceId: item.spaceId, revision: item.revision, phase: "queued", state: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null, logs: [] };
    jobs.set(job.id, job);
    const operation = startInstall(job, item).catch(async (error) => {
      job.state = closed ? "stopped" : "error";
      job.phase = closed ? "cancelled" : "failed";
      job.error = boundedLine(error?.message || "Installation failed");
      job.finishedAt = new Date().toISOString();
      await rm(appFolder(root, item.spaceId), { recursive: true, force: true }).catch(() => {});
    }).finally(() => {
      installBusy = false;
      if (activeInstallPromise === operation) activeInstallPromise = null;
    });
    activeInstallPromise = operation;
    return publicJob(job);
  }

  function sanitizeInstalled(app) {
    return { id: app.id, spaceId: app.spaceId, title: app.title, revision: app.revision, installedAt: app.installedAt, state: running?.spaceId === app.spaceId ? running.state : "stopped" };
  }

  async function launchApp(spaceId, { job: suppliedJob = null, beforeSpawn } = {}) {
    assertOpen();
    assertNotRemoving();
    if (activeCompositeJob && activeCompositeJob !== suppliedJob) throw new Error("An app ensure-start operation is already in progress");
    const registeredItem = installed.get(spaceId);
    if (!registeredItem) {
      const invalidReason = invalidInstalled.get(spaceId);
      if (invalidReason) throw new Error(`Installed app cannot start: ${invalidReason}`);
      throw new Error("Install this catalog app before starting it");
    }
    if (running && ["starting", "running", "stopping"].includes(running.state)) throw new Error("Only one companion app can run at a time");
    const job = suppliedJob ?? {
      id: randomUUID(), spaceId: registeredItem.spaceId, revision: registeredItem.revision, title: registeredItem.title,
      phase: "starting", state: "starting", startedAt: new Date().toISOString(), finishedAt: null, error: null, logs: [],
    };
    job.revision = registeredItem.revision;
    job.phase = "starting";
    if (!suppliedJob) job.state = "starting";
    jobs.set(job.id, job);
    running = job;
    try {
      let item;
      try {
        item = await hydrateInstalled(registeredItem);
      } catch (error) {
        const reason = boundedLine(error?.message || "Installed app metadata is invalid");
        invalidInstalled.set(spaceId, reason);
        throw new Error(`Installed app cannot start: ${reason}`);
      }
      assertJobActive(job);
      installed.set(spaceId, item);
      invalidInstalled.delete(spaceId);
      const runtimeEnv = await getRuntimeEnv({ ...sanitizeInstalled(item), family: "reachy", kind: "python" });
      assertJobActive(job);
      const env = { ...baseEnvironment(), ...validateRuntimeEnv(runtimeEnv) };
      // Keep the official module's __main__ lifecycle and ReachyMiniApp.wrapped_run(). The
      // upstream SDK exposes request_media_backend on ReachyMiniApp; set only its default so an
      // app that explicitly requests local/no_media remains in control of its own media path.
      await beforeSpawn?.();
      assertJobActive(job);
      const child = spawnImpl(item.python, ["-I", "-u", "-c", APP_BOOTSTRAP, item.module, mediaBackend], { cwd: item.directory, env, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      job.child = child;
      collectLines(child.stdout, (line) => append(job, line));
      collectLines(child.stderr, (line) => append(job, line));
      const record = trackProcess(child, (result, tracked) => {
        if (job.processRecord === tracked) job.processRecord = null;
        job.child = null;
        job.state = job.state === "stopping" || job.stopRequested || tracked.reason === "app-runner-closed" ? "stopped" : result.error ? "error" : result.code === 0 ? "complete" : "error";
        job.phase = job.state === "stopped" ? "stopped" : job.state === "complete" ? "complete" : "failed";
        if (result.error && job.state === "error") job.error = boundedLine(result.error?.message || "App process failed");
        else if (result.code !== 0 && job.state === "error") job.error = job.error || `App exited (${result.signal || result.code || "unknown"})`;
        job.finishedAt = new Date().toISOString();
        if (activeCompositeJob === job) activeCompositeJob = null;
      });
      job.processRecord = record;
      child.once("spawn", () => {
        if (running === job && job.state === "starting") job.state = "running";
        if (job.state === "running") job.phase = "running";
      });
    } catch (error) {
      job.state = closed || job.stopRequested ? "stopped" : "error";
      job.phase = job.state === "stopped" ? "cancelled" : "failed";
      job.error = closed || job.stopRequested ? null : boundedLine(error?.message || "App process failed");
      job.finishedAt = new Date().toISOString();
      throw error;
    }
    return publicJob(job);
  }

  async function start(spaceId) {
    assertOpen();
    assertNotRemoving();
    if (activeCompositeJob) throw new Error("An app ensure-start operation is already in progress");
    if (activeStartPromise) throw new Error("An app is already starting");
    if (running && ["starting", "running", "stopping"].includes(running.state)) throw new Error("Only one companion app can run at a time");
    const operation = launchApp(spaceId);
    activeStartPromise = operation;
    try { return await operation; }
    finally { if (activeStartPromise === operation) activeStartPromise = null; }
  }

  function ensureStarted(spaceId, { revision, beforeSpawn, requestId: rawRequestId } = {}) {
    assertOpen();
    assertNotRemoving();
    const requested = requestedRevision(revision);
    const requestId = requestedId(rawRequestId);
    if (beforeSpawn !== undefined && typeof beforeSpawn !== "function") throw new Error("Invalid app readiness check");

    if (requestId) {
      pruneRequestRecords();
      const record = requestRecords.get(requestId);
      if (record) {
        if (record.cancelledBeforeAdmission) throw requestConflict("App start request was cancelled before admission");
        if (record.spaceId !== spaceId || record.revision !== requested) {
          throw requestConflict("requestId is already bound to a different app or revision");
        }
        if (record.job) return publicJob(record.job);
      } else if (requestAdmissionBlockedUntil > Date.now()) {
        throw Object.assign(new Error("App starts are temporarily blocked while cancellation history is full"), { statusCode: 503 });
      }
    }

    if (activeCompositeJob) {
      const job = activeCompositeJob;
      if (job.spaceId !== spaceId || job.stopRequested) throw requestConflict("Another app operation is already in progress");
      if (requestId) {
        if (job.requestId && job.requestId !== requestId) throw requestConflict("Another request already owns this app operation");
        if ((job.requestedRevision ?? null) !== requested) throw requestConflict("requestId is already bound to a different app revision");
        if (!job.requestId) registerRequestJob(requestId, spaceId, requested, job);
      }
      if (requested && ((job.revision && job.revision !== requested) || (job.requestedRevision && job.requestedRevision !== requested))) {
        throw requestConflict("Requested revision does not match the active app operation");
      }
      if (requested && !job.revision && !job.requestedRevision) job.revisionConstraint = requested;
      return publicJob(job);
    }

    if (installBusy || activeInstallPromise) throw new Error("An app installation is already running");

    const existingRun = running && ["starting", "running", "stopping"].includes(running.state) ? running : null;
    if (existingRun) {
      if (existingRun.spaceId !== spaceId) throw requestConflict("Only one companion app can run at a time");
      const pinned = installed.get(spaceId)?.revision ?? existingRun.revision;
      if (requested && requested !== pinned) throw requestConflict("Requested revision does not match the installed revision");
      if (requestId) {
        if (existingRun.requestId && existingRun.requestId !== requestId) throw requestConflict("Another request already owns this app operation");
        if (!existingRun.requestId) registerRequestJob(requestId, spaceId, requested, existingRun);
      }
      return publicJob(existingRun);
    }

    if (activeStartPromise) throw requestConflict("An app is already starting");

    const existing = installed.get(spaceId);
    if (existing && requested && requested !== existing.revision) {
      throw new Error("Requested revision does not match the installed revision; replace the installation explicitly first");
    }
    const job = {
      id: randomUUID(), spaceId, revision: existing?.revision ?? null, phase: existing ? "starting" : "resolving",
      state: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null, logs: [],
      requestedRevision: requested, revisionConstraint: requested, stopRequested: false,
    };
    if (requestId) registerRequestJob(requestId, spaceId, requested, job);
    jobs.set(job.id, job);
    activeCompositeJob = job;
    const operation = runEnsureStarted(job, beforeSpawn);
    let wrapped;
    wrapped = operation.finally(() => {
      if (activeCompositePromise === wrapped) activeCompositePromise = null;
    });
    activeCompositePromise = wrapped;
    return publicJob(job);
  }

  async function runEnsureStarted(job, beforeSpawn) {
    try {
      assertJobActive(job);
      await ready;
      assertJobActive(job);
      let item = installed.get(job.spaceId);
      if (item) {
        const requested = job.requestedRevision ?? job.revisionConstraint;
        if (requested && requested !== item.revision) throw new Error("Requested revision does not match the installed revision; replace the installation explicitly first");
        job.revision = item.revision;
      } else {
        job.phase = "resolving";
        const requested = job.requestedRevision ?? job.revisionConstraint;
        item = await catalog.resolve(job.spaceId, requested ? { revision: requested } : {});
        assertJobActive(job);
        if (job.revisionConstraint && job.revisionConstraint !== item.revision) {
          throw new Error("Requested revision does not match the resolved catalog revision");
        }
        job.revision = item.revision;
        if (installBusy || activeInstallPromise) throw new Error("An app installation is already running");
        installBusy = true;
        job.phase = "installing";
        const installOperation = startInstall(job, item, { completeJob: false });
        activeInstallPromise = installOperation;
        try {
          await installOperation;
        } catch (error) {
          if (!job.installCommitted) await rm(appFolder(root, item.spaceId), { recursive: true, force: true }).catch(() => {});
          throw error;
        } finally {
          installBusy = false;
          if (activeInstallPromise === installOperation) activeInstallPromise = null;
        }
        assertJobActive(job);
        item = installed.get(job.spaceId);
        if (!item) throw new Error("App installation did not create an installed app record");
      }

      assertJobActive(job);
      job.revision = item.revision;
      job.phase = "starting";
      await launchApp(job.spaceId, { job, beforeSpawn });
    } catch (error) {
      const stopped = closed || job.stopRequested;
      job.state = stopped ? "stopped" : "error";
      job.phase = stopped ? "cancelled" : "failed";
      job.error = stopped ? null : boundedLine(error?.message || "App launch failed");
      job.finishedAt ??= new Date().toISOString();
      if (activeCompositeJob === job && !job.processRecord) activeCompositeJob = null;
    }
  }

  function validateRuntimeEnv(value) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid app runtime environment");
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!ENV_KEY.test(key) || typeof item !== "string" || item.length > 2048 || /[\r\n\0]/.test(item)) throw new Error("Invalid app runtime environment");
      result[key] = item;
    }
    return result;
  }

  async function stopCompositeJob(composite) {
    if (["complete", "error", "stopped"].includes(composite.state)) {
      if (activeCompositeJob === composite) activeCompositeJob = null;
      return publicJob(composite);
    }
    composite.stopRequested = true;
    composite.state = "stopping";
    composite.phase = "stopping";
    const installer = composite.installRecord;
    const appProcess = composite.processRecord;
    const operations = [];
    if (installer) operations.push(terminateProcess(installer, "app-stopped"));
    if (appProcess) operations.push(terminateProcess(appProcess, "app-stopped"));
    if (activeCompositePromise) operations.push(activeCompositePromise);
    await Promise.allSettled(operations);
    if (activeCompositeJob === composite && !composite.installRecord && !composite.processRecord) {
      composite.state = "stopped";
      composite.phase = composite.installCommitted ? "stopped" : "cancelled";
      composite.finishedAt ??= new Date().toISOString();
      activeCompositeJob = null;
    }
    return publicJob(composite);
  }

  async function stopSpecificJob(job) {
    if (activeCompositeJob === job) return stopCompositeJob(job);
    if (running !== job || ["complete", "error", "stopped"].includes(job.state)) return publicJob(job);
    if (job.state === "starting" && activeStartPromise && !job.processRecord) {
      job.stopRequested = true;
      job.state = "stopping";
      job.phase = "stopping";
      await activeStartPromise.catch(() => {});
      return publicJob(job);
    }
    const record = job.processRecord;
    if (!record) return publicJob(job);
    job.state = "stopping";
    job.phase = "stopping";
    await terminateProcess(record, "app-stopped");
    return publicJob(job);
  }

  function cancelledBeforeAdmissionResult(requestId) {
    return { requestId, state: "stopped", phase: "cancelled", cancelledBeforeAdmission: true };
  }

  async function cancelEnsure(rawRequestId) {
    assertOpen();
    const requestId = requestedId(rawRequestId);
    if (!requestId) throw Object.assign(new Error("requestId is required for targeted app cancellation"), { statusCode: 422 });
    pruneRequestRecords();
    let record = requestRecords.get(requestId);
    if (!record) {
      try { ensureRequestRecordCapacity(); }
      catch (error) {
        // Fail closed for new ID-bearing app starts if the bounded tombstone table is full.
        // This preserves the HTTP cancellation guarantee without evicting an unexpired ID.
        requestAdmissionBlockedUntil = Math.max(requestAdmissionBlockedUntil, Date.now() + REQUEST_RECORD_TTL_MS);
        throw error;
      }
      record = { spaceId: null, revision: null, job: null, cancelledBeforeAdmission: true, createdAt: Date.now() };
      requestRecords.set(requestId, record);
      return cancelledBeforeAdmissionResult(requestId);
    }
    record.createdAt = Date.now();
    if (record.cancelledBeforeAdmission || !record.job) return cancelledBeforeAdmissionResult(requestId);
    return stopSpecificJob(record.job);
  }

  async function stop(options = {}) {
    assertOpen();
    if (options?.requestId !== undefined) return cancelEnsure(options.requestId);
    const composite = activeCompositeJob;
    if (composite) {
      return stopCompositeJob(composite);
    }
    const job = running;
    if (job?.state === "starting" && activeStartPromise && !job.processRecord) {
      job.stopRequested = true;
      job.state = "stopping";
      job.phase = "stopping";
      await activeStartPromise.catch(() => {});
      return publicJob(job);
    }
    const record = job?.processRecord;
    if (!job || !record || !["starting", "running"].includes(job.state)) throw new Error("No app is currently running");
    job.state = "stopping";
    job.phase = "stopping";
    await terminateProcess(record, "app-stopped");
    return publicJob(job);
  }

  function uninstall(spaceId) {
    assertOpen();
    assertNotRemoving();
    if (typeof spaceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(spaceId)) {
      throw Object.assign(new Error("Invalid app Space ID"), { statusCode: 422 });
    }
    if (installBusy || activeInstallPromise || activeStartPromise || activeCompositeJob
      || running?.spaceId === spaceId && ["starting", "running", "stopping"].includes(running.state)) {
      throw Object.assign(new Error("Stop the app and wait for current operations before uninstalling"), { statusCode: 409 });
    }
    const operation = (async () => {
      await ready;
      assertOpen();
      const previous = installed.get(spaceId);
      const invalid = invalidInstalled.get(spaceId);
      if (!previous && !invalid) throw Object.assign(new Error("App is not installed"), { statusCode: 404 });
      // Derive the directory solely from the validated ID, never from registry
      // metadata or an HTTP path supplied by a caller. rm unlinks symlinks.
      await rm(appFolder(root, spaceId), { recursive: true, force: true });
      installed.delete(spaceId);
      invalidInstalled.delete(spaceId);
      try { await saveInstalled({ allowClosed: true }); }
      catch (error) {
        // Retain the identity for a cleanup retry after a registry write failure.
        if (previous) installed.set(spaceId, previous);
        if (invalid) invalidInstalled.set(spaceId, invalid);
        throw error;
      }
      return { spaceId, state: "uninstalled" };
    })();
    const wrapped = operation.finally(() => { if (activeRemovalPromise === wrapped) activeRemovalPromise = null; });
    activeRemovalPromise = wrapped;
    return wrapped;
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    if (activeCompositeJob) {
      activeCompositeJob.stopRequested = true;
      if (!activeCompositeJob.processRecord) activeCompositeJob.state = "stopping";
    }
    if (running?.processRecord) running.state = "stopping";
    const processShutdown = Promise.all([...processes].map((record) => terminateProcess(record, "app-runner-closed")));
    const installInFlight = activeInstallPromise;
    const startInFlight = activeStartPromise;
    const compositeInFlight = activeCompositePromise;
    closePromise = (async () => {
      await processShutdown;
      await ready.catch(() => {});
      await Promise.all([...processes].map((record) => terminateProcess(record, "app-runner-closed")));
      await Promise.allSettled([installInFlight, startInFlight, compositeInFlight].filter(Boolean));
      // The startup and install continuations check the closed flag before spawning their next
      // child. This second sweep covers a process which was already attached when shutdown began.
      await Promise.all([...processes].map((record) => terminateProcess(record, "app-runner-closed")));
      await Promise.allSettled([activeInstallPromise, activeStartPromise, activeCompositePromise, activeRemovalPromise].filter(Boolean));
    })();
    return closePromise;
  }

  function status() {
    return { installed: [...installed.values()].map(sanitizeInstalled), running: running ? publicJob(running) : null, jobs: [...jobs.values()].map(publicJob).slice(-20) };
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    return { ...publicJob(job), logs: [...job.logs] };
  }

  function listInstalled() { return [...installed.values()].map(sanitizeInstalled); }

  return Object.freeze({ install, start, ensureStarted, uninstall, stop, cancelEnsure, close, status, getJob, listInstalled, ready });
}
