import type { InterfaceLanguage } from "../i18n/ui-language";

export const MAX_AGENT_QUERY_LENGTH = 2000;
export const AGENT_TASK_STATUSES = ["queued", "running", "cancelling", "completed", "failed", "cancelled", "interrupted"] as const;
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];
export type AgentTask = {
  id: string;
  query: string;
  language: InterfaceLanguage;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
  answer: string | null;
  sources: Array<{ title: string; url: string }>;
  error: string | null;
};
export type PendingAgentTask = Pick<AgentTask, "id" | "query" | "language">;
export type AgentConnection = { url: string; token: string };
export type AgentErrorCode = "not_configured" | "invalid_connection" | "invalid_query" | "pending_submission" | "timeout" | "cancelled" | "network" | "auth" | "not_found" | "conflict" | "busy" | "response" | "api" | "storage";

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, readonly status?: number) {
    super(code);
    this.name = "AgentError";
  }
}

export function getAgentErrorCode(error: unknown): AgentErrorCode {
  return error instanceof AgentError ? error.code : "api";
}

export function isTerminalAgentTask(status: AgentTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

export function normalizeAgentConnection(url: string, token: string): AgentConnection {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) throw new Error();
    if (!/^[A-Za-z0-9_-]{32,512}$/.test(token.trim())) throw new Error();
    return { url: parsed.origin, token: token.trim() };
  } catch {
    throw new AgentError("invalid_connection");
  }
}

export function validateAgentQuery(value: string): string {
  const query = value.trim();
  if (query.length < 2 || Array.from(query).length > MAX_AGENT_QUERY_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(query)) throw new AgentError("invalid_query");
  return query;
}

export function validateAgentTaskId(id: unknown): string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new AgentError("response");
  return id;
}

export function parseAgentTask(value: unknown, expectedId?: string, summary = false): AgentTask {
  if (!isRecord(value)) throw new AgentError("response");
  const id = validateAgentTaskId(value.id);
  if (expectedId && id !== expectedId) throw new AgentError("response");
  if (typeof value.query !== "string" || !value.query.trim() || Array.from(value.query).length > MAX_AGENT_QUERY_LENGTH || !["en", "ru", "uk", "de"].includes(String(value.language)) || !AGENT_TASK_STATUSES.includes(value.status as AgentTaskStatus)) throw new AgentError("response");
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) throw new AgentError("response");
  if (value.answer !== null && (typeof value.answer !== "string" || value.answer.length > 32_000)) throw new AgentError("response");
  if (value.error !== null && (typeof value.error !== "string" || value.error.length > 120)) throw new AgentError("response");
  if (!Array.isArray(value.sources) || value.sources.length > 10) throw new AgentError("response");
  const sources = value.sources.map((source) => {
    if (!isRecord(source) || typeof source.title !== "string" || source.title.length > 500 || typeof source.url !== "string" || source.url.length > 4096) throw new AgentError("response");
    try {
      const url = new URL(source.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error();
      return { title: source.title, url: url.href };
    } catch { throw new AgentError("response"); }
  });
  if (!summary && value.status === "completed" && (typeof value.answer !== "string" || !value.answer.trim())) throw new AgentError("response");
  return { id, query: value.query, language: value.language as InterfaceLanguage, status: value.status as AgentTaskStatus, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string, answer: value.answer as string | null, error: value.error as string | null, sources };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
