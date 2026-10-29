import type { DecisionQuestion, DecisionResult } from "../openai/decisions";
import type { CompanionAction, CompanionActionResult, CompanionSnapshot } from "./behavior-companion";
import type { SharedActivity } from "./shared-activity";
import type { ConversationTone } from "../character/companion-personality";

export type BehaviorMode = "off" | "shadow" | "active";
export type BehaviorPosture = "attend" | "reflect" | "yield" | "settle";
export type BehaviorGesture = "hold" | "curious" | "thinking" | "happy_bob" | "nod" | "speaking_soft";
export type AttentionPolicy = "keep_target" | "brief_search" | "release";

export interface BehaviorSettings {
  mode: BehaviorMode;
  dailyBudgetUsd: number;
  visualEnabled: boolean;
  candidateScoring: boolean;
  /** A single optional question after an explicitly requested image; never background speech. */
  curiosityEnabled?: boolean;
}

export interface BehaviorEnvironment {
  responseLanguage?: string;
  robotName?: string;
  foreground: boolean;
  focused: boolean;
  sleeping: boolean;
  connected: boolean;
  ambientEnabled: boolean;
  cameraEnabled: boolean;
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  motionActive: boolean;
}

export interface BehaviorFace {
  id: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface BehaviorCue {
  id: string;
  gesture: BehaviorGesture;
  mood: "curious" | "startled" | "pleased" | null;
  posture: BehaviorPosture;
  gaze?: { x: number; y: number };
  expiresAt: number;
  generation: number;
  /** Input-side reaction uses the screen; one physical beat is reserved for the heard outcome. */
  presentationOnly?: boolean;
}

/** Temporary user association of a selected region, never a recognized identity. */
export interface BehaviorObjectReference {
  sessionId: string;
  taskId: string;
  episodeId: string;
  title: string;
  referenceVersion: number;
  trackId: string;
  /** JavaScript monotonic tracking deadline; this reference is never persisted. */
  expiresAt: number;
}

export interface BehaviorMoment {
  phase: "settled" | "attending" | "reflecting" | "speaking" | "reacting";
  changedAt: number;
  userText: string;
  assistantText: string;
}

export interface PendingIntention {
  id: string;
  goal: string;
  source: "explicit_user_request";
  status: "paused" | "active" | "needs_clarification";
  lastConfirmedStep: string | null;
  waitingFor: "user_return" | "user_reply" | "clarification";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  version: number;
  /** One confirmed object trial; its milestones share this task's lifecycle. */
  activity?: SharedActivity;
}

export interface BehaviorGameState {
  kind: "guess_number";
  status: "active" | "paused" | "won" | "stopped" | "expired";
  secretAnswer: 1 | 2 | 3;
  attemptsLeft: number;
  round: number;
  startedAt: number;
  updatedAt: number;
  lastOutcome: "waiting" | "too_low" | "too_high" | "correct" | "stopped";
}

export interface BehaviorStylePreferences {
  version: number;
  scope: "device";
  suppressNod: boolean;
  livelyWhenPlayful: boolean;
  conversationTone: ConversationTone;
  greetingRitual: "nod" | "curious" | "happy_bob" | "off" | null;
  greetingRitualSource: "explicit_user_request" | null;
  maxCuesPerTurn: number;
  updatedAt: number;
}

export interface VisualAdvice {
  action: "use_view" | "ask_reposition" | "wait";
  task: string;
  sessionId: string;
  version: number;
  assessedAt: number;
  source: "decision" | "local_fallback";
}

export interface BehaviorTrace {
  at: number;
  kind: string;
  requestId?: string;
  reason?: string;
  latencyMs?: number;
  estimatedCostUsd?: number;
  costUsd?: number;
}

export interface BehaviorMetrics {
  requests: number;
  completed: number;
  failed: number;
  timedOut: number;
  stale: number;
  budgetSkipped: number;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  reservedUsd: number;
  lastLatencyMs: number | null;
}

export interface BehaviorState {
  sessionId: string | null;
  turnId: number;
  lifecycleGeneration: number;
  preferenceVersion: number;
  referenceVersion: number;
  posture: BehaviorPosture;
  postureSince: number;
  cue?: BehaviorCue;
  attentionPolicy: AttentionPolicy;
  selectedFaceId: string | null;
  lastFaceSeenAt: number | null;
  pendingIntention: PendingIntention | null;
  game: BehaviorGameState | null;
  style: BehaviorStylePreferences;
  visualAdvice: VisualAdvice | null;
  objectReference?: BehaviorObjectReference | null;
  repairRequired: boolean;
  moment: BehaviorMoment;
  companion: CompanionSnapshot;
  metrics: BehaviorMetrics;
  traces: BehaviorTrace[];
}

export type BehaviorEvent =
  | { type: "session-start"; sessionId: string }
  | { type: "session-end"; sessionId: string }
  | { type: "user-speech-start"; sessionId?: string }
  | { type: "user-speech-end"; sessionId?: string }
  | { type: "user-turn"; text: string; sessionId: string; turnId?: string }
  | { type: "assistant-start"; sessionId: string }
  | { type: "assistant-end"; text?: string; sessionId: string }
  | { type: "interrupt"; reason: string; sessionId?: string }
  | { type: "faces"; faces: BehaviorFace[]; timestampMs?: number }
  | { type: "object-reference"; sessionId: string; trackId: string; reference: BehaviorObjectReference | null }
  | { type: "visual"; imageDataUrl: string; taskText?: string; sessionId: string; lowLightLikely?: boolean }
  | { type: "game-command"; action: "start" | "stop"; sessionId?: string }
  | { type: "correction"; sessionId?: string; correctedReference?: string }
  | { type: "intention"; action: "pause" | "resume" | "drop"; goal?: string; lastConfirmedStep?: string; sessionId?: string };

export interface BehaviorDecisionContext extends Record<string, unknown> {
  eventType: string;
  sessionId: string | null;
  turnId: number;
  lifecycleGeneration: number;
  preferenceVersion: number;
  referenceVersion: number;
}

export interface BehaviorEngineDependencies {
  decide: (
    input: { context: Record<string, unknown>; questions: DecisionQuestion[]; imageDataUrl?: string },
    options: { signal: AbortSignal },
  ) => Promise<DecisionResult>;
  executeCue: (cue: BehaviorCue) => void | Promise<void>;
  now?: () => number;
  wallNow?: () => number;
  onUsage?: (usage: {
    requestId: string | null;
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    estimatedCostUsd: number;
    latencyMs: number;
    eventType: string;
  }) => void;
  decisionTimeoutMs?: number;
  traceLimit?: number;
}

export interface BehaviorEngine {
  configure(settings: BehaviorSettings): void;
  setEnvironment(environment: Partial<BehaviorEnvironment>): void;
  dispatch(event: BehaviorEvent): void;
  inspectVisual(imageDataUrl: string, taskText: string, sessionId: string): Promise<string>;
  companionAction(action: CompanionAction): CompanionActionResult;
  /** A direct settings action disables only this episode's chosen ritual. */
  disablePersonalRitual(id: string): boolean;
  acceptStartSignal(kind: "voice" | "open_palm"): boolean;
  forgetExperience(id: string): void;
  tick(): void;
  getState(): BehaviorState;
  hasPendingReturnConfirmation(): boolean;
  getConversationContext(): string;
  /** Character-only seam: no tasks, tools, gestures, or session activation. */
  getPersonalityContext(userText?: string): string;
  acceptPersonalityTurn(text: string, sessionId: string): void;
  notePersonalitySpeech(text: string | null, sessionId: string): void;
  /** Local face-stroke input only; returns a presentation duration, never motor authority. */
  noteFriendlyStroke(): { durationMs: number } | null;
  serialize(): string;
  restore(serialized: string): void;
  resetLearning(): void;
  dispose(): void;
  subscribe(listener: (state: BehaviorState) => void): () => void;
}
