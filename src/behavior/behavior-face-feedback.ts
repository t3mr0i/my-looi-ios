import type { BehaviorState } from "./behavior-types";

export type BehaviorFaceFeedback = {
  id: string;
  kind: "repair";
  mood: "repairing" | "clarified";
  generation: number;
  expiresAt: number;
};

/** Copies only authoritative state; model scores never mean understanding. */
export function createRepairFeedbackTracker() {
  let previous: { session: string | null; reference: number; turn: number; repair: boolean } | null = null;
  let pendingRepair = false;
  let confirmBefore = 0;
  return {
    reset() { previous = null; pendingRepair = false; confirmBefore = 0; },
    observe(state: BehaviorState, now: number): BehaviorFaceFeedback | null {
      const before = previous;
      previous = { session: state.sessionId, reference: state.referenceVersion, turn: state.turnId, repair: state.repairRequired };
      if (!before || !state.sessionId || before.session !== state.sessionId) { pendingRepair = false; return null; }
      const repairing = state.repairRequired && state.referenceVersion !== before.reference;
      const nextTurn = state.turnId > before.turn;
      const text = state.moment?.userText?.trim().toLocaleLowerCase().replace(/[.!]+$/u, "") ?? "";
      // Ordinary turns, silence and changing the subject do not confirm a reference.
      const confirmsReference = /^(?:ja[, ]+)?genau (?:das|die|den|diese|diesen|dieses)(?: (?:meine|meinte) ich)?$/u.test(text)
        || /^(?:yes[, ]+)?(?:that(?:'s| is) (?:the one|what i meant)|exactly (?:that|the one))$/u.test(text)
        || /^(?:да[, ]+)?именно (?:это|тот|та|ту|этот|эта)$/u.test(text)
        || /^(?:так[, ]+)?саме (?:це|той|та|цю)$/u.test(text);
      const clarified = pendingRepair && now <= confirmBefore && before.repair && !state.repairRequired && nextTurn && confirmsReference;
      if (nextTurn || now > confirmBefore) pendingRepair = false;
      if (repairing) { pendingRepair = true; confirmBefore = now + 30_000; }
      if (!repairing && !clarified) return null;
      const mood = repairing ? "repairing" : "clarified";
      return { id: `${state.sessionId}-${state.referenceVersion}-${state.turnId}-${mood}`, kind: "repair",
        mood, generation: state.lifecycleGeneration, expiresAt: now + (repairing ? 950 : 650) };
    },
  };
}
