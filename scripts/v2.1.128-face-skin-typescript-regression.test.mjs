import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const pkg = JSON.parse(read("package.json"));
const app = JSON.parse(read("app.json"));

const patchVersion = Number(pkg.version.split(".")[2]);
assert.ok(Number.isInteger(patchVersion) && patchVersion >= 128);
assert.equal(app.expo.version, pkg.version);
assert.ok(app.expo.android.versionCode >= 128);

const face = read("src/ui/RobotFace.tsx");
assert.doesNotMatch(face, /\bEYE_COLOR\b/, "removed legacy EYE_COLOR constant must not be referenced");
const mouthRendererStart = face.indexOf("function ExpressiveMouth(");
const mouthRendererEnd = face.indexOf("const styles = StyleSheet.create", mouthRendererStart);
assert.ok(mouthRendererStart >= 0 && mouthRendererEnd > mouthRendererStart, "expressive mouth renderer stays local and inspectable");
const mouthRenderer = face.slice(mouthRendererStart, mouthRendererEnd);
assert.match(face, /<ExpressiveMouth[\s\S]*color=\{palette\.mouthColor\}/, "the selected face palette supplies mouth color");
assert.match(mouthRenderer, /<GlassMouth \{\.\.\.props\}/, "resolved mouth, palette and shared motion reach the glass renderer");
const glass = read("src/ui/GlassFace.tsx");
assert.match(glass, /stopColor=\{palette\.mouth\[0\]\}/, "the selected palette still colors the mouth contour");
assert.match(glass, /curve: shape === "smile"/);
assert.match(glass, /round: shape === "dot"/);
assert.ok(/FACE_SKINS/.test(face) || /FACE_STYLES/.test(face));

// This patch is deliberately build-only: do not touch protected movement/audio paths.
const pcm = read("src/voice/realtime-pcm-conversation.ts");
const robot = read("src/device-tools/looi-robot.ts");
assert.ok(pcm.includes("VOICE_COMMUNICATION") || read("modules/realtime-pcm-audio/android/src/main/java/com/superlooi/realtimepcmaudio/RealtimePcmAudioModule.kt").includes("VOICE_COMMUNICATION"));
assert.match(robot, /ambientMotion: true/);

console.log("v2.1.128 face-skin TypeScript build regression: PASS");
