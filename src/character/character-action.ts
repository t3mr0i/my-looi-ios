import { getCharacterScene, isCharacterScene, type CharacterSceneId } from "./character-scene-catalog";

/** Four quick entries; the complete picture catalog contains 200 scenes. */
export const CHARACTER_ACTIONS = ["drink", "coffee", "snack", "read"] as const;
export type CharacterActionKind = CharacterSceneId;
export type CharacterActionPhase = "reveal" | "use" | "enjoy" | "put-away";
export type CharacterActionFrame = { id: number; kind: CharacterActionKind; phase: CharacterActionPhase };
export type CharacterActionRequest = { id: number; kind: CharacterActionKind; source: "menu" | "voice" | "context"; sessionId?: string; awaitingReply: boolean; expiresAt: number };
export type CharacterActionState = { active: CharacterActionFrame | null; pending: CharacterActionRequest | null };
export const CHARACTER_ACTION_PHASES: readonly CharacterActionPhase[] = ["reveal", "use", "enjoy", "put-away"];
const DURATIONS: Partial<Record<CharacterActionKind, readonly number[]>> = {
  drink: [850, 2400, 900, 450], coffee: [850, 2400, 900, 450],
  snack: [850, 2200, 900, 450], read: [850, 3000, 900, 450],
};
export function isCharacterAction(value: unknown): value is CharacterActionKind {
  return isCharacterScene(value);
}
export function getCharacterActionDuration(kind: CharacterActionKind, phase: CharacterActionPhase): number {
  const motion = getCharacterScene(kind).motion;
  const duration = DURATIONS[kind] ?? [motion === "rest" ? 600 : 850, motion === "read" ? 2800 : motion === "rest" ? 1800 : 2200, 900, 450];
  return duration[CHARACTER_ACTION_PHASES.indexOf(phase)];
}

/** Explicit display requests only: mentioning a drink is not an invitation. */
export function parseCharacterActionRequest(text: string, robotName = "LOOI"): CharacterActionKind | null {
  if (typeof text !== "string" || text.length > 600 || /["“”„«»]/u.test(text)) return null;
  let input = text.normalize("NFKC").trim().toLocaleLowerCase();
  const names = [robotName, "looi", "louis", "louie", "луи", "луї"].filter(Boolean).map(name => name.toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  input = input.replace(new RegExp(`^(?:hey[, ]+)?(?:${names.join("|")})(?:[,!: ]+)`, "u"), "");
  if (/(?:^|[^\p{L}])(?:nicht|kein\p{L}*|not|never|don't|dont|не|ні)(?=$|[^\p{L}])/u.test(input)) return null;
  input = input.replace(/^(?:bitte[, ]+|please[, ]+)/u, "").replace(/[, ]+(?:bitte|please)[.!?]*$/u, "").replace(/[.!?]+$/u, "").trim();
  input = input.replace(/^(?:kannst|könntest|magst) du (?:bitte )?/u, "").replace(/^(?:can|could|would) you (?:please )?/u, "");
  if (/^(?:trink(?:e)? (?:etwas|was|einen schluck(?: wasser)?)|(?:einen drink (?:nehmen|rausnehmen|herausholen|rausholen)|nimm (?:mal )?(?:einen schluck|einen drink(?: (?:raus|heraus))?))|hol(?:e)? (?:dir )?(?:einen drink(?: (?:raus|heraus))?|etwas zu trinken)|take (?:a drink|a sip)|have a drink|выпей (?:воды|немного воды)|випий (?:води|трохи води))$/u.test(input)) return "drink";
  if (/^(?:(?:mach|mache) (?:eine )?kaffeepause|kaffeepause|trink(?:e)? (?:einen )?kaffee|take a coffee break|have (?:a )?coffee|выпей кофе|випий кави)$/u.test(input)) return "coffee";
  if (/^(?:(?:iss|nimm) (?:einen )?keks|knabber(?:e)? (?:einen )?keks|have (?:a )?(?:cookie|snack)|eat (?:a )?cookie|съешь печенье|з'їж печиво|з’їж печиво)$/u.test(input)) return "snack";
  if (/^(?:lies (?:ein )?buch|schlag(?:e)? (?:ein )?buch auf|(?:mach|mache) (?:eine )?lesepause|read a book|open a book|почитай книгу|почитай книжку|відкрий книжку)$/u.test(input)) return "read";
  return null;
}

export type CharacterPropPose = { x: number; y: number; rotation: number; scale: number; opacity: number };
export type CharacterPropContact = { x: number; y: number };
/** Authored contact points on the original 24 x 24 vectors: straw, rim, or edible edge. */
const PROP_CONTACTS: Partial<Record<CharacterActionKind, CharacterPropContact>> = {
  drink: { x: 15, y: 2 }, coffee: { x: 10, y: 8 }, "water-bottle": { x: 12, y: 2 },
  snack: { x: 16, y: 8 }, cake: { x: 7.2, y: 7.9 }, "ice-cream": { x: 12, y: 2 },
  apple: { x: 18, y: 6 }, banana: { x: 13, y: 2 }, sandwich: { x: 12, y: 4 },
};
export function getCharacterPropContact(kind: CharacterActionKind): CharacterPropContact | null {
  return PROP_CONTACTS[kind] ?? null;
}
export function getCharacterPropSize(kind: CharacterActionKind): number {
  return getCharacterScene(kind).motion === "read" ? 100 : 88;
}
/** Mouth center is (180,216); prop top is 197. Both belong to the same face stage. */
function contactPose(contact: CharacterPropContact, rotation: number): CharacterPropPose {
  const radians = rotation * Math.PI / 180;
  const dx = (contact.x - 12) * 88 / 24, dy = (contact.y - 12) * 88 / 24;
  return { x: -(dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: 19 - 44 - (dx * Math.sin(radians) + dy * Math.cos(radians)), rotation, scale: 1, opacity: 1 };
}
/** Keep the point touching the mouth fixed through the small sip/bite accent. */
export function getCharacterPropBeatPose(pose: CharacterPropPose, contact: CharacterPropContact | null, beat: number, bite: boolean): CharacterPropPose {
  "worklet";
  const rotation = pose.rotation - beat * 3;
  const scale = pose.scale * (1 - beat * (bite ? 0.04 : 0));
  if (!contact) return { ...pose, y: pose.y - beat * 3, rotation, scale };
  const dx = (contact.x - 12) * 88 / 24, dy = (contact.y - 12) * 88 / 24;
  const oldAngle = pose.rotation * Math.PI / 180, angle = rotation * Math.PI / 180;
  return { ...pose, rotation, scale,
    x: pose.x + (dx * Math.cos(oldAngle) - dy * Math.sin(oldAngle)) * pose.scale - (dx * Math.cos(angle) - dy * Math.sin(angle)) * scale,
    y: pose.y + (dx * Math.sin(oldAngle) + dy * Math.cos(oldAngle)) * pose.scale - (dx * Math.sin(angle) + dy * Math.cos(angle)) * scale };
}
export function getCharacterActionGaze(frame: CharacterActionFrame): { x: number; y: number; scan: boolean } {
  const motion = getCharacterScene(frame.kind).motion;
  if (motion === "rest" || frame.phase === "put-away") return { x: 0, y: 0, scan: false };
  if (motion === "read" && frame.phase === "use") return { x: 0, y: 0.65, scan: true };
  const pose = getCharacterPropPose(frame.kind, frame.phase);
  return { x: Math.max(-0.5, Math.min(0.5, pose.x / 145)), y: frame.phase === "use" ? 0.4 : 0.25, scan: false };
}
/** Logical coordinates relative to the face's mouth, not motor coordinates. */
export function getCharacterPropPose(kind: CharacterActionKind, phase: CharacterActionPhase | "hidden", reducedMotion = false): CharacterPropPose {
  const motion = getCharacterScene(kind).motion;
  // Comfort and rest hold still; their ending fades instead of sweeping across the face.
  if (!reducedMotion && motion === "rest") return { x: -42, y: 20, rotation: -4, scale: 0.95,
    opacity: phase === "hidden" || phase === "put-away" ? 0 : 1 };
  if (phase === "hidden" || phase === "put-away") return { x: 124, y: 114, rotation: 16, scale: 0.7, opacity: 0 };
  if (reducedMotion) {
    const contact = getCharacterPropContact(kind);
    if (contact) return contactPose(contact, 0);
    return { x: 0, y: motion === "read" ? 10 : 22, rotation: 0, scale: 1, opacity: 1 };
  }
  if (phase === "reveal") return { x: 72, y: 12, rotation: 12, scale: 1, opacity: 1 };
  if (phase === "enjoy") return { x: 65, y: 14, rotation: 8, scale: kind === "snack" ? 0.86 : 1, opacity: 1 };
  const contact = getCharacterPropContact(kind);
  if (contact) return contactPose(contact, motion === "coffee" ? -18 : -7);
  switch (motion) {
    case "sip": return { x: 0, y: -13, rotation: -7, scale: 1, opacity: 1 };
    case "coffee": return { x: 8, y: -16, rotation: -18, scale: 1, opacity: 1 };
    case "bite": return { x: 0, y: 2, rotation: -7, scale: 1, opacity: 1 };
    case "read": return { x: 0, y: 10, rotation: 0, scale: 1, opacity: 1 };
    case "inspect": return { x: 40, y: 18, rotation: -10, scale: 1, opacity: 1 };
    case "offer": return { x: 25, y: 25, rotation: 0, scale: 1.06, opacity: 1 };
    case "cheer": return { x: 70, y: 5, rotation: -10, scale: 1.08, opacity: 1 };
    case "rest": return { x: -42, y: 20, rotation: -4, scale: 0.95, opacity: 1 };
    default: return { x: 0, y: 26, rotation: 0, scale: 1, opacity: 1 };
  }
}

/** One cancelable visual scene. It owns no speaker, camera or robot command. */
export function createCharacterActionController(deps: {
  now(): number; publish(state: CharacterActionState): void;
  schedule(callback: () => void, delayMs: number): unknown; unschedule(timer: unknown): void;
}) {
  let state: CharacterActionState = { active: null, pending: null };
  let allowed = false, busy = false, serial = 0;
  let timer: unknown = null;
  const clearTimer = () => { if (timer !== null) deps.unschedule(timer); timer = null; };
  const publish = () => deps.publish({ ...state });
  const cancel = () => { clearTimer(); state = { active: null, pending: null }; publish(); };
  const step = (id: number, index: number) => {
    if (state.active?.id !== id || !allowed || busy) return;
    if (index === CHARACTER_ACTION_PHASES.length) { timer = null; state = { active: null, pending: null }; publish(); return; }
    const phase = CHARACTER_ACTION_PHASES[index];
    const kind = state.active.kind;
    state = { ...state, active: { ...state.active, phase } }; publish();
    if (state.active?.id === id && allowed && !busy) timer = deps.schedule(() => step(id, index + 1), getCharacterActionDuration(kind, phase));
  };
  const startIfReady = () => {
    if (!allowed || busy || !state.pending || state.pending.awaitingReply) return;
    if (deps.now() >= state.pending.expiresAt) { cancel(); return; }
    clearTimer();
    state = { active: { id: state.pending.id, kind: state.pending.kind, phase: "reveal" }, pending: null };
    step(state.active!.id, 0);
  };
  return {
    getState: () => ({ ...state }), cancel,
    setAvailability(next: { allowed: boolean; busy: boolean }) {
      allowed = next.allowed; busy = next.busy;
      if (!allowed) { if (state.active || state.pending) cancel(); return; }
      if (busy && state.active) { cancel(); return; }
      startIfReady();
    },
    request(kind: CharacterActionKind, source: "menu" | "voice" | "context", sessionId?: string) {
      if (!isCharacterAction(kind) || !allowed) return null;
      clearTimer();
      const id = ++serial;
      state = { active: null, pending: { id, kind, source, sessionId, awaitingReply: source !== "menu", expiresAt: deps.now() + 30_000 } };
      publish();
      if (state.pending?.id !== id) return null;
      timer = deps.schedule(() => { if (state.pending?.id === id) cancel(); }, 30_000);
      startIfReady(); return id;
    },
    replyHeard(sessionId: string) {
      if (!state.pending || state.pending.source === "menu" || state.pending.sessionId !== sessionId) return;
      state = { ...state, pending: { ...state.pending, awaitingReply: false } }; publish(); startIfReady();
    },
  };
}
