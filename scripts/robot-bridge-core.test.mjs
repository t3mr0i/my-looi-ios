import assert from "node:assert/strict";
import { loadTypeScript, deferred } from "./helpers/load-typescript.mjs";

const types = loadTypeScript("src/robot-bridge/types.ts");
const actionProfile = loadTypeScript("src/robot-bridge/action-profile.ts", { "./types": types });
const { createRobotCore } = loadTypeScript("src/robot-bridge/core.ts", { "./types": types, "./action-profile": actionProfile });
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const capabilities = {
  schemaVersion: 1, locomotion: { forward: true, lateral: false, yaw: true, simultaneous: false, calibratedVelocity: false, odometry: false },
  pose: { head: "quantized", headTranslation: false, headRoll: false, headYaw: false, antennas: false, bodyYaw: "none" },
  gestures: ["nod"], light: true, media: { camera: false, microphone: false, speaker: false, volume: false },
};
function fixture() {
  let now = 1000, next = 0, gate = null, failedStop = false;
  const timers = new Map(), actions = [], stops = [], contexts = [];
  const backend = {
    id: "test-looi", capabilities,
    inspect: () => ({ connected: true, moving: false, measuredPose: null, measuredVelocity: null, safetyReason: null }),
    async execute(command, context) {
      contexts.push(context);
      const wait = gate; gate = null;
      if (wait) await wait.promise;
      if (!context.isCurrent()) return { status: "cancelled", limitations: [] };
      actions.push(command);
      return { status: "adapted", limitations: ["quantized"] };
    },
    stop(reason) { stops.push(reason); return failedStop ? Promise.reject(new Error("stop failed")) : Promise.resolve(); },
  };
  const core = createRobotCore(backend, { clock: {
    now: () => now,
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  } });
  return {
    core, actions, stops, contexts, timers,
    block() { gate = deferred(); return gate; }, failStop(value) { failedStop = value; },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await tick(); },
  };
}
const drive = { kind: "drive", forward: .1, lateral: 0, yawRate: 0, durationMs: 100 };

{
  const f = fixture(), session = f.core.openSession({ id: "app", allowApproximation: true });
  assert.throws(() => f.core.openSession(), /busy/);
  assert.equal((await session.execute({ ...drive, forward: NaN })).status, "rejected");
  const reflected = [...types.IDENTITY_HEAD]; reflected[0] = -1;
  assert.equal((await session.execute({ kind: "target", pose: { head: reflected } })).status, "rejected");
  assert.equal(f.actions.length, 0);
  const input = { kind: "target", pose: { head: [...types.IDENTITY_HEAD], bodyYaw: .2 } };
  const pending = session.execute(input, { sequence: 4 });
  input.pose.head[0] = 500;
  assert.equal((await pending).status, "adapted");
  assert.equal(f.actions[0].pose.head[0], 1, "admission snapshots the caller's command");
  assert.equal((await session.execute(input, { sequence: 4 })).status, "rejected");
  const snapshot = f.core.inspect(); snapshot.virtualPose.head[0] = 999;
  assert.equal(f.core.inspect().virtualPose.head[0], 1);
  assert.equal(f.core.inspect().observed.measuredPose, null);
  await session.close(); assert.equal(session.closed, true);
  assert.equal((await session.execute(drive)).status, "cancelled");
  await f.core.dispose();
}
{
  const f = fixture(), s = f.core.openSession();
  const wait = f.block(), old = s.execute(drive, { sequence: 1 }); await tick();
  const latest = s.execute({ ...drive, forward: -.1 }, { sequence: 2 });
  assert.equal((await old).status, "cancelled", "coalescing releases an older caller without waiting for its IO");
  await latest;
  wait.resolve(); await tick();
  assert.deepEqual(f.actions.map(x => x.forward), [-.1], "old IO completion cannot actuate a superseded target");
  assert.equal((await s.execute(drive, { sequence: 1 })).limitations[0], "stale_sequence");
  await f.core.dispose();
}
{
  const f = fixture(), s = f.core.openSession();
  const wait = f.block(), pending = s.execute(drive); await tick();
  const generation = f.core.inspect().generation;
  const stop = s.stop();
  assert.ok(f.core.inspect().generation > generation, "STOP invalidates leases before its first await");
  assert.equal((await pending).status, "cancelled"); await stop;
  wait.resolve(); await tick(); assert.equal(f.actions.length, 0);
  assert.equal(f.timers.size, 0);
  await f.core.dispose();
}
{
  const f = fixture(), s = f.core.openSession();
  const wait = f.block(), pending = s.execute(drive, { ttlMs: 150 }); await tick();
  await f.advance(151);
  assert.equal((await pending).status, "cancelled");
  assert.ok(f.stops.includes("bridge-command-expired"));
  wait.resolve(); await tick(); assert.equal(f.actions.length, 0);
  await f.core.setActive(false);
  assert.equal(s.closed, true); assert.throws(() => f.core.openSession(), /suspended/);
  await f.core.setActive(true);
  const replacement = f.core.openSession({ id: s.id });
  await s.close();
  assert.equal(replacement.closed, false, "old session teardown cannot close a successor with the same external name");
  await f.core.dispose();
}
{
  const f = fixture(), s = f.core.openSession();
  f.failStop(true); await assert.rejects(s.stop(), /stop failed/);
  assert.equal((await s.execute(drive)).limitations[0], "stop_failed");
  assert.equal(f.actions.length, 0);
  f.failStop(false); await s.stop();
  assert.equal((await s.execute(drive)).status, "adapted");
  await f.core.dispose();
}
console.log("robot bridge core: validation, coalescing, deadlines, ownership and STOP passed");
