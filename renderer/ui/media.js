/* Where a preview lives and how it is drawn. The catalog stores previews as repo-relative
 * paths, absolute links, or nothing at all, and each of those has to end up as one tag. */
import { RAW_BASE, MIRROR_BASE } from '../core/constants.js';
import { esc } from './format.js';

export function previewUrl(categoryId, preview) {
  if (!preview) return null;
  if (/^https?:\/\//i.test(preview)) return preview;
  if (preview.startsWith('assets/previews/')) return `${RAW_BASE}/${preview.split('/').map(encodeURIComponent).join('/')}`;
  return `${RAW_BASE}/assets/previews/${encodeURIComponent(categoryId)}/${encodeURIComponent(preview)}`;
}

/**
 * The same address on the mirror, or null when the picture did not come from the catalog.
 *
 * Only rewrites what raw.githubusercontent was serving. A preview that already carries an
 * absolute link belongs to whoever wrote it, and pointing that at our bucket would ask for a
 * file nobody ever put there.
 */
export function mirrorOf(url) {
  return typeof url === 'string' && url.startsWith(`${RAW_BASE}/`)
    ? `${MIRROR_BASE}/${url.slice(RAW_BASE.length + 1)}`
    : null;
}

export function isVideo(src) { return /\.(mp4|webm)$/i.test(src || ''); }
export function isAudio(src) { return /\.(mp3|wav|ogg)$/i.test(src || ''); }
export function isMedia(src) { return isVideo(src) || isAudio(src); }

// resolve a repo-relative or absolute link to a full URL
export function resolveUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${RAW_BASE}/${url.split('/').map(encodeURIComponent).join('/')}`;
}

export function mediaHtml(url, { hoverPlay = false, autoplay = false, controls = false, fallbackIcon = 'image' } = {}) {
  if (!url) {
    return `<div class="noimg"><span class="ms">${esc(fallbackIcon)}</span></div>`;
  }
  if (isVideo(url)) {
    // preload="metadata" shows the first frame instead of a black box
    return `<video src="${esc(url)}" ${controls ? 'controls' : 'muted'} loop playsinline preload="${autoplay ? 'auto' : 'metadata'}" ${autoplay ? 'autoplay' : ''} ${hoverPlay ? 'data-hoverplay="1"' : ''}></video>`;
  }
  if (isAudio(url)) {
    return `<div class="audio-wrap"><span class="ms audio-icon">graphic_eq</span><audio src="${esc(url)}" controls preload="none"></audio></div>`;
  }
  return `<img src="${esc(url)}" loading="lazy" alt="">`;
}

/**
 * What to do when a picture does not arrive.
 *
 * Until now: nothing. A preview that failed left the browser's own empty box, so somebody
 * behind a blocked GitHub saw a catalog full of grey rectangles and no reason for any of it -
 * the app looked broken while working perfectly. Two things happen instead.
 *
 * The picture is asked for again from the mirror, which is the same file from a host that is
 * not GitHub. If that fails too, the tile gets the placeholder it would have had if the mod
 * carried no picture at all, which at least reads as deliberate.
 *
 * And after a handful of them, the user is told once. Not per picture: a hundred toasts is
 * the same silence with more noise in it.
 *
 * One listener in the capture phase, because error events from an <img> do not bubble and a
 * strict CSP has no room for an onerror attribute.
 *
 * @param {(msg: string) => void} onTrouble  called once when pictures keep failing
 */
let failures = 0;
let told = false;
let trouble = () => {};

/** Counts a picture that failed from both hosts, and tells the user once after a handful. A
 *  picture drawn by React (catalog/card/Media.tsx) retries and gives up on its own, then calls
 *  this, because the listener below must not swap out an element React owns. */
export function mediaGaveUp() {
  failures += 1;
  if (failures >= 3 && !told) {
    told = true;
    trouble();
  }
}

export function watchMedia(onTrouble = () => {}) {
  trouble = onTrouble;
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement) && !(el instanceof HTMLVideoElement)) return;
    if (el.dataset.mediaGaveUp || el.dataset.owned === 'react') return;

    const spare = el.dataset.mediaRetried ? null : mirrorOf(el.currentSrc || el.src);
    if (spare) {
      el.dataset.mediaRetried = '1';
      el.src = spare;
      return;
    }

    el.dataset.mediaGaveUp = '1';
    const box = document.createElement('div');
    box.className = 'noimg';
    const icon = document.createElement('span');
    icon.className = 'ms';
    icon.textContent = 'image_not_supported';
    box.appendChild(icon);
    el.replaceWith(box);
    mediaGaveUp();
  }, true);
}
