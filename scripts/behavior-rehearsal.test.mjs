import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const policy = loadTypeScript("src/behavior/behavior-policy.ts");
const companion = loadTypeScript("src/behavior/behavior-companion.ts", {
  "../character/companion-personality": loadTypeScript("src/character/companion-personality.ts"),
  "./behavior-episode-search": loadTypeScript("src/behavior/behavior-episode-search.ts"),
});
const engine = loadTypeScript("src/behavior/behavior-engine.ts", { "./behavior-policy": policy, "./behavior-companion": companion, "./shared-activity": loadTypeScript("src/behavior/shared-activity.ts") });
const rehearsal = loadTypeScript("src/behavior/behavior-rehearsal.ts", { "./behavior-engine": engine });
const { BEHAVIOR_REHEARSAL_SCENARIOS, createBehaviorRehearsal } = rehearsal;

assert.deepEqual(BEHAVIOR_REHEARSAL_SCENARIOS.map(({ id }) => id), ["curiosity", "celebration", "less-nodding", "interrupted"]);
const source = fs.readFileSync("src/behavior/behavior-rehearsal.ts", "utf8");
assert.doesNotMatch(source, /behavior-runtime|requestDecisions|fetch\s*\(/u, "the rehearsal has no production runtime or network provider dependency");

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (...args) => { networkCalls += 1; throw new Error(`Unexpected network access: ${String(args[0])}`); };

try {
  const effects = [];
  const offline = createBehaviorRehearsal({ canRun: () => true, executeCue: (cue, isCurrent) => {
    assert.equal(isCurrent(), true);
    effects.push(cue.gesture);
  } });
  for (const [scenarioId, expected] of [["curiosity", "curious"], ["celebration", "happy_bob"], ["less-nodding", "hold"], ["interrupted", null]]) {
    await offline.run(scenarioId);
    const state = offline.getState();
    assert.equal(state.status, "passed", `${scenarioId}: ${state.error ?? ""}`);
    assert.equal(state.expected, expected);
    assert.equal(state.observed, expected);
    assert.equal(state.decisionCount, 1);
    assert.ok(state.traces.length <= 12, "trace evidence stays bounded");
    assert.ok(state.traces.some(({ kind }) => kind === "scenario-passed"));
  }
  assert.deepEqual(effects, ["curious", "happy_bob"], "hold and interrupted results never reach the mock adapter");
  assert.equal(offline.getState().executionCount, 0, "interrupted scenario has no effect");
  assert.ok(offline.getState().traces.some(({ kind }) => kind === "late-result-discarded"));

  // A new engine per run is observable: the engine's repeated-cue suppression does not leak between rehearsals.
  await offline.run("curiosity");
  assert.equal(offline.getState().status, "passed");
  assert.equal(offline.getState().observed, "curious");
  assert.equal(offline.getState().executionCount, 1);
  offline.dispose();

  let blockedCalls = 0;
  const blocked = createBehaviorRehearsal({ canRun: () => false, executeCue: () => { blockedCalls += 1; } });
  await blocked.run("curiosity");
  assert.equal(blocked.getState().status, "failed");
  assert.equal(blocked.getState().decisionCount, 0, "mock readiness fails closed before the policy runs");
  assert.equal(blockedCalls, 0);
  blocked.dispose();

  // Cancel before the policy's resolved provider result can commit.
  let pendingEffects = 0;
  const pending = createBehaviorRehearsal({ canRun: () => true, executeCue: () => { pendingEffects += 1; } });
  const pendingRun = pending.run("curiosity");
  pending.cancel();
  await pendingRun;
  assert.equal(pending.getState().status, "cancelled");
  assert.equal(pendingEffects, 0);
  pending.dispose();

  // One running rehearsal owns the engine; a second request cannot replace or overlap it.
  const concurrent = createBehaviorRehearsal({ canRun: () => true, executeCue: () => undefined });
  const firstRun = concurrent.run("curiosity");
  const overlappingRun = concurrent.run("celebration");
  assert.equal(firstRun, overlappingRun);
  await firstRun;
  assert.equal(concurrent.getState().scenarioId, "curiosity");
  assert.equal(concurrent.getState().status, "passed");
  concurrent.dispose();

  // Cancel while the injected adapter is in flight; it receives a live guard and cannot commit after invalidation.
  const adapterStarted = deferred();
  const releaseAdapter = deferred();
  let committed = 0;
  let guardedAdapterCalls = 0;
  const inFlight = createBehaviorRehearsal({ canRun: () => true, executeCue: async (_cue, isCurrent) => {
    guardedAdapterCalls += 1;
    adapterStarted.resolve();
    await releaseAdapter.promise;
    if (!isCurrent()) return false;
    committed += 1;
    return true;
  } });
  const inFlightRun = inFlight.run("curiosity");
  await adapterStarted.promise;
  inFlight.cancel();
  releaseAdapter.resolve();
  await inFlightRun;
  assert.equal(inFlight.getState().status, "cancelled");
  assert.equal(guardedAdapterCalls, 1);
  assert.equal(committed, 0, "the adapter guard rejects a late physical effect");
  inFlight.dispose();

  // A late rejection from a cancelled run cannot leak into a subsequent run's state or trace.
  let adapterCall = 0;
  let rejectOldAdapter;
  const oldAdapter = new Promise((_resolve, reject) => { rejectOldAdapter = reject; });
  const firstAdapterStarted = deferred();
  const secondAdapterStarted = deferred();
  let finishSecondAdapter;
  const secondAdapter = new Promise((resolve) => { finishSecondAdapter = resolve; });
  const replacing = createBehaviorRehearsal({ canRun: () => true, executeCue: () => {
    adapterCall += 1;
    if (adapterCall === 1) { firstAdapterStarted.resolve(); return oldAdapter; }
    secondAdapterStarted.resolve();
    return secondAdapter;
  } });
  const staleRun = replacing.run("curiosity");
  await firstAdapterStarted.promise;
  replacing.cancel();
  const currentRun = replacing.run("celebration");
  await secondAdapterStarted.promise;
  const currentTrace = replacing.getState().traces;
  rejectOldAdapter(new Error("old adapter failed after cancellation"));
  await staleRun;
  assert.equal(replacing.getState().scenarioId, "celebration");
  assert.equal(replacing.getState().status, "running");
  assert.deepEqual(replacing.getState().traces, currentTrace, "the old adapter cannot append traces to the replacement run");
  finishSecondAdapter({ completed: true });
  await currentRun;
  assert.equal(replacing.getState().status, "passed");
  assert.equal(replacing.getState().traces.some(({ kind, reason }) => kind === "cue-failed" || reason === "adapter-rejected"), false);
  replacing.dispose();

  // Source safety can change between start and cue dispatch; this must fail closed.
  let readinessChecks = 0;
  let unsafeWrites = 0;
  const becomesUnsafe = createBehaviorRehearsal({
    canRun: () => { readinessChecks += 1; return readinessChecks === 1; },
    executeCue: () => { unsafeWrites += 1; },
  });
  await becomesUnsafe.run("curiosity");
  assert.equal(becomesUnsafe.getState().status, "failed");
  assert.equal(becomesUnsafe.getState().executionCount, 0);
  assert.equal(unsafeWrites, 0);
  becomesUnsafe.dispose();

  let holdReadinessChecks = 0;
  const unsafeHold = createBehaviorRehearsal({
    canRun: () => { holdReadinessChecks += 1; return holdReadinessChecks === 1; },
    executeCue: () => { throw new Error("hold must not execute"); },
  });
  await unsafeHold.run("less-nodding");
  assert.equal(unsafeHold.getState().status, "failed");
  assert.equal(unsafeHold.getState().observed, null, "a hold is only reported while the mock remains eligible");
  assert.equal(unsafeHold.getState().executionCount, 0);
  unsafeHold.dispose();

  // A cue must start while fresh but may close after its 800ms engine cue window, within the bounded adapter deadline.
  let slowCommit = 0;
  const slowClose = createBehaviorRehearsal({ canRun: () => true, executeCue: async (_cue, isCurrent) => {
    await new Promise((resolve) => setTimeout(resolve, 950));
    if (!isCurrent()) return false;
    slowCommit += 1;
    return { completed: true };
  } });
  await slowClose.run("curiosity");
  assert.equal(slowClose.getState().status, "passed", "a bounded mock macro may finish after the engine cue expiry");
  assert.equal(slowCommit, 1);
  slowClose.dispose();

  // An adapter that never closes is bounded and cannot turn a rehearsal into a pass.
  const neverClose = createBehaviorRehearsal({ canRun: () => true, executeCue: () => new Promise(() => {}) });
  await neverClose.run("curiosity");
  assert.equal(neverClose.getState().status, "failed");
  assert.match(neverClose.getState().error, /closing deadline/u);
  neverClose.dispose();

  // Adapter failures and explicit cancellation are failures, never successful rehearsals.
  for (const executeCue of [() => { throw new Error("mock failed"); }, () => false, () => ({ accepted: false }), () => ({ completed: false }), () => ({ ok: false })]) {
    const adapterFailure = createBehaviorRehearsal({ canRun: () => true, executeCue });
    await adapterFailure.run("curiosity");
    assert.equal(adapterFailure.getState().status, "failed");
    assert.notEqual(adapterFailure.getState().status, "passed");
    adapterFailure.dispose();
  }

  assert.equal(networkCalls, 0, "offline rehearsal never calls fetch");
  console.log("Offline behavior rehearsal policy, isolation, cancellation, and mock-guard checks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
