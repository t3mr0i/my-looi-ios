import { Stack, useRouter } from "expo-router";
import { useUiText } from "@/src/i18n/use-ui-text";
import { agentWorkspaceText } from "@/src/i18n/agent-workspace-strings";
import { AgentPlayground, AgentWorkspaceShell } from "@/src/ui/AgentWorkspace";

export default function AgentPlaygroundScreen() {
  const router = useRouter();
  const { language } = useUiText();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AgentWorkspaceShell
        example
        title={agentWorkspaceText(language)("tryTitle")}
        language={language}
        onBack={() => router.replace("/agent")}
        onHome={() => router.replace("/")}
      >
        <AgentPlayground
          language={language}
          onBack={() => router.replace("/agent")}
        />
      </AgentWorkspaceShell>
    </>
  );
}
