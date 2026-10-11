/**
 * Contrast measured on the pixels, for the text axe-core cannot judge.
 *
 * axe works out contrast from CSS. Over the app's translucent panels, a gradient or a picture it
 * cannot know the colour behind the text, so it reports "incomplete" and leaves the text to a
 * person. That was most of what it saw: a hundred and more nodes on each section.
 *
 * This measures them instead. The page is captured once with every glyph's fill made transparent, which
 * leaves exactly what is behind the text. For each node axe gave up on, every pixel under its text
 * is a background, the text's own colour (its alpha times the opacity of everything it sits in) is
 * laid over that pixel, and the WCAG ratio between the two is worked out. A node passes when the
 * pixel at the 2nd percentile still reaches 4.5:1, or 3:1 for large text; the very worst pixel is
 * kept in the report too, because a single stray pixel of a picture should not fail a label but a
 * person reading the report should see it.
 *
 * Plain functions over BGRA buffers (NativeImage.toBitmap()), so the tests run without a window,
 * and one string of page code that finds the nodes and their text.
 */

/** An sRGB channel, 0 to 255, in linear light. */
const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of [r, g, b]. */
function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio between two colours, 1 to 21. */
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` laid over the opaque `bg`. */
function over(fg, alpha, bg) {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
}

/** WCAG's large text: 18pt, or 14pt bold. In CSS pixels, 24 and 18.66. */
function isLarge(px, weight) {
  return px >= 24 || (px >= 18.66 && weight >= 700);
}

/**
 * One node's text against the pixels behind it.
 *
 * @param {{ bitmap: Buffer, width: number, height: number, scale: number }} frame
 *   the capture with the text hidden; `scale` is device pixels per CSS pixel
 * @param {{ rects: {x:number,y:number,w:number,h:number}[], color: number[], alpha: number, large: boolean }} node
 *   where its text is, in CSS pixels, and the colour it is drawn in
 * @returns {{ need: number, low: number, worst: number, pixels: number, ok: boolean } | null}
 *   null when none of its text is on the capture
 */
function measure({ bitmap, width, height, scale }, node) {
  const ratios = [];
  for (const r of node.rects) {
    const x0 = Math.max(0, Math.floor(r.x * scale));
    const y0 = Math.max(0, Math.floor(r.y * scale));
    const x1 = Math.min(width, Math.ceil((r.x + r.w) * scale));
    const y1 = Math.min(height, Math.ceil((r.y + r.h) * scale));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const bg = [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
        ratios.push(ratio(over(node.color, node.alpha, bg), bg));
      }
    }
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  const need = node.large ? 3 : 4.5;
  const low = ratios[Math.floor(ratios.length * 0.02)];
  const round = (v) => Math.round(v * 100) / 100;
  return { need, low: round(low), worst: round(ratios[0]), pixels: ratios.length, ok: low >= need };
}

/**
 * Page code: for each selector, the text it holds, where that text is, the colour it is drawn in
 * and whether it counts as large. A node comes back with `skip` saying why when it is disabled
 * (WCAG exempts an inactive control), sits behind an open window (dimmed on purpose, and nobody
 * can reach it), is covered by something drawn over it, is scrolled or clipped out of sight, or
 * has no text.
 */
const NODES = `((targets) => {
  // Any CSS colour as [r, g, b, a] in 0-255 and 0-1. A colour from color-mix() computes to
  // color(srgb 0.8 0.7 1 / 0.6), channels from 0 to 1, and read as 0-255 it was nearly black,
  // so the canvas does the converting.
  const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].find((d) => d.getClientRects().length);
  const textsOf = (el) => {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (own.length) return own;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) out.push(n);
    return out;
  };
  // A text box cut down to what its scrolling and clipping ancestors let through, and to the
  // window; null when nothing of it is left. Without this, "Скачать" at the foot of Settings,
  // scrolled half under the status bar, was measured against the status bar.
  const visible = (r, el) => {
    let { left, top, right, bottom } = r;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = p.getBoundingClientRect();
      left = Math.max(left, b.left); top = Math.max(top, b.top); right = Math.min(right, b.right); bottom = Math.min(bottom, b.bottom);
    }
    left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, innerWidth); bottom = Math.min(bottom, innerHeight);
    return right - left >= 1 && bottom - top >= 1 ? { x: left, y: top, w: right - left, h: bottom - top } : null;
  };
  // whether the text is what is on top there, and not something drawn over it
  const onTop = (el, r) => {
    const hit = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
    return !!hit && (el.contains(hit) || hit.contains(el));
  };
  return targets.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, skip: 'gone' };
    if (el.closest(':disabled, [aria-disabled="true"]')) return { sel, skip: 'disabled' };
    if ((modal && !modal.contains(el)) || el.closest('[inert]')) return { sel, skip: 'behind a window' };
    const texts = textsOf(el);
    const rects = [];
    let covered = false;
    for (const t of texts) {
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        const v = visible(r, t.parentElement);
        if (!v) continue;
        if (onTop(t.parentElement, v)) rects.push(v);
        else covered = true;
      }
    }
    const text = texts.map((t) => t.textContent).join(' ').replace(/\\s+/g, ' ').trim().slice(0, 50);
    if (!rects.length) return { sel, text, skip: covered ? 'covered' : 'off screen' };
    const holder = texts[0].parentElement;
    const cs = getComputedStyle(holder);
    const [r, g, b, a] = rgba(cs.color);
    let alpha = a;
    for (let p = holder; p; p = p.parentElement) alpha *= Number(getComputedStyle(p).opacity);
    return { sel, text, rects, color: [r, g, b], alpha, px: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400 };
  });
})`;

/** A style that makes every glyph transparent. The fill, not `color`: a border or a tint drawn
 * in currentColor is part of the background and has to stay where it is. */
const HIDE_TEXT = `*, *::before, *::after, ::placeholder {
  -webkit-text-fill-color: transparent !important; text-shadow: none !important;
  caret-color: transparent !important; text-decoration-color: transparent !important;
}`;

module.exports = { luminance, ratio, over, isLarge, measure, NODES, HIDE_TEXT };
