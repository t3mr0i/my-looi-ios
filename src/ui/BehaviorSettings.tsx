import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { createBehaviorTranslator } from "../i18n/behavior-strings";
import { useUiText } from "../i18n/use-ui-text";
import { publishBehaviorEvent } from "../behavior/behavior-events";
import {
  resetBehaviorLearning,
  updateBehaviorSettings,
  useBehaviorStore,
} from "../behavior/behavior-runtime";
import type { BehaviorMode } from "../behavior/behavior-types";
import { looiTheme } from "./looi-theme";

const BEHAVIOR_MODES: BehaviorMode[] = ["off", "shadow", "active"];
const DAILY_BUDGETS = [0.25, 1, 3] as const;

export function BehaviorSettings() {
  const { language, locale } = useUiText();
  const t = useMemo(() => createBehaviorTranslator(language), [language]);
  const settings = useBehaviorStore((state) => state.settings);
  const state = useBehaviorStore((store) => store.state);
  const gameActive = state.game?.status === "active";
  const gameAction = gameActive ? "stop" : "start";
  const gameDisabled = !state.sessionId || settings.mode !== "active";

  const confirmLearningReset = () => {
    Alert.alert(t("resetTitle"), t("resetMessage"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("resetLearning"), style: "destructive", onPress: resetBehaviorLearning },
    ]);
  };

  const sendGameCommand = () => {
    if (!state.sessionId) return;
    publishBehaviorEvent({ type: "game-command", action: gameAction, sessionId: state.sessionId });
  };

  const formatCount = (value: number) => {
    const count = Number.isSafeInteger(value) ? Math.max(0, value) : 0;
    return count > 999_999 ? t("countCapped") : count.toLocaleString(locale);
  };
  const recordedCost = Number.isFinite(state.metrics.costUsd) && state.metrics.costUsd >= 0
    ? state.metrics.costUsd
    : 0;
  const formattedCost = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(recordedCost);

  return (
    <View style={styles.subCard}>
      <Text style={styles.title}>{t("title")}</Text>
      <Text style={styles.help}>{t("intro")}</Text>

      <Text style={styles.label}>{t("modeLabel")}</Text>
      <View accessibilityLabel={t("modeLabel")} style={styles.optionWrap}>
        {BEHAVIOR_MODES.map((mode) => {
          const label = t(`mode${mode[0].toUpperCase()}${mode.slice(1)}` as "modeOff" | "modeShadow" | "modeActive");
          const detail = t(`mode${mode[0].toUpperCase()}${mode.slice(1)}Help` as "modeOffHelp" | "modeShadowHelp" | "modeActiveHelp");
          const selected = settings.mode === mode;
          return (
            <Pressable
              key={mode}
              accessibilityLabel={t("modeA11y", { mode: label })}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: false }}
              onPress={() => updateBehaviorSettings({ mode })}
              style={[styles.modeOption, selected && styles.optionSelected]}
            >
              <View style={styles.optionHeader}>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.value}>{label}</Text>
              </View>
              <Text style={styles.help}>{detail}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.notice}>{t("dataNotice")}</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.value}>{t("visualLabel")}</Text>
          <Text style={styles.help}>{t("visualHelp")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("visualLabel")}
          accessibilityState={{ checked: settings.visualEnabled, disabled: false }}
          onValueChange={(visualEnabled) => updateBehaviorSettings({ visualEnabled })}
          thumbColor={settings.visualEnabled ? looiTheme.cyan : looiTheme.muted}
          trackColor={{ false: looiTheme.line, true: "rgba(40, 213, 255, 0.38)" }}
          value={settings.visualEnabled}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.value}>{t("compareLabel")}</Text>
          <Text style={styles.help}>{t("compareHelp")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("compareLabel")}
          accessibilityState={{ checked: settings.candidateScoring, disabled: false }}
          onValueChange={(candidateScoring) => updateBehaviorSettings({ candidateScoring })}
          thumbColor={settings.candidateScoring ? looiTheme.cyan : looiTheme.muted}
          trackColor={{ false: looiTheme.line, true: "rgba(40, 213, 255, 0.38)" }}
          value={settings.candidateScoring}
        />
      </View>

      <View style={styles.innerDivider} />
      <Text style={styles.label}>{t("budgetLabel")}</Text>
      <View style={styles.budgetRow}>
        {DAILY_BUDGETS.map((dailyBudgetUsd) => {
          const selected = settings.dailyBudgetUsd === dailyBudgetUsd;
          const amount = `$${dailyBudgetUsd.toFixed(dailyBudgetUsd === 0.25 ? 2 : 0)}`;
          return (
            <Pressable
              key={dailyBudgetUsd}
              accessibilityLabel={t("budgetOptionA11y", { amount })}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: false }}
              onPress={() => updateBehaviorSettings({ dailyBudgetUsd })}
              style={[styles.budgetOption, selected && styles.optionSelected]}
            >
              <Text style={styles.value}>{amount}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.help}>{t("budgetHelp")}</Text>

      <View style={styles.innerDivider} />
      <Text style={styles.label}>{t("useLabel")}</Text>
      <View style={styles.metricsList}>
        <Metric label={t("requests")} value={formatCount(state.metrics.requests)} />
        <Metric label={t("completed")} value={formatCount(state.metrics.completed)} />
        <Metric label={t("errors")} value={formatCount(state.metrics.failed)} />
        <Metric label={t("stale")} value={formatCount(state.metrics.stale)} />
        <Metric label={t("recordedCost")} value={formattedCost} />
      </View>

      <View style={styles.postureRow}>
        <Text style={styles.help}>{t("posture")}</Text>
        <Text style={styles.posturePill}>{t(`posture${state.posture[0].toUpperCase()}${state.posture.slice(1)}` as "postureAttend" | "postureReflect" | "postureYield" | "postureSettle")}</Text>
      </View>

      <View style={styles.innerDivider} />
      <View style={styles.gameRow}>
        <View style={styles.gameCopy}>
          <Text style={styles.value}>{t("gameTitle")}</Text>
          <Text style={styles.help}>{t("gameHelp")}</Text>
        </View>
        <Pressable
          accessibilityLabel={t(gameActive ? "gameA11yStop" : "gameA11yStart")}
          accessibilityRole="button"
          accessibilityState={{ disabled: gameDisabled }}
          disabled={gameDisabled}
          onPress={sendGameCommand}
          style={[styles.gameButton, gameDisabled && styles.disabledButton]}
        >
          <Text style={styles.gameButtonText}>{t(gameActive ? "gameStop" : "gameStart")}</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityLabel={t("resetLearning")}
        accessibilityRole="button"
        accessibilityState={{ disabled: false }}
        onPress={confirmLearningReset}
        style={styles.resetButton}
      >
        <Text style={styles.resetText}>{t("resetLearning")}</Text>
      </Pressable>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  subCard: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: looiTheme.line,
    paddingTop: 12,
    gap: 10,
  },
  title: { color: looiTheme.text, fontSize: 15, fontWeight: "800" },
  label: { color: looiTheme.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  value: { color: looiTheme.text, fontSize: 13, fontWeight: "700" },
  help: { color: looiTheme.muted, fontSize: 12, lineHeight: 17 },
  notice: {
    color: looiTheme.warn,
    fontSize: 12,
    lineHeight: 17,
  },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeOption: {
    flexGrow: 1,
    flexBasis: 145,
    minWidth: 130,
    minHeight: 72,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    backgroundColor: looiTheme.surface,
    padding: 11,
    gap: 6,
  },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionSelected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40,213,255,0.07)" },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: looiTheme.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: looiTheme.cyan },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: looiTheme.cyan },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  switchCopy: { flex: 1, gap: 2 },
  innerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: looiTheme.line, marginTop: 2 },
  budgetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  budgetOption: {
    flexGrow: 1,
    minWidth: 84,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  metricsList: { gap: 2 },
  metricRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: looiTheme.line,
    paddingVertical: 6,
  },
  metricLabel: { color: looiTheme.muted, fontSize: 11, fontWeight: "600" },
  metricValue: { color: looiTheme.text, fontSize: 13, fontWeight: "800" },
  postureRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  posturePill: {
    color: looiTheme.cyan,
    fontSize: 11,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  gameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  gameCopy: { flex: 1, minWidth: 150, gap: 2 },
  gameButton: {
    minHeight: 48,
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: looiTheme.cyan,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  gameButtonText: { color: "#041319", fontSize: 12, fontWeight: "800" },
  disabledButton: { opacity: 0.45 },
  resetButton: {
    minHeight: 48,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  resetText: { color: looiTheme.muted, fontSize: 12, fontWeight: "700" },
});
