import { InterfacePressable as Pressable } from "./InterfacePressable";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { useUiText } from "../i18n/use-ui-text";
import { createRobotAppSkillsTranslator, type RobotAppSkillStringKey } from "../i18n/robot-app-skill-strings";
import type { RobotAppSkillStatus } from "../robot-bridge/app-skills";
import {
  configureRobotAppSkillSettings, getRobotAppSkillsSnapshot, loadRobotAppSkillSettings,
  stopRobotAppSkills, subscribeRobotAppSkills,
} from "../robot-bridge/app-skill-runtime";
import { looiTheme } from "./looi-theme";

export function RobotAppSkillsPanel({ onBrowse, onSetup, companionReady }: {
  onBrowse(): void; onSetup(): void; companionReady: boolean;
}) {
  const { language } = useUiText();
  const t = useMemo(() => createRobotAppSkillsTranslator(language), [language]);
  const [snapshot, setSnapshot] = useState(getRobotAppSkillsSnapshot);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"loadError" | "saveError" | null>(null);
  const load = () => {
    setLoading(true);
    void loadRobotAppSkillSettings().then(value => { setEnabled(value.enabled); setError(null); })
      .catch(() => { setEnabled(false); setError("loadError"); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); return subscribeRobotAppSkills(setSnapshot); }, []);
  const change = (next: boolean) => {
    setEnabled(next); setSaving(true); setError(null);
    void configureRobotAppSkillSettings({ enabled: next }).catch(() => {
      setEnabled(getRobotAppSkillsSnapshot().enabled);
      setError("saveError");
    })
      .finally(() => setSaving(false));
  };
  const labels: Partial<Record<RobotAppSkillStatus, RobotAppSkillStringKey>> = {
    idle: "idle",
    resolving: "resolving", preparing: "preparing", installing: "installing", starting: "starting", running: "running",
    handoff_requested: "browser", handoff_released: "browserReleased", complete: "complete", stopping: "stopping", stopped: "stopped",
    failed: "failed", handoff_failed: "failed", busy: "failed", unavailable: "failed", disabled: "off",
    suspended: "stopped", stale_turn: "stopped", not_found: "failed", not_installable: "failed", invalid_request: "failed",
  };
  const hasOwnedApp = snapshot.activeApp !== null;
  const stateLabel = snapshot.errorCode === "stop_failed" ? t("stopFailed")
    : snapshot.status === "unavailable" ? t("unavailable")
    : snapshot.status === "handoff_released" ? t("browserReleased")
      : !enabled ? t("off") : t(labels[snapshot.status] ?? "failed");
  const canStop = hasOwnedApp && !["stopped", "complete", "failed"].includes(snapshot.status);
  return <View style={styles.panel}>
    <Text style={styles.help}>{t("intro")}</Text>
    <View style={styles.card}>
      <View style={styles.toggleRow}>
        <View style={styles.copy}><Text style={styles.title}>{t("enabled")}</Text><Text style={styles.help}>{t("enabledHelp")}</Text></View>
        {loading || saving ? <ActivityIndicator color={looiTheme.cyan} /> : <Switch accessibilityLabel={t("enabled")} value={enabled} onValueChange={change} disabled={Boolean(error === "loadError")} trackColor={{ false: looiTheme.line, true: "rgba(40,213,255,0.42)" }} thumbColor={enabled ? looiTheme.cyan : looiTheme.muted} />}
      </View>
    </View>

    <View style={styles.explanation}>
      <Text style={styles.title}>{t("installTitle")}</Text><Text style={styles.help}>{t("installHelp")}</Text>
      <Text style={styles.title}>{t("keepTitle")}</Text><Text style={styles.help}>{t("keepHelp")}</Text>
      <Text style={styles.title}>{t("webTitle")}</Text><Text style={styles.help}>{t("webHelp")}</Text>
    </View>
    {snapshot.activeApp || !["idle", "disabled"].includes(snapshot.status) ? <View style={styles.activity}>
      <Text style={styles.title}>{snapshot.activeApp?.title || t("current")}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.help}>{stateLabel}</Text>
      {canStop ? <Pressable accessibilityRole="button" onPress={() => void stopRobotAppSkills()} style={styles.stop}><Text style={styles.stopText}>{t("stop")}</Text></Pressable> : null}
    </View> : null}
    {error ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>{error === "loadError" ? <Pressable accessibilityRole="button" onPress={load} style={styles.secondary}><Text style={styles.buttonText}>{t("retry")}</Text></Pressable> : null}{error === "loadError" ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => change(false)} style={styles.secondary}><Text style={styles.buttonText}>{t("resetSetting")}</Text></Pressable> : null}</View> : null}

    <Pressable accessibilityRole="button" onPress={onBrowse} style={styles.secondary}><Text style={styles.buttonText}>{t("browse")}</Text></Pressable>
    {!companionReady ? <Pressable accessibilityRole="button" onPress={onSetup} style={styles.secondary}><Text style={styles.buttonText}>{t("setup")}</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 24 }, card: { padding: 20, borderRadius: 16, backgroundColor: "#0d1b29", gap: 12 },
  activity: { paddingVertical: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: looiTheme.whiteSoft },
  explanation: { paddingVertical: 8, gap: 12 },
  copy: { flex: 1, gap: 6 }, toggleRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: { color: looiTheme.text, fontSize: 17, lineHeight: 24, fontWeight: "600" }, help: { color: looiTheme.muted, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 48, backgroundColor: looiTheme.cyan, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
  secondary: { minHeight: 48, borderWidth: 1, borderColor: looiTheme.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
  primaryText: { color: "#04101b", fontWeight: "700", fontSize: 15 }, buttonText: { color: looiTheme.cyan, fontWeight: "600", fontSize: 15 },
  stop: { minHeight: 48, borderWidth: 1, borderColor: looiTheme.danger, borderRadius: 12, padding: 12, alignItems: "center", justifyContent: "center" },
  stopText: { color: looiTheme.danger, fontWeight: "600" }, error: { color: looiTheme.danger, fontSize: 15, lineHeight: 22 },
});
