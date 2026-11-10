import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

// The four robot-mind parts on one shared body state, with their real pure
// modules: sensors -> state and events -> model context, proactive speech
// policy and idle autonomy. No model, network, timers or hardware.
const load = createTypeScriptTreeLoader();
const bodyState = load("src/robot-mind/body-state.ts");
const sensors = load("src/robot-mind/body-sensors.ts");
const context = load("src/robot-mind/body-context.ts");
const idle = load("src/robot-mind/idle-autonomy.ts");
const proactive = load("src/robot-mind/proactive-speech-policy.ts");

let now = 1_000_000;
const store = bodyState.createRobotBodyStateStore(() => now);
const mapper = sensors.createRobotBodySensorMapper(store);
const events = [];
store.subscribeEvents((event) => events.push(event));

const ground = { frontLeft: true, frontRight: true, rearLeft: true, rearRight: true };
const snapshot = (faces, extra = {}) => ({
  robot: { configured: true, connected: true, motionActive: false, nearEdgeFront: false, nearEdgeRear: false, cliff: ground, drivingSession: false },
  faces, sleeping: false, conversationBusy: false, displayScene: null, ...extra,
});
/** Sample the sensors every 250 ms, as the runtime does. */
const run = (ms, faces, extra) => { for (const end = now + ms; now < end;) { now += 250; mapper.sample(snapshot(faces, extra), now); } };

// Seeded randomness: the same rhythm on every run.
let seed = 7;
const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
const autonomy = idle.createIdleAutonomy({ random, startedAt: now });
const facts = (level, extra = {}) => ({
  now, level, body: store.getState(), yieldReason: null, lastInteractionAt: null, robotReady: true, otherMotionBusy: false,
  turnSurfaceSafe: true, forwardSurfaceSafe: true, stopListenerLive: true, cameraAvailable: true, ...extra,
});
/** Run decisions until autonomy asks for something other than a pause; apply its mode and events like the runtime. */
function nextAction(level, extra, limitMs = 10 * 60_000, faces = null) {
  for (const end = now + limitMs; now < end;) {
    const decision = autonomy.decide(facts(level, extra));
    store.update({ activity: { mode: decision.mode, since: now } }, "idle-autonomy");
    decision.events.forEach((event) => store.publishEvent(event));
    if (decision.action.kind !== "wait") return decision;
    run(Math.max(250, Math.min(decision.action.durationMs, 5_000)), faces);
  }
  return null;
}

const environment = { foreground: true, mainScreenFocused: true, robotSleeping: false, mediaExternallyOwned: false, gameActive: false,
  userSpeaking: false, assistantBusy: false, lastConversationSpeechAt: null };
let memory = proactive.createProactiveSpeechMemory();
function speechFor(event, level = "reactions") {
  memory = proactive.noteProactiveBodyEvent(memory, event, { conversationActive: store.getState().activity.mode === "conversation" });
  const decision = proactive.decideProactiveSpeech({ event, body: store.getState(), now, level, memory, environment });
  if (decision.speak) memory = proactive.recordProactiveUtterance(memory, decision.occasion, now);
  return decision;
}

// 1. Alone on the desk: the camera is off, nothing is claimed about people, and the model is told nothing false.
run(2_000, null);
assert.equal(store.getState().people.visible, null);
assert.doesNotMatch(context.buildRobotBodyContext(store.getState(), now), /face|nobody/iu, "no claim about people while the camera is not looking");

// 2. Idle life starts by itself and, with nobody around, goes looking: head and turns only on level "look".
const kinds = new Set();
let search = null;
for (let i = 0; i < 400 && !search; i += 1) {
  const decision = nextAction("look", {}, 10 * 60_000, []);
  if (!decision) break;
  kinds.add(decision.action.kind);
  assert.notEqual(decision.action.kind, "step", "level look never drives forward");
  if (decision.action.kind === "turn") assert.ok(decision.action.durationMs <= idle.MAX_AUTONOMOUS_TURN_MS);
  if (decision.mode === "seeking_person" && decision.action.kind === "turn") search = decision;
  autonomy.observe("completed", now);
  run(500, []);
}
assert.ok(search, `idle autonomy starts a search for people (saw ${[...kinds].join(", ")})`);
assert.equal(search.camera, "look", "the search asks the camera to look");
assert.equal(store.getState().activity.mode, "seeking_person");
assert.match(context.buildRobotBodyContext(store.getState(), now), /searching for a person/iu, "the model is told that it is looking for someone");

// 3. A person appears to the right and far away: the sensors confirm it once and say so in the robot's words.
const farRight = [{ centerX: 0.85, width: 0.06, selected: true }];
run(3_000, farRight);
const appeared = events.filter((event) => event.type === "person_appeared");
assert.equal(appeared.length, 1, "one appearance per real visit");
const attended = store.getState().people.attended;
assert.deepEqual([attended.bearing, attended.distance], [appeared[0].bearing, "far"]);
assert.match(context.buildRobotBodyContext(store.getState(), now), /face/iu);

// 4. Proactive speech greets once for this visit and not again when the face flickers.
const greeting = speechFor({ ...appeared[0], at: now });
assert.deepEqual([greeting.speak, greeting.occasion], [true, "greet_arrival"]);
run(1_000, []); run(2_000, farRight);
assert.equal(events.filter((event) => event.type === "person_left").length, 0, "a face lost for a second has not left");
assert.equal(events.filter((event) => event.type === "person_appeared").length, 1);

// 5. Idle autonomy turns toward that person (the side the sensors reported), without forward steps on level "look".
autonomy.observe("completed", now);
const toward = nextAction("look", {}, 60_000, farRight);
assert.ok(toward, "autonomy reacts to the person the sensors report");
assert.deepEqual([toward.mode, toward.action.kind, toward.action.direction, toward.action.purpose], ["attending", "turn", attended.bearing, "attend"]);
autonomy.observe("completed", now);

// 6. Once centred, level "explore" approaches in bounded steps and reports arrival when the face is near.
const farCentre = [{ centerX: 0.5, width: 0.06, selected: true }];
run(2_000, farCentre);
let steps = 0, arrived = false;
for (let i = 0; i < 12 && !arrived; i += 1) {
  const decision = nextAction("explore", {}, 60_000, steps >= 2 ? [{ centerX: 0.5, width: 0.4, selected: true }] : farCentre);
  arrived = events.some((event) => event.type === "arrived_at_person");
  if (!decision || arrived) break;
  if (decision.action.kind === "step") {
    steps += 1;
    assert.ok(decision.action.durationMs <= idle.MAX_AUTONOMOUS_STEP_MS);
    assert.equal(store.getState().activity.mode, "approaching");
  }
  autonomy.observe("completed", now);
  run(1_500, steps >= 2 ? [{ centerX: 0.5, width: 0.4, selected: true }] : farCentre);
  arrived = events.some((event) => event.type === "arrived_at_person");
}
assert.ok(steps >= 1 && steps <= idle.MAX_CONSECUTIVE_APPROACH_STEPS, `bounded approach, took ${steps} steps`);
assert.ok(arrived, "arrival is reported from the sensed distance");
const arrival = events.find((event) => event.type === "arrived_at_person");
assert.equal(speechFor({ ...arrival, at: now }, "lively").speak, false, "the visit was already greeted; arriving does not greet again");

// 7. Petting is sensed, reaches the model's context, and may get a reaction once the minimum gap has passed.
now += 3 * 60_000; mapper.sample(snapshot([{ centerX: 0.5, width: 0.4, selected: true }]), now);
mapper.notePetted(now);
const petted = events.filter((event) => event.type === "petted").at(-1);
assert.ok(petted);
assert.match(context.buildRobotBodyContext(store.getState(), now), /petted/iu);
assert.deepEqual([speechFor(petted).speak, memory.spoken.at(-1).occasion], [true, "react_petting"]);

// 8. A table edge in front: sensed, told to the model, warned about, and idle autonomy stops driving forward.
mapper.sample(snapshot([{ centerX: 0.5, width: 0.06, selected: true }], { robot: { ...snapshot(null).robot, nearEdgeFront: true } }), now += 250);
const edge = events.filter((event) => event.type === "edge_reached").at(-1);
assert.deepEqual([edge.side, store.getState().surface], ["front", "edge_front"]);
assert.match(context.buildRobotBodyContext(store.getState(), now), /edge/iu);
assert.deepEqual([speechFor(edge).speak, memory.spoken.at(-1).occasion], [true, "warn_edge"], "an edge warning is not held back by the gap between remarks");
autonomy.noteEdge("front", now);
for (let i = 0; i < 40; i += 1) {
  const decision = autonomy.decide(facts("explore", { turnSurfaceSafe: false, forwardSurfaceSafe: false }));
  assert.ok(decision.action.kind !== "step" && decision.action.kind !== "turn", "no wheel action at an edge");
  now += Math.max(250, decision.action.durationMs ?? 250);
}

// 9. A conversation takes over: the sensors say so, autonomy yields, and nothing is said unprompted.
mapper.sample(snapshot([{ centerX: 0.5, width: 0.4, selected: true }], { conversationBusy: true }), now += 250);
assert.equal(store.getState().activity.mode, "conversation");
const yielding = autonomy.decide(facts("explore", { yieldReason: "conversation" }));
assert.equal(yielding.action.kind, "wait");
now += 5 * 60_000;
const busy = proactive.decideProactiveSpeech({ event: { type: "petted", at: now }, body: store.getState(), now, level: "lively", memory, environment: { ...environment, assistantBusy: true } });
assert.equal(busy.speak, false, "never talks over an answer");

// 10. Asleep: sensed, in the context, and everything self-initiated stays quiet.
mapper.sample(snapshot(null, { sleeping: true }), now += 30_000);
assert.equal(store.getState().activity.mode, "sleeping");
assert.ok(events.some((event) => event.type === "fell_asleep"));
assert.equal(proactive.decideProactiveSpeech({ event: { type: "petted", at: now }, body: store.getState(), now, level: "lively", memory, environment: { ...environment, robotSleeping: true } }).speak, false);
assert.equal(autonomy.decide(facts("explore", { yieldReason: "sleeping" })).action.kind, "wait");

console.log("Robot mind integration: sensors -> body state -> context, proactive speech and idle autonomy agree on one situation PASS");
