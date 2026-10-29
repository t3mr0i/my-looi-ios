import { InterfacePressable as Pressable } from "./InterfacePressable";
import { useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { createBehaviorTranslator } from "../i18n/behavior-strings";
import { useUiText } from "../i18n/use-ui-text";
import { publishBehaviorEvent } from "../behavior/behavior-events";
import type { CompanionMotif, CompanionScene } from "../behavior/behavior-companion";
import type { BehaviorStringKey } from "../i18n/behavior-strings";
import {
  disableBehaviorPersonalRitual,
  forgetBehaviorExperience,
  resetBehaviorLearning,
  updateBehaviorSettings,
  useBehaviorStore,
} from "../behavior/behavior-runtime";
import type { BehaviorMode } from "../behavior/behavior-types";
import { looiTheme } from "./looi-theme";

const BEHAVIOR_MODES: BehaviorMode[] = ["off", "shadow", "active"];
const DAILY_BUDGETS = [0.25, 1, 3] as const;
type BehaviorMutationError = { kind: "forget" | "reset"; message: string } | { kind: "ritual"; id: string; message: string };
const MOTIF_STRINGS: Record<CompanionMotif, BehaviorStringKey> = {
  hold: "motifHold",
  curious: "motifCurious",
  happy_bob: "motifHappyBob",
  nod: "motifNod",
};
const SCENE_STATUS_STRINGS: Partial<Record<CompanionScene["status"], BehaviorStringKey>> = {
  awaiting_confirmation: "sceneAwaitingConfirmation",
  ready: "sceneReady",
  armed: "sceneArmed",
  started: "sceneStarted",
};
const SCENE_MATCH_STRINGS: Record<Exclude<CompanionScene["match"], null>, BehaviorStringKey> = {
  same: "sceneMatchSame",
  different: "sceneMatchDifferent",
  uncertain: "sceneMatchUncertain",
};

export function BehaviorSettings() {
  const { language, locale } = useUiText();
  const t = useMemo(() => createBehaviorTranslator(language), [language]);
  const [pendingMutation, setPendingMutation] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<BehaviorMutationError | null>(null);
  const mutationRef = useRef<string | null>(null);
  const settings = useBehaviorStore((state) => state.settings);
  const state = useBehaviorStore((store) => store.state);
  const experiences = state.companion.episodes;
  const scene = state.companion.scene;
  const sceneStatusKey = scene ? SCENE_STATUS_STRINGS[scene.status] : undefined;
  const showScene = !!sceneStatusKey && scene.status !== "closed" && scene.status !== "idle";
  const curiosityIsEnabled = settings.curiosityEnabled === true;
  const gameInProgress = state.game?.status === "active" || state.game?.status === "paused";
  const gameAction = gameInProgress ? "stop" : "start";
  const gameDisabled = !state.sessionId || settings.mode !== "active";

  const beginMutation = (action: string): boolean => {
    if (mutationRef.current !== null) return false;
    mutationRef.current = action;
    setPendingMutation(action);
    setMutationError(null);
    return true;
  };

  const finishMutation = () => {
    mutationRef.current = null;
    setPendingMutation(null);
  };

  const forgetExperience = async (id: string) => {
    if (!beginMutation(id)) return;
    try {
      await forgetBehaviorExperience(id);
    } catch {
      const message = t("forgetFailureMessage");
      setMutationError({ kind: "forget", message });
      Alert.alert(t("forgetFailureTitle"), message);
    } finally {
      finishMutation();
    }
  };

  const disablePersonalRitual = async (id: string) => {
    if (!beginMutation(`ritual:${id}`)) return;
    try {
      await disableBehaviorPersonalRitual(id);
    } catch {
      const message = t("disablePersonalRitualFailureMessage");
      setMutationError({ kind: "ritual", id, message });
      Alert.alert(t("disablePersonalRitualFailureTitle"), message);
    } finally {
      finishMutation();
    }
  };

  const clearLearning = async () => {
    if (!beginMutation("reset")) return;
    try {
      await resetBehaviorLearning();
    } catch {
      const message = t("resetFailureMessage");
      setMutationError({ kind: "reset", message });
      Alert.alert(t("resetFailureTitle"), message);
    } finally {
      finishMutation();
    }
  };

  const confirmLearningReset = () => {
    if (mutationRef.current !== null) return;
    Alert.alert(t("resetTitle"), t("resetMessage"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("resetLearning"), style: "destructive", onPress: () => { void clearLearning(); } },
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
          <Text style={styles.value}>{t("curiosityLabel")}</Text>
          <Text style={styles.help}>{t("curiosityHelp")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("curiosityLabel")}
          accessibilityHint={t("curiosityHelp")}
          accessibilityState={{ checked: curiosityIsEnabled, disabled: false }}
          onValueChange={(curiosityEnabled) => updateBehaviorSettings({ curiosityEnabled })}
          thumbColor={curiosityIsEnabled ? looiTheme.cyan : looiTheme.muted}
          trackColor={{ false: looiTheme.line, true: "rgba(40, 213, 255, 0.38)" }}
          value={curiosityIsEnabled}
        />
      </View>

      <View style={styles.innerDivider} />
      <Text accessibilityRole="header" style={styles.label}>{t("experiencesLabel")}</Text>
      <Text style={styles.help}>{t("experiencesHelp")}</Text>
      <Text style={styles.help}>{t("visualMemoryHelp")}</Text>
      <Text style={styles.help}>{t("ritualSignalHelp")}</Text>
      {experiences.length === 0 ? (
        <Text style={styles.emptyExperiences}>{t("experiencesEmpty")}</Text>
      ) : (
        <View style={styles.experiencesList}>
          {experiences.map((experience) => {
            const preference = experience.ritualPreference;
            const activePreference = preference?.mode === "active" ? preference : null;
            const ritualMutationKey = `ritual:${experience.id}`;
            return (
            <View key={experience.id} style={styles.experienceCard}>
              <Text style={styles.experienceTitle}>{experience.title}</Text>
              {experience.detail ? (
                <Text style={styles.help}>
                  {t("experienceDetail", { detail: experience.detail })}
                </Text>
              ) : null}
              {experience.outcome ? (
                <Text style={styles.help}>
                  {t("experienceOutcome", { outcome: experience.outcome })}
                </Text>
              ) : null}
              {activePreference ? (
                <>
                  <Text style={styles.help}>
                    {t("ritualPreferenceActive", { motif: t(MOTIF_STRINGS[activePreference.motif]) })}
                  </Text>
                  {activePreference.phrase ? (
                    <Text style={styles.help}>
                      {t("ritualPreferencePhrase", { phrase: activePreference.phrase })}
                    </Text>
                  ) : null}
                  <Text style={styles.help}>{t("ritualPreferenceLimitHelp")}</Text>
                  <Text style={styles.help}>{t("disablePersonalRitualHelp")}</Text>
                  <Pressable
                    accessibilityLabel={t(pendingMutation === ritualMutationKey ? "disablePersonalRitualBusyA11y" : "disablePersonalRitualA11y", { title: experience.title })}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pendingMutation !== null }}
                    disabled={pendingMutation !== null}
                    onPress={() => { void disablePersonalRitual(experience.id); }}
                    style={[styles.forgetExperienceButton, pendingMutation !== null && styles.disabledButton]}
                  >
                    <Text style={styles.forgetExperienceText}>
                      {t(pendingMutation === ritualMutationKey ? "disablePersonalRitualBusy" : "disablePersonalRitual")}
                    </Text>
                  </Pressable>
                  {mutationError?.kind === "ritual" && mutationError.id === experience.id ? (
                    <Text accessibilityRole="alert" style={styles.mutationError}>{mutationError.message}</Text>
                  ) : null}
                </>
              ) : preference?.mode === "silent" ? (
                <Text style={styles.help}>{t("ritualPreferenceSilent")}</Text>
              ) : experience.motif ? (
                <Text style={styles.help}>
                  {t("experienceMotif", { motif: t(MOTIF_STRINGS[experience.motif]) })}
                </Text>
              ) : null}
              {experience.visualMemory?.description ? (
                <View style={styles.visualMemory}>
                  <Text style={styles.visualMemoryLabel}>{t("visualMemoryLabel")}</Text>
                  <Text style={styles.help}>
                    {t("visualMemoryDescription", { description: experience.visualMemory.description })}
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel={t(pendingMutation === experience.id ? "forgetExperienceBusyA11y" : "forgetExperienceA11y", { title: experience.title })}
                accessibilityRole="button"
                accessibilityState={{ disabled: pendingMutation !== null }}
                disabled={pendingMutation !== null}
                onPress={() => { void forgetExperience(experience.id); }}
                style={[styles.forgetExperienceButton, pendingMutation !== null && styles.disabledButton]}
              >
                <Text style={styles.forgetExperienceText}>
                  {t(pendingMutation === experience.id ? "forgetExperienceBusy" : "forgetExperience")}
                </Text>
              </Pressable>
            </View>
            );
          })}
        </View>
      )}
      {showScene && scene && sceneStatusKey ? (
        <View style={styles.sceneCard}>
          <Text accessibilityRole="header" style={styles.experienceTitle}>
            {t("sceneHeading", { title: scene.episodeTitle || t("sharedRitual") })}
          </Text>
          <Text style={styles.help}>{t(sceneStatusKey)}</Text>
          {scene.match ? (
            <Text style={styles.help}>
              {t("sceneMatchLabel", { match: t(SCENE_MATCH_STRINGS[scene.match]) })}
            </Text>
          ) : null}
          {scene.baselineDescription ? (
            <Text style={styles.help}>
              {t("sceneBaseline", { description: scene.baselineDescription })}
            </Text>
          ) : null}
          {scene.currentDescription ? (
            <Text style={styles.help}>
              {t("sceneCurrent", { description: scene.currentDescription })}
            </Text>
          ) : null}
          {scene.change ? (
            <Text style={styles.help}>{t("sceneChange", { change: scene.change })}</Text>
          ) : null}
          {scene.signal ? (
            <Text style={styles.help}>
              {t("sceneSignalLabel", {
                signal: t(scene.signal === "open_palm" ? "sceneSignalOpenPalm" : "sceneSignalVoice"),
              })}
            </Text>
          ) : null}
          {scene.status === "armed" && scene.signal === "open_palm" ? (
            <Text style={styles.sceneInstruction}>{t("sceneOpenPalmWindowHelp")}</Text>
          ) : null}
          {scene.status === "armed" && scene.signal === "voice" ? (
            <Text style={styles.sceneInstruction}>{t("sceneVoiceWindowHelp")}</Text>
          ) : null}
        </View>
      ) : null}
      {mutationError?.kind === "forget" ? (
        <Text accessibilityRole="alert" style={styles.mutationError}>{mutationError.message}</Text>
      ) : null}

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
          accessibilityLabel={t(gameInProgress ? "gameA11yStop" : "gameA11yStart")}
          accessibilityRole="button"
          accessibilityState={{ disabled: gameDisabled }}
          disabled={gameDisabled}
          onPress={sendGameCommand}
          style={[styles.gameButton, gameDisabled && styles.disabledButton]}
        >
          <Text style={styles.gameButtonText}>{t(gameInProgress ? "gameStop" : "gameStart")}</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityLabel={t(pendingMutation === "reset" ? "resetLearningBusy" : "resetLearning")}
        accessibilityRole="button"
        accessibilityState={{ disabled: pendingMutation !== null }}
        disabled={pendingMutation !== null}
        onPress={confirmLearningReset}
        style={[styles.resetButton, pendingMutation !== null && styles.disabledButton]}
      >
        <Text style={styles.resetText}>{t(pendingMutation === "reset" ? "resetLearningBusy" : "resetLearning")}</Text>
      </Pressable>
      {mutationError?.kind === "reset" ? (
        <Text accessibilityRole="alert" style={styles.mutationError}>{mutationError.message}</Text>
      ) : null}
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
  help: { color: looiTheme.muted, fontSize: 14, lineHeight: 20 },
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
  experiencesList: { gap: 8 },
  experienceCard: {
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 12,
    backgroundColor: looiTheme.surface,
    padding: 11,
    gap: 6,
  },
  experienceTitle: { color: looiTheme.text, fontSize: 13, fontWeight: "800" },
  visualMemory: { borderLeftWidth: 2, borderLeftColor: looiTheme.lineActive, paddingLeft: 8, gap: 2, marginTop: 2 },
  visualMemoryLabel: { color: looiTheme.muted, fontSize: 11, fontWeight: "700" },
  sceneCard: {
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 12,
    backgroundColor: looiTheme.surface,
    padding: 11,
    gap: 5,
  },
  sceneInstruction: { color: looiTheme.text, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  emptyExperiences: { color: looiTheme.muted, fontSize: 12, lineHeight: 17, paddingVertical: 4 },
  forgetExperienceButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginTop: 2,
  },
  forgetExperienceText: { color: looiTheme.muted, fontSize: 12, fontWeight: "700" },
  mutationError: { color: looiTheme.danger, fontSize: 12, lineHeight: 17 },
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
  metricLabel: { flex: 1, color: looiTheme.muted, fontSize: 11, fontWeight: "600" },
  metricValue: { fontVariant: ["tabular-nums"], color: looiTheme.text, fontSize: 13, fontWeight: "800" },
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
