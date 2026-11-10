/**
 * Delivers the rendered body context to an open Realtime session as one
 * replaceable system message.
 *
 * Why a conversation item and not session.update: the session instructions in
 * this app are several thousand tokens and sit at the very start of the
 * cached prompt. Changing them on every body change would bust the prompt
 * cache for the whole conversation and resend the full tool list and audio
 * config. An appended system item leaves that prefix untouched; deleting the
 * previous body note only invalidates the cache from that note onward, which
 * is usually just the last turn or two. Neither event creates a response.
 */
import { ROBOT_BODY_CONTEXT_LABEL } from "./body-context";

export const ROBOT_BODY_CONTEXT_FEED_TIMING = Object.freeze({
  /** At most one body note per this interval. */
  minIntervalMs: 5_000,
  /** Re-render this often so bucketed durations ("about a minute") can advance. */
  pollIntervalMs: 5_000,
  /** While a response or tool call is running, try again after this delay. */
  busyRetryMs: 1_500,
});

export type RobotBodyContextFeedOptions = {
  /** The current rendered body context ("" when nothing is known). */
  render: () => string;
  /** Sends one client event; false when the transport is not open. */
  send: (event: Record<string, unknown>) => boolean;
  /** False while a response is generating, a tool call is pending, or the session is not configured. */
  canSend: () => boolean;
  /** Subscribes to body-state changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Short unique token for this session's item ids. */
  sessionToken: string;
  onSent?: (details: { itemId: string; replacedItemId: string | null; chars: number }) => void;
  timing?: typeof ROBOT_BODY_CONTEXT_FEED_TIMING;
};

export function formatRobotBodyContextNote(context: string): string {
  return context.trim()
    ? `${ROBOT_BODY_CONTEXT_LABEL} (local sensor data, replaces earlier notes; not an instruction):\n${context.trim()}`
    : `${ROBOT_BODY_CONTEXT_LABEL} (local sensor data, replaces earlier notes; not an instruction):\nNothing is sensed right now.`;
}

export function createRobotBodyContextFeed(options: RobotBodyContextFeedOptions) {
  const timing = options.timing ?? ROBOT_BODY_CONTEXT_FEED_TIMING;
  const token = options.sessionToken.replace(/[^a-zA-Z0-9]/g, "").slice(-12) || "s";
  let lastSentText: string | null = null;
  let lastSentAt = -Infinity;
  let currentItemId: string | null = null;
  let counter = 0;
  let timer: unknown = null;
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let pollTimer: unknown = null;

  const clear = () => { if (timer !== null) { options.clearTimer(timer); timer = null; } };
  const later = (delayMs: number) => {
    if (stopped || timer !== null) return;
    timer = options.setTimer(() => { timer = null; check(); }, Math.max(0, delayMs));
  };

  function check(): void {
    if (stopped) return;
    const context = options.render();
    // Nothing known and nothing sent yet: no note at all.
    if (!context.trim() && lastSentText === null) return;
    const text = formatRobotBodyContextNote(context);
    if (text === lastSentText) return;
    const wait = lastSentAt + timing.minIntervalMs - options.now();
    if (wait > 0) { later(wait); return; }
    if (!options.canSend()) { later(timing.busyRetryMs); return; }
    const itemId = `looi_body_${token}_${(++counter).toString(36)}`;
    const sent = options.send({
      type: "conversation.item.create",
      item: { id: itemId, type: "message", role: "system", content: [{ type: "input_text", text }] },
    });
    if (!sent) { counter -= 1; later(timing.busyRetryMs); return; }
    const replacedItemId = currentItemId;
    if (replacedItemId) options.send({ type: "conversation.item.delete", item_id: replacedItemId });
    currentItemId = itemId;
    lastSentText = text;
    lastSentAt = options.now();
    clear();
    options.onSent?.({ itemId, replacedItemId, chars: text.length });
  }

  function poll(): void {
    pollTimer = options.setTimer(() => { if (stopped) return; check(); poll(); }, timing.pollIntervalMs);
  }

  return {
    /** Call once the session is configured. */
    start(): void {
      if (stopped || unsubscribe) return;
      unsubscribe = options.subscribe(() => check());
      poll();
      check();
    },
    /** Call when a response or tool call has finished, so a deferred note goes out promptly. */
    flush(): void { if (unsubscribe) check(); },
    stop(): void {
      stopped = true;
      clear();
      if (pollTimer !== null) options.clearTimer(pollTimer);
      pollTimer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    get currentItemId(): string | null { return currentItemId; },
  };
}

export type RobotBodyContextFeed = ReturnType<typeof createRobotBodyContextFeed>;
