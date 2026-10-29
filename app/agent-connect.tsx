import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { configureAgentConnection } from "@/src/agent/agent-service";
import type { AgentConnection } from "@/src/agent/agent-protocol";
import { useUiText } from "@/src/i18n/use-ui-text";
import { agentWorkspaceText } from "@/src/i18n/agent-workspace-strings";
import {
  AgentConnectionSetup,
  AgentWorkspaceShell,
} from "@/src/ui/AgentWorkspace";

const connect = (connection: AgentConnection, signal: AbortSignal) =>
  configureAgentConnection(connection.url, connection.token, { signal });

export default function AgentConnectScreen() {
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
        title={agentWorkspaceText(language)("setupTitle")}
        language={language}
        onBack={() => router.replace("/agent")}
        onHome={() => router.replace("/")}
      >
        {focused ? (
          <AgentConnectionSetup
            language={language}
            connect={connect}
            onDone={() => router.replace("/agent")}
            onTry={() => router.push("/agent-playground")}
          />
        ) : null}
      </AgentWorkspaceShell>
    </>
  );
}
