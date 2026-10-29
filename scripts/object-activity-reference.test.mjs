import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const {
  getObjectActivityReferenceCandidate: getCandidate,
  isObjectActivityReferenceCurrent: isCurrent,
  createObjectActivityGazeDirector,
} = loadTypeScript("src/core/object-activity-reference.ts");

const episode = {
  id: "ep_robot_trial", title: "Try the blue ball", detail: "", outcome: "", motif: "playful",
  source: { evidence: "Let's try it", sessionId: "session-a", at: 10 },
  createdAt: 1, updatedAt: 1, lastUsedAt: null, confirmedAt: 1,
};
function state(overrides = {}) {
  return {
    sessionId: "session-a", turnId: 1, lifecycleGeneration: 1, preferenceVersion: 1, referenceVersion: 3,
    pendingIntention: {
      id: "task-a", goal: episode.title, source: "explicit_user_request", status: "active",
      lastConfirmedStep: null, waitingFor: "user_reply", createdAt: 1, updatedAt: 1,
      expiresAt: 5_000, version: 1,
      activity: { kind: "object_trial", episodeId: episode.id, title: episode.title,
        phase: "checking", confirmedAt: 1, startedAt: null, confirmed: [], pending: null },
    },
    companion: { episodes: [episode], pendingExperience: null, interest: null, visualGrant: null,
      scene: { status: "idle", signal: null, episodeId: null, title: null, source: null, startedBy: null, at: null, deadline: null } },
    ...overrides,
  };
}

const base = state();
const candidate = getCandidate(base, "active", 100);
assert.deepEqual(candidate, {
  sessionId: "session-a", taskId: "task-a", episodeId: episode.id,
  title: episode.title, referenceVersion: 3,
});
assert.equal(getCandidate(base, "off", 100), null);
assert.equal(getCandidate(base, "shadow", 100), null);
assert.equal(getCandidate(state({ sessionId: null }), "active", 100), null);
assert.equal(getCandidate(state({ pendingIntention: { ...base.pendingIntention, status: "paused" } }), "active", 100), null);
assert.equal(getCandidate(state({ pendingIntention: { ...base.pendingIntention, status: "needs_clarification" } }), "active", 100), null);
assert.equal(getCandidate(state({ pendingIntention: { ...base.pendingIntention, expiresAt: 100 } }), "active", 100), null,
  "task expires at the exact deadline");
assert.equal(getCandidate(state({ pendingIntention: { ...base.pendingIntention,
  activity: { ...base.pendingIntention.activity, confirmedAt: null } } }), "active", 100), null,
  "pending, unconfirmed begin cannot bind");
assert.equal(getCandidate(state({ pendingIntention: { ...base.pendingIntention,
  activity: { ...base.pendingIntention.activity, phase: "completed" } } }), "active", 100), null);
assert.equal(getCandidate(state({ companion: { ...base.companion, episodes: [] } }), "active", 100), null,
  "forgotten episode cannot bind");
assert.equal(getCandidate(state({ companion: { ...base.companion,
  episodes: [{ ...episode, title: "A different episode title" }] } }), "active", 100), null,
  "episode title must remain canonical");

assert.equal(isCurrent(candidate, base, "active", 200), true,
  "normal turns/lifecycle bookkeeping do not invalidate the identity binding");
assert.equal(isCurrent(candidate, state({ sessionId: "session-b" }), "active", 200), false);
assert.equal(isCurrent(candidate, state({ referenceVersion: 4 }), "active", 200), false,
  "correction invalidates the captured reference");
assert.equal(isCurrent(candidate, state({ pendingIntention: { ...base.pendingIntention, id: "task-b" } }), "active", 200), false);
assert.equal(isCurrent(candidate, state({ pendingIntention: { ...base.pendingIntention,
  activity: { ...base.pendingIntention.activity, episodeId: "ep_other" } } }), "active", 200), false);
assert.equal(isCurrent(candidate, state({ pendingIntention: { ...base.pendingIntention, status: "paused" } }), "active", 200), false);
assert.equal(isCurrent(candidate, state({ companion: { ...base.companion, episodes: [] } }), "active", 200), false);

// A later checked/prepared question does not sever an already confirmed activity reference.
const laterActivity = state({ pendingIntention: { ...base.pendingIntention,
  activity: { ...base.pendingIntention.activity, phase: "preparing",
    pending: { step: "prepared", detail: "Ready", evidence: "I prepared it", sessionId: "session-a", proposedAt: 200, question: "Ready?", askedAt: 200 } } } });
assert.equal(isCurrent(candidate, laterActivity, "active", 300), true);

let now = 0;
const director = createObjectActivityGazeDirector(() => now);
const quiet = { bindingKey: "task-a/roi-1", phaseKey: "task-a/checking", phase: "checking",
  busy: false, pendingConfirmation: false, tracked: true };
const at = (ms, patch = {}) => { now = ms; return director.update({ ...quiet, ...patch }); };
assert.equal(at(0), "person");
assert.equal(at(499), "person", "quiet dwell is required");
assert.equal(at(500), "object", "then one short object glance begins");
assert.equal(at(1_199), "object");
assert.equal(at(1_200), "person", "glance ends at 700 ms");
assert.equal(at(1_800), "person", "one glance maximum per binding and phase");

director.reset();
assert.equal(at(2_000), "person");
assert.equal(at(2_300, { busy: true }), "person");
assert.equal(at(2_301), "person", "quiet dwell restarts after busy ends");
assert.equal(at(2_800), "person");
assert.equal(at(2_801), "object");
assert.equal(at(2_900, { pendingConfirmation: true }), "person");
assert.equal(at(3_500), "person", "interrupted glance is consumed, never resumed");

director.reset();
assert.equal(at(4_000, { pendingConfirmation: true }), "person");
assert.equal(at(4_100), "person", "pending confirmation restarts a fresh quiet window");
assert.equal(at(4_599), "person");
assert.equal(at(4_600), "object");
assert.equal(at(4_700, { phaseKey: "task-a/preparing", phase: "preparing" }), "person",
  "phase transition resets the cadence");
assert.equal(at(5_200, { phaseKey: "task-a/preparing", phase: "preparing" }), "object");
assert.equal(at(5_300, { phase: "waiting_for_start" }), "person",
  "waiting-for-start is intentionally not an object-glance phase");
assert.equal(at(5_400, { phase: "completed" }), "person");
assert.equal(at(5_500, { tracked: false }), "person", "loss resets the gaze lease");
assert.equal(at(5_600, { phaseKey: "task-a/completed", phase: "completed" }), "person");

director.reset();
assert.equal(at(6_000), "person");
assert.equal(at(6_500), "object");
assert.equal(at(6_600, { bindingKey: "task-b/roi-2", phaseKey: "task-b/checking" }), "person",
  "new binding starts a fresh cadence");
console.log("Object activity reference: eligibility, stale identity, confirmed phase continuity and gaze cadence PASS");
