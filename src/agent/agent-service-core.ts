import type { InterfaceLanguage } from "../i18n/ui-language";
import { createAgentClient, type AgentPageOptions, type AgentRequestOptions } from "./agent-client";
import { AgentError, normalizeAgentConnection, validateAgentQuery, validateAgentTaskId, type AgentConnection, type PendingAgentTask } from "./agent-protocol";

export type AgentStorage = {
  readConnection(): Promise<AgentConnection | null>;
  writeConnection(connection: AgentConnection | null): Promise<void>;
  readPending(url: string): Promise<PendingAgentTask | null>;
  writePending(url: string, task: PendingAgentTask | null): Promise<void>;
};

export function createAgentService(storage: AgentStorage, client = createAgentClient(), makeId = createTaskId) {
  let tail: Promise<unknown> = Promise.resolve();
  let submitting = false;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const accessStorage = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); } catch { throw new AgentError("storage"); }
  };
  const submitOnce = <T>(operation: () => Promise<T>): Promise<T> => {
    if (submitting) return Promise.reject(new AgentError("pending_submission"));
    submitting = true;
    return serialize(operation).finally(() => { submitting = false; });
  };
  const connection = async (): Promise<AgentConnection> => {
    const value = await accessStorage(() => storage.readConnection());
    if (!value) throw new AgentError("not_configured");
    return normalizeAgentConnection(value.url, value.token);
  };
  const submit = async (config: AgentConnection, pending: PendingAgentTask, options: AgentRequestOptions) => {
    let task;
    try {
      task = await client.submit(config, pending, options);
    } catch (error) {
      if (error instanceof AgentError && error.status === 410) {
        // The server retains a deleted-ID receipt, so this identity can never
        // execute again. Clearing the local journal does not create new work.
        await accessStorage(() => storage.writePending(config.url, null));
      }
      throw error;
    }
    if (task.query !== pending.query || task.language !== pending.language) throw new AgentError("response");
    await accessStorage(() => storage.writePending(config.url, null));
    return task;
  };
  return {
    async getAgentSettings() {
      const config = await accessStorage(() => storage.readConnection());
      return { url: config?.url ?? "", configured: Boolean(config) };
    },
    configureAgentConnection: (url: string, token: string) => serialize(async () => {
      const config = normalizeAgentConnection(url, token);
      await client.verify(config);
      await accessStorage(() => storage.writeConnection(config));
    }),
    disconnectAgent: () => serialize(() => accessStorage(() => storage.writeConnection(null))),
    async verifyAgentConnection(options: AgentRequestOptions = {}) {
      await client.verify(await connection(), options);
    },
    async listAgentTasks(options: AgentRequestOptions = {}) {
      return (await client.listPage(await connection(), options)).tasks;
    },
    async listAgentTaskPage(options: AgentPageOptions = {}) {
      return client.listPage(await connection(), options);
    },
    async getAgentTask(id: string, options: AgentRequestOptions = {}) {
      return client.get(await connection(), id, options);
    },
    async getPendingAgentTask() {
      const config = await connection();
      return accessStorage(() => storage.readPending(config.url));
    },
    submitAgentTask: (query: string, language: InterfaceLanguage, options: AgentRequestOptions = {}) => submitOnce(async () => {
      const config = await connection();
      if (options.signal?.aborted) throw new AgentError("cancelled");
      if (await accessStorage(() => storage.readPending(config.url))) throw new AgentError("pending_submission");
      if (!["en", "ru", "uk"].includes(language)) throw new AgentError("invalid_query");
      const pending = { id: validateAgentTaskId(makeId()), query: validateAgentQuery(query), language };
      // This write must succeed before any request can reach the server.
      await accessStorage(() => storage.writePending(config.url, pending));
      return submit(config, pending, options);
    }),
    retryPendingAgentTask: (options: AgentRequestOptions = {}) => submitOnce(async () => {
      const config = await connection();
      const pending = await accessStorage(() => storage.readPending(config.url));
      if (!pending) throw new AgentError("not_found");
      return submit(config, pending, options);
    }),
    async cancelAgentTask(id: string, options: AgentRequestOptions = {}) {
      return client.cancel(await connection(), id, options);
    },
    async deleteAgentTask(id: string, options: AgentRequestOptions = {}) {
      await client.remove(await connection(), id, options);
    },
  };
}

function createTaskId(): string {
  // Production injects expo-crypto. Other hosts must supply a secure generator.
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  throw new AgentError("storage");
}
