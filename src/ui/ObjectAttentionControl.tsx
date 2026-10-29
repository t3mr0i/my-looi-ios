import { useReducedInterfaceMotion } from "./use-reduced-interface-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import regularSymbolWeight from "expo-symbols/androidWeights/regular";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useObjectAttentionStore, startObjectAttentionSelection, selectObjectAttention, stopObjectAttention } from "@/src/core/object-attention";
import { getObjectActivityReferenceCandidate, isObjectActivityReferenceCurrent, type ObjectActivityReferenceCandidate } from "@/src/core/object-activity-reference";
import { useBehaviorStore } from "@/src/behavior/behavior-runtime";
import { containedImageRect, selectionRect } from "@/src/core/object-attention-policy";
import { createObjectAttentionTranslator, type ObjectAttentionStringKey } from "@/src/i18n/object-attention-strings";
import { useUiText } from "@/src/i18n/use-ui-text";
import type { LocalObjectPreviewEvent, LocalObjectRect } from "../../modules/local-face-attention";
import { looiTheme } from "@/src/ui/looi-theme";
import { createSelectionGesturePin, type PinnedObjectAttentionSelection, type ResolvedObjectAttentionSelection } from "./object-attention-gesture";

type Point = { x: number; y: number };
type ImageBounds = { x: number; y: number; width: number; height: number };
type Preview = LocalObjectPreviewEvent;
type Status = ReturnType<typeof useObjectAttentionStore.getState>["status"];

function reasonCopy(reason: string | null, status: Status): ObjectAttentionStringKey | null {
  switch (reason) {
    case "camera-disabled": return "reasonCameraDisabled";
    case "permission-denied": return "reasonPermissionDenied";
    case "unsupported": return "reasonUnsupported";
    case "busy": return "reasonBusy";
    case "unavailable": return "reasonUnavailable";
    case "selection-stale": return "selectionStale";
    case "activity-reference-changed": return "activityReferenceChanged";
    case "activity-reference-unavailable": return "activityReferenceUnavailable";
    case "selection-failed":
    case "selection-invalid":
    case "tracking-failed": return "selectionFailed";
    case "selection-unavailable": return "reasonUnavailable";
    case "selection-timeout": return "reasonSelectionTimeout";
    case "selection_timeout": return "reasonSelectionTimeout";
    case "tracking-timeout":
    case "tracking_timeout": return "reasonTrackingWindowEnded";
    case "timeout":
      return "reasonTimeout";
    case "lost": return "reasonLost";
    case "frame-gap":
    case "low-confidence":
    case "invalid-bounds":
    case "implausible-change":
    case "implausible-motion":
    case "native-lost":
    case "native-ended":
    case "object-lost":
    case "not-found": return "reasonLost";
    case "interrupted": return "reasonInterrupted";
    case "cancelled":
    case "stopped": return "reasonEnded";
    case "error": return "reasonError";
    default:
      if (status === "lost") return "reasonLost";
      if (status === "ended" && reason) return "reasonInterrupted";
      return reason ? "reasonError" : null;
  }
}

function selectionResultCopy(reason: string | null, status: Status): ObjectAttentionStringKey {
  if (reason === "selection-stale") return "selectionStale";
  if (reason === "activity-reference-changed") return "activityReferenceChanged";
  if (reason === "activity-reference-unavailable") return "activityReferenceUnavailable";
  if (reason === "selection-failed" || reason === "selection-invalid" || reason === "tracking-failed") return "selectionFailed";
  if (reason === "selection-unavailable") return "reasonUnavailable";
  return reasonCopy(reason, status) ?? "selectionFailed";
}

function pointFromEvent(event: GestureResponderEvent): Point {
  return { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
}

function getDragEnd(event: GestureResponderEvent, gesture: PanResponderGestureState, start: Point): Point {
  const x = event.nativeEvent.locationX;
  const y = event.nativeEvent.locationY;
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return { x: start.x + gesture.dx, y: start.y + gesture.dy };
}

export function ObjectAttentionControl({ hideTrigger = false, openRequest = 0 }: { hideTrigger?: boolean; openRequest?: number } = {}) {
  const reducedMotion = useReducedInterfaceMotion();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const landscape = screenWidth > screenHeight;
  const safeAreaInsets = useSafeAreaInsets();
  const backdropVerticalPadding = landscape ? 12 : 24;
  const dialogMaxHeight = Math.max(200, screenHeight - safeAreaInsets.top - safeAreaInsets.bottom - backdropVerticalPadding);
  const dialogMinHeight = landscape ? 0 : Math.min(360, dialogMaxHeight);
  const { language } = useUiText();
  const router = useRouter();
  const t = useMemo(() => createObjectAttentionTranslator(language), [language]);
  const state = useObjectAttentionStore((snapshot) => snapshot);
  const behaviorState = useBehaviorStore((snapshot) => snapshot.state);
  const behaviorMode = useBehaviorStore((snapshot) => snapshot.settings.mode);
  const eligibleActivityReference = useMemo(
    () => getObjectActivityReferenceCandidate(behaviorState, behaviorMode),
    [behaviorMode, behaviorState],
  );
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [displayedPreview, setDisplayedPreview] = useState<Preview | null>(null);
  const [gesturePin, setGesturePin] = useState<PinnedObjectAttentionSelection | null>(null);
  const [draftRect, setDraftRect] = useState<LocalObjectRect | null>(null);
  const [selectionFeedback, setSelectionFeedback] = useState<ObjectAttentionStringKey | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [activityReference, setActivityReference] = useState<ObjectActivityReferenceCandidate | null>(null);
  const activityReferenceStale = activityReference !== null
    && !isObjectActivityReferenceCurrent(activityReference, behaviorState, behaviorMode);
  const gestureStart = useRef<Point | null>(null);
  const activityReferenceRef = useRef<ObjectActivityReferenceCandidate | null>(null);
  const gesturePinRef = useRef(createSelectionGesturePin());
  const displayedPreviewRef = useRef<Preview | null>(null);
  const stageSizeRef = useRef(stageSize);
  const statusRef = useRef<Status>(state.status);

  const liveImageBounds = useMemo(() => state.preview
    ? containedImageRect(stageSize.width, stageSize.height, state.preview.width, state.preview.height)
    : null, [stageSize.height, stageSize.width, state.preview]);
  const visibleGesturePin = state.status === "selecting" || state.status === "starting" ? gesturePin : null;
  const visiblePreview = visibleGesturePin?.preview ?? state.preview;
  const imageBounds = visibleGesturePin?.imageBounds ?? liveImageBounds;
  const latestFrameDisplayed = Boolean(state.preview && displayedPreview?.frameId === state.preview.frameId);
  const visibleFrameDisplayed = Boolean(visiblePreview && displayedPreview?.frameId === visiblePreview.frameId);
  const previewHeight = visibleGesturePin?.stageSize.height ?? (state.preview
    ? landscape
      ? Math.max(96, Math.min(150, screenHeight * 0.34))
      : Math.max(180, Math.min(420, screenHeight * 0.45))
    : landscape ? 96 : Math.max(140, Math.min(180, screenHeight * 0.24)));

  const clearGesturePin = useCallback((clearLatest = false) => {
    gestureStart.current = null;
    gesturePinRef.current.clear();
    if (clearLatest) gesturePinRef.current.updateLatest(null);
    setGesturePin(null);
    setDraftRect(null);
  }, []);

  useEffect(() => {
    stageSizeRef.current = stageSize;
  }, [stageSize]);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    displayedPreviewRef.current = displayedPreview;
  }, [displayedPreview]);

  useEffect(() => {
    if (state.status === "tracking" || state.status === "lost") {
      setSelectionOpen(false);
      setSelectionBusy(false);
    }
    if (state.status === "tracking" || state.status === "lost" || state.status === "ended" || state.status === "error" || state.status === "unsupported") {
      clearGesturePin(true);
      displayedPreviewRef.current = null;
      setDisplayedPreview(null);
    }
  }, [clearGesturePin, state.status]);

  useEffect(() => {
    const currentPreview = state.preview;
    if (state.status !== "selecting" || !currentPreview || !displayedPreview || currentPreview.frameId !== displayedPreview.frameId) {
      gesturePinRef.current.updateLatest(null);
      return;
    }
    const bounds = containedImageRect(stageSize.width, stageSize.height, displayedPreview.width, displayedPreview.height);
    gesturePinRef.current.updateLatest(bounds ? { preview: displayedPreview, stageSize, imageBounds: bounds } : null);
  }, [displayedPreview, stageSize, state.preview, state.status]);

  useEffect(() => () => {
    gestureStart.current = null;
    gesturePinRef.current.clear();
    gesturePinRef.current.updateLatest(null);
    displayedPreviewRef.current = null;
    stopObjectAttention();
  }, []);

  const openSelection = useCallback(async () => {
    clearGesturePin(true);
    activityReferenceRef.current = null;
    setActivityReference(null);
    setSelectionFeedback(null);
    setDisplayedPreview(null);
    displayedPreviewRef.current = null;
    setSelectionOpen(true);
    try {
      await startObjectAttentionSelection();
    } catch {
      setSelectionFeedback("reasonError");
    }
  }, [clearGesturePin]);

  const handledOpenRequestRef = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handledOpenRequestRef.current) return;
    handledOpenRequestRef.current = openRequest;
    void openSelection();
  }, [openRequest, openSelection]);

  const closeSelection = useCallback(() => {
    setSelectionOpen(false);
    setSelectionBusy(false);
    activityReferenceRef.current = null;
    setActivityReference(null);
    clearGesturePin(true);
    displayedPreviewRef.current = null;
    setDisplayedPreview(null);
    stopObjectAttention();
  }, [clearGesturePin]);

  const submitSelection = useCallback(async (selection: ResolvedObjectAttentionSelection) => {
    if (statusRef.current !== "selecting") return;
    if (!selection.rect) {
      setSelectionFeedback("selectionFailed");
      return;
    }
    const selectedActivityReference = activityReferenceRef.current;
    const behaviorSnapshot = useBehaviorStore.getState();
    if (selectedActivityReference && !isObjectActivityReferenceCurrent(
      selectedActivityReference,
      behaviorSnapshot.state,
      behaviorSnapshot.settings.mode,
    )) {
      setSelectionFeedback("activityReferenceStale");
      return;
    }
    setDraftRect(selection.rect);
    setSelectionFeedback(null);
    setSelectionBusy(true);
    try {
      const accepted = await selectObjectAttention(selection.frameId, selection.rect, selectedActivityReference ?? undefined);
      if (accepted) {
        if (activityReferenceRef.current === selectedActivityReference) {
          activityReferenceRef.current = null;
          setActivityReference(null);
        }
      } else {
        const current = useObjectAttentionStore.getState();
        setSelectionFeedback(selectionResultCopy(current.reason, current.status));
      }
    } catch {
      const current = useObjectAttentionStore.getState();
      setSelectionFeedback(selectionResultCopy(current.reason, current.status));
    } finally {
      setSelectionBusy(false);
    }
  }, []);

  const toggleActivityReference = useCallback(() => {
    if (selectionBusy || statusRef.current === "starting") return;
    setSelectionFeedback(null);
    if (activityReferenceRef.current) {
      activityReferenceRef.current = null;
      setActivityReference(null);
      return;
    }
    if (!eligibleActivityReference) return;
    const captured = { ...eligibleActivityReference };
    activityReferenceRef.current = captured;
    setActivityReference(captured);
  }, [eligibleActivityReference, selectionBusy]);

  const interactionRef = useRef({
    canSelect: false,
    begin: (_start: Point) => null as PinnedObjectAttentionSelection | null,
    submit: (_selection: ResolvedObjectAttentionSelection) => {},
    updateDraft: (_start: Point, _end: Point) => {},
  });
  interactionRef.current = {
    canSelect: selectionOpen && state.status === "selecting" && latestFrameDisplayed && !selectionBusy && !activityReferenceStale,
    begin: (start) => {
      const preview = displayedPreviewRef.current;
      const current = useObjectAttentionStore.getState();
      const size = stageSizeRef.current;
      if (!preview || current.status !== "selecting" || current.preview?.frameId !== preview.frameId) return null;
      const bounds = containedImageRect(size.width, size.height, preview.width, preview.height);
      if (!bounds) return null;
      gesturePinRef.current.updateLatest({ preview, stageSize: size, imageBounds: bounds });
      const pin = gesturePinRef.current.begin();
      if (!pin) return null;
      setGesturePin(pin);
      setDraftRect(null);
      return pin;
    },
    submit: (selection) => { void submitSelection(selection); },
    updateDraft: (start, end) => {
      const pin = gesturePinRef.current.current();
      if (!pin) return;
      const next = selectionRect(start, end, pin.imageBounds);
      if (next) setDraftRect(next);
    },
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => interactionRef.current.canSelect,
    onMoveShouldSetPanResponder: (_event, gesture) => interactionRef.current.canSelect && (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3),
    onPanResponderGrant: (event) => {
      const start = pointFromEvent(event);
      const pin = interactionRef.current.begin(start);
      if (!pin) return;
      gestureStart.current = start;
      interactionRef.current.updateDraft(start, start);
    },
    onPanResponderMove: (event, gesture) => {
      const start = gestureStart.current;
      if (start) interactionRef.current.updateDraft(start, getDragEnd(event, gesture, start));
    },
    onPanResponderRelease: (event, gesture) => {
      const start = gestureStart.current;
      gestureStart.current = null;
      const resolved = start ? gesturePinRef.current.resolve(start, getDragEnd(event, gesture, start)) : null;
      setGesturePin(null);
      if (resolved) interactionRef.current.submit(resolved);
      else {
        setDraftRect(null);
        if (start && statusRef.current === "selecting") setSelectionFeedback("selectionFailed");
      }
    },
    onPanResponderTerminate: () => {
      gestureStart.current = null;
      gesturePinRef.current.clear();
      setGesturePin(null);
      setDraftRect(null);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  const chooseCenter = useCallback(() => {
    const preview = displayedPreviewRef.current;
    const size = stageSizeRef.current;
    const current = useObjectAttentionStore.getState();
    if (!preview || current.status !== "selecting" || current.preview?.frameId !== preview.frameId) return;
    const bounds = containedImageRect(size.width, size.height, preview.width, preview.height);
    if (!bounds) return;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const rect = selectionRect(center, center, bounds);
    if (rect) void submitSelection({ frameId: preview.frameId, rect });
  }, [submitSelection]);

  const openSettings = useCallback(() => {
    closeSelection();
    router.push("/settings");
  }, [closeSelection, router]);

  const isSelecting = state.status === "preparing" || state.status === "selecting" || state.status === "starting";
  const reasonKey = reasonCopy(state.reason, state.status);
  const retryAvailable = state.status === "lost"
    || (state.status === "ended" && !!state.reason && !["cancelled", "stopped", "replaced"].includes(state.reason));
  const activeLabelWidth = Math.max(46, Math.min(190, screenWidth - 72 - 164));
  const activityTrackingTitle = state.status === "tracking" ? state.activityReference?.title : undefined;
  const trackingLabel = activityTrackingTitle
    ? t("followingRegionFor", { title: activityTrackingTitle })
    : t("tracking");
  const canShowActivityReference = selectionOpen
    && (state.status === "preparing" || state.status === "selecting" || state.status === "starting"
      || (activityReference !== null && (state.reason === "activity-reference-changed" || state.reason === "activity-reference-unavailable")));
  const activityReferenceLabel = canShowActivityReference
    ? activityReference ?? eligibleActivityReference
    : null;
  const activityReferenceHint = activityReferenceStale ? "activityReferenceStale" : "activityReferenceTemporary";
  const activityReferenceDisabled = selectionBusy || state.status === "starting";
  const draftStyle = draftRect && imageBounds ? {
    left: imageBounds.x + draftRect.left * imageBounds.width,
    top: imageBounds.y + draftRect.top * imageBounds.height,
    width: Math.max(2, (draftRect.right - draftRect.left) * imageBounds.width),
    height: Math.max(2, (draftRect.bottom - draftRect.top) * imageBounds.height),
  } : null;

  return (
    <>
      {state.status === "tracking" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${trackingLabel}. ${t("stop")}`}
          onPress={stopObjectAttention}
          style={[styles.trackingAccessory, { width: activeLabelWidth }]}
        >
          <SymbolView name={{ ios: "stop.fill", android: "stop" }} size={15} tintColor={looiTheme.cyan} weight={{ ios: "semibold", android: regularSymbolWeight }} />
          {activeLabelWidth > 92 ? <Text numberOfLines={1} style={styles.accessoryText}>{trackingLabel}</Text> : null}
        </Pressable>
      ) : retryAvailable ? (
        <View style={[styles.lostAccessory, { maxWidth: Math.max(108, Math.min(205, screenWidth - 72 - 164)) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t(reasonKey ?? "lost")}. ${t("retry")}`} onPress={() => void openSelection()} style={styles.lostRetry}>
            <SymbolView name={{ ios: "arrow.clockwise", android: "refresh" }} size={15} tintColor={looiTheme.warn} weight={{ ios: "semibold", android: regularSymbolWeight }} />
            <Text numberOfLines={1} style={styles.lostText}>{t(state.status === "ended" ? "ended" : "lost")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("stop")} onPress={stopObjectAttention} style={styles.dismissButton}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={15} tintColor={looiTheme.muted} weight={{ ios: "semibold", android: regularSymbolWeight }} />
          </Pressable>
        </View>
      ) : !isSelecting && !hideTrigger ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("selectObjectA11y")}
          onPress={() => void openSelection()}
          style={styles.launchButton}
        >
          <SymbolView
            name={{ ios: "viewfinder", android: "center_focus_strong" }}
            size={21}
            tintColor={looiTheme.cyan}
            weight={{ ios: "semibold", android: regularSymbolWeight }}
            fallback={<View style={styles.viewfinderFallback}><View style={styles.viewfinderCornerTopLeft} /><View style={styles.viewfinderCornerTopRight} /><View style={styles.viewfinderCornerBottomLeft} /><View style={styles.viewfinderCornerBottomRight} /></View>}
          />
        </Pressable>
      ) : null}

      <Modal animationType={reducedMotion ? "none" : "fade"} onRequestClose={closeSelection} statusBarTranslucent transparent visible={selectionOpen}>
        <SafeAreaView edges={["top", "bottom"]} style={styles.modalSafeArea}>
        <View style={[styles.backdrop, landscape && styles.backdropLandscape]}>
          <ScrollView
            accessibilityViewIsModal
            bounces={!landscape}
            contentContainerStyle={styles.dialogContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={[styles.dialog, { maxHeight: dialogMaxHeight, minHeight: dialogMinHeight }]}
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t("title")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("close")} onPress={closeSelection} style={styles.closeButton}>
                <SymbolView name={{ ios: "xmark", android: "close" }} size={17} tintColor={looiTheme.text} weight={{ ios: "semibold", android: regularSymbolWeight }} />
              </Pressable>
            </View>
            <Text style={styles.instruction}>{t("instruction")}</Text>
            {activityReferenceLabel ? (
              <Pressable
                accessibilityHint={t(activityReferenceHint)}
                accessibilityLabel={t("useSelectedRegionFor", { title: activityReferenceLabel.title })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: activityReference !== null, disabled: activityReferenceDisabled }}
                disabled={activityReferenceDisabled}
                onPress={toggleActivityReference}
                style={[styles.activityReferenceOption, activityReferenceDisabled && styles.buttonDisabled]}
              >
                <SymbolView
                  name={activityReference ? { ios: "checkmark.square.fill", android: "check_box" } : { ios: "square", android: "check_box_outline_blank" }}
                  size={22}
                  tintColor={activityReference ? looiTheme.cyan : looiTheme.muted}
                  weight={{ ios: "semibold", android: regularSymbolWeight }}
                />
                <View style={styles.activityReferenceCopy}>
                  <Text style={styles.activityReferenceLabel}>{t("useSelectedRegionFor", { title: activityReferenceLabel.title })}</Text>
                  <Text style={[styles.activityReferenceHint, activityReferenceStale && styles.activityReferenceStaleHint]}>{t(activityReferenceHint)}</Text>
                </View>
              </Pressable>
            ) : null}
            <View
              onLayout={(event) => {
                const nextSize = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
                const pin = gesturePinRef.current.current();
                if (pin && (pin.stageSize.width !== nextSize.width || pin.stageSize.height !== nextSize.height)) clearGesturePin();
                stageSizeRef.current = nextSize;
                setStageSize(nextSize);
              }}
              style={[styles.previewStage, { height: previewHeight }]}
              {...responder.panHandlers}
            >
              {visiblePreview && imageBounds && (state.status === "selecting" || state.status === "starting") ? (
                <Image
                  accessibilityLabel={t("title")}
                  accessible
                  cachePolicy="none"
                  contentFit="fill"
                  onLoad={() => {
                    const loaded = visiblePreview;
                    const current = useObjectAttentionStore.getState();
                    const pin = gesturePinRef.current.current();
                    const isCurrentFrame = current.preview?.frameId === loaded?.frameId;
                    const isPinnedFrame = pin?.preview.frameId === loaded?.frameId;
                    if (loaded && (current.status === "selecting" || current.status === "starting") && (isCurrentFrame || isPinnedFrame)) {
                      const previousFrameId = displayedPreviewRef.current?.frameId;
                      displayedPreviewRef.current = loaded;
                      setDisplayedPreview(loaded);
                      if (isCurrentFrame) {
                        if (current.status === "selecting") {
                          const size = stageSizeRef.current;
                          const bounds = containedImageRect(size.width, size.height, loaded.width, loaded.height);
                          gesturePinRef.current.updateLatest(bounds ? { preview: loaded, stageSize: size, imageBounds: bounds } : null);
                        }
                        if (previousFrameId !== loaded.frameId) setSelectionFeedback(null);
                      }
                    }
                  }}
                  recyclingKey={visiblePreview.frameId}
                  source={{ uri: visiblePreview.dataUrl }}
                  style={[styles.previewImage, { left: imageBounds.x, top: imageBounds.y, width: imageBounds.width, height: imageBounds.height }]}
                  transition={0}
                />
              ) : null}
              {draftStyle ? <View pointerEvents="none" style={[styles.selectionBox, draftStyle]} /> : null}
              {state.status === "preparing" || state.status === "starting" || (state.status === "selecting" && !visibleFrameDisplayed) ? (
                <View pointerEvents="none" style={styles.previewWaiting}>
                  <ActivityIndicator color={looiTheme.cyan} />
                  <Text style={styles.waitingText}>{t(state.status === "starting" ? "selectionStarting" : "previewStarting")}</Text>
                </View>
              ) : !state.preview ? (
                <View pointerEvents="none" style={styles.previewWaiting}><Text style={styles.waitingText}>{t("previewUnavailable")}</Text></View>
              ) : null}
            </View>
            {selectionFeedback || reasonKey ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{t(selectionFeedback ?? reasonKey!)}</Text> : null}
            <Text style={styles.privacyNote}>{t("notSaved")}</Text>
            {state.status === "error" || state.status === "unsupported" || state.status === "ended" ? (
              <View style={[styles.recoveryActions, landscape && styles.recoveryActionsLandscape]}>
                <Pressable accessibilityRole="button" onPress={() => void openSelection()} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>{t("tryAgain")}</Text>
                </Pressable>
                {state.reason === "camera-disabled" || state.reason === "permission-denied" ? (
                  <Pressable accessibilityRole="button" onPress={openSettings} style={styles.settingsAction}>
                    <Text style={styles.settingsActionText}>{t("settings")}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={closeSelection} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>{t("cancel")}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.footer, landscape && styles.footerLandscape]}>
                <Pressable accessibilityRole="button" disabled={!latestFrameDisplayed || selectionBusy || state.status !== "selecting" || activityReferenceStale} onPress={chooseCenter} style={[styles.centerButton, landscape && styles.centerButtonLandscape, (!latestFrameDisplayed || selectionBusy || state.status !== "selecting" || activityReferenceStale) && styles.buttonDisabled]}>
                  <Text style={styles.centerButtonText}>{t("centerSelection")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={closeSelection} style={[styles.cancelButton, landscape && styles.cancelButtonLandscape]}>
                  <Text style={styles.cancelButtonText}>{t("cancel")}</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launchButton: {
    position: "absolute",
    left: 72,
    bottom: 18,
    zIndex: 8,
    width: 46,
    height: 46,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: looiTheme.line,
    backgroundColor: "rgba(3, 13, 24, 0.84)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewfinderFallback: { width: 20, height: 20 },
  viewfinderCornerTopLeft: { position: "absolute", top: 0, left: 0, width: 7, height: 7, borderTopWidth: 2, borderLeftWidth: 2, borderColor: looiTheme.cyan },
  viewfinderCornerTopRight: { position: "absolute", top: 0, right: 0, width: 7, height: 7, borderTopWidth: 2, borderRightWidth: 2, borderColor: looiTheme.cyan },
  viewfinderCornerBottomLeft: { position: "absolute", bottom: 0, left: 0, width: 7, height: 7, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: looiTheme.cyan },
  viewfinderCornerBottomRight: { position: "absolute", bottom: 0, right: 0, width: 7, height: 7, borderBottomWidth: 2, borderRightWidth: 2, borderColor: looiTheme.cyan },
  trackingAccessory: {
    position: "absolute",
    left: 72,
    bottom: 18,
    zIndex: 8,
    minHeight: 46,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: looiTheme.lineActive,
    backgroundColor: "rgba(3, 13, 24, 0.9)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  accessoryText: { flexShrink: 1, color: looiTheme.cyan, fontSize: 11, fontWeight: "700" },
  lostAccessory: {
    position: "absolute",
    left: 72,
    bottom: 18,
    zIndex: 8,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 209, 102, 0.45)",
    backgroundColor: "rgba(3, 13, 24, 0.9)",
    overflow: "hidden",
  },
  lostRetry: { minHeight: 46, flex: 1, minWidth: 0, paddingLeft: 12, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 7 },
  lostText: { flexShrink: 1, color: looiTheme.warn, fontSize: 11, fontWeight: "700" },
  dismissButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  modalSafeArea: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.82)" },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backdropLandscape: { paddingHorizontal: 10, paddingVertical: 6 },
  dialog: { flexGrow: 1, flexShrink: 1, width: "100%", maxWidth: 620, alignSelf: "center", borderRadius: 22, borderWidth: 1, borderColor: looiTheme.lineActive, backgroundColor: looiTheme.bgRaised, overflow: "hidden" },
  dialogContent: { flexGrow: 1, padding: 18 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, color: looiTheme.text, fontSize: 22, fontWeight: "800" },
  closeButton: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: looiTheme.whiteSoft },
  instruction: { marginTop: 2, marginBottom: 10, color: looiTheme.muted, fontSize: 14, lineHeight: 20 },
  activityReferenceOption: { minHeight: 52, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: looiTheme.line, backgroundColor: looiTheme.whiteSoft, flexDirection: "row", alignItems: "center", gap: 10 },
  activityReferenceCopy: { flex: 1, minWidth: 0, gap: 2 },
  activityReferenceLabel: { color: looiTheme.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  activityReferenceHint: { color: looiTheme.muted, fontSize: 11, lineHeight: 15 },
  activityReferenceStaleHint: { color: looiTheme.warn },
  previewStage: { flexGrow: 1, flexShrink: 0, minHeight: 96, borderRadius: 16, overflow: "hidden", backgroundColor: "#010407", borderWidth: 1, borderColor: looiTheme.line, alignItems: "center", justifyContent: "center" },
  previewImage: { position: "absolute" },
  selectionBox: { position: "absolute", borderWidth: 2, borderColor: looiTheme.cyan, backgroundColor: "rgba(40, 213, 255, 0.14)" },
  previewWaiting: { alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 12 },
  waitingText: { color: looiTheme.muted, textAlign: "center", fontSize: 14, lineHeight: 20 },
  errorText: { marginTop: 8, color: looiTheme.warn, fontSize: 13, lineHeight: 18 },
  privacyNote: { marginTop: 6, color: looiTheme.muted, fontSize: 11, lineHeight: 16 },
  footer: { marginTop: 10, gap: 6 },
  footerLandscape: { flexDirection: "row", alignItems: "center", gap: 8 },
  centerButton: { minHeight: 48, paddingHorizontal: 12, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(40, 213, 255, 0.14)", borderWidth: 1, borderColor: looiTheme.lineActive },
  centerButtonLandscape: { flex: 1, minHeight: 44 },
  centerButtonText: { color: looiTheme.cyan, fontSize: 14, fontWeight: "800", textAlign: "center" },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelButtonLandscape: { minWidth: 76, paddingHorizontal: 8 },
  cancelButtonText: { color: looiTheme.muted, fontSize: 14, fontWeight: "700" },
  recoveryActions: { marginTop: 10, gap: 6 },
  recoveryActionsLandscape: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  retryButton: { minHeight: 44, minWidth: 88, paddingHorizontal: 12, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(40, 213, 255, 0.14)", borderWidth: 1, borderColor: looiTheme.lineActive },
  retryButtonText: { color: looiTheme.cyan, fontSize: 13, fontWeight: "800" },
  settingsAction: { minHeight: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  settingsActionText: { color: looiTheme.cyan, fontSize: 12, fontWeight: "700", textAlign: "center" },
  buttonDisabled: { opacity: 0.48 },
});
