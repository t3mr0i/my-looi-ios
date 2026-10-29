import { InterfacePressable as Pressable } from "./InterfacePressable";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  driveLooiForDuration,
  performLooiHeadGesture,
  setLooiHead,
  setLooiLight,
  stopLooiMotion,
} from "../device-tools/looi-robot";
import {
  clearMockLooiTrace,
  getLooiRobotDebugState,
  setLooiConnectionMode,
  setMockLooiConnected,
  setMockLooiScenario,
  subscribeLooiRobotDebugState,
} from "../device-tools/looi-robot-autoconnect";
import {
  createRobotDebugTranslator,
  type RobotDebugStringKey,
} from "../i18n/robot-debug-strings";
import { useUiText } from "../i18n/use-ui-text";
import { BehaviorRehearsalPanel } from "./BehaviorRehearsalPanel";
import { DecisionsLiveCheckPanel } from "./DecisionsLiveCheckPanel";
import { looiTheme } from "./looi-theme";

type DebugSnapshot = ReturnType<typeof getLooiRobotDebugState>;
type ConnectionMode = DebugSnapshot["mode"];
type Scenario = NonNullable<DebugSnapshot["mock"]>["scenario"];
type Feedback = { kind: "working" | "success" | "blocked" | "error"; text: string } | null;

const CONNECTION_MODES: Array<{ value: ConnectionMode; label: RobotDebugStringKey }> = [
  { value: "hardware", label: "modeHardware" },
  { value: "mock", label: "modeMock" },
  { value: "disconnected", label: "modeDisconnected" },
];

const SCENARIOS: Array<{ value: Scenario; label: RobotDebugStringKey }> = [
  { value: "clear", label: "scenarioClear" },
  { value: "front-edge", label: "scenarioFrontEdge" },
  { value: "rear-edge", label: "scenarioRearEdge" },
  { value: "obstacle", label: "scenarioObstacle" },
  { value: "unknown", label: "scenarioUnknown" },
];

/**
 * A standalone diagnostics surface. Physical control buttons are intentionally
 * gated to the mock source, while movement still traverses the production
 * safety controller so edge/obstacle scenarios exercise real interlocks.
 */
export function RobotDebugPanel() {
  const { language, locale } = useUiText();
  const t = useMemo(() => createRobotDebugTranslator(language), [language]);
  const [snapshot, setSnapshot] = useState<DebugSnapshot>(() => getLooiRobotDebugState());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionSequence = useRef(0);

  useEffect(() => {
    const refresh = () => setSnapshot(getLooiRobotDebugState());
    const unsubscribe = subscribeLooiRobotDebugState(refresh);
    refresh();
    return unsubscribe;
  }, []);

  const mockSelected = snapshot.mode === "mock" && snapshot.source === "mock";
  const mockConnected = mockSelected && snapshot.connected && Boolean(snapshot.mock?.connected);
  const canChooseScenario = mockSelected && !snapshot.switching;
  const canUseMock = mockConnected && !snapshot.switching;
  const canTest = canUseMock && pendingAction === null;
  const visibleTrace = snapshot.mock ? [...snapshot.mock.trace].reverse().slice(0, 12) : [];
  const safety = snapshot.safety;
  const safetyLabel = safety.state === "safe"
    ? t("safetySafe")
    : safety.state === "unsafe"
      ? t("safetyUnsafe")
      : t("safetyUnknown");
  const safetyColor = safety.state === "safe" ? looiTheme.ok : safety.state === "unsafe" ? looiTheme.danger : looiTheme.warn;
  const safetyReason = safety.lastMotionBlockReason ?? safety.reason ?? t("noSafetyReason");

  const runMockAction = async (
    actionKey: RobotDebugStringKey,
    operation: (isCurrent: () => boolean) => Promise<unknown>,
  ) => {
    const isStop = actionKey === "stop";
    const isMovement = actionKey === "moveForward" || actionKey === "turnLeft";
    const isCurrent = isMockActionCurrent;
    if (!isCurrent() || (pendingAction !== null && !isStop)) return;
    const label = t(actionKey);
    const sequence = ++actionSequence.current;
    setFeedback({ kind: "working", text: t("actionRunning", { action: label }) });
    setPendingAction(actionKey);
    try {
      const result = await operation(isCurrent);
      const current = getLooiRobotDebugState();
      setSnapshot(current);
      if (sequence !== actionSequence.current) return;
      if (resultWasRejected(result)) {
        const reason = current.safety.lastMotionBlockReason ?? current.safety.reason;
        setFeedback((current.safety.state !== "safe" || isMovement) && reason
          ? { kind: "blocked", text: t("actionBlocked", { action: label, reason }) }
          : { kind: "error", text: t("actionCancelled", { action: label }) });
      } else {
        setFeedback({ kind: "success", text: t("actionCompleted", { action: label }) });
      }
    } catch (error) {
      const current = getLooiRobotDebugState();
      setSnapshot(current);
      if (sequence !== actionSequence.current) return;
      const reason = current.safety.lastMotionBlockReason ?? current.safety.reason;
      const detail = errorMessage(error);
      const blocked = Boolean(reason) && (current.safety.state !== "safe" || isMovement);
      setFeedback(blocked
        ? { kind: "blocked", text: t("actionBlocked", { action: label, reason: reason || t("noSafetyReason") }) }
        : { kind: "error", text: t("actionFailed", { action: label, reason: detail }) });
    } finally {
      if (sequence === actionSequence.current) setPendingAction(null);
    }
  };

  function isMockActionCurrent(): boolean {
    const current = getLooiRobotDebugState();
    return current.mode === "mock" && current.source === "mock" && current.connected &&
      current.mock?.connected === true && !current.switching;
  }

  const runConnectionChange = async (operation: () => Promise<unknown> | unknown) => {
    setFeedback(null);
    try {
      await operation();
      setSnapshot(getLooiRobotDebugState());
    } catch (error) {
      setSnapshot(getLooiRobotDebugState());
      setFeedback({ kind: "error", text: errorMessage(error) });
    }
  };

  const setScenario = (scenario: Scenario) => {
    setFeedback(null);
    void runConnectionChange(() => setMockLooiScenario(scenario));
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.panel}>
        <Text style={styles.help}>{t("intro")}</Text>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{snapshot.source === "mock" ? t("mockBadge") : t("debugNotice")}</Text>
          <Text style={styles.noticeText}>{t("mockCaveat")}</Text>
          <Text style={styles.noticeText}>{t("noKeyNeeded")}</Text>
        </View>

        <SectionTitle>{t("connection")}</SectionTitle>
        <View style={styles.modeGrid} accessibilityLabel={t("connection")}>
          {CONNECTION_MODES.map(({ value, label }) => {
            const selected = snapshot.mode === value;
            const modeName = t(label);
            const disabled = snapshot.switching;
            return (
              <Pressable
                key={value}
                accessibilityLabel={t("modeA11y", { mode: modeName })}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => void runConnectionChange(() => setLooiConnectionMode(value))}
                style={[
                  styles.modeOption,
                  selected && styles.optionSelected,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={[styles.modeText, selected && styles.modeTextSelected]}>
                  {selected ? "✓ " : ""}{modeName}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusLine}>
            <Text style={styles.label}>{t("connectionStatus")}</Text>
            <View style={[styles.statusPill, { borderColor: statusColor(snapshot) }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(snapshot) }]} />
              <Text style={[styles.statusText, { color: statusColor(snapshot) }]}>
                {snapshot.switching
                  ? t("switching")
                  : snapshot.connected
                    ? t("connected")
                    : t("notConnected")}
              </Text>
            </View>
          </View>
          {snapshot.mode === "mock" ? (
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.value}>{t("mockSwitchLabel")}</Text>
                <Text style={styles.help}>{t("mockHint")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("mockSwitchLabel")}
                accessibilityState={{ checked: snapshot.mockConnectedRequested, disabled: snapshot.switching }}
                disabled={snapshot.switching}
                onValueChange={(connected) => void runConnectionChange(() => setMockLooiConnected(connected))}
                thumbColor={snapshot.mockConnectedRequested ? looiTheme.cyan : looiTheme.muted}
                trackColor={{ false: looiTheme.line, true: "rgba(40, 213, 255, 0.38)" }}
                value={snapshot.mockConnectedRequested}
              />
            </View>
          ) : (
            <Text style={styles.help}>
              {snapshot.mode === "hardware" ? t("hardwareHint") : t("disconnectedHint")}
            </Text>
          )}
          {snapshot.lastError ? <Text style={styles.errorText}>{snapshot.lastError}</Text> : null}
        </View>

        <View style={styles.stateCard}>
          <Text style={styles.sectionTitle}>{t("currentState")}</Text>
          <ValueRow label={t("headLabel")} value={formatHead(snapshot, t)} />
          <ValueRow label={t("driveLabel")} value={formatDrive(snapshot, t)} />
          <ValueRow label={t("lightLabel")} value={formatLight(snapshot, t)} />
        </View>

        <View style={styles.stateCard}>
          <View style={styles.statusLine}>
            <Text style={styles.sectionTitle}>{t("safety")}</Text>
            <Text style={[styles.safetyPill, { color: safetyColor, borderColor: safetyColor }]}>
              {safetyLabel}
            </Text>
          </View>
          <ValueRow label={t("safetyReason")} value={safetyReason} />
        </View>

        <View style={styles.divider} />
        <SectionTitle>{t("sensors")}</SectionTitle>
        <View style={styles.optionGrid}>
          {SCENARIOS.map(({ value, label }) => {
            const selected = snapshot.mock?.scenario === value;
            const disabled = !canChooseScenario;
            const scenarioName = t(label);
            return (
              <Pressable
                key={value}
                accessibilityLabel={t("scenarioA11y", { scenario: scenarioName })}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => setScenario(value)}
                style={[
                  styles.option,
                  selected && styles.optionSelected,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {selected ? "✓ " : ""}{scenarioName}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <BehaviorRehearsalPanel />
        <DecisionsLiveCheckPanel />

        <View style={styles.divider} />
        <SectionTitle>{t("controls")}</SectionTitle>
        <Text style={styles.help}>{t("controlsHelp")}</Text>
        <View style={styles.controlGrid}>
          <ControlButton label={t("nod")} actionKey="nod" disabled={!canTest} pending={pendingAction === "nod"} t={t}
            onPress={() => runMockAction("nod", (isCurrent) => performLooiHeadGesture("nod", 1, { isCurrent }))} />
          <ControlButton label={t("lookUp")} actionKey="lookUp" disabled={!canTest} pending={pendingAction === "lookUp"} t={t}
            onPress={() => runMockAction("lookUp", (isCurrent) => setLooiHead("up", { isCurrent }))} />
          <ControlButton label={t("centerHead")} actionKey="centerHead" disabled={!canTest} pending={pendingAction === "centerHead"} t={t}
            onPress={() => runMockAction("centerHead", (isCurrent) => setLooiHead("center", { isCurrent }))} />
          <ControlButton label={t("lookDown")} actionKey="lookDown" disabled={!canTest} pending={pendingAction === "lookDown"} t={t}
            onPress={() => runMockAction("lookDown", (isCurrent) => setLooiHead("down", { isCurrent }))} />
          <ControlButton label={t("moveForward")} actionKey="moveForward" disabled={!canTest} pending={pendingAction === "moveForward"} t={t}
            onPress={() => runMockAction("moveForward", (isCurrent) => driveLooiForDuration("forward", 500, { isCurrent }))} />
          <ControlButton label={t("turnLeft")} actionKey="turnLeft" disabled={!canTest} pending={pendingAction === "turnLeft"} t={t}
            onPress={() => runMockAction("turnLeft", (isCurrent) => driveLooiForDuration("left", 350, { isCurrent }))} />
          <ControlButton label={t(snapshot.mock?.lightEnabled ? "lightOff" : "lightOn")} actionKey={snapshot.mock?.lightEnabled ? "lightOff" : "lightOn"} disabled={!canTest} pending={pendingAction === "lightOn" || pendingAction === "lightOff"} t={t}
            onPress={() => runMockAction(snapshot.mock?.lightEnabled ? "lightOff" : "lightOn", (isCurrent) => setLooiLight(!snapshot.mock?.lightEnabled, { isCurrent }))} />
          <ControlButton label={t("stop")} actionKey="stop" disabled={!canUseMock} pending={pendingAction === "stop"} destructive t={t}
            onPress={() => runMockAction("stop", (isCurrent) => {
              if (!isCurrent()) throw new Error(t("onlyMock"));
              return stopLooiMotion("debug-panel-stop");
            })} />
        </View>
        {!mockConnected ? <Text style={styles.help}>{t("onlyMock")}</Text> : null}
        {feedback ? (
          <View style={[styles.feedback, feedback.kind === "blocked" && styles.feedbackBlocked, feedback.kind === "error" && styles.feedbackError]}>
            {feedback.kind === "working" ? <ActivityIndicator color={looiTheme.cyan} size="small" /> : null}
            <Text accessibilityLiveRegion="polite" style={feedback.kind === "blocked" ? styles.blockedText : feedback.kind === "error" ? styles.errorText : styles.feedbackText}>
              {feedback.text}
            </Text>
          </View>
        ) : null}

        <View style={styles.divider} />
        <View style={styles.traceHeader}>
          <View style={styles.traceTitleWrap}>
            <Text style={styles.sectionTitle}>{t("trace")}</Text>
            {mockSelected ? <Text style={styles.help}>{t("traceCount", { count: visibleTrace.length })}</Text> : null}
          </View>
          <Pressable
            accessibilityLabel={t("clearTraceA11y")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !mockSelected || !snapshot.mock || snapshot.switching }}
            disabled={!mockSelected || !snapshot.mock || snapshot.switching}
            onPress={() => void runConnectionChange(() => clearMockLooiTrace())}
            style={[styles.clearButton, (!mockSelected || !snapshot.mock || snapshot.switching) && styles.disabled]}
          >
            <Text style={styles.clearText}>{t("clearTrace")}</Text>
          </Pressable>
        </View>
        {!mockSelected ? (
          <Text style={styles.help}>{t("traceUnavailable")}</Text>
        ) : visibleTrace.length === 0 ? (
          <Text style={styles.emptyTrace}>{t("traceEmpty")}</Text>
        ) : (
          <View style={styles.traceList}>
            {visibleTrace.map((entry) => (
              <View key={entry.id} style={styles.traceEntry}>
                <View style={styles.traceEntryHeader}>
                  <Text style={styles.traceAction}>{entry.action}</Text>
                  <Text style={styles.traceTime}>{new Date(entry.time).toLocaleTimeString(locale)}</Text>
                </View>
                <Text style={styles.traceDetail}>{entry.detail || t("unknownDetail")}{entry.repetitions && entry.repetitions > 1 ? ` · ${t("repetitions", { count: entry.repetitions })}` : ""}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ControlButton({
  label,
  actionKey,
  disabled,
  pending,
  destructive = false,
  t,
  onPress,
}: {
  label: string;
  actionKey: RobotDebugStringKey;
  disabled: boolean;
  pending: boolean;
  destructive?: boolean;
  t: ReturnType<typeof createRobotDebugTranslator>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={actionKey === "stop" ? t("stopA11y") : t("testA11y", { action: label })}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: pending }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.controlButton,
        destructive && styles.stopButton,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.controlText, destructive && styles.stopText]}>{pending ? "… " : ""}{label}</Text>
    </Pressable>
  );
}

function resultWasRejected(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as { ok?: unknown; completed?: unknown };
  return record.ok === false || record.completed === false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}

function statusColor(snapshot: DebugSnapshot): string {
  if (snapshot.switching) return looiTheme.warn;
  if (snapshot.connected && snapshot.source === "mock") return looiTheme.cyan;
  if (snapshot.connected && snapshot.source === "hardware") return looiTheme.ok;
  return looiTheme.muted;
}

function formatHead(snapshot: DebugSnapshot, t: ReturnType<typeof createRobotDebugTranslator>): string {
  if (!snapshot.mock) return snapshot.source === "hardware" ? t("notReported") : "—";
  const head = snapshot.mock.head;
  if (typeof head === "object") return head.raw || t("notReported");
  if (head === "up") return t("headUp");
  if (head === "down") return t("headDown");
  return t("headCenter");
}

function formatDrive(snapshot: DebugSnapshot, t: ReturnType<typeof createRobotDebugTranslator>): string {
  if (!snapshot.mock) return snapshot.source === "hardware" ? t("notReported") : "—";
  const direction = snapshot.mock.direction;
  const key: Record<string, RobotDebugStringKey> = {
    stop: "driveStopped",
    forward: "driveForward",
    back: "driveBack",
    left: "driveLeft",
    right: "driveRight",
  };
  return t(key[direction] ?? "notReported");
}

function formatLight(snapshot: DebugSnapshot, t: ReturnType<typeof createRobotDebugTranslator>): string {
  if (!snapshot.mock) return snapshot.source === "hardware" ? t("notReported") : "—";
  return snapshot.mock.lightEnabled ? t("lightEnabled") : t("lightDisabled");
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: looiTheme.bg },
  content: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 36 },
  panel: { width: "100%", maxWidth: 640, gap: 12 },
  title: { color: looiTheme.text, fontSize: 22, lineHeight: 28, fontWeight: "800" },
  help: { color: looiTheme.muted, fontSize: 13, lineHeight: 19 },
  notice: {
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 209, 102, 0.38)",
    backgroundColor: "rgba(255, 209, 102, 0.07)",
    padding: 12,
  },
  noticeTitle: { color: looiTheme.warn, fontSize: 13, fontWeight: "800" },
  noticeText: { color: looiTheme.text, fontSize: 12, lineHeight: 17 },
  sectionTitle: { color: looiTheme.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  label: { color: looiTheme.muted, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeOption: {
    minWidth: 102,
    minHeight: 52,
    flexGrow: 1,
    flexBasis: 108,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  modeText: { color: looiTheme.muted, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  modeTextSelected: { color: looiTheme.text },
  optionSelected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40, 213, 255, 0.09)" },
  statusCard: {
    gap: 10,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    backgroundColor: looiTheme.surface,
    padding: 12,
  },
  statusLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusPill: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  switchRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10 },
  switchCopy: { flex: 1, gap: 2 },
  value: { color: looiTheme.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  stateCard: { gap: 6, borderRadius: 14, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.surface, padding: 12 },
  valueRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: looiTheme.line, paddingVertical: 5 },
  rowLabel: { flexShrink: 0, color: looiTheme.muted, fontSize: 12, lineHeight: 18 },
  rowValue: { flexShrink: 1, color: looiTheme.text, fontSize: 12, lineHeight: 18, fontWeight: "700", textAlign: "right" },
  safetyPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: "800" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: looiTheme.line, marginVertical: 2 },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { minWidth: 140, minHeight: 48, flexGrow: 1, flexBasis: "46%", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.surface, paddingHorizontal: 11, paddingVertical: 9 },
  optionText: { color: looiTheme.muted, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  optionTextSelected: { color: looiTheme.text },
  controlGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  controlButton: { minWidth: 145, minHeight: 48, flexGrow: 1, flexBasis: "46%", justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: looiTheme.lineActive, backgroundColor: looiTheme.surfaceStrong, paddingHorizontal: 11, paddingVertical: 9 },
  controlText: { color: looiTheme.text, fontSize: 12, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  stopButton: { borderColor: "rgba(255, 92, 122, 0.8)", backgroundColor: "rgba(255, 92, 122, 0.13)" },
  stopText: { color: looiTheme.danger },
  disabled: { opacity: 0.44 },
  feedback: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: looiTheme.lineActive, backgroundColor: looiTheme.surface, paddingHorizontal: 12, paddingVertical: 9 },
  feedbackText: { flex: 1, color: looiTheme.text, fontSize: 12, lineHeight: 17 },
  feedbackBlocked: { borderColor: "rgba(255, 209, 102, 0.55)", backgroundColor: "rgba(255, 209, 102, 0.08)" },
  feedbackError: { borderColor: "rgba(255, 92, 122, 0.55)", backgroundColor: "rgba(255, 92, 122, 0.08)" },
  blockedText: { flex: 1, color: looiTheme.warn, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  errorText: { color: looiTheme.danger, fontSize: 12, lineHeight: 17 },
  traceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  traceTitleWrap: { flex: 1, gap: 2 },
  clearButton: { minHeight: 44, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: looiTheme.line, paddingHorizontal: 11, paddingVertical: 8 },
  clearText: { color: looiTheme.cyan, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  emptyTrace: { color: looiTheme.muted, fontSize: 12, lineHeight: 18, borderRadius: 12, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.surface, padding: 12 },
  traceList: { gap: 6 },
  traceEntry: { gap: 3, borderRadius: 11, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.surface, paddingHorizontal: 10, paddingVertical: 8 },
  traceEntryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  traceAction: { flex: 1, color: looiTheme.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  traceTime: { color: looiTheme.muted, fontSize: 10, lineHeight: 14 },
  traceDetail: { color: looiTheme.muted, fontSize: 11, lineHeight: 16 },
});
