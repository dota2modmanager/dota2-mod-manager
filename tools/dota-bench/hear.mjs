/**
 * Whether a sound was heard: the sound a mod puts on an ability, looked for in what the game
 * played while the bench cast it (tools/dota-bench/record.ps1). Both are brought to mono at
 * 8 kHz and the sound slides along the recording; at each place the match is the normalised
 * cross-correlation, 1 for the same wave and near 0 for an unrelated one. The game mixes,
 * attenuates and plays other sounds over it, so a match is judged against a threshold that was
 * measured, not by ear: the sound a mod brings scores well above the stock one it replaced.
 */
import fs from 'node:fs';

export const RATE = 8000;
/** Over this, the sound is in the recording (measured 2026-11-03, see the tests). */
export const HEARD = 0.35;

/** A WAV's samples as mono floats at its own rate: PCM 8/16/24/32 or float 32, any channels. */
export function readWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data' && fmt) {
      const tag = fmt.tag === 0xfffe ? (fmt.bits === 32 ? 3 : 1) : fmt.tag;
      const step = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (step * fmt.channels));
      const out = new Float32Array(frames);
      const read = (p) => (tag === 3 ? buf.readFloatLE(p) : step === 2 ? buf.readInt16LE(p) / 32768 : step === 1 ? (buf[p] - 128) / 128
        : step === 3 ? buf.readIntLE(p, 3) / 8388608 : buf.readInt32LE(p) / 2147483648);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += read(body + (f * fmt.channels + c) * step);
        out[f] = sum / fmt.channels;
      }
      return { rate: fmt.rate, samples: out };
    }
    at = body + size + (size & 1);
  }
  throw new Error('a WAV with no data');
}

/** To RATE by averaging each output sample's span of input: crude, and enough to compare. */
export function resample({ rate, samples }) {
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += samples[j];
    out[i] = s / (b - a);
  }
  return out;
}

function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? -1 : 1);
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar; im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar; im[i + j] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * The best match of `sound` in `recording` (both at RATE): its score, and where it starts in
 * seconds. The sound's quiet tail is cut first, so a long fade does not water the match down.
 */
export function bestMatch(sound, recording) {
  let end = sound.length;
  const peak = sound.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  while (end > RATE / 10 && Math.abs(sound[end - 1]) < peak * 0.02) end--;
  const t = sound.subarray(0, end);
  if (t.length > recording.length || !peak) return { score: 0, at: 0 };
  let n = 1;
  while (n < recording.length + t.length) n <<= 1;
  const ar = new Float64Array(n); const ai = new Float64Array(n);
  const br = new Float64Array(n); const bi = new Float64Array(n);
  ar.set(recording);
  for (let i = 0; i < t.length; i++) br[i] = t[t.length - 1 - i];
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
  fft(ar, ai, true);
  const tNorm = Math.sqrt(t.reduce((s, v) => s + v * v, 0));
  const energy = new Float64Array(recording.length + 1);
  for (let i = 0; i < recording.length; i++) energy[i + 1] = energy[i] + recording[i] * recording[i];
  let best = { score: 0, at: 0 };
  for (let k = 0; k + t.length <= recording.length; k++) {
    const e = energy[k + t.length] - energy[k];
    if (e <= 1e-9) continue;
    const score = ar[k + t.length - 1] / (tNorm * Math.sqrt(e));
    if (score > best.score) best = { score, at: k / RATE };
  }
  return best;
}

/** The verdict for the bench: the sound's best match in a recording, and whether it was heard. */
export function hear(soundFile, recordingFile) {
  const m = bestMatch(resample(readWav(fs.readFileSync(soundFile))), resample(readWav(fs.readFileSync(recordingFile))));
  return { score: Math.round(m.score * 1000) / 1000, at: Math.round(m.at * 100) / 100, heard: m.score >= HEARD };
}
