import { View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import type { CharacterMotionFrame } from "@/src/character/character-choreography";
import type { CharacterActionKind } from "@/src/character/character-action";

import { looiTheme } from "./looi-theme";
const surface = looiTheme.bg;
type Props = { color: string; size: number; motion: SharedValue<CharacterMotionFrame | null> };

/** A little articulated gripper: its thumb closes as the object is picked up. */
export function CharacterHand({ color, size, side, motion, twoHands, folding = false }: Props & { side: -1 | 1; twoHands: boolean; folding?: boolean }) {
  const u = size / 88;
  const style = useAnimatedStyle(() => {
    const m = motion.value;
    const open = 1 - (m?.grip ?? 1);
    const book = folding ? m?.bookOpen ?? 1 : 1;
    return { opacity: m?.hands ?? 0, transform: [
      { translateX: side * (open * 12 - (twoHands ? (1 - book) * 15 : 0)) * u },
      { rotate: `${side * (open * 20 - 8)}deg` }, { scale: 1 - open * 0.12 }] };
  });
  return <Animated.View style={[{ position: "absolute", left: (side === 1 ? size * 0.78 : size * 0.01), top: size * 0.57,
    width: 23 * u, height: 29 * u, backgroundColor: surface, borderColor: color, borderWidth: 2.4 * u,
    borderRadius: 9 * u, zIndex: 4 }, style]}>
    {[0, 1].map(index => <View key={index} style={{ position: "absolute", left: 4 * u, right: 3 * u,
      top: (9 + index * 7) * u, height: 1.8 * u, borderRadius: u, backgroundColor: color, opacity: 0.7 }} />)}
    <View style={{ position: "absolute", [side === 1 ? "left" : "right"]: -7 * u, top: 3 * u,
      width: 10 * u, height: 16 * u, borderRadius: 6 * u, borderWidth: 2.4 * u, borderColor: color, backgroundColor: surface }} />
  </Animated.View>;
}

function Drink({ color, size, motion, coffee }: Props & { coffee: boolean }) {
  const u = size / 88;
  const bodyHeight = size * (coffee ? 0.45 : 0.58);
  const fill = useAnimatedStyle(() => {
    const level = motion.value?.liquid ?? 0.8;
    return { transform: [{ translateY: (1 - level) * bodyHeight / 2 }, { scaleY: level }] };
  });
  const steam = useAnimatedStyle(() => ({ opacity: 0.4 + Math.sin((motion.value?.steam ?? 0) * Math.PI) * 0.4,
    transform: [{ translateY: -(motion.value?.steam ?? 0) * 10 }] }));
  return <>
    {coffee ? <>
      <View style={{ position: "absolute", left: size * 0.63, top: size * 0.38, width: size * 0.27, height: size * 0.3,
        borderColor: color, borderWidth: 3 * u, borderRadius: size * 0.14 }} />
      <Animated.View style={[{ position: "absolute", left: size * 0.22, top: size * 0.02, flexDirection: "row", gap: size * 0.1 }, steam]}>
        {[0, 1, 2].map(n => <View key={n} style={{ width: size * 0.05, height: size * 0.2, borderLeftWidth: 2 * u,
          borderColor: color, borderTopLeftRadius: 10, transform: [{ rotate: "12deg" }] }} />)}
      </Animated.View>
    </> : <>
      <View style={{ position: "absolute", left: size * 0.52 - 1.5 * u, top: size / 12, height: size * 0.36, width: 3 * u, borderRadius: 2, backgroundColor: color }} />
      <View style={{ position: "absolute", left: size * 0.52 - 1.5 * u, top: size / 12, width: size * 0.105 + 3, height: 3 * u, borderRadius: 2, backgroundColor: color }} />
    </>}
    <View style={{ position: "absolute", left: size * (coffee ? 0.12 : 0.2), top: size / 3,
      width: size * 0.59, height: bodyHeight, borderWidth: 3 * u, borderColor: color,
      borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: coffee ? 14 : 12,
      borderBottomRightRadius: coffee ? 14 : 12, backgroundColor: surface, overflow: "hidden" }}>
      <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: color, opacity: coffee ? 0.34 : 0.25 }, fill]} />
    </View>
    {!coffee ? <View style={{ position: "absolute", left: size * 0.16, top: size * 0.315, height: 4 * u,
      width: size * 0.67, borderRadius: 3, backgroundColor: color }} /> : null}
  </>;
}

function Cookie({ color, size, motion }: Props) {
  const u = size / 88;
  const biteA = useAnimatedStyle(() => ({ transform: [{ scale: Math.min(1, (motion.value?.bite ?? 0) * 2) }] }));
  const biteB = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0, ((motion.value?.bite ?? 0) - 0.5) * 2) }] }));
  return <>
    <View style={{ position: "absolute", left: size / 12, top: size / 12, width: size * 5 / 6, height: size * 5 / 6,
      borderRadius: size, borderWidth: 3 * u, borderColor: color, backgroundColor: `${color}18` }} />
    {[[0.32, 0.3], [0.56, 0.25], [0.28, 0.55], [0.53, 0.51], [0.4, 0.74], [0.68, 0.68]].map(([x, y], i) =>
      <View key={i} style={{ position: "absolute", left: size * x, top: size * y, width: size * 0.065,
        height: size * 0.065, borderRadius: size, backgroundColor: color, opacity: 0.8 }} />)}
    <Animated.View style={[{ position: "absolute", left: size * 0.64, top: size * 0.12, width: size * 0.34,
      height: size * 0.34, borderRadius: size, backgroundColor: surface }, biteA]} />
    <Animated.View style={[{ position: "absolute", left: size * 0.66, top: size * 0.32, width: size * 0.34,
      height: size * 0.34, borderRadius: size, backgroundColor: surface }, biteB]} />
    {[0, 1, 2, 3].map(i => <Crumb key={i} index={i} color={color} size={size} motion={motion} />)}
  </>;
}
function Crumb({ index, color, size, motion }: Props & { index: number }) {
  const style = useAnimatedStyle(() => {
    const p = motion.value?.crumbs ?? 0;
    return { opacity: p > 0 ? (1 - p) * 0.9 : 0, transform: [
      { translateX: p * (10 + index * 5) }, { translateY: p * (4 + index * 5) },
      { rotate: `${p * 100}deg` }, { scale: 1 - p * 0.6 }] };
  });
  return <Animated.View style={[{ position: "absolute", left: size * (0.7 + index * 0.03), top: size * 0.25,
    width: size * 0.045, height: size * 0.045, borderRadius: 2, backgroundColor: color }, style]} />;
}

function Book({ color, size, motion }: Props) {
  const u = size / 88;
  const opening = useAnimatedStyle(() => ({ transform: [{ scaleX: motion.value?.bookOpen ?? 1 }] }));
  const turning = useAnimatedStyle(() => {
    const page = motion.value?.page ?? 0;
    return { opacity: page > 0 && page < 1 ? 1 : 0, transform: [
      { perspective: 240 }, { translateX: -size * 0.22 }, { rotateY: `${-page * 180}deg` }, { translateX: size * 0.22 }] };
  });
  const lines = (left: number) => [0, 1, 2, 3].map(i => <View key={`${left}-${i}`} style={{ position: "absolute",
    left: size * left, top: size * (0.28 + i * 0.115), width: size * (i === 3 ? 0.19 : 0.25), height: 2 * u,
    backgroundColor: color, opacity: 0.38, borderRadius: 2 }} />);
  return <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }, opening]}>
    <View style={{ position: "absolute", left: size * 0.04, top: size * 0.12, width: size * 0.92,
      height: size * 0.76, borderWidth: 3 * u, borderColor: color, borderRadius: 7, backgroundColor: surface }} />
    {lines(0.13)}{lines(0.59)}
    <View style={{ position: "absolute", left: size * 0.5 - 1.5 * u, top: size * 0.12, width: 3 * u, height: size * 0.76, backgroundColor: color }} />
    <Animated.View style={[{ position: "absolute", left: size * 0.5, top: size * 0.14, width: size * 0.44,
      height: size * 0.72, borderWidth: 2 * u, borderColor: color, borderRadius: 5, backgroundColor: "#0c2634" }, turning]}>
      {[0, 1, 2].map(i => <View key={i} style={{ position: "absolute", left: size * 0.07, right: size * 0.07,
        top: size * (0.14 + i * 0.13), height: 2 * u, borderRadius: 1, backgroundColor: color, opacity: 0.4 }} />)}
    </Animated.View>
  </Animated.View>;
}

/** Hero props change their state as LOOI uses them; no new rendering dependency. */
export function CharacterHeldObject({ kind, ...props }: Props & { kind: CharacterActionKind }) {
  if (kind === "drink" || kind === "coffee") return <Drink {...props} coffee={kind === "coffee"} />;
  if (kind === "snack") return <Cookie {...props} />;
  if (kind === "read") return <Book {...props} />;
  return null;
}
