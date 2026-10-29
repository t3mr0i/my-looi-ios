import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";

const require = createRequire(import.meta.url);
const loadTs = createTypeScriptTreeLoader();

const { matchWakePhrase } = loadTs("src/voice/wake-phrases.ts");
assert.deepEqual(matchWakePhrase("Louis, fahr vorwärts", "de"), {
  id: "de",
  displayText: "Louis",
  commandSuffix: "fahr vorwärts",
  hasCommandSuffix: true,
});
assert.deepEqual(matchWakePhrase("Louie", "de"), {
  id: "de",
  displayText: "Louis",
  commandSuffix: "",
  hasCommandSuffix: false,
});
assert.deepEqual(matchWakePhrase("Lui, dreh dich nach links", "de"), {
  id: "de",
  displayText: "Louis",
  commandSuffix: "dreh dich nach links",
  hasCommandSuffix: true,
});

const { parseDrivingCommandTranscript } = loadTs("src/voice/driving-command.ts");
assert.deepEqual(parseDrivingCommandTranscript("Bitte fahr vorwärts", "de"), {
  kind: "move", direction: "forward",
});
assert.deepEqual(parseDrivingCommandTranscript("fahr nach hinten", "de"), {
  kind: "move", direction: "backward",
});
assert.deepEqual(parseDrivingCommandTranscript("dreh dich nach links", "de"), {
  kind: "turn", direction: "left", degrees: 90,
});
assert.deepEqual(parseDrivingCommandTranscript("nicke zweimal", "de"), {
  kind: "gesture", gesture: "nod", count: 2,
});
assert.deepEqual(parseDrivingCommandTranscript("mach das Licht aus", "de"), {
  kind: "light", enabled: false,
});
assert.deepEqual(parseDrivingCommandTranscript("Stopp", "de"), { kind: "stop" });
assert.deepEqual(parseDrivingCommandTranscript("fahrmodus beenden", "de"), { kind: "exit" });
assert.equal(parseDrivingCommandTranscript("ich glaube, er fährt vorwärts", "de"), null,
  "arbitrary German conversation must stay outside the local driving command vocabulary");

const { buildDrivingCommandGrammar } = loadTs("src/voice/driving-command-grammar.ts");
const grammar = buildDrivingCommandGrammar("de");
assert.equal(grammar.commandByPhrase.get("louis fahr vorwärts")?.kind, "move");
assert.deepEqual(grammar.commandByPhrase.get("dreh dich nach links"), {
  kind: "turn", direction: "left", degrees: 90,
});
assert.equal(grammar.commandByPhrase.get("stopp")?.kind, "stop");
assert.ok(grammar.phrases.includes("[unk]"), "unknown speech must remain non-executable");

const { containsEmergencyStopWord, parseExplicitRobotCommand } = loadTs("src/voice/explicit-robot-command.ts");
assert.deepEqual(parseExplicitRobotCommand("Louis, fahr vorwärts"), {
  kind: "move", direction: "forward",
});
assert.deepEqual(parseExplicitRobotCommand("Louis, dreh dich nach links"), {
  kind: "turn", direction: "left", degrees: 90,
});
assert.deepEqual(parseExplicitRobotCommand("Louis, nicke zweimal"), {
  kind: "gesture", gesture: "nod", count: 2,
});
assert.equal(parseExplicitRobotCommand("Louis, fahr nicht vorwärts"), null,
  "German negation must not execute a movement command");
assert.equal(parseExplicitRobotCommand("Louis, kannst du vorwärts fahren"), null,
  "German questions must not execute a movement command");
assert.equal(parseExplicitRobotCommand("Louis, wenn ich vorwärts sage"), null,
  "German conditional or quoted-command references must remain inert");
assert.deepEqual(parseExplicitRobotCommand("Louis, Stopp?"), {
  kind: "move", direction: "stop",
}, "emergency STOP keeps priority over question punctuation");
assert.equal(containsEmergencyStopWord("Stopp!"), true,
  "German STOP must be global and independent of the robot address");

const preferences = {
  robotName: "LOOI",
  robotAddressAliases: [],
  robotAddressRecognitionAliases: [],
  listeningLanguage: "de",
  customVoiceCommands: {},
};
const { parseRealtimeVisualCommand } = loadTs("src/voice/realtime-visual-command.ts");
assert.deepEqual(parseRealtimeVisualCommand("Louis, schau mal", preferences), {
  kind: "look-here", cameraFacing: "front",
});
assert.deepEqual(parseRealtimeVisualCommand("Louis, schau mal durch die Rückkamera", preferences), {
  kind: "look-here", cameraFacing: "back",
});

const { executeRealtimePhysicalCommand } = createTypeScriptTreeLoader({
  "../core/sleep-mode": { enterRobotSleepMode: async () => undefined },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../device-tools/looi-robot": { stopLooiMotion: async () => undefined },
  "../store/user": { useUserStore: { getState: () => ({ preferences: { language: "de" } }) } },
})("src/voice/realtime-physical-command.ts");
const germanStopAck = await executeRealtimePhysicalCommand({ kind: "emergency-stop" }, "Stopp");
assert.equal(germanStopAck.acknowledgement, "Ich stehe.");

const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "german-vosk-stage-"));
try {
  for (const language of ["ru", "uk", "en", "de"]) {
    const modelDir = path.join(modelRoot, ".build-assets", "vosk", `vosk-command-${language}`, "am");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "final.mdl"), "model-placeholder");
  }
  const { stageIosVoskModels } = require("./stage-ios-vosk-models.cjs");
  stageIosVoskModels(modelRoot);
  assert.ok(fs.existsSync(path.join(modelRoot, "modules/vosk-command-recognizer/ios/Models/vosk-command-de.bundle/am/final.mdl")));
} finally {
  fs.rmSync(modelRoot, { recursive: true, force: true });
}

const modelScript = fs.readFileSync("scripts/download-vosk-command-models.sh", "utf8");
assert.match(modelScript, /vosk-model-small-de-0\.15/);
assert.match(modelScript, /https:\/\/alphacephei\.com\/vosk\/models\/vosk-model-small-de-0\.15\.zip/);
assert.match(fs.readFileSync("src/voice/kws-keywords.ts", "utf8"), /L UW1 IY0 S :2\.3 #0\.20 @LOOI/);
assert.match(fs.readFileSync("src/voice/kws-keywords.ts", "utf8"), /SH T AO1 P :4\.5 #0\.08 @STOP/);
assert.match(fs.readFileSync("plugins/with-vosk-command-models.js", "utf8"), /vosk-command-de/);
assert.match(fs.readFileSync("modules/vosk-command-recognizer/ios/VoskCommandRecognizerModule.swift", "utf8"), /vosk-command-de/);

console.log("German voice support behavior: PASS");
