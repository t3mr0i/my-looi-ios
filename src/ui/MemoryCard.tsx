import { Image } from "expo-image";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MemoryResult } from "../core/context-service";
import { useUiText } from "@/src/i18n/use-ui-text";
import type { UiStringKey } from "@/src/i18n/ui-strings";
import { MAX_EDITED_MEMORY_LENGTH } from "@/src/memory/local-memory-database";
import { looiTheme } from "./looi-theme";

interface MemoryCardProps {
  memory: MemoryResult;
  isEditing: boolean;
  draft: string;
  mutationKind: "save" | "delete" | null;
  isBusy: boolean;
  errorMessage?: string;
  onEdit: () => void;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

export function MemoryCard({
  memory,
  isEditing,
  draft,
  mutationKind,
  isBusy,
  errorMessage,
  onEdit,
  onDraftChange,
  onSave,
  onCancelEdit,
  onDelete,
}: MemoryCardProps) {
  const { locale, t } = useUiText();
  const categoryLabel = t(getCategoryKey(memory.metadata?.category));
  const sourceLabel = getSourceLabel(memory.metadata?.source, t);
  const originLabel = t(getOriginKey(memory.metadata?.origin));
  const timeStr = formatMemoryTime(memory, locale, t("memory.timeUnknown"), t);
  const sourceDate = memory.metadata?.timestamp ? new Date(memory.metadata.timestamp) : null;
  const sourceTime = sourceDate && Number.isFinite(sourceDate.getTime())
    ? sourceDate.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const saveDisabled = isBusy || draft.trim().length === 0;
  const busyLabel = mutationKind === "save" ? t("memory.saving") : t("memory.deleting");

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{categoryLabel}</Text>
        </View>
        <Text style={styles.time}>{timeStr}</Text>
      </View>

      {isEditing ? (
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>{t("memory.editTitle")}</Text>
          <Text style={styles.editorNotice}>{t("memory.editConversationNotice")}</Text>
          <TextInput
            accessibilityLabel={t("memory.editTitle")}
            autoFocus
            editable={!isBusy}
            maxLength={MAX_EDITED_MEMORY_LENGTH}
            multiline
            onChangeText={onDraftChange}
            placeholder={t("memory.editPlaceholder")}
            placeholderTextColor={looiTheme.muted}
            selectionColor={looiTheme.cyan}
            style={styles.editorInput}
            textAlignVertical="top"
            value={draft}
          />
          <Text style={styles.characterCount}>
            {t("memory.charactersCount", {
              count: draft.length,
              max: MAX_EDITED_MEMORY_LENGTH,
            })}
          </Text>
          <View style={styles.actionRow}>
            <ActionButton
              label={mutationKind === "save" ? t("memory.saving") : t("common.save")}
              onPress={onSave}
              disabled={saveDisabled}
              accessibilityLabel={t("common.save")}
            />
            <ActionButton
              label={t("common.cancel")}
              onPress={onCancelEdit}
              disabled={isBusy}
              secondary
              accessibilityLabel={t("common.cancel")}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.content}>{memory.memory}</Text>
      )}

      <View style={styles.provenance}>
        <Text style={styles.meta}>{sourceLabel}</Text>
        <Text style={styles.meta}>{originLabel}</Text>
        {memory.metadata?.sourceSessionId && sourceTime ? (
          <Text style={styles.sessionReference}>
            {t("memory.sourceConversationAt", { time: sourceTime })}
          </Text>
        ) : null}
      </View>

      {memory.metadata?.evidenceUri ? (
        <Image
          accessibilityLabel={t("memory.relatedImageA11y")}
          contentFit="contain"
          source={{ uri: memory.metadata.evidenceUri }}
          style={styles.evidenceImage}
        />
      ) : null}

      {errorMessage ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}

      {isBusy ? (
        <View accessibilityLiveRegion="polite" style={styles.busyRow}>
          <ActivityIndicator color={looiTheme.cyan} size="small" />
          <Text style={styles.busyText}>{busyLabel}</Text>
        </View>
      ) : null}

      {!isEditing ? (
        <View style={styles.actionRow}>
          <ActionButton
            label={t("memory.edit")}
            onPress={onEdit}
            disabled={isBusy}
            secondary
            accessibilityLabel={t("memory.edit")}
          />
          <ActionButton
            label={t("memory.delete")}
            onPress={onDelete}
            disabled={isBusy}
            destructive
            accessibilityLabel={t("memory.delete")}
          />
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  secondary,
  destructive,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  secondary?: boolean;
  destructive?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        secondary && styles.actionButtonSecondary,
        destructive && styles.actionButtonDestructive,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          secondary && styles.actionTextSecondary,
          destructive && styles.actionTextDestructive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatMemoryTime(
  memory: MemoryResult,
  locale: string,
  unknownLabel: string,
  t: (key: UiStringKey, params?: Record<string, string | number>) => string
): string {
  const wasEdited = memory.metadata?.origin === "user-edit";
  const raw = (wasEdited ? memory.updatedAt : memory.createdAt) || memory.metadata?.timestamp;
  if (!raw) return unknownLabel;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return unknownLabel;
  const time = date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return wasEdited
    ? t("memory.editedAt", { time })
    : t("memory.savedAt", { time });
}

function getCategoryKey(category?: string): UiStringKey {
  switch (category) {
    case "placement": return "memory.placement";
    case "preference": return "memory.preference";
    case "reminder": return "memory.reminder";
    case "scene": return "memory.scene";
    case "calendar": return "memory.calendar";
    default: return "memory.note";
  }
}

function getSourceLabel(
  source: string | undefined,
  t: (key: UiStringKey) => string
): string {
  switch (source) {
    case "voice+camera": return t("memory.source.voiceCamera");
    case "voice": return t("memory.source.voice");
    case "camera": return t("memory.source.camera");
    case "calendar": return t("memory.source.calendar");
    case undefined:
    case "":
      return t("memory.source.system");
    default:
      return source;
  }
}

function getOriginKey(origin?: string): UiStringKey {
  switch (origin) {
    case "conversation": return "memory.origin.conversation";
    case "user-edit": return "memory.origin.userEdit";
    case "unknown": return "memory.origin.unknown";
    default: return "memory.origin.notRecorded";
  }
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: looiTheme.surface,
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  categoryBadge: {
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    backgroundColor: "rgba(40, 213, 255, 0.08)",
    justifyContent: "center",
  },
  categoryText: {
    color: looiTheme.cyan,
    fontSize: 12,
    fontWeight: "700",
  },
  time: {
    flexShrink: 1,
    color: looiTheme.muted,
    fontSize: 12,
    textAlign: "right",
  },
  content: {
    color: looiTheme.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    flexShrink: 1,
  },
  provenance: {
    gap: 3,
  },
  meta: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  sessionReference: {
    color: looiTheme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  evidenceImage: {
    width: "100%",
    height: 200,
    borderRadius: 16,
    backgroundColor: looiTheme.bgRaised,
  },
  editor: {
    gap: 8,
  },
  editorLabel: {
    color: looiTheme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  editorNotice: {
    color: looiTheme.warn,
    fontSize: 13,
    lineHeight: 19,
  },
  editorInput: {
    minHeight: 112,
    maxHeight: 280,
    color: looiTheme.text,
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    borderRadius: 14,
    backgroundColor: looiTheme.bg,
    padding: 12,
    fontSize: 16,
    lineHeight: 23,
  },
  characterCount: {
    color: looiTheme.muted,
    fontSize: 12,
    textAlign: "right",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: 112,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: looiTheme.cyan,
  },
  actionButtonSecondary: {
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "transparent",
  },
  actionButtonDestructive: {
    borderWidth: 1,
    borderColor: "rgba(255, 92, 122, 0.55)",
    backgroundColor: "rgba(255, 92, 122, 0.08)",
  },
  actionText: {
    color: "#041319",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  actionTextSecondary: {
    color: looiTheme.text,
    fontWeight: "700",
  },
  actionTextDestructive: {
    color: looiTheme.danger,
  },
  errorText: {
    color: looiTheme.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  busyText: {
    color: looiTheme.muted,
    fontSize: 13,
  },
  disabled: {
    opacity: 0.45,
  },
});
