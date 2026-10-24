import { Camera } from "expo-camera";

/** Expo owns the camera permission flow on both native platforms. A permission
 * revoked in Settings must be checked again instead of relying on preferences. */
export async function requestCameraAccess(): Promise<boolean> {
  const current = await Camera.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Camera.requestCameraPermissionsAsync()).granted;
}
