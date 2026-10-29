import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { InterfacePressable } from "@/src/ui/InterfacePressable";
import { looiTheme } from "@/src/ui/looi-theme";
import { useUiText } from "@/src/i18n/use-ui-text";

export default function NotFoundScreen() {
  const { t } = useUiText();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>{t("notFound.body")}</Text>
        <InterfacePressable onPress={() => router.replace("/")} style={styles.link}>
          <Text style={styles.linkText}>{t("notFound.home")}</Text>
        </InterfacePressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: looiTheme.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 20 },
  title: { color: looiTheme.text, fontSize: 24, lineHeight: 32, fontWeight: "700", textAlign: "center" },
  link: { backgroundColor: looiTheme.cyan, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, justifyContent: "center" },
  linkText: { fontSize: 16, fontWeight: "600", color: looiTheme.bg },
});
