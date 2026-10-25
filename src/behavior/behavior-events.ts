import type { BehaviorEvent } from "./behavior-types";

type Adapter = {
  dispatch(event: BehaviorEvent): void;
  getContext(): string;
  inspectVisual(image: string, task: string, sessionId: string): Promise<string>;
};
let adapter: Adapter | null = null;
let session: string | null = null;
let contextListener: ((context: string) => void) | null = null;
let lastContext = "";
let revision = 0;

/** Session-scoped seam shared by both voice transports and the local runtime. */
export function registerBehaviorAdapter(next: Adapter): () => void {
  adapter = next;
  if (session) next.dispatch({ type: "session-start", sessionId: session });
  return () => { if (adapter === next) adapter = null; };
}

export function beginBehaviorSession(sessionId: string, listener: (context: string) => void): void {
  if (session && session !== sessionId) adapter?.dispatch({ type: "session-end", sessionId: session });
  session = sessionId;
  revision += 1;
  contextListener = listener;
  lastContext = "";
  adapter?.dispatch({ type: "session-start", sessionId });
  refreshBehaviorContext();
}

export function endBehaviorSession(sessionId: string): void {
  if (session !== sessionId) return;
  adapter?.dispatch({ type: "session-end", sessionId });
  session = null;
  contextListener = null;
  lastContext = "";
  revision += 1;
}

export function publishBehaviorEvent(event: BehaviorEvent): void {
  if ("sessionId" in event && event.sessionId && event.sessionId !== session) return;
  if (!session && event.type !== "interrupt") return;
  if (event.type === "interrupt" || event.type === "user-speech-start" || event.type === "user-turn" || event.type === "correction") revision += 1;
  adapter?.dispatch(event);
  refreshBehaviorContext();
}

export function getBehaviorConversationContext(sessionId: string | null): string {
  return sessionId && sessionId === session ? (adapter?.getContext() ?? "") : "";
}

export function refreshBehaviorContext(): void {
  if (!session || !contextListener) return;
  const context = adapter?.getContext() ?? "";
  if (context === lastContext) return;
  lastContext = context;
  contextListener(context);
}

export async function inspectBehaviorVisual(image: string, task: string, sessionId: string): Promise<string> {
  if (!adapter || sessionId !== session) return "";
  const currentRevision = revision;
  try {
    const advice = await adapter.inspectVisual(image, task, sessionId);
    return session === sessionId && revision === currentRevision ? advice : "";
  } catch { return ""; }
}
