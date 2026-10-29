import {
  forceReconnectSavedLooiRobot,
  startLooiRobotAutoConnection,
} from "@/src/device-tools/looi-robot-autoconnect";
import {
  getLooiRobotRuntimeState,
  performLooiCharacterReaction,
  subscribeLooiRobotRuntimeState,
} from "@/src/device-tools/looi-robot";
import { voiceRuntime } from "@/src/perceivers/voice-runtime";
import {
  computeSetupReadiness,
  type SetupReadiness,
} from "@/src/setup/setup-readiness";
import { ConversationOverlay } from "@/src/ui/ConversationOverlay";
import { ImageOverlay } from "@/src/ui/ImageOverlay";
import { HomeMenu, type HomeMenuHandle } from "@/src/ui/HomeMenu";
import { cancelCharacterAction, requestCharacterAction } from "@/src/character/character-action-runtime";
import { ObjectAttentionControl } from "@/src/ui/ObjectAttentionControl";
import { looiTheme } from "@/src/ui/looi-theme";
import { useRobotDebugState } from "@/src/ui/use-robot-debug-state";
import { createRobotDebugTranslator } from "@/src/i18n/robot-debug-strings";
import { RobotFace } from "@/src/ui/RobotFace";
import { type ResponseLanguage } from "@/src/language/response-language";
import { type ListeningLanguage } from "@/src/language/listening-language";
import { wakeRobotFromFace } from "@/src/core/sleep-mode";
import { isMainScreenFocused, setMainScreenFocused } from "@/src/core/main-screen-presence";
import { recordFriendlyStroke, useBehaviorStore } from "@/src/behavior/behavior-runtime";
import { useUserStore } from "@/src/store/user";
import { useConversationStore } from "@/src/store/conversation";
import { useUiText } from "@/src/i18n/use-ui-text";
import { recordDiagnosticEvent } from "@/src/diagnostics/diagnostic-log";
import { selectPhotosIntoCurrentDiscussion } from "@/src/vision/photo-picker-context";
import { triggerCharacterReaction } from "@/src/character/character-reaction";
import { classifyFaceTapImmediateRoute } from "@/src/character/face-tap-routing";
import { isDrivingControlSessionActive } from "@/src/voice/driving-control-session";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function IndexScreen() {
  const router = useRouter();
  const robotDebug = useRobotDebugState();
  const insets = useSafeAreaInsets();
  const menuRef = useRef<HomeMenuHandle>(null);
  const [objectOpenRequest, setObjectOpenRequest] = useState(0);
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null);
  const [robotRuntimeState, setRobotRuntimeState] = useState(() => getLooiRobotRuntimeState());
  const [photoPickerBusy, setPhotoPickerBusy] = useState(false);
  const sleepTapAtRef = useRef(0);
  const idleTapCountRef = useRef(0);
  const idleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFocusedMainOnceRef = useRef(false);
  const robotSleeping = useUserStore((state) => state.robotSleeping);
  const listeningLanguage = useUserStore((state) => state.preferences.listeningLanguage);
  const responseLanguage = useUserStore((state) => state.preferences.language);
  const updatePreferences = useUserStore((state) => state.updatePreferences);
  const { t, language } = useUiText();
  const debugText = createRobotDebugTranslator(language);

  useEffect(() => () => {
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = null;
  }, []);

  useEffect(() => {
    startLooiRobotAutoConnection().catch((error) => {
      console.warn("[Home] LOOI robot auto-connect failed:", error);
    });
  }, []);

  useEffect(() => {
    const syncRobotState = () => setRobotRuntimeState(getLooiRobotRuntimeState());
    syncRobotState();
    return subscribeLooiRobotRuntimeState(syncRobotState);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setMainScreenFocused(true);
      const returningFromNavigation = hasFocusedMainOnceRef.current;
      hasFocusedMainOnceRef.current = true;
      recordDiagnosticEvent("navigation", "main-focused", {
        reason: returningFromNavigation ? "navigation-return" : "initial",
      });

      if (!useUserStore.getState().robotSleeping) {
        if (returningFromNavigation) {
          // Returning from Settings/another in-app route is an attention signal
          // just like fresh launch. Do not require Луи/Макс or a face tap.
          void voiceRuntime.resumeMainScreenConversation("navigation-return").catch((error) => {
            console.warn("[Home] Failed to resume conversation on navigation return:", error);
          });
        } else {
          // Preserve the existing fresh-launch auto-listen timer; only make sure
          // we re-arm voice runtime on focus and its wakeword substrate is healthy.
          void voiceRuntime.rearmWakewordAfterNavigation().catch((error) => {
            console.warn("[Home] Failed to re-arm voice runtime on initial focus:", error);
          });
        }
      }

      return () => {
        setMainScreenFocused(false);
        recordDiagnosticEvent("navigation", "main-blurred");
        // Internal navigation is not Android background. It has its own explicit
        // Realtime ownership boundary so Settings never inherits a live session.
        void voiceRuntime.suspendMainScreenConversation("navigation-main-blur").catch((error) => {
          console.warn("[Home] Failed to suspend Realtime on main blur:", error);
        });
      };
    }, [])
  );

  useEffect(() => {
    let cancelled = false;
    computeSetupReadiness()
      .then((next) => {
        if (!cancelled) setReadiness(next);
      })
      .catch((error) => {
        console.warn("[Home] Failed to compute setup readiness:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const repairStep = readiness?.modelsReady === false ? "models" : null;

  const connectRobot = useCallback(async () => {
    const current = getLooiRobotRuntimeState();
    if (current.connected || current.connecting) return;
    try {
      const result = await forceReconnectSavedLooiRobot();
      if (!result.ok && result.reason === "no-saved-robot") {
        router.replace("/settings");
        return;
      }
      if (!result.ok) throw new Error(`Robot reconnect skipped: ${result.reason ?? "unknown"}`);
    } catch (error) {
      console.warn("[Home] LOOI connect failed:", error);
      recordDiagnosticEvent("robot", "ble-force-reconnect-ui-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Runtime state carries the authoritative BLE error; force a UI refresh in
      // case the transport rejected before publishing its own state change.
      setRobotRuntimeState(getLooiRobotRuntimeState());
    }
  }, [router]);

  const choosePhotosForDiscussion = useCallback(async () => {
    if (photoPickerBusy || useUserStore.getState().robotSleeping) return;
    setPhotoPickerBusy(true);
    try {
      const result = await selectPhotosIntoCurrentDiscussion();
      recordDiagnosticEvent("vision", "photo-picker-ui-finished", {
        selected: result.selected,
        cancelled: result.cancelled,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordDiagnosticEvent("vision", "photo-picker-ui-failed", { error: message });
      Alert.alert(t("home.photoPickerErrorTitle"), t("home.photoPickerErrorBody"));
    } finally {
      setPhotoPickerBusy(false);
    }
  }, [photoPickerBusy, t]);

  const runIdlePhysicalReaction = useCallback((reaction: "annoyed" | "angry") => {
    const current = getLooiRobotRuntimeState();
    if (!current.connected || current.motionActive || isDrivingControlSessionActive()) return;
    void performLooiCharacterReaction(reaction).catch((error) => {
      recordDiagnosticEvent("character", "tap-physical-reaction-skipped", {
        reaction,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);

  const handleAwakeFaceTap = useCallback(() => {
    cancelCharacterAction("face-tap");
    const current = getLooiRobotRuntimeState();
    const voiceState = useUserStore.getState().voiceState;
    const conversation = useConversationStore.getState();

    const immediateRoute = classifyFaceTapImmediateRoute({
      motionActive: current.motionActive,
      drivingSessionActive: isDrivingControlSessionActive(),
      conversationProcessing: conversation.isProcessing,
      conversationSpeaking: conversation.isSpeaking,
      voiceState,
    });

    // Hard safety/control ownership and real Classic output/processing states
    // always win immediately. Passive listening deliberately falls through to
    // the burst discriminator so 2+/3+ taps are not swallowed after launch.
    if (immediateRoute !== "burst") {
      recordDiagnosticEvent("character", "face-tap-routed", { route: immediateRoute, voiceState });
      void voiceRuntime.trigger().catch((error) => {
        console.warn("[Home] Face immediate trigger failed:", error);
      });
      return;
    }

    idleTapCountRef.current += 1;
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = setTimeout(() => {
      idleTapTimerRef.current = null;
      const taps = idleTapCountRef.current;
      idleTapCountRef.current = 0;
      if (taps <= 1) {
        recordDiagnosticEvent("character", "face-tap-routed", { route: "classic-attention", taps, voiceState });
        // Keep single tap = conversation, but give the face a quick startle
        // before the normal attention/listening state takes over. No motor/head
        // noise is generated here, so the microphone capture stays clean.
        triggerCharacterReaction("startled", { durationMs: 520, source: "single-face-tap" });
        void voiceRuntime.trigger().catch((error) => {
          console.warn("[Home] Face attention trigger failed:", error);
        });
        return;
      }

      void (async () => {
        const prepared = await voiceRuntime.prepareIdleCharacterReaction();
        if (!prepared.ok && prepared.reason === "realtime-active") {
          // Realtime listening/speaking must not swallow the Character Layer.
          // A burst first interrupts any current model output, then keeps the
          // same 2-tap annoyed / 3+-tap angry reaction used while Classic is idle.
          await voiceRuntime.trigger().catch((error) => {
            console.warn("[Home] Realtime face burst interrupt failed:", error);
          });
          if (taps === 2) {
            recordDiagnosticEvent("character", "face-tap-routed", { route: "character-annoyed", taps, prepared: "realtime-interrupted" });
            triggerCharacterReaction("annoyed", { durationMs: 1_050, source: "double-face-tap" });
            recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "annoyed" });
            runIdlePhysicalReaction("annoyed");
          } else {
            recordDiagnosticEvent("character", "face-tap-routed", { route: "character-angry", taps, prepared: "realtime-interrupted" });
            triggerCharacterReaction("angry", { durationMs: 1_450, source: "repeated-face-tap" });
            recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "angry" });
            runIdlePhysicalReaction("angry");
          }
          return;
        }
        if (!prepared.ok) {
          recordDiagnosticEvent("character", "face-tap-routed", {
            route: "classic-active-after-burst",
            taps,
            reason: prepared.reason,
          });
          await voiceRuntime.trigger().catch((error) => {
            console.warn("[Home] Face burst fallback trigger failed:", error);
          });
          return;
        }

        if (taps === 2) {
          recordDiagnosticEvent("character", "face-tap-routed", { route: "character-annoyed", taps, prepared: prepared.reason });
          triggerCharacterReaction("annoyed", { durationMs: 1_050, source: "double-face-tap" });
          recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "annoyed" });
          runIdlePhysicalReaction("annoyed");
          return;
        }
        recordDiagnosticEvent("character", "face-tap-routed", { route: "character-angry", taps, prepared: prepared.reason });
        triggerCharacterReaction("angry", { durationMs: 1_450, source: "repeated-face-tap" });
        recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "angry" });
        runIdlePhysicalReaction("angry");
      })();
    }, 280);
  }, [runIdlePhysicalReaction]);

  const handleFaceContactStart = useCallback(() => {
    if (AppState.currentState !== "active" || !isMainScreenFocused()) return true;
    cancelCharacterAction("face-contact");
    const robot = getLooiRobotRuntimeState();
    const conversation = useConversationStore.getState();
    const user = useUserStore.getState();
    const route = classifyFaceTapImmediateRoute({ motionActive: robot.motionActive,
      drivingSessionActive: isDrivingControlSessionActive(), conversationProcessing: conversation.isProcessing,
      conversationSpeaking: conversation.isSpeaking, voiceState: user.voiceState });
    if (user.robotSleeping && route !== "driving-stop" && route !== "driving-session-exit") return false;
    if (route === "burst") return false;
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = null; idleTapCountRef.current = 0;
    recordDiagnosticEvent("character", "face-contact-control", { route });
    void voiceRuntime.trigger().catch((error) => console.warn("[Home] Face control contact failed:", error));
    return true;
  }, []);

  const handleFriendlyStroke = useCallback(() => {
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = null; idleTapCountRef.current = 0;
    if (AppState.currentState !== "active" || !isMainScreenFocused()) return;
    // Recheck controls on release: motion or output may have started mid-stroke.
    if (handleFaceContactStart()) return;
    if (useUserStore.getState().robotSleeping) return;
    const feedback = useBehaviorStore.getState().feedback;
    if (useConversationStore.getState().isUserSpeaking || (feedback && feedback.kind !== "game")) return;
    const affection = recordFriendlyStroke();
    triggerCharacterReaction("petted", { durationMs: affection?.durationMs ?? 1100, source: "friendly-face-stroke" });
  }, [handleFaceContactStart]);

  const revealMenu = useCallback(() => menuRef.current?.reveal(), []);

  const robotConnectionMode = robotRuntimeState.connecting
    ? "connecting"
    : robotRuntimeState.connected
      ? "connected"
      : robotRuntimeState.lastError
        ? "error"
        : "disconnected";

  const robotConnectionLabel = robotDebug.mode === "mock"
    ? `${debugText("mockBadge")} · ${debugText(robotRuntimeState.connected ? "connected" : "notConnected")}`
    : robotDebug.mode === "disconnected" ? debugText("offlineBadge")
    : robotConnectionMode === "connecting"
    ? t("home.robot.connecting")
    : robotConnectionMode === "connected"
      ? t("home.robot.connected")
      : robotConnectionMode === "error"
        ? t("home.robot.retry")
        : t("home.robot.connect");


  const robotChipDisabled = robotDebug.mode === "hardware" && (robotConnectionMode === "connecting" || robotConnectionMode === "connected");

  const selectLanguage = useCallback((menu: "listening" | "response", option: ListeningLanguage | ResponseLanguage) => {
    if (menu === "listening") {
      const from = listeningLanguage;
      updatePreferences({ listeningLanguage: option as ListeningLanguage });
      recordDiagnosticEvent("runtime", "listening-language-changed", { from, language: option, source: "home-ui" });
    } else {
      const from = responseLanguage;
      updatePreferences({ language: option as ResponseLanguage });
      recordDiagnosticEvent("runtime", "response-language-changed", { from, language: option, source: "home-ui" });
    }
    void voiceRuntime.applyLiveRealtimePreferences(`home-${menu ?? "unknown"}-language`).then((applied) => {
      if (menu === "listening" && !applied) {
        return voiceRuntime.rearmWakewordAfterNavigation();
      }
    }).catch((error) => {
      recordDiagnosticEvent("runtime", "live-language-apply-failed", {
        source: menu ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [listeningLanguage, responseLanguage, updatePreferences]);

  return (
    <View onTouchStart={revealMenu} style={styles.home}>
      <View style={styles.faceStage}>
        <RobotFace
          mode="fullscreen"
          labelVisible={false}
          onContactStart={handleFaceContactStart}
          onFriendlyStroke={handleFriendlyStroke}
          onPress={() => {
            if (robotSleeping) {
              sleepTapAtRef.current = 0;
              void wakeRobotFromFace().catch((error) => {
                console.warn("[Home] Failed to wake LOOI from face tap:", error);
              });
              return;
            }
            handleAwakeFaceTap();
          }}
        />
        {robotSleeping ? (
          <View pointerEvents="none" style={styles.sleepBadge}>
            <Text style={styles.sleepTitle}>Zzz</Text>
            <Text style={styles.sleepText}>{t("home.wakeFromSleep")}</Text>
          </View>
        ) : null}
      </View>
      {!robotSleeping ? <ObjectAttentionControl hideTrigger openRequest={objectOpenRequest} /> : null}
      {!robotSleeping ? (
        <>
          <HomeMenu
            ref={menuRef}
            repairNeeded={repairStep !== null}
            onRepair={() => router.replace(`/onboarding?step=${repairStep}` as never)}
            robotError={robotConnectionMode === "error"}
            robotLabel={robotConnectionLabel}
            robotDisabled={robotChipDisabled}
            onRobot={() => robotDebug.mode === "hardware" ? void connectRobot() : router.push("/robot-debug" as never)}
            listeningLanguage={listeningLanguage}
            responseLanguage={responseLanguage}
            onSelectListeningLanguage={(option) => selectLanguage("listening", option)}
            onSelectResponseLanguage={(option) => selectLanguage("response", option)}
            photoBusy={photoPickerBusy}
            onPhoto={() => void choosePhotosForDiscussion()}
            onObject={() => setObjectOpenRequest((value) => value + 1)}
            onConversations={() => router.replace("/conversation")}
            onMemory={() => router.replace("/memories")}
            onApps={() => router.replace("/apps" as never)}
            onSettings={() => router.replace("/settings")}
            onCharacterAction={requestCharacterAction}
          />
          <View pointerEvents="box-none" style={[styles.overlayArea, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }]}>
            <ConversationOverlay />
          </View>
        </>
      ) : null}
      {!robotSleeping ? <ImageOverlay /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  home: {
    flex: 1,
    backgroundColor: looiTheme.bg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  faceStage: {
    width: "100%",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayArea: {
    position: "absolute",
  },
  sleepBadge: {
    position: "absolute",
    bottom: 34,
    alignSelf: "center",
    alignItems: "center",
    gap: 3,
    opacity: 0.62,
  },
  sleepTitle: {
    color: looiTheme.cyan,
    fontSize: 18,
    fontWeight: "800",
  },
  sleepText: {
    color: looiTheme.muted,
    fontSize: 11,
    fontWeight: "700",
  },
});
