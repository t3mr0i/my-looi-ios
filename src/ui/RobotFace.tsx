import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  useReducedMotion,
  type SharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { isManagedConversationMode, useUserStore, type FacePaletteId } from "@/src/store/user";
import { useConversationStore } from "@/src/store/conversation";
import { isInputAttentionVisible } from "@/src/voice/input-attention";
import { looiTheme } from "@/src/ui/looi-theme";
import { useUiText } from "@/src/i18n/use-ui-text";
import { clearCharacterReaction, useCharacterReactionStore } from "@/src/character/character-reaction";
import { recordDiagnosticEvent } from "@/src/diagnostics/diagnostic-log";
import { useSocialAttentionStore } from "@/src/core/social-attention";
import { useBehaviorStore } from "@/src/behavior/behavior-runtime";
import { useObjectAttentionStore } from "@/src/core/object-attention";
import { chooseObjectAttentionGaze } from "@/src/core/object-attention-gaze";
import { resolveFacePresentation, type FaceExpression, type MouthShape } from "@/src/character/face-expression";
import { getFaceMotionProfile } from "@/src/character/face-motion";
import { cancelCharacterAction, useCharacterActionStore } from "@/src/character/character-action-runtime";
import { GlassEye, GlassMouth, type GlassGaze } from "@/src/ui/GlassFace";
import { FACE_STYLES, FACE_PALETTES, getFaceAppearanceMetrics, resolveStyledMouth, type FaceStyleVisual, type FacePaletteVisual } from "@/src/character/face-appearance";
import { FaceDecorations } from "@/src/ui/FaceDecorations";
import { CharacterProp } from "@/src/ui/CharacterProp";
import { characterSceneLabel } from "@/src/character/character-scene-catalog";
import { createCharacterChoreography, sampleCharacterChoreography, type CharacterMotionFrame } from "@/src/character/character-choreography";
import { createFaceStrokeRecognizer, type FaceStrokePoint } from "@/src/character/face-stroke";
import type { GestureResponderEvent } from "react-native";
import type { BehaviorRehearsalFaceFixture } from "@/src/behavior/behavior-rehearsal-expression";

type RobotFaceMode = "fullscreen" | "avatar";

type RobotFaceProps = {
  mode?: RobotFaceMode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Return true when immediate control/STOP consumed this contact. */
  onContactStart?: () => boolean;
  /** A deliberate stroke is consumed even if current state rejects its effect. */
  onFriendlyStroke?: () => void;
  labelVisible?: boolean;
  /** Controlled, presentation-only input used by the offline debug rehearsal. */
  fixture?: BehaviorRehearsalFaceFixture;
};

export function RobotFace(props: RobotFaceProps) {
  return <ClassicRobotFace {...props} />;
}

function ClassicRobotFace({
  mode = "fullscreen",
  onPress,
  onLongPress,
  onContactStart,
  onFriendlyStroke,
  labelVisible = mode === "fullscreen",
  fixture,
}: RobotFaceProps) {
  const storedVoiceState = useUserStore((state) => state.voiceState);
  const voiceState = fixture?.voiceState ?? storedVoiceState;
  const storedRobotSleeping = useUserStore((state) => state.robotSleeping);
  const robotSleeping = !fixture && storedRobotSleeping === true;
  const { width: viewportWidth } = useWindowDimensions();
  const systemReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(systemReducedMotion);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [screenFocused, setScreenFocused] = useState(false);

  const faceStyleId = useUserStore((state) => state.preferences.faceStyle);
  const facePaletteId = useUserStore((state) => state.preferences.facePalette);
  const faceStyle = FACE_STYLES[faceStyleId] ?? FACE_STYLES.classic;
  const palette = FACE_PALETTES[facePaletteId] ?? FACE_PALETTES.cyan;
  // Generated text may run ahead of audio. Only the playback-owned section can
  // select a speaking expression; unavailable alignment deliberately stays neutral.
  const heardSpeechText = useConversationStore((state) => state.heardSpeechText);
  const streamingText = fixture ? "" : heardSpeechText ?? "";
  const realtimeReadiness = useConversationStore((state) => state.realtimeReadiness);
  const inputAttentionCue = useConversationStore((state) => state.inputAttention);
  const activeSessionId = useConversationStore((state) => state.activeSessionId);
  const conversationMode = useUserStore((state) => state.preferences.conversationMode);
  const storedCharacterMood = useCharacterReactionStore((state) => state.mood);
  const characterMood = fixture ? null : storedCharacterMood;
  const storedAction = useCharacterActionStore((state) => state.active);
  const action = fixture ? fixture.action ?? null : storedAction;
  const storedBehaviorPresentation = useBehaviorStore((state) => state.presentation);
  const storedFeedback = useBehaviorStore((state) => state.feedback);
  const feedback = fixture ? null : storedFeedback;
  const behaviorPresentation = fixture ? fixture.presentation : storedBehaviorPresentation;
  const behaviorReactionKey = fixture ? fixture.presentation?.expressionPhase : storedBehaviorPresentation?.id;
  const sharedScene = useBehaviorStore((state) => state.state.companion.scene);
  const inputAttentionBlocked = useBehaviorStore((state) => !!state.state.pendingIntention || state.state.repairRequired
    || !!state.state.companion.pendingExperience || state.state.companion.scene.status === "armed"
    || state.state.game?.status === "active" || state.state.game?.status === "paused");
  const objectStatus = useObjectAttentionStore((state) => state.status);
  const objectGaze = useObjectAttentionStore((state) => state.gaze);
  const activityAttention = useObjectAttentionStore((state) => state.activityAttention);
  const userSpeaking = useConversationStore((state) => state.isUserSpeaking);
  const assistantSpeaking = useConversationStore((state) => state.isSpeaking);
  const speaking = !robotSleeping && (voiceState === "speaking" || (!fixture && assistantSpeaking));
  const displayVoiceState = robotSleeping ? "sleeping" : speaking ? "speaking" : voiceState;
  const [showObjectLoss, setShowObjectLoss] = useState(false);
  const { t, language } = useUiText();
  const characterReactionId = useCharacterReactionStore((state) => state.reactionId);
  const socialAttentionActive = useSocialAttentionStore((state) => state.active);
  const socialFaceVisible = useSocialAttentionStore((state) => state.faceVisible);
  const socialGazeX = useSocialAttentionStore((state) => state.gazeX);
  const socialGazeY = useSocialAttentionStore((state) => state.gazeY);
  const blink = useSharedValue(1);
  const gaze = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const breathe = useSharedValue(0);
  const mouthPulse = useSharedValue(0);
  const actionProgress = useSharedValue(0);
  const actionClockKey = useSharedValue("");
  const pose = useSharedValue({ tilt: 0, lift: 0 });
  const reactionBeat = useSharedValue(0);
  const touch = useSharedValue(0);
  const longPressFired = useRef(false);
  const stroke = useRef(createFaceStrokeRecognizer());
  const contact = useRef({ started: false, consumed: false, strokeHandled: false });
  const isAvatar = mode === "avatar";
  const motionActive = !reducedMotion && appActive && screenFocused && !robotSleeping;
  const inputAttention = !fixture && !isAvatar && appActive && screenFocused && !robotSleeping && !inputAttentionBlocked
    && realtimeReadiness === "ready" && isInputAttentionVisible(inputAttentionCue, activeSessionId, performance.now());
  const faceScale = isAvatar ? 1 : Math.min(1, Math.max(0.55, (viewportWidth - 40) / 360));

  useEffect(() => {
    let mounted = true;
    let eventGeneration = 0;
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (!mounted) return;
      eventGeneration += 1;
      setReducedMotion(enabled);
    });
    const queryGeneration = eventGeneration;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted && queryGeneration === eventGeneration) setReducedMotion(enabled);
    }).catch(() => {});
    const app = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));

  useEffect(() => {
    if (!appActive || !screenFocused || robotSleeping) {
      stroke.current.cancel();
      contact.current.consumed = true;
    }
    return () => { stroke.current.cancel(); };
  }, [appActive, screenFocused, robotSleeping]);

  useEffect(() => {
    if (!motionActive) { cancelAnimation(touch); touch.value = 0; }
    return () => cancelAnimation(touch);
  }, [motionActive, touch]);
  const usualStatusLabel = robotSleeping ? t("face.sleeping") : isManagedConversationMode(conversationMode)
    ? displayVoiceState === "speaking"
      ? t("face.speaking")
      : displayVoiceState === "processing"
        ? t("face.thinking")
        : realtimeReadiness === "preparing-microphone"
          ? t("overlay.preparingMic")
          : realtimeReadiness === "connecting"
            ? t("overlay.connecting")
            : realtimeReadiness === "ready"
              ? t("overlay.readyListening")
              : realtimeReadiness === "microphone-error"
                ? t("overlay.micNotReady")
                : realtimeReadiness === "error"
                  ? t("overlay.noConnection")
                  : t("face.tapToStart")
    : displayVoiceState === "sleeping"
      ? t("face.ready")
      : displayVoiceState === "attention"
        ? t("face.here")
        : displayVoiceState === "listening"
          ? t("face.listening")
          : displayVoiceState === "processing"
            ? t("face.thinking")
            : displayVoiceState === "speaking"
              ? t("face.speaking")
              : t("face.verifying");
  const statusLabel = feedback && !robotSleeping && !speaking
    ? t(feedback.mood === "repairing" ? "face.clarifying" : feedback.mood === "clarified" ? "face.understood"
      : feedback.mood === "expectant" ? "face.yourGuess" : "face.wellDone")
    : !fixture && !robotSleeping && sharedScene.status === "armed" && displayVoiceState !== "speaking" && displayVoiceState !== "processing" && displayVoiceState !== "sleeping"
    ? t(sharedScene.signal === "open_palm" ? "face.waitingForPalm" : "face.waitingForStart")
    : usualStatusLabel;
  const presentation = useMemo(
    () => resolveFacePresentation({ robotSleeping, voiceState, streamingText, characterMood,
      behaviorMood: feedback?.kind === "game" ? feedback.mood : behaviorPresentation?.mood ?? null,
      feedbackMood: feedback?.kind !== "game" ? feedback?.mood : null, assistantSpeaking: !fixture && assistantSpeaking, action, inputAttention }),
    [action, assistantSpeaking, behaviorPresentation, characterMood, feedback, fixture, inputAttention, robotSleeping, streamingText, voiceState]
  );
  const face = presentation.expression;
  const characterReactionVisible = presentation.characterReactionVisible;
  const motionProfile = getFaceMotionProfile(face.emotion);
  const visibleAction = presentation.source === "action" ? action : null;
  const choreography = useMemo(() => visibleAction ? createCharacterChoreography(visibleAction.kind, visibleAction.phase) : null, [visibleAction]);
  const actionPhase = visibleAction?.phase ?? "reveal";
  const expectedClockKey = visibleAction ? `${visibleAction.id}:${visibleAction.kind}:${visibleAction.phase}` : "";
  const inspectionProgress = fixture?.actionProgress;
  const inspectionSpeed = fixture?.actionSpeed ?? 1;
  const actionMotion = useDerivedValue(() => choreography
    ? sampleCharacterChoreography(choreography, actionPhase, actionClockKey.value === expectedClockKey ? actionProgress.value : 0, !motionActive) : null);
  const currentStatusLabel = visibleAction ? t("characterScene.showing", { name: characterSceneLabel(visibleAction.kind, language) }) : statusLabel;

  useEffect(() => {
    if (fixture || isAvatar || !inputAttentionCue) return;
    const clear = () => useConversationStore.getState().clearInputAttention(inputAttentionCue.id);
    // Discard suppressed cues so a game, STOP or another state cannot reveal them later.
    if (!inputAttention || presentation.source !== "input") { clear(); return; }
    const effectMs = performance.now();
    // Capture the React effect boundary, then defer the diagnostic write out of
    // the input path. This is explicitly not a pixel or microphone timestamp.
    const diagnosticTimer = setTimeout(() => recordDiagnosticEvent("latency", "input-attention-presentation", {
      sessionId: inputAttentionCue.sessionId, mode: conversationMode, clock: "js-performance",
      receiptToRequestMs: inputAttentionCue.requestedAtMs - inputAttentionCue.receivedAtMs,
      receiptToPresentationEffectMs: effectMs - inputAttentionCue.receivedAtMs,
      requestToPresentationEffectMs: effectMs - inputAttentionCue.requestedAtMs,
      evidence: "JS input receipt to React effect; excludes capture, bridge, compositor and visible pixels",
    }), 0);
    const timer = setTimeout(clear, Math.max(0, inputAttentionCue.expiresAtMs - performance.now()));
    return () => { clearTimeout(timer); clearTimeout(diagnosticTimer); };
  }, [conversationMode, fixture, inputAttention, inputAttentionCue, isAvatar, presentation.source]);

  useEffect(() => {
    if (fixture || isAvatar) return;
    return () => useConversationStore.getState().clearInputAttention();
  }, [fixture, isAvatar]);

  useEffect(() => {
    if (!fixture && action && presentation.source !== "action") cancelCharacterAction("face-priority", action.id);
  }, [action, fixture, presentation.source]);

  useEffect(() => {
    if (fixture || !characterMood || characterReactionVisible
      || (feedback?.kind === "game" && !["sleep", "speech", "pipeline", "action"].includes(presentation.source))) return;
    if (!feedback && !["sleep", "speech", "pipeline", "action"].includes(presentation.source)) return;
    // A suppressed reaction must not return when speech or sleep relinquishes
    // the face. Leave any newer reaction installed after this render alone.
    if (useCharacterReactionStore.getState().reactionId === characterReactionId) {
      clearCharacterReaction(`face-priority-${presentation.source}`);
    }
  }, [characterMood, characterReactionId, characterReactionVisible, feedback, fixture, presentation.source]);

  useEffect(() => {
    if (!characterMood) return;
    recordDiagnosticEvent("character", "reaction-render-state", {
      mood: characterMood,
      reactionId: characterReactionId,
      voiceState,
      conversationMode,
      visible: characterReactionVisible,
    });
  }, [characterMood, characterReactionId, characterReactionVisible, conversationMode, voiceState]);

  useEffect(() => {
    blink.value = 1;
    if (!motionActive) return;
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const scheduleBlink = () => {
      timer = setTimeout(() => {
        const close = () => withTiming(0.07, { duration: 65 });
        const open = () => withTiming(1, { duration: 125, easing: Easing.out(Easing.cubic) });
        // A sparse double blink keeps the rhythm from feeling like a metronome.
        blink.value = ++count % 3 === 0
          ? withSequence(close(), open(), withTiming(1, { duration: 100 }), close(), open())
          : withSequence(close(), open());
        scheduleBlink();
      }, (voiceState === "processing" ? 2400 : 3400) + Math.random() * 2200);
    };
    scheduleBlink();
    return () => { clearTimeout(timer); cancelAnimation(blink); };
  }, [blink, motionActive, voiceState]);

  useEffect(() => {
    const target = { tilt: motionActive ? face.headTilt : 0, lift: motionActive ? face.lift : 0 };
    pose.value = motionActive
      ? withTiming(target, { duration: motionProfile.poseTransitionMs, easing: Easing.out(Easing.cubic) })
      : target;
    return () => cancelAnimation(pose);
  }, [face.headTilt, face.lift, motionActive, motionProfile.poseTransitionMs, pose]);

  useEffect(() => {
    cancelAnimation(reactionBeat);
    reactionBeat.value = 0;
    if (!motionActive || presentation.source === "action") return;
    if (!motionProfile.beats.length) return;
    const [first, ...rest] = motionProfile.beats.map((beat) =>
      withTiming(beat.value, { duration: beat.durationMs, easing: Easing.out(Easing.cubic) }));
    reactionBeat.value = withSequence(first, ...rest);
    return () => cancelAnimation(reactionBeat);
  }, [behaviorReactionKey, characterReactionId, motionProfile, motionActive, presentation.source, reactionBeat]);

  useEffect(() => {
    setShowObjectLoss(objectStatus === "lost");
    if (objectStatus !== "lost") return;
    const timer = setTimeout(() => setShowObjectLoss(false), 1_200);
    return () => clearTimeout(timer);
  }, [objectStatus]);

  useEffect(() => {
    // A reading scan belongs to the scene phase. Camera attention updates must
    // not cancel or restart it while that phase still owns the face.
    if (visibleAction) return;
    cancelAnimation(gaze);
    cancelAnimation(gazeY);
    const attention = fixture ? null : chooseObjectAttentionGaze({ userSpeaking, assistantSpeaking: speaking,
      person: socialAttentionActive && socialFaceVisible ? { x: socialGazeX, y: socialGazeY } : null,
      object: objectGaze, tracking: objectStatus === "tracking", showLoss: showObjectLoss,
      activityAttention });
    if (robotSleeping) {
      gaze.value = 0;
      gazeY.value = 0;
      return;
    }
    if (feedback && !speaking) {
      const x = socialAttentionActive && socialFaceVisible ? socialGazeX : 0;
      const y = socialAttentionActive && socialFaceVisible ? socialGazeY : 0;
      gaze.value = motionActive ? withTiming(x, { duration: 180 }) : x;
      gazeY.value = motionActive ? withTiming(y, { duration: 180 }) : y;
      return;
    }
    if (!motionActive) {
      gaze.value = Math.max(-1, Math.min(1, attention?.gaze.x ?? (!speaking ? behaviorPresentation?.gaze?.x : undefined) ?? 0));
      gazeY.value = Math.max(-1, Math.min(1, attention?.gaze.y ?? (!speaking ? behaviorPresentation?.gaze?.y : undefined) ?? 0));
      return;
    }
    if (attention) {
      gaze.value = withTiming(attention.gaze.x, { duration: 150 });
      gazeY.value = withTiming(attention.gaze.y, { duration: 150 });
    } else if (!speaking && behaviorPresentation?.gaze) {
      gaze.value = withTiming(Math.max(-1, Math.min(1, behaviorPresentation.gaze.x)), { duration: 180 });
      gazeY.value = withTiming(Math.max(-1, Math.min(1, behaviorPresentation.gaze.y)), { duration: 180 });
    } else if (!fixture && socialAttentionActive && socialFaceVisible) {
      gaze.value = withTiming(socialGazeX, { duration: 110 });
      gazeY.value = withTiming(socialGazeY, { duration: 110 });
    } else if (displayVoiceState === "processing") {
      gaze.value = withRepeat(
        withSequence(
          withTiming(-0.65, { duration: 200 }), withTiming(-0.65, { duration: 1100 }),
          withTiming(0.4, { duration: 220 }), withTiming(0.4, { duration: 1500 })
        ),
        -1
      );
      gazeY.value = withTiming(-0.35, { duration: 180 });
    } else if (displayVoiceState === "sleeping") {
      gaze.value = withRepeat(
        withSequence(withTiming(-0.45, { duration: 3000 }), withTiming(0.45, { duration: 3400 })),
        -1,
        true
      );
      gazeY.value = withTiming(0, { duration: 180 });
    } else {
      gaze.value = withTiming(0, { duration: 180 });
      gazeY.value = withTiming(0, { duration: 180 });
    }
    return () => {
      cancelAnimation(gaze);
      cancelAnimation(gazeY);
    };
  }, [activityAttention, assistantSpeaking, behaviorPresentation, displayVoiceState, feedback, fixture, gaze, gazeY, motionActive, objectGaze, objectStatus, robotSleeping, showObjectLoss, socialAttentionActive, socialFaceVisible, socialGazeX, socialGazeY, speaking, userSpeaking, visibleAction]);

  useEffect(() => {
    cancelAnimation(actionProgress); actionProgress.value = 0;
    actionClockKey.value = expectedClockKey;
    if (typeof inspectionProgress === "number") actionProgress.value = Math.max(0, Math.min(1, inspectionProgress));
    else if (choreography && motionActive) actionProgress.value = withTiming(1, { duration: choreography.duration / inspectionSpeed, easing: Easing.linear });
    return () => cancelAnimation(actionProgress);
  }, [actionClockKey, actionProgress, choreography, expectedClockKey, inspectionProgress, inspectionSpeed, motionActive]);

  useEffect(() => {
    breathe.value = 0;
    if (!motionActive) return;
    const duration = speaking ? 820 : voiceState === "listening" ? 1400 : 2200;
    breathe.value = withRepeat(
      withSequence(withTiming(1, { duration }), withTiming(0, { duration })),
      -1
    );
    return () => cancelAnimation(breathe);
  }, [breathe, motionActive, speaking, voiceState]);

  useEffect(() => {
    cancelAnimation(mouthPulse);
    if (motionActive && speaking) {
      mouthPulse.value = withRepeat(
        withSequence(withTiming(1, { duration: 180 }), withTiming(0, { duration: 240 })),
        -1
      );
    } else {
      mouthPulse.value = 0;
    }
    return () => cancelAnimation(mouthPulse);
  }, [mouthPulse, motionActive, speaking]);

  // The light core follows the existing attention target inside the glass.
  // Keep the larger outer shells almost still so the pair remains composed.
  const glassGaze = useDerivedValue(() => ({
    x: actionMotion.value?.gazeX ?? gaze.value,
    y: actionMotion.value?.gazeY ?? gazeY.value,
  }));
  const gazeTravelX = isAvatar ? 1 : 5;
  const gazeTravelY = isAvatar ? .6 : 3;
  const eyeMotionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(actionMotion.value?.gazeX ?? gaze.value, [-1, 1], [-gazeTravelX, gazeTravelX]) },
      {
        translateY:
          interpolate(actionMotion.value?.gazeY ?? gazeY.value, [-1, 1], [-gazeTravelY, gazeTravelY]) +
          interpolate(breathe.value, [0, 1], [0, speaking ? -2 : -1]),
      },
    ],
  }));

  const facePoseStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: faceScale * (1 - touch.value * 0.025) },
      { translateY: (-pose.value.lift - (actionMotion.value?.lift ?? 0) + reactionBeat.value * motionProfile.liftPx) * (isAvatar ? 0.2 : 1) },
      { rotate: `${pose.value.tilt + (actionMotion.value?.tilt ?? 0) + reactionBeat.value * motionProfile.tiltDeg}deg` },
      { scaleY: actionMotion.value?.squash ?? 1 },
    ],
  }));

  const metrics = getFaceAppearanceMetrics(faceStyle, isAvatar);
  const styledMouth = resolveStyledMouth(face, faceStyle);

  const content = (
    <View style={[styles.wrap, isAvatar ? styles.avatarWrap : styles.fullscreenWrap]}>
      <Animated.View style={[styles.faceStage, isAvatar && styles.avatarFaceStage, facePoseStyle]}>
        <FaceDecorations faceStyle={faceStyle} palette={palette} isAvatar={isAvatar} metrics={metrics} motionStyle={eyeMotionStyle} />
        <Animated.View style={[styles.eyeRow, isAvatar && styles.avatarEyeRow, { gap: metrics.eyeGap, top: metrics.eyeTop, height: metrics.eyeHeight }, eyeMotionStyle]}>
          {(["left", "right"] as const).map((side) => (
            <ExpressiveEye key={side} side={side} expression={face} width={metrics.eyeWidth} height={metrics.eyeHeight}
              faceStyle={faceStyle} palette={palette} paletteId={facePaletteId} gaze={glassGaze} blink={blink} isAvatar={isAvatar} motionActive={motionActive} />
          ))}
        </Animated.View>
        <ExpressiveMouth shape={styledMouth.shape} width={styledMouth.width}
          color={palette.mouthColor} paletteId={facePaletteId} pulse={mouthPulse} actionMotion={actionMotion} isAvatar={isAvatar} motionActive={motionActive} transitionMs={motionProfile.mouthTransitionMs} />
        {visibleAction ? <CharacterProp frame={visibleAction} color={palette.accentColor} isAvatar={isAvatar} motionActive={motionActive} motion={actionMotion} /> : null}
      </Animated.View>
      {labelVisible ? (
        <View style={[styles.caption, isAvatar && styles.avatarCaption, visibleAction && { transform: [{ translateY: isAvatar ? 12 : 72 }] }]}>
          <Text style={[styles.captionText, isAvatar && styles.avatarCaptionText]}>
            {currentStatusLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const pointFrom = (event: GestureResponderEvent): FaceStrokePoint | null => {
    const native = event.nativeEvent;
    const touch = native.changedTouches?.[0] ?? native.touches?.[0] ?? native;
    return touch && touch.identifier != null && Number.isFinite(touch.pageX) && Number.isFinite(touch.pageY) && Number.isFinite(touch.timestamp)
      ? { identifier: String(touch.identifier), x: touch.pageX, y: touch.pageY, timestamp: touch.timestamp } : null;
  };
  const finishContact = (event: GestureResponderEvent): boolean => {
    if (!event?.nativeEvent?.changedTouches && !event?.nativeEvent?.touches) return false;
    if (contact.current.consumed) return true;
    if (!onFriendlyStroke) return false;
    if (!contact.current.started) return false; // VoiceOver's ordinary activate action.
    const point = pointFrom(event);
    if (!point) { stroke.current.cancel(); return true; }
    const ids = new Set([...(event.nativeEvent.touches ?? []), ...(event.nativeEvent.changedTouches ?? [])].map(touch => String(touch.identifier)));
    const result = stroke.current.finish(point, Math.max(1, ids.size));
    if (result === "stroke") {
      if (!contact.current.strokeHandled) {
        contact.current.strokeHandled = true;
        onFriendlyStroke?.();
      }
      return true;
    }
    return result === "cancelled";
  };
  if (!onPress && !onLongPress && !onFriendlyStroke) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={currentStatusLabel}
      accessibilityHint={t("face.accessibilityHint")}
      accessibilityActions={onFriendlyStroke ? [{ name: "pet", label: t("face.petAction") }] : undefined}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "pet") onFriendlyStroke?.(); }}
      onTouchStart={(event) => {
        if (!fixture && !isAvatar) useConversationStore.getState().clearInputAttention();
        const point = pointFrom(event);
        contact.current = { started: true, consumed: onContactStart?.() === true, strokeHandled: false };
        longPressFired.current = false;
        if (!point || contact.current.consumed) stroke.current.cancel();
        else stroke.current.start(point, event.nativeEvent.touches?.length ?? 1);
      }}
      onTouchMove={(event) => {
        const point = pointFrom(event);
        if (!point) stroke.current.cancel();
        else stroke.current.move(point, event.nativeEvent.touches?.length ?? 1);
      }}
      onTouchEnd={finishContact}
      onTouchCancel={() => { stroke.current.cancel(); contact.current.consumed = true; }}
      onPressIn={() => {
        longPressFired.current = false;
        if (motionActive) touch.value = withTiming(1, { duration: 90 });
      }}
      onPressOut={() => {
        touch.value = motionActive ? withTiming(0, { duration: 160 }) : 0;
      }}
      onLongPress={onLongPress ? () => {
        if (contact.current.consumed || stroke.current.moved) return;
        longPressFired.current = true;
        stroke.current.cancel();
        onLongPress();
      } : undefined}
      delayLongPress={520}
      onPress={(event) => {
        if (!finishContact(event) && !longPressFired.current) onPress?.();
      }}
      style={styles.pressable}
    >
      {content}
    </Pressable>
  );
}

type ExpressiveEyeProps = {
  side: "left" | "right";
  expression: FaceExpression;
  width: number;
  height: number;
  faceStyle: FaceStyleVisual;
  palette: FacePaletteVisual;
  paletteId: FacePaletteId;
  gaze: SharedValue<GlassGaze>;
  blink: SharedValue<number>;
  isAvatar: boolean;
  motionActive: boolean;
};

function ExpressiveEye({ faceStyle, palette, ...props }: ExpressiveEyeProps) {
  return <GlassEye {...props} primaryColor={palette.eyeColor}
    rotationOffset={props.side === "left" ? faceStyle.leftEyeRotationOffset : faceStyle.rightEyeRotationOffset} />;
}

function ExpressiveMouth(props: {
  shape: MouthShape; width: number; color: string; paletteId: FacePaletteId;
  pulse: SharedValue<number>; actionMotion: SharedValue<CharacterMotionFrame | null>;
  isAvatar: boolean; motionActive: boolean; transitionMs: number;
}) {
  return <GlassMouth {...props} />;
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "visible",
  },
  faceStage: { width: 360, height: 260, alignItems: "center", justifyContent: "center", overflow: "visible" },
  avatarFaceStage: { width: 92, height: 70 },
  fullscreenWrap: {
    width: "100%",
    minHeight: 340,
  },
  avatarWrap: {
    width: 92,
    height: 92,
  },
  eyeRow: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  avatarEyeRow: {},
  caption: {
    position: "absolute",
    top: 254,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "rgba(3, 13, 24, 0.62)",
  },
  avatarCaption: {
    top: 69,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  captionText: {
    color: looiTheme.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  avatarCaptionText: {
    fontSize: 8,
  },
});
