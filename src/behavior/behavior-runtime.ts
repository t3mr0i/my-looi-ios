import { AppState } from "react-native";
import { create } from "zustand";
import { createMMKV } from "react-native-mmkv";
import { createBehaviorEngine } from "./behavior-engine";
import type { BehaviorCue, BehaviorSettings, BehaviorState } from "./behavior-types";
import { registerBehaviorAdapter, refreshBehaviorContext } from "./behavior-events";
import { requestDecisions } from "../openai/decisions";
import { useUserStore } from "../store/user";
import { useConversationStore } from "../store/conversation";
import { isMainScreenFocused, subscribeMainScreenFocused } from "../core/main-screen-presence";
import { configureAmbientBehaviorPolicy, holdAmbientMotionFor, holdAmbientHeadMotionFor } from "../core/ambient-motion";
import { configureSocialBehaviorPolicy, getSocialAttentionControllerState, holdSocialAttentionMotionFor } from "../core/social-attention";
import { cancelLooiHeadMotion, getLooiRobotRuntimeState, performLooiBehaviorHeadGesture, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { clearCharacterReaction, triggerCharacterReaction, useCharacterReactionStore } from "../character/character-reaction";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";

const storage = createMMKV({ id: "looi.behavior.v1" });
const SETTINGS_KEY = "settings";
const STATE_KEY = "state";
const defaults: BehaviorSettings = { mode: "off", dailyBudgetUsd: 1, visualEnabled: false, candidateScoring: true };
function readSettings(): BehaviorSettings {
  try {
    const value = JSON.parse(storage.getString(SETTINGS_KEY) ?? "{}");
    return { mode: value.mode === "active" || value.mode === "shadow" ? value.mode : "off", dailyBudgetUsd: [0.25, 1, 3].includes(value.dailyBudgetUsd) ? value.dailyBudgetUsd : 1, visualEnabled: value.visualEnabled === true, candidateScoring: value.candidateScoring !== false };
  } catch { return { ...defaults }; }
}
const monotonicNow = () => typeof performance !== "undefined" ? performance.now() : Date.now();
let installed = false;
let uninstalls: Array<() => void> = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let facePoll: ReturnType<typeof setInterval> | null = null;
let activeCueId: string | null = null;
let behaviorReactionId: number | null = null;
let priorPreferenceKey = "";
let lastStopGeneration = 0;
let lastSavedState = "";
let lastScheduledState = "";

export const behaviorEngine = createBehaviorEngine({
  decide: (input, options) => requestDecisions(input, options),
  executeCue,
  now: monotonicNow,
  wallNow: Date.now,
  decisionTimeoutMs: 1_800,
  traceLimit: 80,
});
try { const stored = storage.getString(STATE_KEY); if (stored) { behaviorEngine.restore(stored); lastSavedState = stored; } } catch {}

export const useBehaviorStore = create<{
  settings: BehaviorSettings;
  state: BehaviorState;
  presentation: BehaviorCue | null;
}>(() => ({ settings: readSettings(), state: behaviorEngine.getState(), presentation: null }));
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
function clearCue(reason: string): void {
  const owned = activeCueId !== null;
  activeCueId = null;
  useBehaviorStore.setState({ presentation: null });
  if (owned) cancelLooiHeadMotion(reason);
  if (behaviorReactionId !== null && useCharacterReactionStore.getState().reactionId === behaviorReactionId) clearCharacterReaction(reason);
  behaviorReactionId = null;
}

export function updateBehaviorSettings(patch: Partial<BehaviorSettings>): void {
  const current = useBehaviorStore.getState().settings;
  const next: BehaviorSettings = { ...current, ...patch };
  if (!["off", "shadow", "active"].includes(next.mode)) next.mode = "off";
  if (![0.25, 1, 3].includes(next.dailyBudgetUsd)) next.dailyBudgetUsd = 1;
  next.visualEnabled = next.visualEnabled === true;
  next.candidateScoring = next.candidateScoring !== false;
  storage.set(SETTINGS_KEY, JSON.stringify(next));
  clearCue("behavior-settings");
  useBehaviorStore.setState({ settings: next });
  behaviorEngine.configure(next);
  useBehaviorStore.setState({ state: behaviorEngine.getState() });
  refreshEnvironment();
  refreshBehaviorContext();
  saveState();
}

export function resetBehaviorLearning(): void {
  behaviorEngine.resetLearning();
  clearCue("behavior-reset");
  behaviorEngine.configure(useBehaviorStore.getState().settings);
  refreshEnvironment();
  useBehaviorStore.setState({ state: behaviorEngine.getState() });
  saveState();
  refreshBehaviorContext();
}

function refreshEnvironment(): void {
  const user = useUserStore.getState();
  const conversation = useConversationStore.getState();
  const robot = getLooiRobotRuntimeState();
  const preferences = user.preferences;
  const preferenceKey = JSON.stringify([preferences.language, preferences.listeningLanguage, preferences.ambientMotionLevel, preferences.cameraAttentionEnabled, preferences.robotName]);
  if (priorPreferenceKey && preferenceKey !== priorPreferenceKey) {
    behaviorEngine.dispatch({ type: "interrupt", reason: "preferences-changed" });
    clearCue("behavior-preferences");
  }
  priorPreferenceKey = preferenceKey;
  const blocked = AppState.currentState !== "active" || !isMainScreenFocused() || user.robotSleeping || conversation.isUserSpeaking || isDrivingControlSessionActive();
  if (blocked && activeCueId) clearCue("behavior-environment");
  behaviorEngine.setEnvironment({
    foreground: AppState.currentState === "active", focused: isMainScreenFocused(), sleeping: user.robotSleeping,
    connected: robot.connected, ambientEnabled: preferences.ambientMotionLevel !== "off", cameraEnabled: preferences.cameraAttentionEnabled,
    userSpeaking: conversation.isUserSpeaking, assistantSpeaking: conversation.isSpeaking, motionActive: robot.motionActive,
  });
  if (robot.stopGeneration !== lastStopGeneration) {
    lastStopGeneration = robot.stopGeneration;
    behaviorEngine.dispatch({ type: "interrupt", reason: robot.safety.lastSafetyStopReason ?? "robot-stop" });
    clearCue("behavior-robot-stop");
  }
}

async function executeCue(cue: BehaviorCue): Promise<void> {
  const settings = useBehaviorStore.getState().settings;
  let started = false;
  let executionDeadline = 0;
  const valid = () => {
    const user = useUserStore.getState();
    const conversation = useConversationStore.getState();
    const state = behaviorEngine.getState();
    return installed && useBehaviorStore.getState().settings.mode === "active" && activeCueId === cue.id
      && state.lifecycleGeneration === cue.generation && monotonicNow() <= (started ? executionDeadline : cue.expiresAt)
      && AppState.currentState === "active" && isMainScreenFocused() && !user.robotSleeping
      && !conversation.isUserSpeaking && !isDrivingControlSessionActive() && !getLooiRobotRuntimeState().motionActive;
  };
  if (settings.mode !== "active") return;
  activeCueId = cue.id;
  if (!valid()) { activeCueId = null; return; }
  useBehaviorStore.setState({ presentation: cue });
  if (cue.gesture === "hold") {
    holdAmbientMotionFor(Math.max(0, cue.expiresAt - monotonicNow()), "behavior-hold");
    activeCueId = null;
    return;
  }
  if (cue.mood) behaviorReactionId = triggerCharacterReaction(cue.mood, { durationMs: 900, source: "behavior" });
  const robot = getLooiRobotRuntimeState();
  if (!robot.connected || useUserStore.getState().preferences.ambientMotionLevel === "off") { activeCueId = null; return; }
  holdAmbientHeadMotionFor(1_500, "behavior-cue");
  holdSocialAttentionMotionFor(1_500, "behavior-cue");
  // Freshness limits the start; a started macro gets a bounded closing phase.
  // New turns, STOP and owner preemption still invalidate every later step.
  executionDeadline = monotonicNow() + 1_500;
  started = true;
  try { await performLooiBehaviorHeadGesture(cue.gesture, valid); } catch { /* Local safety/connection wins. */ }
  finally { if (activeCueId === cue.id) activeCueId = null; }
}

function publishFaces(): void {
  if (useBehaviorStore.getState().settings.mode === "off") return;
  const attention = getSocialAttentionControllerState();
  const faces = attention.faces ?? [];
  // The engine refreshes evidence here; only membership changes trigger decisions.
  if (behaviorEngine.getState().sessionId) behaviorEngine.dispatch({ type: "faces", faces });
  const presentation = useBehaviorStore.getState().presentation;
  if (presentation && monotonicNow() > presentation.expiresAt) useBehaviorStore.setState({ presentation: null });
}

export function installBehaviorRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  uninstalls.push(registerBehaviorAdapter({
    dispatch(event) { refreshEnvironment(); if (event.type === "interrupt" || event.type === "user-speech-start" || event.type === "session-end") clearCue(`behavior-${event.type}`); behaviorEngine.dispatch(event); },
    getContext: () => useBehaviorStore.getState().settings.mode === "active" ? behaviorEngine.getConversationContext() : "",
    isGameActive: () => useBehaviorStore.getState().settings.mode === "active" && behaviorEngine.getState().game?.status === "active",
    inspectVisual: (image, task, sessionId) => useBehaviorStore.getState().settings.mode === "active" && useBehaviorStore.getState().settings.visualEnabled ? behaviorEngine.inspectVisual(image, task, sessionId) : Promise.resolve(""),
  }));
  uninstalls.push(behaviorEngine.subscribe((state) => { useBehaviorStore.setState({ state }); schedulePersist(); refreshBehaviorContext(); }));
  configureAmbientBehaviorPolicy(() => ({ suppress: useBehaviorStore.getState().settings.mode === "active" && behaviorEngine.getState().sessionId !== null && (behaviorEngine.getState().posture === "attend" || behaviorEngine.getState().posture === "yield" || monotonicNow() < (behaviorEngine.getState().cue?.expiresAt ?? 0)) }));
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
    if (facePoll) clearInterval(facePoll);
    facePoll = null;
    clearCue("behavior-uninstall");
    behaviorEngine.dispatch({ type: "interrupt", reason: "runtime-uninstalled" });
    uninstalls.forEach((remove) => remove()); uninstalls = [];
    configureAmbientBehaviorPolicy(null); configureSocialBehaviorPolicy(null);
    saveState();
  };
}
