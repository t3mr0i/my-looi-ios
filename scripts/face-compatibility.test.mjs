import assert from 'node:assert/strict';
import { createTypeScriptTreeLoader } from './helpers/load-typescript-tree.mjs';
const load = createTypeScriptTreeLoader();
const { FACE_STYLES, FACE_PALETTES, getFaceAppearanceMetrics, resolveStyledMouth } = load('src/character/face-appearance.ts');
const { getGlassEyePose, getGlassEyeGeometry, getGlassMouthPath, GLASS_PALETTES } = load('src/character/glass-face.ts');
const { getCharacterActionExpression, resolveFaceExpression } = load('src/character/face-expression.ts');
const { CHARACTER_SCENES } = load('src/character/character-scene-catalog.ts');
const { CHARACTER_ACTION_PHASES } = load('src/character/character-action.ts');
const { createCharacterChoreography, sampleCharacterChoreography } = load('src/character/character-choreography.ts');
const styles = Object.entries(FACE_STYLES);
assert.equal(styles.length, 7);
assert.deepEqual(Object.keys(FACE_PALETTES).sort(), Object.keys(GLASS_PALETTES).sort());
const finite = (g, label) => {
  for (const [key,value] of Object.entries(g)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label}/${key}`);
    else assert.doesNotMatch(value, /NaN|Infinity|undefined/, `${label}/${key}`);
  }
};
const mouthBounds = (d, label) => {
  const coordinates = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let i=0;i<coordinates.length;i+=2) {
    assert.ok(Math.abs(coordinates[i]) <= 50, `${label} mouth exceeds horizontal SVG bounds`);
    assert.ok(Math.abs(coordinates[i+1]) <= 35, `${label} mouth exceeds vertical SVG bounds`);
  }
};
let eyeFrames=0, mouthFrames=0;
for (const [id,style] of styles) {
  for (const avatar of [false,true]) {
    const m = getFaceAppearanceMetrics(style,avatar);
    assert.ok(Math.abs(m.browGap + (avatar?10:44) - m.eyeCenterDistance) < 1e-9, `${id} brows align with the eyes`);
    assert.ok(Math.abs(m.lashGap + (avatar?5:22) - m.eyeCenterDistance) < 1e-9, `${id} lashes align with the eyes`);
    assert.ok(m.browTop < m.eyeTop);
    for (const scene of CHARACTER_SCENES) for (const phase of CHARACTER_ACTION_PHASES) {
      const face=getCharacterActionExpression({id:1,kind:scene.id,phase});
      const recipe=createCharacterChoreography(scene.id,phase);
      const mouth=resolveStyledMouth(face,style);
      if (!['neutral','attentive'].includes(face.emotion) || face.mouth!=='none') assert.equal(mouth.shape,face.mouth,`${id}/${scene.id} preserves resolved mouth semantics`);
      for (const progress of [0,.5,1]) {
        const frame=sampleCharacterChoreography(recipe,phase,progress);
        for (const side of ['left','right']) {
          const pose=getGlassEyePose(face,side,side==='left'?style.leftEyeRotationOffset:style.rightEyeRotationOffset);
          const open=getGlassEyeGeometry(pose,side,m.eyeWidth,m.eyeHeight,1,frame.gazeX,frame.gazeY);
          for (const blink of [0,.5,1]) {
            const g=getGlassEyeGeometry(pose,side,m.eyeWidth,m.eyeHeight,blink,frame.gazeX,frame.gazeY);
            finite(g,`${id}/${scene.id}/${phase}/${side}`);
            assert.equal(g.outline,open.outline,'blink preserves the style contour');
            assert.equal(g.core,open.core,'blink preserves the material');
            if (blink===0) { assert.equal(g.bodyOpacity,0);assert.equal(g.lineOpacity,1); }
            eyeFrames++;
          }
        }
        for (const pulse of [0,.5,1]) {
          const d=getGlassMouthPath({width:Math.max(9,mouth.width),curve:mouth.shape==='smile'?1:mouth.shape==='frown'?-1.3:0,round:mouth.shape==='dot'?1:0,open:0,visible:1},pulse,frame.mouthX,frame.mouthY);
          mouthBounds(d,`${id}/${scene.id}/${phase}`);mouthFrames++;
        }
      }
    }
    const poses=['curious','pleased','startled','annoyed','petted'].map(mood=>resolveFaceExpression('attention','',mood));
    poses.push(resolveFaceExpression('sleeping','',null),resolveFaceExpression('attention','',null));
    for (const from of poses) for (const to of poses) for (const t of [0,.25,.5,.75,1]) {
      const a=getGlassEyePose(from,'left',style.leftEyeRotationOffset),b=getGlassEyePose(to,'left',style.leftEyeRotationOffset);
      const tween=Object.fromEntries(Object.keys(a).map(key=>[key,a[key]+(b[key]-a[key])*t]));
      finite(getGlassEyeGeometry(tween,'left',m.eyeWidth,m.eyeHeight,.5),`${id}/transition`);
    }
  }
}
console.log(`PASS face compatibility: ${styles.length} designs × ${Object.keys(GLASS_PALETTES).length} colors, avatar/fullscreen, 200 scenes; ${eyeFrames} eye frames, ${mouthFrames} mouth frames and pose transitions`);
