import assert from "node:assert/strict";
import fs from "node:fs";

const pcm = fs.readFileSync("src/voice/realtime-pcm-conversation.ts", "utf8");
const helper = fs.readFileSync("src/voice/realtime-physical-command.ts", "utf8");
const config = fs.readFileSync("src/voice/realtime-config.ts", "utf8");

assert.match(
  pcm,
  /parseRealtimePhysicalCommand\(\s*transcript(?:\s*,\s*useUserStore\.getState\(\)\.preferences)?\s*\)/,
  "PCM transcript must be checked for deterministic physical commands"
);
assert.ok(pcm.includes('executeRealtimePhysicalCommand(physicalCommand, transcript)'), "PCM must execute intercepted physical commands locally");
assert.ok(pcm.includes('type: "response.cancel"'), "Realtime response must be cancellable when a local physical command is intercepted");
assert.ok(pcm.includes('pcm-response-suppressed-for-local-command') || pcm.includes('pcm-response-suppressed-for-physical-command'), "late response.created events must be suppressed during local physical execution");
assert.match(pcm, /if \(this\.localPhysicalCommandInFlight(?: \|\| this\.localVisualCommandInFlight)?\) return;/, "generated model audio/transcript must not leak through while a local physical command is executing");

assert.match(
  helper,
  /parseExplicitRobotCommand\(\s*transcript(?:\s*,\s*config)?\s*\)/,
  "Realtime routing must reuse the deterministic addressed-command parser"
);
assert.match(
  helper,
  /containsEmergencyStopWord\(\s*transcript(?:\s*,\s*config)?\s*\)/,
  "standalone STOP must remain an absolute safety command"
);
assert.ok(helper.includes('await moveLooi(command.direction)'), "Realtime forward/backward movement must use the bounded motion primitive");
assert.equal(helper.includes('startLooiMotion('), false, "Realtime PCM must not start continuous translation without the local STOP microphone path");
assert.ok(helper.includes('await turnLooi(command.direction, command.degrees)'), "turns must use calibrated bounded motion");
assert.ok(helper.includes('await performLooiHeadGesture(command.gesture, command.count)'), "head gestures must remain available");
assert.ok(helper.includes('await performLooiDance("random")'), "bounded dance remains available through the safety controller");

// The model now has movement tools from the capability manifest. The original
// safety invariant is kept in a different form: the model-facing executor may
// only reach the same bounded primitives and never continuous translation.
const capabilityDefinitions = fs.readFileSync("src/voice/robot-capability-tool-definitions.ts", "utf8");
const capabilityBridge = fs.readFileSync("src/voice/robot-capability-tools.ts", "utf8");
assert.ok(config.includes('buildRobotCapabilityInstructions({ mode: "realtime" })'), "Realtime instructions come from the shared capability manifest");
assert.ok(capabilityDefinitions.includes("intercepted and executed deterministically by the local app"), "Realtime instructions must describe the local deterministic handoff");
assert.equal(capabilityBridge.includes("startLooiMotion"), false, "model movement tools must not start continuous translation");
assert.equal(capabilityBridge.includes("driveLooiForDuration"), false, "model movement tools must not choose their own drive duration");
assert.ok(capabilityBridge.includes(".moveLooi(direction)"), "model forward/backward movement uses the default bounded primitive");
assert.ok(capabilityBridge.includes("runtime.isStopRequest(turn.userText)"), "a STOP in the user turn blocks model-initiated movement");

console.log("Realtime PCM physical command routing regression: PASS");
