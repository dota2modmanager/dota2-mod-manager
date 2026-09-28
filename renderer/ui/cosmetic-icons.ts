/* Item pictures, fetched only for what the user can actually see.
 *
 * A cosmetic slot can hold two thousand items and every picture is a data URI from the main
 * process, so asking for all of them would stall the window. An observer collects the tiles
 * that scroll into view and fetches those in small batches.
 *
 * Both the library and the cosmetics screen draw these tiles, which is why this sits apart
 * from either of them.
 */
// Item pictures come from the main process as data URIs (src/icons.js). A slot can hold two
// thousand items, so only what is actually on screen is ever asked for: an observer collects
// the tiles that scroll into view and fetches them in small batches.
const cosIconCache = new Map<string, string | null>();

// Readers for everyone else. The cache stays private: a picture is either known or it is
// not, and nothing outside this file has any business putting one in.
export const cosmeticIcon = (name: string): string | null | undefined => cosIconCache.get(name);
export const cosmeticIconKnown = (name: string): boolean => cosIconCache.has(name);

// A tile hears about its own picture here, by name.
const listeners = new Map<string, Set<() => void>>();
export function subscribeIcon(name: string, fn: () => void): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, set = new Set());
  set.add(fn);
  return () => {
    const set = listeners.get(name);
    set?.delete(fn);
    if (set && !set.size) listeners.delete(name);
  };
}
function announce(names: string[]): void {
  for (const n of names) for (const fn of listeners.get(n) || []) fn();
}

export async function loadCosmeticIcons(names: string[], onEach: (names: string[]) => void): Promise<void> {
  const want = [...new Set(names)].filter((n) => n && !cosIconCache.has(n));
  for (let i = 0; i < want.length; i += 24) {
    const chunk = want.slice(i, i + 24);
    const { pictures, decode } = await window.api.cosmetics.icons(chunk);
    for (const n of chunk) cosIconCache.set(n, pictures[n] || null);
    announce(chunk);
    onEach(chunk);

    // A mod that replaces a hero's animated portrait has the best picture of itself in that
    // clip, and only this side can open it: decoding video is what a browser does, and this
    // app is one. The main process hands over the bytes and keeps the frame that comes back
    // (see src/mod-preview.js), so a mod is decoded once and is a cached picture ever after.
    // Until then the tile shows whatever else was found, and swaps when the frame lands.
    for (const clip of decode || []) {
      const src = await frameFromVideo(clip);
      if (!src) continue;
      const touched = chunk.filter((n) => n.split('|')[0] === clip);
      for (const n of touched) cosIconCache.set(n, src);
      announce(touched);
      onEach(touched);
    }
  }
}

// Pull one frame out of the mod's own clip. A little way in rather than at the very start:
// these portraits often open on a fade from black, and a black square is not a picture.
async function frameFromVideo(key: string): Promise<string | null> {
  let bytes: Uint8Array | null = null;
  try { bytes = await window.api.preview.video(key); } catch { return null; }
  if (!bytes || !bytes.length) return null;

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'video/webm' }));
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    const failed = await new Promise<boolean>((done) => {
      video.onerror = () => done(true);
      video.onloadeddata = () => done(false);
      setTimeout(() => done(true), 8000);
    });
    if (failed || !video.videoWidth) return null;
    await new Promise<void>((done) => {
      video.onseeked = () => done();
      video.currentTime = Math.min(0.7, (video.duration || 1) / 3);
      setTimeout(done, 3000);
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!png) return null;
    // the frame goes back to be judged and kept, and comes back as the picture to draw
    return await window.api.preview.frame(key, new Uint8Array(await png.arrayBuffer()));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* One watcher for every tile React draws: a tile hands over its element and its name when it
 * mounts, and the picture is fetched once the tile is near the screen, in the same batches. */
let shared: IntersectionObserver | null = null;
const sharedQueue = new Set<string>();
let sharedTimer = 0;
export function watchIconFor(el: HTMLElement, name: string | null | undefined): () => void {
  if (!name || cosIconCache.has(name)) return () => {};
  if (!shared) {
    shared = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        shared?.unobserve(en.target);
        const n = (en.target as HTMLElement).dataset.name;
        if (n && !cosIconCache.has(n)) sharedQueue.add(n);
      }
      if (sharedQueue.size && !sharedTimer) {
        sharedTimer = window.setTimeout(() => {
          sharedTimer = 0;
          const names = [...sharedQueue];
          sharedQueue.clear();
          loadCosmeticIcons(names, () => {}).catch(() => {});
        }, 80);
      }
    }, { rootMargin: '200px' });
  }
  shared.observe(el);
  return () => shared?.unobserve(el);
}
