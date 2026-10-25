import type { DecisionAnswer, DecisionResult } from "../openai/decisions";
import type { BehaviorCue, BehaviorEngine, BehaviorEngineDependencies, BehaviorEnvironment, BehaviorEvent, BehaviorFace, BehaviorGesture, BehaviorSettings, BehaviorState, BehaviorTrace } from "./behavior-types";
import { buildBehaviorQuestions, interpretBehaviorText } from "./behavior-policy";

const MAX_TEXT = 600;
const RESERVATION_USD = 0.003;
const GESTURES = new Set<BehaviorGesture>(["hold", "curious", "thinking", "happy_bob", "nod", "speaking_soft"]);
const emptyMetrics = () => ({ requests: 0, completed: 0, failed: 0, timedOut: 0, stale: 0, budgetSkipped: 0, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, reservedUsd: 0, lastLatencyMs: null as number | null });
const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const bounded = (value: unknown, max = MAX_TEXT) => typeof value === "string" ? value.trim().slice(0, max) : "";
type Work = { kind: string; text: string; image?: string; resolve?: (advice: string) => void; deadline: number; generation: number; session: string | null };

/** Owns semantic state and asynchronous decisions; all physical effects use one injected seam. */
export function createBehaviorEngine(deps: BehaviorEngineDependencies): BehaviorEngine {
  const now = deps.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  const wall = deps.wallNow ?? Date.now;
  let settings: BehaviorSettings = { mode: "off", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: true };
  let environment: BehaviorEnvironment = { foreground: false, focused: false, sleeping: false, connected: false, ambientEnabled: false, cameraEnabled: false, userSpeaking: false, assistantSpeaking: false, motionActive: false };
  let state: BehaviorState = {
    sessionId: null, turnId: 0, lifecycleGeneration: 0, preferenceVersion: 0, referenceVersion: 0,
    posture: "settle", postureSince: now(), attentionPolicy: "keep_target", selectedFaceId: null, lastFaceSeenAt: null,
    pendingIntention: null, game: null, style: { version: 0, scope: "device", suppressNod: false, livelyWhenPlayful: false, greetingRitual: null, greetingRitualSource: null, maxCuesPerTurn: 1, updatedAt: wall() },
    visualAdvice: null, repairRequired: false, metrics: emptyMetrics(), traces: [],
  };
  const listeners = new Set<(value: BehaviorState) => void>();
  let faces: BehaviorFace[] = [];
  let faceMembership = "";
  let latestText = "";
  let previousTopic = "";
  let lastGreetingAt = 0;
  let ritualCount = 0;
  let recentCues: BehaviorGesture[] = [];
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
    state = { ...state, metrics: { ...state.metrics }, style: { ...state.style }, traces: [...state.traces] };
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
    if (state.pendingIntention && state.pendingIntention.expiresAt <= wall()) state.pendingIntention = null;
    if (state.game?.status === "active" && wall() - state.game.updatedAt > 300_000) state.game = { ...state.game, status: "expired" };
  }
  function context(work: Work): Record<string, unknown> {
    return { eventType: work.kind, sessionId: state.sessionId, turnId: state.turnId, lifecycleGeneration: state.lifecycleGeneration, preferenceVersion: state.preferenceVersion, referenceVersion: state.referenceVersion,
      recentUserText: work.text, conversation: { userSpeaking: environment.userSpeaking, assistantSpeaking: environment.assistantSpeaking },
      posture: state.posture, pendingIntention: state.pendingIntention, style: state.style, game: state.game ? { status: state.game.status, outcome: state.game.lastOutcome } : null,
      faceCandidates: environment.cameraEnabled ? faces : [], selectedFaceId: state.selectedFaceId, faceAgeMs: state.lastFaceSeenAt === null ? null : Math.max(0, now() - state.lastFaceSeenAt),
      recentCues, robot: { connected: environment.connected, motionActive: environment.motionActive, ambientEnabled: environment.ambientEnabled },
      ...(work.image ? { task: work.text } : {}), instruction: "Sensor absence is unknown, not proof of emotion or intent. Select only a currently supplied candidate; hold on uncertainty. Do not change an explicit preference or invent identity." };
  }
  function queue(kind: string, text = latestText, image?: string, resolve?: (advice: string) => void) {
    const work: Work = { kind, text: bounded(text), image, resolve, deadline: now() + (image ? Math.min(2_000, deps.decisionTimeoutMs ?? 1_800) : 800), generation: state.lifecycleGeneration, session: state.sessionId };
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
    if (state.pendingIntention && choice(answers, "intention") === "offer_resume") state.pendingIntention = { ...state.pendingIntention, status: "needs_clarification", waitingFor: "clarification" };
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
      if (gesture !== "hold") gesture = state.style.greetingRitual ?? (ritualCount % 2 ? "curious" : "happy_bob");
    }
    if (state.style.suppressNod && gesture === "nod") gesture = "hold";
    if (state.style.livelyWhenPlayful && textIntent.playful && gesture === "curious") gesture = "happy_bob";
    if (recentCues.length >= 2 && recentCues.slice(-2).every((value) => value === gesture)) gesture = "hold";
    if (issuedTurn === state.turnId && gesture !== "hold") gesture = "hold";
    state.posture = gesture === "thinking" ? "reflect" : work.kind === "assistant-end" ? "yield" : gesture === "hold" ? "attend" : "settle";
    state.postureSince = now();
    const cue: BehaviorCue = { id: `cue-${++serial}`, gesture, posture: state.posture, mood: gesture === "happy_bob" ? "pleased" : gesture === "curious" ? "startled" : null, expiresAt: work.deadline, generation: state.lifecycleGeneration,
      ...(gesture === "thinking" ? { gaze: { x: 0, y: 0.25 } } : {}) };
    state.cue = cue;
    if (settings.mode === "active" && valid(work)) {
      if (gesture !== "hold") { issuedTurn = state.turnId; recentCues = [...recentCues, gesture].slice(-8); }
      try { void Promise.resolve(deps.executeCue(cue)).catch(() => { trace("cue-cancelled"); emit(); }); } catch { trace("cue-cancelled"); }
    }
  }
  function pause(goal = previousTopic) {
    if (!goal && !state.pendingIntention) return;
    const existing = state.pendingIntention;
    state.pendingIntention = { id: existing?.id ?? `intent-${++serial}`, goal: bounded(existing?.goal ?? goal), source: "explicit_user_request", status: "paused", lastConfirmedStep: existing?.lastConfirmedStep ?? null, waitingFor: "user_return", createdAt: existing?.createdAt ?? wall(), updatedAt: wall(), expiresAt: wall() + 86_400_000, version: (existing?.version ?? 0) + 1 };
    state.attentionPolicy = "release";
  }
  function startGame() {
    state.game = { kind: "guess_number", status: "active", secretAnswer: ((state.turnId % 3) + 1) as 1 | 2 | 3, attemptsLeft: 3, round: (state.game?.round ?? 0) + 1, startedAt: wall(), updatedAt: wall(), lastOutcome: "waiting" };
  }
  function userTurn(text: string) {
    const intent = interpretBehaviorText(text);
    if (intent.style) state.style = { ...state.style, version: state.style.version + 1, suppressNod: intent.style === "less_nod" ? true : state.style.suppressNod, livelyWhenPlayful: intent.style === "lively_playful" ? true : state.style.livelyWhenPlayful, updatedAt: wall() };
    if (intent.greetingRitual) state.style = { ...state.style, version: state.style.version + 1, greetingRitual: intent.greetingRitual, greetingRitualSource: "explicit_user_request", updatedAt: wall() };
    if (intent.correction) { state.referenceVersion += 1; state.repairRequired = true; state.attentionPolicy = "release"; state.selectedFaceId = null; }
    else state.repairRequired = false;
    if (intent.drop) { state.pendingIntention = null; state.attentionPolicy = "release"; }
    else if (intent.pause) pause();
    else if (intent.resume && state.pendingIntention) { state.pendingIntention = { ...state.pendingIntention, status: "active", waitingFor: "user_reply", updatedAt: wall(), version: state.pendingIntention.version + 1 }; state.attentionPolicy = "keep_target"; }
    if (intent.gameStop && state.game) state.game = { ...state.game, status: "stopped", lastOutcome: "stopped", updatedAt: wall() };
    else if (intent.gameStart) startGame();
    else if (state.game?.status === "active" && intent.guess) {
      const game = state.game; const correct = game.secretAnswer === intent.guess;
      state.game = { ...game, attemptsLeft: game.attemptsLeft - 1, updatedAt: wall(), status: correct ? "won" : game.attemptsLeft <= 1 ? "stopped" : "active", lastOutcome: correct ? "correct" : intent.guess < game.secretAnswer ? "too_low" : "too_high" };
    }
    if (!intent.pause && !intent.resume && !intent.drop && !intent.greeting && !intent.style && !intent.greetingRitual && !intent.gameStart && !intent.gameStop) previousTopic = bounded(text);
    latestText = bounded(text);
  }
  const engine: BehaviorEngine = {
    configure(next) {
      const normalized: BehaviorSettings = { mode: next.mode === "active" || next.mode === "shadow" ? next.mode : "off", dailyBudgetUsd: Math.max(0, Math.min(10, finite(next.dailyBudgetUsd, 1))), visualEnabled: next.visualEnabled === true, candidateScoring: next.candidateScoring === true };
      if (JSON.stringify(settings) === JSON.stringify(normalized)) return;
      invalidate("configuration"); settings = normalized; state.preferenceVersion += 1; emit();
    },
    setEnvironment(next) {
      const before = environment;
      environment = { ...environment, ...next };
      const unsafe = !environment.foreground || !environment.focused || environment.sleeping || environment.userSpeaking || environment.motionActive;
      const wasUnsafe = !before.foreground || !before.focused || before.sleeping || before.userSpeaking || before.motionActive;
      if (unsafe && !wasUnsafe) invalidate("environment");
      if (before.cameraEnabled && !environment.cameraEnabled) { faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; }
      emit();
    },
    dispatch(event) {
      if (disposed) return;
      if ("sessionId" in event && event.sessionId && event.type !== "session-start" && event.sessionId !== state.sessionId) return;
      if (settings.mode === "off" && !["session-start", "session-end", "interrupt"].includes(event.type)) return;
      expireState();
      switch (event.type) {
        case "session-start": invalidate("session-start"); state.sessionId = event.sessionId; state.turnId = 0; issuedTurn = -1; state.visualAdvice = null; latestText = ""; previousTopic = ""; faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; break;
        case "session-end": invalidate("session-end"); state.sessionId = null; state.posture = "settle"; state.game = null; faces = []; faceMembership = ""; state.selectedFaceId = null; state.lastFaceSeenAt = null; break;
        case "user-speech-start": invalidate("user-speaking"); environment.userSpeaking = true; state.posture = "attend"; break;
        case "user-speech-end": environment.userSpeaking = false; break;
        case "user-turn": invalidate("new-turn"); state.turnId += 1; issuedTurn = -1; state.visualAdvice = null; userTurn(event.text); queue("user-turn", event.text); break;
        case "assistant-start": environment.assistantSpeaking = true; break;
        case "assistant-end": environment.assistantSpeaking = false; invalidate("audible-turn-end"); state.posture = "yield"; queue("assistant-end"); break;
        case "interrupt": invalidate(event.reason); state.posture = "attend";
          if (/stop|cliff|sleep|disconnect/i.test(event.reason) && state.game?.status === "active") state.game = { ...state.game, status: "stopped", lastOutcome: "stopped", updatedAt: wall() };
          break;
        case "faces": {
          if (!environment.cameraEnabled) break;
          const nextFaces = event.faces.filter((face) => bounded(face.id, 80) && [face.centerX, face.centerY, face.width, face.height].every(Number.isFinite) && face.centerX >= 0 && face.centerX <= 1 && face.centerY >= 0 && face.centerY <= 1 && face.width > 0 && face.height > 0).slice(0, 8).map((face) => ({ ...face, id: face.id.slice(0, 80) }));
          const membership = nextFaces.map((face) => face.id).sort().join("|");
          faces = nextFaces; state.lastFaceSeenAt = faces.length ? now() : null;
          if (!faces.some((face) => face.id === state.selectedFaceId)) state.selectedFaceId = [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0]?.id ?? null;
          if (membership !== faceMembership) { faceMembership = membership; if (faces.length > 1 || !faces.length) queue("faces"); }
          break;
        }
        case "visual": if (settings.visualEnabled) queue("visual", event.taskText, event.imageDataUrl); break;
        case "game-command": invalidate("game-command"); if (event.action === "start") startGame(); else if (state.game) state.game = { ...state.game, status: "stopped", lastOutcome: "stopped", updatedAt: wall() }; break;
        case "correction": invalidate("correction"); state.referenceVersion += 1; state.repairRequired = true; state.attentionPolicy = "release"; state.selectedFaceId = null; if (event.correctedReference) previousTopic = bounded(event.correctedReference); break;
        case "intention": invalidate("intention"); if (event.action === "pause") pause(event.goal); else if (event.action === "drop") state.pendingIntention = null; else if (state.pendingIntention) state.pendingIntention = { ...state.pendingIntention, status: "active", waitingFor: "user_reply", updatedAt: wall(), version: state.pendingIntention.version + 1 }; break;
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
    getState: () => state,
    getConversationContext() {
      expireState();
      if (settings.mode !== "active" || !state.sessionId) return "";
      const content: Record<string, unknown> = {};
      if (state.pendingIntention) content.pendingTask = { goal: state.pendingIntention.goal, status: state.pendingIntention.status, lastConfirmedStep: state.pendingIntention.lastConfirmedStep, instruction: "Resume only when the current user turn asks for it; clarify an ambiguous reference." };
      if (state.game) content.numberGame = { range: "1–3", status: state.game.status, attemptsLeft: state.game.attemptsLeft, lastOutcome: state.game.lastOutcome, instruction: state.game.status === "active" ? "Invite one guess, or state higher/lower from the local outcome. Do not invent success or reveal the secret." : "Briefly acknowledge the local game's outcome." };
      if (state.repairRequired) content.referenceRepair = "The user corrected the previous reference; acknowledge and clarify instead of repeating the old assumption.";
      if (state.visualAdvice) content.requestedImage = { action: state.visualAdvice.action, instruction: "Ask for clearer framing/light if action is ask_reposition or wait; never guess unreadable content." };
      return Object.keys(content).length ? JSON.stringify(content).slice(0, 2200) : "";
    },
    serialize() {
      renewDay();
      return JSON.stringify({ version: 1, dayKey, daySpent, metrics: { ...state.metrics, reservedUsd: 0 }, style: state.style, pendingIntention: state.pendingIntention, lastGreetingAt, ritualCount, recentCues });
    },
    restore(serialized) {
      if (!serialized || serialized.length > 30_000) return;
      try {
        const value = JSON.parse(serialized);
        if (value.version !== 1) return;
        invalidate("restore");
        if (value.dayKey === localDay()) { dayKey = value.dayKey; daySpent = finite(value.daySpent); }
        if (value.metrics && typeof value.metrics === "object") for (const key of Object.keys(emptyMetrics()) as Array<keyof typeof state.metrics>) {
          if (key !== "lastLatencyMs") state.metrics[key] = finite(value.metrics[key]);
        }
        state.metrics.reservedUsd = 0;
        if (value.style) state.style = { version: finite(value.style.version), scope: "device", suppressNod: value.style.suppressNod === true, livelyWhenPlayful: value.style.livelyWhenPlayful === true,
          greetingRitual: value.style.greetingRitualSource === "explicit_user_request" && ["nod", "curious", "happy_bob", "off"].includes(value.style.greetingRitual) ? value.style.greetingRitual : null,
          greetingRitualSource: value.style.greetingRitualSource === "explicit_user_request" ? "explicit_user_request" : null, maxCuesPerTurn: 1, updatedAt: finite(value.style.updatedAt, wall()) };
        const intent = value.pendingIntention;
        if (intent?.source === "explicit_user_request" && bounded(intent.goal) && finite(intent.expiresAt) > wall()) state.pendingIntention = { id: bounded(intent.id, 80), goal: bounded(intent.goal), source: "explicit_user_request", status: "paused", waitingFor: "user_return", lastConfirmedStep: bounded(intent.lastConfirmedStep) || null, createdAt: finite(intent.createdAt, wall()), updatedAt: finite(intent.updatedAt, wall()), expiresAt: Math.min(intent.expiresAt, wall() + 86_400_000), version: finite(intent.version) };
        lastGreetingAt = Math.min(finite(value.lastGreetingAt), wall()); ritualCount = finite(value.ritualCount);
        recentCues = Array.isArray(value.recentCues) ? value.recentCues.filter((cue: BehaviorGesture) => GESTURES.has(cue)).slice(-8) : [];
        emit();
      } catch { /* Invalid local state cannot activate a task or movement. */ }
    },
    resetLearning() { invalidate("clear-learning"); state.style = { version: state.style.version + 1, scope: "device", suppressNod: false, livelyWhenPlayful: false, greetingRitual: null, greetingRitualSource: null, maxCuesPerTurn: 1, updatedAt: wall() }; state.pendingIntention = null; state.game = null; state.visualAdvice = null; state.repairRequired = false; previousTopic = ""; latestText = ""; recentCues = []; lastGreetingAt = 0; ritualCount = 0; emit(); },
    dispose() { invalidate("disposed"); disposed = true; listeners.clear(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return engine;
}
