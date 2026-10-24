import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('src/voice/audio-capture-profile.ts', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function('exports', output)(module.exports);
const { isRealtimeCaptureReady } = module.exports;
const ios = { supported: true, captureRunning: true, aecAvailable: true, aecEnabled: true,
  audioSource: 'VOICE_PROCESSING_IO', captureSampleRate: 16000, playbackSampleRate: 24000 };
assert.equal(isRealtimeCaptureReady(ios, 'ios'), true);
assert.equal(isRealtimeCaptureReady({ ...ios, audioSource: 'VOICE_COMMUNICATION' }, 'android'), true);
assert.equal(isRealtimeCaptureReady(ios, 'android'), false);
assert.equal(isRealtimeCaptureReady(ios, 'web'), false);
for (const field of ['supported', 'captureRunning', 'aecAvailable', 'aecEnabled']) {
  assert.equal(isRealtimeCaptureReady({ ...ios, [field]: false }, 'ios'), false, field);
}
for (const rate of [0, 24000, 44100, 48000]) {
  assert.equal(isRealtimeCaptureReady({ ...ios, captureSampleRate: rate }, 'ios'), false);
}
assert.equal(isRealtimeCaptureReady({ ...ios, playbackSampleRate: 48000 }, 'ios'), false);
console.log('Native capture profile: 13 checks passed');
