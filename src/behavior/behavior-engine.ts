import type { DecisionAnswer, DecisionResult } from "../openai/decisions";
import type { BehaviorCue, BehaviorEngine, BehaviorEngineDependencies, BehaviorEnvironment, BehaviorEvent, BehaviorFace, BehaviorGesture, BehaviorSettings, BehaviorState, BehaviorTrace } from "./behavior-types";
import { buildBehaviorQuestions, interpretBehaviorText } from "./behavior-policy";
import { createBehaviorCompanion, type CompanionAction, type CompanionActionResult, type CompanionMotif } from "./behavior-companion";
import { advanceSharedActivity, hearSharedActivity, markSharedActivityStart, pauseSharedActivity, proposeSharedActivity, restoreSharedActivity, type SharedActivity } from "./shared-activity";
import type { CompanionPersonality } from "../character/companion-personality";

const MAX_TEXT = 600;
const RESERVATION_USD = 0.003;
// Explicitly paused work should still be available tomorrow, even across a
// restart. This does not authorize resuming a shared activity or a motor action.
const INTENTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const REPEATED_CUE_COOLDOWN_MS = 12_000;
const RETURN_CONFIRMATION_MS = 30_000;
const RETURN_QUESTIONS: Record<string, string> = {
  de: "Schön, dass du wieder da bist. Sollen wir weitermachen?",
  en: "Welcome back. Shall we continue?",
  ru: "С возвращением. Продолжим?",
  uk: "З поверненням. Продовжимо?",
};
const normalizeReply = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isReturnOnly = (text: string) => /^(?:ich bin wieder da|i m back|i am back|я вернулся|я вернулась|я повернувся|я повернулася)$/u.test(normalizeReply(text));
const confirmsReturn = (text: string) => /^(?:ja|ja bitte|ja gerne|gerne|klar|yes|yes please|sure|да|да пожалуйста|так|так будь ласка)$/u.test(normalizeReply(text));
const GESTURES = new Set<BehaviorGesture>(["hold", "curious", "thinking", "happy_bob", "nod", "speaking_soft"]);
const emptyMetrics = () => ({ requests: 0, completed: 0, failed: 0, timedOut: 0, stale: 0, budgetSkipped: 0, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, reservedUsd: 0, lastLatencyMs: null as number | null });
const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const bounded = (value: unknown, max = MAX_TEXT) => typeof value === "string" ? value.trim().slice(0, max) : "";
type Work = { kind: string; text: string; assistantText: string; image?: string; resolve?: (advice: string) => void; deadline: number; generation: number; session: string | null };

/** Owns semantic state and asynchronous decisions; all physical effects use one injected seam. */
export function createBehaviorEngine(deps: BehaviorEngineDependencies): BehaviorEngine {
  const now = deps.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  const wall = deps.wallNow ?? Date.now;
  const companion = createBehaviorCompanion({ now: wall });
  let settings: BehaviorSettings = { mode: "off", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: true };
  let environment: BehaviorEnvironment = { foreground: false, focused: false, sleeping: false, connected: false, ambientEnabled: false, cameraEnabled: false, userSpeaking: false, assistantSpeaking: false, motionActive: false };
  let state: BehaviorState = {
    sessionId: null, turnId: 0, lifecycleGeneration: 0, preferenceVersion: 0, referenceVersion: 0,
    posture: "settle", postureSince: now(), attentionPolicy: "keep_target", selectedFaceId: null, lastFaceSeenAt: null,
    pendingIntention: null, game: null, style: { version: 0, scope: "device", suppressNod: false, livelyWhenPlayful: false, conversationTone: "default", greetingRitual: null, greetingRitualSource: null, maxCuesPerTurn: 1, updatedAt: wall() },
    visualAdvice: null, objectReference: null, repairRequired: false, metrics: emptyMetrics(), traces: [],
    moment: { phase: "settled", changedAt: now(), userText: "", assistantText: "" }, companion: companion.snapshot(),
  };
  const listeners = new Set<(value: BehaviorState) => void>();
  let faces: BehaviorFace[] = [];
  let faceMembership = "";
  let latestText = "";
  let latestAssistantText = "";
  // A transient, session-scoped signal; it is not a transcript of unheard speech.
  let interruptedReply = false;
  let returnConfirmation: { taskId: string; question: string; heard: boolean; expiresAt: number } | null = null;
  let currentUserTurnAvailable = false;
  let pendingMotif: CompanionMotif | undefined;
  let ritualQuietTurn = false;
  let previousTopic = "";
  let lastGreetingAt = 0;
  let ritualCount = 0;
  let recentCues: BehaviorGesture[] = [];
  let lastCueAt: number | null = null;
  let issuedTurn = -1;
  let serial = 0;
  let dayKey = localDay();
  let daySpent = 0;
  let current: { controller: AbortController; work: Work; cancel: () => void } | null = null;
  let pending: Work | null = null;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  let nextRequestAt = 0;
  let disposed = false;

  function localDay() { const date = new Date(wall()); return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; }
  function renewDay() { const key = localDay(); if (key !== dayKey) { dayKey = key; daySpent = 0; } }
  function emit() {
    state = { ...state, companion: companion.snapshot(), metrics: { ...state.metrics }, style: { ...state.style }, traces: [...state.traces] };
    for (const listener of listeners) { try { listener(state); } catch {} }
  }
  function trace(kind: string, fields: Omit<BehaviorTrace, "kind" | "at"> = {}) {
    state.traces = [...state.traces, { at: now(), kind, ...fields }].slice(-(deps.traceLimit ?? 80));
  }
  function invalidate(reason: string) {
    state.lifecycleGeneration += 1;
    state.cue = undefined;
    current?.controller.abort(); current?.cancel();
    if (pending) pending.resolve?.("");
    pending = null;
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = null;
    trace("invalidated", { reason: bounded(reason, 80) });
  }
  function allowed() { return !disposed && settings.mode !== "off" && !!state.sessionId && environment.foreground && environment.focused && !environment.sleeping && !environment.userSpeaking && !environment.motionActive; }
  function valid(work: Work) { return allowed() && work.generation === state.lifecycleGeneration && work.session === state.sessionId && now() <= work.deadline; }
  function expireState() {
    companion.tick();
    if (state.pendingIntention && state.pendingIntention.expiresAt <= wall()) state.pendingIntention = null;
    if (returnConfirmation && (returnConfirmation.expiresAt <= wall() || state.pendingIntention?.id !== returnConfirmation.taskId || state.pendingIntention.status !== "paused")) returnConfirmation = null;
    const activity = state.pendingIntention?.activity;
    if (activity?.pending && wall() - activity.pending.proposedAt >= 120_000) {
      updateActivity(pauseSharedActivity(activity));
      if (state.pendingIntention) state.pendingIntention = { ...state.pendingIntention, status: "paused", waitingFor: "user_return" };
    }
    if ((state.game?.status === "active" || state.game?.status === "paused") && wall() - state.game.updatedAt > 300_000) state.game = { ...state.game, status: "expired" };
    const reference = state.objectReference;
    const task = state.pendingIntention;
    if (reference && (settings.mode !== "active" || reference.sessionId !== state.sessionId || reference.referenceVersion !== state.referenceVersion
      || now() >= reference.expiresAt || !task || task.id !== reference.taskId || task.status !== "active"
      || !activity || activity.episodeId !== reference.episodeId || activity.title !== reference.title || activity.phase === "completed"
      || !companion.snapshot().episodes.some((episode) => episode.id === reference.episodeId && episode.title === reference.title))) {
      state.objectReference = null; invalidate("object-reference-expired");
    }
  }
  function moment(phase: BehaviorState["moment"]["phase"]) {
    state.moment = { phase, changedAt: now(), userText: latestText, assistantText: latestAssistantText };
  }
  function cancelCompanion(preservePendingIntention = false) {
    state.objectReference = null;
    companion.cancel(); pendingMotif = undefined; ritualQuietTurn = false; currentUserTurnAvailable = false;
    if (!preservePendingIntention && state.pendingIntention?.activity) {
      const activity = pauseSharedActivity(state.pendingIntention.activity);
      state.pendingIntention = activity ? { ...state.pendingIntention, activity, status: "paused", waitingFor: "user_return", updatedAt: wall(), version: state.pendingIntention.version + 1 } : null;
    }
  }
  function updateActivity(activity: SharedActivity | null, accepted: string | null = null) {
    const task = state.pendingIntention;
    if (!task?.activity) return;
    if (!activity) { state.pendingIntention = null; return; }
    const last = activity.confirmed.at(-1);
    state.pendingIntention = { ...task, activity, lastConfirmedStep: last?.detail ?? task.lastConfirmedStep,
      ...(accepted ? { status: "active" as const, waitingFor: "user_reply" as const } : {}), updatedAt: wall(), version: task.version + 1 };
  }
  function activityStart() {
    const task = state.pendingIntention;
    const scene = companion.snapshot().scene;
    if (task?.activity && task.status === "active" && task.activity.phase === "waiting_for_start" && scene.status === "started" && scene.episodeId === task.activity.episodeId)
      updateActivity(markSharedActivityStart(task.activity, scene.episodeId, wall()));
  }
  function context(work: Work): Record<string, unknown> {
    return { eventType: work.kind, sessionId: state.sessionId, turnId: state.turnId, lifecycleGeneration: state.lifecycleGeneration, preferenceVersion: state.preferenceVersion, referenceVersion: state.referenceVersion,
      recentUserText: work.text, recentAssistantText: work.assistantText,
      selectedObjectReference: state.objectReference ? { episodeId: state.objectReference.episodeId, title: state.objectReference.title, source: "user_selected_region" } : null,
      eventText: work.kind === "assistant-end" ? work.assistantText : work.text,
      conversation: { userSpeaking: environment.userSpeaking, assistantSpeaking: environment.assistantSpeaking },
      posture: state.posture, pendingIntention: state.pendingIntention, style: state.style, personality: personality(work.text), game: state.game ? {
        status: state.game.status, outcome: state.game.lastOutcome,
        ...(state.game.status === "paused" ? { instruction: "The local number game is paused. Wait; do not invite or process a guess. Resume only after an explicit user resume request." } : {}),
      } : null,
      ...(gameOngoing() && state.pendingIntention ? { interactionFocus: "The local number game has current focus. Keep a separate pending task unchanged; do not resume it or advance its milestones." } : {}),
      faceCandidates: environment.cameraEnabled ? faces : [], selectedFaceId: state.selectedFaceId, faceAgeMs: state.lastFaceSeenAt === null ? null : Math.max(0, now() - state.lastFaceSeenAt),
      recentCues, moment: state.moment, ...companion.context(work.text), robot: { connected: environment.connected, motionActive: environment.motionActive, ambientEnabled: environment.ambientEnabled },
      ...(work.image ? { task: work.text } : {}), instruction: "At assistant-end react to the heard assistant text in the context of the user turn. Coordinate one brief reaction with the current interaction phase. Sensor absence is unknown, not proof of emotion or intent. Select only a currently supplied candidate; hold on uncertainty. Do not change an explicit preference or invent identity or a shared outcome." };
  }
  function eligibilityWindowMs(kind: string, image?: string) {
    if (image) return Math.min(2_000, deps.decisionTimeoutMs ?? 1_800);
    // Speech has already finished here, so a reaction may use the request's
    // existing allowance. Input and face choices need the shorter freshness cap.
    if (kind === "assistant-end") return Math.min(1_800, deps.decisionTimeoutMs ?? 1_800);
    return 800;
  }
  function queue(kind: string, text = latestText, image?: string, resolve?: (advice: string) => void) {
    // Queueing and rate spacing consume the same event-time window; neither a
    // later request start nor its response renews eligibility for a gesture.
    const work: Work = { kind, text: bounded(text), assistantText: latestAssistantText, image, resolve, deadline: now() + eligibilityWindowMs(kind, image), generation: state.lifecycleGeneration, session: state.sessionId };
    if (!allowed() || (image && !settings.visualEnabled)) { resolve?.(""); return; }
    if (kind === "faces" && (current || pending)) { resolve?.(""); return; }
    pending?.resolve?.(""); pending = work;
    pump();
  }
  function pump() {
    if (current || !pending || disposed) return;
    const work = pending;
    if (!valid(work)) { pending = null; work.resolve?.(""); return; }
    const wait = nextRequestAt - now();
    if (wait > 0) { if (!pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.min(wait, 800)); return; }
    pending = null;
    renewDay();
    if (daySpent + RESERVATION_USD > settings.dailyBudgetUsd) { state.metrics.budgetSkipped += 1; trace("budget-skipped"); work.resolve?.(""); emit(); return; }
    daySpent += RESERVATION_USD;
    const reservationDay = dayKey;
    state.metrics.requests += 1; state.metrics.reservedUsd += RESERVATION_USD;
    const controller = new AbortController();
    let rejectCancellation!: (error: Error) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    current = { controller, work, cancel: () => rejectCancellation(new Error("cancelled")) };
    const started = now();
    let timedOut = false;
    let accounted = false;
    let reservationReleased = false;
    const release = () => { if (!reservationReleased) { reservationReleased = true; state.metrics.reservedUsd = Math.max(0, state.metrics.reservedUsd - RESERVATION_USD); } };
    const account = (result: DecisionResult) => {
      if (accounted) return;
      accounted = true;
      if (reservationDay === dayKey) daySpent = Math.max(0, daySpent - RESERVATION_USD + finite(result.usage.costUsd));
      state.metrics.inputTokens += finite(result.usage.inputTokens); state.metrics.cachedTokens += finite(result.usage.cachedTokens); state.metrics.cacheWriteTokens += finite(result.usage.cacheWriteTokens); state.metrics.costUsd += finite(result.usage.costUsd);
      release();
      try { deps.onUsage?.({ ...result.usage, requestId: result.requestId, estimatedCostUsd: RESERVATION_USD, latencyMs: Math.max(0, now() - started), eventType: work.kind }); } catch {}
    };
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); rejectCancellation(new Error("timeout")); }, Math.max(1, Math.min(work.deadline - now(), deps.decisionTimeoutMs ?? 1_800)));
    let raw: Promise<DecisionResult>;
    try { raw = Promise.resolve(deps.decide({ context: context(work), questions: buildBehaviorQuestions({ candidateScoring: settings.candidateScoring, hasImage: !!work.image, faceIds: environment.cameraEnabled ? faces.map((face) => face.id) : [] }), ...(work.image ? { imageDataUrl: work.image } : {}) }, { signal: controller.signal })); }
    catch (error) { raw = Promise.reject(error); }
    // Usage remains chargeable even when a request's visible effect became stale.
    void raw.then((result) => { account(result); emit(); }, () => undefined);
    trace("requested", { estimatedCostUsd: RESERVATION_USD }); emit();
    void Promise.race([raw, cancelled]).then((result) => {
      account(result);
      if (!valid(work)) { state.metrics.stale += 1; trace("stale"); work.resolve?.(""); return; }
      state.metrics.completed += 1; state.metrics.lastLatencyMs = Math.max(0, now() - started);
      applyResult(result.answers, work);
      trace("completed", { requestId: result.requestId ?? undefined, latencyMs: state.metrics.lastLatencyMs, costUsd: result.usage.costUsd });
    }).catch((error: unknown) => {
      if (controller.signal.aborted && !timedOut) { state.metrics.stale += 1; trace("cancelled"); }
      else { state.metrics.failed += 1; if (timedOut || (error as { code?: string })?.code === "timeout") state.metrics.timedOut += 1; trace("failed", { reason: timedOut ? "timeout" : "request-failed" }); nextRequestAt = now() + 5_000; }
      work.resolve?.("");
    }).finally(() => {
      clearTimeout(timeout); release();
      if (current?.controller === controller) current = null;
      nextRequestAt = Math.max(nextRequestAt, started + 1_000);
      emit(); pump();
    });
  }
  function choice(answers: DecisionAnswer[], name: string): string | null {
    const answer = answers.find((value) => value.name === name);
    return answer?.type === "choice" && answer.confidence >= 0.55 ? answer.choice : null;
  }
  function applyResult(answers: DecisionAnswer[], work: Work) {
    const textIntent = interpretBehaviorText(work.text);
    const visual = choice(answers, "visual");
    if (work.image) {
      if (visual === "use_view" || visual === "ask_reposition" || visual === "wait") {
        state.visualAdvice = { action: visual, task: work.text, sessionId: state.sessionId!, version: (state.visualAdvice?.version ?? 0) + 1, assessedAt: now(), source: "decision" };
        if (visual === "use_view" && settings.mode === "active") companion.visual(work.text);
        work.resolve?.(visual === "use_view" ? "The requested view is usable; still verify details yourself." : visual === "ask_reposition" ? "The requested task needs a clearer view. Ask for better framing, angle or light instead of guessing." : "Wait for the user to present a clearer, steady view; do not guess unseen details.");
      } else work.resolve?.("");
      return;
    }
    const attention = choice(answers, "attention");
    if (textIntent.pause || textIntent.drop || state.pendingIntention?.status === "paused") state.attentionPolicy = "release";
    else if (attention === "release" || attention === "brief_search" || attention === "keep_target") state.attentionPolicy = attention;
    const selected = choice(answers, "target_face");
    if (environment.cameraEnabled && selected && faces.some((face) => face.id === selected)) state.selectedFaceId = selected;
    if (selected === "none") { state.selectedFaceId = null; state.attentionPolicy = "release"; }
    if (state.pendingIntention && !state.pendingIntention.activity && !gameOngoing() && !returnConfirmation && choice(answers, "intention") === "offer_resume") state.pendingIntention = { ...state.pendingIntention, status: "needs_clarification", waitingFor: "clarification" };
    let gesture = choice(answers, "cue") as BehaviorGesture | null;
    if (!gesture || !GESTURES.has(gesture)) gesture = "hold";
    // Scores compare a common rubric, never multiply them into confidence.
    const scores = answers.filter((value) => value.type === "score");
    const hold = scores.find((value) => value.name === "score_hold");
    const joy = scores.find((value) => value.name === "score_joy");
    const curiosity = scores.find((value) => value.name === "score_curiosity");
    if (hold?.type === "score" && hold.score >= 3.5) gesture = "hold";
    else if (settings.candidateScoring && joy?.type === "score" && joy.score >= 3.5 && joy.confidence >= 0.7) gesture = "happy_bob";
    else if (settings.candidateScoring && curiosity?.type === "score" && curiosity.score >= 3.5 && curiosity.confidence >= 0.7) gesture = "curious";
    if (textIntent.greeting && (state.style.greetingRitual === "off" || wall() - lastGreetingAt < 30_000)) gesture = "hold";
    else if (textIntent.greeting) {
      lastGreetingAt = wall(); ritualCount += 1;
      const ritual = state.style.greetingRitual;
      if (gesture !== "hold") gesture = ritual && ritual !== "off" ? ritual : (ritualCount % 2 ? "curious" : "happy_bob");
    }
    if (state.style.suppressNod && gesture === "nod") gesture = "hold";
    if (state.style.livelyWhenPlayful && textIntent.playful && gesture === "curious") gesture = "happy_bob";
    const motif = pendingMotif;
    if (!motif && !textIntent.greeting && companion.personalitySituation(work.text).conversationMoment?.valence === "negative" && gesture === "happy_bob") gesture = "hold";
    // Learned familiarity changes an already permitted accent, never a hold or
    // an explicitly chosen ritual. Existing cadence and ownership still apply.
    const familiarTitle = companion.familiarInterest(work.text);
    if (work.kind === "assistant-end" && !motif && !textIntent.greeting && !state.repairRequired && !gameOngoing() && gesture === "nod" && familiarTitle
      && !companion.snapshot().episodes.some((episode) => episode.title === familiarTitle && episode.ritualPreference)) gesture = "curious";
    if (motif && issuedTurn !== state.turnId && !(motif === "nod" && state.style.suppressNod)) gesture = motif;
    if (state.style.conversationTone === "calm" && !motif && !textIntent.greeting && gesture === "happy_bob") gesture = "hold";
    if (!motif && !textIntent.greeting && companion.lifeContext(environment.sleeping).energy === "quiet" && gesture === "happy_bob") gesture = "hold";
    if (ritualQuietTurn) gesture = "hold";
    // Avoid an identical physical accent immediately recurring across turns or
    // sessions. Explicit rituals and greetings have their own cooldown rules.
    if (gesture !== "hold" && !motif && !textIntent.greeting && recentCues.at(-1) === gesture && lastCueAt !== null &&
        wall() - lastCueAt < REPEATED_CUE_COOLDOWN_MS) gesture = "hold";
    if (issuedTurn === state.turnId && gesture !== "hold") gesture = "hold";
    state.posture = gesture === "thinking" ? "reflect" : work.kind === "assistant-end" ? "yield" : gesture === "hold" ? "attend" : "settle";
    state.postureSince = now();
    const presentationOnly = work.kind === "user-turn" && !motif;
    const cue: BehaviorCue = { id: `cue-${++serial}`, gesture, posture: state.posture, mood: gesture === "happy_bob" ? "pleased" : gesture === "curious" ? "curious" : null, expiresAt: work.deadline, generation: state.lifecycleGeneration, presentationOnly,
      ...(gesture === "thinking" ? { gaze: { x: 0, y: 0.25 } } : {}) };
    if (presentationOnly) { state.posture = "reflect"; cue.posture = "reflect"; }
    state.cue = cue;
    if (settings.mode === "active" && valid(work)) {
      if (gesture !== "hold" && !presentationOnly) {
        if (motif === gesture && !companion.reserveMotif(motif)) { cue.gesture = "hold"; cue.mood = null; }
        else { issuedTurn = state.turnId; recentCues = [...recentCues, gesture].slice(-8); lastCueAt = wall(); }
      }
      pendingMotif = undefined;
      moment(presentationOnly ? "reflecting" : "reacting");
      try { void Promise.resolve(deps.executeCue(cue)).catch(() => { trace("cue-cancelled"); emit(); }); } catch { trace("cue-cancelled"); }
    }
  }
  function pause(goal = previousTopic, confirmedStep?: string) {
    state.attentionPolicy = "release";
    if (!goal && !state.pendingIntention) return;
    const existing = state.pendingIntention;
    state.pendingIntention = { id: existing?.id ?? `intent-${++serial}`, goal: bounded(existing?.goal ?? goal), source: "explicit_user_request", status: "paused", lastConfirmedStep: existing?.activity ? existing.lastConfirmedStep : bounded(confirmedStep) || existing?.lastConfirmedStep || null, waitingFor: "user_return", createdAt: existing?.createdAt ?? wall(), updatedAt: wall(), expiresAt: wall() + INTENTION_RETENTION_MS, version: (existing?.version ?? 0) + 1, ...(existing?.activity ? { activity: pauseSharedActivity(existing.activity)! } : {}) };
  }
  function gameOngoing() { return state.game?.status === "active" || state.game?.status === "paused"; }
  function pauseGame() {
    if (state.game?.status !== "active") return false;
    state.game = { ...state.game, status: "paused", updatedAt: wall() };
    state.attentionPolicy = "release";
    return true;
  }
  function resumeGame() {
    if (state.game?.status !== "paused" || !allowed()) return false;
    state.game = { ...state.game, status: "active", updatedAt: wall() };
    state.attentionPolicy = "keep_target";
    return true;
  }
  function stopOngoingGame() {
    if (!gameOngoing()) return false;
    state.game = { ...state.game!, status: "stopped", lastOutcome: "stopped", updatedAt: wall() };
    return true;
  }
  function startGame() {
    state.game = { kind: "guess_number", status: "active", secretAnswer: ((state.turnId % 3) + 1) as 1 | 2 | 3, attemptsLeft: 3, round: (state.game?.round ?? 0) + 1, startedAt: wall(), updatedAt: wall(), lastOutcome: "waiting" };
  }
  function personality(text = latestText): CompanionPersonality {
    const life = companion.lifeContext(environment.sleeping);
    const overview = companion.interestOverview(text, environment.robotName);
    if (overview) return { tone: state.style.conversationTone, life, familiarInterests: overview.titles, interestOverview: { total: overview.total } };
    const situation = companion.personalitySituation(text);
    if (situation.greetingInterest) return { tone: state.style.conversationTone, life, familiarInterests: [], ...situation };
    const interest = companion.familiarInterest(text);
    return { tone: state.style.conversationTone, life, familiarInterests: interest ? [interest] : [], ...situation };
  }
  function acceptPersonalityTurn(text: string, sessionId: string) {
    if (disposed || !sessionId || !text.trim()) return;
    const intent = interpretBehaviorText(text);
    if (intent.style) {
      const conversationTone = intent.style === "lively_playful" ? "playful" : intent.style === "calmer" ? "calm"
        : intent.style === "default_personality" ? "default" : state.style.conversationTone;
      state.style = { ...state.style, version: state.style.version + 1,
        suppressNod: intent.style === "less_nod" || state.style.suppressNod,
        livelyWhenPlayful: intent.style === "less_nod" ? state.style.livelyWhenPlayful : conversationTone === "playful",
        conversationTone, updatedAt: wall() };
    }
    const present = environment.foreground && environment.focused && !environment.sleeping;
    companion.personalityTurn(text, sessionId, settings.mode === "active" && present, environment.robotName,
      present && !gameOngoing() && !state.pendingIntention && !state.repairRequired);
  }
  function userTurn(text: string) {
    const intent = interpretBehaviorText(text);
    const gamePausedAtStart = state.game?.status === "paused";
    const returned = isReturnOnly(text);
    const waitingReturn = returnConfirmation;
    returnConfirmation = null;
    if (waitingReturn?.heard && waitingReturn.expiresAt > wall() && confirmsReturn(text) &&
      state.pendingIntention?.id === waitingReturn.taskId && state.pendingIntention.status === "paused" &&
      !state.pendingIntention.activity && !gameOngoing()) {
      state.pendingIntention = { ...state.pendingIntention, status: "active", waitingFor: "user_reply", updatedAt: wall(), version: state.pendingIntention.version + 1 };
      state.attentionPolicy = "keep_target";
    }
    const pauseTargetsGame = intent.pause && !intent.gameStop && !intent.gameStart && gameOngoing();
    const gameOwnsTurn = gamePausedAtStart || pauseTargetsGame;
    const cancelsCompanion = intent.pause || intent.drop || intent.correction || intent.gameStart;
    // Retire old proposals and leases before accepting the new text. Clearing
    // afterwards would also erase the exact current correction quote.
    if (cancelsCompanion) cancelCompanion(pauseTargetsGame || intent.gameStop && gameOngoing());
    const companionTurn = companion.userTurn(bounded(text));
    pendingMotif = companionTurn.motif;
    ritualQuietTurn = companionTurn.ritualDeclined === true;
    const activity = gameOwnsTurn || intent.correction ? null : state.pendingIntention?.activity;
    if (activity) {
      if (!companion.snapshot().episodes.some((episode) => episode.id === activity.episodeId)) state.pendingIntention = null;
      else {
        const next = advanceSharedActivity(activity, bounded(text), state.sessionId ?? "", wall());
        if (next.activity !== activity || next.accepted) updateActivity(next.activity, next.accepted);
      }
    }
    if (!gameOwnsTurn && !intent.correction) activityStart();
    // A correction cancels old work, but its own freshly committed text can
    // still authorize a grounded repair action. Pause/drop/start remain closed.
    currentUserTurnAvailable = !cancelsCompanion || intent.correction && !intent.pause && !intent.drop && !intent.gameStart && !intent.gameStop;
    acceptPersonalityTurn(text, state.sessionId ?? "");
    if (intent.greetingRitual) state.style = { ...state.style, version: state.style.version + 1, greetingRitual: intent.greetingRitual, greetingRitualSource: "explicit_user_request", updatedAt: wall() };
    if (intent.correction) { state.referenceVersion += 1; state.repairRequired = true; state.attentionPolicy = "release"; state.selectedFaceId = null; }
    else state.repairRequired = false;
    if (intent.drop && !(intent.gameStop && gameOngoing())) { state.pendingIntention = null; state.attentionPolicy = "release"; }
    else if (intent.pause && !intent.gameStop && !intent.gameStart) {
      if (state.game?.status === "active") pauseGame();
      else if (state.game?.status === "paused") state.attentionPolicy = "release";
      else pause();
    }
    else if (intent.resume || returned) {
      if (gamePausedAtStart) resumeGame();
      else if (state.pendingIntention && !state.pendingIntention.activity && returned && state.pendingIntention.status === "paused") {
        returnConfirmation = { taskId: state.pendingIntention.id, question: RETURN_QUESTIONS[environment.responseLanguage ?? ""] ?? RETURN_QUESTIONS.en, heard: false, expiresAt: wall() + RETURN_CONFIRMATION_MS };
      }
      else if (state.pendingIntention && !state.pendingIntention.activity && !returned) { state.pendingIntention = { ...state.pendingIntention, status: "active", waitingFor: "user_reply", updatedAt: wall(), version: state.pendingIntention.version + 1 }; state.attentionPolicy = "keep_target"; }
    }
    if (intent.gameStop && state.game) state.game = { ...state.game, status: "stopped", lastOutcome: "stopped", updatedAt: wall() };
    else if (intent.gameStart) startGame();
    else if (state.game?.status === "active" && intent.guess && allowed()) {
      const game = state.game; const correct = game.secretAnswer === intent.guess;
      state.game = { ...game, attemptsLeft: game.attemptsLeft - 1, updatedAt: wall(), status: correct ? "won" : game.attemptsLeft <= 1 ? "stopped" : "active", lastOutcome: correct ? "correct" : intent.guess < game.secretAnswer ? "too_low" : "too_high" };
    }
    if (!intent.pause && !intent.resume && !intent.drop && !intent.greeting && !intent.style && !intent.greetingRitual && !intent.gameStart && !intent.gameStop) previousTopic = bounded(text);
    latestText = bounded(text);
    latestAssistantText = "";
    moment("reflecting");
  }
  const engine: BehaviorEngine = {
    configure(next) {
      const normalized: BehaviorSettings = { mode: next.mode === "active" || next.mode === "shadow" ? next.mode : "off", dailyBudgetUsd: Math.max(0, Math.min(10, finite(next.dailyBudgetUsd, 1))), visualEnabled: next.visualEnabled === true, candidateScoring: next.candidateScoring === true, curiosityEnabled: next.curiosityEnabled === true };
      if (JSON.stringify(settings) === JSON.stringify(normalized)) return;
      invalidate("configuration"); pauseGame(); cancelCompanion(); settings = normalized; state.preferenceVersion += 1; moment("settled"); emit();
    },
    setEnvironment(next) {
      const before = environment;
      environment = { ...environment, ...next };
      const unsafe = !environment.foreground || !environment.focused || environment.sleeping || environment.userSpeaking || environment.motionActive;
      const wasUnsafe = !before.foreground || !before.focused || before.sleeping || before.userSpeaking || before.motionActive;
      const critical = !environment.foreground || !environment.focused || environment.sleeping || environment.motionActive;
      const wasCritical = !before.foreground || !before.focused || before.sleeping || before.motionActive;
      if ((unsafe && !wasUnsafe) || (critical && !wasCritical)) invalidate("environment");
      if (!environment.foreground || !environment.focused || environment.sleeping || environment.motionActive) pauseGame();
      if (!environment.foreground || !environment.focused || environment.sleeping || environment.motionActive) { returnConfirmation = null; cancelCompanion(); moment("settled"); }
      if (before.connected && !environment.connected) { invalidate("robot-disconnected"); pauseGame(); cancelCompanion(); moment("settled"); }
      if (before.cameraEnabled && !environment.cameraEnabled) { faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; cancelCompanion(); }
      emit();
    },
    dispatch(event) {
      if (disposed) return;
      if ("sessionId" in event && event.sessionId && event.type !== "session-start" && event.sessionId !== state.sessionId) return;
      if (settings.mode === "off" && !["session-start", "session-end", "interrupt"].includes(event.type)) {
        if (event.type === "user-turn") { latestText = bounded(event.text); acceptPersonalityTurn(event.text, state.sessionId ?? ""); emit(); }
        if (event.type === "assistant-end") { companion.notePersonalitySpeech(event.text ?? "", state.sessionId ?? ""); emit(); }
        return;
      }
      expireState();
      switch (event.type) {
        case "session-start": invalidate("session-start"); cancelCompanion(); state.sessionId = event.sessionId; state.turnId = 0; issuedTurn = -1; state.game = null; state.visualAdvice = null; latestText = ""; latestAssistantText = ""; interruptedReply = false; returnConfirmation = null; previousTopic = ""; faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; moment("settled"); break;
        case "session-end": invalidate("session-end"); cancelCompanion(); interruptedReply = false; returnConfirmation = null; state.sessionId = null; state.posture = "settle"; state.game = null; faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; moment("settled"); break;
        case "user-speech-start": if (environment.assistantSpeaking) { interruptedReply = true; companion.notePersonalitySpeech(null, state.sessionId ?? ""); } invalidate("user-speaking"); currentUserTurnAvailable = false; pendingMotif = undefined; environment.userSpeaking = true; state.posture = "attend"; moment("attending"); break;
        case "user-speech-end": environment.userSpeaking = false; state.posture = "reflect"; moment("reflecting"); break;
        case "user-turn": invalidate("new-turn"); state.turnId += 1; issuedTurn = -1; state.visualAdvice = null; userTurn(event.text); queue("user-turn", event.text); break;
        case "assistant-start": invalidate("audible-turn-start"); environment.assistantSpeaking = true; moment("speaking"); break;
        case "assistant-end": environment.assistantSpeaking = false; interruptedReply = false; invalidate("audible-turn-end"); latestAssistantText = bounded(event.text);
          if (returnConfirmation) {
            if (returnConfirmation.expiresAt > wall() && normalizeReply(latestAssistantText) === normalizeReply(returnConfirmation.question)) returnConfirmation.heard = true;
            else returnConfirmation = null;
          }
          { const heard = companion.assistantEnd(latestAssistantText); if (heard?.ritualMotif) pendingMotif = heard.ritualMotif; }
          companion.notePersonalitySpeech(event.text ?? "", state.sessionId ?? "");
          if (state.pendingIntention?.activity) updateActivity(hearSharedActivity(state.pendingIntention.activity, latestAssistantText, wall()));
          state.posture = "yield"; moment("reacting"); queue("assistant-end"); break;
        case "interrupt": if (environment.assistantSpeaking) interruptedReply = true; returnConfirmation = null; invalidate(event.reason); state.posture = "attend";
          cancelCompanion(); moment("settled");
          if (event.reason === "voice-emergency-kws" || /stop|cliff|sleep|disconnect/i.test(event.reason)) stopOngoingGame();
          break;
        case "object-reference": {
          const reference = event.reference;
          if (!reference) {
            if (state.objectReference?.trackId === event.trackId) { state.objectReference = null; invalidate("object-reference-ended"); }
            break;
          }
          const task = state.pendingIntention;
          const activity = task?.activity;
          if (settings.mode !== "active" || reference.sessionId !== state.sessionId || reference.sessionId !== event.sessionId
            || reference.trackId !== event.trackId || !bounded(reference.trackId, 128) || reference.referenceVersion !== state.referenceVersion
            || !Number.isFinite(reference.expiresAt) || reference.expiresAt <= now() || reference.expiresAt > now() + 10_000
            || !task || task.id !== reference.taskId || task.status !== "active" || !activity || activity.confirmedAt === null
            || activity.phase === "completed" || activity.episodeId !== reference.episodeId || activity.title !== reference.title
            || !companion.snapshot().episodes.some((episode) => episode.id === reference.episodeId && episode.title === reference.title)) break;
          invalidate("object-reference-selected"); state.objectReference = { ...reference };
          break;
        }
        case "faces": {
          if (!environment.cameraEnabled) break;
          const nextFaces = event.faces.filter((face) => bounded(face.id, 80) && [face.centerX, face.centerY, face.width, face.height].every(Number.isFinite) && face.centerX >= 0 && face.centerX <= 1 && face.centerY >= 0 && face.centerY <= 1 && face.width > 0 && face.height > 0).slice(0, 8).map((face) => ({ id: face.id.slice(0, 80), centerX: face.centerX, centerY: face.centerY, width: face.width, height: face.height }));
          const membership = nextFaces.map((face) => face.id).sort().join("|");
          faces = nextFaces; state.lastFaceSeenAt = faces.length ? now() : null;
          if (!faces.some((face) => face.id === state.selectedFaceId)) state.selectedFaceId = [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0]?.id ?? null;
          if (membership !== faceMembership) { faceMembership = membership; if (faces.length > 1 || !faces.length) queue("faces"); }
          break;
        }
        case "visual": if (settings.visualEnabled) queue("visual", event.taskText, event.imageDataUrl); break;
        case "game-command": invalidate("game-command"); cancelCompanion(); if (event.action === "start") startGame(); else if (state.game) state.game = { ...state.game, status: "stopped", lastOutcome: "stopped", updatedAt: wall() }; break;
        case "correction": invalidate("correction"); cancelCompanion(); state.referenceVersion += 1; state.repairRequired = true; state.attentionPolicy = "release"; state.selectedFaceId = null; if (event.correctedReference) previousTopic = bounded(event.correctedReference); moment("attending"); break;
        case "intention":
          invalidate("intention");
          if (event.action === "pause" || event.action === "drop") cancelCompanion();
          if (event.action === "pause") pause(event.goal, event.lastConfirmedStep);
          else if (event.action === "drop") { state.pendingIntention = null; state.attentionPolicy = "release"; }
          else if (state.pendingIntention && !state.pendingIntention.activity) { state.pendingIntention = { ...state.pendingIntention, status: "active", waitingFor: "user_reply", updatedAt: wall(), version: state.pendingIntention.version + 1 }; state.attentionPolicy = "keep_target"; }
          break;
      }
      emit();
    },
    inspectVisual(image, task, sessionId) {
      if (sessionId !== state.sessionId || settings.mode !== "active" || !settings.visualEnabled) return Promise.resolve("");
      return new Promise((resolve) => {
        let done = false;
        const finish = (advice: string) => { if (done) return; done = true; clearTimeout(timer); resolve(advice.slice(0, 1000)); };
        const timer = setTimeout(() => finish(""), Math.min(2_000, deps.decisionTimeoutMs ?? 1_800));
        queue("visual", task, image, finish);
      });
    },
    companionAction(action: CompanionAction): CompanionActionResult {
      if (settings.mode !== "active" || !allowed() || !currentUserTurnAvailable || !state.sessionId)
        return { ok: false, status: "session-inactive" };
      if (action.type === "manage_shared_activity") {
        const episode = companion.snapshot().episodes.find((item) => item.id === action.id);
        if (!episode) return { ok: false, status: "not_found" };
        const sceneStatus = companion.snapshot().scene.status;
        if (gameOngoing() || companion.snapshot().pendingExperience || state.pendingIntention && !state.pendingIntention.activity || action.operation === "begin" && (sceneStatus === "armed" || sceneStatus === "started"))
          return { ok: false, status: "activity_conflict", instruction: "Finish or drop the other task, game or pending memory confirmation first." };
        const before = state.pendingIntention;
        const next = proposeSharedActivity(before?.activity ?? null, action, {
          userText: latestText, sessionId: state.sessionId, language: environment.responseLanguage,
          now: wall(), episodeTitle: episode.title, paused: before?.status === "paused",
        });
        if (next.result.ok) {
          if (!next.activity) state.pendingIntention = null;
          else if (before?.activity) updateActivity(next.activity);
          else state.pendingIntention = { id: `intent-${++serial}`, goal: episode.title, source: "explicit_user_request", status: "needs_clarification", lastConfirmedStep: null, waitingFor: "clarification", createdAt: wall(), updatedAt: wall(), expiresAt: wall() + INTENTION_RETENTION_MS, version: 1, activity: next.activity };
          emit();
        }
        return next.result;
      }
      if (action.type === "offer_interest" && (!settings.curiosityEnabled || !settings.visualEnabled || gameOngoing()))
        return { ok: false, status: "visual_not_authorized", instruction: "Curiosity needs its explicit opt-in, an allowed requested image, and no ongoing game." };
      if ((action.type === "propose_visual_memory" || action.type === "compare_shared_object") && !settings.visualEnabled)
        return { ok: false, status: "visual_not_authorized" };
      if (action.type === "set_episode_ritual" && state.pendingIntention?.activity?.pending)
        return { ok: false, status: "pending_exists", instruction: "Resolve the activity confirmation before choosing a personal ritual." };
      if (action.type === "prepare_shared_ritual" && (gameOngoing() || action.signal === "open_palm" && !environment.cameraEnabled))
        return { ok: false, status: "invalid_action", instruction: "An open-palm start needs Camera Attention enabled. Finish the current game before preparing a shared ritual." };
      if (action.type === "prepare_shared_ritual" && state.pendingIntention?.activity && (state.pendingIntention.status !== "active" || state.pendingIntention.activity.episodeId !== action.id || state.pendingIntention.activity.phase !== "waiting_for_start"))
        return { ok: false, status: "activity_not_ready", instruction: "Confirm checking and preparation for this activity before arming its existing start ritual." };
      const result = companion.act(action, { userText: latestText, sessionId: state.sessionId, language: environment.responseLanguage });
      if (action.type === "set_episode_ritual" && action.mode === "silent" && result.ok) {
        invalidate("personal-ritual-silenced");
        pendingMotif = undefined;
        ritualQuietTurn = true;
      }
      // Recall returns confirmed facts. A personal ritual waits for its selected
      // phrase at assistant-end; legacy motifs require an explicit outcome report.
      emit();
      return result;
    },
    acceptStartSignal(kind) {
      if (settings.mode !== "active" || !allowed() || environment.assistantSpeaking || gameOngoing() || kind === "open_palm" && !environment.cameraEnabled) return false;
      if (state.pendingIntention?.activity && (state.pendingIntention.status !== "active" || state.pendingIntention.activity.phase !== "waiting_for_start" || state.pendingIntention.activity.episodeId !== companion.snapshot().scene.episodeId)) return false;
      if (!companion.acceptStartSignal(kind)) return false;
      activityStart();
      invalidate("agreed-start-signal"); currentUserTurnAvailable = false; pendingMotif = undefined;
      state.turnId += 1; issuedTurn = -1; state.posture = "reflect"; moment("reflecting"); emit();
      return true;
    },
    forgetExperience(id) {
      invalidate("experience-forgotten"); cancelCompanion(); companion.forget(id);
      if (state.pendingIntention?.activity?.episodeId === id) state.pendingIntention = null;
      emit();
    },
    disablePersonalRitual(id) {
      invalidate("personal-ritual-disabled");
      pendingMotif = undefined;
      const changed = companion.disableRitual(id);
      emit();
      return changed;
    },
    tick() {
      const before = JSON.stringify(state.companion);
      const beforeTask = state.pendingIntention;
      const beforeGame = state.game;
      const beforeReference = state.objectReference;
      const beforeReturn = returnConfirmation;
      expireState();
      const settled = state.moment.phase === "reacting" && now() - state.moment.changedAt > 1_500;
      if (settled) moment("settled");
      if (settled || beforeReturn !== returnConfirmation || beforeGame !== state.game || beforeReference !== state.objectReference || beforeTask !== state.pendingIntention || before !== JSON.stringify(companion.snapshot()) || state.moment.phase === "settled" && state.posture !== "settle") {
        if (state.moment.phase === "settled") state.posture = "settle";
        emit();
      }
    },
    getState: () => state,
    hasPendingReturnConfirmation: () => !!returnConfirmation && returnConfirmation.expiresAt > wall(),
    getPersonalityContext: (text) => JSON.stringify(personality(text)),
    acceptPersonalityTurn(text, sessionId) { acceptPersonalityTurn(text, sessionId); emit(); },
    notePersonalitySpeech(text, sessionId) {
      if (disposed || !sessionId || state.sessionId && state.sessionId !== sessionId) return;
      companion.notePersonalitySpeech(text, sessionId); emit();
    },
    noteFriendlyStroke() {
      if (disposed || settings.mode !== "active" || !environment.foreground || !environment.focused || environment.sleeping
        || environment.userSpeaking || environment.assistantSpeaking || environment.motionActive || state.repairRequired) return null;
      const life = companion.noteFriendlyStroke(); emit();
      return { durationMs: state.style.conversationTone === "calm" || life.energy === "quiet" ? 900
        : life.familiarity === "at_ease" ? 1450 : life.familiarity === "familiar" ? 1300 : 1100 };
    },
    getConversationContext() {
      expireState();
      if (!state.sessionId) return "";
      const character = personality();
      if (settings.mode !== "active") return character.life || character.tone !== "default" || character.familiarInterests.length || character.interestOverview || character.developingInterest || character.conversationMoment || character.greetingInterest
        ? JSON.stringify({ personality: character }) : "";
      const content: Record<string, unknown> = { personality: character };
      content.physicalState = {
        transportConnected: environment.connected,
        motionActive: environment.motionActive,
        instruction: "These are local transport and motion signals; the transport may be simulated. They do not prove physical hardware is connected, that movement is available, or that the robot can perceive its surroundings. Explain a relevant limitation plainly; never claim a movement happened without confirmation.",
      };
      if (interruptedReply) content.interruptedReply = "The previous spoken reply was interrupted. Respond to the person's current words first. Do not assume that the unheard part was delivered or repeat a long answer unless asked.";
      if (state.style.conversationTone !== "default") content.conversationStyle = state.style.conversationTone === "calm"
        ? "The person explicitly prefers a calmer manner. Speak gently and naturally, with less exuberance; keep useful answers and adapt to the current situation."
        : "The person explicitly prefers a livelier, more playful manner. Be warm and curious, react to the actual conversation, and vary your wording; stay restrained when the situation calls for it.";
      if (returnConfirmation && returnConfirmation.expiresAt > wall()) content.returnQuestion = returnConfirmation.heard
        ? "The return question was heard. Wait for the person's answer; do not resume until it is confirmed locally."
        : `Ask exactly once: ${returnConfirmation.question} Wait for the answer; do not resume the task yet.`;
      if (state.objectReference) content.selectedObjectReference = {
        episodeId: state.objectReference.episodeId, title: state.objectReference.title,
        source: "user_selected_region",
        instruction: "The user explicitly associated the locally selected image region with this activity. This is a temporary user-provided reference, not visual recognition or a new image. Do not infer identity, appearance, position in meters, progress or outcome from it. Request a current allowed image when visual details are needed.",
      };
      if (state.pendingIntention) content.pendingTask = { goal: state.pendingIntention.goal, status: state.pendingIntention.status, lastConfirmedStep: state.pendingIntention.lastConfirmedStep,
        ...(state.pendingIntention.activity ? { activity: state.pendingIntention.activity } : {}),
        instruction: gameOngoing()
          ? "The local number game has current focus. Keep this separate task unchanged; do not resume it or advance its milestones. Return to it only after the user stops the game and explicitly asks about the named task."
          : state.pendingIntention.activity
          ? "A shared object trial uses only confirmed milestones. Use manage_shared_activity from the exact current user request. Speak its pending.question exactly once, then wait for confirmation; never invent progress or an outcome. Checking/preparation are user reports, not live perception. waiting_for_start still requires the existing explicitly armed ritual and fresh scene readiness; never open the camera yourself. awaiting_result means only the agreed signal was accepted, not a physical launch. A paused task needs an explicit named resume proposal and heard confirmation. Confirmed results are task state, not a new durable episode. Do not repeat unanswered questions or restart signals automatically."
          : "Resume only when the current user turn asks for it; clarify an ambiguous reference." };
      if (state.game) content.numberGame = { range: "1–3", status: state.game.status, attemptsLeft: state.game.attemptsLeft, lastOutcome: state.game.lastOutcome, instruction: state.game.status === "active" ? "Invite one guess, or state higher/lower from the local outcome. Do not invent success or reveal the secret." : state.game.status === "paused" ? "The local number game is paused. Wait; do not invite or process a guess. Resume only after the user explicitly asks to continue." : state.game.status === "stopped" ? "The game is closed. Acknowledge its end only when relevant to the current turn and let the user change topic. Do not invite another guess or restart without an explicit new game request." : "Briefly acknowledge the local game's outcome only when relevant to the current turn." };
      if (state.repairRequired) content.referenceRepair = "The user corrected the previous reference; acknowledge and clarify instead of repeating the old assumption.";
      if (state.visualAdvice) content.requestedImage = { action: state.visualAdvice.action, instruction: "Ask for clearer framing/light if action is ask_reposition or wait; never guess unreadable content." };
      const companionContext = companion.context(latestText).companion as Record<string, unknown>;
      content.companion = { ...companionContext, enabled: true, curiosityEnabled: settings.curiosityEnabled === true && settings.visualEnabled };
      // Drop optional episode candidates before required confirmation/task context;
      // never truncate a JSON string in the middle of a field.
      const episodes = (content.companion as { episodes?: unknown[] }).episodes;
      while (JSON.stringify(content).length > 8_000 && episodes?.length) episodes.pop();
      return JSON.stringify(content);
    },
    serialize() {
      renewDay();
      const task = state.pendingIntention;
      const activity = task?.activity ? restoreSharedActivity(task.activity, wall()) : null;
      const pendingIntention = task?.activity ? activity ? { ...task, activity, status: "paused", waitingFor: "user_return" } : null : task;
      return JSON.stringify({ version: 1, dayKey, daySpent, metrics: { ...state.metrics, reservedUsd: 0 }, style: state.style, pendingIntention, lastGreetingAt, ritualCount, recentCues, lastCueAt, companion: companion.serialize() });
    },
    restore(serialized) {
      // Eight bounded episodes can each include evidence/corrections; character
      // history adds at most 32 days with eight bounded episode IDs each.
      if (!serialized || serialized.length > 80_000) return;
      try {
        const value = JSON.parse(serialized);
        if (value.version !== 1) return;
        invalidate("restore");
        cancelCompanion(); companion.restore(value.companion);
        if (value.dayKey === localDay()) { dayKey = value.dayKey; daySpent = finite(value.daySpent); }
        if (value.metrics && typeof value.metrics === "object") for (const key of Object.keys(emptyMetrics()) as Array<keyof typeof state.metrics>) {
          if (key !== "lastLatencyMs") state.metrics[key] = finite(value.metrics[key]);
        }
        state.metrics.reservedUsd = 0;
        if (value.style) {
          const tone = value.style.conversationTone === "calm" || value.style.conversationTone === "playful" || value.style.conversationTone === "default"
            ? value.style.conversationTone : value.style.livelyWhenPlayful === true ? "playful" : "default";
          state.style = { version: finite(value.style.version), scope: "device", suppressNod: value.style.suppressNod === true,
            livelyWhenPlayful: tone === "playful", conversationTone: tone,
            greetingRitual: value.style.greetingRitualSource === "explicit_user_request" && ["nod", "curious", "happy_bob", "off"].includes(value.style.greetingRitual) ? value.style.greetingRitual : null,
            greetingRitualSource: value.style.greetingRitualSource === "explicit_user_request" ? "explicit_user_request" : null, maxCuesPerTurn: 1, updatedAt: finite(value.style.updatedAt, wall()) };
        }
        const intent = value.pendingIntention;
        state.pendingIntention = null;
        if (intent?.source === "explicit_user_request" && bounded(intent.goal) && finite(intent.expiresAt) > wall()) {
          const activity = intent.activity ? restoreSharedActivity(intent.activity, wall()) : null;
          if (!intent.activity || activity && companion.snapshot().episodes.some((episode) => episode.id === activity.episodeId && episode.title === activity.title))
            state.pendingIntention = { id: bounded(intent.id, 80), goal: bounded(intent.goal), source: "explicit_user_request", status: "paused", waitingFor: "user_return", lastConfirmedStep: activity ? activity.confirmed.at(-1)?.detail ?? null : bounded(intent.lastConfirmedStep) || null, createdAt: finite(intent.createdAt, wall()), updatedAt: finite(intent.updatedAt, wall()), expiresAt: Math.min(intent.expiresAt, wall() + INTENTION_RETENTION_MS), version: finite(intent.version), ...(activity ? { activity } : {}) };
        }
        lastGreetingAt = Math.min(finite(value.lastGreetingAt), wall()); ritualCount = finite(value.ritualCount);
        recentCues = Array.isArray(value.recentCues) ? value.recentCues.filter((cue: BehaviorGesture) => GESTURES.has(cue)).slice(-8) : [];
        lastCueAt = typeof value.lastCueAt === "number" && Number.isFinite(value.lastCueAt) && value.lastCueAt >= 0 ? Math.min(value.lastCueAt, wall()) : null;
        emit();
      } catch { /* Invalid local state cannot activate a task or movement. */ }
    },
    resetLearning() { invalidate("clear-learning"); cancelCompanion(); companion.reset(); returnConfirmation = null; state.style = { version: state.style.version + 1, scope: "device", suppressNod: false, livelyWhenPlayful: false, conversationTone: "default", greetingRitual: null, greetingRitualSource: null, maxCuesPerTurn: 1, updatedAt: wall() }; state.pendingIntention = null; state.game = null; state.visualAdvice = null; state.repairRequired = false; previousTopic = ""; latestText = ""; latestAssistantText = ""; recentCues = []; lastCueAt = null; lastGreetingAt = 0; ritualCount = 0; moment("settled"); emit(); },
    dispose() { invalidate("disposed"); cancelCompanion(); disposed = true; listeners.clear(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return engine;
}
