/* Item pictures, fetched only for what the user can actually see.
 *
 * A cosmetic slot can hold two thousand items and every picture is a data URI from the main
 * process, so asking for all of them would stall the window. An observer collects the tiles
 * that scroll into view and fetches those in small batches.
 *
 * Both the library and the cosmetics screen draw these tiles, which is why this sits apart
 * from either of them.
 */
import { esc } from './format.js';

// Item pictures come from the main process as data URIs (src/icons.js). A slot can hold two
// thousand items, so only what is actually on screen is ever asked for: an observer collects
// the tiles that scroll into view and fetches them in small batches.
const cosIconCache = new Map();

// Readers for everyone else. The cache stays private: a picture is either known or it is
// not, and nothing outside this file has any business putting one in.
export const cosmeticIcon = (name) => cosIconCache.get(name);
export const cosmeticIconKnown = (name) => cosIconCache.has(name);

// A tile drawn by React hears about its own picture here, by name, instead of being repainted
// by the sweep below (which skips anything marked data-owned).
const listeners = new Map(); // name -> Set<fn>
export function subscribeIcon(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => {
    const set = listeners.get(name);
    set?.delete(fn);
    if (set && !set.size) listeners.delete(name);
  };
}
function announce(names) {
  for (const n of names) for (const fn of listeners.get(n) || []) fn();
}

export async function loadCosmeticIcons(names, onEach) {
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
async function frameFromVideo(key) {
  let bytes = null;
  try { bytes = await window.api.preview.video(key); } catch { return null; }
  if (!bytes || !bytes.length) return null;

  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    const failed = await new Promise((done) => {
      video.onerror = () => done(true);
      video.onloadeddata = () => done(false);
      setTimeout(() => done(true), 8000);
    });
    if (failed || !video.videoWidth) return null;
    await new Promise((done) => {
      video.onseeked = done;
      video.currentTime = Math.min(0.7, (video.duration || 1) / 3);
      setTimeout(done, 3000);
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const png = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    if (!png) return null;
    // the frame goes back to be judged and kept, and comes back as the picture to draw
    return await window.api.preview.frame(key, new Uint8Array(await png.arrayBuffer()));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fill every tile whose picture is already known. A tile that already has one is left alone
// unless the picture has actually changed - which happens when a frame decoded out of the
// mod's own clip arrives and takes the place of the stand-in shown meanwhile.
export function paintCosmeticIcons(root) {
  for (const el of root.querySelectorAll('.card-thumb[data-name]:not([data-owned]), .lib-thumb[data-name]:not([data-owned])')) {
    const src = cosIconCache.get(el.dataset.name);
    if (!src) continue;
    const img = el.querySelector('img');
    if (!img) el.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy">`;
    else if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  }
}

/**
 * Watch a scrolling container and fetch pictures for tiles as they appear.
 * @returns {IntersectionObserver} caller disconnects it when the view goes away
 */
export function watchCosmeticIcons(root, scroller) {
  let queue = new Set();
  let timer = null;
  const flush = async () => {
    timer = null;
    const names = [...queue];
    queue = new Set();
    if (!names.length) return;
    await loadCosmeticIcons(names, () => paintCosmeticIcons(root));
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const name = en.target.dataset.name;
      io.unobserve(en.target);
      if (name && !cosIconCache.has(name)) queue.add(name);
      else if (name) paintCosmeticIcons(root);
    }
    if (queue.size && !timer) timer = setTimeout(flush, 80);
  }, { root: scroller || null, rootMargin: '200px' });
  for (const el of root.querySelectorAll('.card-thumb[data-name]:not([data-owned]), .lib-thumb[data-name]:not([data-owned])')) io.observe(el);
  return io;
}

/* One watcher for every tile React draws: a tile hands over its element and its name when it
 * mounts, and the picture is fetched once the tile is near the screen, in the same batches. */
let shared = null;
const sharedQueue = new Set();
let sharedTimer = null;
export function watchIconFor(el, name) {
  if (!name || cosIconCache.has(name)) return () => {};
  if (!shared) {
    shared = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        shared.unobserve(en.target);
        const n = en.target.dataset.name;
        if (n && !cosIconCache.has(n)) sharedQueue.add(n);
      }
      if (sharedQueue.size && !sharedTimer) {
        sharedTimer = setTimeout(() => {
          sharedTimer = null;
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
