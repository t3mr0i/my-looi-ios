/** Binds the body-context feed to the shared body state for one Realtime session. */
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { buildRobotBodyContext } from "./body-context";
import { createRobotBodyContextFeed, type RobotBodyContextFeed } from "./body-context-feed";
import { robotBodyState } from "./body-state";

export type { RobotBodyContextFeed };

/** The current body block for turn-based (Budget) instructions. */
export function readRobotBodyContext(): string {
  return buildRobotBodyContext(robotBodyState.getState(), Date.now());
}

export function startRealtimeBodyContextFeed(options: {
  transport: "pcm" | "webrtc";
  sessionId: string;
  send: (event: Record<string, unknown>) => boolean;
  canSend: () => boolean;
}): RobotBodyContextFeed {
  const feed = createRobotBodyContextFeed({
    render: readRobotBodyContext,
    send: options.send,
    canSend: options.canSend,
    subscribe: (listener) => robotBodyState.subscribeState(listener),
    now: Date.now,
    setTimer: (callback, delayMs) => {
      const handle = setTimeout(callback, delayMs);
      // Node (tests) only: the body-note poll alone must not keep a process alive.
      (handle as { unref?: () => void }).unref?.();
      return handle;
    },
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    sessionToken: options.sessionId,
    onSent: (details) => recordDiagnosticEvent("realtime", "body-context-sent", { transport: options.transport, ...details }),
  });
  feed.start();
  return feed;
}
