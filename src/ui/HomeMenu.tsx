import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import regularSymbolWeight from "expo-symbols/androidWeights/regular";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LISTENING_LANGUAGE_OPTIONS, type ListeningLanguage } from "@/src/language/listening-language";
import { RESPONSE_LANGUAGE_OPTIONS, type ResponseLanguage } from "@/src/language/response-language";
import { useUiText } from "@/src/i18n/use-ui-text";
import { looiTheme } from "@/src/ui/looi-theme";
import { CHARACTER_ACTIONS, type CharacterActionKind } from "@/src/character/character-action";
import { CharacterPropIcon } from "@/src/ui/CharacterProp";
import { CharacterSceneLibrary } from "@/src/ui/CharacterSceneLibrary";

const HIDE_AFTER_MS = 4_000;
const FADE_IN_MS = 150;
const FADE_OUT_MS = 250;
const SHEET_ACTION_DELAY_MS = 350;
const SWIPE_DISMISS_DY = 60;

export type HomeMenuHandle = { reveal: () => void };

export type HomeMenuProps = {
  repairNeeded: boolean;
  onRepair: () => void;
  robotError: boolean;
  robotLabel: string;
  robotDisabled: boolean;
  onRobot: () => void;
  listeningLanguage: ListeningLanguage;
  responseLanguage: ResponseLanguage;
  onSelectListeningLanguage: (language: ListeningLanguage) => void;
  onSelectResponseLanguage: (language: ResponseLanguage) => void;
  photoBusy: boolean;
  onPhoto: () => void;
  onObject: () => void;
  onConversations: () => void;
  onMemory: () => void;
  onApps: () => void;
  onSettings: () => void;
  onCharacterAction?: (kind: CharacterActionKind) => void;
};

type SymbolName = { ios: string; android: string };

function MenuIcon({ name, color = looiTheme.cyan, size = 22 }: { name: SymbolName; color?: string; size?: number }) {
  return (
    <SymbolView
      name={name as never}
      size={size}
      tintColor={color}
      weight={{ ios: "semibold", android: regularSymbolWeight }}
    />
  );
}

function MenuRow({
  icon,
  propIcon,
  label,
  value,
  onPress,
  disabled,
  warning,
  accessibilityLabel,
  expanded,
}: {
  icon?: SymbolName;
  propIcon?: CharacterActionKind;
  label: string;
  value?: string;
  onPress: () => void;
  disabled?: boolean;
  warning?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}: ${value}` : label)}
      accessibilityState={{ disabled: Boolean(disabled), ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.row,
        warning && styles.rowWarning,
        disabled && styles.rowDisabled,
        pressed && styles.rowPressed,
      ]}
    >
      {propIcon ? <CharacterPropIcon kind={propIcon} color={looiTheme.cyan} size={22} /> : icon ? <MenuIcon name={icon} color={warning ? looiTheme.warn : looiTheme.cyan} /> : null}
      <Text numberOfLines={2} style={[styles.rowLabel, warning && styles.rowLabelWarning]}>{label}</Text>
      {value ? <Text numberOfLines={1} style={styles.rowValue}>{value}</Text> : null}
    </Pressable>
  );
}

function LanguageGroup<T extends string>({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: ReadonlyArray<{ id: T; shortLabel: string; label: string }>;
  selected: T;
  onSelect: (language: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.languageGroup}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.segments}>
        {options.map((option) => {
          const isSelected = option.id === selected;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={`${title}: ${option.label}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(option.id)}
              style={[styles.segment, isSelected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, isSelected && styles.segmentTextSelected]}>{option.shortLabel}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const HomeMenu = forwardRef<HomeMenuHandle, HomeMenuProps>(function HomeMenu(props, ref) {
  const { t } = useUiText();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotionRef = useRef(false);
  const problem = props.repairNeeded || props.robotError;
  const pinned = problem || screenReader;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (cancelled) return;
      reduceMotionRef.current = value;
    }).catch(() => undefined);
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (!cancelled) setScreenReader(value);
    }).catch(() => undefined);
    const reduceSub = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      reduceMotionRef.current = value;
    });
    const readerSub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      cancelled = true;
      reduceSub.remove();
      readerSub.remove();
    };
  }, []);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
  }, []);

  const fadeTo = useCallback((toValue: 0 | 1, duration: number, onDone?: () => void) => {
    opacity.stopAnimation();
    if (reduceMotionRef.current || duration === 0) {
      opacity.setValue(toValue);
      onDone?.();
      return;
    }
    Animated.timing(opacity, { toValue, duration, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onDone?.();
    });
  }, [opacity]);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (pinnedRef.current || sheetOpenRef.current) return;
      fadeTo(0, FADE_OUT_MS, () => {
        if (!pinnedRef.current) setShown(false);
      });
    }, HIDE_AFTER_MS);
  }, [fadeTo]);

  const reveal = useCallback(() => {
    setShown(true);
    fadeTo(1, FADE_IN_MS);
    scheduleHide();
  }, [fadeTo, scheduleHide]);

  useImperativeHandle(ref, () => ({ reveal }), [reveal]);

  useEffect(() => {
    if (pinned) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      setShown(true);
      fadeTo(1, FADE_IN_MS);
    } else if (shown) {
      scheduleHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setActionsOpen(false);
    setLibraryOpen(false);
    if (!pinnedRef.current) scheduleHide();
  }, [scheduleHide]);

  const openSheet = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setSheetOpen(true);
  }, []);

  const runAfterClose = useCallback((action: () => void, delayMs = 0) => {
    closeSheet();
    if (delayMs <= 0) {
      action();
      return;
    }
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => {
      actionTimerRef.current = null;
      action();
    }, delayMs);
  }, [closeSheet]);

  const swipe = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > SWIPE_DISMISS_DY) closeSheet();
    },
  }), [closeSheet]);

  const robotValue = props.robotLabel;
  const buttonVisible = shown || pinned;

  return (
    <>
      <Animated.View
        pointerEvents={buttonVisible ? "box-none" : "none"}
        style={[styles.buttonHost, { top: insets.top + 12, right: Math.max(insets.right, 0) + 16, opacity }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("home.menu.open")}
          disabled={!buttonVisible}
          hitSlop={4}
          onPress={openSheet}
          style={styles.menuButton}
        >
          <MenuIcon name={{ ios: "line.3.horizontal", android: "menu" }} />
          {problem ? <View style={styles.warningDot} /> : null}
        </Pressable>
      </Animated.View>

      <Modal
        animationType="slide"
        onRequestClose={closeSheet}
        statusBarTranslucent
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        transparent
        visible={sheetOpen}
      >
        <View style={styles.sheetRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("home.menu.close")}
            onPress={closeSheet}
            style={styles.backdrop}
          />
          <View style={[styles.sheet, libraryOpen && styles.librarySheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <View {...swipe.panHandlers} style={styles.sheetHeader}>
              <View style={styles.grabber} />
              <View style={styles.sheetTitleRow}>
                {libraryOpen ? <Pressable accessibilityRole="button" accessibilityLabel={t("characterScene.back")}
                  onPress={() => setLibraryOpen(false)} style={styles.closeButton}>
                  <MenuIcon name={{ ios: "chevron.left", android: "arrow_back" }} color={looiTheme.text} size={18} />
                </Pressable> : null}
                <Text accessibilityRole="header" style={styles.sheetTitle}>{t(libraryOpen ? "characterScene.title" : "home.menu.title")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("home.menu.close")}
                  hitSlop={6}
                  onPress={closeSheet}
                  style={styles.closeButton}
                >
                  <MenuIcon name={{ ios: "xmark", android: "close" }} color={looiTheme.muted} size={18} />
                </Pressable>
              </View>
            </View>
            {libraryOpen ? <CharacterSceneLibrary onSelect={kind => runAfterClose(() => props.onCharacterAction?.(kind), SHEET_ACTION_DELAY_MS)} />
              : <ScrollView bounces={false} contentContainerStyle={styles.sheetContent}>
              {props.repairNeeded ? (
                <MenuRow
                  icon={{ ios: "exclamationmark.triangle.fill", android: "warning" }}
                  label={t("home.modelsNotReady")}
                  value={t("home.repairModels")}
                  accessibilityLabel={`${t("home.modelsNotReady")}. ${t("home.repairModels")}`}
                  onPress={() => runAfterClose(props.onRepair)}
                  warning
                />
              ) : null}
              {props.robotError ? (
                <MenuRow
                  icon={{ ios: "exclamationmark.triangle.fill", android: "warning" }}
                  label={t("home.menu.robot")}
                  value={robotValue}
                  onPress={() => runAfterClose(props.onRobot)}
                  disabled={props.robotDisabled}
                  warning
                />
              ) : null}
              {props.robotError ? null : (
                <MenuRow
                  icon={{ ios: "antenna.radiowaves.left.and.right", android: "bluetooth" }}
                  label={t("home.menu.robot")}
                  value={robotValue}
                  accessibilityLabel={`${t("home.menu.robot")}: ${robotValue}`}
                  onPress={() => runAfterClose(props.onRobot)}
                  disabled={props.robotDisabled}
                />
              )}
              <View style={styles.languageBlock}>
                <View style={styles.languageHeading}>
                  <MenuIcon name={{ ios: "globe", android: "language" }} />
                  <Text style={styles.rowLabel}>{t("home.menu.language")}</Text>
                </View>
                <LanguageGroup
                  title={t("home.menu.listensTo")}
                  options={LISTENING_LANGUAGE_OPTIONS}
                  selected={props.listeningLanguage}
                  onSelect={props.onSelectListeningLanguage}
                />
                <LanguageGroup
                  title={t("home.menu.answersIn")}
                  options={RESPONSE_LANGUAGE_OPTIONS}
                  selected={props.responseLanguage}
                  onSelect={props.onSelectResponseLanguage}
                />
              </View>
              <MenuRow
                icon={{ ios: "photo.on.rectangle", android: "photo_library" }}
                label={t("home.menu.photo")}
                value={props.photoBusy ? "…" : undefined}
                accessibilityLabel={t("home.choosePhotosA11y")}
                disabled={props.photoBusy}
                onPress={() => runAfterClose(props.onPhoto, SHEET_ACTION_DELAY_MS)}
              />
              <MenuRow
                icon={{ ios: "viewfinder", android: "center_focus_strong" }}
                label={t("home.menu.object")}
                onPress={() => runAfterClose(props.onObject, SHEET_ACTION_DELAY_MS)}
              />
              <MenuRow
                icon={{ ios: "message.fill", android: "chat" }}
                label={t("nav.conversations")}
                onPress={() => runAfterClose(props.onConversations)}
              />
              <MenuRow
                icon={{ ios: "brain.head.profile", android: "psychology" }}
                label={t("nav.memory")}
                onPress={() => runAfterClose(props.onMemory)}
              />
              <MenuRow
                icon={{ ios: "square.grid.2x2.fill", android: "apps" }}
                label={t("nav.apps")}
                onPress={() => runAfterClose(props.onApps)}
              />
              {props.onCharacterAction ? <>
                <MenuRow propIcon="drink" label={t("home.menu.actions")} expanded={actionsOpen}
                  value={actionsOpen ? "−" : "+"} onPress={() => setActionsOpen(value => !value)} />
                {actionsOpen ? CHARACTER_ACTIONS.map(kind => <MenuRow key={kind} propIcon={kind}
                  label={t(`characterAction.${kind}.label`)}
                  onPress={() => runAfterClose(() => props.onCharacterAction?.(kind), SHEET_ACTION_DELAY_MS)} />) : null}
                {actionsOpen ? <MenuRow icon={{ ios: "square.grid.2x2", android: "grid_view" }}
                  label={t("characterScene.browse")} onPress={() => setLibraryOpen(true)} /> : null}
              </> : null}
              <MenuRow
                icon={{ ios: "gearshape.fill", android: "settings" }}
                label={t("nav.settings")}
                accessibilityLabel={t("home.settingsA11y")}
                onPress={() => runAfterClose(props.onSettings)}
              />
            </ScrollView>}
          </View>
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  buttonHost: {
    position: "absolute",
    zIndex: 20,
  },
  menuButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "rgba(3, 13, 24, 0.84)",
    alignItems: "center",
    justifyContent: "center",
  },
  warningDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: looiTheme.warn,
    borderWidth: 1.5,
    borderColor: looiTheme.bg,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    alignSelf: "center",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: looiTheme.lineActive,
    backgroundColor: looiTheme.bgRaised,
    paddingHorizontal: 16,
  },
  librarySheet: { height: "92%" },
  sheetHeader: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: looiTheme.line,
    marginBottom: 6,
  },
  sheetTitleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: looiTheme.text,
    fontSize: 20,
    fontWeight: "800",
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: looiTheme.whiteSoft,
  },
  sheetContent: {
    gap: 8,
    paddingBottom: 4,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    paddingHorizontal: 16,
    backgroundColor: looiTheme.whiteSoft,
  },
  rowWarning: {
    borderWidth: 1,
    borderColor: looiTheme.warn,
    backgroundColor: "rgba(255, 209, 102, 0.12)",
  },
  rowDisabled: {
    opacity: 0.6,
  },
  rowPressed: {
    backgroundColor: "rgba(40, 213, 255, 0.16)",
  },
  rowLabel: {
    flex: 1,
    color: looiTheme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  rowLabelWarning: {
    color: looiTheme.warn,
  },
  rowValue: {
    flexShrink: 1,
    maxWidth: "55%",
    color: looiTheme.muted,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  languageBlock: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    backgroundColor: looiTheme.whiteSoft,
  },
  languageHeading: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  languageGroup: {
    gap: 8,
  },
  groupTitle: {
    color: looiTheme.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  segments: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: looiTheme.line,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: looiTheme.cyan,
    borderColor: looiTheme.cyan,
  },
  segmentText: {
    color: looiTheme.text,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  segmentTextSelected: {
    color: looiTheme.bg,
  },
});
