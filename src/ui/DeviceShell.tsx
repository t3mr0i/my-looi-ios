import { RobotFace } from "@/src/ui/RobotFace";
import { looiTheme } from "@/src/ui/looi-theme";
import { useUiText } from "@/src/i18n/use-ui-text";
import type { UiStringKey } from "@/src/i18n/ui-strings";
import { Href, usePathname, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import regularSymbolWeight from "expo-symbols/androidWeights/regular";
import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { InterfacePressable as Pressable } from "./InterfacePressable";
import { SafeAreaView } from "react-native-safe-area-context";

type DeviceShellProps = {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  scroll?: boolean;
  onReturnHome?: () => void;
};

type DeviceShellHeaderProps = {
  title: string;
  eyebrow?: string;
  onReturnHome?: () => void;
};

const navItems = [
  {
    href: "/conversation",
    matchPath: "/conversation",
    labelKey: "nav.conversations" as UiStringKey,
    symbol: { ios: "message", android: "chat_bubble_outline" },
    activeSymbol: { ios: "message.fill", android: "chat" },
  },
  {
    href: "/memories",
    matchPath: "/memories",
    labelKey: "nav.memory" as UiStringKey,
    symbol: { ios: "brain.head.profile", android: "psychology" },
    activeSymbol: { ios: "brain.head.profile", android: "psychology" },
  },
  {
    href: "/apps",
    matchPath: "/apps",
    labelKey: "nav.apps" as UiStringKey,
    symbol: { ios: "square.grid.2x2", android: "apps" },
    activeSymbol: { ios: "square.grid.2x2.fill", android: "apps" },
  },
  {
    href: "/settings",
    matchPath: "/settings",
    labelKey: "nav.settings" as UiStringKey,
    symbol: { ios: "gearshape", android: "settings" },
    activeSymbol: { ios: "gearshape.fill", android: "settings" },
  },
] as const;

export function DeviceShell({
  title,
  eyebrow,
  children,
  scroll = true,
  onReturnHome,
}: DeviceShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 600 || (width < 900 && fontScale > 1.3);
  const { t } = useUiText();
  const returnHome = () => {
    if (onReturnHome) {
      onReturnHome();
      return;
    }
    router.replace("/");
  };
  const content = scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, compact && styles.contentCompact]}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <DeviceShellHeader title={title} eyebrow={eyebrow} onReturnHome={returnHome} />
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixedContent, compact && styles.contentCompact]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backgroundGrid} pointerEvents="none" />
      <View style={[styles.frame, compact && styles.frameCompact]}>
        <View style={[styles.rail, compact && styles.railCompact, compact && { height: Math.max(80, 52 + fontScale * 28) }]}>
          {!compact ? <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("nav.returnHome")}
            onPress={returnHome}
            style={styles.homeButton}
          >
            <Text style={styles.homeMark}>LOOI</Text>
          </Pressable> : null}
          <ScrollView horizontal={compact} style={styles.navScroll} contentContainerStyle={[styles.navStack, compact && styles.navStackCompact]} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
            {navItems.map((item) => {
              const active = pathname === item.matchPath;
              return (
                <Pressable
                  key={item.href}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (active) return;
                    router.replace(item.href as Href);
                  }}
                  style={[
                    styles.navItem,
                    compact && styles.navItemCompact,
                    active && styles.navItemActive,
                  ]}
                >
                  <SymbolView
                    name={active ? item.activeSymbol : item.symbol}
                    size={24}
                    tintColor={active ? looiTheme.cyan : looiTheme.muted}
                    weight={{ ios: "semibold", android: regularSymbolWeight }}
                    fallback={
                      <View
                        style={[
                          styles.navIconFallback,
                          active && styles.navIconFallbackActive,
                        ]}
                      />
                    }
                  />
                  <Text
                    numberOfLines={compact ? 2 : undefined}
                    style={[styles.navLabel, active && styles.navLabelActive]}
                  >
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.main}>
          {content}
        </View>
      </View>
    </SafeAreaView>
  );
}

export function DeviceShellHeader({
  title,
  eyebrow,
  onReturnHome,
}: DeviceShellHeaderProps) {
  const router = useRouter();
  const returnHome = () => {
    if (onReturnHome) {
      onReturnHome();
      return;
    }
    router.replace("/");
  };

  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
      <RobotFace mode="avatar" onPress={returnHome} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: looiTheme.bg,
  },
  backgroundGrid: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.12,
    backgroundColor: looiTheme.bg,
    borderColor: looiTheme.line,
    borderWidth: 1,
  },
  frame: {
    flex: 1,
    flexDirection: "row",
    padding: 10,
    gap: 10,
  },
  frameCompact: { flexDirection: "column-reverse", padding: 8, gap: 8 },
  rail: {
    width: 112,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.rail,
    alignItems: "center",
    paddingVertical: 10,
  },
  railCompact: { width: "100%", borderRadius: 22, paddingVertical: 4 },
  homeButton: {
    width: 66,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "rgba(40, 213, 255, 0.06)",
  },
  homeMark: {
    color: looiTheme.text,
    fontSize: 12,
    fontWeight: "700",
  },
  navStack: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  navScroll: { flex: 1, width: "100%" },
  navStackCompact: { flexDirection: "row", paddingHorizontal: 4, paddingVertical: 0, gap: 4 },
  navItemCompact: { flex: 1, width: "auto", minWidth: 66, minHeight: 60, paddingHorizontal: 4, paddingVertical: 6 },
  navItem: {
    width: 94,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navItemActive: {
    borderColor: looiTheme.lineActive,
    backgroundColor: "rgba(40, 213, 255, 0.08)",
  },
  navIconFallback: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: looiTheme.muted,
  },
  navIconFallbackActive: {
    borderColor: looiTheme.cyan,
  },
  navLabel: {
    width: "100%",
    color: looiTheme.muted,
    fontSize: 12,
    textAlign: "center",
    flexShrink: 1,
  },
  navLabelActive: {
    color: looiTheme.text,
  },
  main: {
    flex: 1,
    borderRadius: 30,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.bgRaised,
  },
  header: {
    minHeight: 78,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    color: looiTheme.cyan,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  title: {
    color: looiTheme.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 12,
  },
  fixedContent: {
    flex: 1,
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 12,
  },
  contentCompact: { paddingHorizontal: 16 },
});
