import {
  ROBOT_APP_SKILL_TOOL_NAMES,
} from "./robot-app-skill-tool-definitions";

const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const MAX_QUERY_CODE_POINTS = 120;
const MAX_TOOL_RESULT_CHARACTERS = 20_000;
const DEFAULT_SEARCH_LIMIT = 5;
const FAILED_RUNTIME_STATUSES = new Set([
  "busy",
  "cancelled",
  "disabled",
  "failed",
  "handoff_failed",
  "handoff_released",
  "invalid_request",
  "not_found",
  "not_installable",
  "stale_turn",
  "suspended",
  "unavailable",
]);

export type RobotAppSkillTurn = {
  sessionId: string;
  userTurnRevision: number;
  userText: string;
  isCurrent(): boolean;
  /** Turn-based voice cannot supervise apps that may control physical hardware. */
  allowAppStart?: boolean;
};

export type RobotAppSkillRuntime = {
  searchRobotAppSkills(query: string, limit?: number): Promise<unknown>;
  describeRobotAppSkill(spaceId: string): Promise<unknown>;
  startRobotAppSkill(spaceId: string, options?: { isCurrent?: () => boolean }): Promise<unknown>;
  stopRobotAppSkills(): Promise<unknown>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function safeArguments(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

function stale(): Record<string, unknown> {
  return { ok: false, status: "stale-turn" };
}

function clonePlainJson(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("json-depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error("json-array-size");
    return value.map((entry) => clonePlainJson(entry, depth + 1));
  }
  if (!isPlainRecord(value)) throw new Error("not-plain-json");
  const keys = Object.keys(value);
  if (keys.length > 200) throw new Error("json-object-size");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) result[key] = clonePlainJson(value[key], depth + 1);
  return result;
}

function normalizeRuntimeResult(value: unknown): Record<string, unknown> {
  try {
    const cloned = clonePlainJson(value);
    const serialized = JSON.stringify(cloned);
    if (!serialized || serialized.length > MAX_TOOL_RESULT_CHARACTERS) {
      return { ok: false, status: "result-too-large" };
    }
    if (!isPlainRecord(cloned)) return { ok: true, result: cloned };
    const failed = cloned.ok === false
      || typeof cloned.errorCode === "string"
      || typeof cloned.status === "string" && FAILED_RUNTIME_STATUSES.has(cloned.status);
    return { ...cloned, ok: !failed };
  } catch {
    return { ok: false, status: "invalid-runtime-result" };
  }
}

function normalizeQuery(args: Record<string, unknown>): { query: string; limit: number } | null {
  if (!hasOnlyKeys(args, ["query", "limit"]) || typeof args.query !== "string") return null;
  const query = args.query.trim();
  if (Array.from(query).length > MAX_QUERY_CODE_POINTS || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) return null;
  let limit = DEFAULT_SEARCH_LIMIT;
  if (args.limit !== undefined && args.limit !== null) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10) return null;
    limit = args.limit;
  }
  return { query, limit };
}

function normalizeSpaceId(args: Record<string, unknown>): string | null {
  if (!hasOnlyKeys(args, ["space_id"]) || typeof args.space_id !== "string" || !SPACE_ID.test(args.space_id)) return null;
  return args.space_id;
}

const defaultRuntime: RobotAppSkillRuntime = {
  async searchRobotAppSkills(query, limit) {
    return (await import("../robot-bridge/app-skill-runtime")).searchRobotAppSkills(query, limit);
  },
  async describeRobotAppSkill(spaceId) {
    return (await import("../robot-bridge/app-skill-runtime")).describeRobotAppSkill(spaceId);
  },
  async startRobotAppSkill(spaceId, options) {
    return (await import("../robot-bridge/app-skill-runtime")).startRobotAppSkill(spaceId, options);
  },
  async stopRobotAppSkills() {
    return (await import("../robot-bridge/app-skill-runtime")).stopRobotAppSkills();
  },
};

/** One shared runtime bridge serves both Realtime transports and the text voice path. */
export function createRobotAppSkillToolBridge(runtime: RobotAppSkillRuntime = defaultRuntime) {
  let lastStart: { sessionId: string; userTurnRevision: number } | null = null;

  return {
    async execute(name: string, rawArgs: unknown, turn: RobotAppSkillTurn): Promise<Record<string, unknown>> {
      if (!turn.isCurrent()) return stale();
      if (!ROBOT_APP_SKILL_TOOL_NAMES.has(name)) return { ok: false, status: "unsupported-tool" };
      const args = safeArguments(rawArgs);
      if (!args) return { ok: false, status: "invalid-arguments" };

      try {
        if (name === "search_robot_apps") {
          const normalized = normalizeQuery(args);
          if (!normalized) return { ok: false, status: "invalid-arguments" };
          const result = await runtime.searchRobotAppSkills(normalized.query, normalized.limit);
          return turn.isCurrent() ? normalizeRuntimeResult(result) : stale();
        }
        if (name === "describe_robot_app") {
          const spaceId = normalizeSpaceId(args);
          if (!spaceId) return { ok: false, status: "invalid-arguments" };
          const result = await runtime.describeRobotAppSkill(spaceId);
          return turn.isCurrent() ? normalizeRuntimeResult(result) : stale();
        }
        if (name === "start_robot_app") {
          const spaceId = normalizeSpaceId(args);
          if (!spaceId) return { ok: false, status: "invalid-arguments" };
          if (turn.allowAppStart === false) {
            return { ok: false, status: "start_requires_realtime", reason: "continuous_stop_unavailable" };
          }
          if (lastStart?.sessionId === turn.sessionId && lastStart.userTurnRevision === turn.userTurnRevision) {
            return { ok: false, status: "already-started-this-turn" };
          }
          if (!turn.isCurrent()) return stale();
          // Mark before the async install/launch boundary: a timeout or stale
          // return can have an uncertain outcome and must not cause duplicate work.
          lastStart = { sessionId: turn.sessionId, userTurnRevision: turn.userTurnRevision };
          const result = await runtime.startRobotAppSkill(spaceId, { isCurrent: turn.isCurrent });
          return turn.isCurrent() ? normalizeRuntimeResult(result) : stale();
        }
        if (Object.keys(args).length !== 0) return { ok: false, status: "invalid-arguments" };
        const result = await runtime.stopRobotAppSkills();
        return turn.isCurrent() ? normalizeRuntimeResult(result) : stale();
      } catch {
        return { ok: false, status: "unavailable" };
      }
    },
  };
}

export const robotAppSkillToolBridge = createRobotAppSkillToolBridge();
