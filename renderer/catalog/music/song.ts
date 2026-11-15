/* A song the user dropped in, as what Valve's compiler takes for music: an MP3 goes as it is (the
 * game's own music is MP3 inside), anything else the window can play (WAV, FLAC, OGG, M4A...) is
 * decoded and written as 16-bit PCM WAV, stereo, 44.1 kHz. No ffmpeg: the browser decodes. */

/** The longest song taken: ten minutes, what a stereo WAV of it weighs is the core's limit. */
export const MAX_SECONDS = 600;
const RATE = 44100;

/** Two channels as one 16-bit PCM WAV, brought down to just under full scale when louder. */
export function encodeStereoWav(left: Float32Array, right: Float32Array, rate = RATE): Uint8Array {
  const n = Math.min(left.length, right.length);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); tag(8, 'WAVE');
  tag(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
  tag(36, 'data'); out.setUint32(40, n * 4, true);
  const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767)));
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, s16(left[i]), true);
    out.setInt16(46 + i * 4, s16(right[i]), true);
  }
  return new Uint8Array(out.buffer);
}

/** Whether a file is an MP3 by its first bytes: an ID3 tag or an MPEG frame sync. */
export function isMp3(head: Uint8Array): boolean {
  return (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
}

/** How long a song plays, read by the browser's player without decoding it all. */
export function duration(url: string): Promise<number> {
  return new Promise((ok) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => ok(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => ok(0);
    a.src = url;
  });
}

/** The file as the compiler takes it, and how long it plays. */
export async function songBytes(file: File, seconds: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isMp3(bytes)) return bytes;
  const ctx = new AudioContext({ sampleRate: RATE });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
  } catch {
    throw new Error(L`Этот файл окно прочитать не смогло: ${file.name}`);
  } finally {
    void ctx.close();
  }
  const long = Math.min(decoded.duration, seconds || decoded.duration, MAX_SECONDS);
  const frames = Math.min(decoded.length, Math.ceil(long * RATE));
  const left = decoded.getChannelData(0).subarray(0, frames);
  const right = (decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)).subarray(0, frames);
  return encodeStereoWav(left, right);
}
