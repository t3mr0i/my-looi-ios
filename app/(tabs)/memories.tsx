import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MemoryResult } from "@/src/core/context-service";
import { MemoryCategory } from "@/src/core/observation";
import { useUiText } from "@/src/i18n/use-ui-text";
import type { UiStringKey } from "@/src/i18n/ui-strings";
import {
  deleteLocalMemory,
  memoryService,
  updateLocalMemory,
} from "@/src/memory/memory-service";
import { MAX_EDITED_MEMORY_LENGTH } from "@/src/memory/local-memory-database";
import { DeviceShell, DeviceShellHeader } from "@/src/ui/DeviceShell";
import { looiTheme } from "@/src/ui/looi-theme";
import { MemoryCard } from "@/src/ui/MemoryCard";

const CATEGORIES: { labelKey: UiStringKey; value: MemoryCategory | "all" }[] = [
  { labelKey: "memory.all", value: "all" },
  { labelKey: "memory.placement", value: "placement" },
  { labelKey: "memory.preference", value: "preference" },
  { labelKey: "memory.reminder", value: "reminder" },
  { labelKey: "memory.note", value: "note" },
  { labelKey: "memory.calendar", value: "calendar" },
];

type MemoryBucket = "today" | "yesterday" | "earlier";
type Mutation = { id: string; kind: "save" | "delete" } | null;
type MutationError = { id: string; message: string } | null;

type MemorySection = {
  bucket: MemoryBucket;
  data: MemoryResult[];
};

export default function MemoriesScreen() {
  const { t } = useUiText();
  const navigation = useNavigation();
  const translator = useRef(t);
  translator.current = t;
  const [memories, setMemories] = useState<MemoryResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | "all">("all");
  const [searchText, setSearchText] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mutation, setMutation] = useState<Mutation>(null);
  const [mutationError, setMutationError] = useState<MutationError>(null);
  const loadRequestId = useRef(0);
  const mounted = useRef(false);
  const operationInFlight = useRef(false);
  const skipInitialFocusRefresh = useRef(true);
  const focusRefreshGuardsRef = useRef({
    editing: false,
    mutating: false,
    loading: true,
    refreshing: false,
    operationInFlight: false,
  });
  const navigationPromptOpen = useRef(false);
  const allowNavigationRef = useRef(false);
  const editedMemory = memories.find((item) => item.id === editingMemoryId);
  const isEditing = editingMemoryId !== null;
  const hasUnsavedDraft = Boolean(editedMemory && draft !== editedMemory.memory);
  const hasUnsavedDraftRef = useRef(hasUnsavedDraft);
  hasUnsavedDraftRef.current = hasUnsavedDraft;
  focusRefreshGuardsRef.current = {
    editing: isEditing,
    mutating: mutation !== null,
    loading,
    refreshing,
    operationInFlight: operationInFlight.current,
  };

  const loadMemories = useCallback(async (isRefresh = false) => {
    const requestId = ++loadRequestId.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      const results = await memoryService.getAll();
      if (!mounted.current || requestId !== loadRequestId.current) return;
      setMemories(results);
      setLoadError(null);
    } catch (error) {
      if (!mounted.current || requestId !== loadRequestId.current) return;
      setLoadError(getMemoryLoadErrorMessage(error, translator.current));
    } finally {
      if (mounted.current && requestId === loadRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadMemories();
    return () => {
      mounted.current = false;
      loadRequestId.current += 1;
    };
  }, [loadMemories]);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!hasUnsavedDraftRef.current) return;
    if (allowNavigationRef.current) {
      allowNavigationRef.current = false;
      return;
    }

    event.preventDefault();
    if (navigationPromptOpen.current) return;
    navigationPromptOpen.current = true;
    const attemptedAction = event.data.action;

    Alert.alert(
      translator.current("memory.unsavedTitle"),
      translator.current("memory.unsavedBody"),
      [
        {
          text: translator.current("common.cancel"),
          style: "cancel",
          onPress: () => { navigationPromptOpen.current = false; },
        },
        {
          text: translator.current("memory.discardChanges"),
          style: "destructive",
          onPress: () => {
            navigationPromptOpen.current = false;
            allowNavigationRef.current = true;
            navigation.dispatch(attemptedAction);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => { navigationPromptOpen.current = false; },
      }
    );
  }), [navigation]);

  useFocusEffect(useCallback(() => {
    if (skipInitialFocusRefresh.current) {
      skipInitialFocusRefresh.current = false;
      return;
    }
    const guards = focusRefreshGuardsRef.current;
    if (
      guards.editing
      || guards.mutating
      || guards.loading
      || guards.refreshing
      || guards.operationInFlight
    ) return;

    void loadMemories(true);
  }, [loadMemories]));

  const onRefresh = useCallback(() => {
    if (refreshing || loading || editingMemoryId !== null || operationInFlight.current) return;
    void loadMemories(true);
  }, [editingMemoryId, loadMemories, loading, refreshing]);

  const handleSave = useCallback(async (memory: MemoryResult, value: string) => {
    const text = value.trim();
    if (!text || text.length > MAX_EDITED_MEMORY_LENGTH || operationInFlight.current) return;

    operationInFlight.current = true;
    loadRequestId.current += 1;
    setRefreshing(false);
    setMutation({ id: memory.id, kind: "save" });
    setMutationError(null);
    try {
      const updated = await updateLocalMemory(memory.id, text);
      if (!mounted.current) return;

      if (!updated) {
        const latest = await memoryService.getAll();
        if (!mounted.current) return;
        setMemories(latest);
        const stillExists = latest.some((item) => item.id === memory.id);
        if (!stillExists) {
          setEditingMemoryId(null);
          setDraft("");
        }
        setMutationError({ id: memory.id, message: translator.current("memory.notFound") });
        return;
      }

      const updatedAt = new Date().toISOString();
      setMemories((current) => current.map((item) => item.id === memory.id
        ? {
            ...item,
            memory: text,
            updatedAt,
            metadata: { ...item.metadata, origin: "user-edit", description: undefined, placementFact: undefined },
          }
        : item));
      setEditingMemoryId(null);
      setDraft("");
    } catch {
      if (mounted.current) {
        setMutationError({ id: memory.id, message: translator.current("memory.saveError") });
      }
    } finally {
      operationInFlight.current = false;
      if (mounted.current) setMutation(null);
    }
  }, []);

  const handleDelete = useCallback(async (memory: MemoryResult) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    loadRequestId.current += 1;
    setRefreshing(false);
    setMutation({ id: memory.id, kind: "delete" });
    setMutationError(null);
    try {
      await deleteLocalMemory(memory.id);
      if (!mounted.current) return;
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) {
        setEditingMemoryId(null);
        setDraft("");
      }
    } catch {
      if (mounted.current) {
        setMutationError({ id: memory.id, message: translator.current("memory.deleteError") });
      }
    } finally {
      operationInFlight.current = false;
      if (mounted.current) setMutation(null);
    }
  }, [editingMemoryId]);

  const confirmDelete = useCallback((memory: MemoryResult) => {
    if (operationInFlight.current) return;
    Alert.alert(t("memory.deleteTitle"), t("memory.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => { void handleDelete(memory); },
      },
    ]);
  }, [handleDelete, mutation, t]);

  const beginEditing = useCallback((memory: MemoryResult) => {
    if (mutation) return;
    setEditingMemoryId(memory.id);
    setDraft(memory.memory);
    setMutationError(null);
  }, [mutation]);

  const cancelEditing = useCallback(() => {
    if (mutation) return;
    setEditingMemoryId(null);
    setDraft("");
    setMutationError(null);
  }, [mutation]);

  const normalizedSearch = normalizeSearch(searchText);
  const filteredMemories = useMemo(() => memories.filter((memory) => {
    if (selectedCategory !== "all" && memory.metadata?.category !== selectedCategory) {
      return false;
    }
    if (!normalizedSearch) return true;
    const searchableText = normalizeSearch([
      memory.memory,
      memory.metadata?.description,
      memory.metadata?.placementFact,
      memory.metadata?.category,
      getCategorySearchLabel(memory.metadata?.category, t),
      memory.metadata?.source,
      getSourceSearchLabel(memory.metadata?.source, t),
      memory.metadata?.origin,
      getOriginSearchLabel(memory.metadata?.origin, t),
      memory.metadata?.sourceSessionId,
    ].filter(Boolean).join(" "));
    return searchableText.includes(normalizedSearch);
  }), [memories, normalizedSearch, selectedCategory, t]);
  const sections = useMemo(() => groupMemories(filteredMemories), [filteredMemories]);

  const renderMemory = useCallback(({ item }: { item: MemoryResult }) => (
    <MemoryCard
      memory={item}
      isEditing={editingMemoryId === item.id}
      draft={editingMemoryId === item.id ? draft : ""}
      mutationKind={mutation?.id === item.id ? mutation.kind : null}
      isBusy={mutation !== null}
      errorMessage={mutationError?.id === item.id ? mutationError.message : undefined}
      onEdit={() => beginEditing(item)}
      onDraftChange={setDraft}
      onSave={() => { void handleSave(item, draft); }}
      onCancelEdit={cancelEditing}
      onDelete={() => confirmDelete(item)}
    />
  ), [beginEditing, cancelEditing, confirmDelete, draft, editingMemoryId, handleSave, mutation, mutationError]);

  const listHeader = (
    <>
      <DeviceShellHeader title={t("memory.title")} eyebrow={t("memory.eyebrow")} />
      <View style={styles.headerPanel}>
        <View style={styles.headerCopyBlock}>
          <Text style={styles.headerLabel}>{t("memory.savedFacts")}</Text>
          <Text style={styles.headerCopy}>
            {t("memory.recentFacts")}
          </Text>
        </View>
        <Text
          accessibilityLabel={t("memory.count", { count: memories.length })}
          style={styles.countText}
        >
          {memories.length}
        </Text>
      </View>

      {loadError ? (
        <View style={styles.noticeRow}>
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("memory.retry")}
            accessibilityState={{ disabled: loading || refreshing || mutation !== null || isEditing }}
            disabled={loading || refreshing || mutation !== null || isEditing}
            onPress={() => { void loadMemories(true); }}
            style={[styles.retryButton, (loading || refreshing || isEditing) && styles.disabled]}
          >
            <Text style={styles.retryText}>{t("memory.retry")}</Text>
          </Pressable>
        </View>
      ) : null}

      {mutationError && !filteredMemories.some((item) => item.id === mutationError.id) ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {mutationError.message}
        </Text>
      ) : null}

      {isEditing ? (
        <Text accessibilityLiveRegion="polite" style={styles.filterLockedNotice}>
          {t("memory.editingFiltersNotice")}
        </Text>
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel={t("memory.searchLabel")}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
          onChangeText={setSearchText}
          placeholder={t("memory.searchPlaceholder")}
          placeholderTextColor={looiTheme.muted}
          returnKeyType="search"
          editable={!isEditing && mutation === null}
          style={[styles.searchInput, (isEditing || mutation !== null) && styles.disabled]}
          value={searchText}
        />
        {searchText.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("memory.clearSearch")}
            accessibilityState={{ disabled: isEditing || mutation !== null }}
            disabled={isEditing || mutation !== null}
            onPress={() => setSearchText("")}
            style={[styles.clearSearchButton, (isEditing || mutation !== null) && styles.disabled]}
          >
            <Text style={styles.clearSearchText}>{t("memory.clearSearch")}</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORIES.map((category) => {
          const active = selectedCategory === category.value;
          return (
            <Pressable
              key={category.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: mutation !== null || isEditing }}
              disabled={mutation !== null || isEditing}
              onPress={() => setSelectedCategory(category.value)}
              style={[styles.chip, active && styles.chipActive, (mutation || isEditing) && styles.disabled]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {t(category.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  const emptyTitle = loading
    ? t("memory.loading")
    : loadError && memories.length === 0
      ? t("memory.unavailable")
      : memories.length === 0
        ? t("memory.empty")
        : t("memory.noResults");
  const emptyHelp = loading
    ? t("memory.loadingHelp")
    : loadError && memories.length === 0
      ? t("memory.loadErrorHelp")
      : memories.length === 0
        ? t("memory.emptyHelp")
        : t("memory.noResultsHelp");

  return (
    <DeviceShell title={t("memory.title")} eyebrow={t("memory.eyebrow")} scroll={false}>
      <SectionList
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        sections={sections}
        style={styles.list}
        keyExtractor={(item) => item.id}
        renderItem={renderMemory}
        extraData={{ editingMemoryId, draft, mutation, mutationError }}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{t(getBucketLabelKey(section.bucket))}</Text>
        )}
        contentContainerStyle={[
          styles.listContent,
          sections.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            enabled={!isEditing && mutation === null && !loading}
            tintColor={looiTheme.cyan}
          />
        )}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={(
          <View style={styles.emptyContainer}>
            {loading ? <ActivityIndicator color={looiTheme.cyan} /> : null}
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyText}>{emptyHelp}</Text>
          </View>
        )}
      />
    </DeviceShell>
  );
}

function groupMemories(memories: MemoryResult[]): MemorySection[] {
  const sorted = [...memories].sort(compareMemoryByNewest);
  const groups: MemorySection[] = [
    { bucket: "today", data: [] },
    { bucket: "yesterday", data: [] },
    { bucket: "earlier", data: [] },
  ];

  sorted.forEach((memory) => {
    const bucket = getMemoryBucket(memory);
    groups.find((group) => group.bucket === bucket)?.data.push(memory);
  });

  return groups.filter((group) => group.data.length > 0);
}

function getMemoryBucket(memory: MemoryResult): MemoryBucket {
  const time = getMemoryTime(memory);
  if (!time) return "earlier";

  const date = new Date(time);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  if (date.getTime() >= todayStart) return "today";
  if (date.getTime() >= yesterdayStart) return "yesterday";
  return "earlier";
}

function getMemoryTime(memory: MemoryResult): number {
  const rawTime = memory.updatedAt || memory.createdAt || memory.metadata?.timestamp;
  if (!rawTime) return 0;
  const time = new Date(rawTime).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareMemoryByNewest(a: MemoryResult, b: MemoryResult): number {
  return getMemoryTime(b) - getMemoryTime(a);
}

function getBucketLabelKey(bucket: MemoryBucket): UiStringKey {
  if (bucket === "today") return "memory.today";
  if (bucket === "yesterday") return "memory.yesterday";
  return "memory.earlier";
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function getCategorySearchLabel(category: string | undefined, t: (key: UiStringKey) => string): string {
  const categoryKey = CATEGORIES.find((item) => item.value === category)?.labelKey
    ?? (category === "scene" ? "memory.scene" : undefined);
  return categoryKey ? t(categoryKey) : category ?? "";
}

function getSourceSearchLabel(source: string | undefined, t: (key: UiStringKey) => string): string {
  switch (source) {
    case "voice+camera": return t("memory.source.voiceCamera");
    case "voice": return t("memory.source.voice");
    case "camera": return t("memory.source.camera");
    case "calendar": return t("memory.source.calendar");
    case "system": return t("memory.source.system");
    default: return source ?? "";
  }
}

function getOriginSearchLabel(origin: string | undefined, t: (key: UiStringKey) => string): string {
  switch (origin) {
    case "conversation": return t("memory.origin.conversation");
    case "user-edit": return t("memory.origin.userEdit");
    case "unknown": return t("memory.origin.unknown");
    default: return t("memory.origin.notRecorded");
  }
}

function getMemoryLoadErrorMessage(
  error: unknown,
  t: (key: UiStringKey) => string
): string {
  if (error instanceof Error && error.message.includes("Failed to connect")) {
    return t("memory.loadServiceError");
  }

  return t("memory.loadError");
}

const styles = StyleSheet.create({
  headerPanel: {
    minHeight: 82,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.surface,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
  },
  headerCopyBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerLabel: {
    color: looiTheme.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  headerCopy: {
    color: looiTheme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  countText: {
    color: looiTheme.cyan,
    fontSize: 22,
    fontWeight: "700",
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
  },
  filterLockedNotice: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    color: looiTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: looiTheme.line,
  },
  retryText: {
    color: looiTheme.cyan,
    fontSize: 14,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    color: looiTheme.text,
    borderWidth: 1,
    borderColor: looiTheme.line,
    borderRadius: 14,
    backgroundColor: looiTheme.bg,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 16,
  },
  clearSearchButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  clearSearchText: {
    color: looiTheme.cyan,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  filterScroll: {
    flexGrow: 0,
    marginBottom: 14,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "rgba(237, 247, 255, 0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    borderColor: looiTheme.lineActive,
    backgroundColor: "rgba(40, 213, 255, 0.08)",
  },
  chipText: {
    color: looiTheme.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: looiTheme.cyan,
  },
  disabled: {
    opacity: 0.45,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 28,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  sectionTitle: {
    color: looiTheme.text,
    fontSize: 19,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 10,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 48,
  },
  emptyTitle: {
    color: looiTheme.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyText: {
    color: looiTheme.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
});
