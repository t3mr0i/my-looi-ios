import { useEffect, useId } from "react";
import { View } from "react-native";
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type {
  FaceExpression,
  MouthShape,
} from "@/src/character/face-expression";
import type { CharacterMotionFrame } from "@/src/character/character-choreography";
import { getFaceMotionProfile } from "@/src/character/face-motion";
import {
  getGlassEyeGeometry,
  getGlassEyePose,
  getGlassMouthPath,
  GLASS_PALETTES,
  type GlassMouthPose,
} from "@/src/character/glass-face";
import type { FacePaletteId } from "@/src/store/user";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
export type GlassGaze = { x: number; y: number };

/** A rendering adapter. No timers, stores, perception or competing state machine. */
export function GlassEye({
  side,
  expression,
  width,
  height,
  rotationOffset,
  paletteId,
  primaryColor,
  blink,
  gaze,
  isAvatar,
  motionActive,
}: {
  side: "left" | "right";
  expression: FaceExpression;
  width: number;
  height: number;
  rotationOffset: number;
  paletteId: FacePaletteId;
  primaryColor: string;
  blink: SharedValue<number>;
  gaze: SharedValue<GlassGaze>;
  isAvatar: boolean;
  motionActive: boolean;
}) {
  const id = `glass-${side}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const palette = GLASS_PALETTES[paletteId] ?? GLASS_PALETTES.cyan;
  const unit = isAvatar ? 0.2 : 1;
  const canvas = Math.ceil(Math.hypot(width, height) * 1.5 + 48 * unit);
  const target = getGlassEyePose(expression, side, rotationOffset);
  const shape = useSharedValue(target);
  const transitionMs = getFaceMotionProfile(expression.emotion).eyeTransitionMs;
  useEffect(() => {
    shape.value = motionActive
      ? withTiming(target, {
          duration: transitionMs,
          easing: Easing.out(Easing.cubic),
        })
      : target;
    return () => cancelAnimation(shape);
    // The expression is a resolved value, including changes between scene phases.
  }, [expression, motionActive, rotationOffset, shape, side, transitionMs]);
  const geometry = useDerivedValue(() =>
    getGlassEyeGeometry(
      shape.value,
      side,
      width,
      height,
      blink.value,
      gaze.value.x,
      gaze.value.y,
    ),
  );
  const position = useAnimatedStyle(() => ({
    transform: [
      { translateY: shape.value.offsetY * unit },
      { rotate: `${shape.value.rotation}deg` },
    ],
  }));
  const outline = useAnimatedProps(() => ({ d: geometry.value.outline }));
  const core = useAnimatedProps(() => ({ d: geometry.value.core }));
  const coreGlow = useAnimatedProps(() => ({ d: geometry.value.coreGlow }));
  const aperture = useAnimatedProps(() => ({ d: geometry.value.aperture }));
  const body = useAnimatedProps(() => ({
    opacity: geometry.value.bodyOpacity,
  }));
  const halo = useAnimatedProps(() => ({
    opacity: geometry.value.glowOpacity * 0.1,
  }));
  const glow = useAnimatedProps(() => ({
    d: geometry.value.outline,
    opacity: geometry.value.glowOpacity * 0.12,
  }));
  const upper = useAnimatedProps(() => ({
    d: geometry.value.upperEdge,
    opacity: geometry.value.upperOpacity,
  }));
  const lower = useAnimatedProps(() => ({
    d: geometry.value.lowerEdge,
    opacity: geometry.value.lowerOpacity,
  }));
  const closed = useAnimatedProps(() => ({
    d: geometry.value.closed,
    opacity: geometry.value.lineOpacity,
  }));
  const url = (name: string) => `url(#${id}-${name})`;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={{ width, height, overflow: "visible" }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            width: canvas,
            height: canvas,
            left: (width - canvas) / 2,
            top: (height - canvas) / 2,
          },
          position,
        ]}
      >
        <Svg
          width={canvas}
          height={canvas}
          viewBox={`${-canvas / 2} ${-canvas / 2} ${canvas} ${canvas}`}
          accessible={false}
        >
          <Defs>
            {/* Approved moon material: dark above, luminous below. The
                existing attention target shifts its light inside the shell. */}
            <RadialGradient
              id={`${id}-shell`}
              cx="48%"
              cy="94%"
              fx="48%"
              fy="94%"
              r="88%"
            >
              <Stop offset={0} stopColor={palette.moon[0]} />
              <Stop offset={0.25} stopColor={palette.moon[1]} />
              <Stop offset={0.48} stopColor={palette.moon[2]} />
              <Stop offset={0.76} stopColor={palette.moon[3]} />
              <Stop offset={1} stopColor={palette.moon[4]} />
            </RadialGradient>
            <RadialGradient id={`${id}-core`}>
              <Stop offset={0} stopColor={palette.moon[0]} />
              <Stop offset={0.45} stopColor={palette.moon[1]} stopOpacity=".6" />
              <Stop offset={1} stopColor={palette.moon[1]} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={`${id}-coreGlow`}>
              <Stop offset={0} stopColor={palette.moon[1]} stopOpacity=".12" />
              <Stop offset={1} stopColor={palette.moon[1]} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={`${id}-aura`}>
              <Stop offset={0} stopColor={palette.glow} stopOpacity=".25" />
              <Stop offset={0.52} stopColor={primaryColor} stopOpacity=".11" />
              <Stop offset={1} stopColor={primaryColor} stopOpacity="0" />
            </RadialGradient>
            <LinearGradient id={`${id}-rim`} x1="0" y1="0" x2=".25" y2="1">
              <Stop offset={0} stopColor={palette.moon[0]} stopOpacity=".54" />
              <Stop offset={0.4} stopColor={palette.moon[2]} stopOpacity=".23" />
              <Stop offset={1} stopColor={palette.moon[1]} stopOpacity=".82" />
            </LinearGradient>
            <ClipPath id={`${id}-opening`}>
              <AnimatedPath
                testID={`glass-eye-aperture-${side}`}
                animatedProps={aperture}
              />
            </ClipPath>
            <ClipPath id={`${id}-contour`}>
              <AnimatedPath animatedProps={outline} />
            </ClipPath>
          </Defs>
          <AnimatedEllipse
            cx={0}
            cy={height * 0.36}
            rx={width * 0.62}
            ry={height * 0.26}
            fill={url("aura")}
            animatedProps={halo}
          />
          {/* SVG filter strings collide with RN 0.85's native CSS filter prop.
              A radial halo and faint contour layers keep the bloom portable. */}
          {[7, 3].map((spread, index) => (
            <AnimatedPath
              key={spread}
              fill="none"
              stroke={palette.glow}
              strokeWidth={spread * unit}
              strokeOpacity={[0.03, 0.05][index]}
              animatedProps={glow}
            />
          ))}
          <AnimatedG
            clipPath={url("opening")}
            animatedProps={body}
            testID={`glass-eye-body-${side}`}
          >
            <AnimatedPath
              testID={`glass-eye-envelope-${side}`}
              fill={url("shell")}
              animatedProps={outline}
            />
            <G clipPath={url("contour")}>
              <AnimatedPath
                fill={url("coreGlow")}
                animatedProps={coreGlow}
                opacity={0.15}
              />
              <AnimatedPath
                testID={`glass-eye-core-${side}`}
                fill={url("core")}
                opacity={0.5}
                animatedProps={core}
              />
              <Path
                d={`M${(-width * 28) / 66},${(-height * 13) / 68}C${(-width * 31) / 66},${(-height * 3) / 68} ${(-width * 30) / 66},${(height * 11) / 68} ${(-width * 25) / 66},${(height * 17) / 68}`}
                fill="none"
                stroke={palette.moon[0]}
                strokeWidth={(width * 1.7) / 66}
                strokeLinecap="round"
                opacity={0.18}
              />
              <Ellipse
                cx={(-width * 10) / 66}
                cy={(-height * 17) / 68}
                rx={(width * 6) / 66}
                ry={(height * 4.1) / 68}
                fill={palette.core}
                opacity={0.85}
                rotation={-14}
                originX={(-width * 10) / 66}
                originY={(-height * 17) / 68}
              />
            </G>
            <AnimatedPath
              fill="none"
              stroke={url("rim")}
              strokeWidth={(width * 1.15) / 66}
              animatedProps={outline}
            />
          </AnimatedG>
          <G clipPath={url("contour")}>
            <AnimatedPath
              fill="none"
              stroke={palette.moon[1]}
              strokeWidth={1.6 * unit}
              animatedProps={upper}
            />
            <AnimatedPath
              fill="none"
              stroke={palette.moon[1]}
              strokeWidth={1.6 * unit}
              animatedProps={lower}
            />
          </G>
          {/* Sleep and affection keep one clean, softly luminous curve. */}
          <AnimatedPath
            fill="none"
            stroke={palette.moon[2]}
            strokeWidth={7 * unit}
            strokeLinecap="round"
            animatedProps={closed}
          />
          <AnimatedPath
            testID={`glass-eye-closed-${side}`}
            fill="none"
            stroke={palette.moon[1]}
            strokeWidth={3.5 * unit}
            strokeLinecap="round"
            animatedProps={closed}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

export function GlassMouth({
  shape,
  width,
  color,
  paletteId,
  pulse,
  actionMotion,
  isAvatar,
  motionActive,
  transitionMs,
}: {
  shape: MouthShape;
  width: number;
  color: string;
  paletteId: FacePaletteId;
  pulse: SharedValue<number>;
  actionMotion: SharedValue<CharacterMotionFrame | null>;
  isAvatar: boolean;
  motionActive: boolean;
  transitionMs: number;
}) {
  const id = `glass-mouth-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`,
    unit = isAvatar ? 0.22 : 1;
  const palette = GLASS_PALETTES[paletteId] ?? GLASS_PALETTES.cyan;
  const target: GlassMouthPose = {
    width: Math.max(9, width),
    curve: shape === "smile" ? 1 : shape === "frown" ? -1.3 : 0,
    open: 0,
    round: shape === "dot" ? 1 : 0,
    visible: shape === "none" ? 0 : 1,
  };
  const mouth = useSharedValue(target);
  useEffect(() => {
    mouth.value = motionActive
      ? withTiming(target, {
          duration: transitionMs,
          easing: Easing.out(Easing.cubic),
        })
      : target;
    return () => cancelAnimation(mouth);
  }, [mouth, motionActive, shape, transitionMs, width]);
  const path = useAnimatedProps(() => ({
    d: getGlassMouthPath(
      mouth.value,
      pulse.value,
      actionMotion.value?.mouthX ?? 1,
      actionMotion.value?.mouthY ?? 1,
    ),
    opacity: mouth.value.visible * 0.92,
  }));
  return (
    <View
      pointerEvents="none"
      accessible={false}
      testID="glass-mouth-anchor"
      style={{
        position: "absolute",
        top: isAvatar ? 51 : 207,
        width: 100 * unit,
        height: 18 * unit,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        style={{ position: "absolute", left: 0, top: -26 * unit }}
        width={100 * unit}
        height={70 * unit}
        viewBox="-50 -35 100 70"
        accessible={false}
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={palette.mouth[0]} />
            <Stop offset={1} stopColor={palette.mouth[1]} />
          </LinearGradient>
        </Defs>
        <AnimatedPath
          testID="glass-mouth-contour"
          fill={`url(#${id})`}
          animatedProps={path}
        />
      </Svg>
    </View>
  );
}
