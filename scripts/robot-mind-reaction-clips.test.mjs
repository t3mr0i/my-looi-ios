import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const bodyStateModule = loadTypeScript("src/robot-mind/body-state.ts");
const clips = loadTypeScript("src/robot-mind/reaction-clips.ts");

// --- Policy ------------------------------------------------------------------
{
  let now = 100_000;
  const policy = clips.createReactionClipPolicy(() => now);
  const body = (mode = "resting") => ({ ...bodyStateModule.createInitialRobotBodyState(now), activity: { mode, since: now } });
  const event = (type, extra = {}) => ({ type, at: now, ...extra });

  assert.equal(policy.decide(event("person_appeared", { bearing: "left" }), body()).id, "perk_up");
  assert.equal(policy.decide(event("person_appeared", { bearing: "left" }), body()), null, "the same reaction does not repeat at once");
  now += 1_000;
  assert.equal(policy.decide(event("arrived_at_person"), body()), null, "two reactions do not stack within seconds");
  assert.equal(policy.decide(event("edge_reached", { side: "front" }), body()).id, "startled", "an edge startles regardless of the gap");
  assert.equal(clips.REACTION_CLIPS.startled.head, undefined, "at an edge the head stays still");
  now += 4_000;
  assert.equal(policy.decide(event("search_gave_up"), body("seeking_person")).id, "sigh");
  now += 4_000;
  assert.equal(policy.decide(event("arrived_at_person"), body("approaching")).id, "delighted");
  now += 4_000;
  assert.equal(policy.decide(event("woke_up"), body()).id, "stretch");

  now += 60_000;
  assert.equal(policy.decide(event("person_appeared", { bearing: "center" }), body("conversation")), null, "in a conversation the reply owns the face");
  assert.equal(policy.decide(event("edge_reached", { side: "rear" }), body("conversation")).id, "startled");
  now += 60_000;
  assert.equal(policy.decide(event("person_appeared", { bearing: "center" }), body("sleeping")), null);
  assert.equal(policy.decide({ type: "person_appeared", bearing: "center", at: now - 10_000 }, body()), null, "old events are not replayed");
  for (const type of ["petted", "person_left", "connected", "disconnected", "fell_asleep"]) {
    assert.equal(policy.decide(event(type), body()), null, `${type} has no clip`);
  }
  for (const clip of Object.values(clips.REACTION_CLIPS)) {
    assert.ok(clip.faceMs >= 800 && clip.faceMs <= 2_500);
    assert.ok(clip.head === undefined || ["curious", "happy_bob", "sleepy"].includes(clip.head), "head gestures only, from the existing set");
  }
}

// --- Runtime -----------------------------------------------------------------
{
  let now = 500_000;
  const store = bodyStateModule.createRobotBodyStateStore(() => now);
  const world = { appState: "active", focused: true, sleeping: false, connected: true, motionActive: false, ambient: "normal", userSpeaking: false, driving: false };
  const faces = [], heads = [], holds = [], diagnostics = [];
  const runtime = loadTypeScript("src/robot-mind/reaction-clips-runtime.ts", {
    "react-native": { AppState: { get currentState() { return world.appState; } } },
    "./body-state": { robotBodyState: store },
    "./reaction-clips": clips,
    "../character/character-reaction": { triggerCharacterReaction(mood, options) { faces.push([mood, options.durationMs, options.source]); return 1; } },
    "../core/ambient-motion": { holdAmbientHeadMotionFor(ms, source) { holds.push([ms, source]); } },
    "../core/main-screen-presence": { isMainScreenFocused: () => world.focused },
    "../device-tools/looi-robot": {
      getLooiRobotRuntimeState: () => ({ connected: world.connected, motionActive: world.motionActive }),
      async performLooiBehaviorHeadGesture(gesture, isCurrent) { heads.push([gesture, isCurrent()]); return { completed: true }; },
    },
    "../diagnostics/diagnostic-log": { recordDiagnosticEvent(category, event, details) { diagnostics.push({ category, event, ...details }); } },
    "../store/conversation": { useConversationStore: { getState: () => ({ isUserSpeaking: world.userSpeaking }) } },
    "../store/user": { useUserStore: { getState: () => ({ robotSleeping: world.sleeping, preferences: { ambientMotionLevel: world.ambient } }) } },
    "../voice/driving-control-session": { isDrivingControlSessionActive: () => world.driving },
  });
  const uninstall = runtime.installReactionClipsRuntime();
  const publish = (type, extra = {}) => store.publishEvent({ type, at: now, ...extra });

  publish("person_appeared", { bearing: "left" });
  assert.deepEqual(faces, [["curious", 1_400, "reaction-clip:perk_up"]]);
  assert.deepEqual(heads, [["curious", true]]);
  assert.deepEqual(holds, [[1_500, "reaction-clip"]], "ambient head motion yields to the clip");
  assert.ok(diagnostics.every((d) => d.category !== "cost"), "a clip is never a cost");

  now += 40_000; world.connected = false;
  publish("arrived_at_person");
  assert.equal(faces.at(-1)[0], "pleased", "without the base the face still reacts");
  assert.equal(heads.length, 1, "but no head command is sent");

  now += 40_000; world.connected = true; world.ambient = "off";
  publish("search_gave_up");
  assert.equal(faces.at(-1)[0], "thoughtful");
  assert.equal(heads.length, 1, "motion switched off keeps the head still");

  now += 40_000; world.ambient = "normal";
  publish("edge_reached", { side: "front" });
  assert.equal(faces.at(-1)[0], "startled");
  assert.equal(heads.length, 1, "no head movement at an edge");

  now += 40_000; world.appState = "background";
  publish("person_appeared", { bearing: "center" });
  world.appState = "active"; world.sleeping = true;
  publish("person_appeared", { bearing: "center" });
  world.sleeping = false; world.focused = false;
  publish("person_appeared", { bearing: "center" });
  assert.equal(faces.length, 4, "nothing plays in the background, asleep or off the main screen");

  world.focused = true; uninstall();
  publish("person_appeared", { bearing: "center" });
  assert.equal(faces.length, 4, "uninstalled means silent");
}

console.log("Robot mind reaction clips: policy and local playback PASS");
