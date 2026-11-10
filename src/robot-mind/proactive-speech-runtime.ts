/**
 * Proactive speech runtime: listens to body events, asks the pure policy
 * whether the moment deserves words, and routes an accepted occasion to the
 * active Realtime session, the active Budget session, or the idle path.
 * All app access goes through injected dependencies; production wiring lives
 * in proactive-speech-install.ts.
 */
import { interpretBehaviorText } from "../behavior/behavior-policy";
import type { RobotBodyEvent, RobotBodyState } from "./body-state";
import {
  createProactiveSpeechMemory,
  decideProactiveSpeech,
  isExplicitQuietRequest,
  noteProactiveBodyEvent,
  recordProactiveUtterance,
  requestProactiveQuiet,
  type ProactiveOccasion,
  type ProactiveOccasionDetail,
  type ProactiveSpeechEnvironment,
  type ProactiveSpeechLevel,
  type ProactiveSpeechMemory,
} from "./proactive-speech-policy";

export type ProactiveSpeechRoute = "realtime" | "budget" | "idle" | "unavailable";

/** Occasions after which the person can simply answer; nobody is there to answer the others. */
export const PROACTIVE_OCCASIONS_INVITING_REPLY: ReadonlySet<ProactiveOccasion> = new Set([
  "greet_arrival", "welcome_back_after_quiet", "react_petting", "arrived",
]);

export interface ProactiveLineRequest {
  id: string;
  occasion: ProactiveOccasion;
  detail: ProactiveOccasionDetail;
  /** What the body sensed, in words for the text model. */
  occasionText: string;
  level: ProactiveSpeechLevel;
  invitesReply: boolean;
}

export interface ProactiveSpeechRuntimeDeps {
  now(): number;
  getBodyState(): RobotBodyState;
  subscribeBodyEvents(listener: (event: RobotBodyEvent) => void): () => void;
  /** Committed user transcripts of a Realtime conversation, to notice requests for quiet. */
  subscribeUserTurns(listener: (text: string) => void): () => void;
  getLevel(): ProactiveSpeechLevel;
  getEnvironment(): ProactiveSpeechEnvironment & { conversationActive: boolean };
  getRoute(): Promise<ProactiveSpeechRoute>;
  describeOccasion(occasion: ProactiveOccasion, detail: ProactiveOccasionDetail): string | null;
  /** Synchronous: the transport sends response.create now or refuses. */
  requestRealtimeLine(request: ProactiveLineRequest): boolean;
  speakInBudgetSession(request: ProactiveLineRequest): Promise<boolean>;
  speakWhileIdle(request: ProactiveLineRequest): Promise<boolean>;
  record(category: "runtime" | "cost", event: string, details: Record<string, string | number | boolean | null>): void;
  createId(): string;
}

export function isProactiveQuietRequest(text: string): boolean {
  if (isExplicitQuietRequest(text)) return true;
  try { return interpretBehaviorText(text).style === "calmer"; } catch { return false; }
}

export function createProactiveSpeechRuntime(deps: ProactiveSpeechRuntimeDeps) {
  let memory: ProactiveSpeechMemory = createProactiveSpeechMemory();
  let delivering: ProactiveOccasion | null = null;
  const subscriptions: Array<() => void> = [];

  function handleUserText(text: string): void {
    if (!isProactiveQuietRequest(text)) return;
    memory = requestProactiveQuiet(memory, deps.now());
    deps.record("runtime", "proactive-quiet-requested", { until: memory.quietUntil });
  }

  function handleEvent(event: RobotBodyEvent): Promise<void> {
    const now = deps.now();
    const environment = deps.getEnvironment();
    memory = noteProactiveBodyEvent(memory, event, { conversationActive: environment.conversationActive });
    const level = deps.getLevel();
    const decision = decideProactiveSpeech({
      event, body: deps.getBodyState(), now, level, memory,
      environment: { ...environment, assistantBusy: environment.assistantBusy || delivering !== null },
    });
    if (!decision.speak) {
      if (decision.occasion) {
        deps.record("runtime", "proactive-speech-silent", {
          bodyEvent: event.type, occasion: decision.occasion, reason: decision.reason === "assistant_busy" && delivering && !environment.assistantBusy ? "delivery_in_flight" : decision.reason,
        });
      }
      return Promise.resolve();
    }
    const occasionText = deps.describeOccasion(decision.occasion, decision.detail);
    if (!occasionText) return Promise.resolve();
    const request: ProactiveLineRequest = {
      id: deps.createId(), occasion: decision.occasion, detail: decision.detail, occasionText, level,
      invitesReply: PROACTIVE_OCCASIONS_INVITING_REPLY.has(decision.occasion),
    };
    delivering = decision.occasion;
    return deliver(request).finally(() => { delivering = null; });
  }

  async function deliver(request: ProactiveLineRequest): Promise<void> {
    let route: ProactiveSpeechRoute = "unavailable";
    let spoken = false;
    try {
      route = await deps.getRoute();
      if (route === "realtime") spoken = deps.requestRealtimeLine(request);
      else if (route === "budget") spoken = await deps.speakInBudgetSession(request);
      else if (route === "idle") spoken = await deps.speakWhileIdle(request);
    } catch (error) {
      deps.record("runtime", "proactive-speech-failed", {
        occasion: request.occasion, route, error: error instanceof Error ? error.message : String(error),
      });
    }
    if (spoken) {
      memory = recordProactiveUtterance(memory, request.occasion, deps.now());
      // A Realtime line is one extra model response in a session that is already paid for.
      if (route === "realtime") deps.record("cost", "proactive-realtime-response", { occasion: request.occasion, id: request.id });
    }
    deps.record("runtime", spoken ? "proactive-speech-delivered" : "proactive-speech-refused", {
      occasion: request.occasion, route, id: request.id,
    });
  }

  return {
    start(): () => void {
      if (subscriptions.length === 0) {
        subscriptions.push(deps.subscribeBodyEvents((event) => { void handleEvent(event); }));
        subscriptions.push(deps.subscribeUserTurns(handleUserText));
      }
      return () => { while (subscriptions.length) subscriptions.pop()?.(); };
    },
    handleEvent,
    handleUserText,
    getMemory: (): ProactiveSpeechMemory => memory,
  };
}

export type ProactiveSpeechRuntime = ReturnType<typeof createProactiveSpeechRuntime>;
