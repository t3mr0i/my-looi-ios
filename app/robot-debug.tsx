import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useUiText } from "@/src/i18n/use-ui-text";
import { createRobotDebugTranslator } from "@/src/i18n/robot-debug-strings";
import { RobotDebugPanel } from "@/src/ui/RobotDebugPanel";
import { looiTheme } from "@/src/ui/looi-theme";
import { acquireExternalMediaOwnership, releaseExternalMediaOwnership } from "@/src/core/app-bootstrap";

let mediaOwnerSequence = 0;

type MediaAccessState =
  | { status: "preparing"; owner: string | null }
  | { status: "ready" | "error"; owner: string };

export default function RobotDebugScreen() {
  const router = useRouter();
  const { language } = useUiText();
  const t = createRobotDebugTranslator(language);
  const isFocused = useIsFocused();
  const mediaOwnerRef = useRef<string | null>(null);
  const [mediaAccess, setMediaAccess] = useState<MediaAccessState>({ status: "preparing", owner: null });

  useFocusEffect(useCallback(() => {
    const owner = `robot-debug-${++mediaOwnerSequence}`;
    const controller = new AbortController();
    let focusIsCurrent = true;
    mediaOwnerRef.current = owner;
    setMediaAccess({ status: "preparing", owner });

    // This call closes voice admission synchronously before its queued teardown.
    void acquireExternalMediaOwnership(owner, controller.signal, { allowWhileSleeping: true }).then(() => {
      if (!focusIsCurrent || controller.signal.aborted || mediaOwnerRef.current !== owner) return;
      setMediaAccess({ status: "ready", owner });
    }).catch(() => {
      // Never surface or log raw lifecycle errors here; they may contain details
      // the user did not intend to expose in this screen.
      if (!focusIsCurrent || controller.signal.aborted || mediaOwnerRef.current !== owner) return;
      setMediaAccess({ status: "error", owner });
    });

    return () => {
      focusIsCurrent = false;
      controller.abort();
      if (mediaOwnerRef.current === owner) mediaOwnerRef.current = null;
      void releaseExternalMediaOwnership(owner).catch(() => undefined);
    };
  }, []));

  const ownsCurrentFocus = mediaAccess.owner !== null && mediaAccess.owner === mediaOwnerRef.current;
  const mediaReady = isFocused && ownsCurrentFocus && mediaAccess.status === "ready";
  const mediaError = isFocused && ownsCurrentFocus && mediaAccess.status === "error";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")}
          onPress={() => router.canGoBack() ? router.back() : router.replace("/onboarding")}
          style={styles.back}>
          <Text style={styles.backText}>{t("back")}</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t("title")}</Text>
      </View>
      {mediaReady ? (
        <RobotDebugPanel />
      ) : (
        <View style={styles.mediaStatus}>
          {!mediaError ? <ActivityIndicator color={looiTheme.cyan} size="small" /> : null}
          <Text style={mediaError ? styles.mediaError : styles.mediaHelp}>
            {t(mediaError ? "mediaPauseFailed" : "mediaPreparing")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: looiTheme.bg },
  header: { flexDirection: "row", alignItems: "center", padding: 16, gap: 16 },
  title: { flex: 1, color: looiTheme.text, fontSize: 22, fontWeight: "700" },
  back: { minWidth: 60, minHeight: 44, justifyContent: "center", paddingHorizontal: 12,
    borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12 },
  backText: { color: looiTheme.cyan, fontSize: 16, fontWeight: "600" },
  mediaStatus: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  mediaHelp: { color: looiTheme.muted, fontSize: 16, lineHeight: 22, textAlign: "center" },
  mediaError: { color: looiTheme.warn, fontSize: 16, lineHeight: 22, textAlign: "center" },
});
