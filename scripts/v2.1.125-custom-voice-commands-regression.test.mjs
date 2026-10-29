import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const loadCharacterModule = createTypeScriptTreeLoader();
import assert from "node:assert/strict";
import fs from "node:fs";
import { getSupportedInterfaceLanguageCount } from "./helpers/ui-language-count.mjs";
import { getStoredPreferencesVersionInfo } from "./helpers/stored-preferences-version.mjs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const read = (path) => fs.readFileSync(path, "utf8");
const uiLanguageCount = getSupportedInterfaceLanguageCount();
const pkg = JSON.parse(read("package.json"));
const app = JSON.parse(read("app.json"));
const patchVersion = Number(pkg.version.split(".")[2]);
assert.ok(patchVersion >= 125);
assert.equal(app.expo.version, pkg.version);
assert.ok(app.expo.android.versionCode >= 125);

const user = read("src/store/user.ts");
assert.match(user, /robotName: string/);
assert.match(user, /robotAddressAliases: string\[\]/);
assert.match(user, /robotAddressRecognitionAliases: string\[\]/);
assert.match(user, /customVoiceCommands: CustomVoiceCommandMap/);
const preferenceVersions = getStoredPreferencesVersionInfo(user);
assert.ok(preferenceVersions.currentVersion >= 9);
assert.equal(preferenceVersions.migrationVersion, preferenceVersions.currentVersion);
assert.ok(preferenceVersions.supportedVersions.includes(preferenceVersions.currentVersion));
for (let version = 1; version <= 9; version++) {
  assert.ok(preferenceVersions.supportedVersions.includes(version), `stored preferences version ${version} remains supported`);
}

const explicit = read("src/voice/explicit-robot-command.ts");
assert.match(explicit, /configuredAddresses\(config/);
assert.match(explicit, /config\?\.robotName/);
assert.match(explicit, /config\?\.robotAddressAliases/);
assert.match(explicit, /config\?\.robotAddressRecognitionAliases/);
assert.match(explicit, /customVoiceCommands\?\.emergency_stop/);
assert.match(explicit, /phrase\.language === listeningLanguage/);
assert.match(explicit, /"макс", "max"/, "legacy Max address aliases must remain accepted");
assert.match(explicit, /hasMoveVerb/, "existing deterministic movement grammar must remain intact");
assert.match(explicit, /isBareDirectionCommand/, "existing bare-direction addressed grammar must remain intact");

const settings = read("app/(tabs)/settings.tsx");
assert.match(settings, /VoiceCommandsSettings/);
assert.match(settings, /VOICE_COMMAND_ACTIONS/);
assert.match(settings, /parseRealtimePhysicalCommand\(testText(?:, preferences)?\)/, "settings test must parse only and never execute movement");
assert.doesNotMatch(settings, /executeRealtimePhysicalCommand\(testText\)/);
assert.match(settings, /voicesExpanded/, "long voice list must be collapsible");
assert.match(settings, /recognitionExpanded/, "STT recovery aliases must remain tucked away");

const ambient = read("src/core/ambient-motion.ts");
assert.match(ambient, /BODY_PIVOT_MIN_MS = 180/);
assert.match(ambient, /BODY_PIVOT_MAX_MS = 230/);
const robot = read("src/device-tools/looi-robot.ts");
assert.match(robot, /Math\.min\(240/, "ambient primitive must allow the stronger calibrated micro-pivot");
assert.match(robot, /ambientMotion: true/);

const sleep = read("src/core/sleep-mode.ts");
assert.match(sleep, /wake: "single-tap-face"/);
const home = read("app/(tabs)/index.tsx");
assert.match(home, /if \(robotSleeping\)[\s\S]*wakeRobotFromFace\(\)/);
const { resolveFaceExpression } = loadCharacterModule("src/character/face-expression.ts");
const sleepingFace = resolveFaceExpression("sleeping", "", null);
assert.equal(sleepingFace.emotion, "sleeping");
assert.equal(sleepingFace.leftEyeScaleY, 0.12);
assert.equal(sleepingFace.rightEyeScaleY, 0.12);
assert.equal(sleepingFace.mouth, "none");

const strings = read("src/i18n/ui-strings.ts");
for (const key of ["settings.voiceCommands", "settings.robotPrimaryName", "settings.voiceCommandsTest", "settings.voiceAction.forward"]) {
  assert.equal((strings.match(new RegExp(`"${key.replaceAll(".", "\\.")}":`, "g")) ?? []).length, uiLanguageCount, `${key} must exist in all UI languages`);
}
assert.equal((strings.match(/"home\.wakeFromSleep":/g) ?? []).length, uiLanguageCount);

console.log("v2.1.125 custom voice commands + sleep/body calibration regression: PASS");
