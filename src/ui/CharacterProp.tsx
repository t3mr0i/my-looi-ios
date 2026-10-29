import { Image } from "expo-image";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { getCharacterPropSize, type CharacterActionFrame, type CharacterActionKind } from "@/src/character/character-action";
import type { CharacterMotionFrame } from "@/src/character/character-choreography";
import { getCharacterScene } from "@/src/character/character-scene-catalog";
import { CHARACTER_SCENE_PROP_ART } from "@/src/character/character-scene-art";
import { CharacterHand, CharacterHeldObject } from "./CharacterHeldObject";

/** High-resolution transparent renders of the licensed vectors, bundled locally. */
export function CharacterPropIcon({ kind, color, size = 24 }: { kind: CharacterActionKind; color: string; size?: number }) {
  return <Image source={CHARACTER_SCENE_PROP_ART[kind]} tintColor={color} contentFit="contain" accessible={false}
    style={{ width: size, height: size }} />;
}

export function CharacterProp({ frame, color, isAvatar, motion }: {
  frame: CharacterActionFrame; color: string; isAvatar: boolean; motionActive: boolean; motion: SharedValue<CharacterMotionFrame | null>;
}) {
  const unit = isAvatar ? 0.25 : 1;
  const profile = getCharacterScene(frame.kind).motion;
  const size = getCharacterPropSize(frame.kind) * unit;
  const style = useAnimatedStyle(() => {
    const p = motion.value?.prop;
    return { opacity: p ? 1 : 0, transform: [{ translateX: (p?.x ?? 0) * unit },
      { translateY: (p?.y ?? 0) * unit }, { rotate: `${p?.rotation ?? 0}deg` }, { scale: p?.scale ?? 1 }] };
  });
  const objectStyle = useAnimatedStyle(() => ({ opacity: motion.value?.prop.opacity ?? 0 }));
  const twoHands = profile === "read" || profile === "offer";
  const hero = ["drink", "coffee", "snack", "read"].includes(frame.kind);
  return <Animated.View pointerEvents="none" accessible={false} testID={`character-prop-${frame.kind}`}
    style={[{ position: "absolute", zIndex: 6, left: (isAvatar ? 46 : 180) - size / 2,
      top: (isAvatar ? 51 : 207) - 10 * unit, width: size, height: size }, style]}>
    <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: size, height: size }, objectStyle]}>
      {hero ? <CharacterHeldObject kind={frame.kind} color={color} size={size} motion={motion} />
        : <CharacterPropIcon kind={frame.kind} color={color} size={size} />}
    </Animated.View>
    {profile !== "rest" ? <>
      {twoHands ? <CharacterHand color={color} size={size} motion={motion} side={-1} twoHands folding={frame.kind === "read"} /> : null}
      <CharacterHand color={color} size={size} motion={motion} side={1} twoHands={twoHands} folding={frame.kind === "read"} />
    </> : null}
  </Animated.View>;
}
