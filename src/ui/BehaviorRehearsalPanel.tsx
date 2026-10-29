import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  BEHAVIOR_REHEARSAL_SCENARIOS,
  createBehaviorRehearsal,
  type BehaviorRehearsalScenarioId,
} from "../behavior/behavior-rehearsal";
import type { BehaviorCue, BehaviorGesture } from "../behavior/behavior-types";
import {
  replayBehaviorRehearsalFrames,
  runBehaviorRehearsalExpression,
  type BehaviorRehearsalExpressionFrame,
  type BehaviorRehearsalFaceFixture,
} from "../behavior/behavior-rehearsal-expression";
import {
  cancelLooiHeadMotion,
  getLooiRobotRuntimeState,
  performLooiBehaviorHeadGesture,
  subscribeLooiRobotRuntimeState,
} from "../device-tools/looi-robot";
import {
  getLooiRobotDebugState,
  subscribeLooiRobotDebugState,
} from "../device-tools/looi-robot-autoconnect";
import {
  createBehaviorRehearsalTranslator,
  type BehaviorRehearsalStringKey,
} from "../i18n/behavior-rehearsal-strings";
import { useUiText } from "../i18n/use-ui-text";
import { looiTheme } from "./looi-theme";
import { RobotFace } from "./RobotFace";

type RehearsalRunner = ReturnType<typeof createBehaviorRehearsal>;
type RehearsalState = ReturnType<RehearsalRunner["getState"]>;
type RunSession = { stopGeneration: number };

const SCENARIO_STRINGS: Record<BehaviorRehearsalScenarioId, {
  label: BehaviorRehearsalStringKey;
  help: BehaviorRehearsalStringKey;
}> = {
  curiosity: { label: "scenarioCuriosity", help: "scenarioCuriosityHelp" },
  celebration: { label: "scenarioCelebration", help: "scenarioCelebrationHelp" },
  "less-nodding": { label: "scenarioLessNodding", help: "scenarioLessNoddingHelp" },
  interrupted: { label: "scenarioInterrupted", help: "scenarioInterruptedHelp" },
};

/**
 * Offline-only rehearsal UI. Its private engine has deterministic inputs and
 * can write head gestures only while this exact mock connection stays current.
 */
export function BehaviorRehearsalPanel() {
  const { language } = useUiText();
  const t = useMemo(() => createBehaviorRehearsalTranslator(language), [language]);
  const systemReducedMotion = useReducedMotion();
  const [robotState, setRobotState] = useState(() => getLooiRobotDebugState());
  const [motionActive, setMotionActive] = useState(() => getLooiRobotRuntimeState().motionActive);
  const [expanded, setExpanded] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<BehaviorRehearsalScenarioId>("curiosity");
  const [reducedMotion, setReducedMotion] = useState(systemReducedMotion);
  const [faceFixture, setFaceFixture] = useState<BehaviorRehearsalFaceFixture | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<readonly BehaviorRehearsalExpressionFrame[]>([]);
  const [isReplayingFace, setIsReplayingFace] = useState(false);
  const runnerRef = useRef<RehearsalRunner | null>(null);
  const activeSessionRef = useRef<RunSession | null>(null);
  const expressionAbortRef = useRef<AbortController | null>(null);
  const replayCleanupRef = useRef<(() => void) | null>(null);
  const replayGenerationRef = useRef(0);
  const replayStopGenerationRef = useRef(getLooiRobotRuntimeState().stopGeneration);
  const reducedMotionRef = useRef(systemReducedMotion);
  const [state, setState] = useState<RehearsalState>({
    status: "idle",
    scenarioId: null,
    expected: null,
    observed: null,
    decisionCount: 0,
    executionCount: 0,
    traces: [],
    error: null,
  });

  const currentMockConnected = useCallback(() => {
    const current = getLooiRobotDebugState();
    const runtime = getLooiRobotRuntimeState();
    return current.mode === "mock" && current.source === "mock" && current.connected &&
      current.mock?.connected === true && !current.switching && !runtime.motionActive;
  }, []);

  const sessionOwnsCurrentMock = useCallback((session: RunSession, requireForeground = true) => {
    const current = getLooiRobotDebugState();
    const runtime = getLooiRobotRuntimeState();
    return activeSessionRef.current === session && current.mode === "mock" && current.source === "mock" &&
      current.connected && current.mock?.connected === true && !current.switching &&
      runtime.stopGeneration === session.stopGeneration &&
      (!requireForeground || AppState.currentState === "active");
  }, []);

  const sessionIsCurrent = useCallback((session: RunSession, requireForeground = true) => {
    return sessionOwnsCurrentMock(session, requireForeground) && !getLooiRobotRuntimeState().motionActive;
  }, [sessionOwnsCurrentMock]);

  const stopFaceReplay = useCallback((clearFixture = true, updateUi = true) => {
    replayGenerationRef.current += 1;
    replayCleanupRef.current?.();
    replayCleanupRef.current = null;
    if (updateUi) {
      setIsReplayingFace(false);
      if (clearFixture) setFaceFixture(null);
    }
  }, []);

  const invalidateRun = useCallback((reason: string, cancelOwnedHead: boolean, updateUi = true) => {
    stopFaceReplay(true, updateUi);
    expressionAbortRef.current?.abort();
    expressionAbortRef.current = null;
    const session = activeSessionRef.current;
    if (!session) return;
    const sameMockStillOwnsSession = sessionOwnsCurrentMock(session, false);
    activeSessionRef.current = null;
    runnerRef.current?.cancel();
    if (cancelOwnedHead && sameMockStillOwnsSession) {
      // This invalidates only the behavior-priority head sequence. It sends no
      // command, so a mode rebind can never redirect a cleanup write to hardware.
      cancelLooiHeadMotion(reason, "behavior");
    }
  }, [sessionOwnsCurrentMock, stopFaceReplay]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    let active = true;
    let eventGeneration = 0;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      eventGeneration += 1;
      reducedMotionRef.current = enabled;
      setReducedMotion(enabled);
      invalidateRun("behavior-rehearsal-reduce-motion-changed", true);
    });
    const queryGeneration = eventGeneration;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active && eventGeneration === queryGeneration) {
        reducedMotionRef.current = enabled;
        setReducedMotion(enabled);
      }
    }).catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, [invalidateRun]);

  useEffect(() => {
    const runner = createBehaviorRehearsal({
      canRun: () => currentMockConnected() && AppState.currentState === "active",
      executeCue: async (cue: BehaviorCue, runnerIsCurrent: () => boolean) => {
        const session = activeSessionRef.current;
        const isCurrent = () => Boolean(session) && session === activeSessionRef.current &&
          runnerIsCurrent() && sessionIsCurrent(session as RunSession);
        if (!isCurrent() || cue.gesture === "hold") return { completed: false };
        stopFaceReplay(true);
        setCapturedFrames([]);
        const controller = new AbortController();
        expressionAbortRef.current = controller;
        const expression = await runBehaviorRehearsalExpression(cue, {
          now: () => performance.now(),
          signal: controller.signal,
          isCurrent,
          reducedMotion: reducedMotionRef.current,
          present: (fixture) => {
            if (isCurrent()) setFaceFixture(fixture);
          },
          beginAccent: () => isCurrent() && performance.now() < cue.expiresAt,
          executeHead: async (gesture, isExpressionCurrent) => {
            if (!isCurrent() || !isExpressionCurrent()) return { completed: false };
            // The fixture drives only this captured mock session's head gesture.
            return await performLooiBehaviorHeadGesture(gesture, isExpressionCurrent);
          },
          onFrames: (frames) => {
            if (isCurrent()) setCapturedFrames(frames);
          },
        });
        if (expressionAbortRef.current === controller) expressionAbortRef.current = null;
        return { completed: expression.completed };
      },
    });
    runnerRef.current = runner;
    setState(runner.getState());
    const unsubscribeRunner = runner.subscribe((nextState) => {
      setState(nextState);
      if (nextState.status !== "running") activeSessionRef.current = null;
    });
    const unsubscribeRobot = subscribeLooiRobotDebugState((snapshot) => {
      setRobotState(snapshot);
      const session = activeSessionRef.current;
      if (!session && replayCleanupRef.current && !currentMockConnected()) {
        stopFaceReplay(true);
      }
      if (session && !sessionIsCurrent(session, false)) {
        const runtime = getLooiRobotRuntimeState();
        const stopChanged = runtime.stopGeneration !== session.stopGeneration;
        invalidateRun(
          runtime.motionActive ? "behavior-rehearsal-motion-active" : "behavior-rehearsal-link-changed",
          runtime.motionActive && !stopChanged,
        );
      }
    });
    const unsubscribeRuntime = subscribeLooiRobotRuntimeState(() => {
      const runtime = getLooiRobotRuntimeState();
      setMotionActive(runtime.motionActive);
      const session = activeSessionRef.current;
      if (!session) {
        if (replayCleanupRef.current && (runtime.motionActive || runtime.stopGeneration !== replayStopGenerationRef.current)) {
          stopFaceReplay(true);
        }
        return;
      }
      if (runtime.stopGeneration !== session.stopGeneration) {
        invalidateRun("behavior-rehearsal-stopped", false);
      } else if (runtime.motionActive) {
        invalidateRun("behavior-rehearsal-motion-active", true);
      }
    });
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") invalidateRun("behavior-rehearsal-backgrounded", true);
    });

    return () => {
      unsubscribeRunner();
      unsubscribeRobot();
      unsubscribeRuntime();
      appStateSubscription.remove();
      invalidateRun("behavior-rehearsal-unmounted", true, false);
      runner.dispose();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [currentMockConnected, invalidateRun, sessionIsCurrent, stopFaceReplay]);

  const mockLinkConnected = robotState.mode === "mock" && robotState.source === "mock" &&
    robotState.connected && robotState.mock?.connected === true && !robotState.switching;
  const mockConnected = mockLinkConnected && !motionActive;
  const isRunning = state.status === "running";
  const showFacePreview = isRunning || capturedFrames.length > 0 || faceFixture !== null || isReplayingFace;
  const replayUnavailable = !mockConnected || isRunning || AppState.currentState !== "active";
  const currentPhase = faceFixture?.presentation?.expressionPhase;
  const phaseText = currentPhase === "prepare"
    ? t("phasePrepare")
    : currentPhase === "accent"
      ? t("phaseAccent")
      : currentPhase === "settle"
        ? t("phaseSettle")
        : isReplayingFace
          ? t("facePreviewPlaying")
          : capturedFrames.length > 0
            ? t("facePreviewReady")
            : "";
  const scenario = SCENARIO_STRINGS[selectedScenario];
  const scenarioLabel = t(scenario.label);
  const statusColor = state.status === "passed"
    ? looiTheme.ok
    : state.status === "failed"
      ? looiTheme.danger
      : state.status === "cancelled"
        ? looiTheme.warn
        : isRunning
          ? looiTheme.cyan
          : looiTheme.muted;

  const run = () => {
    if (!currentMockConnected() || AppState.currentState !== "active" || isRunning) return;
    stopFaceReplay(true);
    setCapturedFrames([]);
    const runtime = getLooiRobotRuntimeState();
    const session: RunSession = { stopGeneration: runtime.stopGeneration };
    activeSessionRef.current = session;
    const runner = runnerRef.current;
    if (!runner) {
      activeSessionRef.current = null;
      return;
    }
    void runner.run(selectedScenario).catch(() => undefined);
  };

  const cancel = () => {
    const session = activeSessionRef.current;
    if (session && sessionIsCurrent(session)) {
      cancelLooiHeadMotion("behavior-rehearsal-cancelled", "behavior");
    }
    invalidateRun("behavior-rehearsal-cancelled", false);
  };

  const replayFaceSlowly = () => {
    if (!capturedFrames.length || isRunning || !currentMockConnected() || AppState.currentState !== "active") return;
    stopFaceReplay(true);
    const generation = replayGenerationRef.current;
    const stopGeneration = getLooiRobotRuntimeState().stopGeneration;
    replayStopGenerationRef.current = stopGeneration;
    setIsReplayingFace(true);
    replayCleanupRef.current = replayBehaviorRehearsalFrames(capturedFrames, {
      speed: 0.1,
      isCurrent: () => generation === replayGenerationRef.current && expanded &&
        AppState.currentState === "active" && currentMockConnected() &&
        getLooiRobotRuntimeState().stopGeneration === stopGeneration,
      present: (fixture) => {
        if (generation === replayGenerationRef.current) setFaceFixture(fixture);
      },
      onComplete: () => {
        if (generation === replayGenerationRef.current) {
          replayCleanupRef.current = null;
          setIsReplayingFace(false);
        }
      },
    });
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`${t("title")}, ${t(expanded ? "close" : "open")}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          if (expanded) {
            if (isRunning) cancel();
            else stopFaceReplay(true);
          }
          setExpanded((value) => !value);
        }}
        style={styles.disclosure}
      >
        <Text style={styles.title}>{t("title")}</Text>
        <Text style={styles.disclosureAction}>{t(expanded ? "close" : "open")}</Text>
      </Pressable>
      {expanded ? <>
      <Text style={styles.body}>{t("intro")}</Text>

      <Text style={styles.label}>{t("scenarioLabel")}</Text>
      <View style={styles.scenarioGrid} accessibilityLabel={t("scenarioLabel")}>
        {BEHAVIOR_REHEARSAL_SCENARIOS.map(({ id }) => {
          const strings = SCENARIO_STRINGS[id];
          const selected = selectedScenario === id;
          const disabled = isRunning;
          return (
            <Pressable
              key={id}
              accessibilityLabel={t("scenarioA11y", { scenario: t(strings.label) })}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => setSelectedScenario(id)}
              style={[styles.scenario, selected && styles.selected, disabled && styles.disabled]}
            >
              <Text style={[styles.scenarioText, selected && styles.selectedText]}>{t(strings.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.body}>{t(scenario.help)}</Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={t("runA11y", { scenario: scenarioLabel })}
          accessibilityRole="button"
          accessibilityState={{ disabled: !mockConnected || isRunning, busy: isRunning }}
          disabled={!mockConnected || isRunning}
          onPress={run}
          style={[styles.runButton, (!mockConnected || isRunning) && styles.disabled]}
        >
          <Text style={styles.runText}>{isRunning ? `… ${t("verdictRunning")}` : t("run")}</Text>
        </Pressable>
        {isRunning ? (
          <Pressable
            accessibilityLabel={t("cancelA11y")}
            accessibilityRole="button"
            accessibilityState={{ disabled: false }}
            onPress={cancel}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>{t("cancel")}</Text>
          </Pressable>
        ) : null}
      </View>

      {showFacePreview ? <View style={styles.previewSection}>
        <View style={styles.previewHeader}>
          <Text style={styles.sectionTitle}>{t("facePreviewTitle")}</Text>
          {phaseText ? <Text style={styles.previewPhase}>{phaseText}</Text> : null}
        </View>
        <Text style={styles.help}>{t("facePreviewDetail")}</Text>
        <View style={styles.facePreviewStage}>
          <RobotFace
            mode="fullscreen"
            labelVisible={false}
            fixture={faceFixture ?? { voiceState: "attention", presentation: null }}
          />
        </View>
        {capturedFrames.length > 0 ? (
          <Pressable
            accessibilityLabel={t(isReplayingFace ? "facePreviewStopA11y" : "facePreviewReplayA11y")}
            accessibilityRole="button"
            accessibilityState={{ disabled: replayUnavailable, busy: isReplayingFace }}
            disabled={replayUnavailable}
            onPress={isReplayingFace ? () => stopFaceReplay(true) : replayFaceSlowly}
            style={[styles.previewReplayButton, replayUnavailable && styles.disabled]}
          >
            <Text style={styles.previewReplayText}>
              {isReplayingFace ? t("facePreviewStop") : t("facePreviewReplay")}
            </Text>
          </Pressable>
        ) : null}
      </View> : null}

      {!mockConnected ? (
        <Text style={styles.help}>{mockLinkConnected ? t("motionBusy") : t("needsMock")}</Text>
      ) : null}

      {state.scenarioId ? <View style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <Text style={styles.sectionTitle}>{t("result")}</Text>
          <View style={[styles.verdictPill, { borderColor: statusColor }]}>
            <Text style={[styles.verdictText, { color: statusColor }]}>
              {t("verdict")}: {verdictText(state.status, t)}
            </Text>
          </View>
        </View>
        <Text style={styles.help}>
          {t("lastRunScenario", { scenario: t(SCENARIO_STRINGS[state.scenarioId].label) })}
        </Text>
        {isRunning ? <Text style={styles.help}>{t("runningDetail")}</Text> : null}
        <ValueRow label={t("expected")} value={state.scenarioId === "interrupted" ? t("gestureNone") : formatGesture(state.expected, t)} />
        <ValueRow label={t("observed")} value={state.scenarioId === "interrupted" && state.status !== "failed" ? t("gestureNone") : formatGesture(state.observed, t)} />
        <ValueRow label={t("decisions")} value={String(state.decisionCount)} />
        <ValueRow label={t("executedGestures")} value={String(state.executionCount)} />
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
        <Text style={styles.caveat}>{t("simulationNote")}</Text>
      </View> : null}

      {state.traces.length > 0 ? <>
      <View style={styles.traceHeader}>
        <Text style={styles.sectionTitle}>{t("trace")}</Text>
        <Text style={styles.traceCount}>{state.traces.length}</Text>
      </View>
      <View style={styles.traceList}>
        {state.traces.slice(-5).reverse().map((entry, index) => (
          <Text key={`${entry.kind}-${state.traces.length - index}`} style={styles.traceEntry}>
            {t("traceEntry", {
              kind: traceKind(entry.kind, t),
              reason: entry.reason ? t("traceReason", { reason: readableReason(entry.reason) }) : "",
            })}
          </Text>
        ))}
      </View>
      </> : null}
      </> : null}
    </View>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatGesture(gesture: BehaviorGesture | null, t: ReturnType<typeof createBehaviorRehearsalTranslator>): string {
  if (!gesture) return "—";
  const keys: Record<BehaviorGesture, BehaviorRehearsalStringKey> = {
    hold: "gestureHold",
    curious: "gestureCurious",
    thinking: "gestureThinking",
    happy_bob: "gestureHappyBob",
    nod: "gestureNod",
    speaking_soft: "gestureSpeakingSoft",
  };
  return t(keys[gesture]);
}

function verdictText(status: RehearsalState["status"], t: ReturnType<typeof createBehaviorRehearsalTranslator>): string {
  if (status === "passed") return t("verdictPassed");
  if (status === "failed") return t("verdictFailed");
  if (status === "running") return t("verdictRunning");
  if (status === "cancelled") return t("verdictCancelled");
  return t("verdictIdle");
}

function traceKind(kind: string, t: ReturnType<typeof createBehaviorRehearsalTranslator>): string {
  const keys: Record<string, BehaviorRehearsalStringKey> = {
    start: "traceStart",
    "scenario-start": "traceStart",
    decision: "traceDecision",
    "decision-requested": "traceDecision",
    "simulated-decision": "traceDecision",
    cue: "traceCue",
    "cue-requested": "traceCue",
    "policy-hold": "traceCue",
    "cue-executed": "traceExecuted",
    executed: "traceExecuted",
    "cue-blocked": "traceFailed",
    "cue-expired": "traceFailed",
    "cue-failed": "traceFailed",
    "cue-cancelled": "traceCancelled",
    interrupted: "traceInterrupted",
    "decision-interrupted": "traceInterrupted",
    "late-result-discarded": "traceInterrupted",
    complete: "traceComplete",
    passed: "traceComplete",
    "scenario-passed": "traceComplete",
    failed: "traceFailed",
    "scenario-failed": "traceFailed",
    blocked: "traceFailed",
    cancelled: "traceCancelled",
  };
  return t(keys[kind] ?? "traceUnknown");
}

function readableReason(reason: string): string {
  return reason.replaceAll(/[-_]+/g, " ");
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    backgroundColor: looiTheme.surface,
    padding: 12,
  },
  disclosure: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: { flex: 1, color: looiTheme.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  disclosureAction: { color: looiTheme.cyan, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  body: { color: looiTheme.muted, fontSize: 16, lineHeight: 22 },
  label: { color: looiTheme.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  scenarioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scenario: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 132,
    minHeight: 48,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 11,
    backgroundColor: looiTheme.bgRaised,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  scenarioText: { color: looiTheme.muted, fontSize: 14, lineHeight: 18, fontWeight: "700" },
  selected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40, 213, 255, 0.09)" },
  selectedText: { color: looiTheme.text },
  disabled: { opacity: 0.44 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  runButton: {
    flexGrow: 1,
    flexBasis: 154,
    minWidth: 145,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    borderRadius: 12,
    backgroundColor: looiTheme.surfaceStrong,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  runText: { color: looiTheme.cyan, fontSize: 15, lineHeight: 20, fontWeight: "800", textAlign: "center" },
  cancelButton: {
    minWidth: 126,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 122, 0.6)",
    borderRadius: 12,
    backgroundColor: "rgba(255, 92, 122, 0.09)",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  cancelText: { color: looiTheme.danger, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  help: { color: looiTheme.warn, fontSize: 14, lineHeight: 20 },
  resultCard: { gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: looiTheme.line, paddingTop: 10 },
  resultHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { color: looiTheme.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  previewSection: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: looiTheme.line, paddingTop: 10 },
  previewHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  previewPhase: { color: looiTheme.cyan, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  facePreviewStage: {
    minHeight: 340,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.bgRaised,
  },
  previewReplayButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    borderRadius: 11,
    backgroundColor: looiTheme.surfaceStrong,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  previewReplayText: { color: looiTheme.cyan, fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  verdictPill: { minHeight: 32, justifyContent: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10 },
  verdictText: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  valueRow: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: looiTheme.line, paddingVertical: 5 },
  rowLabel: { color: looiTheme.muted, fontSize: 14, lineHeight: 19 },
  rowValue: { flexShrink: 1, color: looiTheme.text, fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "right" },
  caveat: { color: looiTheme.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  error: { color: looiTheme.danger, fontSize: 14, lineHeight: 20 },
  traceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  traceCount: { color: looiTheme.muted, fontSize: 12, lineHeight: 17 },
  traceEmpty: { color: looiTheme.muted, fontSize: 13, lineHeight: 18 },
  traceList: { gap: 5 },
  traceEntry: { color: looiTheme.text, fontSize: 13, lineHeight: 18, borderRadius: 9, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.bgRaised, paddingHorizontal: 9, paddingVertical: 7 },
});
