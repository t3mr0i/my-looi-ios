/**
 * One owner of LOOI's expression per reply. When the conversational model
 * chooses an intent for the reply it is speaking, the face and one restrained
 * head gesture follow that choice, and the separate Decisions cue and the local
 * text-based face stay out of that reply. Without a model choice nothing is
 * claimed and the existing fallbacks run unchanged.
 *
 * Pure module: the head runner and its gates are injected by
 * expression-runtime.ts, so this file has no BLE, React Native or store import.
 */
import { robotBodyState, type RobotBodyStateStore, type RobotExpressionIntent, type RobotExpressionSource } from "./body-state";
import {
  ROBOT_EXPRESSION_VOCABULARY,
  type RobotExpressionHeadGesture,
} from "../voice/robot-capability-tool-definitions";

export type RobotExpressionReply = {
  sessionId: string;
  /** Response or turn id; diagnostic only, the reply ends through endReply. */
  replyId: string;
  isCurrent(): boolean;
};

export type RobotExpressionDependencies = {
  /** Run one head gesture at behavior priority; it must stop as soon as isCurrent turns false. */
  runHead?(gesture: RobotExpressionHeadGesture, isCurrent: () => boolean): Promise<unknown> | unknown;
  /** Robot connected, awake, motion allowed, wheels idle and the user not speaking. */
  canMoveHead?(): boolean;
  diagnostic?(name: string, details: Record<string, string | number | boolean | null>): void;
};

/** Covers the Decisions assistant-end window (1.8 s) plus dispatch slack. */
export const ROBOT_EXPRESSION_REACTION_CLAIM_MS = 2_500;
/** A requested gesture or movement this recent belongs to the reply being expressed. */
export const ROBOT_EXPRESSION_PHYSICAL_ACTION_WINDOW_MS = 10_000;
/** An expression whose speech never starts is dropped after this long. */
export const ROBOT_EXPRESSION_UNSPOKEN_TIMEOUT_MS = 15_000;

type Owner = {
  generation: number;
  intent: RobotExpressionIntent;
  sessionId: string;
  replyId: string;
  isCurrent: () => boolean;
  headUsed: boolean;
};

export function createRobotExpressionConductor(options: {
  bodyState?: RobotBodyStateStore;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
} = {}) {
  const bodyState = options.bodyState ?? robotBodyState;
  const now = options.now ?? bodyState.now;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let deps: RobotExpressionDependencies = {};
  let owner: Owner | null = null;
  let generation = 0;
  let speaking = false;
  let claimUntil = 0;
  let unspokenTimer: unknown = null;
  let physicalActionAt: number | null = null;

  const diagnostic = (name: string, details: Record<string, string | number | boolean | null>) => {
    try { deps.diagnostic?.(name, details); } catch { /* diagnostics never affect expression */ }
  };
  const write = (intent: RobotExpressionIntent, source: RobotExpressionSource) => {
    const current = bodyState.getState().expression;
    if (current.intent === intent && current.source === source) return;
    bodyState.update({ expression: { intent, since: now(), source } }, "expression");
  };
  const cancelUnspokenTimer = () => {
    if (unspokenTimer !== null) clearTimer(unspokenTimer);
    unspokenTimer = null;
  };

  const runHead = (target: Owner, reason: "speech_start" | "speech_end") => {
    const cue = ROBOT_EXPRESSION_VOCABULARY[target.intent].head;
    if (!cue || cue.at !== reason || target.headUsed || !deps.runHead) return;
    target.headUsed = true;
    const replyGeneration = target.generation;
    // A start gesture belongs to its own reply; an end gesture only survives
    // until the next reply or interruption begins.
    const isCurrent = () => generation === replyGeneration
      && (reason === "speech_end" || owner === target)
      && (deps.canMoveHead?.() ?? false);
    if (!isCurrent()) { diagnostic("head-skipped", { intent: target.intent, gesture: cue.gesture, reason }); return; }
    diagnostic("head", { intent: target.intent, gesture: cue.gesture, at: reason });
    try { void Promise.resolve(deps.runHead(cue.gesture, isCurrent)).catch(() => undefined); } catch { /* head is best effort */ }
  };

  const finish = (completed: boolean, reason: string) => {
    cancelUnspokenTimer();
    speaking = false;
    physicalActionAt = null;
    const ended = owner;
    owner = null;
    if (ended) {
      if (completed) {
        // The reply was heard: its reaction stays claimed for the Decisions window.
        claimUntil = now() + ROBOT_EXPRESSION_REACTION_CLAIM_MS;
        runHead(ended, "speech_end");
      } else {
        generation += 1;
        claimUntil = 0;
      }
      diagnostic("ended", { intent: ended.intent, replyId: ended.replyId, reason, completed });
    } else if (!completed) {
      generation += 1;
      claimUntil = 0;
    }
    write("neutral", "rest");
  };

  return {
    configure(next: RobotExpressionDependencies): void { deps = { ...next }; },

    /** Apply the model's intent to the reply being spoken. Later calls in the same reply change the face, never add a second gesture. */
    expressFromModel(intent: RobotExpressionIntent, reply: RobotExpressionReply): boolean {
      if (!ROBOT_EXPRESSION_VOCABULARY[intent]) return false;
      let current = false;
      try { current = reply.isCurrent(); } catch { current = false; }
      if (!current) return false;
      if (owner && owner.sessionId === reply.sessionId) {
        owner.intent = intent;
        owner.replyId = reply.replyId;
        owner.isCurrent = reply.isCurrent;
      } else {
        generation += 1;
        owner = { generation, intent, sessionId: reply.sessionId, replyId: reply.replyId, isCurrent: reply.isCurrent, headUsed: physicalActionAt !== null && now() - physicalActionAt < ROBOT_EXPRESSION_PHYSICAL_ACTION_WINDOW_MS };
      }
      claimUntil = 0;
      write(intent, "model");
      diagnostic("model", { intent, replyId: reply.replyId, speaking });
      if (speaking) runHead(owner, "speech_start");
      else if (unspokenTimer === null) {
        const target = owner;
        unspokenTimer = setTimer(() => {
          unspokenTimer = null;
          if (owner === target && !speaking) finish(false, "unspoken");
        }, ROBOT_EXPRESSION_UNSPOKEN_TIMEOUT_MS);
      }
      return true;
    },

    /** The reply became audible. Idempotent within one reply. */
    speechStarted(): void {
      if (speaking) return;
      speaking = true;
      cancelUnspokenTimer();
      if (owner) runHead(owner, "speech_start");
    },

    /** Reply audio ended; completed means it was heard to the end. */
    endReply(completed: boolean, reason: string): void {
      if (!owner && !speaking && completed) return;
      finish(completed, reason);
    },

    /** The user, STOP or the session ended the reply: cancel its gestures and claims. */
    interrupt(reason: string): void { finish(false, reason); },

    /**
     * The local speech-text expression reports what the face shows when the
     * model gave nothing. It never replaces a model-owned intent.
     */
    noteSpeechTextIntent(intent: RobotExpressionIntent | null): void {
      if (owner) return;
      if (intent) write(intent, "speech_text");
      else write("neutral", "rest");
    },

    /** An explicit gesture or movement in this reply owns the head; the expression keeps only the face. */
    notePhysicalAction(): void {
      physicalActionAt = now();
      if (owner) owner.headUsed = true;
    },

    /** True while a model-chosen expression owns the current reply or its reaction window. */
    ownsReplyReaction(): boolean { return owner !== null || now() < claimUntil; },

    getModelIntent(): RobotExpressionIntent | null { return owner?.intent ?? null; },
  };
}

export type RobotExpressionConductor = ReturnType<typeof createRobotExpressionConductor>;
export const robotExpressionConductor: RobotExpressionConductor = createRobotExpressionConductor();
