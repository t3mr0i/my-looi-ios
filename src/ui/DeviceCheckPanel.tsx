import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { createDeviceCheckTranslator, type DeviceCheckStringKey } from "../i18n/device-check-strings";
import { useUiText } from "../i18n/use-ui-text";
import { LINK_LOSS_MAX_ATTEMPTS, type DeviceCheckBlocker, type DeviceCheckId, type LinkLossAttemptResult, type LiftReport, type TofReport } from "../robot-mind/device-check";
import type { DeviceCheckUi } from "../robot-mind/device-check-install";
import { InterfacePressable } from "./InterfacePressable";
import { looiTheme } from "./looi-theme";

type Screen = { text: string; actions: { label: string; value: string }[] };
type Phase = Parameters<DeviceCheckUi["phase"]>[1];

const BLOCKER_KEYS: Record<DeviceCheckBlocker, DeviceCheckStringKey> = {
  "not-connected": "blockedNotConnected", "autonomy-on": "blockedAutonomy", "ambient-on": "blockedAmbient", "camera-on": "blockedCamera",
};
const CHECK_KEYS: Record<DeviceCheckId, DeviceCheckStringKey> = { link_loss: "chooseLinkLoss", lift: "chooseLift", tof: "chooseTof", head: "chooseHead" };
const LIFT_STEP_KEYS: Record<string, DeviceCheckStringKey> = {
  table: "liftPoseTable", lifted: "liftPoseLifted", front_lifted: "liftPoseFrontLifted", rear_lifted: "liftPoseRearLifted",
};
const TOF_STEP_KEYS: Record<string, DeviceCheckStringKey> = {
  nothing_before: "tofStepNothingBefore", cm40: "tofStepCm40", cm20: "tofStepCm20", cm10: "tofStepCm10", cm5: "tofStepCm5", nothing_after: "tofStepNothingAfter",
};
const SENSOR_KEYS: Record<string, DeviceCheckStringKey> = {
  frontLeft: "sensorFrontLeft", frontRight: "sensorFrontRight", rearLeft: "sensorRearLeft", rearRight: "sensorRearRight",
};
const INVALID_KEYS: Record<string, DeviceCheckStringKey> = {
  motion: "invalidMotion", incomplete: "invalidIncomplete", "table-not-on-ground": "invalidTableNotOnGround",
};

export function DeviceCheckPanel({ disabled }: { disabled?: boolean }) {
  const { language } = useUiText();
  const t = useMemo(() => createDeviceCheckTranslator(language), [language]);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<DeviceCheckId | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeviceCheckBlocker[]>([]);
  const pending = useRef<((value: string | null) => void) | null>(null);
  const cancelledRef = useRef(false);
  const attemptsRef = useRef<LinkLossAttemptResult[]>([]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    pending.current?.(null);
    pending.current = null;
    setScreen(null);
  }, []);
  useEffect(() => cancel, [cancel]);

  const prompt = useCallback((text: string, actions: Screen["actions"]) => new Promise<string | null>((resolve) => {
    if (cancelledRef.current) { resolve(null); return; }
    pending.current = resolve;
    setScreen({ text, actions });
  }), []);
  const choose = (value: string) => { const resolve = pending.current; pending.current = null; setScreen(null); resolve?.(value); };

  const attemptLine = (r: LinkLossAttemptResult) => {
    if (r.valid) return t("linkLossAttemptValid", { attempt: r.attempt });
    const reason = r.invalidReason === "not-started" ? t("invalidNotStarted", { detail: r.blockReason ?? "none" })
      : r.invalidReason === "no-cut" ? t("invalidNoCut")
      : r.invalidReason === "app-left-foreground" ? t("invalidAppLeft")
      : r.invalidReason === "reconnected-too-early" ? t("invalidReconnected")
      : t("invalidNoAnswer");
    return t("linkLossAttemptInvalid", { attempt: r.attempt, reason });
  };
  const liftText = (r: LiftReport) => {
    if (r.verdict === "invalid") return t("verdictInvalid", { reason: t(INVALID_KEYS[r.invalidReason ?? "incomplete"]) });
    const parts: string[] = [];
    if (r.verdict === "no_frames") parts.push(t("verdictLiftNoFrames"));
    else if (r.verdict === "none") parts.push(t("verdictLiftNone"));
    else {
      parts.push(r.verdict === "all_four" ? t("verdictLiftAllFour") : t("verdictLiftPartial", { sensors: r.liftedNoGround.map((k) => t(SENSOR_KEYS[k])).join(", ") }));
      if (r.liftedFrontGround) parts.push(t("liftFrontStillGround"));
    }
    if (r.otherTypesChanged.length) parts.push(t("liftOtherTypes", { types: r.otherTypesChanged.join(", ") }));
    if (r.mappingConsistent === false) parts.push(t("liftMappingMismatch"));
    parts.push(t("liftDone"), t("recorded"));
    return parts.join(" ");
  };
  const tofText = (r: TofReport) => {
    if (r.verdict === "invalid") return t("verdictInvalid", { reason: t(INVALID_KEYS[r.invalidReason ?? "incomplete"]) });
    const parts: string[] = [];
    if (r.verdict === "distance_like") {
      parts.push(t("verdictTofDistance"));
      parts.push(r.nearSteps.length ? t("tofNear", { steps: r.nearSteps.map((s) => `${s.replace("cm", "")} cm`).join(", ") }) : t("tofNoneNear"));
    } else parts.push(r.verdict === "no_frames" ? t("verdictTofNoFrames") : t("verdictTofNotDistance"));
    parts.push(t("recorded"));
    return parts.join(" ");
  };

  const start = async (id: DeviceCheckId) => {
    const install = await import("../robot-mind/device-check-install");
    const found = install.currentDeviceCheckBlockers();
    setBlockers(found);
    if (found.length) return;
    cancelledRef.current = false;
    setResult(null);
    setLog([]);
    setRunning(id);
    const stepText = (step: string) => {
      if (step === "head_87") return t("headIntro");
      if (step === "head_5a") return t("headPhoto87");
      const intro = id === "lift" ? t("liftIntro") : id === "tof" ? t("tofIntro") : null;
      const key = LIFT_STEP_KEYS[step] ?? TOF_STEP_KEYS[step];
      return [intro, key ? t(key) : step].filter(Boolean).join("\n\n");
    };
    const ui: DeviceCheckUi = {
      ready: (step) => prompt(stepText(step), [{ label: step === "head_87" ? t("headSet87") : step === "head_5a" ? t("headSet5a") : t("start"), value: "go" }]).then((v) => v === "go"),
      phase: (_step: string, phase: Phase, ms: number) => {
        const seconds = Math.ceil(ms / 1000);
        setScreen({
          text: phase === "positioning" ? t("positioning", { seconds }) : phase === "holding" ? t("holding", { seconds }) : phase === "starting" ? t("linkLossStarting") : t("linkLossObserving"),
          actions: [],
        });
      },
      askLinkLoss: () => prompt(t("linkLossQuestion"), [
        { label: t("linkLossAnswerWithin"), value: "within_1s" }, { label: t("linkLossAnswerLater"), value: "later" }, { label: t("linkLossAnswerKeptGoing"), value: "kept_going" },
      ]).then((v) => (v as Awaited<ReturnType<DeviceCheckUi["askLinkLoss"]>>)),
      askHead: () => prompt(`${t("headPhoto5a")} ${t("headQuestion")}`, [
        { label: t("headAnswer87"), value: "87" }, { label: t("headAnswer5a"), value: "5a" }, { label: t("headAnswerNeither"), value: "neither" }, { label: t("headAnswerSame"), value: "same" },
      ]).then((v) => (v as Awaited<ReturnType<DeviceCheckUi["askHead"]>>)),
      cancelled: () => cancelledRef.current,
    };
    try {
      if (id === "lift") {
        const report = await install.runLiftCheckOnDevice(ui);
        setResult(report ? liftText(report) : t("cancelled"));
      } else if (id === "tof") {
        const report = await install.runTofCheckOnDevice(ui);
        setResult(report ? tofText(report) : t("cancelled"));
      } else if (id === "head") {
        const report = await install.runHeadCheckOnDevice(ui);
        if (!report) setResult(t("cancelled"));
        else if (report.verdict === "incomplete") setResult(t("headWriteFailed"));
        else {
          const label = report.answer === "87" ? t("headAnswer87") : report.answer === "5a" ? t("headAnswer5a") : report.answer === "neither" ? t("headAnswerNeither") : t("headAnswerSame");
          setResult(`${t("verdictHead", { answer: label })} ${t("recorded")}`);
        }
      } else {
        attemptsRef.current = [];
        while (true) {
          const go = await prompt(t("linkLossIntro"), [{ label: t("linkLossStart"), value: "go" }]);
          if (go !== "go") { setResult(t("cancelled")); break; }
          const again = install.currentDeviceCheckBlockers();
          setBlockers(again);
          if (again.length) break;
          const attempt = await install.runLinkLossAttemptOnDevice(ui, attemptsRef.current.length + 1);
          if (attempt === null) { setResult(t("cancelled")); break; }
          attemptsRef.current.push(attempt);
          const line = attemptLine(attempt);
          setLog((lines) => [...lines, line]);
          const actions = [...(attemptsRef.current.length < LINK_LOSS_MAX_ATTEMPTS ? [{ label: t("linkLossAgain"), value: "again" }] : []), { label: t("linkLossFinish"), value: "finish" }];
          const next = await prompt(line, actions);
          if (next === null) { setResult(t("cancelled")); break; }
          if (next === "finish") {
            const summary = install.recordLinkLossVerdict(attemptsRef.current);
            const key: DeviceCheckStringKey = summary.verdict === "stops" ? "verdictLinkLossStops" : summary.verdict === "needs_more" ? "verdictLinkLossNeedsMore"
              : summary.verdict === "stops_late" ? "verdictLinkLossLate" : summary.verdict === "keeps_going" ? "verdictLinkLossKeepsGoing" : "verdictLinkLossUndecided";
            setResult(`${t(key, { count: summary.validAttempts })} ${t("recorded")}`);
            break;
          }
        }
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = null;
      setScreen(null);
      setRunning(null);
    }
  };

  if (!open) {
    return <View style={styles.buttonRow}>
      <InterfacePressable onPress={() => setOpen(true)} disabled={disabled} style={[styles.action, styles.actionSecondary, disabled && styles.disabled]}>
        <Text style={styles.actionSecondaryText}>{t("open")}</Text>
      </InterfacePressable>
    </View>;
  }
  const blocked = Boolean(running) || Boolean(disabled);
  return <View style={styles.panel}>
    <Text style={styles.help}>{t("intro")}</Text>
    <View style={styles.buttonRow}>
      {(Object.keys(CHECK_KEYS) as DeviceCheckId[]).map((id) => (
        <InterfacePressable key={id} onPress={() => void start(id)} disabled={blocked} style={[styles.action, blocked && styles.disabled]}>
          <Text style={styles.actionText}>{t(CHECK_KEYS[id])}</Text>
        </InterfacePressable>
      ))}
    </View>
    {blockers.map((blocker) => <Text key={blocker} style={styles.help}>{t(BLOCKER_KEYS[blocker])}</Text>)}
    {running ? <Text style={styles.label}>{t(CHECK_KEYS[running])}</Text> : null}
    {log.map((line, index) => <Text key={index} style={styles.help}>{line}</Text>)}
    {screen ? <Text style={styles.help}>{screen.text}</Text> : null}
    {screen && screen.actions.length ? <View style={styles.buttonRow}>
      {screen.actions.map((action) => (
        <InterfacePressable key={action.value} onPress={() => choose(action.value)} style={styles.action}>
          <Text style={styles.actionText}>{action.label}</Text>
        </InterfacePressable>
      ))}
    </View> : null}
    {result ? <Text style={styles.result}>{result}</Text> : null}
    <View style={styles.buttonRow}>
      {running ? <InterfacePressable onPress={cancel} style={[styles.action, styles.actionSecondary]}>
        <Text style={styles.actionSecondaryText}>{t("cancel")}</Text>
      </InterfacePressable> : <InterfacePressable onPress={() => { setOpen(false); setBlockers([]); }} style={[styles.action, styles.actionSecondary]}>
        <Text style={styles.actionSecondaryText}>{t("close")}</Text>
      </InterfacePressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  help: { color: looiTheme.muted, fontSize: 14, lineHeight: 20 },
  label: { color: looiTheme.muted, fontSize: 12, fontWeight: "700", marginTop: 4 },
  result: { color: looiTheme.text, fontSize: 12 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: looiTheme.cyan, paddingHorizontal: 13, paddingVertical: 9 },
  actionSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: looiTheme.line },
  actionText: { color: "#041319", fontWeight: "700", fontSize: 14, textAlign: "center" },
  actionSecondaryText: { color: looiTheme.text, fontWeight: "700", fontSize: 14, textAlign: "center" },
  disabled: { opacity: 0.35 },
});
