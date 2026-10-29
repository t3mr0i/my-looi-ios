type Point = { x: number; y: number };
type Attention = { source: "person" | "object" | "neutral"; gaze: Point };

/** Screen-space arbitration only; no physical head pose is inferred. */
export function chooseObjectAttentionGaze(input: {
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  person: Point | null;
  object: Point | null;
  tracking: boolean;
  showLoss: boolean;
  /** A current, explicitly linked activity may request one local gaze beat. */
  activityAttention?: "person" | "object" | null;
}): Attention | null {
  const bounded = (point: Point): Point => ({ x: Math.max(-1, Math.min(1, point.x)), y: Math.max(-1, Math.min(1, point.y)) });
  const person = (): Attention => ({ source: input.person ? "person" : "neutral", gaze: input.person ? bounded(input.person) : { x: 0, y: 0 } });
  if (input.userSpeaking || input.assistantSpeaking && input.activityAttention) return person();
  if (input.assistantSpeaking) return null;
  if (input.activityAttention === "person") return person();
  if (input.activityAttention === "object" && (!input.tracking || !input.object)) return { source: "neutral", gaze: { x: 0, y: 0 } };
  if (input.tracking && input.object) return { source: "object", gaze: bounded(input.object) };
  if (input.showLoss) return { source: "neutral", gaze: { x: 0, y: 0 } };
  return null;
}
