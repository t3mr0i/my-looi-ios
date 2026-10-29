import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const id = "1b64b268-0a42-4c1e-8abd-2686e9b8b722";
const task = (status) => ({ id, status });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(get) {
  let time = 1_000;
  let canWatch = true;
  let serial = 0;
  const timers = new Map();
  const events = loadTypeScript("src/behavior/behavior-events.ts");
  const signals = [];
  events.beginBehaviorSession("s", () => {}, (signal) => { signals.push(signal); return true; });
  events.publishBehaviorEvent({ type: "user-turn", sessionId: "s", text: "Recherche bitte" });
  const snapshot = events.getBehaviorInteractionSnapshot("s");
  const turn = { sessionId: "s", language: "de", userTurnRevision: snapshot.userTurnRevision, canWatchCompletion: () => canWatch, isCurrent: () => {
    const current = events.getBehaviorInteractionSnapshot("s");
    return current?.revision === snapshot.revision && current?.userTurnRevision === snapshot.userTurnRevision;
  } };
  const { watchHermesCompletion, offeredHermesTask } = loadTypeScript("src/voice/hermes-completion-watch.ts", { "../behavior/behavior-events": events, "./hermes-completion-copy": loadTypeScript("src/voice/hermes-completion-copy.ts") }, {
    Date: { now: () => time },
    setTimeout: (fn, delay) => { const handle = ++serial; timers.set(handle, { fn, at: time + delay }); return handle; },
    clearTimeout: (handle) => timers.delete(handle),
  });
  async function tick(ms) {
    const target = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); time = next[1].at; next[1].fn(); await flush();
    }
    time = target; await flush();
  }
  const emit = (type, extra = {}) => events.publishBehaviorEvent({ type, sessionId: "s", ...extra });
  return { events, signals, turn, offeredHermesTask, setForeground: (value) => { canWatch = value; }, watch: (initial = task("running")) => watchHermesCompletion(initial, turn, get), tick, emit, timers };
}
{
  const h = harness(async () => task("completed")); h.watch(task("completed"));
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(4_000);
  assert.deepEqual(h.offeredHermesTask("s", 1), { id, accepted: false });
  assert.equal(h.events.requiresBehaviorTurnCommit("s"), true, "the next reply waits for a committed transcript");
  h.emit("assistant-end", { text: "Deine Aufgabe ist fertig. Möchtest du das Ergebnis hören?" });
  h.emit("user-speech-start"); h.emit("user-turn", { text: "Ja, bitte." });
  assert.deepEqual(h.offeredHermesTask("s", 2), { id, accepted: true }, "a heard offer and an explicit yes identify the same task");
  assert.equal(h.events.requiresBehaviorTurnCommit("s"), false, "the manual response lease is released after the answer");
  assert.equal(h.offeredHermesTask("s", 3), null, "acceptance does not authorize a later turn");
}
{
  const h = harness(async () => task("completed")); h.watch(task("completed"));
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(4_000);
  h.emit("assistant-end", { text: "Deine Aufgabe ist fertig." });
  h.emit("user-turn", { text: "Ja." });
  assert.equal(h.offeredHermesTask("s", 2), null, "a truncated question cannot be accepted");
  assert.equal(h.events.requiresBehaviorTurnCommit("s"), false, "a truncated question releases the response lease");
}
{
  const h = harness(async () => task("completed")); h.watch(task("completed"));
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(4_000);
  h.emit("assistant-end", { text: "Deine Aufgabe ist fertig. Möchtest du das Ergebnis hören?" });
  h.emit("user-speech-start"); h.emit("user-turn", { text: "Nein, später." });
  assert.equal(h.offeredHermesTask("s", 2), null, "a refusal clears the offered task");
  assert.equal(h.events.requiresBehaviorTurnCommit("s"), false);
}
{
  const h = harness(async () => task("completed")); h.watch(task("completed"));
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(4_000);
  await h.tick(30_001);
  assert.equal(h.events.requiresBehaviorTurnCommit("s"), false, "an unanswered offer cannot leave voice responses locked");
  assert.equal(h.offeredHermesTask("s", 1), null);
}

{
  const h = harness(async () => task("completed")); h.watch();
  h.emit("assistant-end", { text: "Ich kümmere mich darum." });
  await h.tick(7_999); assert.equal(h.signals.length, 0);
  await h.tick(1); assert.equal(h.signals.length, 1);
  assert.deepEqual(h.signals[0], { kind: "hermes-completed", id, revision: 2, userTurnRevision: 1 });
  await h.tick(60_000); assert.equal(h.signals.length, 1, "one confirmed task produces at most one offer");
}
{
  const h = harness(async () => task("completed")); h.watch(task("completed"));
  await h.tick(10_000); assert.equal(h.signals.length, 0, "no offer before an audible reply");
  h.emit("assistant-end", { text: "Alles klar." });
  await h.tick(3_999); assert.equal(h.signals.length, 0);
  await h.tick(1); assert.equal(h.signals.length, 1, "the offer waits for quiet after playback");
}
for (const interruption of ["user-speech-start", "user-turn", "interrupt", "session-end"]) {
  const pending = deferred();
  const h = harness(() => pending.promise); h.watch();
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(8_000);
  h.emit(interruption, interruption === "user-turn" ? { text: "Anderes Thema" } : {});
  pending.resolve(task("completed")); await flush(); await h.tick(60_000);
  assert.equal(h.signals.length, 0, `${interruption} cancels even an in-flight completion check`);
  assert.equal(h.timers.size, 0);
}
for (const status of ["failed", "cancelled", "interrupted"]) {
  const h = harness(async () => task(status)); h.watch();
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(30_000);
  assert.equal(h.signals.length, 0, `${status} must never be described as complete`);
}
{
  let polls = 0;
  const h = harness(async () => { polls++; return task("completed"); }); h.watch();
  h.emit("assistant-end", { text: "Alles klar." }); h.setForeground(false); await h.tick(10_000);
  assert.equal(polls, 0, "no new status request is made after the app leaves the foreground");
  assert.equal(h.signals.length, 0);
}
{
  const h = harness(async () => task("running")); h.watch();
  h.emit("assistant-end", { text: "Alles klar." }); await h.tick(190_000);
  assert.equal(h.signals.length, 0); assert.equal(h.timers.size, 0, "watching is bounded");
}
console.log("Hermes completion watch: confirmed result, quiet window, stale turn and bounded lifetime PASS");
