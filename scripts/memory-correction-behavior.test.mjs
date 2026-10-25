import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

// Real SQLite with FTS5; only the Expo/native boundary is adapted for Node.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE memories (
  id TEXT PRIMARY KEY NOT NULL, memory TEXT NOT NULL, normalized TEXT NOT NULL,
  category TEXT NOT NULL, source TEXT NOT NULL, timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, confidence REAL, location TEXT,
  evidence_uri TEXT, description TEXT, placement_fact TEXT, server_id TEXT UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'local-only'
);
INSERT INTO memories(id,memory,normalized,category,source,timestamp,created_at,updated_at)
VALUES ('legacy','Coffee at night','coffee at night','preference','voice',
 '2026-01-01','2026-01-01','2026-01-01');`);
const adapter = {
  async execAsync(sql) { sqlite.exec(sql); },
  async runAsync(sql, ...params) { return sqlite.prepare(sql).run(...params); },
  async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
  async getFirstAsync(sql, ...params) { return sqlite.prepare(sql).get(...params) ?? null; },
  async withExclusiveTransactionAsync(callback) {
    sqlite.exec("BEGIN");
    try { await callback(adapter); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const events = [];
const search = load("src/memory/local-memory-search.ts");
const { localMemoryDatabase: db, validateLocalMemoryBackup } = load("src/memory/local-memory-database.ts", {
  "expo-sqlite": { async openDatabaseAsync() { return adapter; } },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (...args) => events.push(args) },
  "./local-memory-search": search,
});
const legacy = (await db.getAll())[0];
assert.equal(legacy.metadata.origin, "unknown", "migration must not invent evidence");
assert.equal(legacy.memory, "Coffee at night");
// A v1 database with preexisting FTS must remain searchable across migration.
// The production v1 already maintains this index through its triggers.
sqlite.exec("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')");
await db.addSessionMessage("source-session", { role: "user", content: "I prefer tea in the evening" });
await db.remember([{ role: "user", content: "Evening coffee" }], {
  category: "preference", source: "voice", timestamp: "2026-02-01",
  origin: "conversation", sourceSessionId: "source-session",
});
const fact = (await db.getAll()).find((row) => row.id !== "legacy");
assert.equal(fact.metadata.sourceSessionId, "source-session");
assert.equal(await db.updateMemory(fact.id, "  Evening tea  "), true);
const corrected = (await db.getAll()).find((row) => row.id === fact.id);
assert.equal(corrected.memory, "Evening tea");
assert.equal(corrected.createdAt, fact.createdAt);
assert.equal(corrected.metadata.timestamp, "2026-02-01");
assert.equal(corrected.metadata.origin, "user-edit");
assert.equal(corrected.metadata.sourceSessionId, "source-session");
assert.deepEqual(sqlite.prepare("SELECT memory FROM memories_fts WHERE memories_fts MATCH 'tea'").all().map((r) => r.memory), ["Evening tea"]);
assert.deepEqual(sqlite.prepare("SELECT memory FROM memories_fts WHERE memories_fts MATCH 'coffee'").all().map((r) => r.memory), ["Coffee at night"]);
await assert.rejects(db.updateMemory(fact.id, " "));
await assert.rejects(db.updateMemory(fact.id, "x".repeat(4001)));
assert.equal(await db.updateMemory("missing", "A valid fact"), false);
let currentSession = true;
const pendingFact = db.remember([{ role: "user", content: "STALE" }], { category: "note", source: "voice", timestamp: "now" }, () => currentSession);
currentSession = false;
await pendingFact;
assert.ok(!(await db.getAll()).some((row) => row.memory === "STALE"));
const backup = await db.exportBackup();
assert.equal(backup.schemaVersion, 2);
assert.equal(backup.memories.find((row) => row.id === fact.id).origin, "user-edit");
assert.ok(!JSON.stringify(backup).includes("Evening coffee"), "correction must not keep a second stale fact");
await db.restoreBackup(backup);
assert.equal((await db.getAll()).find((row) => row.id === fact.id).metadata.sourceSessionId, "source-session");
assert.equal(await db.deleteMemory(fact.id), true);
assert.equal(await db.deleteMemory(fact.id), false);
assert.equal((await db.search("tea")).some((row) => row.id === fact.id), false);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM memories_fts WHERE memories_fts MATCH 'tea'").get().count, 0);
assert.ok(!(await db.exportBackup()).memories.some((row) => row.id === fact.id));
assert.equal((await db.getConversationMessages("source-session")).length, 1, "history is independent and must not be silently erased");
const oldBackup = { ...backup, schemaVersion: 1, memories: backup.memories.map(({ origin, sourceSessionId, ...row }) => row) };
assert.equal(validateLocalMemoryBackup(oldBackup).memories[0].origin, "unknown");
await db.restoreBackup(oldBackup);
assert.ok((await db.getAll()).every((row) => row.metadata.origin === "unknown"));
assert.throws(() => validateLocalMemoryBackup({ ...backup, memories: [{ ...backup.memories[0], origin: "invented" }] }));
assert.ok(!JSON.stringify(events).includes("Evening tea"), "diagnostics must omit personal fact text");
sqlite.close();

const mutations = load("src/memory/memory-mutation.ts");
const { runLocalMemoryMutation, isLocalMemoryMutationInProgress } = mutations;
let release;
const wait = new Promise((done) => { release = done; });
const order = [];
const first = runLocalMemoryMutation(async () => { order.push("stop"); await wait; }, async () => { order.push("edit"); return true; });
const second = runLocalMemoryMutation(async () => { order.push("stop2"); }, async () => { order.push("delete"); return false; });
assert.equal(isLocalMemoryMutationInProgress(), true);
await new Promise((done) => setImmediate(done));
assert.deepEqual(order, ["stop"], "write must wait for cloud session invalidation");
release();
assert.deepEqual(await Promise.all([first, second]), [true, false]);
assert.deepEqual(order, ["stop", "edit", "stop2", "delete"]);
assert.equal(isLocalMemoryMutationInProgress(), false);
await assert.rejects(runLocalMemoryMutation(async () => { throw new Error("stop failed"); }, async () => { assert.fail("must not mutate if invalidation fails"); }));
assert.equal(isLocalMemoryMutationInProgress(), false);
assert.equal(await runLocalMemoryMutation(async () => {}, async () => "recovered"), "recovered");

// Exercise the public UI-facing seam, including its deferred native boundary.
// Clearing the active transcript prevents photo-picker continuation from
// putting a corrected/deleted fact back into a fresh cloud conversation.
const facadeOrder = [];
let failStop = false;
const facade = load("src/memory/memory-service.ts", {
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "./conversation-memory-context": {},
  "./local-memory-database": {
    validateEditedMemory: (value) => { if (!value.trim()) throw new Error("empty"); return value.trim(); },
    localMemoryDatabase: {
      async updateMemory(id, value) { facadeOrder.push(["update", id, value]); return true; },
      async deleteMemory(id) { facadeOrder.push(["delete", id]); return true; },
      async restoreBackup(value) { facadeOrder.push(["restore", value]); return {}; },
    },
  },
  "./memory-mutation": mutations,
  "../voice/realtime-conversation": { realtimeConversationService: { async stop() {
    facadeOrder.push(["stop"]);
    if (failStop) throw new Error("cannot stop");
  } } },
  "../store/conversation": { useConversationStore: { getState: () => ({ clearSession() { facadeOrder.push(["clear-active-transcript"]); } }) } },
});
assert.equal(await facade.updateLocalMemory("fact", " corrected "), true);
assert.deepEqual(facadeOrder, [["stop"], ["clear-active-transcript"], ["update", "fact", "corrected"]]);
facadeOrder.length = 0;
await facade.deleteLocalMemory("fact");
assert.deepEqual(facadeOrder, [["stop"], ["clear-active-transcript"], ["delete", "fact"]]);
facadeOrder.length = 0;
await facade.restoreLocalMemoryBackup("backup");
assert.deepEqual(facadeOrder, [["stop"], ["clear-active-transcript"], ["restore", "backup"]]);
facadeOrder.length = 0;
failStop = true;
await assert.rejects(facade.deleteLocalMemory("fact"), /cannot stop/);
assert.deepEqual(facadeOrder, [["stop"]], "failed session invalidation must not mutate data");
assert.equal(isLocalMemoryMutationInProgress(), false);
console.log("Memory correction: v1 migration, real SQLite/FTS, provenance, restore, deletion and session mutation gate passed");
