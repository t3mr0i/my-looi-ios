import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "./load-typescript-tree.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = createTypeScriptTreeLoader();
const { getCharacterActionExpression } = load(path.join(root, "src/character/face-expression.ts"));
const { getCharacterPropPose, getCharacterPropSize, getCharacterActionGaze } = load(path.join(root, "src/character/character-action.ts"));
const { getGlassEyePose, getGlassEyeGeometry, getGlassMouthPath, GLASS_FACE_LAYOUT, GLASS_PALETTES } = load(path.join(root, "src/character/glass-face.ts"));
const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const number = value => Number(value.toFixed(3));
export function renderCharacterScenePicture(scene, raw, { showProp = true } = {}) {
  const face = getCharacterActionExpression({ id: 1, kind: scene.id, phase: "use" });
  const size = getCharacterPropSize(scene.id);
  const pose = getCharacterPropPose(scene.id, "use");
  const gaze = getCharacterActionGaze({ id: 1, kind: scene.id, phase: "use" });
  const geometry = raw.replace(/^[\s\S]*?<svg\b[^>]*>/u, "").replace(/<\/svg>[\s\S]*$/u, "").replaceAll("currentColor", "#A0E8CE");
  const palette = GLASS_PALETTES.cyan;
  const eye = (side, x) => {
    const { eyeWidth: w, eyeHeight: h, eyeCenterY: y } = GLASS_FACE_LAYOUT;
    const p = getGlassEyePose(face, side);
    const g = getGlassEyeGeometry(p, side, w, h, 1, gaze.x, gaze.y);
    return `<g transform="translate(${number(x + gaze.x * 5)} ${number(y + p.offsetY + gaze.y * 3)}) rotate(${p.rotation})">
      <defs>
        <radialGradient id="${side}-moon" cx="48%" cy="94%" fx="48%" fy="94%" r="88%">${[0,.25,.48,.76,1].map((stop,i)=>`<stop offset="${stop}" stop-color="${palette.moon[i]}"/>`).join("")}</radialGradient>
        <radialGradient id="${side}-light"><stop stop-color="${palette.moon[0]}"/><stop offset=".45" stop-color="${palette.moon[1]}" stop-opacity=".6"/><stop offset="1" stop-color="${palette.moon[1]}" stop-opacity="0"/></radialGradient>
        <linearGradient id="${side}-rim" x1="0" y1="0" x2=".25" y2="1"><stop stop-color="${palette.moon[0]}" stop-opacity=".54"/><stop offset=".4" stop-color="${palette.moon[2]}" stop-opacity=".23"/><stop offset="1" stop-color="${palette.moon[1]}" stop-opacity=".82"/></linearGradient>
        <clipPath id="${side}-contour"><path d="${g.outline}"/></clipPath><clipPath id="${side}-aperture"><path d="${g.aperture}"/></clipPath>
      </defs>
      <g clip-path="url(#${side}-aperture)" opacity="${g.bodyOpacity}">
        <path d="${g.outline}" fill="url(#${side}-moon)"/>
        <g clip-path="url(#${side}-contour)"><path d="${g.core}" fill="url(#${side}-light)" opacity=".5"/>
          <path d="M${-w*28/66},${-h*13/68}C${-w*31/66},${-h*3/68} ${-w*30/66},${h*11/68} ${-w*25/66},${h*17/68}" fill="none" stroke="${palette.moon[0]}" stroke-width="${w*1.7/66}" stroke-linecap="round" opacity=".18"/>
          <ellipse cx="${-w*10/66}" cy="${-h*17/68}" rx="${w*6/66}" ry="${h*4.1/68}" fill="${palette.core}" opacity=".85" transform="rotate(-14 ${-w*10/66} ${-h*17/68})"/>
        </g>
        <path d="${g.outline}" fill="none" stroke="url(#${side}-rim)" stroke-width="${w*1.15/66}"/>
      </g>
      <path d="${g.closed}" fill="none" stroke="${palette.moon[1]}" stroke-width="3.5" stroke-linecap="round" opacity="${g.lineOpacity}"/>
    </g>`;
  };
  const idle = face.mouth === "none" && ["neutral", "attentive"].includes(face.emotion);
  const shape = idle ? "smile" : face.mouth;
  const mouthPath = getGlassMouthPath({width:idle ? GLASS_FACE_LAYOUT.mouthWidth : Math.max(9,face.mouthWidth),curve:shape === "smile" ? 1 : shape === "frown" ? -1.3 : 0,open:0,round:shape === "dot" ? 1 : 0,visible:1},0);
  const mouth = shape === "none" ? "" : `<path transform="translate(180 216)" d="${mouthPath}" fill="url(#mouth)" opacity=".92"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="320" viewBox="0 0 360 320">
${showProp ? `<title>${xml(scene.label.de)}</title>` : ""}<rect width="360" height="320" fill="#000000"/>
<defs><linearGradient id="mouth" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${palette.mouth[0]}"/><stop offset="1" stop-color="${palette.mouth[1]}"/></linearGradient></defs>
<g transform="rotate(${face.headTilt} 180 130) translate(0 ${-face.lift})">
${eye("left", 180 - (GLASS_FACE_LAYOUT.eyeWidth + GLASS_FACE_LAYOUT.eyeGap) / 2)}${eye("right", 180 + (GLASS_FACE_LAYOUT.eyeWidth + GLASS_FACE_LAYOUT.eyeGap) / 2)}${mouth}
${showProp ? `<g transform="translate(${number(180 + pose.x)} ${number(197 + pose.y + size / 2)}) rotate(${pose.rotation}) scale(${number(pose.scale * size / 24)}) translate(-12 -12)" fill="none" stroke="#A0E8CE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</g>` : ""}
</g></svg>\n`;
}
