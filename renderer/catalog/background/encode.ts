/* The user's picture, GIF or video as a VP9 WebM for the main menu (issue #418), made in the window
 * with WebCodecs: the browser decodes whatever it can show and encodes VP9, so the app downloads
 * no converter. A picture becomes two seconds of one frame, a GIF or an animated WebP keeps the
 * time of each of its frames, and a video plays through once, muted, and is taken frame by frame.
 * The frames are fitted into 1920x1080 at most, in even sizes, and laid out as a file by webm.ts. */
import { muxWebm, type Frame } from './webm.ts';

/** The longest clip taken from a video, and the most a menu background may weigh. */
export const MAX_SECONDS = 30;
export const MAX_BYTES = 40 * 1024 * 1024;

const STILL_SECONDS = 2;
const KEY_EVERY_US = 2_000_000;

export interface Encoded { webm: Uint8Array; width: number; height: number; seconds: number }

/** The size the frames are encoded at: the source's, fitted into 1920x1080, each side even. */
export function fitSize(w: number, h: number, max = { w: 1920, h: 1080 }): { width: number; height: number } {
  const scale = Math.min(1, max.w / w, max.h / h);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** The encoder, fed frames drawn on one canvas; it hands back the file when told the clip is done. */
async function encoder(width: number, height: number, motion: boolean) {
  const frames: Frame[] = [];
  let failed: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, time: chunk.timestamp, key: chunk.type === 'key' });
    },
    error: (e) => { failed = e as Error; },
  });
  const config: VideoEncoderConfig = {
    codec: 'vp09.00.40.08', width, height, framerate: motion ? 30 : 1,
    bitrate: motion ? Math.min(8_000_000, Math.round(width * height * 2.4)) : 2_000_000, latencyMode: 'quality',
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error(L`Этот компьютер не умеет кодировать VP9`);
  enc.configure(config);
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  let lastKey = -Infinity;
  return {
    /** One picture on screen from `time` (µs). */
    add(src: CanvasImageSource, time: number, duration: number) {
      if (failed) throw failed;
      g.fillStyle = '#000';
      g.fillRect(0, 0, width, height);
      g.drawImage(src, 0, 0, width, height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(time), duration: Math.round(duration) });
      const key = time - lastKey >= KEY_EVERY_US;
      if (key) lastKey = time;
      enc.encode(frame, { keyFrame: key });
      frame.close();
    },
    async done(duration: number): Promise<Uint8Array> {
      await enc.flush();
      enc.close();
      if (failed) throw failed;
      frames.sort((a, b) => a.time - b.time);
      return muxWebm({ width, height, frames, duration });
    },
  };
}

async function fromStill(file: Blob): Promise<Encoded> {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitSize(bmp.width, bmp.height);
  const enc = await encoder(width, height, false);
  const us = STILL_SECONDS * 1_000_000;
  // two frames a second apart: one frame alone is a clip some players never start
  enc.add(bmp, 0, us / 2);
  enc.add(bmp, us / 2, us / 2);
  bmp.close();
  return { webm: await enc.done(us), width, height, seconds: STILL_SECONDS };
}

async function fromAnimation(file: Blob, type: string, progress: (p: number) => void): Promise<Encoded> {
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack?.frameCount ?? 1;
  const first = (await dec.decode({ frameIndex: 0 })).image;
  const { width, height } = fitSize(first.displayWidth, first.displayHeight);
  first.close();
  const enc = await encoder(width, height, true);
  let time = 0;
  for (let i = 0; i < count && time < MAX_SECONDS * 1_000_000; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    // a GIF frame with no delay shows for a tenth of a second, as browsers show it
    const duration = image.duration && image.duration > 10_000 ? image.duration : 100_000;
    enc.add(image, time, duration);
    time += duration;
    image.close();
    progress(i / count);
  }
  dec.close();
  return { webm: await enc.done(time), width, height, seconds: time / 1_000_000 };
}

async function fromVideo(file: Blob, progress: (p: number) => void): Promise<Encoded> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((ok, fail) => { video.onloadedmetadata = () => ok(); video.onerror = () => fail(new Error(L`Это видео окно открыть не смогло`)); });
    const { width, height } = fitSize(video.videoWidth, video.videoHeight);
    const enc = await encoder(width, height, true);
    const end = Math.min(video.duration || MAX_SECONDS, MAX_SECONDS);
    let last = -1;
    await new Promise<void>((ok, fail) => {
      const take = (_now: number, meta: VideoFrameCallbackMetadata) => {
        try {
          const t = meta.mediaTime;
          if (t > last) { enc.add(video, t * 1_000_000, 1_000_000 / 30); last = t; }
          progress(t / end);
          if (t >= end || video.ended) { video.pause(); ok(); return; }
          video.requestVideoFrameCallback(take);
        } catch (err) { fail(err as Error); }
      };
      video.onended = () => ok();
      video.requestVideoFrameCallback(take);
      video.play().catch(fail);
    });
    const seconds = Math.max(last, 0) + 1 / 30;
    return { webm: await enc.done(seconds * 1_000_000), width, height, seconds };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** What a file is to the encoder, by its type: a still picture, an animation, a video, or nothing it takes. */
export function sourceKind(type: string): 'still' | 'animation' | 'video' | null {
  if (/^image\/(gif|webp|apng|png)$/.test(type)) return type === 'image/png' ? 'still' : 'animation';
  if (/^image\/(jpeg|avif|bmp)$/.test(type)) return 'still';
  if (/^video\//.test(type)) return 'video';
  return null;
}

/** The file as the menu's WebM. An animated WebP with one frame comes out as a still would. */
export async function encodeBackground(file: File, progress: (p: number) => void = () => {}): Promise<Encoded> {
  const kind = sourceKind(file.type);
  if (!kind) throw new Error(L`Нужна картинка, GIF или видео`);
  const out = kind === 'still' ? await fromStill(file) : kind === 'video' ? await fromVideo(file, progress) : await fromAnimation(file, file.type, progress);
  if (out.webm.length > MAX_BYTES) throw new Error(L`Получилось больше 40 МБ: возьми ролик короче`);
  return out;
}
