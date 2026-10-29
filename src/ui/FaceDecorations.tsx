import { View, StyleSheet, type ViewStyle } from "react-native";
import Animated, { type useAnimatedStyle } from "react-native-reanimated";
import type {
  FacePaletteVisual,
  FaceStyleVisual,
  getFaceAppearanceMetrics,
} from "@/src/character/face-appearance";

export function FaceDecorations({
  faceStyle,
  palette,
  isAvatar,
  metrics,
  motionStyle,
}: {
  faceStyle: FaceStyleVisual;
  palette: FacePaletteVisual;
  isAvatar: boolean;
  metrics: ReturnType<typeof getFaceAppearanceMetrics>;
  motionStyle?: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
}) {
  return (
    <>
      {faceStyle.decor === "fringe" ? (
        <View
          testID={`face-decor-${faceStyle.decor}`}
          pointerEvents="none"
          style={[styles.capDecor, isAvatar && styles.avatarCapDecor]}
        >
          <View
            style={[
              styles.capCrown,
              isAvatar && styles.avatarCapCrown,
              {
                backgroundColor: palette.accentColor,
                borderColor: palette.eyeShadowColor,
              },
            ]}
          />
          <View
            style={[
              styles.capBrim,
              isAvatar && styles.avatarCapBrim,
              { backgroundColor: palette.eyeShadowColor },
            ]}
          />
        </View>
      ) : null}
      {faceStyle.decor === "cowboy" ? (
        <View
          testID={`face-decor-${faceStyle.decor}`}
          pointerEvents="none"
          style={[styles.cowboyDecor, isAvatar && styles.avatarCowboyDecor]}
        >
          <View
            style={[
              styles.cowboyCrown,
              isAvatar && styles.avatarCowboyCrown,
              {
                backgroundColor: palette.accentColor,
                borderColor: palette.eyeShadowColor,
              },
            ]}
          >
            <View
              style={[
                styles.cowboyBand,
                isAvatar && styles.avatarCowboyBand,
                { backgroundColor: palette.eyeShadowColor },
              ]}
            />
          </View>
          <View
            style={[
              styles.cowboyBrim,
              isAvatar && styles.avatarCowboyBrim,
              {
                backgroundColor: palette.accentColor,
                borderColor: palette.eyeShadowColor,
              },
            ]}
          />
        </View>
      ) : null}
      {faceStyle.decor === "bandana" ? (
        <View
          testID={`face-decor-${faceStyle.decor}`}
          pointerEvents="none"
          style={[styles.bandanaDecor, isAvatar && styles.avatarBandanaDecor]}
        >
          <View
            style={[
              styles.bandanaBand,
              isAvatar && styles.avatarBandanaBand,
              {
                backgroundColor: palette.accentColor,
                borderColor: palette.eyeShadowColor,
              },
            ]}
          />
          <View
            style={[
              styles.bandanaTail,
              styles.bandanaTailOne,
              isAvatar && styles.avatarBandanaTail,
              isAvatar && styles.avatarBandanaTailOne,
              { backgroundColor: palette.eyeShadowColor },
            ]}
          />
          <View
            style={[
              styles.bandanaTail,
              styles.bandanaTailTwo,
              isAvatar && styles.avatarBandanaTail,
              isAvatar && styles.avatarBandanaTailTwo,
              { backgroundColor: palette.accentColor },
            ]}
          />
        </View>
      ) : null}
      {faceStyle.decor === "brows" ? (
        <Animated.View
          testID="face-decor-brows"
          pointerEvents="none"
          style={[
            styles.browRow,
            { gap: metrics.browGap, top: metrics.browTop },
            motionStyle,
          ]}
        >
          <View
            style={[
              styles.brow,
              isAvatar && styles.avatarBrow,
              {
                backgroundColor: palette.accentColor,
                transform: [{ rotate: "-10deg" }],
              },
            ]}
          />
          <View
            style={[
              styles.brow,
              isAvatar && styles.avatarBrow,
              {
                backgroundColor: palette.accentColor,
                transform: [{ rotate: "10deg" }],
              },
            ]}
          />
        </Animated.View>
      ) : null}
      {faceStyle.decor === "lashes" ? (
        <Animated.View
          testID="face-decor-lashes"
          pointerEvents="none"
          style={[
            styles.lashRow,
            { gap: metrics.lashGap, top: metrics.lashTop },
            motionStyle,
          ]}
        >
          <View
            style={[
              styles.lash,
              isAvatar && styles.avatarLash,
              {
                backgroundColor: palette.accentColor,
                transform: [{ rotate: "-28deg" }],
              },
            ]}
          />
          <View
            style={[
              styles.lash,
              isAvatar && styles.avatarLash,
              {
                backgroundColor: palette.accentColor,
                transform: [{ rotate: "28deg" }],
              },
            ]}
          />
        </Animated.View>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  capDecor: {
    position: "absolute",
    top: 5,
    width: 220,
    height: 72,
    alignItems: "center",
    zIndex: 4,
  },
  avatarCapDecor: { top: 3, width: 56, height: 19 },
  capCrown: {
    width: 150,
    height: 50,
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderWidth: 3,
    opacity: 0.96,
  },
  avatarCapCrown: {
    width: 38,
    height: 13,
    borderWidth: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },
  capBrim: {
    position: "absolute",
    bottom: 7,
    width: 176,
    height: 12,
    borderRadius: 999,
    transform: [{ rotate: "-4deg" }],
    opacity: 0.96,
  },
  avatarCapBrim: { bottom: 2, width: 45, height: 3 },
  cowboyDecor: {
    position: "absolute",
    top: -6,
    width: 270,
    height: 82,
    alignItems: "center",
    zIndex: 4,
  },
  avatarCowboyDecor: { top: 0, width: 68, height: 22 },
  cowboyCrown: {
    width: 126,
    height: 58,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderWidth: 3,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-end",
    opacity: 0.96,
  },
  avatarCowboyCrown: {
    width: 32,
    height: 15,
    borderWidth: 1,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  cowboyBand: { width: "100%", height: 12, opacity: 0.95 },
  avatarCowboyBand: { height: 3 },
  cowboyBrim: {
    position: "absolute",
    bottom: 5,
    width: 248,
    height: 15,
    borderRadius: 999,
    borderWidth: 2,
    opacity: 0.96,
  },
  avatarCowboyBrim: { bottom: 1, width: 62, height: 4, borderWidth: 1 },
  bandanaDecor: {
    position: "absolute",
    top: 27,
    width: 238,
    height: 48,
    alignItems: "center",
    zIndex: 4,
  },
  avatarBandanaDecor: { top: 9, width: 60, height: 13 },
  bandanaBand: {
    width: 210,
    height: 22,
    borderRadius: 8,
    borderWidth: 2,
    opacity: 0.95,
  },
  avatarBandanaBand: { width: 53, height: 6, borderRadius: 2, borderWidth: 1 },
  bandanaTail: {
    position: "absolute",
    right: 2,
    top: 16,
    width: 42,
    height: 14,
    borderRadius: 6,
    opacity: 0.92,
  },
  bandanaTailOne: { transform: [{ rotate: "28deg" }] },
  bandanaTailTwo: { top: 26, right: 9, transform: [{ rotate: "52deg" }] },
  avatarBandanaTail: { width: 11, height: 4, borderRadius: 2 },
  avatarBandanaTailOne: { right: 1, top: 4 },
  avatarBandanaTailTwo: { right: 2, top: 7 },
  browRow: {
    position: "absolute",
    flexDirection: "row",
    zIndex: 2,
  },
  brow: { width: 44, height: 7, borderRadius: 999, opacity: 0.78 },
  avatarBrow: { width: 10, height: 2 },
  lashRow: {
    position: "absolute",
    flexDirection: "row",
    zIndex: 3,
  },
  lash: { width: 22, height: 6, borderRadius: 999, opacity: 0.9 },
  avatarLash: { width: 5, height: 2 },
});
