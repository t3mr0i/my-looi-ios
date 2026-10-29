import { IDENTITY_HEAD } from "./types";
import type {
  RobotBackend, RobotCommand, RobotCommandOptions, RobotCore, RobotPose,
  RobotResult, RobotSession, RobotSnapshot,
} from "./types";
import {
  availableRobotAppActionNames,
  EMPTY_ROBOT_APP_ACTION_PROFILE,
  normalizeRobotAppActionProfile,
  resolveRobotAppAction,
} from "./action-profile";
import type { RobotAppActionProfile, ResolvedRobotAppAction } from "./action-profile";

type Clock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};
type Work = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null };

function finite(value: unknown, limit = 100): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Validate physical values before copying: JSON alone would silently turn NaN into null. */
export function validateRobotCommand(value: unknown): value is RobotCommand {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.kind === "target") {
    if (!c.pose || typeof c.pose !== "object" || Array.isArray(c.pose)) return false;
    const p = c.pose as Record<string, unknown>;
    if (Object.keys(p).some((key) => !["head", "antennas", "bodyYaw"].includes(key))) return false;
    if (p.head !== undefined) {
      if (!Array.isArray(p.head) || p.head.length !== 16 || !p.head.every((v) => finite(v))) return false;
      const h = p.head as number[];
      if (Math.abs(h[12]) + Math.abs(h[13]) + Math.abs(h[14]) + Math.abs(h[15] - 1) > 1e-5) return false;
      // Reject scaled, reflected and degenerate transforms, not just non-finite matrices.
      for (let r = 0; r < 3; r += 1) for (let s = 0; s < 3; s += 1) {
        const dot = h[r * 4] * h[s * 4] + h[r * 4 + 1] * h[s * 4 + 1] + h[r * 4 + 2] * h[s * 4 + 2];
        if (Math.abs(dot - (r === s ? 1 : 0)) > 0.02) return false;
      }
      const det = h[0] * (h[5] * h[10] - h[6] * h[9]) - h[1] * (h[4] * h[10] - h[6] * h[8]) + h[2] * (h[4] * h[9] - h[5] * h[8]);
      if (Math.abs(det - 1) > 0.02) return false;
      if (![h[3], h[7], h[11]].every((v) => finite(v, 1))) return false;
    }
    if (p.antennas !== undefined && (!Array.isArray(p.antennas) || p.antennas.length !== 2 || !p.antennas.every((v) => finite(v, 20)))) return false;
    if (p.bodyYaw !== undefined && !finite(p.bodyYaw, 20)) return false;
    return Object.keys(p).length > 0 && (c.durationMs === undefined || (finite(c.durationMs, 30_000) && c.durationMs >= 0));
  }
  if (c.kind === "drive") return finite(c.forward, 10) && finite(c.lateral, 10) && finite(c.yawRate, 20)
    && finite(c.durationMs, 1_800) && c.durationMs >= 0;
  if (c.kind === "gesture") return typeof c.name === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(c.name);
  if (c.kind === "light") return typeof c.enabled === "boolean";
  if (c.kind === "volume") return finite(c.value, 100) && c.value >= 0;
  return false;
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function lane(command: RobotCommand): string {
  return command.kind === "target" || command.kind === "gesture" ? "pose" : command.kind;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One app owns the backend. STOP bypasses queues and synchronously invalidates every lease. */
export function createRobotCore(backend: RobotBackend, options: {
  clock?: Clock;
  /** The caller owns persistence; each command captures one normalized profile snapshot. */
  getActionProfile?: () => RobotAppActionProfile;
} = {}): RobotCore {
  const clock: Clock = options.clock ?? { now: () => performance.now(), setTimeout, clearTimeout };
  let active = true;
  let disposed = false;
  let generation = 0;
  let nextId = 0;
  let current: RobotSession | null = null;
  let virtualPose: RobotPose = { head: [...IDENTITY_HEAD], antennas: [0, 0], bodyYaw: 0 };
  let lastResult: RobotResult | null = null;
  const listeners = new Set<(snapshot: RobotSnapshot) => void>();
  const work = new Map<string, Work>();
  const queues = new Map<string, Promise<unknown>>();
  let stopBarrier: Promise<void> = Promise.resolve();
  const actionProfilesEnabled = typeof options.getActionProfile === "function";

  function captureActionProfile(): RobotAppActionProfile {
    try {
      return options.getActionProfile
        ? normalizeRobotAppActionProfile(options.getActionProfile())
        : EMPTY_ROBOT_APP_ACTION_PROFILE;
    } catch {
      // Corrupt or unavailable persisted preferences never broaden robot capabilities.
      return EMPTY_ROBOT_APP_ACTION_PROFILE;
    }
  }

  function capabilitiesFor(profile: RobotAppActionProfile) {
    if (!actionProfilesEnabled) return backend.capabilities;
    return {
      ...backend.capabilities,
      gestures: availableRobotAppActionNames(backend.capabilities, profile),
    };
  }

  function inspect(): RobotSnapshot {
    return copy({ schemaVersion: 1, backend: backend.id, capabilities: capabilitiesFor(captureActionProfile()),
      sessionId: current?.id ?? null, active: active && !disposed, generation,
      virtualPose, observed: backend.inspect(), lastResult });
  }
  function emit() {
    const snapshot = inspect();
    for (const listener of listeners) { try { listener(copy(snapshot)); } catch { /* observers do not control actuation */ } }
  }
  function subscribe(listener: (snapshot: RobotSnapshot) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  function invalidate() {
    generation += 1;
    for (const pending of work.values()) {
      pending.controller.abort();
      if (pending.timer !== null) clock.clearTimeout(pending.timer);
    }
    work.clear();
  }
  function stop(reason = "bridge-stop"): Promise<void> {
    invalidate();
    // Invoke immediately; chaining behind an execute would allow a pending start to win.
    let stopping: Promise<void>;
    try { stopping = Promise.resolve(backend.stop(reason)); } catch (error) { stopping = Promise.reject(error); }
    stopBarrier = Promise.all([stopBarrier.catch(() => undefined), stopping]).then(() => undefined);
    emit();
    return stopBarrier;
  }

  function openSession(sessionOptions: { id?: string; allowApproximation?: boolean } = {}): RobotSession {
    if (!active || disposed) throw new Error("Robot bridge is suspended");
    if (current) throw new Error("Robot bridge is busy with another app");
    const id = sessionOptions.id ?? `app-${++nextId}`;
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) throw new Error("Invalid app session id");
    const sequences = new Map<string, number>();
    let closed = false;

    function result(commandId: number, status: RobotResult["status"], limitations: string[], message?: string): RobotResult {
      return { sessionId: id, commandId, status, limitations, ...(message ? { message } : {}) };
    }
    function execute(input: RobotCommand, meta: RobotCommandOptions = {}): Promise<RobotResult> {
      const commandId = ++nextId;
      // Resolve app-provided action names before validation, lane selection, sequence checks,
      // queue replacement, or deadline admission. Each request uses this captured profile.
      const actionProfile = actionProfilesEnabled ? captureActionProfile() : EMPTY_ROBOT_APP_ACTION_PROFILE;
      let resolution: ResolvedRobotAppAction | null = null;
      if (actionProfilesEnabled && isRecord(input) && input.kind === "gesture" && typeof input.name === "string") {
        resolution = resolveRobotAppAction(input.name, actionProfile, backend.capabilities);
        if (!resolution) {
          return Promise.resolve(result(commandId, "unsupported", ["unsupported_app_action"], `Unsupported robot app action '${input.name}'.`));
        }
      }
      const command = copy(resolution?.command ?? input);
      if (!validateRobotCommand(command)) return Promise.resolve(result(commandId, "rejected", ["invalid_command"]));
      if (closed || current !== session || !active || disposed) return Promise.resolve(result(commandId, "cancelled", ["session_closed"]));
      const key = lane(command);
      const previousSequence = sequences.get(key) ?? -1;
      const sequence = meta.sequence ?? previousSequence + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence <= previousSequence) return Promise.resolve(result(commandId, "rejected", ["stale_sequence"]));
      const ttl = meta.ttlMs ?? (resolution && command.kind === "gesture"
        ? 3_000
        : Math.max(1_200, command.kind === "drive" ? command.durationMs + 200 : 1_200));
      if (!Number.isFinite(ttl) || ttl < 1 || ttl > 5_000) return Promise.resolve(result(commandId, "rejected", ["invalid_deadline"]));
      if (command.kind === "drive" && command.durationMs > ttl) return Promise.resolve(result(commandId, "rejected", ["duration_exceeds_deadline"]));
      sequences.set(key, sequence);
      const previous = work.get(key);
      previous?.controller.abort();
      if (previous?.timer !== null && previous?.timer !== undefined) clock.clearTimeout(previous.timer);
      const pending: Work = { controller: new AbortController(), timer: null };
      work.set(key, pending);
      const capturedGeneration = generation;
      const deadline = clock.now() + ttl;
      const isCurrent = () => !pending.controller.signal.aborted && !closed && current === session
        && active && !disposed && capturedGeneration === generation && work.get(key) === pending && clock.now() < deadline;
      pending.timer = clock.setTimeout(() => { if (work.get(key) === pending) void stop("bridge-command-expired").catch(() => undefined); }, ttl);

      const run = async (): Promise<RobotResult> => {
        try { await stopBarrier; } catch { return result(commandId, "rejected", ["stop_failed"]); }
        if (!isCurrent()) return result(commandId, "cancelled", ["superseded_or_expired"]);
        let finished: RobotResult;
        try {
          let abortListener: (() => void) | undefined;
          const aborted = new Promise<RobotResult>((resolve) => {
            abortListener = () => resolve(result(commandId, "cancelled", ["superseded_or_expired"]));
            pending.controller.signal.addEventListener("abort", abortListener, { once: true });
          });
          let applied;
          try {
            applied = await Promise.race([backend.execute(command, {
              signal: pending.controller.signal, isCurrent,
              allowApproximation: sessionOptions.allowApproximation === true
                || (!!resolution && (command.kind === "target" || command.kind === "drive")),
            }), aborted]);
          } finally {
            if (abortListener) pending.controller.signal.removeEventListener("abort", abortListener);
          }
          finished = isCurrent() ? {
            ...applied,
            ...(resolution?.adapted && (applied.status === "applied" || applied.status === "adapted")
              ? { status: "adapted" as const, applied: copy(command) }
              : {}),
            sessionId: id,
            commandId,
          }
            : result(commandId, "cancelled", ["superseded_or_expired"]);
          if (isCurrent() && command.kind === "target" && ["adapted", "applied"].includes(finished.status)) {
            virtualPose = { ...virtualPose, ...copy(command.pose) };
          }
        } catch (error) {
          finished = result(commandId, isCurrent() ? "rejected" : "cancelled", ["backend_error"], error instanceof Error ? error.message : String(error));
        } finally {
          if (pending.timer !== null) clock.clearTimeout(pending.timer);
          if (work.get(key) === pending) work.delete(key);
        }
        lastResult = copy(finished);
        emit();
        return finished;
      };
      const queued = (queues.get(key) ?? Promise.resolve()).then(run, run);
      queues.set(key, queued.catch(() => undefined));
      // A skipped command must still release its deadline without deleting its successor.
      return queued.finally(() => {
        if (pending.timer !== null) clock.clearTimeout(pending.timer);
        if (work.get(key) === pending) work.delete(key);
      });
    }

    const session: RobotSession = {
      id, get closed() { return closed || current !== session || disposed; }, execute,
      stop: (reason) => current === session ? stop(reason) : Promise.resolve(),
      async close(reason = "bridge-session-closed") {
        if (closed) return;
        closed = true;
        if (current === session) { current = null; await stop(reason); }
      },
      inspect, subscribe,
    };
    current = session;
    emit();
    return session;
  }

  return {
    openSession, stop, inspect, subscribe,
    async setActive(next) {
      if (disposed || active === next) return;
      active = next;
      if (!next) { const session = current; current = null; await stop("bridge-suspended"); if (session) await session.close(); }
      emit();
    },
    async dispose() { if (disposed) return; disposed = true; current = null; await stop("bridge-disposed"); listeners.clear(); },
  };
}
