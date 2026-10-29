import { AgentError, type AgentTask, type PendingAgentTask } from "../agent/agent-protocol";
import type { InterfaceLanguage } from "../i18n/ui-language";
import { HERMES_TASK_TOOL_NAMES } from "./hermes-task-tool-definitions";
import { isGenericHermesAcceptance, offeredHermesTask, watchHermesCompletion } from "./hermes-completion-watch";

const MAX_LISTED_TASKS = 10;
const MAX_REFERENCE_PAGES = 5;
const MAX_SPOKEN_RESULT_CHARACTERS = 2_400;
const REFERENCE_STOP_WORDS = new Set([
  "hermes", "task", "tasks", "research", "researching", "about", "what", "which", "were", "was", "the", "and", "for", "from", "this", "that", "with", "did", "you", "find", "result", "results", "please",
  "bitte", "welche", "welcher", "welches", "war", "waren", "das", "der", "die", "und", "für", "mit", "hast", "du", "gefunden", "ergebnis", "ergebnisse", "recherche", "aufgabe", "aufgaben",
  "это", "что", "где", "как", "было", "были", "ты", "нашел", "нашёл", "результат", "задача", "задачи", "исследование", "про", "для", "яке", "який", "яка", "було", "були", "ти", "знайшов", "результат", "завдання", "дослідження",
]);

export type HermesTaskTurn = {
  sessionId: string;
  userTurnRevision: number;
  userText: string;
  language: InterfaceLanguage;
  isCurrent(): boolean;
  canWatchCompletion?(): boolean;
};

export type HermesTaskVoiceDependencies = {
  submit(query: string, language: InterfaceLanguage): Promise<AgentTask>;
  listPage(cursor?: string): Promise<{ tasks: AgentTask[]; nextCursor: string | null }>;
  get(id: string): Promise<AgentTask>;
  getPending(): Promise<PendingAgentTask | null>;
  retryPending(): Promise<AgentTask>;
};

const serviceDependencies: HermesTaskVoiceDependencies = {
  async submit(query, language) { return (await import("../agent/agent-service")).submitAgentTask(query, language); },
  async listPage(cursor) { return (await import("../agent/agent-service")).listAgentTaskPage(cursor ? { cursor } : undefined); },
  async get(id) { return (await import("../agent/agent-service")).getAgentTask(id); },
  async getPending() { return (await import("../agent/agent-service")).getPendingAgentTask(); },
  async retryPending() { return (await import("../agent/agent-service")).retryPendingAgentTask(); },
};

/**
 * Provides a deliberately small voice bridge to the existing, web-search-only
 * Hermes task service. It sends only an exact quote from the current user turn.
 */
export function createHermesTaskVoiceBridge(dependencies: HermesTaskVoiceDependencies = serviceDependencies) {
  let lastSubmittedTurn: { sessionId: string; revision: number } | null = null;
  let lastRetriedTurn: { sessionId: string; revision: number } | null = null;
  let unresolvedSelection: { sessionId: string; revision: number; ids: Set<string> } | null = null;

  async function listTasks(args: Record<string, unknown>, turn: HermesTaskTurn): Promise<Record<string, unknown>> {
    const reference = typeof args.reference === "string" ? args.reference.trim() : "";
    if (Object.keys(args).some((key) => key !== "reference") || args.reference !== undefined && !reference) {
      return { ok: false, status: "invalid-arguments" };
    }
    if (reference && !turn.userText.includes(reference)) return { ok: false, status: "reference-must-match-current-transcript" };
    if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
    try {
      const [pageResult, pendingResult] = await Promise.allSettled([dependencies.listPage(), dependencies.getPending()]);
      if (pageResult.status === "rejected") throw pageResult.reason;
      let page = pageResult.value;
      let pagesSearched = 1;
      const taskResults = [...page.tasks];
      if (reference) {
        while (page.nextCursor && pagesSearched < MAX_REFERENCE_PAGES) {
          if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
          page = await dependencies.listPage(page.nextCursor);
          pagesSearched += 1;
          taskResults.push(...page.tasks);
        }
      }
      const pending = pendingResult.status === "fulfilled" ? pendingResult.value : null;
      if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
      const tasks = taskResults;
      if (pending && !tasks.some((task) => task.id === pending.id)) {
        try {
          const admitted = await dependencies.get(pending.id);
          if (!tasks.some((task) => task.id === admitted.id)) tasks.unshift(admitted);
        } catch {
          // A missing task can be an unknown admission. Keep its local
          // identity visible as uncertain; never infer that it ran.
        }
      }
      if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
      const admission = pending ? pendingSummary(pending, tasks.find((task) => task.id === pending.id)) : null;
      const recovery = {
        pendingSubmission: admission,
        pendingRecoveryUnavailable: pendingResult.status === "rejected",
      };
      if (reference) {
        const matched = matchTaskReference(tasks, reference);
        if (matched.length === 0) return {
          ok: true,
          status: "no-matching-recent-task",
          hasMore: page.nextCursor !== null,
          pagesSearched,
          ...recovery,
        };
        if (matched.length > 1 || page.nextCursor !== null) {
          const ids = unresolvedSelection?.sessionId === turn.sessionId && unresolvedSelection.revision === turn.userTurnRevision
            ? unresolvedSelection.ids : new Set<string>();
          for (const task of matched) ids.add(task.id);
          unresolvedSelection = { sessionId: turn.sessionId, revision: turn.userTurnRevision, ids };
          return {
            ok: true,
            status: page.nextCursor ? "search-incomplete" : "ambiguous",
            ambiguous: matched.length > 1,
            candidates: matched.slice(0, MAX_LISTED_TASKS).map(taskSummary),
            hasMore: page.nextCursor !== null || matched.length > MAX_LISTED_TASKS,
            pagesSearched,
            ...recovery,
          };
        }
        const [task] = matched;
        if (task.status === "completed") {
          const detail = await dependencies.get(task.id);
          if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
          return { ...taskDetail(detail), ...recovery };
        }
        return { ...taskSummary(task), ...recovery };
      }
      return {
        ok: true,
        tasks: tasks.slice(0, MAX_LISTED_TASKS).map(taskSummary),
        hasMore: tasks.length > MAX_LISTED_TASKS || page.nextCursor !== null,
        ...recovery,
      };
    } catch (error) {
      return { ok: false, status: safeErrorStatus(error) };
    }
  }

  return {
    async execute(name: string, args: Record<string, unknown>, turn: HermesTaskTurn): Promise<Record<string, unknown>> {
      if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };

      if (name === "start_hermes_task") {
        const request = typeof args.request === "string" ? args.request.trim() : "";
        if (!request || request !== turn.userText.trim()) {
          return { ok: false, status: "request-must-match-current-transcript" };
        }
        if (lastSubmittedTurn?.sessionId === turn.sessionId && lastSubmittedTurn.revision === turn.userTurnRevision) {
          return { ok: false, status: "already-submitted-this-turn" };
        }
        // Mark before crossing the network boundary. A timeout can have an
        // unknown admission outcome; a second model call must not create a
        // replacement job during this user turn.
        lastSubmittedTurn = { sessionId: turn.sessionId, revision: turn.userTurnRevision };
        if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
        try {
          const task = await dependencies.submit(request, turn.language);
          if (dependencies === serviceDependencies && turn.isCurrent() && turn.canWatchCompletion) watchHermesCompletion(task, turn, dependencies.get);
          return turn.isCurrent()
            ? taskSummary(task)
            : { ok: false, status: "stale-turn", admitted: true, taskId: task.id };
        } catch (error) {
          return { ok: false, status: safeErrorStatus(error) };
        }
      }

      if (name === "list_hermes_tasks") return listTasks(args, turn);

      if (name === "get_hermes_task") {
        const offered = offeredHermesTask(turn.sessionId, turn.userTurnRevision);
        if (offered && !offered.accepted) return { ok: false, status: "awaiting-user-confirmation" };
        if (!offered && isGenericHermesAcceptance(turn.userText)) return { ok: false, status: "task-selection-required" };
        const id = offered?.accepted ? offered.id : typeof args.id === "string" ? args.id.trim() : "";
        if (!id) return { ok: false, status: "invalid-task-id" };
        if (!offered?.accepted && unresolvedSelection?.sessionId === turn.sessionId && unresolvedSelection.revision === turn.userTurnRevision &&
            unresolvedSelection.ids.has(id) && !turn.userText.includes(id)) {
          return { ok: false, status: "task-selection-required" };
        }
        if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
        try {
          const task = await dependencies.get(id);
          if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
          return taskDetail(task);
        } catch (error) {
          return { ok: false, status: safeErrorStatus(error) };
        }
      }

      if (name === "retry_pending_hermes_task") {
        if (Object.keys(args).length > 0) return { ok: false, status: "invalid-arguments" };
        if (!turn.isCurrent()) return { ok: false, status: "stale-turn" };
        if (lastRetriedTurn?.sessionId === turn.sessionId && lastRetriedTurn.revision === turn.userTurnRevision) {
          return { ok: false, status: "already-retried-this-turn" };
        }
        lastRetriedTurn = { sessionId: turn.sessionId, revision: turn.userTurnRevision };
        try {
          const task = await dependencies.retryPending();
          return turn.isCurrent()
            ? { ...taskSummary(task), retriedSameTask: true }
            : { ok: false, status: "stale-turn", admitted: true, taskId: task.id };
        } catch (error) {
          return { ok: false, status: safeErrorStatus(error) };
        }
      }

      return { ok: false, status: "unsupported-tool" };
    },
  };
}

// Both Realtime transports share the same admission guard, including when a
// conversation falls back from WebRTC to PCM during one app session.
export const hermesTaskVoiceBridge = createHermesTaskVoiceBridge();

function taskSummary(task: AgentTask): Record<string, unknown> {
  return {
    ok: true,
    id: task.id,
    status: task.status,
    query: task.query.slice(0, 400),
    updatedAt: task.updatedAt,
  };
}

function taskDetail(task: AgentTask): Record<string, unknown> {
  return {
    ...taskSummary(task),
    answer: task.answer ? task.answer.slice(0, MAX_SPOKEN_RESULT_CHARACTERS) : null,
    answerTruncated: Boolean(task.answer && task.answer.length > MAX_SPOKEN_RESULT_CHARACTERS),
    sources: task.sources.slice(0, 5),
  };
}

function pendingSummary(pending: PendingAgentTask, admitted?: AgentTask): Record<string, unknown> {
  const status = !admitted ? "admission-unknown"
    : admitted.query === pending.query && admitted.language === pending.language ? "admission-confirmed-needs-retry"
    : "admission-conflict";
  return { id: pending.id, query: pending.query.slice(0, 400), status };
}

function matchTaskReference(tasks: AgentTask[], reference: string): AgentTask[] {
  const tokens = new Set(reference.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((token) => !REFERENCE_STOP_WORDS.has(token)) ?? []);
  if (tokens.size === 0) return [];
  const scored = tasks.map((task) => {
    const queryTokens = new Set(task.query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    return { task, score: [...tokens].filter((token) => queryTokens.has(token)).length };
  });
  const bestScore = Math.max(0, ...scored.map((row) => row.score));
  return bestScore > 0 ? scored.filter((row) => row.score === bestScore).map((row) => row.task) : [];
}

function safeErrorStatus(error: unknown): string {
  if (!(error instanceof AgentError)) return "request-failed";
  switch (error.code) {
    case "not_configured": return "hermes-not-connected";
    case "pending_submission": return "submission-outcome-unknown-check-existing-task";
    case "invalid_query": return "request-not-accepted";
    case "timeout":
    case "network": return "connection-outcome-unknown-check-task-list";
    case "cancelled": return "request-cancelled-outcome-may-be-unknown";
    case "busy": return "hermes-queue-busy";
    case "auth": return "hermes-connection-rejected";
    case "not_found": return "task-not-found";
    case "conflict": return "task-request-conflict";
    case "storage": return "local-task-recovery-unavailable";
    default: return "request-failed";
  }
}
