/**
 * Thin React Native wiring: samples the real controllers into the pure body
 * sensor mapper. Read-only towards every source; nothing here moves the robot.
 */
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { getSocialAttentionControllerState } from "../core/social-attention";
import { subscribeRobotInteractions } from "../core/robot-inactivity";
import { useCharacterActionStore } from "../character/character-action-runtime";
import { useCharacterReactionStore } from "../character/character-reaction";
import { useConversationStore } from "../store/conversation";
import { useUserStore } from "../store/user";
import { isDrivingControlSessionActive } from "../voice/driving-control-session";
import { robotBodyState } from "./body-state";
import { createRobotBodySensorMapper, type RobotBodySensorSnapshot } from "./body-sensors";

/** Motion start and face frames are not pushed to listeners here, so they are polled. */
const SAMPLE_INTERVAL_MS = 250;
/** Sources that are not evidence of a human: raw server VAD (could be a TV) and remote bridge commands. */
const NON_HUMAN_INTERACTION_SOURCES = new Set(["realtime-pcm-speech-start", "robot-bridge-command"]);
/** A user message older than this when it appears is restored history, not a new turn. */
const FRESH_USER_MESSAGE_MS = 10_000;

export function readRobotBodySensorSnapshot(): RobotBodySensorSnapshot {
  const robot = getLooiRobotRuntimeState();
  const social = getSocialAttentionControllerState();
  const conversation = useConversationStore.getState();
  const user = useUserStore.getState();
  const cameraLooking = social.running && social.attentionActive && social.nativeStarted;
  return {
    robot: {
      configured: robot.configured,
      connected: robot.connected,
      motionActive: robot.motionActive,
      nearEdgeFront: robot.nearEdge.front,
      nearEdgeRear: robot.nearEdge.rear,
      cliff: robot.sensors.cliffSensors ?? null,
      drivingSession: isDrivingControlSessionActive(),
    },
    faces: cameraLooking
      ? social.faces.map((face) => ({ centerX: face.centerX, width: face.width, selected: face.trackingId === social.selectedFaceId }))
      : null,
    sleeping: user.robotSleeping,
    conversationBusy: conversation.isUserSpeaking || conversation.isProcessing || conversation.isSpeaking
      || user.voiceState === "processing" || user.voiceState === "speaking",
    displayScene: useCharacterActionStore.getState().active?.kind ?? null,
  };
}

let uninstall: (() => void) | null = null;

/** Installed once from app bootstrap. Returns an uninstaller (used by tests). */
export function installRobotBodySensors(): () => void {
  if (uninstall) return uninstall;
  const mapper = createRobotBodySensorMapper(robotBodyState);
  const sample = () => {
    try { mapper.sample(readRobotBodySensorSnapshot()); } catch (error) { console.warn("[BodySensors] sample failed", error); }
  };

  let lastReactionId = useCharacterReactionStore.getState().reactionId;
  const removeReaction = useCharacterReactionStore.subscribe((state) => {
    if (state.reactionId === lastReactionId) return;
    lastReactionId = state.reactionId;
    // Only the home face's accepted stroke; behaviour cues may also show a "petted" mood.
    if (state.mood === "petted" && state.source === "friendly-face-stroke") mapper.notePetted();
  });

  let lastUserMessageId = [...useConversationStore.getState().messages].reverse().find((message) => message.role === "user")?.id ?? null;
  const removeConversation = useConversationStore.subscribe((state) => {
    const latest = [...state.messages].reverse().find((message) => message.role === "user");
    if (latest && latest.id !== lastUserMessageId) {
      lastUserMessageId = latest.id;
      const at = Date.parse(latest.timestamp);
      if (!Number.isFinite(at) || Date.now() - at <= FRESH_USER_MESSAGE_MS) mapper.noteHumanInteraction();
    }
    sample();
  });

  const removals = [
    removeReaction,
    removeConversation,
    subscribeRobotInteractions((source) => { if (!NON_HUMAN_INTERACTION_SOURCES.has(source)) mapper.noteHumanInteraction(); }),
    subscribeLooiRobotRuntimeState(sample),
    useUserStore.subscribe(sample),
    useCharacterActionStore.subscribe(sample),
  ];
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  sample();
  uninstall = () => {
    clearInterval(timer);
    removals.forEach((remove) => remove());
    uninstall = null;
  };
  return uninstall;
}
