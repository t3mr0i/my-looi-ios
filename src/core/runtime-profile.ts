import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export type RuntimeProfile = {
  isAndroidEmulator: boolean;
  isIosSimulator: boolean;
  isSimulator: boolean;
  allowsWakewordAutostart: boolean;
};

export function getRuntimeProfile(): RuntimeProfile {
  const androidEmulator = isAndroidEmulator();
  const iosSimulator = isIosSimulator();
  const isEmulator = androidEmulator || iosSimulator;
  const forceWakeword = process.env.EXPO_PUBLIC_LOOI_ENABLE_EMULATOR_WAKEWORD === "1";
  const disableWakeword = process.env.EXPO_PUBLIC_LOOI_DISABLE_WAKEWORD_AUTOSTART === "1";

  return {
    isAndroidEmulator: androidEmulator,
    isIosSimulator: iosSimulator,
    isSimulator: isEmulator,
    allowsWakewordAutostart: !disableWakeword && (!isEmulator || forceWakeword),
  };
}

export function isIosSimulator(): boolean {
  if (Platform.OS !== "ios") return false;
  const runtime = requireOptionalNativeModule<{ isSimulator: boolean }>("LooiAppleRuntime");
  // A development client missing the runtime module must not silently start
  // microphone-driven robot control until it has been updated.
  return runtime?.isSimulator ?? true;
}

export function isAndroidEmulator(): boolean {
  if (Platform.OS !== "android") return false;

  const constants = Platform.constants as Record<string, unknown>;
  const values = [
    constants.Brand,
    constants.Fingerprint,
    constants.Manufacturer,
    constants.Model,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some((value) =>
    ["emulator", "generic", "goldfish", "ranchu", "sdk_gphone"].some((needle) =>
      value.includes(needle)
    )
  );
}
