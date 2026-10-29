import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
const { createRepairFeedbackTracker } = loadTypeScript("src/behavior/behavior-face-feedback.ts");
const tracker = createRepairFeedbackTracker();
// Reuse and mutate the object like the real engine: the tracker must copy keys.
const state = { sessionId: "one", referenceVersion: 0, turnId: 0, repairRequired: false, lifecycleGeneration: 1 };
assert.equal(tracker.observe(state, 100), null);
Object.assign(state, { referenceVersion: 1, turnId: 1, repairRequired: true, lifecycleGeneration: 2 });
const repair = tracker.observe(state, 200);
assert.equal(repair.mood, "repairing");
assert.equal(repair.expiresAt, 1150);
assert.equal(tracker.observe(state, 500), null, "polling cannot replay or extend a correction");
Object.assign(state, { repairRequired: false, turnId: 2, lifecycleGeneration: 3, moment: { userText: "Genau die meine ich." } });
assert.equal(tracker.observe(state, 600).mood, "clarified");
assert.equal(tracker.observe(state, 601), null);
Object.assign(state, { referenceVersion: 2, repairRequired: true });
tracker.observe(state, 700);
tracker.reset();
assert.equal(tracker.observe(state, 800), null);
Object.assign(state, { repairRequired: false, turnId: 3 });
assert.equal(tracker.observe(state, 900), null, "STOP/reset cannot resurrect a clarification");
state.sessionId = "two"; state.repairRequired = true;
assert.equal(tracker.observe(state, 1000), null);
state.repairRequired = false; state.turnId++;
assert.equal(tracker.observe(state, 1100), null, "old repair state cannot cross sessions");
for (const text of ["I do not know.", "Wie spät ist es?", "Yes", "Nicht genau die meine ich.", "Genau das?", "That is the one?", "Саме це?"]) {
  state.referenceVersion++; state.repairRequired = true; tracker.observe(state, 1200);
  state.repairRequired = false; state.turnId++; state.moment = { userText: text };
  assert.equal(tracker.observe(state, 1300), null, `unconfirmed reference: ${text}`);
}
for (const text of ["Genau das meine ich.", "Yes, that is what I meant.", "Да, именно это.", "Так, саме це."]) {
  state.referenceVersion++; state.repairRequired = true; tracker.observe(state, 1400);
  state.repairRequired = false; state.turnId++; state.moment = { userText: text };
  assert.equal(tracker.observe(state, 1500).mood, "clarified");
}
console.log("Behavior face feedback: committed correction, clarification, bounded lifetime, mutation and reset isolation PASS");
