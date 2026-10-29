import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createAgentExample,
  reduceAgentExample,
  type AgentExample,
} from "../agent/agent-examples";
import {
  normalizeAgentConnection,
  type AgentConnection,
} from "../agent/agent-protocol";
import { parseAgentSetupCode } from "../agent/agent-setup-code";
import {
  agentWorkspaceText,
  type AgentWorkspaceKey,
} from "../i18n/agent-workspace-strings";
import type { InterfaceLanguage } from "../i18n/ui-language";
import { looiTheme as theme } from "./looi-theme";
import { nousText } from "../i18n/nous-strings";

type Props = { language: InterfaceLanguage };
type ButtonProps = {
  title: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
};

/** Reading and setup use the full display; returning to the face stays explicit. */
export function AgentWorkspaceShell({
  title,
  language,
  onBack,
  onHome,
  children,
  example = false,
}: Props & {
  title: string;
  onBack(): void;
  onHome(): void;
  children: ReactNode;
  example?: boolean;
}) {
  const t = agentWorkspaceText(language);
  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.toolbar}>
        <Button title={t("back")} secondary onPress={onBack} />
        <Button title={t("home")} secondary onPress={onHome} />
      </View>
      {example ? (
        <Text style={[styles.badge, styles.stickyNotice]}>
          {t("exampleBadge")}
        </Text>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondary : styles.primary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary ? styles.secondaryText : styles.primaryText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function AgentWorkspaceIntro({
  language,
  onTry,
  onConnect,
}: Props & { onTry(): void; onConnect(): void }) {
  const t = agentWorkspaceText(language);
  return (
    <View style={styles.group}>
      <Text style={styles.body}>{t("intro")}</Text>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t("tryTitle")}
        </Text>
        <Text style={styles.body}>{t("tryHelp")}</Text>
        <Button title={t("tryAction")} onPress={onTry} />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t("connectTitle")}
        </Text>
        <Text style={styles.body}>{t("connectHelp")}</Text>
        <Button title={t("connectAction")} onPress={onConnect} secondary />
      </View>
    </View>
  );
}

export function AgentConnectionScope({
  language,
  onNous,
}: Props & { onNous(): void }) {
  const t = agentWorkspaceText(language);
  return (
    <View style={styles.scope}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("capabilityTitle")}
      </Text>
      <Text style={styles.body}>{t("research")}</Text>
      <Text style={styles.note}>{t("researchHelp")}</Text>
      <Text style={styles.body}>{t("accounts")}</Text>
      <Text style={styles.note}>{t("unavailable")}</Text>
      <Button title={nousText(language)("open")} secondary onPress={onNous} />
    </View>
  );
}

export function AgentPlayground({
  language,
  onBack,
}: Props & { onBack(): void }) {
  const t = agentWorkspaceText(language);
  const [state, dispatch] = useReducer(reduceAgentExample, undefined, () =>
    createAgentExample(),
  );
  useEffect(() => {
    // Examples never enter task storage, diagnostics, memory or the voice session.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") dispatch({ type: "reset" });
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [language]);
  const choices: AgentExample[] = ["day", "mail", "appointment"];
  const introKey: Record<AgentExample, AgentWorkspaceKey> = {
    day: "dayIntro",
    mail: "mailIntro",
    appointment: "appointmentIntro",
  };
  const runKey: Record<AgentExample, AgentWorkspaceKey> = {
    day: "runDay",
    mail: "runMail",
    appointment: "runAppointment",
  };
  const hasResult = state.stage !== "ready";
  const readingMail = state.example === "mail" && state.selectedMail !== null;
  const mailSubject =
    state.selectedMail === "materials" ? "subjectTwo" : "subjectOne";
  const mailBody = state.selectedMail === "materials" ? "bodyTwo" : "bodyOne";
  return (
    <View style={styles.group}>
      <Text style={styles.body}>
        {t(readingMail ? "exampleMailNotice" : "exampleNotice")}
      </Text>
      {readingMail ? (
        <Button
          title={t("closeMail")}
          secondary
          onPress={() => dispatch({ type: "close-mail" })}
        />
      ) : (
        <View accessibilityRole="tablist" style={styles.tabs}>
          {choices.map((example) => (
            <Pressable
              key={example}
              accessibilityRole="tab"
              accessibilityState={{ selected: state.example === example }}
              onPress={() => dispatch({ type: "choose", example })}
              style={[
                styles.tab,
                state.example === example && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  state.example === example && styles.tabTextActive,
                ]}
              >
                {t(example)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {!readingMail ? (
        <Text accessibilityRole="header" style={styles.heading}>
          {t(introKey[state.example])}
        </Text>
      ) : null}
      {!hasResult ? (
        <Button
          title={t(runKey[state.example])}
          onPress={() => dispatch({ type: "run" })}
        />
      ) : null}

      {hasResult && state.example === "day" ? (
        <View style={styles.document}>
          <Text style={styles.note}>{t("exampleDay")}</Text>
          <Text style={styles.body}>{t("dayResult")}</Text>
          <Text style={styles.agenda}>{t("eventOne")}</Text>
          <Text style={styles.agenda}>{t("eventTwo")}</Text>
        </View>
      ) : null}

      {hasResult && state.example === "mail" ? (
        state.selectedMail ? (
          <View style={styles.document}>
            <Text style={styles.note}>{t("mailAccount")}</Text>
            <Text
              selectable
              accessibilityRole="header"
              style={styles.mailSubject}
            >
              {t(mailSubject)}
            </Text>
            <Text selectable style={styles.body}>
              {t("sender")}: {t("senderName")} · mira@example.invalid
            </Text>
            <Text selectable style={styles.note}>
              {t("recipient")}: alex@example.invalid
            </Text>
            <Text style={styles.note}>{t("received")}</Text>
            <Text selectable style={styles.mailBody}>
              {t(mailBody)}
            </Text>
            <Text accessibilityRole="header" style={styles.heading}>
              {t("draftTitle")}
            </Text>
            <Text style={styles.note}>{t("draftHelp")}</Text>
            <TextInput
              accessibilityLabel={t("draftTitle")}
              value={state.draft}
              multiline
              maxLength={4000}
              placeholder={t("draftPlaceholder")}
              placeholderTextColor={theme.muted}
              textAlignVertical="top"
              onChangeText={(text) => dispatch({ type: "edit-draft", text })}
              style={[styles.input, styles.draft]}
            />
            {state.selectedMail === "workshop" && !state.draft.trim() ? (
              <Button
                title={t("prepareReply")}
                secondary
                onPress={() =>
                  dispatch({ type: "edit-draft", text: t("replyText") })
                }
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.document}>
            <Text accessibilityRole="header" style={styles.heading}>
              {t("mailAccount")}
            </Text>
            {(["workshop", "materials"] as const).map((id) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={t(
                  id === "workshop" ? "subjectOne" : "subjectTwo",
                )}
                onPress={() => dispatch({ type: "open-mail", id })}
                style={styles.mailRow}
              >
                <Text style={styles.note}>{t("senderName")}</Text>
                <Text style={styles.body}>
                  {t(id === "workshop" ? "subjectOne" : "subjectTwo")}
                </Text>
                <Text style={styles.link}>{t("openMail")}</Text>
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {hasResult && state.example === "appointment" ? (
        <View style={styles.document}>
          <Text accessibilityRole="header" style={styles.mailSubject}>
            {state.stage === "review" ? t("reviewTitle") : t("eventTitle")}
          </Text>
          <Text style={styles.body}>{t("eventTitle")}</Text>
          <Text style={styles.body}>{t("eventTime")}</Text>
          <Text style={styles.body}>
            {t("calendar")}: {t("exampleCalendar")}
          </Text>
          <Text selectable style={styles.body}>
            {t("attendee")}: {t("senderName")} · mira@example.invalid
          </Text>
          <Text style={styles.note}>{t("inviteEffect")}</Text>
          {state.stage === "result" ? (
            <Button
              title={t("review")}
              onPress={() => dispatch({ type: "review" })}
            />
          ) : null}
          {state.stage === "review" ? (
            <>
              <Button
                title={t("approve")}
                onPress={() => dispatch({ type: "approve" })}
              />
              <Button
                title={t("uncertainAction")}
                secondary
                onPress={() => dispatch({ type: "simulate-uncertain" })}
              />
            </>
          ) : null}
          {state.stage === "approved" ? (
            <Text accessibilityLiveRegion="polite" style={styles.success}>
              {t("approved")}
            </Text>
          ) : null}
          {state.stage === "uncertain" ? (
            <>
              <Text accessibilityRole="header" style={styles.warning}>
                {t("uncertainTitle")}
              </Text>
              <Text style={styles.body}>{t("uncertainHelp")}</Text>
            </>
          ) : null}
        </View>
      ) : null}
      {hasResult ? (
        <Button
          title={t("restart")}
          secondary
          onPress={() => dispatch({ type: "reset" })}
        />
      ) : null}
      <Text style={styles.note}>{t("privateNote")}</Text>
      <Button title={t("leaveExamples")} secondary onPress={onBack} />
    </View>
  );
}

type SetupProps = Props & {
  connect(connection: AgentConnection, signal: AbortSignal): Promise<void>;
  onDone(): void;
  onTry(): void;
};
export function AgentConnectionSetup({
  language,
  connect,
  onDone,
  onTry,
}: SetupProps) {
  const t = agentWorkspaceText(language);
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [review, setReview] = useState<AgentConnection | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "connected">(
    "idle",
  );
  const [error, setError] = useState<AgentWorkspaceKey | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const active = useRef(AppState.currentState === "active");
  const reset = () => {
    setCode("");
    setKey("");
    setUrl("");
    setReview(null);
    setStatus("idle");
  };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      active.current = next === "active";
      if (!active.current) {
        generation.current += 1;
        attempt.current?.abort();
        attempt.current = null;
        reset();
        setError("setupPaused");
      }
    });
    return () => {
      generation.current += 1;
      attempt.current?.abort();
      subscription.remove();
    };
  }, []);
  const prepare = () => {
    if (!active.current) return;
    try {
      const connection = manual
        ? normalizeAgentConnection(url, key)
        : parseAgentSetupCode(code);
      setReview(connection);
      setCode("");
      setKey("");
      setUrl("");
      setError(null);
    } catch {
      setError(manual ? "invalidManual" : "invalidCode");
    }
  };
  const confirm = async () => {
    if (!review || attempt.current || !active.current) return;
    const controller = new AbortController();
    const current = ++generation.current;
    attempt.current = controller;
    setStatus("checking");
    setError(null);
    try {
      await connect(review, controller.signal);
      if (current !== generation.current || controller.signal.aborted) return;
      setReview(null);
      setStatus("connected");
    } catch (failure) {
      if (current !== generation.current || controller.signal.aborted) return;
      const reason =
        failure && typeof failure === "object" && "code" in failure
          ? failure.code
          : "network";
      setError(
        reason === "auth"
          ? "authFailed"
          : reason === "storage"
            ? "storageFailed"
            : "connectionFailed",
      );
      setStatus("idle");
    } finally {
      if (attempt.current === controller) attempt.current = null;
    }
  };
  const inputProps = {
    autoCapitalize: "none" as const,
    autoCorrect: false,
    autoComplete: "off" as const,
    placeholderTextColor: theme.muted,
    style: styles.input,
  };
  return (
    <View style={styles.group}>
      {status === "connected" ? (
        <>
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={styles.success}
          >
            {t("connected")}
          </Text>
          <Text style={styles.body}>{t("connectedHelp")}</Text>
          <Button title={t("toTasks")} onPress={onDone} />
        </>
      ) : review ? (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("stepReview")}
          </Text>
          <Text style={styles.note}>{t("hostLabel")}</Text>
          <Text selectable style={styles.address}>
            {review.url}
          </Text>
          <Text style={styles.body}>{t("consent")}</Text>
          <Text style={styles.note}>{t("limits")}</Text>
          {status === "checking" ? (
            <View accessibilityLiveRegion="polite" style={styles.loading}>
              <ActivityIndicator color={theme.cyan} />
              <Text style={styles.body}>{t("checking")}</Text>
            </View>
          ) : null}
          <Button
            title={t("confirm")}
            disabled={status === "checking"}
            onPress={() => {
              void confirm();
            }}
          />
          <Button
            title={t("editCode")}
            disabled={status === "checking"}
            secondary
            onPress={() => {
              reset();
              setError(null);
            }}
          />
        </>
      ) : (
        <>
          <Text style={styles.body}>{t("setupIntro")}</Text>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("stepCode")}
          </Text>
          {manual ? (
            <>
              <Text style={styles.label}>{t("address")}</Text>
              <TextInput
                {...inputProps}
                accessibilityLabel={t("address")}
                value={url}
                onChangeText={(value) => {
                  setUrl(value);
                  setError(null);
                }}
                maxLength={2048}
                keyboardType="url"
                placeholder="https://agent.example.com"
              />
              <Text style={styles.note}>{t("addressHelp")}</Text>
              <Text style={styles.label}>{t("key")}</Text>
              <TextInput
                {...inputProps}
                accessibilityLabel={t("key")}
                value={key}
                onChangeText={(value) => {
                  setKey(value);
                  setError(null);
                }}
                maxLength={512}
                secureTextEntry
              />
            </>
          ) : (
            <>
              <Text style={styles.label}>{t("codeLabel")}</Text>
              <TextInput
                {...inputProps}
                accessibilityLabel={t("codeLabel")}
                value={code}
                onChangeText={(value) => {
                  setCode(value);
                  setError(null);
                }}
                maxLength={4096}
                placeholder={t("codePlaceholder")}
                secureTextEntry
              />
            </>
          )}
          <Text style={styles.note}>{t("codeHelp")}</Text>
          <Button
            title={t("continue")}
            onPress={prepare}
            disabled={manual ? !url.trim() || !key.trim() : !code.trim()}
          />
          <Button
            title={manual ? t("codeLabel") : t("manual")}
            secondary
            onPress={() => {
              reset();
              setManual(!manual);
              setError(null);
            }}
          />
          <Text style={styles.note}>{t("noCode")}</Text>
          <Button title={t("tryAction")} secondary onPress={onTry} />
          <Text style={styles.note}>{t("schoolHelp")}</Text>
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(error)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.bg },
  stickyNotice: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  toolbar: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  scroll: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 20,
  },
  title: {
    color: theme.text,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    paddingVertical: 8,
  },
  group: { gap: 16, width: "100%", maxWidth: 720, alignSelf: "center" },
  section: {
    gap: 12,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: theme.line,
  },
  scope: { gap: 8, paddingVertical: 20 },
  heading: {
    color: theme.text,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "700",
  },
  body: { color: theme.text, fontSize: 16, lineHeight: 25 },
  note: { color: theme.muted, fontSize: 15, lineHeight: 23 },
  label: { color: theme.text, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  badge: { color: theme.warn, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  button: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: theme.cyan },
  secondary: {
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bgRaised,
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    textAlign: "center",
  },
  primaryText: { color: theme.bg },
  secondaryText: { color: theme.text },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  tabs: { gap: 8, flexDirection: "row", flexWrap: "wrap", paddingVertical: 4 },
  tab: {
    minHeight: 48,
    minWidth: 96,
    flexGrow: 1,
    flexBasis: 96,
    padding: 12,
    borderBottomWidth: 2,
    borderColor: theme.line,
    justifyContent: "center",
  },
  tabActive: { borderColor: theme.cyan },
  tabText: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  tabTextActive: { color: theme.text, fontWeight: "700" },
  document: {
    gap: 14,
    padding: 20,
    borderRadius: 14,
    backgroundColor: theme.bgRaised,
    borderWidth: 1,
    borderColor: theme.line,
  },
  agenda: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 28,
    paddingVertical: 12,
  },
  mailRow: {
    gap: 6,
    minHeight: 88,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: theme.line,
  },
  mailSubject: {
    color: theme.text,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: "700",
  },
  mailBody: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 29,
    paddingVertical: 16,
  },
  link: { color: theme.cyan, fontSize: 15, lineHeight: 24 },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    padding: 14,
    color: theme.text,
    fontSize: 16,
    lineHeight: 24,
  },
  draft: { minHeight: 148 },
  address: { color: theme.cyan, fontSize: 18, lineHeight: 28, flexShrink: 1 },
  success: { color: theme.ok, fontSize: 19, lineHeight: 28, fontWeight: "600" },
  warning: {
    color: theme.warn,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
  },
  error: { color: theme.danger, fontSize: 16, lineHeight: 25 },
  loading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
});

export { Button as AgentWorkspaceButton };
