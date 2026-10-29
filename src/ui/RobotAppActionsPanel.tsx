import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { looiTheme } from "./looi-theme";
import { useUiText } from "../i18n/use-ui-text";
import { createRobotAppsTranslator, type RobotAppsStringKey } from "../i18n/robot-app-strings";
import {
  EMPTY_ROBOT_APP_ACTION_PROFILE,
  isRobotAppActionSource,
  normalizeRobotAppActionProfile,
  ROBOT_APP_ACTIONS,
  type RobotAppActionCategory,
  type RobotAppActionId,
  type RobotAppActionProfile,
} from "../robot-bridge/action-profile";
import {
  configureRobotAppActions,
  loadRobotAppActionProfile,
  previewRobotAppAction,
} from "../robot-bridge/runtime";

const CATEGORY_ORDER: readonly RobotAppActionCategory[] = ["expression", "head", "movement", "light"];
const CATEGORY_LABELS: Record<RobotAppActionCategory, RobotAppsStringKey> = {
  expression: "actionGroupExpression",
  head: "actionGroupHead",
  movement: "actionGroupMovement",
  light: "actionGroupLight",
};
const ACTION_LABELS: Record<RobotAppActionId, RobotAppsStringKey> = {
  nod: "actionNameNod",
  curious: "actionNameCurious",
  happy_bob: "actionNameHappyBob",
  sleepy: "actionNameSleepy",
  thinking: "actionNameThinking",
  speaking_soft: "actionNameSpeakingSoft",
  head_up: "actionNameHeadUp",
  head_center: "actionNameHeadCenter",
  head_down: "actionNameHeadDown",
  move_forward: "actionNameMoveForward",
  move_back: "actionNameMoveBack",
  turn_left: "actionNameTurnLeft",
  turn_right: "actionNameTurnRight",
  light_on: "actionNameLightOn",
  light_off: "actionNameLightOff",
};
const CANONICAL_ACTION_NAMES = new Set<string>(ROBOT_APP_ACTIONS.map(({ id }) => id));

type Props = { onDirtyChange?: (dirty: boolean) => void };
type Feedback = { kind: "success" | "error"; text: string };
type ValidationResult = { profile: RobotAppActionProfile | null; error: RobotAppsStringKey | null };

function copyProfile(profile: RobotAppActionProfile): RobotAppActionProfile {
  return { schemaVersion: 1, mappings: profile.mappings.map(({ source, target }) => ({ source, target })) };
}

function sameProfile(left: RobotAppActionProfile, right: RobotAppActionProfile): boolean {
  return left.mappings.length === right.mappings.length
    && left.mappings.every((mapping, index) => mapping.source === right.mappings[index]?.source
      && mapping.target === right.mappings[index]?.target);
}

function validateDraft(draft: RobotAppActionProfile): ValidationResult {
  if (draft.mappings.length > 64) return { profile: null, error: "actionAliasMaxCount" };
  const seen = new Set<string>();
  for (const mapping of draft.mappings) {
    const source = mapping.source.trim();
    if (!source) return { profile: null, error: "actionAliasRequired" };
    if (!isRobotAppActionSource(source)) return { profile: null, error: "actionAliasInvalid" };
    if (CANONICAL_ACTION_NAMES.has(source)) return { profile: null, error: "actionAliasReserved" };
    if (seen.has(source)) return { profile: null, error: "actionAliasDuplicate" };
    seen.add(source);
  }
  try {
    return {
      profile: normalizeRobotAppActionProfile({
        schemaVersion: 1,
        mappings: draft.mappings.map(({ source, target }) => ({ source: source.trim(), target })),
      }),
      error: null,
    };
  } catch {
    return { profile: null, error: "actionAliasInvalid" };
  }
}

export function RobotAppActionsPanel({ onDirtyChange }: Props) {
  const { language } = useUiText();
  const t = useMemo(() => createRobotAppsTranslator(language), [language]);
  const [savedProfile, setSavedProfile] = useState<RobotAppActionProfile>(EMPTY_ROBOT_APP_ACTION_PROFILE);
  const [draft, setDraft] = useState<RobotAppActionProfile>(EMPTY_ROBOT_APP_ACTION_PROFILE);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<RobotAppsStringKey | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dirty = !sameProfile(draft, savedProfile);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setFeedback(null);
    try {
      const profile = normalizeRobotAppActionProfile(await loadRobotAppActionProfile());
      setSavedProfile(copyProfile(profile));
      setDraft(copyProfile(profile));
      setValidationError(null);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const updateMapping = (index: number, update: Partial<RobotAppActionProfile["mappings"][number]>) => {
    setDraft((previous) => ({
      schemaVersion: 1,
      mappings: previous.mappings.map((mapping, rowIndex) => rowIndex === index ? { ...mapping, ...update } : mapping),
    }));
    setValidationError(null);
    setFeedback(null);
  };

  const addMapping = () => {
    if (draft.mappings.length >= 64 || draft.mappings.some(({ source }) => source.trim().length === 0)) {
      setValidationError(draft.mappings.length >= 64 ? "actionAliasMaxCount" : "actionAliasRequired");
      return;
    }
    setDraft((previous) => ({ schemaVersion: 1, mappings: [...previous.mappings, { source: "", target: "nod" }] }));
    setValidationError(null);
    setFeedback(null);
  };

  const removeMapping = (index: number) => {
    setDraft((previous) => ({ schemaVersion: 1, mappings: previous.mappings.filter((_mapping, rowIndex) => rowIndex !== index) }));
    setValidationError(null);
    setFeedback(null);
  };

  const saveProfile = async () => {
    const validated = validateDraft(draft);
    if (!validated.profile) {
      setValidationError(validated.error ?? "actionAliasInvalid");
      setFeedback(null);
      return;
    }
    setSaving(true);
    setFeedback(null);
    setValidationError(null);
    try {
      await configureRobotAppActions(validated.profile);
      setSavedProfile(copyProfile(validated.profile));
      setDraft(copyProfile(validated.profile));
      setFeedback({ kind: "success", text: t("actionSaved") });
    } catch {
      setFeedback({ kind: "error", text: t("actionSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const resetDraft = () => {
    setDraft(copyProfile(EMPTY_ROBOT_APP_ACTION_PROFILE));
    setValidationError(null);
    setFeedback(null);
  };

  const trySavedMapping = async (source: string, target: RobotAppActionId) => {
    if (dirty || !savedProfile.mappings.some((mapping) => mapping.source === source && mapping.target === target)) return;
    setPreviewing(source);
    setFeedback(null);
    try {
      const result = await previewRobotAppAction(source);
      if (result.status === "applied" || result.status === "adapted") {
        setFeedback({ kind: "success", text: t("actionPreviewDone", { action: t(ACTION_LABELS[target]) }) });
      } else {
        setFeedback({ kind: "error", text: t("actionPreviewFailed") });
      }
    } catch {
      setFeedback({ kind: "error", text: t("actionPreviewFailed") });
    } finally {
      setPreviewing(null);
    }
  };

  const actionName = (id: RobotAppActionId) => t(ACTION_LABELS[id]);
  const canAdd = !loading && !saving && draft.mappings.length < 64 && draft.mappings.every(({ source }) => source.trim().length > 0);
  const canReset = !loading && !saving && (draft.mappings.length > 0 || savedProfile.mappings.length > 0);

  return (
    <View style={styles.panel}>
      <Text style={styles.intro}>{t("actionMappingIntro")}</Text>

      {loading ? <View style={styles.statusLine}><ActivityIndicator color={looiTheme.cyan} size="small" /><Text style={styles.help}>{t("actionMappingLoading")}</Text></View> : null}
      {loadFailed ? <View style={styles.loadError}>
        <Text accessibilityRole="alert" style={styles.error}>{t("actionMappingLoadFailed")}</Text>
        <PanelButton label={t("actionMappingRetry")} onPress={() => void loadProfile()} secondary />
      </View> : null}

      {!loading && !loadFailed ? <>
        {draft.mappings.length === 0 ? <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t("actionMappingEmpty")}</Text>
        </View> : null}

        {draft.mappings.map((mapping, index) => {
          const isSaved = !dirty && savedProfile.mappings.some((saved) => saved.source === mapping.source && saved.target === mapping.target);
          const isPickerOpen = pickerIndex === index;
          return <View key={`action-map-${index}`} style={styles.mappingCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.fieldLabel}>{t("actionAlias")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("actionRemoveA11y", { action: mapping.source || t("actionAlias") })}
                accessibilityState={{ disabled: saving || previewing !== null }}
                disabled={saving || previewing !== null}
                onPress={() => removeMapping(index)}
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed, (saving || previewing !== null) && styles.disabled]}
              >
                <SymbolView name={{ ios: "trash", android: "delete_outline" }} size={16} tintColor={looiTheme.danger} />
                <Text style={styles.removeText}>{t("actionRemove")}</Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={t("actionAlias")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving && previewing === null}
              // Native length counts UTF-16 units; validation limits 200 Unicode characters.
              maxLength={400}
              onChangeText={(source) => updateMapping(index, { source })}
              placeholder={t("actionAliasPlaceholder")}
              placeholderTextColor={looiTheme.muted}
              returnKeyType="done"
              style={styles.input}
              value={mapping.source}
            />
            <Text style={styles.fieldHint}>{t("actionAliasHelp")}</Text>

            <Text style={styles.fieldLabel}>{t("actionTarget")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t("actionTarget")}: ${actionName(mapping.target)} (${mapping.target})`}
              accessibilityHint={t("actionTargetChoose")}
              accessibilityState={{ expanded: isPickerOpen, disabled: saving || previewing !== null }}
              disabled={saving || previewing !== null}
              onPress={() => setPickerIndex(index)}
              style={({ pressed }) => [styles.targetButton, pressed && styles.pressed, (saving || previewing !== null) && styles.disabled]}
            >
              <View style={styles.targetCopy}>
                <Text style={styles.targetTitle}>{actionName(mapping.target)}</Text>
                <Text style={styles.machineId}>{mapping.target}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.down", android: "expand_more" }} size={17} tintColor={looiTheme.muted} />
            </Pressable>

            <View style={styles.previewRow}>
              <PanelButton
                label={previewing === mapping.source ? t("actionPreviewing") : t("actionPreview")}
                onPress={() => void trySavedMapping(mapping.source, mapping.target)}
                disabled={!isSaved || !mapping.source || saving || previewing !== null}
                secondary
              />
              {!isSaved ? <Text style={styles.previewHint}>{t("actionPreviewSaved")}</Text> : null}
            </View>

            <TargetPicker
              visible={isPickerOpen}
              selected={mapping.target}
              actionName={actionName}
              t={t}
              onClose={() => setPickerIndex(null)}
              onSelect={(target) => {
                updateMapping(index, { target });
                setPickerIndex(null);
              }}
            />
          </View>;
        })}

        {validationError ? <Text accessibilityRole="alert" style={styles.error}>{t(validationError)}</Text> : null}
        {dirty ? <Text style={styles.dirty}>{t("actionUnsaved")}</Text> : null}
        {feedback ? <Text accessibilityRole="alert" style={feedback.kind === "error" ? styles.error : styles.success}>{feedback.text}</Text> : null}

        <View style={styles.footer}>
          {draft.mappings.length >= 64 ? <Text style={styles.help}>{t("actionAliasMaxCount")}</Text> : null}
          <PanelButton label={t("actionAdd")} onPress={addMapping} disabled={!canAdd || previewing !== null} />
          <View style={styles.footerActions}>
            <PanelButton label={saving ? t("actionSaving") : t("actionSave")} onPress={() => void saveProfile()} disabled={!dirty || saving || previewing !== null} />
            <PanelButton label={t("actionReset")} onPress={resetDraft} disabled={!canReset || previewing !== null} secondary />
          </View>
          <Text style={styles.help}>{t("actionResetHelp")}</Text>
        </View>
      </> : null}
    </View>
  );
}

function TargetPicker({
  visible,
  selected,
  actionName,
  t,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: RobotAppActionId;
  actionName: (id: RobotAppActionId) => string;
  t: ReturnType<typeof createRobotAppsTranslator>;
  onClose: () => void;
  onSelect: (id: RobotAppActionId) => void;
}) {
  return <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("actionClosePicker")} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.pickerCard}>
        <View style={styles.pickerHeader}>
          <Text accessibilityRole="header" style={styles.pickerTitle}>{t("actionTargetChoose")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("actionClosePicker")} onPress={onClose} style={styles.closeButton}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={17} tintColor={looiTheme.text} />
          </Pressable>
        </View>
        <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerContent}>
          {CATEGORY_ORDER.map((category) => <View key={category} style={styles.pickerGroup}>
            <Text style={styles.groupTitle}>{t(CATEGORY_LABELS[category])}</Text>
            {ROBOT_APP_ACTIONS.filter((action) => action.category === category).map(({ id }) => <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected === id }}
              onPress={() => onSelect(id)}
              style={({ pressed }) => [styles.actionOption, selected === id && styles.actionOptionSelected, pressed && styles.pressed]}
            >
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>{actionName(id)}</Text>
                <Text style={styles.machineId}>{id}</Text>
              </View>
              {selected === id ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={17} tintColor={looiTheme.cyan} /> : null}
            </Pressable>)}
          </View>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

function PanelButton({ label, onPress, disabled, secondary }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && styles.pressed, disabled && styles.disabled]}
  >
    <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  panel: { width: "100%", gap: 20, paddingBottom: 16 },
  intro: { color: looiTheme.text, fontSize: 17, lineHeight: 25 },
  help: { color: looiTheme.muted, fontSize: 15, lineHeight: 22 },
  fieldLabel: { color: looiTheme.muted, fontSize: 15, fontWeight: "600" },
  fieldHint: { color: looiTheme.muted, fontSize: 11, lineHeight: 16 },
  mappingCard: { width: "100%", borderRadius: 16, backgroundColor: "#0d1b29", padding: 20, gap: 14 },
  cardHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  removeButton: { minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 9, borderRadius: 11, borderWidth: 1, borderColor: looiTheme.line },
  removeText: { color: looiTheme.danger, fontSize: 15, fontWeight: "600" },
  input: { width: "100%", minHeight: 48, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12, backgroundColor: looiTheme.bg, color: looiTheme.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  targetButton: { width: "100%", minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12, backgroundColor: looiTheme.bg, paddingHorizontal: 12, paddingVertical: 8 },
  targetCopy: { flex: 1, minWidth: 0, gap: 2 },
  targetTitle: { color: looiTheme.text, fontSize: 16, fontWeight: "600" },
  machineId: { color: looiTheme.muted, fontSize: 11, lineHeight: 15 },
  previewRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 2 },
  previewHint: { flex: 1, minWidth: 130, color: looiTheme.muted, fontSize: 11, lineHeight: 16 },
  footer: { gap: 10, paddingTop: 3 },
  footerActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  button: { minHeight: 48, minWidth: 88, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: looiTheme.cyan, backgroundColor: looiTheme.cyan, paddingHorizontal: 14, paddingVertical: 9 },
  buttonText: { color: looiTheme.bg, fontSize: 12, fontWeight: "800", textAlign: "center" },
  buttonSecondary: { borderColor: looiTheme.line, backgroundColor: "transparent" },
  buttonSecondaryText: { color: looiTheme.text },
  pressed: { backgroundColor: looiTheme.whiteSoft },
  disabled: { opacity: 0.45 },
  dirty: { color: looiTheme.warn, fontSize: 15, fontWeight: "600" },
  statusLine: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9 },
  loadError: { gap: 10, alignItems: "flex-start" },
  emptyCard: { borderWidth: 1, borderColor: looiTheme.line, borderRadius: 14, padding: 14, backgroundColor: looiTheme.rail },
  emptyText: { color: looiTheme.muted, fontSize: 13, lineHeight: 19 },
  error: { color: looiTheme.danger, fontSize: 15, lineHeight: 22 },
  success: { color: looiTheme.ok, fontSize: 15, lineHeight: 22 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: 18 },
  pickerCard: { width: "100%", maxWidth: 440, maxHeight: "82%", borderWidth: 1, borderColor: looiTheme.lineActive, borderRadius: 20, backgroundColor: looiTheme.rail, padding: 14, gap: 10 },
  pickerHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pickerTitle: { flex: 1, color: looiTheme.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: looiTheme.line },
  pickerScroll: { flexShrink: 1 },
  pickerContent: { gap: 13, paddingBottom: 4 },
  pickerGroup: { gap: 5 },
  groupTitle: { color: looiTheme.cyan, fontSize: 12, lineHeight: 17, fontWeight: "800", paddingHorizontal: 3, paddingTop: 3 },
  actionOption: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7 },
  actionOptionSelected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40,213,255,0.08)" },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { color: looiTheme.text, fontSize: 16, fontWeight: "600" },
});
