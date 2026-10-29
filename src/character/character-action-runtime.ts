import { create } from "zustand";
import { AppState } from "react-native";
import { useUserStore } from "../store/user";
import { useConversationStore } from "../store/conversation";
import { isMainScreenFocused, subscribeMainScreenFocused } from "../core/main-screen-presence";
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";
import { isBehaviorGameActive, subscribeBehaviorEvents } from "../behavior/behavior-events";
import { createCharacterActionController, type CharacterActionKind, type CharacterActionState } from "./character-action";
import { selectCharacterScene } from "./character-scene-selection";

export const useCharacterActionStore = create<CharacterActionState>(() => ({ active: null, pending: null }));
const controller = createCharacterActionController({ now: Date.now,
  publish: state => useCharacterActionStore.setState(state),
  schedule: (callback, delay) => setTimeout(callback, delay), unschedule: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
let installed = false;
let lastContextSceneAt = -Infinity;
let refreshAvailability = () => {};
export function requestCharacterAction(kind: CharacterActionKind) { refreshAvailability(); return controller.request(kind, "menu"); }
export function cancelCharacterAction(_reason = "explicit", expectedId?: number) {
  if (expectedId === undefined || useCharacterActionStore.getState().active?.id === expectedId) controller.cancel();
}
export function requestCharacterActionFromVoice(text: string, sessionId: string, robotName?: string) {
  const selection = selectCharacterScene(text, robotName);
  refreshAvailability();
  if (selection?.source === "context" && isBehaviorGameActive(sessionId)) return null;
  if (selection && (selection.source === "voice" || Date.now() - lastContextSceneAt >= 12_000)) {
    const id = controller.request(selection.kind, selection.source, sessionId);
    if (id !== null && selection.source === "context") lastContextSceneAt = Date.now();
    return id;
  }
  return null;
}
export function completeCharacterActionReply(sessionId: string) { controller.replyHeard(sessionId); }

export function installCharacterActionRuntime(): () => void {
  if (installed) return () => {};
  installed = true;
  let stopGeneration = getLooiRobotRuntimeState().stopGeneration;
  let userSpeaking = useConversationStore.getState().isUserSpeaking;
  const sync = () => {
    const user = useUserStore.getState(), conversation = useConversationStore.getState(), robot = getLooiRobotRuntimeState();
    if (robot.stopGeneration !== stopGeneration || (!userSpeaking && conversation.isUserSpeaking)) controller.cancel();
    stopGeneration = robot.stopGeneration; userSpeaking = conversation.isUserSpeaking;
    controller.setAvailability({ allowed: AppState.currentState === "active" && isMainScreenFocused() && !user.robotSleeping
      && !robot.motionActive && !isDrivingControlSessionActive(),
      busy: conversation.isUserSpeaking || conversation.isSpeaking || conversation.isProcessing
        || ["speaking", "processing", "verifying"].includes(user.voiceState) });
  };
  const removeEvents = subscribeBehaviorEvents(event => {
    if (event.type === "user-turn") {
      controller.cancel();
      requestCharacterActionFromVoice(event.text, event.sessionId, useUserStore.getState().preferences.robotName);
    } else if (event.type === "assistant-end") completeCharacterActionReply(event.sessionId);
    else if (["interrupt", "session-start", "session-end", "user-speech-start", "correction"].includes(event.type)) controller.cancel();
  });
  refreshAvailability = sync;
  const app = AppState.addEventListener("change", sync);
  const removals = [useUserStore.subscribe(sync), useConversationStore.subscribe(sync),
    subscribeLooiRobotRuntimeState(sync), subscribeMainScreenFocused(sync), removeEvents];
  sync();
  return () => { installed = false; lastContextSceneAt = -Infinity; refreshAvailability = () => {}; controller.setAvailability({ allowed: false, busy: false }); app.remove(); removals.forEach(remove => remove()); };
}
