import { InterfacePressable as Pressable } from "./InterfacePressable";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RobotAppsGlyph } from "./RobotAppsGlyph";
import { looiTheme } from "./looi-theme";

/** Apps owns its navigation; it never borrows screen width from the robot face. */
export function RobotAppsShell({ title, backLabel, onBack, setupLabel, onSetup, compactTitle = false, tabs, status, children }: {
  title: string; backLabel: string; onBack(): void;
  setupLabel: string; onSetup?: () => void; compactTitle?: boolean; tabs?: ReactNode; status?: ReactNode; children: ReactNode;
}) {
  return <SafeAreaView style={styles.safe}>
    <View style={styles.frame}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.back}>
          <RobotAppsGlyph name="back" size={20} color={looiTheme.cyan} />
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
        {onSetup ? <Pressable accessibilityRole="button" accessibilityLabel={setupLabel} onPress={onSetup} style={styles.iconButton}>
          <RobotAppsGlyph name="settings" size={23} />
        </Pressable> : null}
      </View>
      <Text accessibilityRole="header" style={[styles.title, compactTitle && styles.compactTitle]}>{title}</Text>
      {tabs ? <View style={styles.tabs}>{tabs}</View> : null}
      {status ? <View style={styles.status}>{status}</View> : null}
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}
        style={styles.scroll} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: looiTheme.bgRaised },
  frame: { flex: 1, width: "100%", maxWidth: 1040, alignSelf: "center" },
  toolbar: { minHeight: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 12, maxWidth: "85%" },
  backText: { color: looiTheme.cyan, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  title: { color: looiTheme.text, fontSize: 34, lineHeight: 41, fontWeight: "700", paddingHorizontal: 24, paddingTop: 4, paddingBottom: 20 },
  compactTitle: { fontSize: 26, lineHeight: 33, paddingBottom: 16 },
  tabs: { paddingHorizontal: 24, paddingBottom: 20 },
  status: { paddingHorizontal: 24 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
});
