import { AgentError, isRecord, parseAgentTask, validateAgentTaskId, type AgentConnection, type AgentTask, type PendingAgentTask } from "./agent-protocol";

export type AgentRequestOptions = { signal?: AbortSignal };
export type AgentPageOptions = AgentRequestOptions & { cursor?: string };
export type AgentTaskPage = { tasks: AgentTask[]; nextCursor: string | null };
export type AgentClientDependencies = { fetcher?: typeof fetch; timeoutMs?: number };

export function createAgentClient(dependencies: AgentClientDependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const request = async (connection: AgentConnection, path: string, method: string, body: unknown, options: AgentRequestOptions = {}): Promise<unknown> => {
    if (options.signal?.aborted) throw new AgentError("cancelled");
    const controller = new AbortController();
    let rejectStop: (error: AgentError) => void = () => {};
    const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    const cancel = () => { controller.abort(); rejectStop(new AgentError("cancelled")); };
    const timer = setTimeout(() => { controller.abort(); rejectStop(new AgentError("timeout")); }, dependencies.timeoutMs ?? 15_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const execution = (async () => {
        const response = await fetcher(`${connection.url}${path}`, {
          method, redirect: "error", credentials: "omit", cache: "no-store",
          headers: { Authorization: `Bearer ${connection.token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) throw new AgentError("auth");
        if (response.status === 404) throw new AgentError("not_found");
        if (response.status === 410) throw new AgentError("not_found", 410);
        if (response.status === 409) throw new AgentError("conflict");
        if (response.status === 429 || response.status === 503) throw new AgentError("busy");
        if (!response.ok) throw new AgentError("api");
        if (Number(response.headers.get("content-length")) > 2_000_000) throw new AgentError("response");
        if (response.status === 204) return undefined;
        const raw = await readBoundedBody(response, controller);
        if (controller.signal.aborted) throw new AgentError("cancelled");
        try { return JSON.parse(raw) as unknown; } catch { throw new AgentError("response"); }
      })();
      return await Promise.race([execution, stopped]);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("network");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    async verify(connection: AgentConnection, options?: AgentRequestOptions): Promise<void> {
      const value = await request(connection, "/v1/capabilities", "GET", undefined, options);
      if (!isRecord(value) || value.protocol !== 1 || value.service !== "looi-hermes" || !Array.isArray(value.capabilities) || !["tasks", "cancel", "delete"].every((name) => value.capabilities instanceof Array && value.capabilities.includes(name))) throw new AgentError("response");
    },
    async listPage(connection: AgentConnection, options: AgentPageOptions = {}): Promise<AgentTaskPage> {
      if (options.cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(options.cursor)) throw new AgentError("response");
      const path = options.cursor ? `/v1/tasks?cursor=${encodeURIComponent(options.cursor)}` : "/v1/tasks";
      const value = await request(connection, path, "GET", undefined, options);
      if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length > 100) throw new AgentError("response");
      if (value.nextCursor !== null && (typeof value.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value.nextCursor))) throw new AgentError("response");
      const tasks = value.tasks.map((task) => parseAgentTask(task, undefined, true));
      if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new AgentError("response");
      return { tasks, nextCursor: value.nextCursor as string | null };
    },
    async get(connection: AgentConnection, id: string, options?: AgentRequestOptions): Promise<AgentTask> {
      validateAgentTaskId(id);
      return parseAgentTask(await request(connection, `/v1/tasks/${id}`, "GET", undefined, options), id);
    },
    async submit(connection: AgentConnection, task: PendingAgentTask, options?: AgentRequestOptions): Promise<AgentTask> {
      validateAgentTaskId(task.id);
      return parseAgentTask(await request(connection, `/v1/tasks/${task.id}`, "PUT", { query: task.query, language: task.language }, options), task.id);
    },
    async cancel(connection: AgentConnection, id: string, options?: AgentRequestOptions): Promise<AgentTask> {
      validateAgentTaskId(id);
      return parseAgentTask(await request(connection, `/v1/tasks/${id}/cancel`, "POST", undefined, options), id);
    },
    async remove(connection: AgentConnection, id: string, options?: AgentRequestOptions): Promise<void> {
      validateAgentTaskId(id);
      await request(connection, `/v1/tasks/${id}`, "DELETE", undefined, options);
    },
  };
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<string> {
  // The production adapter uses expo/fetch, whose native response exposes a
  // stream. Refuse an unsupported transport instead of buffering an unbounded
  // body and checking its size after the allocation.
  if (!response.body?.getReader) throw new AgentError("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new AgentError("response");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    reader.releaseLock();
  }
}
