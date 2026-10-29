import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import type {
  NousConnectLink,
  NousProvider,
  NousSnapshot,
} from "../agent/agent-nous";
import { getAgentErrorCode } from "../agent/agent-protocol";
import type { InterfaceLanguage } from "../i18n/ui-language";
import { nousText } from "../i18n/nous-strings";
import { AgentWorkspaceButton } from "./AgentWorkspace";
import { looiTheme as theme } from "./looi-theme";

type Props = {
  language: InterfaceLanguage;
  read(signal: AbortSignal): Promise<NousSnapshot>;
  start(
    provider: NousProvider,
    subject: string,
    signal: AbortSignal,
  ): Promise<NousConnectLink>;
  open(url: string): Promise<unknown>;
};
export function NousConnectionsPanel({ language, read, start, open }: Props) {
  const t = nousText(language);
  const [snapshot, setSnapshot] = useState<NousSnapshot | null>(null);
  const [link, setLink] = useState<NousConnectLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [error, setError] = useState<
    "error" | "unsupported" | "startFailed" | null
  >(null);
  const operation = useRef<AbortController | null>(null);
  const active = useRef(AppState.currentState === "active");
  const generation = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      active.current = next === "active";
      if (!active.current) {
        generation.current += 1;
        operation.current?.abort();
        operation.current = null;
        setBusy(false);
        setSnapshot(null);
        setIdentityConfirmed(false);
        setLink(null);
        setError(null);
      }
    });
    return () => {
      active.current = false;
      generation.current += 1;
      operation.current?.abort();
      operation.current = null;
      subscription.remove();
    };
  }, []);
  const run = async (provider?: NousProvider) => {
    if (
      !active.current ||
      operation.current ||
      (provider && (snapshot?.status !== "ready" || !identityConfirmed))
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      if (provider && snapshot?.status === "ready") {
        const result = await start(
          provider,
          snapshot.subject,
          controller.signal,
        );
        if (operation.current === controller && !controller.signal.aborted)
          setLink(result);
      } else {
        setIdentityConfirmed(false);
        setSnapshot(null);
        const result = await read(controller.signal);
        if (operation.current === controller && !controller.signal.aborted)
          setSnapshot(result);
      }
    } catch (failure) {
      if (operation.current !== controller || controller.signal.aborted) return;
      setSnapshot(null);
      setError(
        provider
          ? "startFailed"
          : getAgentErrorCode(failure) === "not_found"
            ? "unsupported"
            : "error",
      );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const openBrowser = async (url: string) => {
    if (!active.current) return;
    const currentGeneration = generation.current;
    try {
      await open(url);
    } catch {
      if (active.current && currentGeneration === generation.current)
        setError("error");
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.body}>{t("intro")}</Text>
      <Text style={styles.note}>{t("privacy")}</Text>
      <AgentWorkspaceButton
        title={busy ? t("checking") : t("check")}
        disabled={busy}
        onPress={() => {
          void run();
        }}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(error)}
        </Text>
      ) : null}
      {snapshot?.status === "server_login_required" ? (
        <Text style={styles.body}>{t("serverLogin")}</Text>
      ) : null}
      {snapshot?.status === "ready" ? (
        <>
          <Text style={styles.note}>{t("account")}</Text>
          <Text selectable style={styles.heading}>
            {snapshot.label}
          </Text>
          {snapshot.providers.length ? (
            <Text style={styles.note}>{t("identityWarning")}</Text>
          ) : null}
          {snapshot.providers.length > 0 && !identityConfirmed ? (
            <AgentWorkspaceButton
              title={t("confirmIdentity")}
              onPress={() => setIdentityConfirmed(true)}
            />
          ) : null}
          {(["gmail", "googlecalendar"] as const).map((provider) => {
            const accounts = snapshot.accounts.filter(
              (account) => account.provider === provider,
            );
            const available = snapshot.providers.includes(provider);
            return (
              <View key={provider} style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {t(provider)}
                </Text>
                {accounts.map((account) => (
                  <View key={account.id} style={styles.group}>
                    <Text selectable style={styles.body}>
                      {account.label}
                    </Text>
                    <Text style={styles.note}>
                      {t(account.connected ? "connected" : "pending")}
                    </Text>
                  </View>
                ))}
                {!available ? (
                  <Text style={styles.note}>{t("unavailable")}</Text>
                ) : null}
                {available && accounts.length === 0 ? (
                  <AgentWorkspaceButton
                    title={`${t(provider)}: ${t("connect")}`}
                    disabled={busy || Boolean(link) || !identityConfirmed}
                    onPress={() => {
                      void run(provider);
                    }}
                  />
                ) : null}
              </View>
            );
          })}
          <Text style={styles.note}>{t("manageHelp")}</Text>
          <AgentWorkspaceButton
            title={t("manage")}
            secondary
            disabled={busy}
            onPress={() => {
              void openBrowser("https://portal.nousresearch.com");
            }}
          />
        </>
      ) : null}
      {link ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("browserTitle")}
          </Text>
          <Text style={styles.note}>{t("browserHost")}</Text>
          <Text selectable style={styles.body}>
            {new URL(link.url).origin}
          </Text>
          <Text style={styles.note}>{t("browserHelp")}</Text>
          <AgentWorkspaceButton
            title={t("browser")}
            onPress={() => {
              void openBrowser(link.url);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 16 },
  section: {
    gap: 12,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderColor: theme.line,
  },
  body: { color: theme.text, fontSize: 16, lineHeight: 25 },
  note: { color: theme.muted, fontSize: 15, lineHeight: 23 },
  heading: {
    color: theme.text,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "700",
  },
  error: { color: theme.danger, fontSize: 16, lineHeight: 25 },
});
