import { AppState } from "react-native";
import { robotBodyState } from "./body-state";
import { robotExpressionConductor } from "./expression";
import { createSpeechOnsetDetector, createSpeechWobble, speechLevel } from "./speech-level";
import { subscribeBehaviorEvents } from "../behavior/behavior-events";
import { configureBehaviorReactionOwner } from "../behavior/behavior-runtime";
import { holdAmbientHeadMotionFor } from "../core/ambient-motion";
import { isMainScreenFocused } from "../core/main-screen-presence";
import { getLooiRobotRuntimeState, performLooiBehaviorHeadGesture } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { useConversationStore } from "../store/conversation";
import { useUserStore } from "../store/user";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";

const HEAD_HOLD_MS = 700;
let installed = false;

function canMoveHead(): boolean {
  const robot = getLooiRobotRuntimeState();
  const user = useUserStore.getState();
  return robot.connected && !robot.motionActive && !user.robotSleeping
    && user.preferences.ambientMotionLevel !== "off"
    && AppState.currentState === "active" && isMainScreenFocused()
    && !useConversationStore.getState().isUserSpeaking && !isDrivingControlSessionActive();
}

/**
 * Small head movements at the start of spoken phrases, driven by LOOI's own
 * audio. Runs at behavior priority like the expression gestures: explicit
 * commands and face attention still win, ambient motion yields. When the head
 * moved with a reply, the separate Decisions reaction for that reply is not
 * requested.
 */
export function installSpeechWobbleRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const wobble = createSpeechWobble();
  const onsets = createSpeechOnsetDetector();
  let generation = 0;

  const unsubscribeLevel = speechLevel.subscribe((level, live) => {
    if (!live) { onsets.reset(); return; }
    if (!onsets.feed(level, Date.now())) return;
    const intent = robotBodyState.getState().expression.intent;
    if (!wobble.onPhraseStart(intent === "sad" || intent === "calm") || !canMoveHead()) return;
    const current = generation;
    holdAmbientHeadMotionFor(HEAD_HOLD_MS, "speech-wobble");
    void Promise.resolve(performLooiBehaviorHeadGesture("speaking_soft", () => current === generation && canMoveHead()))
      .catch(() => undefined);
  });
  const end = (interrupted: boolean) => {
    generation += 1;
    speechLevel.reset();
    onsets.reset();
    if (interrupted) wobble.interrupted(); else wobble.replyEnded();
  };
  const unsubscribeConversation = useConversationStore.subscribe((state, previous) => {
    if (state.isSpeaking && !previous.isSpeaking) wobble.replyStarted();
    if (!state.isSpeaking && previous.isSpeaking) end(false);
    if (state.isUserSpeaking && !previous.isUserSpeaking) end(true);
  });
  const unsubscribeEvents = subscribeBehaviorEvents((event) => {
    if (event.type === "interrupt" || event.type === "session-end" || event.type === "session-start") end(true);
  });
  configureBehaviorReactionOwner(() => {
    const owned = wobble.ownsReplyReaction() || robotExpressionConductor.ownsReplyReaction();
    if (owned) recordDiagnosticEvent("cost", "decisions-reaction-skipped", { reason: "reply-already-expressed" });
    return owned;
  });
  return () => {
    unsubscribeLevel(); unsubscribeConversation(); unsubscribeEvents();
    configureBehaviorReactionOwner(null);
    end(true);
    installed = false;
  };
}
