import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking } from "react-native";
import {
  getNousConnections,
  startNousConnection,
} from "@/src/agent/agent-service";
import type { NousProvider } from "@/src/agent/agent-nous";
import { useUiText } from "@/src/i18n/use-ui-text";
import { nousText } from "@/src/i18n/nous-strings";
import { AgentWorkspaceShell } from "@/src/ui/AgentWorkspace";
import { NousConnectionsPanel } from "@/src/ui/NousConnectionsPanel";

const read = (signal: AbortSignal) => getNousConnections({ signal });
const start = (provider: NousProvider, subject: string, signal: AbortSignal) =>
  startNousConnection(provider, subject, { signal });
const open = (url: string) => Linking.openURL(url);
export default function AgentNousScreen() {
  const router = useRouter();
  const { language } = useUiText();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AgentWorkspaceShell
        title={nousText(language)("title")}
        language={language}
        onBack={() => router.replace("/agent")}
        onHome={() => router.replace("/")}
      >
        {focused ? (
          <NousConnectionsPanel
            language={language}
            read={read}
            start={start}
            open={open}
          />
        ) : null}
      </AgentWorkspaceShell>
    </>
  );
}
