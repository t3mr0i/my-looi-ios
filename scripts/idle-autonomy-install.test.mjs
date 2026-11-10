import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

// Production wiring of idle autonomy: which app states make it yield, and that
// a wheel action can only be armed through the same local STOP path that
// explicit voice moves use (prepareDrivingControl, then armEmergencyForMotion).
const calls = [];
let captured = null;
const appState = { currentState: "active" };
const platform = { OS: "ios" };
const user = {
  robotSleeping: false, voiceState: "sleeping",
  preferences: { idleAutonomyLevel: "explore", cameraAttentionEnabled: true },
};
const conversation = { isUserSpeaking: false, isListening: false, isProcessing: false, isSpeaking: false };
let mainFocused = true;
let drivingSession = false;
let mood = null;
let bridgeListener = null;
let skillsListener = null;
const voiceRuntime = { isMediaExternallyOwned: false };
const feeder = { diagnosticStatus: { pcmFlowing: true }, subscribeSamples(listener) { calls.push("subscribeSamples"); return () => {}; } };
let voskReady = true;
let armResult = true;

const install = loadTypeScript("src/robot-mind/idle-autonomy-install.ts", {
  "react-native": { AppState: appState, Platform: platform },
  "../character/character-reaction": { useCharacterReactionStore: { getState: () => ({ mood }) } },
  "../core/ambient-motion": {
    getAmbientMotionControllerState: () => ({ actionInFlight: false }),
    holdAmbientMotionFor: () => {},
    subscribeAmbientMotionInteractions: () => () => {},
  },
  "../core/main-screen-presence": { isMainScreenFocused: () => mainFocused },
  "../core/social-attention": {
    getSocialAttentionControllerState: () => ({ running: true, bodyMotionInFlight: false }),
    holdSocialAttentionMotionFor: () => {},
    setSocialIdleLookRequested: (value) => calls.push(`camera:${value}`),
  },
  "../device-tools/looi-robot": {
    driveLooiForDuration: (...args) => { calls.push(["drive", ...args.slice(0, 2)]); return Promise.resolve({ completed: true }); },
    getLooiRobotRuntimeState: () => ({ connected: false }),
    performLooiBehaviorHeadGesture: () => Promise.resolve({ completed: true }),
    setLooiHead: (position, options) => { calls.push(["head", position, options.priority]); return Promise.resolve({ completed: true }); },
    subscribeLooiRobotRuntimeState: () => () => {},
  },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../perceivers/voice-runtime": { voiceRuntime },
  "../robot-bridge/app-skill-runtime": { subscribeRobotAppSkills: (listener) => { skillsListener = listener; return () => {}; } },
  "../robot-bridge/runtime": { subscribeRobotBridgeRuntimeStatus: (listener) => { bridgeListener = listener; return () => {}; } },
  "../store/conversation": { useConversationStore: { getState: () => conversation } },
  "../store/user": { useUserStore: { getState: () => user } },
  "../voice/driving-control-session": { isDrivingControlSessionActive: () => drivingSession },
  "./body-state": { robotBodyState: { name: "shared-body-state" } },
  "./idle-autonomy-runtime": {
    createIdleAutonomyRuntime(deps) {
      captured = deps;
      return { start() { calls.push("start"); }, stop(reason) { calls.push(`stop:${reason}`); }, getSnapshot: () => ({ mode: "resting" }) };
    },
  },
  "../voice/kws-audio-feeder": { kwsAudioFeeder: feeder },
  "../voice/wakeword": { wakewordService: { async prepareDrivingControl() { calls.push("prepareDrivingControl"); return voskReady; } } },
  "../voice/vosk-driving-command": { voskDrivingCommandRecognizer: {
    async armEmergencyForMotion(reason, ms) { calls.push(["arm", reason, ms]); return armResult; },
    async disarmEmergency(reason) { calls.push(["disarm", reason]); },
  } },
}, { setTimeout, clearTimeout, Promise });

const uninstall = install.installIdleAutonomyRuntime();
assert.equal(typeof install.installIdleAutonomyRuntime(), "function", "a second install is a no-op");
assert.equal(calls.filter((call) => call === "start").length, 1, "installed once");
assert.equal(captured.bodyState.name, "shared-body-state", "writes to the shared body state");
assert.equal(captured.getLevel(), "explore");
user.preferences.idleAutonomyLevel = undefined;
assert.equal(captured.getLevel(), "look", "a store without the field falls back to look, never explore");
user.preferences.idleAutonomyLevel = "explore";
assert.equal(captured.linkLossSelfStopConfirmed(), false, "a store without the field never confirms the link-loss check");
for (const value of ["true", 1, "checked", null]) {
  user.preferences.linkLossSelfStopConfirmed = value;
  assert.equal(captured.linkLossSelfStopConfirmed(), false, `only true confirms: ${JSON.stringify(value)}`);
}
user.preferences.linkLossSelfStopConfirmed = true;
assert.equal(captured.linkLossSelfStopConfirmed(), true);
user.preferences.linkLossSelfStopConfirmed = false;
assert.equal(captured.quietSensorBasisEnabled(), false, "a store without the field never enables the quiet sensor basis");
for (const value of ["true", 1, "checked", null]) {
  user.preferences.edgeFramesOnlyOnChangeConfirmed = value;
  assert.equal(captured.quietSensorBasisEnabled(), false, `only true enables it: ${JSON.stringify(value)}`);
}
user.preferences.edgeFramesOnlyOnChangeConfirmed = true;
assert.equal(captured.quietSensorBasisEnabled(), true);
user.preferences.edgeFramesOnlyOnChangeConfirmed = false;

// The STOP listener is not live until the voice modules have loaded, and never on web.
assert.equal(captured.stopListener.isLive(), false);
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(captured.stopListener.isLive(), true);
feeder.diagnosticStatus.pcmFlowing = false;
assert.equal(captured.stopListener.isLive(), false, "no PCM, no STOP listener");
feeder.diagnosticStatus.pcmFlowing = true;
platform.OS = "web";
assert.equal(captured.stopListener.isLive(), false);
platform.OS = "ios";

calls.length = 0;
assert.equal(await captured.stopListener.arm("idle-autonomy-turn", 1_800), true);
assert.deepEqual(calls, ["prepareDrivingControl", ["arm", "idle-autonomy-turn", 1_800]], "the STOP handler is registered before arming");
voskReady = false;
calls.length = 0;
assert.equal(await captured.stopListener.arm("idle-autonomy-step", 1_900), false, "an unready Vosk model means no wheel action");
assert.deepEqual(calls, ["prepareDrivingControl"]);
voskReady = true;
armResult = false;
assert.equal(await captured.stopListener.arm("idle-autonomy-step", 1_900), false);
armResult = true;
await captured.stopListener.disarm("done");

// Head motion uses the behavior priority, so camera attention and explicit commands still win.
await captured.motion.setHead("up", () => true);
assert.deepEqual(calls.at(-1), ["head", "up", "behavior"]);

// Yield reasons.
assert.equal(captured.getYieldReason(), null);
const expectations = [
  [() => { appState.currentState = "background"; }, () => { appState.currentState = "active"; }, "app-not-active"],
  [() => { user.robotSleeping = true; }, () => { user.robotSleeping = false; }, "robot-sleeping"],
  [() => { mainFocused = false; }, () => { mainFocused = true; }, "main-not-focused"],
  [() => { user.voiceState = "listening"; }, () => { user.voiceState = "sleeping"; }, "voice-listening"],
  [() => { conversation.isUserSpeaking = true; }, () => { conversation.isUserSpeaking = false; }, "user-speaking"],
  [() => { conversation.isSpeaking = true; }, () => { conversation.isSpeaking = false; }, "conversation"],
  [() => { drivingSession = true; }, () => { drivingSession = false; }, "driving-control"],
  [() => { voiceRuntime.isMediaExternallyOwned = true; }, () => { voiceRuntime.isMediaExternallyOwned = false; }, "robot-app-media"],
  [() => bridgeListener({ mediaOwner: "app" }), () => bridgeListener({ mediaOwner: null }), "robot-app-media"],
  [() => skillsListener({ activeApp: { spaceId: "x" } }), () => skillsListener({ activeApp: null }), "robot-app"],
  [() => { mood = "pleased"; }, () => { mood = null; }, "character-reaction"],
];
for (const [enter, leave, reason] of expectations) {
  enter();
  assert.equal(captured.getYieldReason(), reason);
  leave();
  assert.equal(captured.getYieldReason(), null, `${reason} cleared`);
}

// The camera is only offered when the user enabled camera attention.
assert.equal(captured.camera.available(), true);
user.preferences.cameraAttentionEnabled = false;
assert.equal(captured.camera.available(), false);
captured.camera.request();
captured.camera.release();
assert.deepEqual(calls.slice(-2), ["camera:true", "camera:false"]);

uninstall();
assert.equal(calls.at(-1), "stop:uninstalled");
console.log("Idle autonomy install: STOP path order, yield reasons, camera opt-in, behavior head priority PASS");
