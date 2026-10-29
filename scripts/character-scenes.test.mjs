import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const load = createTypeScriptTreeLoader();
const catalog = load("src/character/character-scene-catalog.ts");
const { selectCharacterScene } = load("src/character/character-scene-selection.ts");
const { getCharacterActionExpression } = load("src/character/face-expression.ts");
const { createCharacterActionController, getCharacterPropPose, getCharacterPropContact, getCharacterPropBeatPose, getCharacterPropSize, getCharacterActionGaze } = load("src/character/character-action.ts");
const { parseExplicitRobotCommand } = load("src/voice/explicit-robot-command.ts");
const { CHARACTER_SCENES, CHARACTER_SCENE_CATEGORIES, findCharacterScenes, isCharacterScene } = catalog;
assert.equal(CHARACTER_SCENES.length, 200);
assert.equal(new Set(CHARACTER_SCENES.map(scene => scene.id)).size, 200);
assert.equal(Object.keys(CHARACTER_SCENE_CATEGORIES).length, 10);
for (const category of Object.keys(CHARACTER_SCENE_CATEGORIES)) {
  assert.equal(CHARACTER_SCENES.filter(scene => scene.category === category).length, 20, category);
  assert.equal(findCharacterScenes("", category).length, 20);
}
const source = JSON.parse(fs.readFileSync("assets/character-scenes/SOURCE.json", "utf8"));
const rendered = JSON.parse(fs.readFileSync("assets/character-scenes/RENDERED.json", "utf8"));
const hashes = new Set();
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
for (const scene of CHARACTER_SCENES) {
  for (const [language, prefix] of [["de", "Zeig mir "], ["en", "Show me "], ["uk", "Покажи мені "], ["ru", "Покажи мне "]]) {
    assert.ok(scene.label[language].trim(), `${scene.id} ${language}`);
    assert.equal(selectCharacterScene(prefix + scene.label[language])?.kind, scene.id, `${scene.id} explicit ${language}`);
    const physical = parseExplicitRobotCommand(`LOOI, ${prefix}${scene.label[language]}`);
    assert.ok(physical === null || (physical.kind === "move" && physical.direction === "stop"), `${scene.id} display request cannot become physical motion (${language})`);
    assert.ok(findCharacterScenes(scene.label[language]).some(found => found.id === scene.id), `${scene.id} searchable ${language}`);
  }
  const prop = fs.readFileSync(`assets/character-scenes/props/${scene.id}.svg`);
  const nativeProp = fs.readFileSync(`assets/character-scenes/native-props/${scene.id}.png`);
  assert.equal(hash(prop), rendered[scene.id]?.propSvgSha256, "native raster came from the preserved upstream vector");
  assert.equal(hash(nativeProp), rendered[scene.id]?.propPngSha256, "native prop content hash");
  assert.equal(nativeProp.readUInt32BE(16), 384); assert.equal(nativeProp.readUInt32BE(20), 384);
  const picture = fs.readFileSync(`assets/character-scenes/pictures/${scene.id}.svg`);
  const png = fs.readFileSync(`assets/character-scenes/pictures/${scene.id}.png`);
  assert.equal(hash(prop), source.assets.find(asset => asset.id === scene.id)?.sha256, `${scene.id} original source hash`);
  assert.equal(hash(picture), rendered[scene.id]?.svgSha256, `${scene.id} PNG matches authored SVG`);
  assert.equal(hash(png), rendered[scene.id]?.pngSha256, `${scene.id} packaged PNG hash`);
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 720); assert.equal(png.readUInt32BE(20), 640);
  hashes.add(rendered[scene.id]?.pixelSha256);
  assert.ok(!/[\p{Extended_Pictographic}\uFE0F\u200D]/u.test(scene.label.de), "no emoji titles");
  assert.ok(!/<script|<foreignObject|<text\b/u.test(picture.toString()), "pictures contain shapes, no emoji text fallback");
  for (const phase of ["reveal", "use", "enjoy", "put-away"]) {
    const face = getCharacterActionExpression({ id: 1, kind: scene.id, phase });
    assert.ok(Object.values(face).filter(value => typeof value === "number").every(Number.isFinite), scene.id);
    const pose = getCharacterPropPose(scene.id, phase, false);
    assert.ok(Math.abs(pose.x) <= 124 && pose.y >= -30 && pose.y <= 114, `${scene.id} bounded prop`);
    if (pose.opacity > 0) {
      const size = getCharacterPropSize(scene.id), radians = pose.rotation * Math.PI / 180;
      const [left, top, right, bottom] = rendered[scene.id].propAlphaBounds;
      for (const px of [left, right]) for (const py of [top, bottom]) {
        const dx = (px / 384 - 0.5) * size * pose.scale, dy = (py / 384 - 0.5) * size * pose.scale;
        const x = 180 + pose.x + dx * Math.cos(radians) - dy * Math.sin(radians);
        const y = 197 + pose.y + size / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
        const tilt = face.headTilt * Math.PI / 180, dxFace = x - 180, dyFace = y - face.lift - 130;
        const fx = 180 + dxFace * Math.cos(tilt) - dyFace * Math.sin(tilt);
        const fy = 130 + dxFace * Math.sin(tilt) + dyFace * Math.cos(tilt);
        assert.ok(fx >= 4 && fx <= 356 && fy >= 4 && fy <= 316, `${scene.id}/${phase} painted prop bounds including face tilt ${fx},${fy}`);
      }
    }
    const still = getCharacterPropPose(scene.id, phase, true);
    if (phase !== "put-away") assert.deepEqual([still.rotation, still.scale], [0, 1], `${scene.id} reduced motion`);
  }
  // Every catalog entry reaches its matching frame, completes, and retires.
  const jobs = [], states = [];
  const controller = createCharacterActionController({ now: () => 1000, publish: state => states.push(state),
    schedule: fn => { const job = { fn, active: true }; jobs.push(job); return job; }, unschedule: job => { job.active = false; } });
  controller.setAvailability({ allowed: true, busy: false });
  controller.request(scene.id, "menu");
  assert.equal(controller.getState().active?.kind, scene.id);
  for (let index = 0; index < jobs.length; index++) if (jobs[index].active) jobs[index].fn();
  assert.deepEqual(states.filter(state => state.active).map(state => state.active.phase), ["reveal", "use", "enjoy", "put-away"]);
  assert.equal(controller.getState().active, null);
}
// Contact geometry is tested against the actual mouth coordinate, through the
// complete accent, rather than checking the implementation's pose constants.
for (const scene of CHARACTER_SCENES) {
  const contact = getCharacterPropContact(scene.id);
  if (["sip", "coffee", "bite"].includes(scene.motion)) assert.ok(contact, `${scene.id} has an authored mouth contact`);
  if (!contact) continue;
  const pose = getCharacterPropPose(scene.id, "use");
  for (let beat = 0; beat <= 1; beat += 0.05) {
    const p = getCharacterPropBeatPose(pose, contact, beat, scene.motion === "bite");
    const angle = p.rotation * Math.PI / 180;
    const dx = (contact.x - 12) * 88 / 24 * p.scale, dy = (contact.y - 12) * 88 / 24 * p.scale;
    assert.ok(Math.hypot(p.x + dx * Math.cos(angle) - dy * Math.sin(angle), 197 + p.y + 44 + dx * Math.sin(angle) + dy * Math.cos(angle) - 216) < 0.001,
      `${scene.id} contact stays on mouth throughout accent`);
  }
}
assert.equal(getCharacterActionGaze({ id: 1, kind: "read", phase: "use" }).scan, true);
assert.deepEqual(getCharacterActionGaze({ id: 1, kind: "sympathy", phase: "use" }), { x: 0, y: 0, scan: false });
const sad = getCharacterActionExpression({ id: 1, kind: "sadness", phase: "use" });
const focused = getCharacterActionExpression({ id: 1, kind: "study", phase: "use" });
assert.equal(sad.mouth, "frown"); assert.equal(sad.emotion, "sad");
assert.ok(sad.leftEyeRotation < 0 && sad.rightEyeRotation > 0);
assert.notDeepEqual(sad, focused, "sadness differs from concentration without relying on its prop");
assert.equal(hashes.size, 200, "all 200 PNGs differ in rendered pixels, not merely names");
assert.equal(isCharacterScene("invented-action"), false);
assert.deepEqual(findCharacterScenes("no-such-situation-9847"), []);
assert.ok(findCharacterScenes("trinken").some(scene => scene.id === "drink"));

for (const [text, expected] of [
  ["Ich bin traurig.", "sadness"], ["My cat passed away.", "sympathy"], ["Meine Katze ist gestorben.", "sympathy"],
  ["My cat is sick", null], ["Mein Hund wird vermisst", null], ["My cat died", null],
  ["Менi сумно", null], ["Мені сумно", "sadness"], ["Мне грустно", "sadness"],
  ["Mir ist kalt", "cold"], ["Ich muss lernen", "study"], ["Lass uns kochen", "cooking"],
  ["Ich bin nicht traurig", null], ["I am not happy", null], ["Wenn ich bin traurig, was dann?", null],
  ['Er sagt: "Ich bin traurig"', null], ["Er sagte ich bin traurig", null], ["Sag ich bin traurig", null],
  ["Sie sagte 'ich bin traurig'.", null], ["'I am happy' is an example.", null],
  ["Stell dir vor, ich bin traurig", null], ["Erzähl eine Geschichte: ich bin traurig", null],
  ["Imagine I am happy", null], ["My friend said I am happy", null],
  ["Was passiert, wenn ich bin traurig?", null], ["What happens if I am happy?", null],
  ["Kannst du mir sagen ich bin traurig?", null], ["Wie übersetzt man ich bin traurig?", null],
  ["In a story I am sad", null], ["Представь, мне грустно", null], ["Уяви, мені сумно", null],
  ["З’їж печиво", "snack"], ["З'їж печиво", "snack"],
  ["Übersetze bitte ich bin traurig", "translation"], ["What does I am happy mean?", null],
  ["Unser WLAN ist kaputt", null], ["Dein Akku ist leer", null], ["Du hast mich verstanden", null],
  ["Ich bin angekommen und es regnet", null], ["Zeig mir ein unbekanntes Bild", null],
]) assert.equal(selectCharacterScene(text)?.kind ?? null, expected, text);
assert.equal(selectCharacterScene("R2.0, zeig mir Teepause", "R2.0")?.kind, "tea");
for (const id of ["sadness", "sympathy", "frustration", "anger", "overwhelmed", "medicine", "bandage"]) {
  for (const phase of ["use", "enjoy", "put-away"]) {
    const face = getCharacterActionExpression({ id: 1, kind: id, phase });
    assert.ok(!["pleased", "victory", "happy", "excited"].includes(face.emotion), `${id} does not turn distress into celebration`);
  }
}
for (const scene of CHARACTER_SCENES.filter(scene => scene.category === "technology")) assert.equal(scene.context.length, 0, `${scene.id} cannot invent real status from conversation`);
for (const scene of CHARACTER_SCENES.filter(scene => scene.motion === "rest")) {
  const poses = ["reveal", "use", "enjoy", "put-away"].map(phase => getCharacterPropPose(scene.id, phase));
  assert.equal(new Set(poses.map(pose => `${pose.x},${pose.y},${pose.rotation},${pose.scale}`)).size, 1, "comfort and rest fade in place");
}
execFileSync(process.execPath, ["scripts/build-character-scenes.mjs", "--check"], { stdio: "pipe" });
console.log("PASS 200 character scenes: unique renders, source hashes, 800 localized selections, search, context boundaries, full lifecycle and reproducible pictures");
