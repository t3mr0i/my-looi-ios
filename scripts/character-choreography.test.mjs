import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const load = createTypeScriptTreeLoader();
const { CHARACTER_SCENES } = load("src/character/character-scene-catalog.ts");
const { CHARACTER_ACTION_PHASES, getCharacterActionDuration } = load("src/character/character-action.ts");
const { createCharacterChoreography, sampleCharacterChoreography } = load("src/character/character-choreography.ts");
const sample = (kind, phase, p, reduced = false) => sampleCharacterChoreography(createCharacterChoreography(kind, phase), phase, p, reduced);
for (const scene of CHARACTER_SCENES) {
  assert.ok(CHARACTER_ACTION_PHASES.reduce((ms, phase) => ms + getCharacterActionDuration(scene.id, phase), 0) <= 6000, scene.id);
  for (const phase of CHARACTER_ACTION_PHASES) {
    const recipe = createCharacterChoreography(scene.id, phase);
    for (let n = 0; n <= 100; n++) {
      const frame = sampleCharacterChoreography(recipe, phase, n / 100);
      assert.ok([...Object.values(frame).filter(x => typeof x === "number"), ...Object.values(frame.prop)].every(Number.isFinite), `${scene.id}/${phase} finite`);
      assert.ok(frame.prop.opacity >= 0 && frame.prop.opacity <= 1);
      assert.ok(frame.liquid >= 0 && frame.liquid <= 1 && frame.bite >= 0 && frame.bite <= 1);
      assert.ok(Math.abs(frame.gazeX) <= 1 && Math.abs(frame.gazeY) <= 1);
      assert.deepEqual(sampleCharacterChoreography(recipe, phase, n / 100, true), sampleCharacterChoreography(recipe, phase, 0, true), `${scene.id} Reduce Motion does not animate`);
    }
  }
  if (scene.motion === "rest") continue;
  for (let i = 0; i < CHARACTER_ACTION_PHASES.length - 1; i++) {
    const end = sample(scene.id, CHARACTER_ACTION_PHASES[i], 1), start = sample(scene.id, CHARACTER_ACTION_PHASES[i + 1], 0);
    for (const key of ["x", "y", "rotation", "scale", "opacity"]) assert.ok(Math.abs(end.prop[key] - start.prop[key]) < 0.0001, `${scene.id} continuous ${key}`);
    assert.ok(Math.hypot(end.gazeX - start.gazeX, end.gazeY - start.gazeY) < 0.001, `${scene.id} continuous gaze`);
  }
  if (["sip", "coffee", "bite"].includes(scene.motion)) {
    const recipe = createCharacterChoreography(scene.id, "use");
    const still = sampleCharacterChoreography(recipe, "use", 0.5, true).prop;
    assert.ok(Math.hypot(still.x + (recipe.contact.x - 12) * recipe.size / 24,
      197 + still.y + recipe.size / 2 + (recipe.contact.y - 12) * recipe.size / 24 - 216) < 0.001,
      `${scene.id} keeps meaningful contact in the static alternative`);
    for (const p of [0.23, 0.29, 0.34, 0.4, 0.52, 0.6, 0.63, 0.69, 0.75]) {
      const { prop } = sampleCharacterChoreography(recipe, "use", p), a = prop.rotation * Math.PI / 180;
      const dx = (recipe.contact.x - 12) * recipe.size / 24, dy = (recipe.contact.y - 12) * recipe.size / 24;
      assert.ok(Math.hypot(prop.x + dx * Math.cos(a) - dy * Math.sin(a), 197 + prop.y + recipe.size / 2 + dx * Math.sin(a) + dy * Math.cos(a) - 216) < 0.001, `${scene.id} uses mouth contact`);
    }
  }
}
const notice = sample("drink", "reveal", 0.18);
assert.equal(notice.prop.opacity, 0, "attention leads object appearance");
assert.ok(notice.gazeX > 0.4 && notice.hands > 0, "LOOI reaches and looks before taking the drink");
assert.ok(sample("drink", "use", 0.5).liquid < sample("drink", "use", 0.1).liquid);
assert.ok(sample("drink", "use", 0.8).liquid < sample("drink", "use", 0.5).liquid);
assert.equal(sample("snack", "use", 0.2).bite, 0);
assert.equal(sample("snack", "use", 0.5).bite, 0.5);
assert.equal(sample("snack", "use", 0.8).bite, 1);
assert.ok(sample("snack", "use", 0.4).crumbs > 0);
assert.ok(sample("read", "use", 0.25).bookOpen > 0.99);
assert.equal(sample("read", "use", 0.2).page, 0);
assert.equal(sample("read", "use", 0.8).page, 1);
assert.notEqual(sample("read", "use", 0.3).gazeX, sample("read", "use", 0.6).gazeX);
assert.equal(sample("sympathy", "use", 0.6).hands, 0);
console.log("PASS shared choreography: 200 finite scenes, anticipation, phase continuity, mouth contact, liquid/bites/pages and static Reduce Motion");
