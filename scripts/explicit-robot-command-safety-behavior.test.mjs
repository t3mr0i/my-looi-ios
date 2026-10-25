import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTsCommonJs(path) {
  const source = fs.readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports,
    require,
    module,
    path,
    process.cwd()
  );
  return module.exports;
}

const { containsEmergencyStopWord, parseExplicitRobotCommand } = loadTsCommonJs("src/voice/explicit-robot-command.ts");

const rejectedCommands = [
  ["Луи, не двигайся вперед", "Russian negation must not move the robot"],
  ["Луи, не кивай", "Russian negation must not nod"],
  ["Луи, не спи", "Russian negation must not change sleep state"],
  ["Луи, don't move forward", "English negation must not move the robot"],
  ["Луи, don't nod", "English negation must not nod"],
  ["Луи, don't sleep", "English negation must not change sleep state"],
  ["Луи, should you move forward?", "A question must not move the robot"],
  ["Луи, can you nod", "An interrogative request must not nod even without STT punctuation"],
  ["Луи, sleep?", "A question must not change sleep state"],
  ["Looi, do you dance", "A do-question must not trigger a physical action"],
  ["Луи, «двигайся вперед»", "A quoted movement command must not move the robot"],
  ["Луи, 'кивай'", "A single-quoted gesture must not nod"],
  ["Луи, \"спи\"", "A double-quoted sleep command must not change sleep state"],
  ["Looi, the phrase move forward is an example", "An unquoted English mention must not move the robot"],
  ["Луи, фраза двигайся вперед это пример", "An unquoted Russian mention must not move the robot"],
  ["Луї, фраза рухайся вперед це приклад", "An unquoted Ukrainian mention must not move the robot"],
  ["Looi, if I say move forward then wait", "An English conditional must not move the robot"],
  ["Луи, если я скажу двигайся вперед то просто жди", "A Russian conditional must not move the robot"],
  ["Луї, якщо я скажу рухайся вперед то зачекай", "A Ukrainian conditional must not move the robot"],
];

for (const [utterance, reason] of rejectedCommands) {
  assert.equal(parseExplicitRobotCommand(utterance), null, `${reason}: ${utterance}`);
}

assert.deepEqual(parseExplicitRobotCommand("Луи, двигайся вперед"), { kind: "move", direction: "forward" });
assert.deepEqual(parseExplicitRobotCommand("Луи, кивай"), { kind: "gesture", gesture: "nod", count: 1 });
assert.deepEqual(parseExplicitRobotCommand("Луи, спи"), { kind: "sleep" });
assert.deepEqual(parseExplicitRobotCommand("Looi, please move forward."), { kind: "move", direction: "forward" });
assert.deepEqual(parseExplicitRobotCommand("Looi, do a dance."), { kind: "dance" }, "imperative 'do a dance' must not be mistaken for a question");

const customDanceConfig = {
  listeningLanguage: "en",
  customVoiceCommands: { dance: [{ id: "custom-dance", text: "little hello", language: "en" }] },
};
assert.deepEqual(parseExplicitRobotCommand("Looi, little hello", customDanceConfig), { kind: "dance" });
assert.equal(parseExplicitRobotCommand("Looi, 'little hello'", customDanceConfig), null, "quoted custom actions must also be suppressed");
assert.equal(parseExplicitRobotCommand("Looi, can you little hello?", customDanceConfig), null, "question-form custom actions must also be suppressed");

assert.equal(containsEmergencyStopWord("please don't say stop"), true, "global STOP remains active inside negated speech");
assert.equal(containsEmergencyStopWord("Луи, не двигайся, стоп"), true, "global STOP remains active with other command text");
assert.deepEqual(parseExplicitRobotCommand("Луи, не двигайся, стоп"), { kind: "move", direction: "stop" }, "explicit STOP keeps priority over negation");
assert.deepEqual(parseExplicitRobotCommand("Луи, стоп?"), { kind: "move", direction: "stop" }, "global STOP keeps priority over question punctuation");

console.log("Explicit robot command safety behavior tests passed");
