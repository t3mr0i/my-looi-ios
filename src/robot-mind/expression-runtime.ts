import { AppState } from "react-native";
import { robotExpressionConductor } from "./expression";
import { subscribeBehaviorEvents } from "../behavior/behavior-events";
import { configureBehaviorCueGate } from "../behavior/behavior-runtime";
import { inferSpeechTextIntent } from "../character/face-expression";
import { holdAmbientHeadMotionFor } from "../core/ambient-motion";
import { isMainScreenFocused } from "../core/main-screen-presence";
import { getLooiRobotRuntimeState, performLooiBehaviorHeadGesture } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { useConversationStore } from "../store/conversation";
import { useUserStore } from "../store/user";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";

const HEAD_GESTURE_HOLD_MS = 1_500;
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
 * Wire the expression conductor to the reply lifecycle both voice modes
 * already publish, to the shared head writer at behavior priority (social
 * attention and explicit commands still win, ambient yields), and to the
 * Decisions cue gate. Installed once at bootstrap.
 */
export function installRobotExpressionRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  robotExpressionConductor.configure({
    canMoveHead,
    runHead(gesture, isCurrent) {
      holdAmbientHeadMotionFor(HEAD_GESTURE_HOLD_MS, "model-expression");
      return performLooiBehaviorHeadGesture(gesture, isCurrent);
    },
    diagnostic: (name, details) => recordDiagnosticEvent("character", `expression-${name}`, details),
  });
  configureBehaviorCueGate(() => !robotExpressionConductor.ownsReplyReaction());

  const unsubscribeEvents = subscribeBehaviorEvents((event) => {
    switch (event.type) {
      case "assistant-start": robotExpressionConductor.speechStarted(); break;
      case "assistant-end": robotExpressionConductor.endReply(true, "assistant-end"); break;
      case "user-speech-start": robotExpressionConductor.interrupt("user-speech-start"); break;
      case "interrupt": robotExpressionConductor.interrupt(`interrupt:${event.reason}`); break;
      case "session-start":
      case "session-end": robotExpressionConductor.interrupt(event.type); break;
    }
  });
  // Turn-based speech publishes no behavior events; the speaking flag marks
  // its reply audio in both modes.
  const unsubscribeConversation = useConversationStore.subscribe((state, previous) => {
    if (state.isSpeaking && !previous.isSpeaking) robotExpressionConductor.speechStarted();
    if (!state.isSpeaking && previous.isSpeaking) robotExpressionConductor.endReply(true, "speech-ended");
    if (state.heardSpeechText !== previous.heardSpeechText) {
      robotExpressionConductor.noteSpeechTextIntent(state.heardSpeechText ? inferSpeechTextIntent(state.heardSpeechText) : null);
    }
  });
  return () => {
    unsubscribeEvents();
    unsubscribeConversation();
    configureBehaviorCueGate(null);
    robotExpressionConductor.configure({});
    robotExpressionConductor.interrupt("uninstalled");
    installed = false;
  };
}
