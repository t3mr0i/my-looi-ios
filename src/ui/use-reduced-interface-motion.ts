import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Start still while the preference loads, and follow changes while mounted. */
export function useReducedInterfaceMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let current = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      current = false;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (current) setReduced(value);
    }).catch(() => undefined);
    return () => { current = false; subscription.remove(); };
  }, []);
  return reduced;
}
