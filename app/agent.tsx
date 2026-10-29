import { InterfacePressable as Pressable } from "@/src/ui/InterfacePressable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { AgentConnectionScope, AgentWorkspaceIntro, AgentWorkspaceShell } from "@/src/ui/AgentWorkspace";
import { agentWorkspaceText } from "@/src/i18n/agent-workspace-strings";
import { looiTheme } from "@/src/ui/looi-theme";
import { useUiText } from "@/src/i18n/use-ui-text";
import { createAgentTranslator } from "@/src/i18n/agent-strings";
import {
  cancelAgentTask,
  configureAgentConnection,
  deleteAgentTask,
  disconnectAgent,
  getAgentErrorCode,
  getAgentSettings,
  getAgentTask,
  getPendingAgentTask,
  listAgentTaskPage,
  retryPendingAgentTask,
  submitAgentTask,
  verifyAgentConnection,
} from "@/src/agent/agent-service";
import {
  isTerminalAgentTask,
  MAX_AGENT_QUERY_LENGTH,
  type AgentTask,
  type PendingAgentTask,
} from "@/src/agent/agent-protocol";

type AgentErrorCode = ReturnType<typeof getAgentErrorCode>;

const ACTIVE_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "running",
  "cancelling",
]);

export default function AgentScreen() {
  const router = useRouter();
  const { language, locale } = useUiText();
  const t = useMemo(() => createAgentTranslator(language), [language]);
  const tRef = useRef(t);
  tRef.current = t;

  const [serverUrl, setServerUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [nextTaskCursor, setNextTaskCursor] = useState<string | null>(null);
  const [historyServerUrl, setHistoryServerUrl] = useState("");
  const [taskRequestBusy, setTaskRequestBusy] = useState(false);
  const [loadingOlderTasks, setLoadingOlderTasks] = useState(false);
  const [olderTasksError, setOlderTasksError] = useState("");
  const [pendingByServer, setPendingByServer] = useState<Record<string, PendingAgentTask>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskDetailsByKey, setTaskDetailsByKey] = useState<Record<string, AgentTask>>({});
  const [detailLoad, setDetailLoad] = useState<{ key: string; state: "loading" | "error" } | null>(null);
  const [detailRetryNonce, setDetailRetryNonce] = useState(0);
  const [routeFocused, setRouteFocused] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [disconnectedNotice, setDisconnectedNotice] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [pendingError, setPendingError] = useState("");
  const [taskListError, setTaskListError] = useState("");
  const [taskActionError, setTaskActionError] = useState("");
  const [editingSetup, setEditingSetup] = useState(false);

  const focusedRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === "active");
  const focusCycleRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const taskRequestRef = useRef(0);
  const taskControllerRef = useRef<AbortController | null>(null);
  const historyServerRef = useRef("");
  const nextTaskCursorRef = useRef<string | null>(null);
  const detailRequestRef = useRef(0);
  const detailControllerRef = useRef<AbortController | null>(null);
  const activeSavedUrlRef = useRef(savedUrl);
  const activeExpandedTaskIdRef = useRef(expandedTaskId);
  const currentDetailKeyRef = useRef<string | null>(null);
  const mutationLockRef = useRef(false);
  const snapshotBlockedByMutationRef = useRef(false);
  const settingsHydratedRef = useRef(false);
  const configuredRef = useRef(false);
  const tasksNeedPollingRef = useRef(false);
  const snapshotRef = useRef<(cycle: number, showRefresh: boolean, allowDuringMutation?: boolean, resetHistory?: boolean) => Promise<void>>(
    async () => undefined
  );
  const taskFetchRef = useRef<(cycle: number, showRefresh: boolean, allowDuringMutation?: boolean, resetHistory?: boolean) => Promise<void>>(
    async () => undefined
  );

  configuredRef.current = configured;
  activeSavedUrlRef.current = savedUrl;
  activeExpandedTaskIdRef.current = expandedTaskId;
  historyServerRef.current = historyServerUrl;
  nextTaskCursorRef.current = nextTaskCursor;
  tasksNeedPollingRef.current = tasks.some((task) => ACTIVE_STATUSES.has(task.status));

  const expandedSummary = tasks.find((task) => task.id === expandedTaskId) ?? null;
  const expandedDetailKey = expandedSummary && savedUrl
    ? taskDetailsKey(savedUrl, expandedSummary.id, expandedSummary.updatedAt)
    : null;
  currentDetailKeyRef.current = expandedDetailKey;

  const invalidateTaskRequest = useCallback(() => {
    taskRequestRef.current += 1;
    taskControllerRef.current?.abort();
    taskControllerRef.current = null;
    setTaskRequestBusy(false);
    setLoadingOlderTasks(false);
  }, []);

  const invalidateDetailRequest = useCallback(() => {
    detailRequestRef.current += 1;
    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
  }, []);

  const fetchTasks = useCallback(async (
    cycle: number,
    showRefresh: boolean,
    allowDuringMutation = false,
    resetHistory = false
  ) => {
    if (
      !focusedRef.current ||
      !appActiveRef.current ||
      focusCycleRef.current !== cycle ||
      !configuredRef.current ||
      (mutationLockRef.current && !allowDuringMutation)
    ) {
      return;
    }

    invalidateTaskRequest();
    const requestId = taskRequestRef.current;
    const controller = new AbortController();
    const requestedServerUrl = activeSavedUrlRef.current;
    taskControllerRef.current = controller;
    setTaskRequestBusy(true);
    if (showRefresh) setRefreshing(true);
    setTaskListError("");

    try {
      const page = await listAgentTaskPage({ signal: controller.signal });
      if (
        !focusedRef.current ||
        !appActiveRef.current ||
        focusCycleRef.current !== cycle ||
        taskRequestRef.current !== requestId ||
        !configuredRef.current ||
        activeSavedUrlRef.current !== requestedServerUrl
      ) {
        return;
      }
      const replaceHistory = resetHistory || historyServerRef.current !== requestedServerUrl;
      if (replaceHistory) {
        invalidateDetailRequest();
        historyServerRef.current = requestedServerUrl;
        setHistoryServerUrl(requestedServerUrl);
        setTasks(page.tasks);
        setExpandedTaskId(null);
        setTaskDetailsByKey({});
      } else {
        setTasks((current) => mergeTaskPage(current, page.tasks));
      }
      nextTaskCursorRef.current = page.nextCursor;
      setNextTaskCursor(page.nextCursor);
      setOlderTasksError("");
      setTaskListError("");
    } catch (error) {
      if (
        !focusedRef.current ||
        !appActiveRef.current ||
        focusCycleRef.current !== cycle ||
        taskRequestRef.current !== requestId ||
        !configuredRef.current ||
        activeSavedUrlRef.current !== requestedServerUrl ||
        getAgentErrorCode(error) === "cancelled"
      ) {
        return;
      }
      setTaskListError(tRef.current("tasksLoadError"));
    } finally {
      if (taskRequestRef.current === requestId) {
        taskControllerRef.current = null;
        setTaskRequestBusy(false);
        if (showRefresh) setRefreshing(false);
      }
    }
  }, [invalidateTaskRequest]);
  taskFetchRef.current = fetchTasks;

  const loadSnapshot = useCallback(async (
    cycle: number,
    showRefresh: boolean,
    allowDuringMutation = false,
    resetHistory = false
  ) => {
    if (
      !focusedRef.current ||
      !appActiveRef.current ||
      focusCycleRef.current !== cycle
    ) {
      return;
    }

    const requestId = ++snapshotRequestRef.current;
    const isCurrent = () =>
      focusedRef.current &&
      appActiveRef.current &&
      focusCycleRef.current === cycle &&
      snapshotRequestRef.current === requestId;

    if (showRefresh) setRefreshing(true);
    setScreenError("");
    let settings: Awaited<ReturnType<typeof getAgentSettings>>;
    try {
      settings = await getAgentSettings();
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      setScreenError(messageForError(getAgentErrorCode(error), tRef.current, "setup"));
      setBootstrapLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isCurrent()) return;

    if (activeSavedUrlRef.current !== settings.url) {
      invalidateTaskRequest();
      invalidateDetailRequest();
      activeSavedUrlRef.current = settings.url;
      setTaskDetailsByKey({});
      setExpandedTaskId(null);
      setTasks([]);
      historyServerRef.current = "";
      nextTaskCursorRef.current = null;
      setHistoryServerUrl("");
      setNextTaskCursor(null);
      setOlderTasksError("");
    }
    setSavedUrl(settings.url);
    setConfigured(settings.configured);
    configuredRef.current = settings.configured;
    if (!settingsHydratedRef.current) setServerUrl(settings.url);
    settingsHydratedRef.current = true;
    setConnectionMessage(
      settings.configured
        ? tRef.current("connectionSaved")
        : tRef.current("connectionNotConfigured")
    );
    if (settings.configured) setDisconnectedNotice(false);

    if (settings.configured) {
      try {
        const pending = await getPendingAgentTask();
        if (!isCurrent()) return;
        setPendingByServer((current) => {
          const next = { ...current };
          if (pending) next[settings.url] = pending;
          else delete next[settings.url];
          return next;
        });
        setPendingError("");
      } catch (error) {
        if (isCurrent()) {
          setScreenError(messageForError(getAgentErrorCode(error), tRef.current, "setup"));
        } else {
          return;
        }
      }
      if (!isCurrent()) return;
      if (mutationLockRef.current && !allowDuringMutation) {
        snapshotBlockedByMutationRef.current = true;
      }
      await taskFetchRef.current(cycle, showRefresh, allowDuringMutation, resetHistory);
    } else {
      invalidateTaskRequest();
      invalidateDetailRequest();
      setTasks([]);
      setExpandedTaskId(null);
      setTaskDetailsByKey({});
      historyServerRef.current = "";
      nextTaskCursorRef.current = null;
      setHistoryServerUrl("");
      setNextTaskCursor(null);
      setTaskListError("");
      setOlderTasksError("");
      setRefreshing(false);
    }
    if (isCurrent()) setBootstrapLoading(false);
  }, [invalidateDetailRequest, invalidateTaskRequest]);
  snapshotRef.current = loadSnapshot;

  const pollTasks = useCallback(async (cycle: number) => {
    if (!tasksNeedPollingRef.current || mutationLockRef.current || taskControllerRef.current) return;
    await taskFetchRef.current(cycle, false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const cycle = ++focusCycleRef.current;
      focusedRef.current = true;
      appActiveRef.current = AppState.currentState === "active";
      setRouteFocused(true);
      setAppIsActive(appActiveRef.current);
      setBootstrapLoading(true);
      void snapshotRef.current(cycle, false);

      const appStateSubscription = AppState.addEventListener("change", (nextState) => {
        const wasActive = appActiveRef.current;
        const isActive = nextState === "active";
        appActiveRef.current = isActive;
        setAppIsActive(isActive);
        if (wasActive && !isActive) {
          snapshotRequestRef.current += 1;
          invalidateTaskRequest();
          invalidateDetailRequest();
          setRefreshing(false);
          return;
        }
        if (!wasActive && isActive && focusedRef.current) {
          void snapshotRef.current(cycle, true);
        }
      });

      const interval = setInterval(() => {
        if (
          focusedRef.current &&
          appActiveRef.current &&
          focusCycleRef.current === cycle
        ) {
          void pollTasks(cycle);
        }
      }, 4000);

      return () => {
        focusedRef.current = false;
        setRouteFocused(false);
        focusCycleRef.current += 1;
        snapshotRequestRef.current += 1;
        invalidateTaskRequest();
        invalidateDetailRequest();
        appStateSubscription.remove();
        clearInterval(interval);
      };
    }, [invalidateDetailRequest, invalidateTaskRequest, pollTasks])
  );

  useEffect(() => {
    if (
      !expandedSummary ||
      !expandedDetailKey ||
      !routeFocused ||
      !appIsActive ||
      !configured ||
      refreshing ||
      mutation ||
      !savedUrl
    ) {
      return;
    }

    if (taskDetailsByKey[expandedDetailKey]) {
      setDetailLoad((current) => current?.key === expandedDetailKey ? null : current);
      return;
    }

    const cycle = focusCycleRef.current;
    const requestId = ++detailRequestRef.current;
    const requestedServerUrl = savedUrl;
    const requestedTaskId = expandedSummary.id;
    const requestedKey = expandedDetailKey;
    const controller = new AbortController();
    let effectActive = true;
    detailControllerRef.current = controller;
    setDetailLoad({ key: requestedKey, state: "loading" });

    const isCurrent = () =>
      effectActive &&
      detailRequestRef.current === requestId &&
      detailControllerRef.current === controller &&
      focusedRef.current &&
      appActiveRef.current &&
      focusCycleRef.current === cycle &&
      configuredRef.current &&
      activeSavedUrlRef.current === requestedServerUrl &&
      activeExpandedTaskIdRef.current === requestedTaskId &&
      currentDetailKeyRef.current === requestedKey;

    void getAgentTask(requestedTaskId, { signal: controller.signal })
      .then((details) => {
        if (!isCurrent()) return;
        setTaskDetailsByKey((current) => {
          const next = { ...current };
          delete next[requestedKey];
          next[requestedKey] = details;
          const keys = Object.keys(next);
          while (keys.length > 5) delete next[keys.shift()!];
          return next;
        });
        setDetailLoad((current) => current?.key === requestedKey ? null : current);
      })
      .catch((error) => {
        if (!isCurrent() || getAgentErrorCode(error) === "cancelled") return;
        setDetailLoad({ key: requestedKey, state: "error" });
      })
      .finally(() => {
        if (detailRequestRef.current === requestId && detailControllerRef.current === controller) {
          detailControllerRef.current = null;
        }
      });

    return () => {
      effectActive = false;
      if (detailRequestRef.current === requestId && detailControllerRef.current === controller) {
        detailRequestRef.current += 1;
        controller.abort();
        detailControllerRef.current = null;
      }
    };
  }, [
    appIsActive,
    configured,
    detailRetryNonce,
    expandedDetailKey,
    expandedSummary?.id,
    expandedSummary?.status,
    expandedSummary?.updatedAt,
    mutation,
    refreshing,
    routeFocused,
    savedUrl,
    taskDetailsByKey,
  ]);

  const currentPending = savedUrl ? pendingByServer[savedUrl] ?? null : null;
  const pendingEntries = Object.entries(pendingByServer);

  const refresh = useCallback(() => {
    if (!focusedRef.current || !appActiveRef.current) return;
    void snapshotRef.current(focusCycleRef.current, true, false, true);
  }, []);

  const loadOlderTasks = useCallback(async () => {
    const cursor = nextTaskCursor;
    if (
      !cursor ||
      !routeFocused ||
      !appIsActive ||
      !configured ||
      refreshing ||
      mutation ||
      mutationLockRef.current ||
      taskControllerRef.current ||
      historyServerRef.current !== savedUrl
    ) {
      return;
    }

    const cycle = focusCycleRef.current;
    const requestedServerUrl = savedUrl;
    invalidateTaskRequest();
    const requestId = taskRequestRef.current;
    const controller = new AbortController();
    taskControllerRef.current = controller;
    setTaskRequestBusy(true);
    setLoadingOlderTasks(true);
    setOlderTasksError("");

    const isCurrent = () =>
      focusedRef.current &&
      appActiveRef.current &&
      focusCycleRef.current === cycle &&
      taskRequestRef.current === requestId &&
      configuredRef.current &&
      activeSavedUrlRef.current === requestedServerUrl &&
      historyServerRef.current === requestedServerUrl &&
      nextTaskCursorRef.current === cursor;

    try {
      const page = await listAgentTaskPage({ cursor, signal: controller.signal });
      if (!isCurrent()) return;
      setTasks((current) => mergeOlderTaskPage(current, page.tasks));
      nextTaskCursorRef.current = page.nextCursor;
      setNextTaskCursor(page.nextCursor);
    } catch (error) {
      if (!isCurrent() || getAgentErrorCode(error) === "cancelled") return;
      setOlderTasksError(tRef.current("olderTasksLoadError"));
    } finally {
      if (taskRequestRef.current === requestId) {
        taskControllerRef.current = null;
        setTaskRequestBusy(false);
        setLoadingOlderTasks(false);
      }
    }
  }, [appIsActive, configured, invalidateTaskRequest, mutation, nextTaskCursor, refreshing, routeFocused, savedUrl]);

  const runMutation = useCallback(async (
    key: string,
    action: () => Promise<void>,
    onError: (error: unknown) => void | Promise<void>,
    reload = true
  ) => {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true;
    snapshotBlockedByMutationRef.current = false;
    snapshotRequestRef.current += 1;
    invalidateTaskRequest();
    setMutation(key);
    setTaskActionError("");
    const cycle = focusCycleRef.current;
    let actionSucceeded = false;
    try {
      await action();
      actionSucceeded = true;
    } catch (error) {
      if (focusedRef.current && focusCycleRef.current === cycle) {
        try {
          await onError(error);
        } catch {
          // Preserve the original action failure if its UI-level recovery also fails.
        }
      }
    } finally {
      try {
        const shouldRefresh =
          actionSucceeded ||
          snapshotBlockedByMutationRef.current ||
          focusCycleRef.current !== cycle;
        if (reload && shouldRefresh && focusedRef.current && appActiveRef.current) {
          await snapshotRef.current(focusCycleRef.current, false, true);
        }
      } finally {
        snapshotBlockedByMutationRef.current = false;
        mutationLockRef.current = false;
        setMutation(null);
      }
    }
  }, [invalidateTaskRequest]);

  const saveServer = useCallback(async () => {
    const normalizedUrl = serverUrl.trim().replace(/\/$/, "");
    if (!normalizedUrl) {
      setScreenError(t("serverUrlRequired"));
      return;
    }
    if (!isValidServerUrl(normalizedUrl)) {
      setScreenError(t("serverUrlHttps"));
      return;
    }

    if (configured && normalizedUrl === savedUrl && token.trim().length === 0) {
      await runMutation(
        "verify",
        async () => {
          setConnectionMessage(t("connectionChecking"));
          await verifyAgentConnection();
          setConnectionMessage(t("connectionTestSuccess"));
        },
        (error) => {
          setConnectionMessage(t("connectionError"));
          setScreenError(messageForError(getAgentErrorCode(error), t, "verify"));
        },
        false
      );
      return;
    }

    if (!token.trim()) {
      setScreenError(t("tokenNeeded"));
      return;
    }

    await runMutation(
      "configure",
      async () => {
        setConnectionMessage(t("connectionChecking"));
        await configureAgentConnection(normalizedUrl, token.trim());
        if (activeSavedUrlRef.current !== normalizedUrl) {
          invalidateDetailRequest();
          activeSavedUrlRef.current = normalizedUrl;
          historyServerRef.current = "";
          nextTaskCursorRef.current = null;
          setHistoryServerUrl("");
          setNextTaskCursor(null);
          setOlderTasksError("");
          setTaskDetailsByKey({});
          setExpandedTaskId(null);
          setTasks([]);
        }
        setSavedUrl(normalizedUrl);
        setServerUrl(normalizedUrl);
        setConfigured(true);
        configuredRef.current = true;
        setEditingSetup(false);
        setDisconnectedNotice(false);
        setToken("");
        settingsHydratedRef.current = true;
        setConnectionMessage(t("connectionTestSuccess"));
        setScreenError("");
      },
      (error) => {
        setConnectionMessage(t("connectionError"));
        setScreenError(messageForError(getAgentErrorCode(error), t, "setup"));
      },
      true
    );
  }, [configured, invalidateDetailRequest, runMutation, savedUrl, serverUrl, t, token]);

  const testSavedConnection = useCallback(() => {
    void runMutation(
      "verify",
      async () => {
        setConnectionMessage(t("connectionChecking"));
        await verifyAgentConnection();
        setConnectionMessage(t("connectionTestSuccess"));
        setScreenError("");
      },
      (error) => {
        setConnectionMessage(t("connectionError"));
        setScreenError(messageForError(getAgentErrorCode(error), t, "verify"));
      },
      false
    );
  }, [runMutation, t]);

  const disconnect = useCallback(() => {
    Alert.alert(t("disconnectTitle"), t("disconnectBody"), [
      { text: t("commonCancel"), style: "cancel" },
      {
        text: t("disconnectConfirm"),
        style: "destructive",
        onPress: () => {
          void runMutation(
            "disconnect",
            async () => {
              await disconnectAgent();
              invalidateDetailRequest();
              activeSavedUrlRef.current = "";
              historyServerRef.current = "";
              nextTaskCursorRef.current = null;
              setConfigured(false);
              configuredRef.current = false;
              setSavedUrl("");
              setServerUrl("");
              setToken("");
              settingsHydratedRef.current = true;
              setConnectionMessage(t("connectionNotConfigured"));
              setScreenError("");
              setDisconnectedNotice(true);
              setTasks([]);
              setHistoryServerUrl("");
              setNextTaskCursor(null);
              setOlderTasksError("");
              setExpandedTaskId(null);
              setTaskDetailsByKey({});
            },
            (error) => setScreenError(messageForError(getAgentErrorCode(error), t, "setup")),
            false
          );
        },
      },
    ]);
  }, [invalidateDetailRequest, runMutation, t]);

  const startTask = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setQueryError(t("taskEmptyError"));
      return;
    }
    if (normalizedQuery.length < 2) {
      setQueryError(t("taskTooShort"));
      return;
    }
    if (Array.from(normalizedQuery).length > MAX_AGENT_QUERY_LENGTH) {
      setQueryError(t("taskTooLong", { max: MAX_AGENT_QUERY_LENGTH }));
      return;
    }
    if (currentPending) {
      setPendingError(t("pendingSubmissionError"));
      return;
    }
    setQueryError("");
    setSubmitError("");
    await runMutation(
      "submit",
      async () => {
        setPendingError("");
        const submitted = await submitAgentTask(normalizedQuery, language);
        setTasks((current) => upsertTask(current, submitted));
        setExpandedTaskId(submitted.id);
        setQuery("");
      },
      async (error) => {
        const code = getAgentErrorCode(error);
        if (code === "pending_submission") {
          const pending = await getPendingAgentTask().catch(() => null);
          if (pending) setPendingByServer((current) => ({ ...current, [savedUrl]: pending }));
          setPendingError(t("pendingSubmissionError"));
        } else {
          setSubmitError(messageForError(code, t, "task"));
        }
      }
    );
  }, [currentPending, language, query, runMutation, savedUrl, t]);

  const retryPending = useCallback(async () => {
    await runMutation(
      "pending",
      async () => {
        setPendingError("");
        const task = await retryPendingAgentTask();
        setTasks((current) => upsertTask(current, task));
        setPendingByServer((current) => {
          const next = { ...current };
          delete next[savedUrl];
          return next;
        });
      },
      async (error) => {
        const code = getAgentErrorCode(error);
        if (code === "not_configured") {
          setPendingError(t("pendingRequiresConnection"));
          return;
        }
        if (code === "not_found") {
          const pending = await getPendingAgentTask().catch(() => null);
          setPendingByServer((current) => {
            const next = { ...current };
            if (pending) next[savedUrl] = pending;
            else delete next[savedUrl];
            return next;
          });
          setPendingError(pending ? t("pendingSubmissionError") : "");
          return;
        }
        if (code === "pending_submission" || code === "timeout" || code === "network") {
          const pending = await getPendingAgentTask().catch(() => null);
          if (pending) setPendingByServer((current) => ({ ...current, [savedUrl]: pending }));
          setPendingError(t("pendingSubmissionError"));
          return;
        }
        setPendingError(messageForError(code, t, "task"));
      }
    );
  }, [runMutation, savedUrl, t]);

  const requestCancel = useCallback(async (task: AgentTask) => {
    if (task.status === "cancelling" || isTerminalAgentTask(task.status)) return;
    await runMutation(
      `cancel:${task.id}`,
      async () => {
        const updated = await cancelAgentTask(task.id);
        setTasks((current) => upsertTask(current, updated));
      },
      (error) => setTaskActionError(
        getAgentErrorCode(error) === "cancelled"
          ? t("cancelError")
          : messageForError(getAgentErrorCode(error), t, "cancel")
      )
    );
  }, [runMutation, t]);

  const confirmDelete = useCallback((task: AgentTask) => {
    if (!isTerminalAgentTask(task.status)) return;
    Alert.alert(t("deleteTaskTitle"), t("deleteTaskBody"), [
      { text: t("commonCancel"), style: "cancel" },
      {
        text: t("deleteTaskConfirm"),
        style: "destructive",
        onPress: () => {
          void runMutation(
            `delete:${task.id}`,
            async () => {
              await deleteAgentTask(task.id);
              setTasks((current) => current.filter((item) => item.id !== task.id));
              setExpandedTaskId((current) => current === task.id ? null : current);
            },
            (error) => setTaskActionError(messageForError(getAgentErrorCode(error), t, "delete"))
          );
        },
      },
    ]);
  }, [runMutation, t]);

  const openSource = useCallback(async (url: string) => {
    if (!isHttpUrl(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("linkError"));
    }
  }, [t]);

  const queryValid = query.trim().length >= 2 && Array.from(query.trim()).length <= MAX_AGENT_QUERY_LENGTH;
  const canStart = configured && queryValid && !currentPending && !mutation && !bootstrapLoading;
  const isConfiguredForDraft = configured && serverUrl.trim().replace(/\/$/, "") === savedUrl;
  const canTestSaved = isConfiguredForDraft && token.trim().length === 0 && !mutation && !bootstrapLoading;
  const canSaveServer = isValidServerUrl(serverUrl) && token.trim().length > 0 && !mutation && !bootstrapLoading;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AgentWorkspaceShell
        title={t("title")}
        language={language}
        onBack={() => router.replace("/conversation")}
        onHome={() => router.replace("/")}
      >
        <AgentWorkspaceIntro language={language} onTry={() => router.push("/agent-playground")} onConnect={() => router.push("/agent-connect")} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("setupTitle")}</Text>
          {!configured && !editingSetup ? (
            <View style={styles.connectedRow}>
              <Text style={styles.sectionHelp}>{t("connectionNotConfigured")}</Text>
              <Pressable accessibilityRole="button" onPress={() => setEditingSetup(true)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{agentWorkspaceText(language)("manual")}</Text>
              </Pressable>
            </View>
          ) : configured && !editingSetup ? (
            <View style={styles.connectedRow}>
              <Text style={styles.connectedText}>
                {mutation === "verify" || mutation === "configure"
                  ? t("connectionChecking")
                  : t("connectedTo", { host: getHost(savedUrl) })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("changeServer")}
                disabled={Boolean(mutation) || bootstrapLoading}
                onPress={() => setEditingSetup(true)}
                style={[styles.secondaryButton, styles.changeButton]}
              >
                <Text style={styles.secondaryButtonText}>{t("changeServer")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
          <Text style={styles.sectionHelp}>{t("setupHelp")}</Text>

          <Text style={styles.fieldLabel}>{t("serverUrl")}</Text>
          <TextInput
            accessibilityLabel={t("serverUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!mutation && !bootstrapLoading}
            keyboardType="url"
            onChangeText={(value) => {
              setServerUrl(value);
              setScreenError("");
            }}
            placeholder={t("serverUrlPlaceholder")}
            placeholderTextColor={looiTheme.muted}
            returnKeyType="next"
            style={styles.singleLineInput}
            textContentType="URL"
            value={serverUrl}
          />

          <Text style={styles.fieldLabel}>{t("accessToken")}</Text>
          <TextInput
            accessibilityLabel={t("accessToken")}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!mutation && !bootstrapLoading}
            onChangeText={(value) => {
              setToken(value);
              setScreenError("");
            }}
            placeholder={t("accessTokenPlaceholder")}
            placeholderTextColor={looiTheme.muted}
            returnKeyType="done"
            secureTextEntry
            style={styles.singleLineInput}
            value={token}
          />
          {configured && !token ? <Text style={styles.mutedNote}>{t("tokenSaved")}</Text> : null}
          {!configured ? <Text style={styles.mutedNote}>{t("tokenNeeded")}</Text> : null}
          <Text style={styles.mutedNote}>{t("tokenTransportNotice")}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSaveServer }}
            disabled={!canSaveServer}
            onPress={() => { void saveServer(); }}
            style={[styles.primaryButton, !canSaveServer && styles.buttonDisabled]}
          >
            {mutation === "configure"
              ? <ActivityIndicator color={looiTheme.bg} />
              : <Text style={[styles.primaryButtonText, !canSaveServer && styles.disabledText]}>{t("saveAndVerify")}</Text>}
          </Pressable>

          {configured ? (
            <View style={styles.secondaryActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canTestSaved }}
                disabled={!canTestSaved}
                onPress={testSavedConnection}
                style={[styles.secondaryButton, !canTestSaved && styles.buttonDisabled]}
              >
                {mutation === "verify"
                  ? <ActivityIndicator color={looiTheme.cyan} />
                  : <Text style={[styles.secondaryButtonText, !canTestSaved && styles.disabledText]}>{t("testSavedConnection")}</Text>}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(mutation) || bootstrapLoading }}
                disabled={Boolean(mutation) || bootstrapLoading}
                onPress={disconnect}
                style={[styles.secondaryButton, styles.disconnectButton, (mutation || bootstrapLoading) && styles.buttonDisabled]}
              >
                <Text style={[styles.disconnectText, (mutation || bootstrapLoading) && styles.disabledText]}>{t("disconnect")}</Text>
              </Pressable>
            </View>
          ) : null}
            </>
          )}
          {connectionMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.mutedNote}>{connectionMessage}</Text>
          ) : null}
          {screenError ? <Text accessibilityRole="alert" style={styles.errorText}>{screenError}</Text> : null}
          {disconnectedNotice ? <Text style={styles.dataNotice}>{t("disconnectNotice")}</Text> : null}
          {serverUrl.trim() && !isValidServerUrl(serverUrl) ? (
            <Text style={styles.errorText}>{t("serverUrlHttps")}</Text>
          ) : null}
        </View>

        {configured ? <AgentConnectionScope language={language} onNous={() => router.push("/agent-nous")} /> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("taskTitle")}</Text>
          {configured ? (
            <>
          <Text style={styles.fieldLabel}>{t("taskLabel")}</Text>
          <TextInput
            accessibilityLabel={t("taskLabel")}
            accessibilityHint={t("taskIdleNote")}
            autoCapitalize="sentences"
            autoCorrect
            editable={!mutation && configured && !bootstrapLoading && !currentPending}
            maxLength={MAX_AGENT_QUERY_LENGTH}
            multiline
            onChangeText={(value) => {
              setQuery(value);
              setQueryError("");
            }}
            placeholder={t("taskPlaceholder")}
            placeholderTextColor={looiTheme.muted}
            returnKeyType="default"
            style={styles.taskInput}
            textAlignVertical="top"
            value={query}
          />
          {queryError || (query.trim().length === 1 ? t("taskTooShort") : "")
            ? <Text accessibilityRole="alert" style={styles.errorText}>{queryError || t("taskTooShort")}</Text>
            : null}
          <Text style={styles.dataNotice}>{t("dataNotice")}</Text>
          <Text style={styles.mutedNote}>{t("continuityNotice")}</Text>
            </>
          ) : (
            <Text style={styles.sectionHelp}>{t("needServerFirst")}</Text>
          )}

          {pendingEntries.map(([pendingUrl, pending]) => {
            const pendingIsForCurrentServer = pendingUrl === savedUrl;
            const canRetry = configured && pendingIsForCurrentServer && !mutation && !bootstrapLoading;
            return (
              <View key={pendingUrl} style={styles.pendingPanel}>
                <Text style={styles.pendingTitle}>{t("pendingSubmissionTitle")}</Text>
                <Text style={styles.pendingBody}>
                  {pendingIsForCurrentServer ? t("pendingSubmissionBody") : t("pendingOtherServerBody")}
                </Text>
                <Text style={styles.pendingServer}>{t("pendingServerLabel", { url: pendingUrl })}</Text>
                <Text numberOfLines={3} style={styles.pendingQuery}>{pending.query}</Text>
                {!configured || !pendingIsForCurrentServer
                  ? <Text style={styles.errorText}>{t("pendingRequiresConnection")}</Text>
                  : null}
                {pendingIsForCurrentServer && pendingError
                  ? <Text accessibilityRole="alert" style={styles.errorText}>{pendingError}</Text>
                  : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canRetry }}
                  disabled={!canRetry}
                  onPress={() => { void retryPending(); }}
                  style={[styles.secondaryButton, !canRetry && styles.buttonDisabled]}
                >
                  {mutation === "pending" && pendingIsForCurrentServer
                    ? (
                      <View accessibilityLiveRegion="polite" style={styles.loadingButtonContent}>
                        <ActivityIndicator color={looiTheme.cyan} />
                        <Text style={styles.secondaryButtonText}>{t("retryingPendingTask")}</Text>
                      </View>
                    )
                    : <Text style={[styles.secondaryButtonText, !canRetry && styles.disabledText]}>{t("retryPendingTask")}</Text>}
                </Pressable>
              </View>
            );
          })}
          {configured && pendingEntries.length === 0 ? (
            <Text style={styles.mutedNote}>{t("taskIdleNote")}</Text>
          ) : null}

          {configured ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canStart }}
            disabled={!canStart}
            onPress={() => { void startTask(); }}
            style={[styles.primaryButton, !canStart && styles.buttonDisabled]}
          >
            {mutation === "submit"
              ? (
                <View accessibilityLiveRegion="polite" style={styles.loadingButtonContent}>
                  <ActivityIndicator color={looiTheme.bg} />
                  <Text style={styles.primaryButtonText}>{t("startingTask")}</Text>
                </View>
              )
              : <Text style={[styles.primaryButtonText, !canStart && styles.disabledText]}>{t("startTask")}</Text>}
          </Pressable>
          ) : null}
          {submitError ? <Text accessibilityRole="alert" style={styles.errorText}>{submitError}</Text> : null}
        </View>

        {configured || taskListError || bootstrapLoading ? (
        <View style={styles.taskSection}>
          <View style={styles.listHeading}>
            <Text style={styles.sectionTitle}>{t("tasksTitle")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !configured || refreshing || loadingOlderTasks || Boolean(mutation) || bootstrapLoading }}
              disabled={!configured || refreshing || loadingOlderTasks || Boolean(mutation) || bootstrapLoading}
              onPress={refresh}
              style={[styles.refreshButton, (!configured || refreshing || loadingOlderTasks || mutation || bootstrapLoading) && styles.buttonDisabled]}
            >
              {refreshing
                ? <ActivityIndicator color={looiTheme.cyan} />
                : <Text style={[styles.refreshText, (!configured || loadingOlderTasks || mutation || bootstrapLoading) && styles.disabledText]}>{t("refreshTasks")}</Text>}
            </Pressable>
          </View>
          {taskListError ? (
            <View style={styles.emptyState}>
              <Text accessibilityRole="alert" style={styles.errorText}>{taskListError}</Text>
              <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
                <Text style={styles.secondaryButtonText}>{t("retry")}</Text>
              </Pressable>
            </View>
          ) : bootstrapLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={looiTheme.cyan} />
              <Text style={styles.mutedNote}>{t("refreshingTasks")}</Text>
            </View>
          ) : !configured ? (
            <Text style={styles.emptyText}>{t("connectionNotConfigured")}</Text>
          ) : tasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t("tasksEmpty")}</Text>
              <Text style={styles.mutedNote}>{t("tasksEmptyHelp")}</Text>
            </View>
          ) : (
            <View style={styles.taskList}>
              {tasks.map((task) => {
                const expanded = expandedTaskId === task.id;
                const detailKey = taskDetailsKey(savedUrl, task.id, task.updatedAt);
                const fullTask = taskDetailsByKey[detailKey];
                const detailState = detailLoad?.key === detailKey ? detailLoad.state : null;
                const terminal = isTerminalAgentTask(task.status);
                const taskBusy = mutation === `cancel:${task.id}` || mutation === `delete:${task.id}`;
                return (
                  <View key={task.id} style={styles.taskItem}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={`${statusLabel(task.status, t)}. ${task.query}`}
                      onPress={() => setExpandedTaskId(expanded ? null : task.id)}
                      style={styles.taskSummary}
                    >
                      <View style={styles.taskTopLine}>
                        <Text style={[styles.statusText, terminal && task.status === "completed" && styles.statusCompleted]}>
                          {statusLabel(task.status, t)}
                        </Text>
                        <Text style={styles.taskTime}>{formatTime(task.updatedAt, locale, t("unknownTime"))}</Text>
                      </View>
                      <Text numberOfLines={expanded ? undefined : 3} style={styles.taskQuery}>{task.query}</Text>
                      <Text style={styles.expandText}>{expanded ? t("hideTaskDetails") : t("showTaskDetails")}</Text>
                    </Pressable>
                    {expanded ? (
                      <View style={styles.taskDetails}>
                        <Text style={styles.detailMeta}>{t("createdAt", { time: formatTime(task.createdAt, locale, t("unknownTime")) })}</Text>
                        <Text style={styles.detailMeta}>{t("updatedAt", { time: formatTime(task.updatedAt, locale, t("unknownTime")) })}</Text>
                        <Text style={styles.detailHeading}>{t("answer")}</Text>
                        {detailState === "loading" ? (
                          <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
                            <ActivityIndicator color={looiTheme.cyan} />
                            <Text style={styles.mutedNote}>{t("loadingTaskDetails")}</Text>
                          </View>
                        ) : detailState === "error" ? (
                          <View style={styles.detailLoadError}>
                            <Text accessibilityRole="alert" style={styles.errorText}>{t("taskDetailsLoadError")}</Text>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setDetailRetryNonce((current) => current + 1)}
                              style={styles.retryButton}
                            >
                              <Text style={styles.secondaryButtonText}>{t("retry")}</Text>
                            </Pressable>
                          </View>
                        ) : fullTask ? (
                          <>
                            <Text style={styles.answerText}>{fullTask.answer?.trim() || (fullTask.status === "failed" ? t("taskError") : t("noAnswer"))}</Text>
                            {fullTask.error ? <Text style={styles.errorText}>{fullTask.error}</Text> : null}
                          </>
                        ) : (
                          <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
                            <ActivityIndicator color={looiTheme.cyan} />
                            <Text style={styles.mutedNote}>{t("loadingTaskDetails")}</Text>
                          </View>
                        )}
                        <Text style={styles.detailHeading}>{t("sources")}</Text>
                        {fullTask?.sources.length ? (
                          <View style={styles.sourceList}>
                            {fullTask.sources.map((source, index) => {
                              const safe = isHttpUrl(source.url);
                              return safe ? (
                                <Pressable
                                  key={`${source.url}-${index}`}
                                  accessibilityRole="link"
                                  accessibilityLabel={t("openSource", { title: source.title })}
                                  onPress={() => { void openSource(source.url); }}
                                  style={styles.sourceRow}
                                >
                                  <Text style={styles.sourceTitle}>{source.title || source.url}</Text>
                                  <Text numberOfLines={1} style={styles.sourceHost}>{getHost(source.url)}</Text>
                                </Pressable>
                              ) : (
                                <View key={`${source.url}-${index}`} style={styles.sourceRow}>
                                  <Text style={styles.sourceTitle}>{source.title || t("sourceUnavailable")}</Text>
                                  <Text style={styles.sourceHost}>{t("sourceUnavailable")}</Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : fullTask ? (
                          <Text style={styles.mutedNote}>{t("noSources")}</Text>
                        ) : null}
                        <View style={styles.taskActions}>
                          {!terminal && task.status !== "cancelling" ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ disabled: taskBusy || Boolean(mutation) || !configured }}
                              disabled={taskBusy || Boolean(mutation) || !configured}
                              onPress={() => { void requestCancel(task); }}
                              style={[styles.secondaryButton, (taskBusy || mutation || !configured) && styles.buttonDisabled]}
                            >
                              {mutation === `cancel:${task.id}`
                                ? <ActivityIndicator color={looiTheme.cyan} />
                                : <Text style={[styles.secondaryButtonText, (taskBusy || mutation || !configured) && styles.disabledText]}>{t("cancelTask")}</Text>}
                            </Pressable>
                          ) : null}
                          {task.status === "cancelling" ? (
                            <Text accessibilityLiveRegion="polite" style={styles.mutedNote}>{t("cancelPendingNotice")}</Text>
                          ) : null}
                          {terminal ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ disabled: taskBusy || Boolean(mutation) || !configured }}
                              disabled={taskBusy || Boolean(mutation) || !configured}
                              onPress={() => confirmDelete(task)}
                              style={[styles.dangerButton, (taskBusy || mutation || !configured) && styles.buttonDisabled]}
                            >
                              {mutation === `delete:${task.id}`
                                ? <ActivityIndicator color={looiTheme.danger} />
                                : <Text style={[styles.dangerText, (taskBusy || mutation || !configured) && styles.disabledText]}>{t("deleteTask")}</Text>}
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
          {configured &&
          historyServerUrl === savedUrl &&
          nextTaskCursor &&
          !taskListError ? (
            <View style={styles.loadOlderPanel}>
              {olderTasksError ? <Text accessibilityRole="alert" style={styles.errorText}>{olderTasksError}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: taskRequestBusy || refreshing || Boolean(mutation) || bootstrapLoading }}
                disabled={taskRequestBusy || refreshing || Boolean(mutation) || bootstrapLoading}
                onPress={() => { void loadOlderTasks(); }}
                style={[styles.secondaryButton, (taskRequestBusy || refreshing || mutation || bootstrapLoading) && styles.buttonDisabled]}
              >
                {loadingOlderTasks ? (
                  <View accessibilityLiveRegion="polite" style={styles.loadingButtonContent}>
                    <ActivityIndicator color={looiTheme.cyan} />
                    <Text style={styles.secondaryButtonText}>{t("loadingOlderTasks")}</Text>
                  </View>
                ) : (
                  <Text style={[styles.secondaryButtonText, (taskRequestBusy || refreshing || mutation || bootstrapLoading) && styles.disabledText]}>
                    {olderTasksError ? t("retry") : t("loadOlderTasks")}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
          {taskActionError ? <Text accessibilityRole="alert" style={styles.errorText}>{taskActionError}</Text> : null}
        </View>
        ) : null}
      </AgentWorkspaceShell>
    </>
  );
}

function upsertTask(tasks: AgentTask[], task: AgentTask): AgentTask[] {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index < 0) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

function mergeTaskPage(existing: AgentTask[], firstPage: AgentTask[]): AgentTask[] {
  const pageIds = new Set(firstPage.map((task) => task.id));
  return [...firstPage, ...existing.filter((task) => !pageIds.has(task.id))];
}

function mergeOlderTaskPage(existing: AgentTask[], olderPage: AgentTask[]): AgentTask[] {
  const knownIds = new Set(existing.map((task) => task.id));
  const additions = olderPage.filter((task) => {
    if (knownIds.has(task.id)) return false;
    knownIds.add(task.id);
    return true;
  });
  return [...existing, ...additions];
}

function taskDetailsKey(serverUrl: string, taskId: string, updatedAt: string): string {
  return `${serverUrl}\u0000${taskId}\u0000${updatedAt}`;
}

function statusLabel(status: AgentTask["status"], t: ReturnType<typeof createAgentTranslator>): string {
  switch (status) {
    case "queued": return t("statusQueued");
    case "running": return t("statusRunning");
    case "cancelling": return t("statusCancelling");
    case "completed": return t("statusCompleted");
    case "failed": return t("statusFailed");
    case "cancelled": return t("statusCancelled");
    case "interrupted": return t("statusInterrupted");
  }
}

function messageForError(
  code: AgentErrorCode,
  t: ReturnType<typeof createAgentTranslator>,
  context: "setup" | "verify" | "task" | "cancel" | "delete"
): string {
  switch (code) {
    case "not_configured": return t("errorNotConfigured");
    case "invalid_connection": return t("errorInvalidConnection");
    case "invalid_query": return t("taskEmptyError");
    case "pending_submission": return t("pendingSubmissionError");
    case "timeout": return t("errorTimeout");
    case "cancelled": return t("errorCancelled");
    case "network": return t("errorNetwork");
    case "auth": return t("errorAuth");
    case "not_found": return t("errorNotFound");
    case "conflict": return t("errorConflict");
    case "busy": return t("errorBusy");
    case "response": return t("errorResponse");
    case "api":
      if (context === "setup" || context === "verify") return t("connectionTestError");
      if (context === "cancel") return t("cancelError");
      if (context === "delete") return t("deleteError");
      return t("taskStartError");
    case "storage": return t("errorStorage");
    default:
      return context === "setup" || context === "verify"
        ? t("connectionTestError")
        : context === "cancel"
          ? t("cancelError")
          : context === "delete"
            ? t("deleteError")
            : t("taskStartError");
  }
}

function formatTime(value: string, locale: string, fallback: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidServerUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      !parsed.search &&
      !parsed.hash;
  } catch {
    return false;
  }
}

function getHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
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
  section: {
    gap: 10,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: looiTheme.line,
  },
  sectionTitle: {
    color: looiTheme.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  sectionHelp: {
    color: looiTheme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  connectedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  connectedText: {
    flex: 1,
    minWidth: 180,
    color: looiTheme.text,
    fontSize: 15,
    lineHeight: 21,
  },
  changeButton: {
    flexGrow: 0,
    minWidth: 110,
    minHeight: 48,
  },
  fieldLabel: {
    color: looiTheme.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  singleLineInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: looiTheme.text,
    backgroundColor: looiTheme.surface,
    fontSize: 16,
  },
  taskInput: {
    minHeight: 104,
    maxHeight: 200,
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
  mutedNote: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  dataNotice: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.035)",
  },
  primaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: looiTheme.cyan,
    marginTop: 2,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: looiTheme.bg,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  loadingButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  secondaryButton: {
    minHeight: 46,
    minWidth: 130,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(40, 213, 255, 0.38)",
    backgroundColor: "rgba(40, 213, 255, 0.06)",
  },
  secondaryButtonText: {
    color: looiTheme.cyan,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  disconnectButton: {
    borderColor: looiTheme.line,
    backgroundColor: "transparent",
  },
  disconnectText: {
    color: looiTheme.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
  buttonDisabled: {
    backgroundColor: looiTheme.surfaceStrong,
    borderColor: looiTheme.line,
  },
  disabledText: { color: looiTheme.muted },
  errorText: {
    color: looiTheme.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  pendingPanel: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 189, 89, 0.42)",
    backgroundColor: "rgba(255, 189, 89, 0.07)",
  },
  pendingTitle: {
    color: looiTheme.warn,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  pendingBody: {
    color: looiTheme.text,
    fontSize: 13,
    lineHeight: 19,
  },
  pendingServer: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  pendingQuery: {
    color: looiTheme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  taskSection: {
    gap: 12,
    paddingTop: 18,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: looiTheme.line,
  },
  listHeading: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  refreshButton: {
    minHeight: 44,
    minWidth: 110,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  refreshText: {
    color: looiTheme.cyan,
    fontSize: 14,
    fontWeight: "700",
  },
  loadingRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailLoadError: {
    gap: 4,
    alignItems: "flex-start",
  },
  emptyState: {
    gap: 8,
    paddingVertical: 22,
    alignItems: "flex-start",
  },
  emptyTitle: {
    color: looiTheme.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  emptyText: {
    color: looiTheme.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 16,
  },
  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  taskList: {
    borderTopWidth: 1,
    borderTopColor: looiTheme.line,
  },
  loadOlderPanel: {
    gap: 8,
    paddingTop: 12,
  },
  taskItem: {
    borderBottomWidth: 1,
    borderBottomColor: looiTheme.line,
  },
  taskSummary: {
    minHeight: 88,
    paddingVertical: 14,
    gap: 7,
  },
  taskTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  statusText: {
    color: looiTheme.cyan,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  statusCompleted: { color: looiTheme.ok },
  taskTime: {
    color: looiTheme.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "right",
  },
  taskQuery: {
    color: looiTheme.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  expandText: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  taskDetails: {
    gap: 10,
    paddingBottom: 16,
  },
  detailMeta: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  detailHeading: {
    color: looiTheme.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
    marginTop: 4,
  },
  answerText: {
    color: looiTheme.text,
    fontSize: 14,
    lineHeight: 21,
  },
  sourceList: {
    gap: 6,
  },
  sourceRow: {
    minHeight: 48,
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.surface,
  },
  sourceTitle: {
    color: looiTheme.cyan,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  sourceHost: {
    color: looiTheme.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  taskActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  dangerButton: {
    minHeight: 46,
    minWidth: 120,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "transparent",
  },
  dangerText: {
    color: looiTheme.danger,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
});
