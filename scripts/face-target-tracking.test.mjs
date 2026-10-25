import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function compileTs(file, customRequire = require) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    module.exports, customRequire, module, file, path.dirname(file),
  );
  return module.exports;
}

const trackerModule = compileTs("src/core/face-target-tracking.ts");
const tracker = trackerModule.createFaceTargetTracker(500, 8);
const face = (centerX, width, centerY = 0.5, height = 0.2) => ({
  left: centerX - width / 2,
  top: centerY - height / 2,
  right: centerX + width / 2,
  bottom: centerY + height / 2,
  centerX,
  centerY,
  width,
  height,
});

const original = tracker.update([face(0.25, 0.18), face(0.73, 0.11)], 1_000);
const firstId = original[0].id;
const secondId = original[1].id;
const reorderedAndResized = tracker.update([face(0.71, 0.13), face(0.27, 0.21)], 1_150);
assert.deepEqual(reorderedAndResized.map((item) => item.id), [secondId, firstId], "tracks must follow nearby boxes through ordering and size changes");

tracker.update([], 1_400);
const beforeExpiry = tracker.update([face(0.26, 0.2)], 1_600);
assert.equal(beforeExpiry[0].id, firstId, "a brief missed frame must preserve the temporary target ID");
tracker.update([], 2_200);
const afterExpiry = tracker.update([face(0.26, 0.2)], 2_201);
assert.notEqual(afterExpiry[0].id, firstId, "an expired track must receive a new temporary ID");

// Exercise the controller seam: explicit selection wins, an invalid selection
// falls back to the last valid target, then to the largest current face.
const store = (initial) => {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState: (next) => { state = { ...state, ...next }; for (const listener of listeners) listener(state); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
};
const conversationStore = store({ isUserSpeaking: false, isProcessing: false, isSpeaking: false });
const userStore = store({
  preferences: { cameraAttentionEnabled: true },
  robotSleeping: false,
});
const nativeListeners = new Map();
const nativeModule = {
  addListener(name, listener) {
    nativeListeners.set(name, listener);
    return { remove: () => nativeListeners.delete(name) };
  },
  async start() { return { running: true, permissionGranted: true, lensFacing: "front" }; },
  async stop() { return { running: false }; },
};
const zustandCreate = (initializer) => {
  let value;
  const listeners = new Set();
  const set = (next) => { value = { ...value, ...(typeof next === "function" ? next(value) : next) }; for (const listener of listeners) listener(value); };
  value = initializer(set, () => value);
  const useStore = () => value;
  useStore.getState = () => value;
  useStore.setState = set;
  useStore.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return useStore;
};
const socialRequire = (id) => {
  if (id === "zustand") return { create: zustandCreate };
  if (id === "../../modules/local-face-attention") return { getLocalFaceAttentionModule: () => nativeModule };
  if (id === "../device-tools/looi-robot") return {
    getLooiRobotRuntimeState: () => ({ connected: false, driveControlReady: false, motionActive: false }),
    performLooiSocialAttentionPivot: async () => ({ completed: false }),
    setLooiHead: async () => ({ completed: false }),
  };
  if (id === "../diagnostics/diagnostic-log") return { recordDiagnosticEvent() {} };
  if (id === "../store/conversation") return { useConversationStore: conversationStore };
  if (id === "../store/user") return { useUserStore: userStore };
  if (id === "../voice/driving-control-session") return { isDrivingControlSessionActive: () => false };
  if (id === "./ambient-motion") return {
    getAmbientMotionControllerState: () => ({ actionInFlight: false, currentAction: null }),
    holdAmbientHeadMotionFor() {},
    holdAmbientMotionFor() {},
  };
  if (id === "./main-screen-presence") return {
    isMainScreenFocused: () => true,
    subscribeMainScreenFocused: () => () => undefined,
  };
  if (id === "./face-target-tracking") return trackerModule;
  return require(id);
};

const originalDateNow = Date.now;
let receiveNow = 5_000;
Date.now = () => receiveNow;
const social = compileTs("src/core/social-attention.ts", socialRequire);
let requestedTargetId = null;
social.configureSocialBehaviorPolicy(() => ({ attention: "keep", selectedFaceId: requestedTargetId }));
social.startSocialAttentionController("face-target-test");
social.noteSocialAttentionInteraction("face-target-test");
for (let i = 0; i < 12; i += 1) await Promise.resolve();
const onFaceFrame = nativeListeners.get("onFaceFrame");
assert.equal(typeof onFaceFrame, "function", "the local camera event should be subscribed");

const a = face(0.28, 0.2);
const b = face(0.72, 0.12);
onFaceFrame({ timestampMs: 1, faceCount: 2, primary: a, faces: [a, b] });
let state = social.getSocialAttentionControllerState();
assert.equal(state.faces.length, 2);
assert.equal(state.selectedFaceId, state.faces[0].id, "largest face is the initial fallback target");
assert.equal(state.faces[0].trackingId, state.faces[0].id);
const targetA = state.faces.find((item) => item.centerX < 0.5).id;
const targetB = state.faces.find((item) => item.centerX > 0.5).id;
assert.equal(typeof state.lastFaceAgeMs, "number", "face age uses the local JS receive clock");

requestedTargetId = targetB;
const biggerPasserby = face(0.30, 0.25);
const trackedB = face(0.70, 0.13);
onFaceFrame({ timestampMs: 2, faceCount: 2, primary: biggerPasserby, faces: [trackedB, biggerPasserby] });
state = social.getSocialAttentionControllerState();
assert.equal(state.selectedFaceId, targetB, "a valid behavior selection wins even when another face is larger");
assert.equal(state.faces.find((item) => item.id === targetB).centerX, 0.70);

requestedTargetId = "expired-or-invalid-id";
onFaceFrame({ timestampMs: 3, faceCount: 2, primary: biggerPasserby, faces: [biggerPasserby, trackedB] });
state = social.getSocialAttentionControllerState();
assert.equal(state.selectedFaceId, targetB, "an invalid callback target falls back to the previous valid target");

onFaceFrame({ timestampMs: 4, faceCount: 1, primary: biggerPasserby, faces: [biggerPasserby] });
state = social.getSocialAttentionControllerState();
assert.equal(state.selectedFaceId, targetA, "when the prior target is absent, selection falls back to the largest current face");
receiveNow += 901;
state = social.getSocialAttentionControllerState();
assert.equal(state.lastFaceAgeMs, 901);
assert.deepEqual(state.faces, [], "stale face snapshots must not look currently visible to the behavior runtime");
assert.equal(state.selectedFaceId, null, "a stale snapshot must not retain a selected current target");

await social.stopSocialAttentionController("legacy-fallback");
requestedTargetId = null;
social.startSocialAttentionController("legacy-fallback");
social.noteSocialAttentionInteraction("legacy-fallback");
for (let i = 0; i < 12; i += 1) await Promise.resolve();
const legacyHandler = nativeListeners.get("onFaceFrame");
const legacyPrimary = face(0.44, 0.16);
legacyHandler({ timestampMs: 5, faceCount: 1, primary: legacyPrimary });
state = social.getSocialAttentionControllerState();
assert.equal(state.faces.length, 1, "older native builds that only emit primary remain supported");
assert.equal(state.selectedFaceId, state.faces[0].id);
assert.ok(state.faces[0].trackingId);
await social.stopSocialAttentionController("test-cleanup");
Date.now = originalDateNow;

const swift = fs.readFileSync("modules/local-face-attention/ios/LocalFaceAttentionModule.swift", "utf8");
const kotlin = fs.readFileSync("modules/local-face-attention/android/src/main/java/com/superlooi/localfaceattention/LocalFaceAttentionModule.kt", "utf8");
assert.match(swift, /\.prefix\(5\)/);
assert.match(swift, /"faces": Array\(boundedFaces\)/);
assert.match(kotlin, /largestFirst\.take\(8\)/);
assert.match(kotlin, /"faces" to normalizedFaces/);

console.log("Face target tracking tests passed");
