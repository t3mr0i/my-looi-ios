import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Audio interval Swift bridge: requires macOS; not executed");
  process.exit(0);
}
const native = fs.readFileSync("node_modules/@siteed/audio-studio/ios/RecordingSettings.swift", "utf8");
const assignment = native.split("\n").find((line) => /^\s*settings\.interval = /.test(line));
assert.ok(assignment, "the installed native interval parser must be present");
// Run the owning parser expression against the raw Double produced by Expo
// JavaScriptValue.getAny(), as well as legacy integer/NSNumber dictionaries.
const expression = assignment.slice(assignment.indexOf("=") + 1).trim();
const swift = `import Foundation
func parse(_ dict: [String: Any]) -> Int? { return ${expression} }
let cases: [([String: Any], Int?)] = [
  (["interval": Double(100)], 100), (["interval": Int(100)], 100),
  (["interval": NSNumber(value: 100)], 100), ([:], nil)
]
for (input, expected) in cases {
  if parse(input) != expected {
    fputs("Native audio interval rejected a valid JS numeric value\\n", stderr); exit(1)
  }
}
print("Audio interval Swift bridge: Double, Int, NSNumber and missing value passed")
`;
const result = spawnSync("swift", ["-e", swift], { encoding: "utf8", timeout: 60000 });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr.slice(0, 2000)}`);
process.stdout.write(result.stdout);
