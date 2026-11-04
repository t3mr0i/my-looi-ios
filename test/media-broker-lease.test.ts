import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaBroker } from '../src/robot-bridge/media-broker.ts';

test('a released lease cannot tear down a later lease with the same owner name', async () => {
  const released: number[] = [];
  let next = 0;
  const broker = createMediaBroker({
    async inspect() {
      return {
        camera: { supported: true, available: true, permission: 'granted' },
        microphone: { supported: true, available: true, permission: 'granted' },
        speaker: { supported: true, available: true, routeActive: true, speakerSelected: true, route: 'speaker' },
      };
    },
    async acquire() {
      const id = ++next;
      return { stream: null, audioTracks: [], videoTracks: [], release() { released.push(id); } };
    },
  });
  const request = { camera: false, microphone: false, speaker: true };
  const first = await broker.acquire('conversation', request);
  await first.release();
  const second = await broker.acquire('conversation', request);
  await first.release('late completion from previous conversation');
  assert.deepEqual(released, [1]);
  assert.equal((await broker.inspect()).phase, 'active');
  assert.equal((await broker.inspect()).owner, 'conversation');
  await second.release();
  assert.deepEqual(released, [1, 2]);
  assert.equal((await broker.inspect()).phase, 'idle');
});
