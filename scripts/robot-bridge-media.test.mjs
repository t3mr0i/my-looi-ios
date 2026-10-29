import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const brokerModule = loadTypeScript("src/robot-bridge/media-broker.ts");
const validStatus = {
  camera: { supported: true, available: true, permission: "granted" },
  microphone: { supported: true, available: true, permission: "granted" },
  speaker: { supported: true, available: true, routeActive: false, speakerSelected: false, route: "AVAudioSession" },
};
const track = (kind) => ({
  kind, enabled: true, readyState: "live", stopped: 0, volumes: [],
  _setVolume(value) { this.volumes.push(value); },
  stop() { this.stopped++; this.enabled = false; this.readyState = "ended"; },
});
const gainTrack = () => ({
  kind: "audio", enabled: true, readyState: "live", stopped: 0, volumes: [],
  _setVolume(value) { this.volumes.push(value); },
  stop() { this.stopped++; this.enabled = false; this.readyState = "ended"; },
});

async function nativeBackendDoesNotInferUnavailableDevicesBeforePermission() {
  let cameraPermission = "prompt";
  let microphonePermission = "unknown";
  const route = { supported: true, active: false, speakerSelected: false, speakerDeviceAvailable: true, routeStrategy: "AVAudioSession" };
  const native = loadTypeScript("src/robot-bridge/native-media.ts", {
    "react-native": { Platform: { OS: "ios" } },
    "react-native-webrtc": {
      mediaDevices: { async enumerateDevices() { return []; }, async getUserMedia() { throw new Error("not used"); } },
      permissions: {
        async query({ name }) { return name === "camera" ? cameraPermission : microphonePermission; },
        async request() { throw new Error("not used"); },
      },
    },
    "../../modules/realtime-audio-route": {
      async activateRealtimeSpeakerRoute() { return route; },
      async deactivateRealtimeSpeakerRoute() { return { ...route, active: false }; },
      async getRealtimeAudioRouteStatus() { return route; },
    },
  });
  const backend = native.createNativeMediaBackend();
  let status = await backend.inspect();
  assert.equal(status.camera.permission, "prompt");
  assert.equal(status.camera.available, null, "an empty camera list before permission is unknown, not unavailable");
  assert.equal(status.microphone.permission, "unknown");
  assert.equal(status.microphone.available, null, "an empty microphone list before permission is unknown, not unavailable");

  cameraPermission = "denied";
  microphonePermission = "denied";
  status = await backend.inspect();
  assert.equal(status.camera.available, null, "denied permission is reported separately from hardware availability");
  assert.equal(status.microphone.available, null, "denied permission is reported separately from hardware availability");

  cameraPermission = "granted";
  microphonePermission = "granted";
  status = await backend.inspect();
  assert.equal(status.camera.available, false, "after permission, an empty device list can report unavailable hardware");
  assert.equal(status.microphone.available, false, "after permission, an empty device list can report unavailable hardware");
}

async function nativeBackendRejectsUnavailableSpeakerRoutingBeforeTakingOwnership() {
  for (const [route, expectedError, expectedSupported] of [
    [{ supported: false, active: false, speakerSelected: false, speakerDeviceAvailable: false, routeStrategy: "unsupported" }, /not supported on this device/, false],
    [{ supported: true, active: false, speakerSelected: false, speakerDeviceAvailable: false, routeStrategy: "Android" }, /speaker is not available/, true],
  ]) {
    let ownershipCalls = 0, activationCalls = 0, captureCalls = 0;
    const native = loadTypeScript("src/robot-bridge/native-media.ts", {
      "react-native": { Platform: { OS: "android" } },
      "react-native-webrtc": {
        mediaDevices: {
          async enumerateDevices() { return []; },
          async getUserMedia() { captureCalls++; throw new Error("capture should not start"); },
        },
        permissions: { async query() { return "granted"; }, async request() { return "granted"; } },
      },
      "../../modules/realtime-audio-route": {
        async activateRealtimeSpeakerRoute() { activationCalls++; return route; },
        async deactivateRealtimeSpeakerRoute() { return route; },
        async getRealtimeAudioRouteStatus() { return route; },
      },
    });
    const backend = native.createNativeMediaBackend({ async acquireOwnership() { ownershipCalls++; } });
    const status = await backend.inspect();
    assert.equal(status.speaker.supported, expectedSupported);
    assert.equal(status.speaker.available, false);
    await assert.rejects(
      backend.acquire("bridge-app", { camera: false, microphone: true, speaker: true }, new AbortController().signal),
      expectedError,
    );
    assert.equal(ownershipCalls, 0, "an impossible speaker request must not suspend LOOI media first");
    assert.equal(activationCalls, 0, "route activation must not be attempted for an unsupported or absent speaker");
    assert.equal(captureCalls, 0, "media capture must not start after a speaker preflight failure");
  }
}

async function brokerExclusivityAndIdempotentRelease() {
  const camera = track("video");
  const microphone = track("audio");
  let acquisitions = 0, releases = 0;
  const backend = {
    async inspect() { return validStatus; },
    async acquire(_owner, request) {
      acquisitions++;
      assert.equal(request.cameraFacing, "environment", "the outward-facing camera is the default");
      return { stream: {}, audioTracks: [microphone], videoTracks: [camera], async release() { releases++; camera.stop(); microphone.stop(); } };
    },
  };
  const broker = brokerModule.createMediaBroker(backend);
  const request = { camera: true, microphone: true, speaker: true };
  const [lease, duplicate] = await Promise.all([broker.acquire("app-a", request), broker.acquire("app-a", request)]);
  assert.equal(lease, duplicate, "repeat acquisition by the same owner returns the same lease");
  assert.equal(acquisitions, 1);
  await assert.rejects(broker.acquire("app-b", request), /already owned/);
  assert.equal((await broker.inspect()).phase, "active");
  await Promise.all([lease.release(), broker.release("app-a")]);
  assert.equal(releases, 1, "concurrent releases dispose native media once");
  assert.equal(camera.stopped, 1);
  assert.equal(microphone.stopped, 1);
  assert.equal((await broker.inspect()).phase, "idle");
}

async function lateAcquisitionIsDisposedBeforeNextOwner() {
  const pending = deferred();
  const camera = track("video");
  let releases = 0, calls = 0;
  const backend = {
    async inspect() { return validStatus; },
    async acquire() {
      calls++;
      if (calls === 1) return pending.promise;
      return { stream: {}, audioTracks: [], videoTracks: [], async release() { releases++; } };
    },
  };
  const broker = brokerModule.createMediaBroker(backend);
  const controller = new AbortController();
  const acquiring = broker.acquire("app-a", { camera: true, microphone: false, speaker: false }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  assert.equal((await broker.inspect()).phase, "releasing");
  await assert.rejects(broker.acquire("app-b", { camera: false, microphone: true, speaker: false }), /already owned/);
  pending.resolve({
    stream: {}, audioTracks: [], videoTracks: [camera],
    async release() { releases++; camera.stop(); },
  });
  await assert.rejects(acquiring, { name: "AbortError" });
  assert.equal(camera.stopped, 1, "a stream returned after release is stopped");
  assert.equal(releases, 1);
  const next = await broker.acquire("app-b", { camera: false, microphone: true, speaker: false });
  assert.equal(next.owner, "app-b");
  await next.release();
}

async function brokerAudioGainRetainsAndAppliesToCurrentAndFutureTracks() {
  const microphoneTracks = [];
  const broker = brokerModule.createMediaBroker({
    async inspect() { return validStatus; },
    async acquire(_owner, request) {
      const microphone = request.microphone ? gainTrack() : null;
      if (microphone) microphoneTracks.push(microphone);
      return {
        stream: {},
        audioTracks: microphone ? [microphone] : [],
        videoTracks: [],
        async release() { microphone?.stop(); },
      };
    },
  });

  assert.deepEqual(broker.getAudioGain("speaker"), { percent: 100, origin: "webrtc-track-gain", pending: true });
  assert.deepEqual(broker.getAudioGain("microphone"), { percent: 100, origin: "webrtc-track-gain", pending: true });
  assert.equal(broker.setAudioGain("microphone", 35).pending, true, "microphone gain is retained before a capture track exists");
  assert.equal(broker.setAudioGain("speaker", 60).pending, true, "speaker gain is retained before an incoming track exists");
  for (const invalid of [-1, 101, NaN, Infinity, "25"]) {
    assert.throws(() => broker.setAudioGain("speaker", invalid), /finite percentage from 0 to 100/);
  }
  assert.throws(() => broker.getAudioGain("headphones"), /Unknown audio gain device/);

  const lease = await broker.acquire("app-a", { camera: false, microphone: true, speaker: true });
  assert.equal(microphoneTracks[0].volumes.at(-1), 0.35, "stored microphone gain is applied as capture is acquired");
  assert.equal(broker.getAudioGain("microphone").pending, false);
  assert.equal(broker.getAudioGain("speaker").pending, true);

  const rejectedTrack = gainTrack();
  assert.equal(broker.registerRemoteAudioTrack("other-app", rejectedTrack), false, "a different owner cannot register remote audio");
  assert.equal(rejectedTrack.enabled, false, "unauthorized remote audio is disabled immediately");
  assert.equal(rejectedTrack.volumes.at(-1), 0);

  const remote = gainTrack();
  assert.equal(broker.registerRemoteAudioTrack("app-a", remote), true, "speaker-consented current owner can register a remote audio track");
  assert.equal(remote.volumes.at(-1), 0.6, "stored speaker gain is applied to a late remote track");
  assert.equal(broker.getAudioGain("speaker").pending, false);
  assert.equal(broker.setAudioGain("microphone", 45).pending, false);
  assert.equal(microphoneTracks[0].volumes.at(-1), 0.45);
  assert.equal(broker.setAudioGain("speaker", 25).pending, false);
  assert.equal(remote.volumes.at(-1), 0.25);

  await lease.release("test-release");
  assert.equal(remote.stopped, 1, "registered remote tracks are stopped when their lease is released");
  assert.equal(microphoneTracks[0].stopped, 1);
  assert.equal(broker.getAudioGain("speaker").pending, true);
  assert.equal(broker.getAudioGain("microphone").pending, true);

  const nextLease = await broker.acquire("app-b", { camera: false, microphone: true, speaker: true });
  assert.equal(microphoneTracks[1].volumes.at(-1), 0.45, "microphone gain is retained for the next capture stream");
  const nextRemote = gainTrack();
  assert.equal(broker.registerRemoteAudioTrack("app-b", nextRemote), true);
  assert.equal(nextRemote.volumes.at(-1), 0.25, "speaker gain is retained for the next remote track");
  await nextLease.release("test-release");
  assert.equal(nextRemote.stopped, 1);

  const micOnlyLease = await broker.acquire("app-c", { camera: false, microphone: true, speaker: false });
  const unconsentedTrack = gainTrack();
  assert.equal(broker.registerRemoteAudioTrack("app-c", unconsentedTrack), false, "the current owner still cannot register speaker audio without speaker consent");
  assert.equal(unconsentedTrack.enabled, false, "speaker audio is muted when the lease excluded speaker output");
  assert.equal(unconsentedTrack.volumes.at(-1), 0);
  await micOnlyLease.release("test-release");
}

async function nativeBackendOwnsMediaAndRestoresAudioRoute() {
  const events = [];
  const camera = track("video");
  const microphone = track("audio");
  const route = { supported: true, active: true, speakerSelected: true, speakerDeviceAvailable: true, routeStrategy: "AVAudioSession" };
  const native = loadTypeScript("src/robot-bridge/native-media.ts", {
    "react-native": { Platform: { OS: "ios" } },
    "react-native-webrtc": {
      mediaDevices: {
        async enumerateDevices() { return [{ kind: "videoinput" }, { kind: "audioinput" }]; },
        async getUserMedia(constraints) { events.push("get-user-media"); assert.equal(constraints.audio.echoCancellation, true); assert.equal(constraints.video.facingMode.ideal, "environment"); return { getTracks: () => [microphone, camera], getAudioTracks: () => [microphone], getVideoTracks: () => [camera], release() { events.push("stream-release"); } }; },
      },
      permissions: { async query() { return "granted"; }, async request() { throw new Error("permission already granted"); } },
    },
    "../../modules/realtime-audio-route": {
      async activateRealtimeSpeakerRoute() { events.push("route-activate"); return route; },
      async deactivateRealtimeSpeakerRoute() { events.push("route-restore"); return { ...route, active: false }; },
      async getRealtimeAudioRouteStatus() { return route; },
    },
  });
  const backend = native.createNativeMediaBackend({
    async acquireOwnership() { events.push("looi-suspend"); },
    async releaseOwnership() { events.push("looi-restore"); },
  });
  const status = await backend.inspect();
  assert.equal(status.camera.available, true);
  assert.equal(status.microphone.permission, "granted");
  assert.equal(status.speaker.speakerSelected, true);
  const controller = new AbortController();
  const resources = await backend.acquire("bridge-app", { camera: true, microphone: true, speaker: true, cameraFacing: "environment" }, controller.signal);
  assert.deepEqual(events.slice(0, 3), ["looi-suspend", "route-activate", "get-user-media"], "existing LOOI owners and route are prepared before media acquisition");
  await resources.release("app-close");
  await resources.release("duplicate-close");
  assert.equal(camera.stopped, 1);
  assert.equal(microphone.stopped, 1);
  assert.deepEqual(events.slice(-3), ["stream-release", "route-restore", "looi-restore"], "tracks stop before route and LOOI state restoration");
}

async function nativeBackendStopsLateGetUserMediaResult() {
  const events = [];
  const pending = deferred();
  const microphone = track("audio");
  const route = { supported: true, active: true, speakerSelected: true, speakerDeviceAvailable: true, routeStrategy: "AndroidAudioManager" };
  const native = loadTypeScript("src/robot-bridge/native-media.ts", {
    "react-native": { Platform: { OS: "android" } },
    "react-native-webrtc": {
      mediaDevices: { async enumerateDevices() { return []; }, getUserMedia() { events.push("get-user-media"); return pending.promise; } },
      permissions: { async query() { return "granted"; }, async request() { return true; } },
    },
    "../../modules/realtime-audio-route": {
      async activateRealtimeSpeakerRoute() { events.push("route-activate"); return route; },
      async deactivateRealtimeSpeakerRoute() { events.push(`route-restore-${microphone.stopped}`); return { ...route, active: false }; },
      async getRealtimeAudioRouteStatus() { return route; },
    },
  });
  const backend = native.createNativeMediaBackend({
    async acquireOwnership() { events.push("looi-suspend"); },
    async releaseOwnership() { events.push(`looi-restore-${microphone.stopped}`); },
  });
  const controller = new AbortController();
  const acquiring = backend.acquire("bridge-app", { camera: false, microphone: true, speaker: true }, controller.signal);
  for (let i = 0; i < 8 && !events.includes("get-user-media"); i++) await Promise.resolve();
  assert.ok(events.includes("get-user-media"));
  controller.abort();
  pending.resolve({ getTracks: () => [microphone], getAudioTracks: () => [microphone], getVideoTracks: () => [], release() { events.push("stream-release"); } });
  await assert.rejects(acquiring, { name: "AbortError" });
  assert.equal(microphone.stopped, 1);
  assert.ok(events.indexOf("route-restore-1") < events.indexOf("looi-restore-1"), "route restoration follows track stop and precedes LOOI capture restoration");
}

async function cameraMetadataBelongsToTheActiveLease() {
  const camera = { ...track("video"), getSettings: () => ({ width: 1280, height: 720 }) };
  const broker = brokerModule.createMediaBroker({
    async inspect() { return validStatus; },
    async acquire() { return { stream: {}, audioTracks: [], videoTracks: [camera], release() { camera.stop(); } }; },
  });
  assert.equal(broker.getVideoInfo("console").available, false);
  const lease = await broker.acquire("console", { camera: true, microphone: false, speaker: false });
  assert.deepEqual(broker.getVideoInfo("console"), { width: 1280, height: 720, rotate: 0, available: true, source: "webrtc-track-settings" });
  assert.equal(broker.getVideoInfo("other-app").available, false, "a different app cannot read this camera lease");
  camera.getSettings = () => ({ width: NaN, height: -1 });
  assert.deepEqual(broker.getVideoInfo("console"), { width: null, height: null, rotate: 0, available: true, source: "webrtc-track-settings" }, "unknown dimensions must not become a fake camera calibration");
  await lease.release();
  assert.equal(broker.getVideoInfo("console").available, false, "STOP must not leave stale dimensions advertised");
}

await cameraMetadataBelongsToTheActiveLease();
await nativeBackendDoesNotInferUnavailableDevicesBeforePermission();
await nativeBackendRejectsUnavailableSpeakerRoutingBeforeTakingOwnership();
await brokerExclusivityAndIdempotentRelease();
await lateAcquisitionIsDisposedBeforeNextOwner();
await brokerAudioGainRetainsAndAppliesToCurrentAndFutureTracks();
await nativeBackendOwnsMediaAndRestoresAudioRoute();
await nativeBackendStopsLateGetUserMediaResult();
console.log("robot bridge media: exclusive leases, cancellation, native permissions and audio-route teardown passed");

