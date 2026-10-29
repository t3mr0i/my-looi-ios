/**
 * Portable runtime for catalog apps exposed to the voice agent as skills.
 *
 * This module deliberately contains no React Native, Node, storage, or UI
 * dependencies. The caller supplies an operation-bound companion client so a
 * configuration change cannot redirect an admitted install or its stop call
 * to a different robot endpoint.
 */
import { COMMIT, SPACE_ID, type AppCatalog, type AppCatalogItem } from "./app-catalog";

export type RobotAppSkillCompanion = {
  connected: boolean;
  request<T = unknown>(path: string, options?: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<T>;
};

export type RobotAppSkillCompanionOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

export type RobotAppSkillsDependencies = {
  catalog: Pick<AppCatalog, "list" | "get">;
  isEnabled?: () => boolean;
  getCompanionConnection: () => Promise<RobotAppSkillCompanion | null>;
  prepareHosted: (options: { signal: AbortSignal }) => Promise<boolean | void>;
  openHosted: (url: string) => Promise<unknown> | unknown;
  /** Closes the native browser container only; false means the external handoff remains open. */
  stopHosted?: () => Promise<boolean> | boolean;
  isActive: () => boolean;
  now?: () => number;
  pollIntervalMs?: number;
  runningPollIntervalMs?: number;
  createRequestId?: () => string;
};

export type RobotAppSkillStatus =
  | "idle"
  | "resolving"
  | "preparing"
  | "installing"
  | "starting"
  | "running"
  | "handoff_requested"
  | "handoff_released"
  | "handoff_failed"
  | "complete"
  | "stopping"
  | "stopped"
  | "failed"
  | "busy"
  | "disabled"
  | "suspended"
  | "unavailable"
  | "stale_turn"
  | "not_found"
  | "not_installable"
  | "invalid_request";

export type RobotAppSkillErrorCode =
  | "disabled"
  | "suspended"
  | "runtime_inactive"
  | "stale_turn"
  | "invalid_space_id"
  | "catalog_unavailable"
  | "catalog_entry_not_found"
  | "catalog_entry_invalid"
  | "app_not_installable"
  | "hosted_url_invalid"
  | "hosted_prepare_failed"
  | "hosted_open_failed"
  | "hosted_close_failed"
  | "companion_disconnected"
  | "companion_unavailable"
  | "companion_auth_required"
  | "companion_response_invalid"
  | "app_busy"
  | "app_job_failed"
  | "app_stopped"
  | "stop_failed"
  | "operation_cancelled"
  | "invalid_query";

export type RobotAppSkillListedApp = {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  author: string;
  kind: "python" | "web";
  tags: string[];
  revision: string | null;
  installable: boolean;
  metadataTrust: "untrusted_plain_text";
};

export type RobotAppSkillAppState = {
  id: string;
  spaceId: string;
  title: string;
  kind: "python" | "web";
  status: RobotAppSkillStatus;
  phase: string | null;
  jobId: string | null;
  /** Revision reported by the companion for this installed/running instance. */
  installedRevision: string | null;
  /** Revision currently shown by the catalog, kept separate from cached state. */
  catalogRevision: string | null;
  installed: boolean | null;
};

export type RobotAppSkillsSnapshot = {
  enabled: boolean;
  suspended: boolean;
  status: RobotAppSkillStatus;
  activeApp: RobotAppSkillAppState | null;
  errorCode: RobotAppSkillErrorCode | null;
  updatedAt: number;
};

export type RobotAppSkillOperationResult = {
  status: RobotAppSkillStatus;
  spaceId?: string;
  jobId?: string;
  phase?: string;
  catalogRevision?: string | null;
  installedRevision?: string | null;
  errorCode?: RobotAppSkillErrorCode;
};

export type RobotAppSkillSearchResult = {
  status: "listed" | "disabled" | "unavailable" | "invalid_request";
  query: string;
  limit: number;
  total: number;
  /** Catalog prose is data, not instructions; this marker applies to every result item. */
  metadataTrust: "untrusted_plain_text";
  items: Array<Pick<RobotAppSkillListedApp, "spaceId" | "title" | "description" | "kind" | "installable">>;
  errorCode?: RobotAppSkillErrorCode;
};

export type RobotAppSkillRuntimeDetails = {
  state: "not_checked" | "not_installed" | "installed" | "installing" | "starting" | "running" | "stopped" | "complete" | "failed" | "handoff_requested" | "handoff_released" | "unknown";
  installed: boolean | null;
  installedRevision: string | null;
  catalogRevision: string | null;
  phase: string | null;
  jobId: string | null;
  errorCode?: RobotAppSkillErrorCode;
};

export type RobotAppSkillDescription = {
  status: "described" | "disabled" | "not_found" | "unavailable" | "invalid_request";
  app?: RobotAppSkillListedApp;
  runtime?: RobotAppSkillRuntimeDetails;
  errorCode?: RobotAppSkillErrorCode;
};

export type RobotAppSkillsEngine = {
  search(query: string, limit?: number): Promise<RobotAppSkillSearchResult>;
  describe(spaceId: string): Promise<RobotAppSkillDescription>;
  start(spaceId: string, options?: { isCurrent?: () => boolean }): Promise<RobotAppSkillOperationResult>;
  stop(): Promise<RobotAppSkillOperationResult>;
  getSnapshot(): RobotAppSkillsSnapshot;
  subscribe(listener: (snapshot: RobotAppSkillsSnapshot) => void): () => void;
  setEnabled(enabled: boolean): Promise<void>;
  suspend(reason?: string): Promise<RobotAppSkillOperationResult>;
  resume(): void;
  dispose(): Promise<void>;
};

type RunnerAppRecord = { spaceId: string; revision: string | null; state: string | null };
type RunnerJobRecord = { id: string | null; spaceId: string; revision: string | null; phase: string | null; state: string };
type RunnerStatus = { installed: RunnerAppRecord[]; running: RunnerJobRecord | null; jobs: RunnerJobRecord[] };
type Operation = {
  generation: number;
  spaceId: string;
  requestId: string;
  app: RobotAppSkillListedApp;
  item: AppCatalogItem;
  kind: "python" | "web";
  controller: AbortController;
  client: RobotAppSkillCompanion | null;
  jobId: string | null;
  phase: string | null;
  status: RobotAppSkillStatus;
  catalogRevision: string | null;
  installedRevision: string | null;
  installed: boolean | null;
  mayHaveBeenAdmitted: boolean;
  handedOff: boolean;
  turnGuard?: () => boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const APP_ID = (spaceId: string) => `hf:${spaceId}`;
const JOB_ID = /^[A-Za-z0-9._-]{1,128}$/;
const HF_SPACE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+hf\.space$/;
const MAX_QUERY_LENGTH = 120;
const MAX_TOP_K = 10;

function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function catalogProjection(item: AppCatalogItem): RobotAppSkillListedApp {
  return {
    id: item.id,
    spaceId: item.spaceId,
    title: plainText(item.title, 160),
    description: plainText(item.description, 500),
    author: plainText(item.author, 120),
    kind: item.kind,
    tags: item.tags.slice(0, 20).map((tag) => plainText(tag, 80)).filter(Boolean),
    revision: item.revision && COMMIT.test(item.revision) ? item.revision.toLowerCase() : null,
    installable: item.kind === "python" && item.installable === true,
    metadataTrust: "untrusted_plain_text",
  };
}

function compactSearchProjection(item: AppCatalogItem): Pick<RobotAppSkillListedApp, "spaceId" | "title" | "description" | "kind" | "installable"> {
  return {
    spaceId: item.spaceId,
    title: plainText(item.title, 48),
    description: plainText(item.description, 64),
    kind: item.kind,
    installable: item.kind === "python" && item.installable === true,
  };
}

function validCatalogItem(item: AppCatalogItem, spaceId: string): boolean {
  if (!item || item.spaceId !== spaceId || item.id !== APP_ID(spaceId) || !SPACE_ID.test(item.spaceId)) return false;
  if (item.kind !== "python" && item.kind !== "web") return false;
  if (item.launch?.spaceId !== spaceId) return false;
  if (item.kind === "python") return item.launch.mode === "install";
  return item.launch.mode === "hosted";
}

/** Return only catalog-authored HF-hosted routes; caller/model URL values are never accepted. */
function validatedHostedUrl(item: AppCatalogItem): string | null {
  if (item.kind !== "web" || item.launch.mode !== "hosted" || item.launch.spaceId !== item.spaceId) return null;
  const host = typeof item.launch.appHost === "string" ? item.launch.appHost.toLowerCase() : null;
  if (host && !HF_SPACE_HOST.test(host)) return null;
  try {
    const url = new URL(item.launch.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    if (host && url.hostname.toLowerCase() === host && url.pathname === "/") return url.toString();
    if (!host && url.hostname.toLowerCase() === "huggingface.co") {
      const expected = `/spaces/${item.spaceId.split("/").map(encodeURIComponent).join("/")}`;
      if (url.pathname === expected || url.pathname === `${expected}/`) return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function errorCodeFor(error: unknown, signal?: AbortSignal): RobotAppSkillErrorCode {
  if (signal?.aborted) return "operation_cancelled";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/pairing authorization|unauthorized|forbidden/.test(message)) return "companion_auth_required";
  if (/only one companion app|already running|busy/.test(message)) return "app_busy";
  if (/connect.*companion|companion.*connect/.test(message)) return "companion_disconnected";
  return "companion_unavailable";
}

function safeRevision(value: unknown): string | null {
  return typeof value === "string" && COMMIT.test(value) ? value.toLowerCase() : null;
}

function parseRunnerStatus(value: unknown): RunnerStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const installed = Array.isArray(raw.installed) ? raw.installed.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.spaceId !== "string" || !SPACE_ID.test(entry.spaceId)) return [];
    return [{ spaceId: entry.spaceId, revision: safeRevision(entry.revision), state: typeof entry.state === "string" ? plainText(entry.state, 40) : null }];
  }) : [];
  const parseJob = (candidate: unknown): RunnerJobRecord | null => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.spaceId !== "string" || !SPACE_ID.test(entry.spaceId) || typeof entry.state !== "string") return null;
    const id = typeof entry.id === "string" && JOB_ID.test(entry.id) ? entry.id : null;
    return { id, spaceId: entry.spaceId, revision: safeRevision(entry.revision), phase: typeof entry.phase === "string" ? plainText(entry.phase, 60) : null, state: plainText(entry.state, 40).toLowerCase() };
  };
  const jobs = Array.isArray(raw.jobs) ? raw.jobs.map(parseJob).filter((job): job is RunnerJobRecord => Boolean(job)) : [];
  return { installed, running: parseJob(raw.running), jobs };
}

function activeRunnerJob(status: RunnerStatus): RunnerJobRecord | null {
  const running = status.running && ["starting", "running", "stopping"].includes(status.running.state) ? status.running : null;
  if (running) return running;
  return status.jobs.find((job) => job.state === "running" || job.state === "starting" || job.state === "stopping") ?? null;
}

function statusForJob(job: RunnerJobRecord): RobotAppSkillStatus {
  const phase = (job.phase ?? "").toLowerCase();
  if (["error", "failed"].includes(job.state)) return "failed";
  if (job.state === "stopped" || phase === "cancelled") return "stopped";
  if (job.state === "complete") return "complete";
  if (phase === "running") return "running";
  if (phase === "starting") return "starting";
  if (/install|venv|depend|download|clone|entry-point|queued|resolv/.test(phase)) return "installing";
  return "starting";
}

function runtimeStateFor(status: RunnerStatus, item: AppCatalogItem, own: Operation | null): RobotAppSkillRuntimeDetails {
  if (item.kind === "web") {
    const state = own?.spaceId === item.spaceId && own.kind === "web"
      ? own.status === "handoff_released" ? "handoff_released" : own.status === "handoff_requested" ? "handoff_requested" : "unknown"
      : "not_checked";
    return { state, installed: null, installedRevision: null, catalogRevision: item.revision, phase: own?.phase ?? null, jobId: own?.jobId ?? null };
  }
  const installed = status.installed.find((entry) => entry.spaceId === item.spaceId);
  const ownedJob = own?.spaceId === item.spaceId && own.jobId ? status.jobs.find((entry) => entry.id === own.jobId) : null;
  const running = status.running?.spaceId === item.spaceId && ["starting", "running", "stopping"].includes(status.running.state) ? status.running : null;
  const appJobs = status.jobs.filter((entry) => entry.spaceId === item.spaceId);
  const job = ownedJob ?? running ?? appJobs.at(-1) ?? null;
  if (job) {
    const state = statusForJob(job);
    const runtimeState: RobotAppSkillRuntimeDetails["state"] = state === "installing" || state === "starting" || state === "running"
      || state === "stopped" || state === "complete" || state === "failed" ? state : "unknown";
    return {
      state: runtimeState,
      installed: Boolean(installed) || ["starting", "running", "complete"].includes(state), installedRevision: installed?.revision ?? job.revision,
      catalogRevision: item.revision, phase: job.phase, jobId: job.id,
    };
  }
  return { state: installed ? "installed" : "not_installed", installed: Boolean(installed), installedRevision: installed?.revision ?? null, catalogRevision: item.revision, phase: null, jobId: null };
}

/** Build the fixed, safe app-skill dispatcher used by native and voice callers. */
export function createRobotAppSkills(dependencies: RobotAppSkillsDependencies): RobotAppSkillsEngine {
  const now = dependencies.now ?? (() => Date.now());
  const pollIntervalMs = dependencies.pollIntervalMs ?? 1_000;
  const runningPollIntervalMs = dependencies.runningPollIntervalMs ?? Math.max(pollIntervalMs, 2_000);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 60_000) throw new Error("Invalid app skill poll interval");
  if (!Number.isFinite(runningPollIntervalMs) || runningPollIntervalMs < 50 || runningPollIntervalMs > 60_000) throw new Error("Invalid running app status poll interval");

  let enabled = true;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  let requestCounter = 0;
  let active: Operation | null = null;
  const listeners = new Set<(snapshot: RobotAppSkillsSnapshot) => void>();
  let snapshot: RobotAppSkillsSnapshot = { enabled: true, suspended: false, status: "idle", activeApp: null, errorCode: null, updatedAt: now() };

  function externallyEnabled(): boolean {
    try { return dependencies.isEnabled?.() !== false; } catch { return false; }
  }

  function allowed(): boolean {
    return !disposed && enabled && externallyEnabled() && !suspended;
  }

  function guardCurrent(guard?: () => boolean): boolean {
    try { return !guard || guard() === true; } catch { return false; }
  }

  function operationCurrent(operation: Operation, checkTurn = false): boolean {
    if (active !== operation || operation.controller.signal.aborted || operation.generation !== generation || disposed) return false;
    if (!allowed()) return false;
    if (!operation.handedOff) {
      try { if (!dependencies.isActive()) return false; } catch { return false; }
    }
    return !checkTurn || guardCurrent(operation.turnGuard);
  }

  function makeRequestId(): string {
    let candidate = "";
    try { candidate = dependencies.createRequestId?.() ?? ""; } catch { candidate = ""; }
    if (!candidate) {
      const cryptoValue = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto;
      try { candidate = cryptoValue?.randomUUID?.() ?? ""; } catch { candidate = ""; }
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(candidate)) {
      requestCounter += 1;
      candidate = `${Math.max(0, Math.floor(now())).toString(36)}-${requestCounter.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    }
    return candidate;
  }

  function appState(operation: Operation | null): RobotAppSkillAppState | null {
    if (!operation) return null;
    return {
      id: operation.app.id,
      spaceId: operation.spaceId,
      title: operation.app.title,
      kind: operation.kind,
      status: operation.status,
      phase: operation.phase,
      jobId: operation.jobId,
      installedRevision: operation.installedRevision,
      catalogRevision: operation.catalogRevision,
      installed: operation.installed,
    };
  }

  function cloneSnapshot(value = snapshot): RobotAppSkillsSnapshot {
    return {
      ...value,
      enabled: value.enabled && enabled && externallyEnabled(),
      activeApp: value.activeApp ? { ...value.activeApp } : null,
    };
  }

  function publish(status: RobotAppSkillStatus, errorCode: RobotAppSkillErrorCode | null = null): void {
    snapshot = {
      enabled: enabled && externallyEnabled(), suspended, status, activeApp: appState(active), errorCode, updatedAt: now(),
    };
    const copy = cloneSnapshot();
    for (const listener of [...listeners]) {
      try { listener(copy); } catch { /* observers cannot own app runtime state */ }
    }
  }

  function result(status: RobotAppSkillStatus, operation: Operation | null = active, errorCode?: RobotAppSkillErrorCode): RobotAppSkillOperationResult {
    const value: RobotAppSkillOperationResult = { status };
    if (operation) {
      value.spaceId = operation.spaceId;
      if (operation.jobId) value.jobId = operation.jobId;
      if (operation.phase) value.phase = operation.phase;
      value.catalogRevision = operation.catalogRevision;
      value.installedRevision = operation.installedRevision;
    }
    if (errorCode) value.errorCode = errorCode;
    return value;
  }

  function errorResult(status: RobotAppSkillStatus, code: RobotAppSkillErrorCode, operation: Operation | null = null): RobotAppSkillOperationResult {
    return result(status, operation, code);
  }

  function initialGate(guard?: () => boolean): RobotAppSkillOperationResult | null {
    if (!guardCurrent(guard)) return errorResult("stale_turn", "stale_turn");
    if (disposed || !enabled || !externallyEnabled()) return errorResult("disabled", "disabled");
    if (suspended) return errorResult("suspended", "suspended");
    let activeNow = false;
    try { activeNow = dependencies.isActive(); } catch { activeNow = false; }
    if (!activeNow) return errorResult("unavailable", "runtime_inactive");
    return null;
  }

  async function loadCatalogItem(spaceId: string): Promise<{ item: AppCatalogItem | null; errorCode: RobotAppSkillErrorCode }> {
    let item: AppCatalogItem;
    try { item = await dependencies.catalog.get(spaceId); }
    catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const notFound = /not in a supported|not found|private space|unsupported/.test(message);
      return { item: null, errorCode: notFound ? "catalog_entry_not_found" : "catalog_unavailable" };
    }
    return validCatalogItem(item, spaceId)
      ? { item, errorCode: "catalog_entry_not_found" }
      : { item: null, errorCode: "catalog_entry_invalid" };
  }

  function activeResultFor(operation: Operation): RobotAppSkillOperationResult {
    const errorCode = operation.status === "failed" ? "app_job_failed"
      : snapshot.activeApp?.spaceId === operation.spaceId ? snapshot.errorCode ?? undefined : undefined;
    return result(operation.status, operation, errorCode);
  }

  function clearTimer(operation: Operation): void {
    if (operation.timer !== null) clearTimeout(operation.timer);
    operation.timer = null;
  }

  function releaseOperation(operation: Operation, status: RobotAppSkillStatus, code: RobotAppSkillErrorCode | null): void {
    if (active !== operation) return;
    clearTimer(operation);
    operation.controller.abort();
    operation.status = status;
    operation.phase = status;
    active = null;
    generation += 1;
    publish(status, code);
  }

  async function requestStopFor(operation: Operation): Promise<boolean> {
    if (operation.kind !== "python" || !operation.mayHaveBeenAdmitted) return true;
    if (!operation.client?.connected) return false;
    try {
      await operation.client.request("/api/apps/stop", { method: "POST", body: { requestId: operation.requestId } });
      return true;
    } catch {
      return false;
    }
  }

  async function remoteStopState(operation: Operation): Promise<RobotAppSkillStatus | null> {
    if (!operation.client?.connected || !operation.jobId) return null;
    const terminal = (job: RunnerJobRecord): RobotAppSkillStatus | null => {
      if (job.id !== operation.jobId || job.spaceId !== operation.spaceId) return null;
      if (job.state === "stopped") return "stopped";
      if (job.state === "complete") return "complete";
      if (job.state === "error" || job.state === "failed") return "failed";
      return null;
    };
    try {
      const detail = await operation.client.request<unknown>(`/api/apps/jobs/${encodeURIComponent(operation.jobId)}`);
      const job = parseRunnerStatus({ jobs: [detail] })?.jobs[0];
      if (job && job.id === operation.jobId) return terminal(job);
    } catch { /* Exact status lookup below may still return this same job. */ }
    try {
      const status = parseRunnerStatus(await operation.client.request<unknown>("/api/apps/status"));
      if (!status) return null;
      const exact = [...status.jobs, ...(status.running ? [status.running] : [])].find((job) => job.id === operation.jobId);
      return exact ? terminal(exact) : null;
    } catch {
      return null;
    }
  }

  function schedulePoll(operation: Operation, delay = pollIntervalMs): void {
    if (active !== operation || operation.timer !== null || operation.status === "complete" || operation.status === "failed" || operation.status === "stopped") return;
    operation.timer = setTimeout(() => {
      operation.timer = null;
      void poll(operation);
    }, delay);
  }

  function matchingJob(status: RunnerStatus, operation: Operation): RunnerJobRecord | null {
    if (status.running?.spaceId === operation.spaceId) return status.running;
    return status.jobs.find((job) => job.spaceId === operation.spaceId && (!operation.jobId || !job.id || job.id === operation.jobId)) ?? null;
  }

  function applyJob(operation: Operation, job: RunnerJobRecord, installed?: RunnerAppRecord): void {
    operation.jobId = job.id ?? operation.jobId;
    operation.phase = job.phase;
    operation.status = statusForJob(job);
    if (installed || ["starting", "running", "complete"].includes(operation.status)) operation.installed = true;
    operation.installedRevision = installed?.revision ?? job.revision ?? operation.installedRevision;
    if (["failed", "stopped", "complete"].includes(operation.status) && active === operation) {
      clearTimer(operation);
      active = null;
      generation += 1;
    }
    publish(operation.status, operation.status === "failed" ? "app_job_failed" : operation.status === "stopped" ? "app_stopped" : null);
  }

  async function poll(operation: Operation): Promise<void> {
    if (active !== operation) return;
    if (!operationCurrent(operation)) {
      await cancelOperation(operation, operation.controller.signal.aborted ? "operation_cancelled" : "runtime_inactive");
      return;
    }
    if (!operation.client?.connected) {
      operation.status = "unavailable";
      publish("unavailable", "companion_disconnected");
      schedulePoll(operation, Math.max(pollIntervalMs, 3_000));
      return;
    }
    try {
      const path = operation.jobId ? `/api/apps/jobs/${encodeURIComponent(operation.jobId)}` : "/api/apps/status";
      const response = await operation.client.request<unknown>(path, { signal: operation.controller.signal });
      if (active !== operation) return;
      if (!operationCurrent(operation)) {
        await cancelOperation(operation, operation.controller.signal.aborted ? "operation_cancelled" : "runtime_inactive");
        return;
      }
      let job: RunnerJobRecord | null = null;
      // A job-detail response is intentionally projected through the same whitelist as status.
      if (operation.jobId && response && typeof response === "object" && !Array.isArray(response)) {
        const detail = parseRunnerStatus({ jobs: [response] });
        job = detail?.jobs[0] ?? null;
      }
      const runner = parseRunnerStatus(response);
      if (!job && runner) job = matchingJob(runner, operation);
      if (!job || job.spaceId !== operation.spaceId || (operation.jobId && job.id && job.id !== operation.jobId)) {
        operation.status = "unavailable";
        publish("unavailable", "companion_response_invalid");
        schedulePoll(operation, Math.max(pollIntervalMs, 3_000));
        return;
      }
      const installed = runner?.installed.find((entry) => entry.spaceId === operation.spaceId);
      applyJob(operation, job, installed);
      if (["failed", "stopped", "complete"].includes(operation.status)) return;
      if (operation.status === "running") {
        schedulePoll(operation, runningPollIntervalMs);
        return;
      }
      schedulePoll(operation);
    } catch (error) {
      if (active !== operation || operation.controller.signal.aborted) return;
      if (!operationCurrent(operation)) {
        await cancelOperation(operation, "runtime_inactive");
        return;
      }
      operation.status = "unavailable";
      publish("unavailable", errorCodeFor(error, operation.controller.signal));
      schedulePoll(operation, Math.max(pollIntervalMs, 3_000));
    }
  }

  async function cancelOperation(operation: Operation, reason: RobotAppSkillErrorCode): Promise<RobotAppSkillOperationResult> {
    if (active !== operation) return result(snapshot.status, operation, snapshot.errorCode ?? undefined);
    clearTimer(operation);
    operation.controller.abort();
    operation.status = "stopping";
    operation.phase = "cancelling";
    publish("stopping", reason);
    const remoteMayNeedStop = operation.kind === "python" && operation.mayHaveBeenAdmitted;
    if (remoteMayNeedStop) {
      const stopped = await requestStopFor(operation);
      if (!stopped) {
        operation.status = "unavailable";
        operation.phase = "stop_failed";
        publish("unavailable", "stop_failed");
        const reconciled = await remoteStopState(operation);
        if (reconciled && active === operation) {
          releaseOperation(operation, reconciled, reconciled === "failed" ? "app_job_failed" : null);
          if (reason === "stale_turn") return result("stale_turn", operation, "stale_turn");
          return result(reconciled, operation, reconciled === "failed" ? "app_job_failed" : undefined);
        }
        return errorResult("unavailable", "stop_failed", operation);
      }
    }
    // Revoke the local generation only after targeted STOP is admitted. A requestId tombstone
    // prevents a late ensure-start from recreating the job even if the requests are reordered.
    if (active === operation) active = null;
    generation += 1;
    publish(reason === "stale_turn" ? "stale_turn" : "stopped", reason === "operation_cancelled" ? null : reason);
    return result(reason === "stale_turn" ? "stale_turn" : "stopped", operation, reason === "operation_cancelled" ? undefined : reason);
  }

  async function pythonStart(operation: Operation): Promise<RobotAppSkillOperationResult> {
    if (!operation.app.installable || operation.item.launch.mode !== "install") {
      releaseOperation(operation, "not_installable", "app_not_installable");
      return errorResult("not_installable", "app_not_installable", operation);
    }
    let client: RobotAppSkillCompanion | null;
    try { client = await dependencies.getCompanionConnection(); }
    catch (error) {
      if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
      const code = errorCodeFor(error, operation.controller.signal);
      releaseOperation(operation, "unavailable", code);
      return errorResult("unavailable", code, operation);
    }
    if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
    if (!client?.connected) {
      releaseOperation(operation, "unavailable", "companion_disconnected");
      return errorResult("unavailable", "companion_disconnected", operation);
    }
    operation.client = client;
    let runner: RunnerStatus | null;
    try {
      const statusResponse = await client.request<unknown>("/api/apps/status", { signal: operation.controller.signal });
      if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
      runner = parseRunnerStatus(statusResponse);
    } catch (error) {
      if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
      const code = errorCodeFor(error, operation.controller.signal);
      releaseOperation(operation, "unavailable", code);
      return errorResult("unavailable", code, operation);
    }
    if (!runner) {
      releaseOperation(operation, "unavailable", "companion_response_invalid");
      return errorResult("unavailable", "companion_response_invalid", operation);
    }
    const installed = runner.installed.find((entry) => entry.spaceId === operation.spaceId);
    operation.installed = Boolean(installed);
    operation.installedRevision = installed?.revision ?? null;
    const existing = activeRunnerJob(runner);
    if (existing) {
      releaseOperation(operation, "busy", "app_busy");
      return errorResult("busy", "app_busy", operation);
    }

    if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
    operation.status = "installing";
    operation.phase = "resolving";
    // The request is now potentially admitted by the companion. STOP uses this pinned client.
    operation.mayHaveBeenAdmitted = true;
    publish("installing", null);
    let accepted: unknown;
    try {
      // Omitting revision is deliberate: the runner reuses a cached install as-is and installs
      // its current catalog revision only on a cold first use.
      accepted = await client.request<unknown>("/api/apps/ensure-start", {
        method: "POST", body: { spaceId: operation.spaceId, requestId: operation.requestId }, signal: operation.controller.signal,
      });
    } catch (error) {
      if (active !== operation) {
        // Transport cancellation can race with admission. Repeat STOP after the response
        // boundary so an accepted composite job cannot start after local STOP.
        await requestStopFor(operation);
        return result(snapshot.status, operation, snapshot.errorCode ?? undefined);
      }
      if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
      const code = errorCodeFor(error, operation.controller.signal);
      const cancelled = await cancelOperation(operation, code);
      if (cancelled.errorCode === "stop_failed") return errorResult("unavailable", "stop_failed", operation);
      return errorResult(code === "app_busy" ? "busy" : "unavailable", code, operation);
    }
    if (active !== operation) {
      // Local STOP may have raced the accepted 202; reissue it against the pinned endpoint.
      await requestStopFor(operation);
      return result(snapshot.status, operation, snapshot.errorCode ?? undefined);
    }
    if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
    const acceptedJob = parseRunnerStatus({ jobs: [accepted] })?.jobs[0] ?? null;
    if (!acceptedJob || acceptedJob.spaceId !== operation.spaceId || !acceptedJob.id) {
      const cancelled = await cancelOperation(operation, "companion_response_invalid");
      return errorResult("unavailable", cancelled.errorCode === "stop_failed" ? "stop_failed" : "companion_response_invalid", operation);
    }
    operation.jobId = acceptedJob.id;
    operation.phase = acceptedJob.phase;
    operation.status = statusForJob(acceptedJob);
    operation.installedRevision = installed?.revision ?? acceptedJob.revision;
    operation.installed = Boolean(installed) || ["starting", "running"].includes((acceptedJob.phase ?? "").toLowerCase());
    // The voice turn guarded admission. Polling and an accepted app lifecycle are now independent.
    operation.turnGuard = undefined;
    if (["failed", "stopped", "complete"].includes(operation.status)) {
      active = null;
      generation += 1;
      publish(operation.status, operation.status === "failed" ? "app_job_failed" : operation.status === "stopped" ? "app_stopped" : null);
    } else {
      publish(operation.status, null);
    }
    if (operation.status === "failed") {
      return errorResult("failed", "app_job_failed", operation);
    }
    if (operation.status === "stopped" || operation.status === "complete") {
      return result(operation.status, operation);
    }
    schedulePoll(operation, operation.status === "running" ? runningPollIntervalMs : pollIntervalMs);
    return activeResultFor(operation);
  }

  async function hostedStart(operation: Operation): Promise<RobotAppSkillOperationResult> {
    const url = validatedHostedUrl(operation.item);
    if (!url) {
      releaseOperation(operation, "failed", "hosted_url_invalid");
      return errorResult("failed", "hosted_url_invalid", operation);
    }
    operation.status = "preparing";
    operation.phase = "preparing";
    publish("preparing", null);
    let prepared: boolean | void;
    try {
      prepared = await dependencies.prepareHosted({ signal: operation.controller.signal });
    } catch (error) {
      if (active !== operation) return result(snapshot.status, operation, snapshot.errorCode ?? undefined);
      if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
      releaseOperation(operation, "unavailable", errorCodeFor(error, operation.controller.signal));
      return errorResult("unavailable", "hosted_prepare_failed", operation);
    }
    if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
    if (prepared === false) {
      releaseOperation(operation, "unavailable", "hosted_prepare_failed");
      return errorResult("unavailable", "hosted_prepare_failed", operation);
    }
    operation.handedOff = true;
    operation.status = "handoff_requested";
    operation.phase = "handoff_requested";
    publish("handoff_requested", null);
    try {
      // Browser APIs can resolve only after the user closes the browser. Start them without
      // holding the voice turn open; a later rejection updates the state but never claims running.
      const opened = dependencies.openHosted(url);
      Promise.resolve(opened).catch(() => {
        if (active === operation) releaseOperation(operation, "handoff_failed", "hosted_open_failed");
      });
    } catch {
      releaseOperation(operation, "handoff_failed", "hosted_open_failed");
      return errorResult("handoff_failed", "hosted_open_failed", operation);
    }
    return activeResultFor(operation);
  }

  async function search(query: string, limit = 5): Promise<RobotAppSkillSearchResult> {
    if (disposed || !enabled || !externallyEnabled()) return { status: "disabled", query: "", limit: 1, total: 0, metadataTrust: "untrusted_plain_text", items: [], errorCode: "disabled" };
    if (typeof query !== "string" || query.length > MAX_QUERY_LENGTH) return { status: "invalid_request", query: "", limit: 1, total: 0, metadataTrust: "untrusted_plain_text", items: [], errorCode: "invalid_query" };
    const normalizedQuery = plainText(query, MAX_QUERY_LENGTH);
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(MAX_TOP_K, Math.floor(limit))) : 5;
    try {
      // Deliberately no family filter: every catalog app is available to the same dispatcher.
      const result = await dependencies.catalog.list({ query: normalizedQuery, limit: normalizedLimit });
      if (disposed || !enabled || !externallyEnabled()) return { status: "disabled", query: normalizedQuery, limit: normalizedLimit, total: 0, metadataTrust: "untrusted_plain_text", items: [], errorCode: "disabled" };
      const items = result.items.filter((item) => item && SPACE_ID.test(item.spaceId) && validCatalogItem(item, item.spaceId))
        .slice(0, normalizedLimit).map(compactSearchProjection);
      return { status: "listed", query: normalizedQuery, limit: normalizedLimit, total: Math.max(items.length, result.total), metadataTrust: "untrusted_plain_text", items };
    } catch {
      return { status: "unavailable", query: normalizedQuery, limit: normalizedLimit, total: 0, metadataTrust: "untrusted_plain_text", items: [], errorCode: "catalog_unavailable" };
    }
  }

  async function describe(spaceId: string): Promise<RobotAppSkillDescription> {
    if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) return { status: "invalid_request", errorCode: "invalid_space_id" };
    const loaded = await loadCatalogItem(spaceId);
    const item = loaded.item;
    if (!item) return { status: loaded.errorCode === "catalog_entry_not_found" ? "not_found" : "unavailable", errorCode: loaded.errorCode };
    const app = catalogProjection(item);
    if (item.kind !== "python") return { status: "described", app, runtime: runtimeStateFor({ installed: [], running: null, jobs: [] }, item, active) };
    if (!allowed()) return { status: "disabled", app, runtime: { state: "unknown", installed: null, installedRevision: null, catalogRevision: item.revision, phase: null, jobId: null, errorCode: suspended ? "suspended" : "disabled" }, errorCode: suspended ? "suspended" : "disabled" };
    try {
      const operation = active?.spaceId === spaceId && active.kind === "python" ? active : null;
      const client = operation?.client ?? await dependencies.getCompanionConnection();
      if (!client?.connected) return { status: "unavailable", app, runtime: { state: "unknown", installed: null, installedRevision: null, catalogRevision: item.revision, phase: null, jobId: null, errorCode: "companion_disconnected" }, errorCode: "companion_disconnected" };
      const statusValue = await client.request<unknown>("/api/apps/status");
      const status = parseRunnerStatus(statusValue);
      if (!status) return { status: "unavailable", app, runtime: { state: "unknown", installed: null, installedRevision: null, catalogRevision: item.revision, phase: null, jobId: null, errorCode: "companion_response_invalid" }, errorCode: "companion_response_invalid" };
      let observed = operation?.jobId ? status.jobs.find((job) => job.id === operation.jobId) ?? null : null;
      if (operation?.jobId && !observed) {
        try {
          const detail = await client.request<unknown>(`/api/apps/jobs/${encodeURIComponent(operation.jobId)}`);
          const job = parseRunnerStatus({ jobs: [detail] })?.jobs[0] ?? null;
          if (job?.id === operation.jobId && job.spaceId === spaceId) observed = job;
        } catch { /* Use the status snapshot below if the job detail is no longer available. */ }
      }
      if (operation && active === operation) {
        if (observed) {
          applyJob(operation, observed, status.installed.find((entry) => entry.spaceId === spaceId));
        } else if (status.running?.spaceId === spaceId && ["starting", "running"].includes(status.running.state)) {
          const running = { ...status.running, id: operation.jobId ?? status.running.id, phase: status.running.phase ?? "running" };
          applyJob(operation, running, status.installed.find((entry) => entry.spaceId === spaceId));
        } else if (operation.mayHaveBeenAdmitted && operation.jobId
          && !status.jobs.some((job) => job.spaceId === spaceId && ["running", "starting", "stopping"].includes(job.state))) {
          releaseOperation(operation, "stopped", "app_stopped");
        }
      }
      return { status: "described", app, runtime: runtimeStateFor(status, item, operation) };
    } catch (error) {
      const code = errorCodeFor(error);
      return { status: "unavailable", app, runtime: { state: "unknown", installed: null, installedRevision: null, catalogRevision: item.revision, phase: null, jobId: null, errorCode: code }, errorCode: code };
    }
  }

  async function start(spaceId: string, options: { isCurrent?: () => boolean } = {}): Promise<RobotAppSkillOperationResult> {
    const gate = initialGate(options.isCurrent);
    if (gate) return gate;
    if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) return errorResult("invalid_request", "invalid_space_id", null);
    if (active) {
      if (active.spaceId === spaceId) return activeResultFor(active);
      return errorResult("busy", "app_busy", active);
    }
    const operation: Operation = {
      generation: ++generation,
      spaceId,
      requestId: makeRequestId(),
      app: { id: APP_ID(spaceId), spaceId, title: spaceId.split("/").at(-1) ?? spaceId, description: "", author: "", kind: "python", tags: [], revision: null, installable: false, metadataTrust: "untrusted_plain_text" },
      item: null as unknown as AppCatalogItem,
      kind: "python",
      controller: new AbortController(),
      client: null,
      jobId: null,
      phase: "resolving",
      status: "resolving",
      catalogRevision: null,
      installedRevision: null,
      installed: null,
      mayHaveBeenAdmitted: false,
      handedOff: false,
      turnGuard: options.isCurrent,
      timer: null,
    };
    active = operation;
    publish("resolving", null);
    const loaded = await loadCatalogItem(spaceId);
    if (!operationCurrent(operation, true)) return cancelOperation(operation, "stale_turn");
    const item = loaded.item;
    if (!item) {
      const notFound = loaded.errorCode === "catalog_entry_not_found";
      const unavailable = loaded.errorCode === "catalog_unavailable";
      const status = notFound ? "not_found" : unavailable ? "unavailable" : "failed";
      releaseOperation(operation, status, loaded.errorCode);
      return errorResult(status, loaded.errorCode, operation);
    }
    operation.item = item;
    operation.app = catalogProjection(item);
    operation.kind = item.kind;
    operation.catalogRevision = item.revision && COMMIT.test(item.revision) ? item.revision.toLowerCase() : null;
    operation.installed = item.kind === "web" ? null : false;
    publish("resolving", null);
    if (item.kind === "python") return pythonStart(operation);
    return hostedStart(operation);
  }

  async function stop(): Promise<RobotAppSkillOperationResult> {
    const operation = active;
    if (!operation) {
      publish("stopped", null);
      return result("stopped", null);
    }
    clearTimer(operation);
    operation.controller.abort();
    operation.status = "stopping";
    operation.phase = "stopping";
    publish("stopping", null);
    if (operation.kind === "web") {
      if (!operation.handedOff) {
        if (active === operation) active = null;
        generation += 1;
        publish("stopped", null);
        return result("stopped", operation);
      }
      let closed = false;
      let closeFailed = false;
      try { closed = await dependencies.stopHosted?.() === true; }
      catch { closeFailed = true; }
      active = null;
      generation += 1;
      const status = closed ? "stopped" : "handoff_released";
      const errorCode = closeFailed ? "hosted_close_failed" : undefined;
      publish(status, errorCode ?? null);
      return result(status, operation, errorCode);
    }
    if (!operation.mayHaveBeenAdmitted) {
      active = null;
      generation += 1;
      publish("stopped", null);
      return result("stopped", operation);
    }
    const stopped = await requestStopFor(operation);
    if (!stopped) {
      operation.status = "unavailable";
      operation.phase = "stop_failed";
      publish("unavailable", "stop_failed");
      const reconciled = await remoteStopState(operation);
      if (reconciled && active === operation) {
        releaseOperation(operation, reconciled, reconciled === "failed" ? "app_job_failed" : null);
        return result(reconciled, operation, reconciled === "failed" ? "app_job_failed" : undefined);
      }
      // Keep the request/job identity and pinned client so STOP can be retried safely.
      return errorResult("unavailable", "stop_failed", operation);
    }
    if (active === operation) releaseOperation(operation, "stopped", null);
    else publish("stopped", null);
    return result("stopped", operation);
  }

  async function setEnabled(value: boolean): Promise<void> {
    enabled = value === true;
    let cancellationCode: RobotAppSkillErrorCode | null = null;
    if (!enabled && active) {
      const stopped = await stop();
      cancellationCode = stopped.errorCode ?? null;
    }
    publish(enabled ? (active?.status ?? "idle") : "disabled", enabled ? null : cancellationCode ?? "disabled");
  }

  async function suspend(reason = "suspended"): Promise<RobotAppSkillOperationResult> {
    suspended = true;
    const operation = active;
    const backgroundPresentation = ["appstate-inactive", "app-state-change", "app-background", "background", "presentation"].includes(reason);
    if (operation?.kind === "web" && operation.handedOff && backgroundPresentation) {
      publish(operation.status, null);
      return activeResultFor(operation);
    }
    if (operation) {
      if (operation.kind === "web" && operation.handedOff) {
        const released = await stop();
        const errorCode = released.errorCode === "hosted_close_failed" ? "hosted_close_failed" : "suspended";
        publish("suspended", errorCode);
        return { ...released, status: released.status === "handoff_released" ? "handoff_released" : "suspended", errorCode };
      }
      const cancelled = await cancelOperation(operation, "operation_cancelled");
      const errorCode = cancelled.errorCode === "stop_failed" ? "stop_failed" : "suspended";
      publish("suspended", errorCode);
      return { ...cancelled, status: "suspended", errorCode };
    }
    publish("suspended", "suspended");
    return result("suspended", null, "suspended");
  }

  function resume(): void {
    if (disposed) return;
    suspended = false;
    publish(active?.status ?? "idle", null);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    suspended = true;
    enabled = false;
    const operation = active;
    if (operation) {
      clearTimer(operation);
      operation.controller.abort();
      if (operation.kind === "web" && operation.handedOff) {
        let closed = false;
        let closeFailed = false;
        try { closed = await dependencies.stopHosted?.() === true; } catch { closeFailed = true; }
        active = null;
        generation += 1;
        publish(closed ? "stopped" : "handoff_released", closeFailed ? "hosted_close_failed" : null);
      } else if (operation.kind === "python" && operation.mayHaveBeenAdmitted) {
        const stopped = await requestStopFor(operation);
        if (stopped) {
          if (active === operation) releaseOperation(operation, "stopped", null);
          else publish("stopped", null);
        } else {
          operation.status = "unavailable";
          operation.phase = "stop_failed";
          publish("unavailable", "stop_failed");
          const reconciled = await remoteStopState(operation);
          if (reconciled && active === operation) releaseOperation(operation, reconciled, reconciled === "failed" ? "app_job_failed" : null);
        }
      } else {
        if (active === operation) releaseOperation(operation, "stopped", null);
        else publish("stopped", null);
      }
    } else publish("stopped", null);
    listeners.clear();
  }

  return Object.freeze({
    search,
    describe,
    start,
    stop,
    getSnapshot: () => cloneSnapshot(),
    subscribe(listener: (next: RobotAppSkillsSnapshot) => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setEnabled,
    suspend,
    resume,
    dispose,
  });
}
