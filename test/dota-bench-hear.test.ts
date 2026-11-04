/* The bench's ear (tools/dota-bench/hear.mjs): a mod's sound found in what the game played, by
 * normalised cross-correlation. On made-up signals: the sound quieter and under noise is found
 * where it starts, another sound is not, and WAV files of the shapes the app and Windows write
 * are read the same. Recorded on 2026-11-03, the app's sound played through the speakers and
 * taken back by record.ps1 scored 0.996, plain noise 0.01. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { HEARD, RATE, bestMatch, readWav, resample } from '../tools/dota-bench/hear.mjs';

const chirp = (seconds: number, from: number, to: number) => Float32Array.from({ length: seconds * RATE }, (_, i) => {
  const t = i / RATE;
  return Math.sin(2 * Math.PI * (from + (to - from) * t / seconds / 2) * t) * Math.min(1, 4 * (seconds - t));
});
let seed = 7;
const noise = (n: number, level: number) => Float32Array.from({ length: n }, () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return (seed / 2147483648 - 0.5) * 2 * level;
});

function wav(samples: Float32Array, rate: number, channels: number, bits: 16 | 32): Buffer {
  const step = bits / 8;
  const data = Buffer.alloc(samples.length * channels * step);
  samples.forEach((v, i) => {
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * step;
      if (bits === 32) data.writeFloatLE(v, at); else data.writeInt16LE(Math.round(v * 32767), at);
    }
  });
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(bits === 32 ? 3 : 1, 20); head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * channels * step, 28); head.writeUInt16LE(channels * step, 32); head.writeUInt16LE(bits, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('the sound, quieter and under other noise, is found where it starts', () => {
  const sound = chirp(1, 300, 1800);
  const recording = noise(6 * RATE, 0.15);
  sound.forEach((v, i) => { recording[2.5 * RATE + i] += v * 0.4; });
  const m = bestMatch(sound, recording);
  assert.ok(m.score >= HEARD, `score ${m.score}`);
  assert.ok(Math.abs(m.at - 2.5) < 0.01, `at ${m.at}`);
});

test('another sound in the recording is not taken for it', () => {
  const recording = noise(6 * RATE, 0.05);
  chirp(1, 2000, 400).forEach((v, i) => { recording[RATE + i] += v; });
  assert.ok(bestMatch(chirp(1, 300, 1800), recording).score < HEARD);
  assert.equal(bestMatch(chirp(1, 300, 1800), new Float32Array(4 * RATE)).score, 0, 'silence matches nothing');
});

test('a 48 kHz float stereo recording and a 44.1 kHz 16-bit mono sound come to the same rate', () => {
  const tone = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 48000) * 0.5);
  const stereo = readWav(wav(tone, 48000, 2, 32));
  assert.equal(stereo.rate, 48000);
  assert.ok(Math.abs(stereo.samples[100] - tone[100]) < 1e-6);
  const mono = readWav(wav(Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5), 44100, 1, 16));
  assert.equal(resample(stereo).length, RATE);
  assert.equal(resample(mono).length, RATE);
  assert.ok(bestMatch(resample(mono).subarray(0, RATE / 2), resample(stereo)).score > 0.95);
  assert.throws(() => readWav(Buffer.from('not a wav at all, not even close')), /not a WAV/);
});
