import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  DECISIONS_LIVE_CHECK_SAMPLE_TEXT,
  createDecisionsLiveCheck,
  type DecisionsLiveCheckState,
} from "../behavior/decisions-live-check";
import {
  getLooiRobotRuntimeState,
  subscribeLooiRobotRuntimeState,
} from "../device-tools/looi-robot";
import {
  getLooiRobotDebugState,
  subscribeLooiRobotDebugState,
} from "../device-tools/looi-robot-autoconnect";
import {
  createDecisionsLiveCheckTranslator,
  type DecisionsLiveCheckStringKey,
} from "../i18n/decisions-live-check-strings";
import type { DecisionAnswer } from "../openai/decisions";
import { useUiText } from "../i18n/use-ui-text";
import { looiTheme } from "./looi-theme";

type LiveCheckRunner = ReturnType<typeof createDecisionsLiveCheck>;
type LiveCheckSession = { stopGeneration: number };

const ANSWER_LABELS: Record<string, DecisionsLiveCheckStringKey> = {
  cue: "cue",
  attention: "attention",
  intention: "intention",
};

const ANSWER_VALUES: Record<string, DecisionsLiveCheckStringKey> = {
  hold: "gestureHold",
  curious: "gestureCurious",
  thinking: "gestureThinking",
  happy_bob: "gestureHappyBob",
  nod: "gestureNod",
  speaking_soft: "gestureSpeakingSoft",
  keep_target: "attentionKeep",
  brief_search: "attentionSearch",
  release: "attentionRelease",
  continue: "intentionContinue",
  wait: "intentionWait",
  offer_resume: "intentionResume",
  drop: "intentionDrop",
};

/** Makes one explicitly started real Decisions request using fixed synthetic text. */
export function DecisionsLiveCheckPanel() {
  const { language, locale } = useUiText();
  const t = useMemo(() => createDecisionsLiveCheckTranslator(language), [language]);
  const [robotState, setRobotState] = useState(() => getLooiRobotDebugState());
  const [motionActive, setMotionActive] = useState(() => getLooiRobotRuntimeState().motionActive);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [expanded, setExpanded] = useState(false);
  const runnerRef = useRef<LiveCheckRunner | null>(null);
  const sessionRef = useRef<LiveCheckSession | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<DecisionsLiveCheckState>({
    status: "idle",
    latencyMs: null,
    answers: [],
    usage: null,
    requestId: null,
    error: null,
  });

  const currentMockEligible = useCallback(() => {
    const current = getLooiRobotDebugState();
    const runtime = getLooiRobotRuntimeState();
    return current.mode === "mock" && current.source === "mock" && current.connected &&
      current.mock?.connected === true && !current.switching && !runtime.motionActive &&
      AppState.currentState === "active";
  }, []);

  const cancelActive = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current = null;
    runnerRef.current?.cancel();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const runner = createDecisionsLiveCheck({
      canRun: () => {
        const session = sessionRef.current;
        if (!session || !currentMockEligible()) return false;
        return getLooiRobotRuntimeState().stopGeneration === session.stopGeneration;
      },
    });
    runnerRef.current = runner;
    setState(runner.getState());
    const unsubscribeRunner = runner.subscribe((nextState) => {
      if (mountedRef.current) setState(nextState);
      if (nextState.status !== "running") sessionRef.current = null;
    });

    const invalidateIfIneligible = () => {
      if (sessionRef.current && !currentMockEligible()) {
        cancelActive();
      }
    };
    const unsubscribeDebug = subscribeLooiRobotDebugState((snapshot) => {
      setRobotState(snapshot);
      invalidateIfIneligible();
    });
    const unsubscribeRuntime = subscribeLooiRobotRuntimeState(() => {
      const runtime = getLooiRobotRuntimeState();
      setMotionActive(runtime.motionActive);
      const session = sessionRef.current;
      if (session && runtime.stopGeneration !== session.stopGeneration) {
        cancelActive();
      } else {
        invalidateIfIneligible();
      }
    });
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      setAppActive(active);
      if (!active) cancelActive();
    });

    return () => {
      mountedRef.current = false;
      unsubscribeRunner();
      unsubscribeDebug();
      unsubscribeRuntime();
      appStateSubscription.remove();
      cancelActive();
      runner.dispose();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [cancelActive, currentMockEligible]);

  const isRunning = state.status === "running";
  const mockConnected = robotState.mode === "mock" && robotState.source === "mock" &&
    robotState.connected && robotState.mock?.connected === true && !robotState.switching;
  const eligible = mockConnected && !motionActive && appActive && AppState.currentState === "active";

  const run = () => {
    if (!currentMockEligible() || sessionRef.current || isRunning) return;
    const runner = runnerRef.current;
    if (!runner) return;
    const session = { stopGeneration: getLooiRobotRuntimeState().stopGeneration };
    sessionRef.current = session;
    void runner.run().finally(() => {
      if (sessionRef.current === session) sessionRef.current = null;
    });
  };

  const collapse = () => {
    if (expanded && isRunning) cancelActive();
    setExpanded((value) => !value);
  };

  const unavailableMessage = !appActive || AppState.currentState !== "active"
    ? t("inactive")
    : !mockConnected
      ? t("needsMock")
      : motionActive
        ? t("motionBusy")
        : t("unavailable");

  const currency = (amount: number | null | undefined) => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return t("valueUnavailable");
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 8,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(8)}`;
    }
  };

  const number = (value: number | null | undefined, maximumFractionDigits = 0) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return t("valueUnavailable");
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
    } catch {
      return String(Math.round(value));
    }
  };

  const resultTitle = state.status === "succeeded"
    ? t("responseReceived")
    : state.status === "cancelled"
      ? t("cancelled")
      : state.status === "running"
        ? t("running")
        : t("errorTitle");

  return (
    <View style={styles.panel}>
      <Pressable
        accessibilityLabel={`${t("title")}, ${t(expanded ? "close" : "open")}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={collapse}
        style={styles.disclosure}
      >
        <Text style={styles.title}>{t("title")}</Text>
        <Text style={styles.disclosureAction}>{t(expanded ? "close" : "open")}</Text>
      </Pressable>

      {expanded ? <>
        <Text style={styles.body}>{t("intro")}</Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t("realRequest")}</Text>
          <Text style={styles.noticeText}>{t("budgetNote")}</Text>
        </View>

        <View style={styles.sample}>
          <Text style={styles.label}>{t("sampleLabel")}</Text>
          <Text style={styles.sampleText}>{DECISIONS_LIVE_CHECK_SAMPLE_TEXT}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={t("run")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !eligible || isRunning, busy: isRunning }}
            disabled={!eligible || isRunning}
            onPress={run}
            style={[styles.runButton, (!eligible || isRunning) && styles.disabled]}
          >
            {isRunning ? <ActivityIndicator color={looiTheme.cyan} size="small" /> : null}
            <Text style={styles.runText}>{isRunning ? t("running") : t("run")}</Text>
          </Pressable>
          {isRunning ? (
            <Pressable
              accessibilityLabel={t("cancel")}
              accessibilityRole="button"
              accessibilityState={{ disabled: false }}
              onPress={cancelActive}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>{t("cancel")}</Text>
            </Pressable>
          ) : null}
        </View>

        {!eligible && !isRunning ? <Text style={styles.help}>{unavailableMessage}</Text> : null}

        {state.status !== "idle" ? (
          <View style={styles.result}>
            <Text accessibilityLiveRegion="polite" style={styles.sectionTitle}>{resultTitle}</Text>
            {state.status === "succeeded" ? <>
              <Text style={styles.label}>{t("response")}</Text>
              {state.answers.map((answer) => renderAnswer(answer, t, locale))}
              <MetricRow label={t("latency")} value={state.latencyMs === null
                ? t("valueUnavailable")
                : t("milliseconds", { value: number(state.latencyMs, 0) })} />
              <MetricRow label={t("inputTokens")} value={number(state.usage?.inputTokens)} />
              <MetricRow label={t("cachedTokens")} value={number(state.usage?.cachedTokens)} />
              <MetricRow label={t("cacheWriteTokens")} value={number(state.usage?.cacheWriteTokens)} />
              <MetricRow label={t("estimatedCost")} value={currency(state.usage?.costUsd)} />
              <Text style={styles.caveat}>{t("costExplanation")}</Text>
              <Text style={styles.caveat}>{t("responseCaveat")}</Text>
            </> : null}
            {state.status === "failed" ? <Text style={styles.errorText}>{formatSafeError(state, t)}</Text> : null}
            {state.status === "cancelled" ? <Text style={styles.help}>{t("cancelled")}</Text> : null}
          </View>
        ) : null}
      </> : null}
    </View>
  );
}

function renderAnswer(
  answer: DecisionAnswer,
  t: ReturnType<typeof createDecisionsLiveCheckTranslator>,
  locale: string,
) {
  const label = ANSWER_LABELS[answer.name];
  if (!label) return null;
  const value = answer.type === "choice"
    ? ANSWER_VALUES[answer.choice]
      ? t(ANSWER_VALUES[answer.choice])
      : t("valueUnknown")
    : answer.type === "predicate"
      ? formatPercent(answer.probability, locale, t)
      : `${numberWithLocale(answer.score, locale)} · ${formatPercent(answer.confidence, locale, t)}`;
  const confidence = answer.type === "choice" ? ` · ${formatPercent(answer.confidence, locale, t)}` : "";
  return <MetricRow key={answer.name} label={t(label)} value={`${value}${confidence}`} />;
}

function formatPercent(
  value: number,
  locale: string,
  t: ReturnType<typeof createDecisionsLiveCheckTranslator>,
) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return t("valueUnavailable");
  try {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value * 100)}%`;
  }
}

function numberWithLocale(value: number, locale: string) {
  if (!Number.isFinite(value)) return "—";
  try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value); }
  catch { return String(value); }
}

function formatSafeError(
  state: DecisionsLiveCheckState,
  t: ReturnType<typeof createDecisionsLiveCheckTranslator>,
) {
  const errorKey: Record<string, DecisionsLiveCheckStringKey> = {
    missing_key: "errorMissingKey",
    invalid_request: "errorInvalidRequest",
    timeout: "errorTimeout",
    cancelled: "errorCancelled",
    network: "errorNetwork",
    api: "errorApi",
    response: "errorResponse",
    not_eligible: "errorNotEligible",
    unknown: "errorUnknown",
  };
  const key = errorKey[state.error?.code ?? "unknown"] ?? "errorUnknown";
  const status = state.error?.status;
  return status !== null && status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
    ? `${t(key)} · ${t("httpStatus", { status })}`
    : t(key);
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
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
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { flex: 1, flexShrink: 1, color: looiTheme.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  disclosureAction: { color: looiTheme.cyan, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  body: { color: looiTheme.muted, fontSize: 16, lineHeight: 22 },
  notice: { gap: 3, paddingVertical: 8 },
  noticeTitle: { color: looiTheme.warn, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  noticeText: { color: looiTheme.muted, fontSize: 14, lineHeight: 20 },
  sample: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: looiTheme.line, paddingVertical: 9 },
  label: { color: looiTheme.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  sampleText: { color: looiTheme.text, fontSize: 16, lineHeight: 23 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  runButton: {
    flexGrow: 1,
    flexBasis: 164,
    minWidth: 145,
    minHeight: 48,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    borderRadius: 12,
    backgroundColor: looiTheme.surfaceStrong,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  runText: { flexShrink: 1, color: looiTheme.cyan, fontSize: 15, lineHeight: 20, fontWeight: "800", textAlign: "center" },
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
  cancelText: { color: looiTheme.danger, fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.44 },
  help: { color: looiTheme.warn, fontSize: 14, lineHeight: 20 },
  result: { gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: looiTheme.line, paddingTop: 10 },
  sectionTitle: { color: looiTheme.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  metricRow: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: looiTheme.line, paddingVertical: 5 },
  metricLabel: { flexShrink: 1, color: looiTheme.muted, fontSize: 14, lineHeight: 19 },
  metricValue: { flexShrink: 1, color: looiTheme.text, fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "right" },
  caveat: { color: looiTheme.muted, fontSize: 13, lineHeight: 19 },
  errorText: { color: looiTheme.danger, fontSize: 14, lineHeight: 20 },
});
