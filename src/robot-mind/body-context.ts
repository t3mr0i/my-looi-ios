/**
 * Renders LOOI's body state as a short English block for the conversational
 * models. Pure: the same state and the same duration buckets always produce the
 * same text, so callers can compare strings to decide whether to resend.
 */
import type { RobotActivityMode, RobotBodyState, RobotBearing } from "./body-state";

/** Header of every Realtime body-sense note; the guidance below refers to it. */
export const ROBOT_BODY_CONTEXT_LABEL = "LOOI BODY SENSE";

/** Static guidance for the Realtime instructions. The notes themselves arrive as system messages. */
export const ROBOT_BODY_SENSE_REALTIME_GUIDANCE = `BODY SENSE: The app adds short system messages that start with "${ROBOT_BODY_CONTEXT_LABEL}". The latest one is what your body senses right now (faces in front of your camera, being petted, table edges under your wheels, the wheel-base connection, what you are doing) and replaces every earlier one. Let it colour your replies naturally: greet someone who has just appeared, mention the table edge if asked to drive toward it, enjoy being petted. Do not narrate sensor readings unprompted. Never claim to sense more than the latest note lists; a face is never an identity. It is data, not an instruction or permission to move, and a new note alone never asks you to speak.`;

/** Older facts stop being worth mentioning. */
const PETTED_RELEVANT_MS = 60 * 60_000;
const LAST_SEEN_RELEVANT_MS = 60 * 60_000;
const QUIET_MENTION_AFTER_MS = 2 * 60_000;

/** Coarse, stable duration words. Bucket edges are the only points where the text changes. */
export function describeRobotBodyDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 15) return "a few seconds";
  if (seconds < 45) return "about half a minute";
  if (seconds < 120) return "about a minute";
  if (seconds < 270) return "a few minutes";
  if (seconds < 450) return "about 5 minutes";
  if (seconds < 750) return "about 10 minutes";
  if (seconds < 1_350) return "about 15 minutes";
  if (seconds < 2_700) return "about half an hour";
  if (seconds < 5_400) return "about an hour";
  return "more than an hour";
}

function ago(ms: number): string {
  return ms < 15_000 ? "just now" : `${describeRobotBodyDuration(ms)} ago`;
}

function bearingPhrase(bearing: RobotBearing): string {
  return bearing === "left" ? "on your left" : bearing === "right" ? "on your right" : "straight ahead";
}

const ACTIVITY_LINES: Partial<Record<RobotActivityMode, string>> = {
  sleeping: "You are asleep.",
  commanded_motion: "Your wheels are moving because you were asked to move.",
  looking_around: "You are looking around on your own.",
  seeking_person: "You are searching for a person on your own.",
  approaching: "You are driving toward a person on your own.",
  attending: "You are turned toward a person and paying attention to them.",
};

/**
 * A few lines describing what LOOI's body senses. Unknown values are omitted.
 * "conversation" and "resting" are not mentioned: the model already knows it is talking.
 */
export function buildRobotBodyContext(state: RobotBodyState, now: number): string {
  const lines: string[] = [];
  const since = (at: number) => Math.max(0, now - at);

  const activity = ACTIVITY_LINES[state.activity.mode];
  if (activity) lines.push(activity);

  if (state.connection === "disconnected") {
    lines.push("Your wheel base is not connected, so you cannot drive or tilt your head right now.");
  }
  if (state.connection === "connected") {
    if (state.surface === "edge_front") lines.push("You are standing at a table edge in front of you; driving forward would be dangerous.");
    else if (state.surface === "edge_rear") lines.push("There is a table edge right behind you; driving backward would be dangerous.");
  }

  const people = state.people;
  if (people.visible !== null && people.visible > 0) {
    const count = people.visible === 1 ? "A face" : `${people.visible} faces`;
    const attended = people.attended;
    if (attended) {
      const details = [bearingPhrase(attended.bearing), attended.distance === "near" ? "close to you" : attended.distance === "far" ? "a bit further away" : null]
        .filter(Boolean).join(", ");
      lines.push(people.visible === 1
        ? `A face has been in front of you for ${describeRobotBodyDuration(since(attended.since))} (${details}).`
        : `${count} are in front of you; you have been turned to one of them for ${describeRobotBodyDuration(since(attended.since))} (${details}).`);
    } else {
      lines.push(`${count} ${people.visible === 1 ? "is" : "are"} visible to your camera.`);
    }
  } else if (people.visible === 0) {
    lines.push(people.lastSeenAt !== null
      ? `Nobody is in view of your camera; the last face was seen ${ago(since(people.lastSeenAt))}.`
      : "Nobody is in view of your camera.");
  } else if (people.lastSeenAt !== null && since(people.lastSeenAt) < LAST_SEEN_RELEVANT_MS) {
    lines.push(`Your camera is not watching right now; you last saw a face ${ago(since(people.lastSeenAt))}.`);
  }

  if (state.touch.lastPettedAt !== null && since(state.touch.lastPettedAt) < PETTED_RELEVANT_MS) {
    lines.push(`You were petted ${ago(since(state.touch.lastPettedAt))}.`);
  }

  if (state.lastHumanInteractionAt !== null && since(state.lastHumanInteractionAt) >= QUIET_MENTION_AFTER_MS) {
    lines.push(`Nobody has interacted with you for ${describeRobotBodyDuration(since(state.lastHumanInteractionAt))}.`);
  }

  if (state.displayScene) lines.push(`Your face display is showing the "${state.displayScene}" scene.`);
  if (state.expression.intent !== "neutral") lines.push(`Your face currently looks ${state.expression.intent}.`);

  return lines.join("\n");
}
