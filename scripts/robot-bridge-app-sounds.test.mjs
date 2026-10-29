import assert from "node:assert/strict";
import { deferred, loadTypeScript } from "./helpers/load-typescript.mjs";

const soundModule = loadTypeScript("src/robot-bridge/app-sounds.ts");
const { createAppSounds, generateAppSoundClip } = soundModule;

function abortError() {
  const error = new Error("cancelled");
  error.name = "AbortError";
  return error;
}

function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Timed out waiting for sound state"));
      setTimeout(poll, 1);
    };
    poll();
  });
}

function makeAbortablePlayer() {
  const state = { calls: [], stops: 0, active: 0 };
  return {
    state,
    play(clip, { signal }) {
      const entry = { clip, settled: false };
      state.calls.push(entry);
      state.active += 1;
      return new Promise((resolve, reject) => {
        const finish = (error) => {
          if (entry.settled) return;
          entry.settled = true;
          state.active -= 1;
          signal.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => finish(abortError());
        entry.finish = () => finish();
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    },
    async stop() { state.stops += 1; },
  };
}

function decodeWav(uri) {
  assert.match(uri, /^data:audio\/wav;base64,/);
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
}

async function generatedSoundsAreValidBoundedOfflineWavs() {
  const names = ["chirp", "greet", "inquire", "alarm", "peck", "coo", "wheee"];
  const clips = names.map((name) => generateAppSoundClip(name));
  for (const clip of clips) {
    assert.ok(clip.durationMs > 0 && clip.durationMs <= 2_000);
    const wav = decodeWav(clip.uri);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.toString("ascii", 36, 40), "data");
    assert.equal(wav.readUInt32LE(24), 22_050);
    assert.equal(wav.readUInt16LE(22), 1, "procedural clips are mono");
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.equal(wav.length, 44 + Math.ceil((clip.durationMs * 22_050) / 1_000) * 2);
    assert.ok(wav.subarray(44).some((byte) => byte !== 0), "sound contains generated PCM samples");
  }
  assert.equal(new Set(clips.map((clip) => clip.uri)).size, names.length, "each tag has its own procedural tone");
  assert.throws(() => generateAppSoundClip("nope"), /Unknown app sound tag/);
}

async function stopCancelsBeforeAQueuedSoundCanStart() {
  const player = makeAbortablePlayer();
  const sounds = createAppSounds(player);
  const first = sounds.play("greet");
  await waitFor(() => player.state.calls.length === 1);

  const controller = new AbortController();
  const queued = sounds.play("chirp", { signal: controller.signal });
  await Promise.resolve();
  controller.abort();

  assert.equal((await first).accepted, false, "the active playback reports cancellation");
  assert.equal((await queued).accepted, false, "an aborted queued playback is refused");
  assert.equal(player.state.calls.length, 1, "the queued sound never starts after STOP");
  assert.equal(player.state.active, 0);
  await sounds.stop();
}

async function stopCancelsAnAlreadyPlayingSoundAndReleasesIt() {
  const player = makeAbortablePlayer();
  const sounds = createAppSounds(player);
  const playback = sounds.play("inquire");
  await waitFor(() => player.state.calls.length === 1);

  await sounds.stop();
  assert.deepEqual(await playback, { accepted: false, reason: "cancelled" });
  assert.equal(player.state.active, 0);
  assert.equal(player.state.stops, 1);
}

async function replacementWaitsForLateNativeCompletionBeforeStarting() {
  const late = deferred();
  const stopBarrier = deferred();
  const state = { calls: [], stops: 0, active: 0 };
  const player = {
    play(clip) {
      state.calls.push(clip);
      state.active += 1;
      if (state.calls.length === 1) {
        return late.promise.finally(() => { state.active -= 1; });
      }
      return Promise.resolve().finally(() => { state.active -= 1; });
    },
    stop() { state.stops += 1; return stopBarrier.promise; },
  };
  const sounds = createAppSounds(player);
  const first = sounds.play("chirp");
  await waitFor(() => state.calls.length === 1);
  const second = sounds.play("peck");
  await waitFor(() => state.stops === 1);
  assert.equal(state.calls.length, 1, "a new sound waits for native release instead of overlapping it");
  late.resolve(); // A late completion after abort must not revive the first call.
  stopBarrier.resolve();
  assert.deepEqual(await first, { accepted: false, reason: "cancelled" });
  assert.deepEqual(await second, { accepted: true });
  assert.equal(state.calls.length, 2);
  assert.equal(state.active, 0);
}

async function wheeeRefreshKeepsItAliveAndReleaseOrMissedRefreshStopsIt() {
  const player = makeAbortablePlayer();
  const sounds = createAppSounds(player, { holdRefreshTimeoutMs: 300, holdSegmentGapMs: 160 });

  assert.deepEqual(await sounds.play("wheee", { hold: true }), { accepted: true });
  await waitFor(() => player.state.calls.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.deepEqual(await sounds.play("wheee", { hold: true }), { accepted: true });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(player.state.stops, 0, "a stock 200ms-style refresh renews the held sound");

  assert.deepEqual(await sounds.play("wheee", { hold: false }), { accepted: true });
  assert.equal(player.state.active, 0, "hold:false cancels the currently playing segment");

  assert.deepEqual(await sounds.play("wheee", { hold: true }), { accepted: true });
  await waitFor(() => player.state.calls.length >= 2);
  await waitFor(() => player.state.active === 0, 800);
  assert.ok(player.state.stops >= 2, "the lease expires when refresh messages stop");
  await sounds.stop();
}

async function nativeExpoDriverRemovesPlayerAndListenerOnStopAndFinish() {
  const playerRecords = [];
  const nativeModule = loadTypeScript("src/robot-bridge/native-app-sounds.ts", {
    "./app-sounds": soundModule,
    "expo-audio": {
      createAudioPlayer(source, options) {
        const record = { source, options, volume: null, played: 0, paused: 0, removed: 0, listeners: new Set() };
        const player = {
          get volume() { return record.volume; },
          set volume(value) { record.volume = value; },
          play() { record.played += 1; },
          pause() { record.paused += 1; },
          remove() { record.removed += 1; },
          addListener(event, listener) {
            assert.equal(event, "playbackStatusUpdate");
            record.listeners.add(listener);
            return { remove() { record.listeners.delete(listener); } };
          },
        };
        record.emit = (status) => record.listeners.forEach((listener) => listener(status));
        playerRecords.push(record);
        return player;
      },
    },
  });
  const volumeValues = [0.37, 1.4, 0.2, 0.8];
  const sounds = nativeModule.createNativeAppSounds({ volume: () => volumeValues.shift() ?? 0 });

  const stopped = sounds.play("chirp");
  await waitFor(() => playerRecords.length === 1 && playerRecords[0].played === 1);
  assert.equal(playerRecords[0].volume, 0.37, "local effect uses the current LOOI speaker gain");
  assert.equal(playerRecords[0].options.keepAudioSessionActive, true, "short sound does not deactivate an active WebRTC route");
  await sounds.stop();
  assert.deepEqual(await stopped, { accepted: false, reason: "cancelled" });
  assert.equal(playerRecords[0].removed, 1);
  assert.equal(playerRecords[0].listeners.size, 0);

  const finished = sounds.play("peck");
  await waitFor(() => playerRecords.length === 2 && playerRecords[1].played === 1);
  assert.equal(playerRecords[1].volume, 1, "configured gain is clamped to the supported 0–1 range");
  playerRecords[1].emit({ didJustFinish: true, error: null });
  assert.deepEqual(await finished, { accepted: true });
  assert.equal(playerRecords[1].removed, 1, "natural completion also releases the Expo player");
  assert.equal(playerRecords[1].listeners.size, 0);

  assert.deepEqual(await sounds.play("wheee", { hold: true }), { accepted: true });
  await waitFor(() => playerRecords.length === 3 && playerRecords[2].played === 1);
  assert.equal(playerRecords[2].volume, 0.2);
  playerRecords[2].emit({ didJustFinish: true, error: null });
  await waitFor(() => playerRecords.length === 4 && playerRecords[3].played === 1);
  assert.equal(playerRecords[3].volume, 0.8, "held sound rereads a changed speaker gain on its next segment");
  assert.deepEqual(await sounds.play("wheee", { hold: false }), { accepted: true });
  assert.equal(playerRecords[3].removed, 1);
}

await generatedSoundsAreValidBoundedOfflineWavs();
await stopCancelsBeforeAQueuedSoundCanStart();
await stopCancelsAnAlreadyPlayingSoundAndReleasesIt();
await replacementWaitsForLateNativeCompletionBeforeStarting();
await wheeeRefreshKeepsItAliveAndReleaseOrMissedRefreshStopsIt();
await nativeExpoDriverRemovesPlayerAndListenerOnStopAndFinish();
console.log("Robot bridge app sound checks passed");
