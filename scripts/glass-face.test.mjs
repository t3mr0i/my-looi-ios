import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const load = createTypeScriptTreeLoader();
const { getGlassEyePose, getGlassEyeGeometry, glassEyePoints, getGlassMouthPath, GLASS_PALETTES, GLASS_FACE_LAYOUT } = load("src/character/glass-face.ts");
const { resolveFaceExpression, getCharacterActionExpression } = load("src/character/face-expression.ts");
const { CHARACTER_SCENES } = load("src/character/character-scene-catalog.ts");
const { CHARACTER_ACTION_PHASES } = load("src/character/character-action.ts");
const { createCharacterChoreography, sampleCharacterChoreography } = load("src/character/character-choreography.ts");
const neutral = resolveFaceExpression("attention", "", null);
const pose = mood => getGlassEyePose(resolveFaceExpression("attention", "", mood), "left");
const geometry = (p, blink = 1) => getGlassEyeGeometry(p,"left",142,144,blink);
const rest = geometry(getGlassEyePose(neutral,"left"));
for (const blink of [0,.25,.5,.75,1]) {
  const frame = geometry(getGlassEyePose(neutral,"left"),blink);
  assert.equal(frame.outline, rest.outline, "blink never scales the glass envelope");
  assert.equal(frame.core, rest.core, "blink never scales the luminous core");
  assert.equal(frame.coreGlow, rest.coreGlow, "blink never squashes the inner glow");
}
for (const mood of ["sleeping","petted"]) {
  const face = mood === "sleeping" ? resolveFaceExpression("sleeping","",null) : resolveFaceExpression("attention","",mood);
  const closed = geometry(getGlassEyePose(face,"left"));
  assert.equal(closed.bodyOpacity,0); assert.equal(closed.glowOpacity,0); assert.equal(closed.lineOpacity,1);
}
const curves = ["attentive","curious","pleased","startled","annoyed"].map(mood=>geometry(pose(mood)).outline);
assert.equal(new Set(curves).size,5,"the emotions change the silhouette, not just the transform");
const happy = glassEyePoints(pose("pleased"),"left");
assert.ok(happy[6][1] < happy[3][1],"joy has a lifted concave lower contour");
const curious = resolveFaceExpression("attention","","curious");
assert.notEqual(getGlassEyeGeometry(getGlassEyePose(curious,"left"),"left",142,144,1).outline,
  getGlassEyeGeometry(getGlassEyePose(curious,"right"),"right",142,144,1).outline,"curiosity is asymmetric");
for (const scene of CHARACTER_SCENES) for (const phase of CHARACTER_ACTION_PHASES) {
  const expression = getCharacterActionExpression({id:1,kind:scene.id,phase});
  const recipe = createCharacterChoreography(scene.id,phase);
  for (const progress of [0,.25,.5,.75,1]) {
    const frame = sampleCharacterChoreography(recipe,phase,progress);
    for (const side of ["left","right"]) for (const blink of [0,.5,1]) {
      const p = getGlassEyePose(expression,side), g = getGlassEyeGeometry(p,side,142,144,blink,frame.gazeX,frame.gazeY);
      for (const [key,value] of Object.entries(g)) {
        if (typeof value === "number") assert.ok(Number.isFinite(value),`${scene.id}/${phase}/${key}`);
        else assert.doesNotMatch(value,/NaN|Infinity|undefined/,`${scene.id}/${phase}/${key}`);
      }
    }
    const mouth = getGlassMouthPath({width:expression.mouthWidth,curve:expression.mouth==="frown"?-.65:.8,round:expression.mouth==="dot"?1:0,open:0,visible:1},0,frame.mouthX,frame.mouthY);
    assert.doesNotMatch(mouth,/NaN|Infinity|undefined/);
  }
}
const round = {width:9,curve:0,round:1,open:0,visible:1};
const sip = getGlassMouthPath(round,0);
assert.ok(sip.startsWith("M-4.5,0"));
const sipNumbers = sip.match(/-?\d+(?:\.\d+)?/g).map(Number);
assert.equal(Math.min(...sipNumbers), -4.5);
assert.equal(Math.max(...sipNumbers), 4.5, "the sip aperture stays centered on its scene contact");
const speaking = {width:28,curve:.8,round:0,open:0,visible:1};
assert.notEqual(getGlassMouthPath(speaking,0),getGlassMouthPath(speaking,1),"the inherited speech pulse opens the mouth");
assert.equal(Object.keys(GLASS_PALETTES).length,5,"all persisted palettes remain available");
console.log("PASS Soft Glass: distinct contours, independent blink/material, sleep/pet closure, speech pulse and 200 finite scene poses");

// The approved static study is the reference, not an approximation by eye.
const moonPose = getGlassEyePose(resolveFaceExpression("attention", "", null), "left");
const moon = getGlassEyeGeometry(moonPose, "left", 66, 68, 1);
assert.equal(moon.outline, "M0,-34C19,-34 32,-21 33,-2C34,19 23,33 2,34C-18,35 -32,24 -33,4C-35,-17 -22,-33 0,-34Z");
assert.ok(moon.lightY > 0, "light originates below the dark upper volume");
assert.equal((GLASS_FACE_LAYOUT.eyeWidth + GLASS_FACE_LAYOUT.eyeGap) / GLASS_FACE_LAYOUT.eyeWidth, 110 / 66,
  "the accepted wider eye spacing scales with the eyes");
assert.ok(Math.abs(GLASS_FACE_LAYOUT.eyeCenterY + GLASS_FACE_LAYOUT.eyeWidth * 44.05 / 66 - 216) < 1e-9,
  "the study's eye-to-mouth proportion meets the existing prop contact");
assert.equal(getGlassMouthPath({width:19,curve:1,round:0,open:0,visible:1},0),
  "M-9.5,-2.05C-6.75,-0.8 -3.375,-0.175 0,-0.175C3.375,-0.175 6.75,-0.8 9.5,-2.05C8,1.15 4.5,2.05 0,2.05C-4.5,2.05 -8,1.15 -9.5,-2.05Z",
  "the accepted tapered smile is preserved exactly at rest");
console.log("PASS Moon Eyes: approved contour, light origin, spacing, smile and prop-anchor proportions");
