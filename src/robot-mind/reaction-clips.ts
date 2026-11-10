/**
 * Short authored reactions to things the body senses: a face expression and at
 * most one head gesture, played locally. They need no model: the occasion is
 * known from the body event, the way a pet perks up when someone walks in.
 * Petting is not here because the stroke path already shows its own reaction.
 */
import type { RobotBodyEvent, RobotBodyState } from "./body-state";

export type ReactionClipId = "perk_up" | "startled" | "sigh" | "delighted" | "stretch";
export type ReactionClipFace = "attentive" | "curious" | "startled" | "thoughtful" | "pleased";
export type ReactionClipHead = "curious" | "happy_bob" | "sleepy";

export interface ReactionClip {
  id: ReactionClipId;
  face: ReactionClipFace;
  faceMs: number;
  /** Head only, never wheels. Absent for moments where moving would be wrong, such as at an edge. */
  head?: ReactionClipHead;
}

export const REACTION_CLIPS: Record<ReactionClipId, ReactionClip> = {
  perk_up: { id: "perk_up", face: "curious", faceMs: 1_400, head: "curious" },
  startled: { id: "startled", face: "startled", faceMs: 1_200 },
  sigh: { id: "sigh", face: "thoughtful", faceMs: 1_800, head: "sleepy" },
  delighted: { id: "delighted", face: "pleased", faceMs: 1_600, head: "happy_bob" },
  stretch: { id: "stretch", face: "attentive", faceMs: 1_400, head: "curious" },
};

export const REACTION_CLIP_COOLDOWN_MS = 30_000;
export const REACTION_CLIP_MIN_GAP_MS = 3_000;
/** Events older than this are history, not something to react to. */
export const REACTION_CLIP_EVENT_MAX_AGE_MS = 3_000;

export function reactionClipFor(event: RobotBodyEvent): ReactionClipId | null {
  switch (event.type) {
    case "person_appeared": return "perk_up";
    case "edge_reached": return "startled";
    case "search_gave_up": return "sigh";
    case "arrived_at_person": return "delighted";
    case "woke_up": return "stretch";
    default: return null;
  }
}

export function createReactionClipPolicy(now: () => number = Date.now) {
  const lastPlayed = new Map<ReactionClipId, number>();
  let lastAny = -Infinity;
  return {
    /** The clip to play for this event now, or null. Recording happens here, so call it once per event. */
    decide(event: RobotBodyEvent, body: RobotBodyState): ReactionClip | null {
      const id = reactionClipFor(event);
      const time = now();
      if (!id || time - event.at > REACTION_CLIP_EVENT_MAX_AGE_MS) return null;
      if (body.activity.mode === "sleeping") return null;
      // In a conversation the reply's own expression owns face and head; only a table edge still startles.
      if (body.activity.mode === "conversation" && id !== "startled") return null;
      if (time - lastAny < REACTION_CLIP_MIN_GAP_MS && id !== "startled") return null;
      if (time - (lastPlayed.get(id) ?? -Infinity) < REACTION_CLIP_COOLDOWN_MS) return null;
      lastPlayed.set(id, time);
      lastAny = time;
      return REACTION_CLIPS[id];
    },
  };
}
