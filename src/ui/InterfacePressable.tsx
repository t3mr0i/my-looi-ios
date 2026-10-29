import { forwardRef } from "react";
import { Pressable, StyleSheet, type PressableProps, type View } from "react-native";

/** Shared feedback for ordinary controls. Gesture surfaces keep native Pressable. */
export const InterfacePressable = forwardRef<View, PressableProps>(function InterfacePressable(
  { style, disabled, accessibilityRole = "button", accessibilityState, ...props },
  ref,
) {
  return (
    <Pressable
      {...props}
      ref={ref}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled ?? accessibilityState?.disabled) }}
      aria-checked={props["aria-checked"] ?? accessibilityState?.checked}
      aria-selected={props["aria-selected"] ?? accessibilityState?.selected}
      aria-expanded={props["aria-expanded"] ?? accessibilityState?.expanded}
      aria-busy={props["aria-busy"] ?? accessibilityState?.busy}
      style={(state) => [
        styles.target,
        typeof style === "function" ? style(state) : style,
        state.pressed && !disabled && styles.pressed,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  target: { minWidth: 44, minHeight: 44 },
  // Immediate feedback preserves the control's layout and respects reduced motion.
  pressed: { opacity: 0.76 },
});
