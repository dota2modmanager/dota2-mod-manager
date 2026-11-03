/* Whatever sound the user dropped in (MP3, OGG, WAV, FLAC: what the window's decoder reads), made
 * into what Valve's compiler takes and the game plays in the world: 16-bit PCM WAV, 44.1 kHz, mono
 * (skills/dota2-modding/references/sounds.md). No ffmpeg: the browser decodes and resamples. */

/** The longest sound the window keeps; an ability's sound is a second or two. */
export const MAX_SECONDS = 30;
const RATE = 44100;
/** Valve's sounds peak around -1 dB: a louder file is brought down to it, not clipped. */
const PEAK = 0.89;

/** Mono samples as a 16-bit PCM WAV, brought down to PEAK when louder, with a short fade at the end against a click. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > PEAK ? PEAK / peak : 1;
  const fade = Math.min(samples.length, Math.round(rate * 0.01));
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  tag(36, 'data'); out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const left = samples.length - i;
    const s = samples[i] * gain * (left < fade ? left / fade : 1);
    out.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
  }
  return new Uint8Array(out.buffer);
}

/** The file decoded, mixed to mono at 44.1 kHz, cut at MAX_SECONDS, as a WAV; and how long it is. */
export async function fileToWav(file: Blob): Promise<{ wav: Uint8Array; seconds: number }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * RATE)), RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const mono = await offline.startRendering();
  return { wav: encodeWav(mono.getChannelData(0)), seconds };
}
