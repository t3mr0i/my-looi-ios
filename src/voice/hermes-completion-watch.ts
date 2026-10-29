import { getBehaviorInteractionSnapshot, requestBehaviorSignalResponse, setBehaviorManualResponseLease, subscribeBehaviorEvents } from "../behavior/behavior-events";
import type { AgentTask } from "../agent/agent-protocol";
import type { InterfaceLanguage } from "../i18n/ui-language";
import { HERMES_COMPLETION_QUESTIONS } from "./hermes-completion-copy";

const POLL_MS = 8_000;
const QUIET_MS = 4_000;
const WATCH_MS = 3 * 60_000;
const OFFER_MS = 30_000;

type HermesOffer = { sessionId: string; id: string; userTurnRevision: number; accepted: boolean; expiresAt: number };
let offer: HermesOffer | null = null;

export function offeredHermesTask(sessionId: string, userTurnRevision: number): { id: string; accepted: boolean } | null {
  if (!offer || offer.expiresAt <= Date.now()) { offer = null; return null; }
  return offer.sessionId === sessionId && offer.userTurnRevision === userTurnRevision ? { id: offer.id, accepted: offer.accepted } : null;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function isGenericHermesAcceptance(text: string): boolean {
  return /^(?:ja|ja bitte|ja gerne|gerne|klar|yes|yes please|sure|да|да пожалуйста|так|так будь ласка)$/u.test(normalize(text));
}

function trackOffer(id: string, turn: { sessionId: string; userTurnRevision: number; language: InterfaceLanguage }): void {
  const current: HermesOffer = { sessionId: turn.sessionId, id, userTurnRevision: turn.userTurnRevision, accepted: false, expiresAt: Date.now() + OFFER_MS };
  offer = current;
  const lease = `hermes-offer:${id}:${turn.userTurnRevision}`;
  setBehaviorManualResponseLease(turn.sessionId, lease, true);
  let heard = false;
  const close = (clear: boolean) => { clearTimeout(timer); unsubscribe(); setBehaviorManualResponseLease(turn.sessionId, lease, false); if (clear && offer === current) offer = null; };
  const unsubscribe = subscribeBehaviorEvents((event) => {
    if (offer !== current) { close(false); return; }
    if (event.type === "assistant-end") {
      heard = normalize(event.text ?? "") === normalize(HERMES_COMPLETION_QUESTIONS[turn.language]);
      if (!heard) close(true);
    } else if (event.type === "user-speech-start") {
      if (!heard) close(true);
    } else if (event.type === "user-turn") {
      const accepted = isGenericHermesAcceptance(event.text);
      const snapshot = getBehaviorInteractionSnapshot(turn.sessionId);
      if (!heard || !accepted || !snapshot || current.expiresAt <= Date.now()) { close(true); return; }
      current.userTurnRevision = snapshot.userTurnRevision;
      current.accepted = true;
      close(false);
    } else if (event.type === "session-end" || event.type === "session-start" || event.type === "interrupt" || event.type === "correction") close(true);
  });
  const timer = setTimeout(() => close(true), OFFER_MS);
}

/** Watch one confirmed admission, only while the initiating turn remains current. */
export function watchHermesCompletion(task: AgentTask, turn: { sessionId: string; userTurnRevision: number; language: InterfaceLanguage; isCurrent(): boolean; canWatchCompletion?(): boolean }, get: (id: string) => Promise<AgentTask>): void {
  const snapshot = getBehaviorInteractionSnapshot(turn.sessionId);
  if (!snapshot || snapshot.userTurnRevision !== turn.userTurnRevision || !turn.isCurrent()) return;
  const { revision, userTurnRevision } = snapshot;
  if (!["queued", "running", "completed"].includes(task.status)) return;
  let done = false;
  let heard = false;
  let completed = task.status === "completed";
  let quietUntil = 0;
  let polling = false;
  const deadline = Date.now() + WATCH_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => { done = true; if (timer) clearTimeout(timer); unsubscribe(); };
  const schedule = (delay: number) => { if (timer) clearTimeout(timer); timer = setTimeout(tick, delay); };
  const unsubscribe = subscribeBehaviorEvents((event) => {
    if (event.type === "session-end" || event.type === "session-start" || event.type === "user-speech-start" ||
      event.type === "user-turn" || event.type === "interrupt" || event.type === "correction") { stop(); return; }
    if (event.type === "assistant-start") { heard = false; }
    if (event.type === "assistant-end" && event.text?.trim()) {
      heard = true;
      quietUntil = Date.now() + QUIET_MS;
      if (completed) schedule(QUIET_MS);
    }
  });
  async function tick() {
    timer = null;
    if (done) return;
    if (!turn.isCurrent() || turn.canWatchCompletion?.() === false || Date.now() >= deadline) { stop(); return; }
    if (!completed && !polling) {
      polling = true;
      try {
        const current = await get(task.id);
        if (done || !turn.isCurrent() || turn.canWatchCompletion?.() === false) { stop(); return; }
        if (current.id !== task.id) { stop(); return; }
        if (current.status === "completed") completed = true;
        else if (!["queued", "running"].includes(current.status)) { stop(); return; }
      } catch { stop(); return; }
      finally { polling = false; }
    }
    if (completed && heard && Date.now() >= quietUntil) {
      if (requestBehaviorSignalResponse({ kind: "hermes-completed", id: task.id, revision, userTurnRevision }, turn.sessionId)) trackOffer(task.id, turn);
      stop();
      return;
    }
    schedule(completed && heard ? Math.max(1, quietUntil - Date.now()) : POLL_MS);
  }
  schedule(POLL_MS);
}
