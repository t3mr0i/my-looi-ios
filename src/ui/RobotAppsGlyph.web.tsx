import { createElement } from "react";
import { looiTheme } from "./looi-theme";
import type { AppsGlyphName } from "./RobotAppsGlyph";
const paths: Record<AppsGlyphName, string> = {
  back: "m14 5-7 7 7 7", search: "m20 20-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  refresh: "M20 4v6h-6 M20 10a8 8 0 1 0-1 9", trash: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  link: "m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  camera: "M3 6h4l2-3h6l2 3h4v15H3Z M17 13a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  actions: "M3 7h18m-4-4 4 4-4 4 M21 17H3m4-4-4 4 4 4",
  stop: "M6 6h12v12H6Z",
  settings: "m10 2-.6 3-2 .8L5 4 2 9l2.4 2v2L2 15l3 5 2.4-1.8 2 .8.6 3h5l.6-3 2-.8L20 20l3-5-2.4-2v-2L23 9l-3-5-2.4 1.8-2-.8L15 2Z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
};
export function RobotAppsGlyph({ name, size = 22, color = looiTheme.text }: { name: AppsGlyphName; size?: number; color?: string }) {
  return createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: name === "stop" ? color : "none", stroke: color, strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, createElement("path", { d: paths[name] }));
}
