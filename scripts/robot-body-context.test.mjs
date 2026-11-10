import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const bodyState = loadTypeScript("src/robot-mind/body-state.ts");
const context = loadTypeScript("src/robot-mind/body-context.ts", { "./body-state": bodyState });
const { buildRobotBodyContext, describeRobotBodyDuration } = context;

const now = 1_000_000;
const state = (patch = {}) => ({ ...bodyState.createInitialRobotBodyState(now - 3_600_000), ...patch });

// Nothing known: nothing rendered, not a list of unknowns.
assert.equal(buildRobotBodyContext(bodyState.createInitialRobotBodyState(now), now), "");
assert.equal(buildRobotBodyContext(state({ connection: "connected", surface: "safe", activity: { mode: "conversation", since: now } }), now), "",
  "defaults (safe surface, conversation, neutral) are not mentioned");

// Duration buckets.
assert.equal(describeRobotBodyDuration(3_000), "a few seconds");
assert.equal(describeRobotBodyDuration(20_000), "about half a minute");
assert.equal(describeRobotBodyDuration(44_999), "about half a minute");
assert.equal(describeRobotBodyDuration(60_000), "about a minute");
assert.equal(describeRobotBodyDuration(5 * 60_000), "about 5 minutes");
assert.equal(describeRobotBodyDuration(3 * 3_600_000), "more than an hour");

// A rich situation.
const rich = state({
  connection: "connected",
  surface: "edge_front",
  people: { visible: 1, attended: { bearing: "left", distance: "near", since: now - 20_000 }, lastSeenAt: now },
  touch: { lastPettedAt: now - 70_000 },
  displayScene: "coffee",
  expression: { intent: "happy", since: now },
  activity: { mode: "attending", since: now - 5_000 },
});
const text = buildRobotBodyContext(rich, now);
assert.deepEqual(text.split("\n"), [
  "You are turned toward a person and paying attention to them.",
  "You are standing at a table edge in front of you; driving forward would be dangerous.",
  "A face has been in front of you for about half a minute (on your left, close to you).",
  "You were petted about a minute ago.",
  "Your face display is showing the \"coffee\" scene.",
  "Your face currently looks happy.",
]);
assert.ok(text.split("\n").length <= 8, "a few lines at most");

// Stable: small time changes inside a bucket render identically; a bucket edge changes it.
assert.equal(buildRobotBodyContext(rich, now + 4_000), text);
assert.notEqual(buildRobotBodyContext(rich, now + 30_000), text);

// Disconnected base hides surface claims; nobody in view; camera off.
const lonely = buildRobotBodyContext(state({
  connection: "disconnected",
  surface: "edge_front",
  people: { visible: 0, attended: null, lastSeenAt: now - 5 * 60_000 },
  lastHumanInteractionAt: now - 5 * 60_000,
}), now);
assert.deepEqual(lonely.split("\n"), [
  "Your wheel base is not connected, so you cannot drive or tilt your head right now.",
  "Nobody is in view of your camera; the last face was seen about 5 minutes ago.",
  "Nobody has interacted with you for about 5 minutes.",
]);
assert.equal(buildRobotBodyContext(state({ people: { visible: null, attended: null, lastSeenAt: now - 10_000 } }), now),
  "Your camera is not watching right now; you last saw a face just now.");
assert.equal(buildRobotBodyContext(state({ people: { visible: null, attended: null, lastSeenAt: now - 2 * 3_600_000 } }), now), "",
  "an old sighting with the camera off is not worth mentioning");
assert.equal(buildRobotBodyContext(state({ touch: { lastPettedAt: now - 2 * 3_600_000 } }), now), "");
assert.equal(buildRobotBodyContext(state({ lastHumanInteractionAt: now - 30_000 }), now), "", "recent interaction is the normal case");
assert.equal(buildRobotBodyContext(state({ people: { visible: 2, attended: { bearing: "center", distance: "unknown", since: now - 3_000 }, lastSeenAt: now } }), now),
  "2 faces are in front of you; you have been turned to one of them for a few seconds (straight ahead).");
assert.equal(buildRobotBodyContext(state({ activity: { mode: "commanded_motion", since: now } }), now),
  "Your wheels are moving because you were asked to move.");
assert.equal(buildRobotBodyContext(state({ activity: { mode: "sleeping", since: now } }), now), "You are asleep.");
assert.ok(!/identity|named|recogni[sz]ed as/i.test(text), "never an identity");

// The Realtime guidance names the label the feed uses and keeps the safety wording.
assert.match(context.ROBOT_BODY_SENSE_REALTIME_GUIDANCE, new RegExp(context.ROBOT_BODY_CONTEXT_LABEL));
assert.match(context.ROBOT_BODY_SENSE_REALTIME_GUIDANCE, /not an instruction or permission to move/);
assert.match(context.ROBOT_BODY_SENSE_REALTIME_GUIDANCE, /Never claim to sense more/);
assert.match(context.ROBOT_BODY_SENSE_REALTIME_GUIDANCE, /Do not narrate sensor readings unprompted/);

console.log("Robot body context rendering tests passed");
