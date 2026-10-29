import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const { createRobotAppMediaServices } = loadTypeScript("src/robot-bridge/app-media-services.ts");
const request = { camera: true, microphone: true, speaker: true };
const fixture = (overrides = {}) => {
  const calls = [];
  let status = { phase: "active", owner: "console", request };
  const broker = {
    async inspect() { return status; },
    getVideoInfo(owner) { return { owner, width: 640, height: 480, rotate: 0, available: true }; },
    getAudioGain(device) { calls.push(["get", device]); return { percent: 60, origin: "webrtc-track-gain", pending: false }; },
    setAudioGain(device, percent) { calls.push(["set", device, percent]); return { percent, origin: "webrtc-track-gain", pending: false }; },
  };
  const player = { async play(name) { calls.push(["play", name]); return { accepted: true }; }, async stop() { calls.push(["stop"]); } };
  const media = createRobotAppMediaServices({ owner: "console", request, broker: () => broker, createSounds: () => player, ...overrides });
  return { media, calls, player, setStatus(next) { status = next; } };
};

{
  const { media, calls, setStatus } = fixture();
  assert.equal(media.videoInfo().width, 640);
  assert.equal((await media.audio.getGain("microphone")).percent, 60);
  assert.equal((await media.audio.setGain("speaker", 40)).percent, 40);
  assert.equal((await media.sound.play("chirp")).accepted, true);
  setStatus({ phase: "active", owner: "other-app", request });
  await assert.rejects(media.audio.setGain("speaker", 90), /session has ended/);
  assert.equal((await media.sound.play("alarm")).accepted, false);
  assert.deepEqual(calls.filter(x => x[0] === "play"), [["play", "chirp"]]);
  await media.close();
  assert.equal(media.videoInfo().available, false);
}

{
  let created = 0;
  const { media } = fixture({ request: { camera: false, microphone: false, speaker: false }, createSounds() { created++; throw new Error("must not create a player"); } });
  assert.equal(media.videoInfo().available, false);
  assert.equal((await media.sound.play("chirp")).accepted, false);
  await assert.rejects(media.audio.getGain("microphone"), /not enabled/);
  assert.equal(created, 0, "disabled media never acquires a sound device");
}

{
  const factory = deferred();
  let factoryStarted = false;
  const { media, calls, player } = fixture({ createSounds() { factoryStarted = true; return factory.promise; } });
  const pending = media.sound.play("alarm");
  for (let n = 0; n < 12 && !factoryStarted; n++) await Promise.resolve();
  assert.equal(factoryStarted, true);
  const stopping = media.stop();
  factory.resolve(player);
  await stopping;
  assert.equal((await pending).accepted, false);
  assert.equal(calls.some(x => x[0] === "play"), false, "a player resolving after STOP must stay silent");
  assert.equal(calls.filter(x => x[0] === "stop").length, 1);
  await media.close();
}

console.log("robot app media: owner/consent isolation, track gains and late sound STOP passed");
