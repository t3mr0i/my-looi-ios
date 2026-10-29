import { SymbolView } from "expo-symbols";
import { looiTheme } from "./looi-theme";
export type AppsGlyphName = "back" | "settings" | "search" | "refresh" | "trash" | "link" | "camera" | "actions" | "stop";
const names = {
  back: { ios: "chevron.left", android: "chevron_left" }, settings: { ios: "gearshape", android: "settings" },
  search: { ios: "magnifyingglass", android: "search" }, refresh: { ios: "arrow.clockwise", android: "refresh" },
  trash: { ios: "trash", android: "delete_outline" }, link: { ios: "link", android: "link" },
  camera: { ios: "camera", android: "camera_alt" }, actions: { ios: "arrow.left.arrow.right", android: "swap_horiz" },
  stop: { ios: "stop.fill", android: "stop" },
} as const;
export function RobotAppsGlyph({ name, size = 22, color = looiTheme.text }: { name: AppsGlyphName; size?: number; color?: string }) {
  return <SymbolView name={names[name]} size={size} tintColor={color} weight="medium" />;
}
