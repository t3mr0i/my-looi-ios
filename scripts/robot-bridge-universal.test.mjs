import assert from "node:assert/strict";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const load = createTypeScriptTreeLoader();
const { createRobotCore } = load("src/robot-bridge/core.ts");
const { createRobotGateway } = load("src/robot-bridge/gateway.ts");

const backend = {
  id: "looi-demo", capabilities: {
    schemaVersion: 1, locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
    pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
    gestures: ["nod"], light: true, media: { camera: false, microphone: false, speaker: true, volume: true },
  },
  inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }),
  async execute(command) { return { status: "adapted", limitations: [], applied: command }; },
  async stop() {},
};
const core = createRobotCore(backend);
const gateway = createRobotGateway(core, { protocol: "universal", sessionId: "any-app", allowApproximation: true });
assert.deepEqual(gateway.initialMessages(), [], "do not broadcast the wrong protocol before the app identifies itself");
assert.deepEqual(gateway.stateMessages(), []);
const hello = await gateway.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hello", params: { api_version: 44 } }));
assert.equal(hello.find(m => m.id === 1).result.api_version, 44);
assert.equal(hello.some(m => m.type === "daemon_status"), false, "the MicroDuck app gets no Reachy startup frames");
assert.equal(gateway.stateMessages().every(m => m.method === "robot.state"), true);
const version = await gateway.handleMessage({ type: "get_version" });
assert.equal(version.some(m => m.type === "daemon_status"), true);
assert.equal(version.some(m => /^1\.13\.0/.test(m.version ?? "")), true);
assert.equal(core.inspect().sessionId, "any-app", "both protocols share one robot session and STOP authority");
const policies = await gateway.handleMessage({ jsonrpc: "2.0", id: 2, method: "robot.policies" });
assert.deepEqual(policies.find(m => m.id === 2).result.skills, ["nod"]);
await gateway.close();
assert.deepEqual(await gateway.handleMessage({ type: "get_state" }), []);
assert.equal(core.inspect().sessionId, null);
await core.dispose();

let audioStopped = 0;
const media = {
  videoInfo: () => ({ width: 640, height: 480, rotate: 0, available: true, source: "webrtc-track-settings" }),
  audio: { async getGain() { return { percent: 35, origin: "webrtc-track-gain", pending: false }; }, async setGain(_device, percent) { return { percent, origin: "webrtc-track-gain", pending: false }; } },
  sound: { async play() { return { accepted: true }; }, async stop() { audioStopped++; } },
  async stop() { audioStopped++; }, async close() { audioStopped++; },
};
const mediaCore = createRobotCore(backend);
const mediaGateway = createRobotGateway(mediaCore, { protocol: "universal", sessionId: "media-app", media });
const video = await mediaGateway.handleMessage({ jsonrpc: "2.0", id: 4, method: "media.video" });
assert.equal(video.find(m => m.id === 4).result.width, 640);
const gain = await mediaGateway.handleMessage({ type: "get_microphone_volume" });
assert.equal(gain.find(m => m.command === "get_microphone_volume").volume, 35);
await mediaCore.stop("manual-stop");
assert.ok(audioStopped > 0, "shared core STOP must also cancel native app sounds");
await mediaGateway.close();
await mediaCore.dispose();
console.log("robot universal gateway: mixed original wire requests, one core owner, media and shared STOP passed");
