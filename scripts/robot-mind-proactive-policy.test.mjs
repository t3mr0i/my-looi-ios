import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const body = loadTypeScript("src/robot-mind/body-state.ts");
const p = loadTypeScript("src/robot-mind/proactive-speech-policy.ts");
const MIN = 60_000;
const T0 = 10_000_000;

const calm = () => ({
  foreground: true, mainScreenFocused: true, robotSleeping: false, mediaExternallyOwned: false,
  gameActive: false, userSpeaking: false, assistantBusy: false, lastConversationSpeechAt: null,
});
const state = (patch = {}) => ({ ...body.createInitialRobotBodyState(T0 - 3_600_000), ...patch });

/** A small driver that applies events the way the runtime does. */
function driver(level = "reactions") {
  let memory = p.createProactiveSpeechMemory();
  const d = {
    level, env: calm(), body: state(), conversationActive: false,
    get memory() { return memory; },
    set memory(next) { memory = next; },
    event(event, now = event.at) {
      memory = p.noteProactiveBodyEvent(memory, event, { conversationActive: d.conversationActive });
      const decision = p.decideProactiveSpeech({ event, body: d.body, now, level: d.level, memory, environment: d.env });
      if (decision.speak) memory = p.recordProactiveUtterance(memory, decision.occasion, now);
      return decision;
    },
  };
  return d;
}
const appeared = (at, bearing = "center") => ({ type: "person_appeared", at, bearing });
const left = (at) => ({ type: "person_left", at });
const petted = (at) => ({ type: "petted", at });
const edge = (at, side = "front") => ({ type: "edge_reached", at, side });
const gaveUp = (at) => ({ type: "search_gave_up", at });
const arrived = (at) => ({ type: "arrived_at_person", at });

// Levels, defaults and normalization.
assert.deepEqual([...p.PROACTIVE_SPEECH_LEVELS], ["off", "reactions", "lively"]);
assert.equal(p.DEFAULT_PROACTIVE_SPEECH_LEVEL, "reactions");
assert.equal(p.normalizeProactiveSpeechLevel("lively"), "lively");
assert.equal(p.normalizeProactiveSpeechLevel("chatty"), "reactions");
assert.equal(p.normalizeProactiveSpeechLevel(undefined), "reactions");
for (const occasion of p.PROACTIVE_OCCASIONS) {
  assert.ok(p.isProactiveOccasion(occasion));
  assert.ok(p.PROACTIVE_OCCASION_COOLDOWN_MS[occasion] >= p.PROACTIVE_GLOBAL_MIN_GAP_MS || occasion === "warn_edge" || occasion === "react_petting",
    `${occasion} has a cooldown`);
}
assert.equal(p.isProactiveOccasion("drive_away"), false);

// Event -> occasion mapping, and events that are never an occasion.
{
  const d = driver("lively");
  assert.deepEqual(d.event(appeared(T0)), { speak: true, occasion: "greet_arrival", detail: {} });
  for (const type of ["connected", "disconnected", "woke_up", "fell_asleep"]) {
    assert.deepEqual(d.event({ type, at: T0 + 10 * MIN }), { speak: false, reason: "not_an_occasion", occasion: null }, type);
  }
  assert.deepEqual(driver().event(edge(T0, "rear")), { speak: true, occasion: "warn_edge", detail: { edgeSide: "rear" } });
  assert.equal(driver().event(petted(T0)).occasion, "react_petting");
  assert.equal(driver("lively").event(gaveUp(T0)).occasion, "gave_up_search");
  assert.equal(driver("lively").event(arrived(T0)).occasion, "arrived");
}

// Setting levels: off silences everything, reactions skips idle-behaviour remarks.
{
  for (const make of [appeared, petted, edge, gaveUp, arrived]) {
    assert.equal(driver("off").event(make(T0)).reason, "setting_off");
  }
  assert.equal(driver("reactions").event(gaveUp(T0)).reason, "setting_level");
  assert.equal(driver("reactions").event(arrived(T0)).reason, "setting_level");
  assert.equal(driver("lively").event(gaveUp(T0)).speak, true);
  for (const make of [appeared, petted, edge]) assert.equal(driver("reactions").event(make(T0)).speak, true);
}

// Quiet states.
{
  const quiet = (patch, bodyPatch = {}) => {
    const d = driver("lively");
    Object.assign(d.env, patch);
    d.body = state(bodyPatch);
    return d.event(petted(T0)).reason;
  };
  assert.equal(quiet({ robotSleeping: true }), "sleeping");
  assert.equal(quiet({}, { activity: { mode: "sleeping", since: T0 - MIN } }), "sleeping");
  assert.equal(quiet({ foreground: false }), "app_not_attending");
  assert.equal(quiet({ mainScreenFocused: false }), "app_not_attending");
  assert.equal(quiet({ mediaExternallyOwned: true }), "app_not_attending");
  assert.equal(quiet({ gameActive: true }), "game_active");
  assert.equal(quiet({ userSpeaking: true }), "person_speaking");
  assert.equal(quiet({ assistantBusy: true }), "assistant_busy");
  assert.equal(quiet({ lastConversationSpeechAt: T0 - 2_000 }), "conversation_settling");
  assert.equal(quiet({ lastConversationSpeechAt: T0 - p.PROACTIVE_CONVERSATION_SETTLE_MS }), undefined, "settled conversation may speak");
  // An event that arrives late describes a past moment.
  const late = driver();
  assert.equal(late.event(petted(T0), T0 + p.PROACTIVE_EVENT_MAX_AGE_MS + 1).reason, "stale_event");
}

// Quiet request window.
{
  const d = driver();
  d.memory = p.requestProactiveQuiet(d.memory, T0);
  assert.equal(d.event(petted(T0 + MIN)).reason, "quiet_requested");
  assert.equal(d.event(petted(T0 + p.PROACTIVE_QUIET_REQUEST_MS - 1)).reason, "quiet_requested");
  assert.equal(d.event(petted(T0 + p.PROACTIVE_QUIET_REQUEST_MS)).speak, true);
  // A shorter later request never shortens a longer one.
  const longer = p.requestProactiveQuiet(p.requestProactiveQuiet(p.createProactiveSpeechMemory(), T0, 10 * MIN), T0 + MIN, MIN);
  assert.equal(longer.quietUntil, T0 + 10 * MIN);
}
for (const [text, quiet] of [
  ["Shh", true], ["psst!", true], ["Sei still", true], ["sei mal leise bitte", true], ["Ruhe bitte!", true],
  ["помолчи", true], ["Тихо!", true], ["мовчи", true], ["Be quiet please.", true],
  ["Be quiet about the surprise when Anna comes home later today, okay?", false],
  ["He said \"be quiet\" to me", false], ["What is quiet in German?", false], ["", false],
]) assert.equal(p.isExplicitQuietRequest(text), quiet, text);

// One greeting per visit, including face-detection flicker within the visit gap.
{
  const d = driver();
  assert.equal(d.event(appeared(T0)).occasion, "greet_arrival");
  assert.equal(d.event(left(T0 + MIN)).reason, "not_an_occasion");
  assert.equal(d.event(appeared(T0 + MIN + 30_000)).reason, "already_greeted_this_visit", "flicker is the same visit");
  assert.equal(d.event(appeared(T0 + 2 * MIN)).reason, "already_greeted_this_visit", "still present: same visit");
  d.event(left(T0 + 3 * MIN));
  // Gone longer than the visit gap: a new visit, but the greeting cooldown still applies.
  assert.equal(d.event(appeared(T0 + 3 * MIN + p.PROACTIVE_VISIT_GAP_MS)).reason, "occasion_cooldown");
  d.event(left(T0 + 7 * MIN));
  assert.equal(d.event(appeared(T0 + 20 * MIN)).occasion, "greet_arrival", "a new visit after the cooldown is greeted");
  assert.equal(d.event(arrived(T0 + 21 * MIN)).reason, "setting_level");
  d.level = "lively";
  assert.equal(d.event(arrived(T0 + 22 * MIN)).reason, "already_greeted_this_visit", "arriving at someone already greeted stays silent");
}
// A greeting that was refused (busy) can still happen later in the same visit.
{
  const d = driver();
  d.env.assistantBusy = true;
  assert.equal(d.event(appeared(T0)).reason, "assistant_busy");
  d.env.assistantBusy = false;
  assert.equal(d.event(appeared(T0 + 30_000)).occasion, "greet_arrival");
}
// Arrival greets a visit nobody greeted yet; a person who is already talking is not greeted.
{
  const d = driver("lively");
  assert.equal(d.event(arrived(T0)).occasion, "arrived");
  assert.equal(d.event(appeared(T0 + 5 * MIN)).reason, "already_greeted_this_visit");
  const talking = driver();
  talking.conversationActive = true;
  assert.equal(talking.event(appeared(T0)).reason, "already_greeted_this_visit");
}

// Welcome back after a long quiet stretch, from the previous visit or older human interaction.
{
  const d = driver();
  assert.equal(d.event(appeared(T0)).occasion, "greet_arrival");
  d.event(left(T0 + MIN));
  assert.equal(d.event(appeared(T0 + MIN + p.PROACTIVE_WELCOME_BACK_AFTER_MS)).occasion, "welcome_back_after_quiet");
  const fromInteraction = driver();
  fromInteraction.body = state({ lastHumanInteractionAt: T0 - p.PROACTIVE_WELCOME_BACK_AFTER_MS });
  assert.equal(fromInteraction.event(appeared(T0)).occasion, "welcome_back_after_quiet");
  const recent = driver();
  recent.body = state({ lastHumanInteractionAt: T0 - 10 * MIN });
  assert.equal(recent.event(appeared(T0)).occasion, "greet_arrival");
  const sameMoment = driver();
  sameMoment.body = state({ lastHumanInteractionAt: T0 });
  assert.equal(sameMoment.event(appeared(T0)).occasion, "greet_arrival", "the appearance itself is not a quiet stretch");
  const never = driver();
  assert.equal(never.event(appeared(T0)).occasion, "greet_arrival", "unknown history greets instead of claiming a return");
}

// Per-occasion cooldowns.
{
  const d = driver();
  assert.equal(d.event(petted(T0)).speak, true);
  assert.equal(d.event(petted(T0 + p.PROACTIVE_OCCASION_COOLDOWN_MS.react_petting - 1)).reason, "occasion_cooldown");
  assert.equal(d.event(petted(T0 + p.PROACTIVE_OCCASION_COOLDOWN_MS.react_petting)).speak, true);
  const e = driver();
  assert.equal(e.event(edge(T0)).speak, true);
  assert.equal(e.event(edge(T0 + MIN)).reason, "occasion_cooldown");
  assert.equal(e.event(edge(T0 + p.PROACTIVE_OCCASION_COOLDOWN_MS.warn_edge)).speak, true);
  const g = driver("lively");
  assert.equal(g.event(gaveUp(T0)).speak, true);
  assert.equal(g.event(gaveUp(T0 + 19 * MIN)).reason, "occasion_cooldown");
  assert.equal(g.event(gaveUp(T0 + 20 * MIN)).speak, true);
}

// Global minimum gap between different occasions; the edge warning is exempt.
{
  const d = driver();
  assert.equal(d.event(petted(T0)).speak, true);
  assert.equal(d.event(appeared(T0 + 30_000)).reason, "global_gap");
  assert.equal(d.event(edge(T0 + 40_000)).speak, true, "an edge warning is never held back by the gap");
  assert.equal(d.event(appeared(T0 + 40_000 + p.PROACTIVE_GLOBAL_MIN_GAP_MS)).speak, true);
}

// Hourly cap per level, rolling.
for (const level of ["reactions", "lively"]) {
  const d = driver(level);
  const cap = p.PROACTIVE_MAX_PER_HOUR[level];
  let at = T0;
  let spoken = 0;
  const times = [];
  for (let i = 0; spoken < cap; i += 1) {
    at += 4 * MIN;
    if (d.event(petted(at)).speak) { spoken += 1; times.push(at); }
  }
  assert.equal(d.event(petted(at + 4 * MIN)).reason, "hourly_cap", `${level} stops at ${cap} per hour`);
  assert.equal(d.event(edge(at + 4 * MIN + 1)).reason, "hourly_cap", "the cap also bounds edge warnings");
  assert.equal(d.event(petted(times[0] + 60 * MIN)).speak, true, `${level} cap is a rolling hour`);
}
assert.ok(p.PROACTIVE_MAX_PER_HOUR.reactions < p.PROACTIVE_MAX_PER_HOUR.lively);

// Memory stays bounded to the last hour.
{
  let memory = p.createProactiveSpeechMemory();
  for (let i = 0; i < 50; i += 1) memory = p.recordProactiveUtterance(memory, "react_petting", T0 + i * 5 * MIN);
  assert.ok(memory.spoken.length <= 12);
  const pruned = p.noteProactiveBodyEvent(memory, petted(T0 + 400 * MIN), { conversationActive: false });
  assert.equal(pruned.spoken.length, 0);
}

console.log("robot-mind proactive speech policy: ok");
