import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const protocol = loadTypeScript("src/agent/agent-protocol.ts");
const clientModule = loadTypeScript("src/agent/agent-client.ts", { "./agent-protocol": protocol });
const core = loadTypeScript("src/agent/agent-service-core.ts", { "./agent-protocol": protocol, "./agent-client": clientModule });
const id = "01234567-1234-4123-8123-123456789abc";
const secondId = "01234567-1234-4123-8123-123456789abd";
const token = "a".repeat(64);
const connection = { url: "https://agent.example.org", token };
const task = (overrides = {}) => ({ id, query: "Compare two sources", language: "en", status: "queued", createdAt: "2026-10-25T12:00:00Z", updatedAt: "2026-10-25T12:00:00Z", answer: null, sources: [], error: null, ...overrides });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const rejected = (promise, code) => assert.rejects(promise, (error) => error instanceof protocol.AgentError && error.code === code);

assert.deepEqual(protocol.normalizeAgentConnection(" https://agent.example.org/ ", ` ${token} `), connection);
for (const url of ["http://agent.example.org", "https://agent.example.org/path", "https://agent.example.org/?token=secret", "https://agent.example.org/#key", "https://owner:secret" + String.fromCharCode(64) + "agent.example.org"]) {
  assert.throws(() => protocol.normalizeAgentConnection(url, token), { code: "invalid_connection" });
}
assert.throws(() => protocol.normalizeAgentConnection(connection.url, "short"), { code: "invalid_connection" });
assert.equal(protocol.validateAgentQuery("  Look this up  "), "Look this up");
assert.equal(protocol.validateAgentQuery("😀".repeat(2000)).length, 4000);
for (const query of [" ", "x", "x".repeat(2001), "query\0here"]) assert.throws(() => protocol.validateAgentQuery(query), { code: "invalid_query" });
for (const invalid of [task({ id: "../../secret" }), task({ status: "done" }), task({ status: "completed", answer: null }), task({ answer: "x".repeat(32001) }), task({ createdAt: "yesterday" }), task({ sources: [{ title: "Unsafe", url: "javascript:alert(1)" }] })]) assert.throws(() => protocol.parseAgentTask(invalid), { code: "response" });
assert.throws(() => protocol.parseAgentTask(task(), secondId), { code: "response" });
assert.equal(protocol.isTerminalAgentTask("interrupted"), true);
assert.equal(protocol.isTerminalAgentTask("cancelling"), false);
assert.equal(protocol.parseAgentTask(task({ status: "completed" }), undefined, true).answer, null);

const requests = [];
const client = clientModule.createAgentClient({ fetcher: async (url, options) => {
  requests.push({ url, options });
  if (url.endsWith("/v1/capabilities")) return json({ protocol: 1, service: "looi-hermes", capabilities: ["tasks", "cancel", "delete"] });
  if (options.method === "DELETE") return new Response(null, { status: 204 });
  if (url.endsWith("/v1/tasks")) return json({ tasks: [task()], nextCursor: null });
  return json(task({ status: url.endsWith("/cancel") ? "cancelling" : "queued" }));
} });
await client.verify(connection);
assert.equal((await client.listPage(connection)).tasks.length, 1);
await client.submit(connection, { id, query: task().query, language: "en" });
assert.equal((await client.cancel(connection, id)).status, "cancelling");
await client.remove(connection, id);
assert.deepEqual(JSON.parse(requests[2].options.body), { query: task().query, language: "en" });
assert.equal(requests[3].options.body, undefined, "cancel endpoint accepts an empty request body");
for (const { url, options } of requests) {
  assert.equal(url.includes(token), false);
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
}
for (const [status, code] of [[401, "auth"], [403, "auth"], [404, "not_found"], [409, "conflict"], [429, "busy"], [503, "busy"], [500, "api"]]) {
  await rejected(clientModule.createAgentClient({ fetcher: async () => json({ error: token }, status) }).listPage(connection), code);
}
await rejected(clientModule.createAgentClient({ fetcher: async () => json({ tasks: [task(), task()], nextCursor: null }) }).listPage(connection), "response");
await rejected(clientModule.createAgentClient({ fetcher: async () => json({ protocol: 2, service: "looi-hermes", capabilities: ["tasks", "cancel", "delete"] }) }).verify(connection), "response");
await rejected(clientModule.createAgentClient({ fetcher: async () => json({ tasks: [] }, 200) }).submit(connection, { id, query: "Look up", language: "en" }), "response");
await rejected(clientModule.createAgentClient({ fetcher: async () => { throw new Error(token); } }).listPage(connection), "network");
for (const contentLength of [null, "1"]) {
  let pulled = 0;
  let streamCancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(250_000)); },
    cancel() { streamCancelled = true; },
  }, { highWaterMark: 0 });
  await rejected(clientModule.createAgentClient({ fetcher: async () => new Response(body, { headers: contentLength ? { "Content-Length": contentLength } : {} }) }).listPage(connection), "response");
  assert.equal(streamCancelled, true);
  assert.ok(pulled <= 9, "oversized stream must stop before full-body buffering");
}
await rejected(clientModule.createAgentClient({ timeoutMs: 5, fetcher: () => new Promise(() => {}) }).listPage(connection), "timeout");
const aborted = new AbortController(); aborted.abort();
await rejected(client.listPage(connection, { signal: aborted.signal }), "cancelled");
const inFlight = new AbortController();
const hung = clientModule.createAgentClient({ fetcher: () => new Promise(() => {}) }).listPage(connection, { signal: inFlight.signal });
inFlight.abort();
await rejected(hung, "cancelled");

let storedConnection = connection;
const pending = new Map();
const order = [];
let writeFails = false;
const storage = {
  async readConnection() { return storedConnection; },
  async writeConnection(value) { storedConnection = value; },
  async readPending(url) { return pending.get(url) ?? null; },
  async writePending(url, value) {
    if (writeFails) throw new Error("disk full");
    order.push(value ? "persist" : "clear");
    if (value) pending.set(url, structuredClone(value)); else pending.delete(url);
  },
};
let calls = 0;
let fail = false;
let responseGate = null;
const fakeClient = {
  verify: async () => {}, listPage: async () => ({ tasks: [task()], nextCursor: null }), cancel: async () => task({ status: "cancelling" }), remove: async () => {},
  async submit(config, value) {
    calls += 1; order.push("send");
    assert.deepEqual(pending.get(config.url), value, "write must precede network");
    if (fail) throw new protocol.AgentError("timeout");
    if (responseGate) await responseGate.promise;
    return task(value);
  },
};
let generated = 0;
const service = core.createAgentService(storage, fakeClient, () => { generated += 1; return id; });
assert.equal((await service.submitAgentTask(task().query, "en")).id, id);
assert.deepEqual(order, ["persist", "send", "clear"]);
assert.equal(pending.size, 0);
writeFails = true;
await rejected(service.submitAgentTask(task().query, "en"), "storage");
assert.equal(calls, 1, "failed persistence must prevent submission");
writeFails = false; fail = true;
await rejected(service.submitAgentTask(task().query, "en"), "timeout");
assert.equal(pending.get(connection.url).id, id);
const beforeRetryGenerated = generated;
await rejected(service.submitAgentTask("A different task", "en"), "pending_submission");
assert.equal(generated, beforeRetryGenerated);
await service.disconnectAgent();
await rejected(service.listAgentTasks(), "not_configured");
assert.equal(pending.size, 1, "disconnect must not discard an unknown outcome");
await service.configureAgentConnection(connection.url, token);
const restartedService = core.createAgentService(storage, fakeClient, () => { throw new Error("retry must reuse identity"); });
assert.equal((await restartedService.getPendingAgentTask()).id, id);
fail = false;
await restartedService.retryPendingAgentTask();
assert.equal(pending.size, 0);
responseGate = deferred();
const firstSubmission = service.submitAgentTask(task().query, "en");
await rejected(service.submitAgentTask(task().query, "en"), "pending_submission");
responseGate.resolve();
await firstSubmission;
responseGate = null;
// A timeout followed by a different server cannot send the old pending query there.
fail = true;
await rejected(service.submitAgentTask(task().query, "en"), "timeout");
await service.configureAgentConnection("https://second.example.org", token);
assert.equal(await service.getPendingAgentTask(), null);
await rejected(service.retryPendingAgentTask(), "not_found");
await service.configureAgentConnection(connection.url, token);
assert.equal((await service.getPendingAgentTask()).id, id);
// Config verification failure must preserve the previously saved credentials.
const brokenSetup = core.createAgentService(storage, { ...fakeClient, verify: async () => { throw new protocol.AgentError("auth"); } });
await rejected(brokenSetup.configureAgentConnection("https://bad.example.org", token), "auth");
assert.deepEqual(storedConnection, connection);
const deletedRetry = core.createAgentService(storage, { ...fakeClient, submit: async () => { throw new protocol.AgentError("not_found", 410); } });
await rejected(deletedRetry.retryPendingAgentTask(), "not_found");
assert.equal(pending.size, 0, "a deleted-ID receipt settles the local uncertain admission without new work");

// The native adapter encrypts recovery state, keeps its key in SecureStore and
// refuses to recreate a missing key when uncertain admissions may still exist.
const secureValues = new Map();
const nativePending = new Map();
const storageConfigs = [];
const secureOptions = [];
let mmkvExists = false;
const nativeDependencies = {
  "expo-secure-store": {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    getItemAsync: async (key) => secureValues.get(key) ?? null,
    setItemAsync: async (key, value, options) => { secureValues.set(key, value); secureOptions.push(options); },
    deleteItemAsync: async (key) => { secureValues.delete(key); },
  },
  "expo-crypto": { getRandomBytesAsync: async () => new Uint8Array(32).fill(42), randomUUID: () => id },
  "expo/fetch": { fetch: async (url) => url.endsWith("/v1/capabilities") ? json({ protocol: 1, service: "looi-hermes", capabilities: ["tasks", "cancel", "delete"] }) : Promise.reject(new Error("offline")) },
  "react-native-mmkv": {
    existsMMKV: () => mmkvExists,
    createMMKV: (config) => {
      storageConfigs.push(config); mmkvExists = true;
      return { getString: (key) => nativePending.get(key), set: (key, value) => nativePending.set(key, value), remove: (key) => nativePending.delete(key) };
    },
  },
  "./agent-client": clientModule,
  "./agent-service-core": core,
  "./agent-protocol": protocol,
};
const nativeService = loadTypeScript("src/agent/agent-service.ts", nativeDependencies);
await nativeService.configureAgentConnection(connection.url, token);
await rejected(nativeService.submitAgentTask(task().query, "en"), "network");
assert.equal(storageConfigs.length, 1);
assert.equal(storageConfigs[0].encryptionType, "AES-256");
assert.equal(storageConfigs[0].encryptionKey.length, 32);
assert.equal(secureOptions.every((options) => options.keychainAccessible === "device-only"), true);
assert.equal([...nativePending.values()].some((value) => value.includes(token)), false);
await nativeService.disconnectAgent();
assert.equal(nativePending.size, 1);
assert.equal(secureValues.has("looi.hermes-pending-key.v1"), true);
await nativeService.configureAgentConnection(connection.url, token);
secureValues.delete("looi.hermes-pending-key.v1");
const missingKeyService = loadTypeScript("src/agent/agent-service.ts", nativeDependencies);
await rejected(missingKeyService.getPendingAgentTask(), "storage");
assert.equal(storageConfigs.length, 1, "missing recovery key must not replace existing state");
console.log("Agent tasks behavior: PASS");
