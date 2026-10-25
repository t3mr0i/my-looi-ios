import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { DeviceShell } from "@/src/ui/DeviceShell";
import { looiTheme } from "@/src/ui/looi-theme";
import { useUiText } from "@/src/i18n/use-ui-text";
import { createResearchTranslator, type ResearchStringKey } from "@/src/i18n/research-strings";
import {
  getWebResearchErrorCode,
  getWebResearchHttpStatus,
  MAX_WEB_RESEARCH_QUERY_LENGTH,
  searchWebResearch,
  splitWebResearchAnswer,
  validateWebResearchQuery,
  WebResearchRequestGate,
  type WebResearchErrorCode,
  type WebResearchResult,
  type WebResearchSource,
} from "@/src/openai/web-research";

type ResearchScreenStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "cancelled" }
  | { kind: "error"; code: WebResearchErrorCode; httpStatus: number | null }
  | { kind: "result"; result: WebResearchResult };

export default function ResearchScreen() {
  const router = useRouter();
  const { language } = useUiText();
  const t = useMemo(() => createResearchTranslator(language), [language]);
  const gateRef = useRef<WebResearchRequestGate | null>(null);
  if (!gateRef.current) gateRef.current = new WebResearchRequestGate();

  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<"empty" | "too_long" | null>(null);
  const [status, setStatus] = useState<ResearchScreenStatus>({ kind: "idle" });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || !gateRef.current?.isPending) return;
      gateRef.current.cancel();
      setStatus({ kind: "cancelled" });
    });
    return () => {
      subscription.remove();
      gateRef.current?.cancel();
    };
  }, []);

  const runSearch = useCallback(async () => {
    const validation = validateWebResearchQuery(query);
    if (validation.error) {
      setValidationError(validation.error);
      return;
    }
    if (gateRef.current?.isPending) return;

    setValidationError(null);
    const request = gateRef.current!.begin();
    setStatus({ kind: "loading" });
    try {
      const result = await searchWebResearch(validation.query, { signal: request.signal });
      if (!request.isCurrent()) return;
      setStatus({ kind: "result", result });
    } catch (error) {
      if (!request.isCurrent()) return;
      const code = getWebResearchErrorCode(error);
      if (code === "cancelled") {
        setStatus({ kind: "cancelled" });
      } else {
        setStatus({ kind: "error", code, httpStatus: getWebResearchHttpStatus(error) });
      }
    } finally {
      if (request.isCurrent()) gateRef.current?.finish(request.id);
    }
  }, [query]);

  const cancelSearch = useCallback(() => {
    if (!gateRef.current?.isPending) return;
    gateRef.current.cancel();
    setStatus({ kind: "cancelled" });
  }, []);

  const openSource = useCallback(async (source: WebResearchSource) => {
    try {
      await Linking.openURL(source.url);
    } catch {
      Alert.alert(t("linkError"));
    }
  }, [t]);

  const errorMessage = status.kind === "error"
    ? getResearchErrorMessage(status.code, status.httpStatus, t)
    : null;
  const result = status.kind === "result" ? status.result : null;
  const inlineSegments = useMemo(
    () => result ? splitWebResearchAnswer(result.answer, result.citations) : [],
    [result]
  );
  const queryCanRun = validateWebResearchQuery(query).error === null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DeviceShell
        title={t("title")}
        eyebrow={t("eyebrow")}
        onReturnHome={() => router.replace("/")}
      >
        <Text style={styles.intro}>{t("intro")}</Text>

      <View style={styles.form}>
        <Text style={styles.fieldLabel}>{t("questionLabel")}</Text>
        <TextInput
          accessibilityLabel={t("questionLabel")}
          accessibilityHint={t("idleNote")}
          autoCapitalize="sentences"
          autoCorrect
          editable={status.kind !== "loading"}
          maxLength={MAX_WEB_RESEARCH_QUERY_LENGTH}
          multiline
          onChangeText={(value) => {
            setQuery(value);
            setValidationError(null);
          }}
          onSubmitEditing={() => { void runSearch(); }}
          placeholder={t("questionPlaceholder")}
          placeholderTextColor={looiTheme.muted}
          returnKeyType="search"
          style={styles.input}
          textAlignVertical="top"
          value={query}
        />
        {validationError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {t(validationError === "empty" ? "queryEmpty" : "queryTooLong")}
          </Text>
        ) : null}

        <Text style={styles.costNotice}>{t("costNotice")}</Text>
        <Text style={styles.dataNotice}>{t("dataNotice")}</Text>

        {status.kind === "loading" ? (
          <View style={styles.loadingRow}>
            <View style={styles.loadingLabel}>
              <ActivityIndicator color={looiTheme.cyan} />
              <Text accessibilityLiveRegion="polite" style={styles.loadingText}>{t("searching")}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={cancelSearch}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>{t("cancel")}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !queryCanRun }}
            disabled={!queryCanRun}
            onPress={() => { void runSearch(); }}
            style={[styles.searchButton, !queryCanRun && styles.searchButtonDisabled]}
          >
            <Text style={[styles.searchButtonText, !queryCanRun && styles.searchButtonTextDisabled]}>
              {t("search")}
            </Text>
          </Pressable>
        )}

        {status.kind === "idle" ? <Text style={styles.idleNote}>{t("idleNote")}</Text> : null}
        {status.kind === "cancelled" ? (
          <Text accessibilityLiveRegion="polite" style={styles.cancelledText}>{t("cancelled")}</Text>
        ) : null}
        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text>
        ) : null}
      </View>

      {result ? (
        <View style={styles.resultSection}>
          <Text style={styles.sectionTitle}>{t("answer")}</Text>
          <Text style={styles.answerText}>
            {inlineSegments.map((segment, index) => segment.type === "text" ? (
              <Text key={`text-${index}`}>{segment.text}</Text>
            ) : (
              <Text
                key={`citation-${index}`}
                accessibilityRole="link"
                accessibilityLabel={t("openSource", { title: result.sources[segment.sourceIndex]?.title ?? "" })}
                onPress={() => {
                  const source = result.sources[segment.sourceIndex];
                  if (source) void openSource(source);
                }}
                style={styles.inlineCitation}
              >
                {segment.text}
              </Text>
            ))}
          </Text>

          <Text style={styles.sourcesHeading}>{t("sources")}</Text>
          <View style={styles.sourceList}>
            {result.sources.map((source, index) => (
              <Pressable
                key={`${source.url}-${index}`}
                accessibilityRole="link"
                accessibilityLabel={t("openSource", { title: source.title })}
                onPress={() => { void openSource(source); }}
                style={styles.sourceRow}
              >
                <Text style={styles.sourceIndex}>[{index + 1}]</Text>
                <View style={styles.sourceCopy}>
                  <Text style={styles.sourceTitle}>{source.title}</Text>
                  <Text numberOfLines={1} style={styles.sourceHost}>{getHost(source.url)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      </DeviceShell>
    </>
  );
}

function getResearchErrorMessage(
  code: WebResearchErrorCode,
  httpStatus: number | null,
  t: (key: ResearchStringKey) => string
): string {
  if (code === "missing_key") return t("errorMissingKey");
  if (code === "timeout") return t("errorTimeout");
  if (code === "no_citations") return t("errorNoCitations");
  if (code === "response") return t("errorResponse");
  if (code === "api" && (httpStatus === 401 || httpStatus === 403)) return t("errorAuth");
  if (code === "api" && httpStatus === 429) return t("errorRateLimit");
  if (code === "api") return t("errorApi");
  return t("errorNetwork");
}

function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  intro: {
    color: looiTheme.text,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 22,
    maxWidth: 660,
  },
  form: {
    gap: 10,
  },
  fieldLabel: {
    color: looiTheme.text,
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    minHeight: 76,
    maxHeight: 148,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: looiTheme.text,
    backgroundColor: looiTheme.surface,
    fontSize: 16,
    lineHeight: 22,
  },
  costNotice: {
    color: looiTheme.warn,
    fontSize: 13,
    lineHeight: 19,
  },
  dataNotice: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  idleNote: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  searchButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: looiTheme.cyan,
    marginTop: 2,
  },
  searchButtonDisabled: {
    backgroundColor: looiTheme.surfaceStrong,
    borderWidth: 1,
    borderColor: looiTheme.line,
  },
  searchButtonText: {
    color: looiTheme.bg,
    fontSize: 15,
    fontWeight: "700",
  },
  searchButtonTextDisabled: {
    color: looiTheme.muted,
  },
  loadingRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  loadingLabel: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: looiTheme.text,
    fontSize: 14,
  },
  cancelButton: {
    minHeight: 44,
    minWidth: 100,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: 8,
  },
  cancelText: {
    color: looiTheme.cyan,
    fontSize: 14,
    fontWeight: "600",
  },
  cancelledText: {
    color: looiTheme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: looiTheme.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  resultSection: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: looiTheme.line,
  },
  sectionTitle: {
    color: looiTheme.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    marginBottom: 10,
  },
  answerText: {
    color: looiTheme.text,
    fontSize: 15,
    lineHeight: 23,
  },
  inlineCitation: {
    color: looiTheme.cyan,
    fontSize: 13,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  sourcesHeading: {
    color: looiTheme.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 6,
  },
  sourceList: {
    borderTopWidth: 1,
    borderTopColor: looiTheme.line,
  },
  sourceRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: looiTheme.line,
    paddingVertical: 7,
  },
  sourceIndex: {
    color: looiTheme.cyan,
    fontSize: 13,
    fontWeight: "700",
    minWidth: 26,
  },
  sourceCopy: {
    flex: 1,
    gap: 2,
  },
  sourceTitle: {
    color: looiTheme.text,
    fontSize: 14,
    lineHeight: 19,
  },
  sourceHost: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 16,
  },
});
