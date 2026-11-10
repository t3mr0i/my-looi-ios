import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { VirtualClock } from "./helpers/virtual-clock.mjs";

const bodyState = loadTypeScript("src/robot-mind/body-state.ts");
const sensors = loadTypeScript("src/robot-mind/body-sensors.ts");

function setup() {
  let clock = 10_000;
  const store = bodyState.createRobotBodyStateStore(() => clock);
  const events = [];
  store.subscribeEvents((event) => events.push(event));
  const mapper = sensors.createRobotBodySensorMapper(store);
  const base = () => ({
    robot: { configured: true, connected: true, motionActive: false, nearEdgeFront: false, nearEdgeRear: false,
      cliff: { frontLeft: true, frontRight: true, rearLeft: true, rearRight: true }, drivingSession: false },
    faces: [],
    sleeping: false,
    conversationBusy: false,
    displayScene: null,
  });
  let snapshot = base();
  const at = (ms, patch = {}) => {
    clock = ms;
    snapshot = { ...snapshot, ...patch, robot: { ...snapshot.robot, ...(patch.robot ?? {}) } };
    mapper.sample(snapshot, ms);
  };
  /** Sample every 250 ms like the runtime does. */
  const run = (from, to, patch = {}) => { for (let t = from; t <= to; t += 250) at(t, patch); };
  const types = () => events.map((event) => event.type);
  return { store, events, mapper, at, run, types, setNow: (ms) => { clock = ms; } };
}

const face = (centerX = 0.5, width = 0.2, selected = true) => ({ centerX, width, selected });

// Connection: first connect publishes once; a short BLE flap is not a disconnect.
{
  const t = setup();
  t.at(10_000);
  assert.equal(t.store.getState().connection, "connected");
  assert.deepEqual(t.types(), ["connected"]);
  t.run(10_250, 12_000, { robot: { connected: false } });
  assert.equal(t.store.getState().connection, "connected", "a disconnect under 3 s is not reported");
  t.run(12_250, 13_000, { robot: { connected: true } });
  t.run(13_250, 17_000, { robot: { connected: false } });
  assert.equal(t.store.getState().connection, "disconnected");
  assert.deepEqual(t.types(), ["connected", "disconnected"]);
  assert.equal(t.store.getState().surface, "unknown", "no surface claim without the base");
}

// Never connected: plain disconnected fact, no event; unconfigured stays unknown.
{
  const t = setup();
  t.at(10_000, { robot: { connected: false, configured: false } });
  assert.equal(t.store.getState().connection, "unknown");
  t.at(10_250, { robot: { configured: true } });
  assert.equal(t.store.getState().connection, "disconnected");
  assert.deepEqual(t.types(), []);
}

// Faces: debounce appearance, survive short losses and camera pauses, no false "left".
{
  const t = setup();
  t.at(10_000, { faces: [face(0.2, 0.35)] });
  assert.equal(t.store.getState().people.visible, 0, "a single frame is not yet a person");
  assert.deepEqual(t.types().filter((type) => type.startsWith("person")), []);
  t.run(10_250, 11_000, { faces: [face(0.2, 0.35)] });
  const appeared = t.events.filter((event) => event.type === "person_appeared");
  assert.equal(appeared.length, 1);
  assert.equal(appeared[0].bearing, "left");
  const people = t.store.getState().people;
  assert.equal(people.visible, 1);
  assert.deepEqual({ ...people.attended }, { bearing: "left", distance: "near", since: 10_500 });

  // Lost for 5 s: still the same visit.
  t.run(11_250, 16_000, { faces: [] });
  assert.equal(t.store.getState().people.visible, 1, "a face lost for a moment keeps the visit");
  t.run(16_250, 17_000, { faces: [face(0.22, 0.34)] });
  assert.equal(t.events.filter((event) => event.type === "person_appeared").length, 1, "coming back is not a new appearance");

  // Camera stops for 20 s, comes back, same person: still one visit, and no "left" while blind.
  t.run(17_250, 37_000, { faces: null });
  assert.equal(t.store.getState().people.visible, null);
  assert.equal(t.store.getState().people.attended, null);
  assert.equal(t.store.getState().people.lastSeenAt, 17_000);
  t.run(37_250, 38_000, { faces: [face(0.5, 0.2)] });
  assert.equal(t.events.filter((event) => event.type === "person_appeared").length, 1);
  assert.equal(t.store.getState().people.attended.since, 10_500, "the visit keeps its start");

  // The camera restarts and sees nobody: "left" needs 8 s of watched absence, not 8 s since last seen.
  t.run(38_250, 60_000, { faces: null });
  t.at(60_250, { faces: [] });
  assert.ok(!t.types().includes("person_left"), "a long blind gap is not evidence of leaving");
  t.run(60_500, 68_000, { faces: [] });
  assert.ok(!t.types().includes("person_left"));
  t.run(68_250, 68_500, { faces: [] });
  assert.equal(t.types().filter((type) => type === "person_left").length, 1);
  assert.equal(t.store.getState().people.visible, 0);
  assert.equal(t.store.getState().people.attended, null);
  assert.equal(t.store.getState().people.lastSeenAt, 38_000);
}

// A camera pause longer than the continuity window closes the visit silently.
{
  const t = setup();
  t.run(10_000, 11_000, { faces: [face()] });
  t.run(11_250, 80_000, { faces: null });
  t.run(80_250, 81_000, { faces: [face()] });
  assert.deepEqual(t.types().filter((type) => type.startsWith("person")), ["person_appeared", "person_appeared"]);
}

// Bearing and count need a stable second; distance stays unknown in the uncalibrated middle band.
{
  const t = setup();
  t.run(10_000, 11_000, { faces: [face(0.5, 0.2)] });
  assert.equal(t.store.getState().people.attended.bearing, "center");
  assert.equal(t.store.getState().people.attended.distance, "unknown");
  t.at(11_250, { faces: [face(0.85, 0.2), face(0.3, 0.1, false)] });
  assert.equal(t.store.getState().people.attended.bearing, "center", "one frame does not turn the bearing");
  assert.equal(t.store.getState().people.visible, 1);
  t.run(11_500, 12_500, { faces: [face(0.85, 0.2), face(0.3, 0.1, false)] });
  assert.equal(t.store.getState().people.attended.bearing, "right");
  assert.equal(t.store.getState().people.visible, 2);
  t.run(12_750, 13_000, { faces: [face(0.85, 0.08)] });
  assert.equal(t.store.getState().people.attended.distance, "far");
}

// Edges: latch is immediate and publishes once; raw readings need 500 ms; lifted is not an edge.
{
  const t = setup();
  t.at(10_000, { robot: { nearEdgeFront: true } });
  assert.equal(t.store.getState().surface, "edge_front");
  t.run(10_250, 11_000);
  assert.deepEqual(t.events.filter((event) => event.type === "edge_reached").map((event) => event.side), ["front"]);
  t.at(11_250, { robot: { nearEdgeFront: false } });
  assert.equal(t.store.getState().surface, "safe");
  const rearOff = { frontLeft: true, frontRight: true, rearLeft: false, rearRight: true };
  t.at(11_500, { robot: { cliff: rearOff } });
  assert.equal(t.store.getState().surface, "unknown", "an unconfirmed raw edge is not yet reported");
  t.run(11_750, 12_250, { robot: { cliff: rearOff } });
  assert.equal(t.store.getState().surface, "edge_rear");
  t.at(12_500, { robot: { cliff: { frontLeft: false, frontRight: false, rearLeft: false, rearRight: false } } });
  assert.equal(t.store.getState().surface, "unknown");
  t.at(12_750, { robot: { cliff: null } });
  assert.equal(t.store.getState().surface, "unknown");
  assert.deepEqual(t.events.filter((event) => event.type === "edge_reached").map((event) => event.side), ["front", "rear"]);
}

// Activity: sleeping, conversation with grace, commanded motion; idle modes of workstream C are left alone.
{
  const t = setup();
  t.at(10_000);
  assert.equal(t.store.getState().activity.mode, "resting");
  t.at(10_250, { conversationBusy: true });
  assert.equal(t.store.getState().activity.mode, "conversation");
  t.run(10_500, 29_000, { conversationBusy: false });
  assert.equal(t.store.getState().activity.mode, "conversation", "held through the grace period");
  t.at(30_500);
  assert.equal(t.store.getState().activity.mode, "resting");

  t.at(31_000, { robot: { motionActive: true } });
  assert.equal(t.store.getState().activity.mode, "resting", "a micro-pivot is not a commanded drive");
  assert.equal(t.store.getState().wheelsMoving, true);
  t.at(31_500);
  assert.equal(t.store.getState().activity.mode, "commanded_motion");
  t.at(32_000, { robot: { motionActive: false } });
  assert.equal(t.store.getState().activity.mode, "resting");
  t.at(32_250, { robot: { motionActive: true, drivingSession: true } });
  assert.equal(t.store.getState().activity.mode, "commanded_motion", "an explicit driving session counts at once");
  t.at(32_500, { robot: { motionActive: false, drivingSession: false } });

  t.store.update({ activity: { mode: "approaching", since: 32_600 } }, "idle-autonomy");
  t.run(32_750, 34_000, { robot: { motionActive: true } });
  assert.equal(t.store.getState().activity.mode, "approaching", "C's own drive is not relabelled");
  t.at(34_250, { robot: { motionActive: false } });
  assert.equal(t.store.getState().activity.mode, "approaching");
  t.at(34_500, { conversationBusy: true });
  assert.equal(t.store.getState().activity.mode, "conversation", "conversation takes over from idle");

  t.at(35_000, { sleeping: true, conversationBusy: false });
  assert.equal(t.store.getState().activity.mode, "sleeping");
  t.at(35_250);
  t.at(40_000, { sleeping: false });
  assert.deepEqual(t.types().filter((type) => type === "fell_asleep" || type === "woke_up"), ["fell_asleep", "woke_up"]);
  assert.equal(t.store.getState().activity.mode, "resting");
}

// Petting and interactions.
{
  const t = setup();
  t.mapper.notePetted(10_000);
  t.mapper.notePetted(10_800);
  t.mapper.notePetted(13_000);
  assert.equal(t.types().filter((type) => type === "petted").length, 2, "one stroke burst is one petting moment");
  assert.equal(t.store.getState().touch.lastPettedAt, 13_000);
  assert.equal(t.store.getState().lastHumanInteractionAt, 13_000);
  t.mapper.noteHumanInteraction(13_500);
  assert.equal(t.store.getState().lastHumanInteractionAt, 13_000, "throttled to once per second");
  t.mapper.noteHumanInteraction(14_100);
  assert.equal(t.store.getState().lastHumanInteractionAt, 14_100);
  t.at(14_200, { displayScene: "coffee" });
  assert.equal(t.store.getState().displayScene, "coffee");
}

// Steady state: identical samples do not touch the store.
{
  const t = setup();
  t.run(10_000, 11_000, { faces: [face()] });
  const revision = t.store.getRevision();
  t.at(11_250, { faces: [face()] });
  t.at(11_500, { faces: [face()] });
  assert.equal(t.store.getRevision(), revision, "lastSeenAt refreshes at most every 2 s");
}

// Runtime wiring: real sources are read, only accepted strokes count as petting, raw VAD is not a human.
{
  const clock = new VirtualClock();
  const store = bodyState.createRobotBodyStateStore(() => clock.now);
  const events = [];
  store.subscribeEvents((event) => events.push(event.type));
  const zustand = (initial) => {
    let state = initial;
    const listeners = new Set();
    return { getState: () => state, setState(patch) { state = { ...state, ...patch }; for (const listener of [...listeners]) listener(state); },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, listenerCount: () => listeners.size };
  };
  const robot = { configured: true, connected: true, motionActive: false, nearEdge: { front: false, rear: false }, sensors: { cliffSensors: null }, stopGeneration: 0 };
  const robotListeners = new Set();
  const interactionListeners = new Set();
  const social = { running: true, attentionActive: true, nativeStarted: true, faces: [], selectedFaceId: null };
  const reactions = zustand({ mood: null, reactionId: 0, source: null });
  const conversation = zustand({ messages: [], isUserSpeaking: false, isProcessing: false, isSpeaking: false });
  const user = zustand({ robotSleeping: false, voiceState: "listening" });
  const scenes = zustand({ active: null, pending: null });
  const runtime = loadTypeScript("src/robot-mind/body-sensors-runtime.ts", {
    "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => robot, subscribeLooiRobotRuntimeState: (listener) => { robotListeners.add(listener); return () => robotListeners.delete(listener); } },
    "../core/social-attention": { getSocialAttentionControllerState: () => social },
    "../core/robot-inactivity": { subscribeRobotInteractions: (listener) => { interactionListeners.add(listener); return () => interactionListeners.delete(listener); } },
    "../character/character-action-runtime": { useCharacterActionStore: scenes },
    "../character/character-reaction": { useCharacterReactionStore: reactions },
    "../store/conversation": { useConversationStore: conversation },
    "../store/user": { useUserStore: user },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => false },
    "./body-state": { robotBodyState: store },
    "./body-sensors": sensors,
  }, clock.globals());

  const uninstall = runtime.installRobotBodySensors();
  assert.equal(runtime.installRobotBodySensors(), uninstall, "installed once");
  assert.equal(store.getState().connection, "connected");
  assert.equal(store.getState().people.visible, 0, "camera running and empty");

  social.faces = [{ centerX: 0.5, centerY: 0.5, width: 0.2, trackingId: "t1" }];
  social.selectedFaceId = "t1";
  await clock.advanceTo(clock.now + 750);
  assert.deepEqual(events, ["connected", "person_appeared"]);

  reactions.setState({ mood: "petted", reactionId: 1, source: "behavior" });
  assert.equal(store.getState().touch.lastPettedAt, null, "a behaviour cue's petted mood is not a touch");
  reactions.setState({ mood: "petted", reactionId: 2, source: "friendly-face-stroke" });
  assert.equal(store.getState().touch.lastPettedAt, clock.now);
  assert.equal(events.at(-1), "petted");

  for (const listener of interactionListeners) listener("realtime-pcm-speech-start");
  for (const listener of interactionListeners) listener("robot-bridge-command");
  assert.equal(store.getState().lastHumanInteractionAt, clock.now, "only the stroke so far");
  await clock.advanceTo(clock.now + 5_000);
  for (const listener of interactionListeners) listener("touch");
  assert.equal(store.getState().lastHumanInteractionAt, clock.now);

  await clock.advanceTo(clock.now + 5_000);
  conversation.setState({ messages: [{ id: "old", role: "user", content: "hi", timestamp: new Date(clock.now - 60_000).toISOString() }] });
  assert.equal(store.getState().lastHumanInteractionAt, clock.now - 5_000, "restored history is not a new turn");
  conversation.setState({ messages: [...conversation.getState().messages, { id: "new", role: "user", content: "hello", timestamp: new Date(clock.now).toISOString() }], isProcessing: true });
  assert.equal(store.getState().lastHumanInteractionAt, clock.now);
  assert.equal(store.getState().activity.mode, "conversation");

  scenes.setState({ active: { id: 1, kind: "coffee", phase: "use" } });
  assert.equal(store.getState().displayScene, "coffee");

  uninstall();
  assert.equal(clock.timers.size, 0);
  assert.equal(robotListeners.size + interactionListeners.size + reactions.listenerCount() + conversation.listenerCount() + user.listenerCount() + scenes.listenerCount(), 0);
}

// The reaction store now names who triggered it; robot-inactivity reports every interaction.
{
  const clock = new VirtualClock();
  const create = (initializer) => {
    let state; const set = (patch) => { state = { ...state, ...patch }; };
    state = initializer(set); return { getState: () => state };
  };
  const reaction = loadTypeScript("src/character/character-reaction.ts", { zustand: { create }, "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} } }, clock.globals());
  reaction.triggerCharacterReaction("petted", { source: "friendly-face-stroke" });
  assert.equal(reaction.useCharacterReactionStore.getState().source, "friendly-face-stroke");
  await clock.advanceTo(clock.now + 2_000);
  assert.equal(reaction.useCharacterReactionStore.getState().source, null);

  const seen = [];
  const user = { robotSleeping: true };
  const inactivity = loadTypeScript("src/core/robot-inactivity.ts", {
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
    "../store/user": { useUserStore: { getState: () => user } },
    "./ambient-motion": { noteAmbientMotionInteraction() {} },
    "./social-attention": { noteSocialAttentionInteraction() {} },
  }, clock.globals());
  const remove = inactivity.subscribeRobotInteractions((source) => seen.push(source));
  inactivity.subscribeRobotInteractions(() => { throw new Error("observer failure must not break the timer"); });
  inactivity.markRobotInteraction("wake-face");
  remove();
  inactivity.markRobotInteraction("touch");
  assert.deepEqual(seen, ["wake-face"], "reported even while sleeping, until unsubscribed");
}

console.log("Robot body sensor mapping and runtime wiring tests passed");
