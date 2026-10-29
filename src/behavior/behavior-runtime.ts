import { AccessibilityInfo, AppState } from "react-native";
import { create } from "zustand";
import { createMMKV } from "react-native-mmkv";
import { createBehaviorEngine } from "./behavior-engine";
import { runBehaviorExpression, type BehaviorExpressionPhase } from "./behavior-expression";
import { createRepairFeedbackTracker, type BehaviorFaceFeedback } from "./behavior-face-feedback";
import { createGameFaceFeedbackTracker, type GameFaceFeedback } from "./game-face-feedback";
import { createListeningOpportunityDetector, type ListeningAudioFrame } from "./listening-opportunity";
import type { BehaviorCue, BehaviorSettings, BehaviorState } from "./behavior-types";
import type { CharacterMood } from "../character/character-reaction";
import { runLocalMemoryMutation } from "../memory/memory-mutation";
import { registerBehaviorAdapter, refreshBehaviorContext, requestBehaviorSignalResponse } from "./behavior-events";
import { requestDecisions } from "../openai/decisions";
import { useUserStore } from "../store/user";
import { useConversationStore } from "../store/conversation";
import { isMainScreenFocused, subscribeMainScreenFocused } from "../core/main-screen-presence";
import { configureAmbientBehaviorPolicy, holdAmbientMotionFor, holdAmbientHeadMotionFor } from "../core/ambient-motion";
import { configureSocialBehaviorPolicy, getSocialAttentionControllerState, holdSocialAttentionMotionFor, setSocialInteractionSignalRequest } from "../core/social-attention";
import { createInteractionStartSignalDetector, type InteractionSignalFrame } from "../core/interaction-start-signal";
import { cancelLooiHeadMotion, getLooiRobotRuntimeState, performLooiBehaviorHeadGesture, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { clearCharacterReaction, triggerCharacterReaction, useCharacterReactionStore } from "../character/character-reaction";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";

const storage = createMMKV({ id: "looi.behavior.v1" });
const SETTINGS_KEY = "settings";
const STATE_KEY = "state";
const defaults: BehaviorSettings = { mode: "active", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: true, curiosityEnabled: false };
function readSettings(): BehaviorSettings {
  try {
    const value = JSON.parse(storage.getString(SETTINGS_KEY) ?? "{}");
    return { mode: value.mode === "active" || value.mode === "shadow" || value.mode === "off" ? value.mode : defaults.mode, dailyBudgetUsd: [0.25, 1, 3].includes(value.dailyBudgetUsd) ? value.dailyBudgetUsd : defaults.dailyBudgetUsd, visualEnabled: value.visualEnabled === true, candidateScoring: value.candidateScoring !== false, curiosityEnabled: value.curiosityEnabled === true };
  } catch { return { ...defaults }; }
}
const monotonicNow = () => typeof performance !== "undefined" ? performance.now() : Date.now();
let installed = false;
let uninstalls: Array<() => void> = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let facePoll: ReturnType<typeof setInterval> | null = null;
let activeCueId: string | null = null;
let activeExpression: AbortController | null = null;
let expressionReducedMotion = false;
let motionPreferenceGeneration = 0;
let behaviorReactionId: number | null = null;
let priorPreferenceKey = "";
let lastStopGeneration = 0;
let lastSavedState = "";
let lastScheduledState = "";
const startSignalDetector = createInteractionStartSignalDetector(monotonicNow);
let armedHandScene: string | null = null;
const repairFeedbackTracker = createRepairFeedbackTracker();
const gameFeedbackTracker = createGameFaceFeedbackTracker();
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
const listeningDetector = createListeningOpportunityDetector();
let listeningTimer: ReturnType<typeof setTimeout> | null = null;

function clearListeningFeedback(): void {
  listeningDetector.reset();
  if (listeningTimer) clearTimeout(listeningTimer);
  listeningTimer = null;
  if (useBehaviorStore.getState().presentation?.id.startsWith("listening-")) useBehaviorStore.setState({ presentation: null });
}

function listeningFeedbackAllowed(state: BehaviorState): boolean {
  const conversation = useConversationStore.getState();
  const user = useUserStore.getState();
  return installed && useBehaviorStore.getState().settings.mode === "active" && !!state.sessionId && !expressionReducedMotion
    && AppState.currentState === "active" && isMainScreenFocused() && !user.robotSleeping
    && conversation.isUserSpeaking && !conversation.isSpeaking && !conversation.isProcessing && user.voiceState !== "speaking"
    && state.moment.phase === "attending" && !state.repairRequired && !behaviorEngine.hasPendingReturnConfirmation()
    && !state.companion.pendingExperience && state.companion.scene.status !== "armed"
    && !state.pendingIntention?.activity?.pending && state.game?.status !== "active" && state.game?.status !== "paused"
    && !activeCueId && !useBehaviorStore.getState().feedback && !useCharacterReactionStore.getState().mood
    && !getSocialAttentionControllerState().objectAttentionActive
    && !isDrivingControlSessionActive() && !getLooiRobotRuntimeState().motionActive;
}

function handleListeningFrame(frame: ListeningAudioFrame): void {
  const state = behaviorEngine.getState();
  if (frame.sessionId !== state.sessionId || !listeningFeedbackAllowed(state)) { clearListeningFeedback(); return; }
  if (!listeningDetector.frame(frame, monotonicNow())) return;
  const id = `listening-${frame.revision}-${frame.sequence}`;
  useBehaviorStore.setState({ presentation: { id, generation: state.lifecycleGeneration,
    gesture: "hold", posture: "attend", mood: "listening", expiresAt: monotonicNow() + 600, presentationOnly: true } });
  if (listeningTimer) clearTimeout(listeningTimer);
  listeningTimer = setTimeout(() => {
    listeningTimer = null;
    if (useBehaviorStore.getState().presentation?.id !== id) return;
    useBehaviorStore.setState({ presentation: null });
    syncMomentPresentation(behaviorEngine.getState());
  }, 600);
}
const REACTION_CLEARING_STOP_REASONS = new Set([
  "explicit", "manual-stop", "explicit-stop", "explicit-voice-stop", "realtime-pcm-explicit-stop",
  "driving-local-stop", "driving-tap-stop", "debug-panel-stop",
  "voice-emergency-kws", "voice-emergency-transcript", "realtime-pcm-emergency-transcript",
  "cliff", "obstacle", "native-recognizer-failed", "continuous-lease-expired", "continuous-deadman-timeout",
]);

function shouldClearUnownedReactionForStop(reason: string | null | undefined): boolean {
  return typeof reason === "string" && REACTION_CLEARING_STOP_REASONS.has(reason);
}

function handSignalAllowed(state: BehaviorState): boolean {
  const user = useUserStore.getState();
  const conversation = useConversationStore.getState();
  return installed && useBehaviorStore.getState().settings.mode === "active" && !!state.sessionId
    && state.companion.scene?.status === "armed" && state.companion.scene.signal === "open_palm"
    && AppState.currentState === "active" && isMainScreenFocused() && !user.robotSleeping
    && user.preferences.cameraAttentionEnabled && !conversation.isUserSpeaking && !conversation.isSpeaking && !conversation.isProcessing
    && state.game?.status !== "active" && state.game?.status !== "paused"
    && !isDrivingControlSessionActive() && !getLooiRobotRuntimeState().motionActive && activeCueId === null;
}

function syncHandSignalRequest(state: BehaviorState): void {
  const sceneId = handSignalAllowed(state) ? state.companion.scene.id : null;
  if (armedHandScene === sceneId) return;
  armedHandScene = sceneId;
  startSignalDetector.reset();
  if (sceneId) startSignalDetector.arm(sceneId);
  if (typeof setSocialInteractionSignalRequest === "function") setSocialInteractionSignalRequest(sceneId ? handleInteractionSignalFrame : null);
}

function handleInteractionSignalFrame(frame: InteractionSignalFrame): void {
  const state = behaviorEngine.getState();
  if (!handSignalAllowed(state)) { startSignalDetector.reset(); syncHandSignalRequest(state); return; }
  if (!startSignalDetector.frame(frame)) return;
  const scene = state.companion.scene;
  const sessionId = state.sessionId;
  if (!scene.id || !scene.episodeTitle || !sessionId || !behaviorEngine.acceptStartSignal("open_palm")) return;
  const accepted = typeof requestBehaviorSignalResponse === "function" && requestBehaviorSignalResponse({ kind: "shared-countdown", id: scene.id, episodeTitle: scene.episodeTitle }, sessionId);
  if (!accepted) behaviorEngine.dispatch({ type: "interrupt", reason: "start-signal-response-unavailable", sessionId });
}

export const behaviorEngine = createBehaviorEngine({
  decide: (input, options) => requestDecisions(input, options),
  executeCue,
  now: monotonicNow,
  wallNow: Date.now,
  decisionTimeoutMs: 1_800,
  traceLimit: 80,
});
try { const stored = storage.getString(STATE_KEY); if (stored) { behaviorEngine.restore(stored); lastSavedState = stored; } } catch {}

type BehaviorPresentation = Omit<BehaviorCue, "mood"> & { mood: CharacterMood | null; expressionPhase?: BehaviorExpressionPhase };

export const useBehaviorStore = create<{
  settings: BehaviorSettings;
  state: BehaviorState;
  presentation: BehaviorPresentation | null;
  feedback: BehaviorFaceFeedback | GameFaceFeedback | null;
}>(() => ({ settings: readSettings(), state: behaviorEngine.getState(), presentation: null, feedback: null }));
behaviorEngine.configure(useBehaviorStore.getState().settings);

function saveState(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  try {
    const serialized = behaviorEngine.serialize();
    if (serialized !== lastSavedState) { storage.set(STATE_KEY, serialized); lastSavedState = serialized; }
  } catch {}
}
function schedulePersist(): void {
  const serialized = behaviorEngine.serialize();
  if (serialized === lastScheduledState) return;
  lastScheduledState = serialized;
  if (persistTimer) return;
  persistTimer = setTimeout(saveState, 750);
}
function clearCue(reason: string, clearUnownedReaction = false, preserveFeedback = false): void {
  clearListeningFeedback();
  const owned = activeCueId !== null;
  activeExpression?.abort(); activeExpression = null;
  activeCueId = null;
  if (!preserveFeedback) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  useBehaviorStore.setState({ presentation: null, ...(!preserveFeedback ? { feedback: null } : {}) });
  if (owned) cancelLooiHeadMotion(reason, "behavior");
  const reaction = useCharacterReactionStore.getState();
  const behaviorOwnsReaction = behaviorReactionId !== null && reaction.reactionId === behaviorReactionId;
  const stopClearsCurrentReaction = clearUnownedReaction && reaction.mood !== null;
  // STOP may clear a visual reaction started by any source, but only the
  // reaction that was current at this synchronous check. Ordinary cue cleanup
  // remains limited to behavior-owned accents.
  if (behaviorOwnsReaction || stopClearsCurrentReaction) {
    const expectedReactionId = reaction.reactionId;
    if (useCharacterReactionStore.getState().reactionId === expectedReactionId) clearCharacterReaction(reason);
  }
  behaviorReactionId = null;
}

export function updateBehaviorSettings(patch: Partial<BehaviorSettings>): void {
  repairFeedbackTracker.reset();
  gameFeedbackTracker.reset();
  const current = useBehaviorStore.getState().settings;
  const next: BehaviorSettings = { ...current, ...patch };
  if (!["off", "shadow", "active"].includes(next.mode)) next.mode = "off";
  if (![0.25, 1, 3].includes(next.dailyBudgetUsd)) next.dailyBudgetUsd = 1;
  next.visualEnabled = next.visualEnabled === true;
  next.candidateScoring = next.candidateScoring !== false;
  next.curiosityEnabled = next.curiosityEnabled === true;
  storage.set(SETTINGS_KEY, JSON.stringify(next));
  clearCue("behavior-settings");
  useBehaviorStore.setState({ settings: next });
  behaviorEngine.configure(next);
  useBehaviorStore.setState({ state: behaviorEngine.getState() });
  refreshEnvironment();
  refreshBehaviorContext();
  saveState();
}

async function prepareCompanionMemoryChange(): Promise<void> {
  const { stopConversationForMemoryChange } = await import("../memory/memory-service");
  await stopConversationForMemoryChange();
}

export async function forgetBehaviorExperience(id: string): Promise<void> {
  await runLocalMemoryMutation(prepareCompanionMemoryChange, async () => {
    clearCue("experience-forgotten");
    behaviorEngine.forgetExperience(id);
    useBehaviorStore.setState({ state: behaviorEngine.getState() });
    refreshBehaviorContext(); saveState();
  });
}

export async function disableBehaviorPersonalRitual(id: string): Promise<void> {
  await runLocalMemoryMutation(prepareCompanionMemoryChange, async () => {
    clearCue("personal-ritual-disabled");
    behaviorEngine.disablePersonalRitual(id);
    useBehaviorStore.setState({ state: behaviorEngine.getState() });
    refreshBehaviorContext(); saveState();
  });
}

export async function resetBehaviorLearning(): Promise<void> {
  await runLocalMemoryMutation(prepareCompanionMemoryChange, async () => {
    behaviorEngine.resetLearning();
    clearCue("behavior-reset");
    behaviorEngine.configure(useBehaviorStore.getState().settings);
    refreshEnvironment();
    useBehaviorStore.setState({ state: behaviorEngine.getState() });
    saveState();
    refreshBehaviorContext();
  });
}

/** Fast expression follows the same event phase, without issuing a motor command. */
function syncMomentPresentation(state: BehaviorState): void {
  if (!installed || useBehaviorStore.getState().settings.mode !== "active" || !state.sessionId || !state.moment) return;
  // An armed scene may ask the assistant to attend silently, but must not
  // replace a real in-progress spoken turn with an attending expression.
  const conversation = useConversationStore.getState();
  if (conversation.isSpeaking || state.moment.phase === "speaking") return;
  const user = useUserStore.getState();
  if (AppState.currentState !== "active" || !isMainScreenFocused() || user.robotSleeping || isDrivingControlSessionActive() || getLooiRobotRuntimeState().motionActive) return;
  const current = useBehaviorStore.getState().presentation;
  const waiting = state.companion.scene?.status === "armed";
  const phase = waiting ? "attending" : state.moment.phase;
  const id = `moment-${state.lifecycleGeneration}-${phase}`;
  const now = monotonicNow();
  const eventExpiry = state.moment.changedAt + 10_000;
  // Keep the display tied to a real ongoing speech/processing signal. A long
  // turn must not silently fall back to an unrelated idle presentation.
  const ongoingSpeech = phase === "attending" && conversation.isUserSpeaking;
  const ongoingProcessing = phase === "reflecting" && conversation.isProcessing;
  const ongoing = !waiting && (ongoingSpeech || ongoingProcessing);
  if (!waiting && !ongoing && now > eventExpiry && current?.id === id) {
    useBehaviorStore.setState({ presentation: null });
    return;
  }
  if (current && current.generation === state.lifecycleGeneration && now <= current.expiresAt && (!current.id.startsWith("moment-") || current.id === id)) return;
  if (phase !== "attending" && phase !== "reflecting") return;
  const presentation: BehaviorPresentation = {
    id, generation: state.lifecycleGeneration,
    gesture: "hold", posture: phase === "attending" ? "attend" : "reflect",
    mood: phase === "attending" ? "attentive" : "thoughtful",
    expiresAt: waiting ? now + Math.max(0, (state.companion.scene.deadline ?? 0) - Date.now()) : ongoing ? Math.max(eventExpiry, now + 5_000) : eventExpiry, presentationOnly: true,
    ...(phase === "reflecting" ? { gaze: { x: 0, y: 0.18 } } : {}),
  };
  if (now <= presentation.expiresAt) useBehaviorStore.setState({ presentation });
}

function refreshEnvironment(): void {
  const user = useUserStore.getState();
  const conversation = useConversationStore.getState();
  const robot = getLooiRobotRuntimeState();
  const preferences = user.preferences;
  const preferenceKey = JSON.stringify([preferences.language, preferences.listeningLanguage, preferences.ambientMotionLevel, preferences.cameraAttentionEnabled, preferences.robotName]);
  if (priorPreferenceKey && preferenceKey !== priorPreferenceKey) {
    repairFeedbackTracker.reset();
    gameFeedbackTracker.reset();
    behaviorEngine.dispatch({ type: "interrupt", reason: "preferences-changed" });
    clearCue("behavior-preferences");
  }
  priorPreferenceKey = preferenceKey;
  const criticalBlocked = AppState.currentState !== "active" || !isMainScreenFocused() || user.robotSleeping || isDrivingControlSessionActive();
  if ((criticalBlocked && useBehaviorStore.getState().presentation) || (conversation.isUserSpeaking && activeCueId)) clearCue("behavior-environment");
  behaviorEngine.setEnvironment({
    responseLanguage: preferences.language,
    robotName: preferences.robotName,
    foreground: AppState.currentState === "active", focused: isMainScreenFocused(), sleeping: user.robotSleeping,
    connected: robot.connected, ambientEnabled: preferences.ambientMotionLevel !== "off", cameraEnabled: preferences.cameraAttentionEnabled,
    userSpeaking: conversation.isUserSpeaking, assistantSpeaking: conversation.isSpeaking, motionActive: robot.motionActive,
  });
  if (!listeningFeedbackAllowed(behaviorEngine.getState())) clearListeningFeedback();
  if (criticalBlocked || conversation.isSpeaking || user.voiceState === "speaking" || conversation.isUserSpeaking || robot.motionActive) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;
    if (useBehaviorStore.getState().feedback) useBehaviorStore.setState({ feedback: null });
    if (criticalBlocked || robot.motionActive) { repairFeedbackTracker.reset(); gameFeedbackTracker.reset(); }
  }
  if (robot.stopGeneration !== lastStopGeneration) {
    lastStopGeneration = robot.stopGeneration;
    const stopReason = robot.safety.lastSafetyStopReason ?? null;
    repairFeedbackTracker.reset();
    gameFeedbackTracker.reset();
    behaviorEngine.dispatch({ type: "interrupt", reason: stopReason ?? "robot-stop" });
    clearCue("behavior-robot-stop", shouldClearUnownedReactionForStop(stopReason));
    useConversationStore.getState().clearInputAttention();
  }
  syncHandSignalRequest(behaviorEngine.getState());
}

/** Called only after the home face's genuine stroke recognizer accepts a gesture. */
export function recordFriendlyStroke(): { durationMs: number } | null {
  if (!installed || AppState.currentState !== "active" || !isMainScreenFocused() || isDrivingControlSessionActive()) return null;
  const conversation = useConversationStore.getState();
  if (conversation.isUserSpeaking || conversation.isSpeaking || conversation.isProcessing) return null;
  const feedback = useBehaviorStore.getState().feedback;
  if (feedback && feedback.kind !== "game") return null;
  refreshEnvironment();
  return behaviorEngine.noteFriendlyStroke();
}

async function executeCue(cue: BehaviorCue): Promise<void> {
  const settings = useBehaviorStore.getState().settings;
  const controller = new AbortController();
  let started = false;
  let executionDeadline = 0;
  const valid = () => {
    const user = useUserStore.getState();
    const conversation = useConversationStore.getState();
    const state = behaviorEngine.getState();
    return !controller.signal.aborted && installed && useBehaviorStore.getState().settings.mode === "active" && activeCueId === cue.id
      && state.lifecycleGeneration === cue.generation && monotonicNow() <= (started ? executionDeadline : cue.expiresAt)
      && AppState.currentState === "active" && isMainScreenFocused() && !user.robotSleeping
      && !conversation.isUserSpeaking && !isDrivingControlSessionActive() && !getLooiRobotRuntimeState().motionActive
      && !getSocialAttentionControllerState().objectAttentionActive;
  };
  if (settings.mode !== "active") return;
  // A local game outcome already owns its single visual beat; do not add an
  // unrelated cloud-selected head gesture on top of it.
  const feedback = useBehaviorStore.getState().feedback;
  if (feedback?.kind === "game" && monotonicNow() < feedback.expiresAt) return;
  clearCue("behavior-replaced", false, true);
  activeCueId = cue.id;
  if (!valid()) { activeCueId = null; return; }
  if (cue.presentationOnly) { useBehaviorStore.setState({ presentation: cue }); activeCueId = null; return; }
  if (cue.gesture === "hold") {
    useBehaviorStore.setState({ presentation: cue });
    holdAmbientMotionFor(Math.max(0, cue.expiresAt - monotonicNow()), "behavior-hold");
    activeCueId = null;
    return;
  }
  const robot = getLooiRobotRuntimeState();
  if (!robot.connected || useUserStore.getState().preferences.ambientMotionLevel === "off") {
    useBehaviorStore.setState({ presentation: cue });
    if (cue.mood) behaviorReactionId = triggerCharacterReaction(cue.mood, { durationMs: 900, source: "behavior" });
    activeCueId = null; return;
  }
  activeExpression = controller;
  // Keep face following and ambient head motion from competing with preparation.
  holdAmbientHeadMotionFor(1_500, "behavior-cue");
  holdSocialAttentionMotionFor(1_500, "behavior-cue");
  const clearOwnReaction = () => {
    if (behaviorReactionId !== null && useCharacterReactionStore.getState().reactionId === behaviorReactionId) clearCharacterReaction("behavior-expression-settled");
    behaviorReactionId = null;
  };
  try {
    await runBehaviorExpression(cue, {
      now: monotonicNow, signal: controller.signal, isCurrent: valid, reducedMotion: expressionReducedMotion,
      beginAccent() {
        if (!valid() || !getLooiRobotRuntimeState().connected || useUserStore.getState().preferences.ambientMotionLevel === "off") return false;
        // Freshness gates accent start; every later step shares a bounded close.
        executionDeadline = monotonicNow() + 1_500; started = true;
        holdAmbientHeadMotionFor(1_500, "behavior-cue");
        holdSocialAttentionMotionFor(1_500, "behavior-cue");
        return true;
      },
      present(phase, gaze) {
        if (!valid()) return;
        if (phase === "settle") clearOwnReaction();
        useBehaviorStore.setState({ presentation: {
          ...cue, gaze, mood: phase === "accent" ? cue.mood : null, expressionPhase: phase,
          expiresAt: started ? executionDeadline : cue.expiresAt,
        } });
        if (phase === "accent" && cue.mood) behaviorReactionId = triggerCharacterReaction(cue.mood, { durationMs: 900, source: "behavior" });
      },
      executeHead: () => performLooiBehaviorHeadGesture(cue.gesture, valid),
    });
  } finally {
    // An old completion cannot clear the expression or reaction of a newer cue.
    if (activeExpression === controller && activeCueId === cue.id) {
      controller.abort(); activeExpression = null; activeCueId = null;
      cancelLooiHeadMotion("behavior-expression-ended", "behavior");
      clearOwnReaction();
      if (useBehaviorStore.getState().presentation?.id === cue.id) useBehaviorStore.setState({ presentation: null });
    }
  }
}

function publishFaces(): void {
  if (useBehaviorStore.getState().settings.mode === "off") return;
  behaviorEngine.tick();
  syncHandSignalRequest(behaviorEngine.getState());
  const attention = getSocialAttentionControllerState();
  const faces = attention.faces ?? [];
  // The engine refreshes evidence here; only membership changes trigger decisions.
  if (behaviorEngine.getState().sessionId) behaviorEngine.dispatch({ type: "faces", faces });
  const presentation = useBehaviorStore.getState().presentation;
  if (presentation && monotonicNow() > presentation.expiresAt) useBehaviorStore.setState({ presentation: null });
  syncMomentPresentation(behaviorEngine.getState());
}

export function installBehaviorRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const preferenceGeneration = ++motionPreferenceGeneration;
  // This reads an OS preference; it does not request another device permission.
  if (AccessibilityInfo?.isReduceMotionEnabled) {
    // Keep extra spatial phases off until this installation knows the OS value.
    expressionReducedMotion = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!installed || preferenceGeneration !== motionPreferenceGeneration) return;
      const previouslyReduced = expressionReducedMotion;
      expressionReducedMotion = enabled;
      if (enabled && !previouslyReduced) clearCue("behavior-reduce-motion");
    }).catch(() => undefined);
  }
  const motionPreference = AccessibilityInfo?.addEventListener?.("reduceMotionChanged", (enabled) => {
    motionPreferenceGeneration += 1;
    const previouslyReduced = expressionReducedMotion;
    expressionReducedMotion = enabled;
    if (enabled && !previouslyReduced) clearCue("behavior-reduce-motion");
  });
  if (motionPreference) uninstalls.push(() => motionPreference.remove());
  uninstalls.push(registerBehaviorAdapter({
    dispatch(event) {
      if (event.type === "user-speech-end") clearListeningFeedback();
      refreshEnvironment();
      if (event.type === "interrupt" || event.type === "session-end" || event.type === "session-start") repairFeedbackTracker.reset();
      if (event.type === "interrupt" || event.type === "session-end" || event.type === "session-start" || event.type === "user-speech-start") gameFeedbackTracker.reset();
      if (event.type === "interrupt" || event.type === "user-speech-start" || event.type === "session-end") clearCue(`behavior-${event.type}`);
      behaviorEngine.dispatch(event);
    },
    getContext: () => behaviorEngine.getConversationContext(),
    getPersonalityContext: (text) => behaviorEngine.getPersonalityContext(text),
    acceptPersonalityTurn(text, sessionId) { refreshEnvironment(); behaviorEngine.acceptPersonalityTurn(text, sessionId); },
    notePersonalitySpeech: (text, sessionId) => behaviorEngine.notePersonalitySpeech(text, sessionId),
    listeningFrame: handleListeningFrame,
    isGameActive: () => useBehaviorStore.getState().settings.mode === "active" && behaviorEngine.getState().game?.status === "active",
    requiresManualResponse: () => useBehaviorStore.getState().settings.mode === "active" && (behaviorEngine.hasPendingReturnConfirmation() || behaviorEngine.getState().repairRequired || behaviorEngine.getState().game?.status === "active" || behaviorEngine.getState().game?.status === "paused" || behaviorEngine.getState().companion.scene?.status === "armed" || !!behaviorEngine.getState().pendingIntention?.activity?.pending || behaviorEngine.getState().companion.pendingExperience?.kind === "personal_ritual" || behaviorEngine.getState().companion.pendingExperience?.kind === "correction"),
    inspectVisual: (image, task, sessionId) => useBehaviorStore.getState().settings.mode === "active" && useBehaviorStore.getState().settings.visualEnabled ? behaviorEngine.inspectVisual(image, task, sessionId) : Promise.resolve(""),
    companionAction(action) {
      refreshEnvironment();
      if (action.type === "prepare_shared_ritual" && action.signal === "open_palm" && getSocialAttentionControllerState().interactionSignalsSupported !== true)
        return { ok: false, status: "invalid_action", instruction: "Local open-palm analysis is not available in this camera runtime. Enable Camera Attention with a current iOS build, or agree on a voice start instead." };
      return behaviorEngine.companionAction(action);
    },
  }));
  uninstalls.push(behaviorEngine.subscribe((state) => {
    const previous = useBehaviorStore.getState().state.companion;
    const spokenForget = !!state.sessionId && previous?.episodes.some((episode) => !state.companion.episodes.some((remaining) => remaining.id === episode.id));
    const presentation = useBehaviorStore.getState().presentation;
    if (presentation && presentation.generation !== state.lifecycleGeneration) clearCue("behavior-invalidated");
    const game = state.game;
    const gameFeedback = gameFeedbackTracker.observe({ sessionId: state.sessionId, generation: state.lifecycleGeneration,
      turnId: state.turnId, phase: state.moment?.phase ?? "settled", phaseAt: state.moment?.changedAt ?? monotonicNow(),
      game: game ? { round: game.round, status: game.status, lastOutcome: game.lastOutcome } : null }, monotonicNow());
    const feedback = repairFeedbackTracker.observe(state, monotonicNow()) ?? gameFeedback;
    const conversation = useConversationStore.getState();
    const user = useUserStore.getState();
    if (feedback && useBehaviorStore.getState().settings.mode === "active" && !conversation.isSpeaking && user.voiceState !== "speaking" && !conversation.isUserSpeaking
      && !user.robotSleeping && AppState.currentState === "active" && isMainScreenFocused()
      && !isDrivingControlSessionActive() && !getLooiRobotRuntimeState().motionActive) {
      if (feedbackTimer) clearTimeout(feedbackTimer);
      useBehaviorStore.setState({ feedback });
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        if (useBehaviorStore.getState().feedback?.id === feedback.id) useBehaviorStore.setState({ feedback: null });
      }, Math.max(0, feedback.expiresAt - monotonicNow()));
    } else if (useBehaviorStore.getState().feedback?.generation !== state.lifecycleGeneration && useBehaviorStore.getState().feedback) {
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = null;
      useBehaviorStore.setState({ feedback: null });
    }
    useBehaviorStore.setState({ state }); schedulePersist(); refreshBehaviorContext();
    syncMomentPresentation(state);
    syncHandSignalRequest(state);
    if (spokenForget) {
      // A heard confirmation may also delete an episode through the voice path.
      // Persist the deletion immediately and discard the session that knew it,
      // using the same start barrier as the explicit settings controls.
      clearCue("spoken-experience-forgotten"); saveState();
      void runLocalMemoryMutation(prepareCompanionMemoryChange, async () => { saveState(); }).catch(() => {
        // The local deletion remains authoritative even if audio shutdown fails.
        useConversationStore.getState().clearSession(); saveState();
      });
    }
  }));
  configureAmbientBehaviorPolicy(() => ({ suppress: useBehaviorStore.getState().settings.mode === "active" && behaviorEngine.getState().sessionId !== null && (["attend", "reflect", "yield"].includes(behaviorEngine.getState().posture) || monotonicNow() < (behaviorEngine.getState().cue?.expiresAt ?? 0)) }));
  configureSocialBehaviorPolicy(() => {
    const state = behaviorEngine.getState();
    if (useBehaviorStore.getState().settings.mode !== "active" || !state.sessionId) return { attention: "search", selectedFaceId: null };
    return { attention: state.attentionPolicy === "release" ? "release" : state.attentionPolicy === "brief_search" ? "search" : "keep", selectedFaceId: state.selectedFaceId };
  });
  uninstalls.push(subscribeMainScreenFocused(refreshEnvironment), useUserStore.subscribe(refreshEnvironment), useConversationStore.subscribe(refreshEnvironment), subscribeLooiRobotRuntimeState(refreshEnvironment));
  const subscription = AppState.addEventListener("change", () => { refreshEnvironment(); if (AppState.currentState !== "active") saveState(); });
  uninstalls.push(() => subscription.remove());
  facePoll = setInterval(publishFaces, 400);
  refreshEnvironment();
  return () => {
    installed = false;
    motionPreferenceGeneration += 1;
    armedHandScene = null; startSignalDetector.reset();
    if (typeof setSocialInteractionSignalRequest === "function") setSocialInteractionSignalRequest(null);
    if (facePoll) clearInterval(facePoll);
    facePoll = null;
    clearCue("behavior-uninstall");
    repairFeedbackTracker.reset();
    gameFeedbackTracker.reset();
    behaviorEngine.dispatch({ type: "interrupt", reason: "runtime-uninstalled" });
    uninstalls.forEach((remove) => remove()); uninstalls = [];
    configureAmbientBehaviorPolicy(null); configureSocialBehaviorPolicy(null);
    saveState();
  };
}
