import { AppState } from "react-native";
import { robotBodyState } from "./body-state";
import { createReactionClipPolicy } from "./reaction-clips";
import { triggerCharacterReaction } from "../character/character-reaction";
import { holdAmbientHeadMotionFor } from "../core/ambient-motion";
import { isMainScreenFocused } from "../core/main-screen-presence";
import { getLooiRobotRuntimeState, performLooiBehaviorHeadGesture } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { useConversationStore } from "../store/conversation";
import { useUserStore } from "../store/user";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";

const HEAD_HOLD_MS = 1_500;
let installed = false;

function appVisible(): boolean {
  return AppState.currentState === "active" && isMainScreenFocused() && !useUserStore.getState().robotSleeping;
}

function canMoveHead(): boolean {
  const robot = getLooiRobotRuntimeState();
  return robot.connected && !robot.motionActive && useUserStore.getState().preferences.ambientMotionLevel !== "off"
    && appVisible() && !useConversationStore.getState().isUserSpeaking && !isDrivingControlSessionActive();
}

/** Plays local reaction clips for body events. Installed once at bootstrap; no model or network use. */
export function installReactionClipsRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const policy = createReactionClipPolicy(robotBodyState.now);
  let generation = 0;
  const unsubscribe = robotBodyState.subscribeEvents((event) => {
    if (!appVisible()) return;
    const clip = policy.decide(event, robotBodyState.getState());
    if (!clip) return;
    const current = ++generation;
    triggerCharacterReaction(clip.face, { durationMs: clip.faceMs, source: `reaction-clip:${clip.id}` });
    const moveHead = !!clip.head && canMoveHead();
    recordDiagnosticEvent("character", "reaction-clip", { clip: clip.id, bodyEvent: event.type, head: moveHead });
    if (!moveHead) return;
    holdAmbientHeadMotionFor(HEAD_HOLD_MS, "reaction-clip");
    void Promise.resolve(performLooiBehaviorHeadGesture(clip.head!, () => current === generation && canMoveHead())).catch(() => undefined);
  });
  return () => { unsubscribe(); generation += 1; installed = false; };
}
