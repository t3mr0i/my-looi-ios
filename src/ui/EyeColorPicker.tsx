import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { resolveFaceExpression } from "@/src/character/face-expression";
import { GLASS_PALETTES } from "@/src/character/glass-face";
import {
  FACE_STYLES,
  FACE_PALETTES,
  getFaceAppearanceMetrics,
  resolveStyledMouth,
} from "@/src/character/face-appearance";
import { FaceDecorations } from "@/src/ui/FaceDecorations";
import type { CharacterMotionFrame } from "@/src/character/character-choreography";
import type { FacePaletteId, FaceStyleId } from "@/src/store/user";
import { GlassEye, GlassMouth } from "@/src/ui/GlassFace";
import { looiTheme } from "@/src/ui/looi-theme";

const previewExpression = resolveFaceExpression("attention", "", null);

/** A static view of the production material; it owns no voice or robot state. */
function EyeColorPreview({
  paletteId,
  faceStyleId,
}: {
  paletteId: FacePaletteId;
  faceStyleId: FaceStyleId;
}) {
  const faceStyle = FACE_STYLES[faceStyleId];
  const visualPalette = FACE_PALETTES[paletteId];
  const metrics = getFaceAppearanceMetrics(faceStyle);
  const mouth = resolveStyledMouth(previewExpression, faceStyle);
  const [availableWidth, setAvailableWidth] = useState(280);
  const scale = Math.min(0.75, Math.max(0.3, (availableWidth - 24) / 360));
  const blink = useSharedValue(1);
  const gaze = useSharedValue({ x: 0, y: 0 });
  const pulse = useSharedValue(0);
  const actionMotion = useSharedValue<CharacterMotionFrame | null>(null);
  return (
    <View
      style={styles.preview}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
    >
      <View style={[styles.stage, { transform: [{ scale }] }]}>
        <FaceDecorations
          faceStyle={faceStyle}
          palette={visualPalette}
          metrics={metrics}
          isAvatar={false}
        />
        <View
          style={[
            styles.eyes,
            {
              top: metrics.eyeTop,
              gap: metrics.eyeGap,
            },
          ]}
        >
          {(["left", "right"] as const).map((side) => (
            <GlassEye
              key={side}
              side={side}
              expression={previewExpression}
              width={metrics.eyeWidth}
              height={metrics.eyeHeight}
              rotationOffset={
                side === "left"
                  ? faceStyle.leftEyeRotationOffset
                  : faceStyle.rightEyeRotationOffset
              }
              paletteId={paletteId}
              primaryColor={visualPalette.eyeColor}
              blink={blink}
              gaze={gaze}
              isAvatar={false}
              motionActive={false}
            />
          ))}
        </View>
        <GlassMouth
          shape={mouth.shape}
          width={mouth.width}
          color={visualPalette.mouthColor}
          paletteId={paletteId}
          pulse={pulse}
          actionMotion={actionMotion}
          isAvatar={false}
          motionActive={false}
          transitionMs={0}
        />
      </View>
    </View>
  );
}

export function EyeColorPicker({
  value,
  faceStyleId = "classic",
  options,
  label,
  onChange,
}: {
  value: FacePaletteId;
  faceStyleId?: FaceStyleId;
  options: readonly { id: FacePaletteId; label: string }[];
  label: string;
  onChange: (palette: FacePaletteId) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <EyeColorPreview paletteId={value} faceStyleId={faceStyleId} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={styles.options}
      >
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              onPress={() => onChange(option.id)}
              style={({ pressed }) => [styles.option, selected && styles.selected, pressed && { opacity: 0.76 }]}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: GLASS_PALETTES[option.id].moon[1] },
                ]}
              />
              <Text style={styles.optionText}>{option.label}</Text>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  label: { color: looiTheme.text, fontSize: 16, fontWeight: "600" },
  preview: {
    height: 220,
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  stage: { width: 360, height: 260, alignItems: "center" },
  eyes: { position: "absolute", flexDirection: "row" },
  options: { gap: 6 },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: looiTheme.line,
  },
  selected: {
    borderColor: looiTheme.cyan,
    backgroundColor: "rgba(40,213,255,0.07)",
  },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  optionText: { color: looiTheme.text, fontSize: 16, flex: 1, flexShrink: 1 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: looiTheme.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: looiTheme.cyan },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: looiTheme.cyan,
  },
});
