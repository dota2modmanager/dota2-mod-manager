/* Spiders that live in the window: the ones Broodmother sets loose (ui/brood.ts) and the ones the
 * bloody night breeds (ui/blood.ts).
 *
 * A spider runs from the pointer, wanders while nobody is near, and in the end leaves by the
 * nearest edge. It can be caught: press on it and it hangs from the pointer kicking its legs;
 * let go while moving and it is thrown, and thrown hard enough upwards it does not come back down
 * (people asked to be able to send one into space). Dropped or thrown into the pumpkin in the
 * title bar, it is eaten, and the pumpkin says so with 'mm-spider-eaten' (ui/pumpkin.ts).
 *
 * One layer over the window, above the content and below the dialogs, that takes the pointer
 * only on the spiders themselves. One frame loop for all of them, which stops when the last one
 * is gone. With less motion asked for, spiders do not run: they sit where they appeared and can
 * still be picked up and carried, since carrying is the person's own movement.
 */

const NS = 'http://www.w3.org/2000/svg';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A spider drawn facing up, legs in two sets that scuttle against each other. */
export function spiderSvg(cls = 'sp-body'): SVGElement {
  const s = svg('svg', { viewBox: '-20 -20 40 40', class: cls });
  const legs = [[-3, -2, -11, -10, -16, -6], [-3, 0, -13, -4, -18, 1], [-3, 2, -12, 4, -17, 10], [-3, 4, -9, 9, -12, 16]];
  for (const side of [1, -1]) {
    const g = svg('g', { class: `legs ${side > 0 ? 'a' : 'b'}` });
    legs.forEach(([x1, y1, x2, y2, x3, y3], i) => g.appendChild(svg('polyline', { points: `${x1 * side},${y1} ${x2 * side},${y2} ${x3 * side},${y3}`, class: `leg${i % 2 ? ' odd' : ''}` })));
    s.appendChild(g);
  }
  s.appendChild(svg('ellipse', { cx: 0, cy: 6, rx: 6.4, ry: 8, class: 'ab' }));
  s.appendChild(svg('path', { d: 'M0 1.5 L-1.6 5 L0 9 L1.6 5 Z', class: 'mark' }));
  s.appendChild(svg('circle', { cx: 0, cy: -4, r: 4.2, class: 'hd' }));
  s.appendChild(svg('circle', { cx: -1.6, cy: -5.2, r: 1, class: 'eye' }));
  s.appendChild(svg('circle', { cx: 1.6, cy: -5.2, r: 1, class: 'eye' }));
  return s;
}

type Mode = 'run' | 'held' | 'flung' | 'space' | 'rest';
interface Spider {
  el: HTMLElement; x: number; y: number; vx: number; vy: number; a: number; size: number;
  mode: Mode; life: number; wander: number; restUntil: number;
  /** where it was going while nobody bothered it */
  home?: { x: number; y: number } | null;
  /** a resident of the bloody night: it stays instead of leaving */
  stays: boolean;
  onRest?: (s: Spider) => void;
}

let layer: HTMLElement | null = null;
let spiders: Spider[] = [];
let raf = 0;
let last = 0;
let px = -9999, py = -9999;
let held: Spider | null = null;
const trail: Array<{ x: number; y: number; t: number }> = [];

function ensureLayer(): HTMLElement {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'spl';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    trail.push({ x: px, y: py, t: performance.now() });
    while (trail.length > 6) trail.shift();
  }, { passive: true });
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  return layer;
}

function release(): void {
  if (!held) return;
  const s = held;
  held = null;
  s.el.classList.remove('held');
  if (eat(s)) return;
  // the pointer's speed over its last few moves is what it was thrown with
  const a = trail[0], b = trail[trail.length - 1];
  const dt = a && b ? (b.t - a.t) / 1000 : 0;
  s.vx = dt > 0.005 ? (b.x - a.x) / dt : 0;
  s.vy = dt > 0.005 ? (b.y - a.y) / dt : 0;
  const speed = Math.hypot(s.vx, s.vy);
  if (still()) { s.vx = s.vy = 0; s.mode = 'run'; return; }
  if (s.vy < -900 && speed > 1300) { s.mode = 'space'; s.el.classList.add('space'); return; }
  s.mode = speed > 120 ? 'flung' : 'run';
}

/** The pumpkin, if the spider is over it: it is eaten, and the window is told. */
function eat(s: Spider): boolean {
  const pk = document.querySelector('.tb-pumpkin');
  if (!pk) return false;
  const r = pk.getBoundingClientRect();
  const pad = 14;
  if (s.x < r.left - pad || s.x > r.right + pad || s.y < r.top - pad || s.y > r.bottom + pad) return false;
  s.el.classList.add('eaten');
  s.mode = 'rest';
  s.life = 0;
  setTimeout(() => s.el.remove(), 320);
  spiders = spiders.filter((x) => x !== s);
  document.dispatchEvent(new CustomEvent('mm-spider-eaten'));
  return true;
}

function place(s: Spider): void {
  s.el.style.transform = `translate(${(s.x - s.size / 2).toFixed(1)}px, ${(s.y - s.size / 2).toFixed(1)}px) rotate(${s.a.toFixed(1)}deg)`;
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (document.hidden || !dt) return;
  const w = innerWidth, h = innerHeight;
  spiders = spiders.filter((s) => {
    if (s.mode === 'held') {
      s.x += (px - s.x) * Math.min(1, dt * 30);
      s.y += (py + s.size * 0.3 - s.y) * Math.min(1, dt * 30);
      s.a = Math.sin(now / 90) * 18;
      place(s);
      return true;
    }
    if (s.mode === 'space') {
      // up and away, smaller and spinning, and a star where it goes out
      s.vy -= 900 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.a += 900 * dt;
      s.life -= dt * 0.9;
      s.el.style.opacity = String(Math.max(0, s.life));
      s.el.style.transform = `translate(${(s.x - s.size / 2).toFixed(1)}px, ${(s.y - s.size / 2).toFixed(1)}px) rotate(${s.a.toFixed(1)}deg) scale(${Math.max(0.1, s.life).toFixed(2)})`;
      if (s.y < -40 || s.life <= 0) { twinkle(Math.min(w - 20, Math.max(20, s.x)), Math.max(14, s.y)); s.el.remove(); return false; }
      return true;
    }
    if (s.mode === 'flung') {
      s.vy += 1400 * dt;
      s.vx *= Math.pow(0.4, dt); s.vy *= Math.pow(0.6, dt);
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.a += s.vx * dt * 0.8;
      if (s.x < 10 || s.x > w - 10) { s.vx = -s.vx * 0.4; s.x = Math.min(w - 10, Math.max(10, s.x)); }
      if (s.y > h - 16) { s.y = h - 16; s.vy = -s.vy * 0.25; s.vx *= 0.6; if (Math.abs(s.vy) < 60) s.mode = 'run'; }
      if (eat(s)) return false;
      place(s);
      return true;
    }
    if (s.mode === 'rest') {
      if (now > s.restUntil) s.mode = 'run';
      // rest is still unless the pointer comes close
      if (Math.hypot(s.x - px, s.y - py) < 90) { s.mode = 'run'; s.restUntil = 0; }
      return true;
    }
    if (still()) return true;
    // running: from the pointer, otherwise towards home or out of the window
    s.life -= dt;
    let ax = 0, ay = 0;
    const dx = s.x - px, dy = s.y - py, d = Math.hypot(dx, dy) || 1;
    const scared = d < 170;
    if (scared) { ax += (dx / d) * 2600 * (1 - d / 170); ay += (dy / d) * 2600 * (1 - d / 170); }
    s.wander += (Math.random() - 0.5) * 6 * dt;
    let target: { x: number; y: number } | null = s.home ?? null;
    if (!target && s.life <= 0 && !s.stays) {
      // time to go: the nearest edge
      const edges = [{ x: -40, y: s.y, d: s.x }, { x: w + 40, y: s.y, d: w - s.x }, { x: s.x, y: h + 40, d: h - s.y }];
      edges.sort((p, q) => p.d - q.d);
      target = edges[0];
    }
    if (target) {
      const tx = target.x - s.x, ty = target.y - s.y, td = Math.hypot(tx, ty) || 1;
      ax += (tx / td) * 700; ay += (ty / td) * 700;
      if (s.home && td < 6 && !scared) {
        s.home = null; s.vx = s.vy = 0; s.mode = 'rest'; s.restUntil = now + 4000 + Math.random() * 9000;
        s.el.classList.remove('walk');
        s.onRest?.(s);
        return true;
      }
    } else {
      ax += Math.cos(s.wander) * 260; ay += Math.sin(s.wander) * 260;
    }
    // the walls push back, unless it is leaving through one
    const m = 24;
    if (!(s.life <= 0 && !s.stays)) {
      if (s.x < m) ax += (m - s.x) * 60;
      if (s.x > w - m) ax -= (s.x - (w - m)) * 60;
      if (s.y < m + 30) ay += (m + 30 - s.y) * 60;
      if (s.y > h - m) ay -= (s.y - (h - m)) * 60;
    }
    s.vx += ax * dt; s.vy += ay * dt;
    s.vx *= Math.pow(0.08, dt); s.vy *= Math.pow(0.08, dt);
    const top = scared ? 330 : 150, sp = Math.hypot(s.vx, s.vy);
    if (sp > top) { s.vx *= top / sp; s.vy *= top / sp; }
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (sp > 8) s.a = (Math.atan2(s.vy, s.vx) * 180) / Math.PI + 90;
    s.el.classList.toggle('walk', sp > 8);
    place(s);
    const gone = s.x < -60 || s.x > w + 60 || s.y < -60 || s.y > h + 60;
    if (gone) s.el.remove();
    return !gone;
  });
  if (!spiders.length) { cancelAnimationFrame(raf); raf = 0; }
}

function twinkle(x: number, y: number): void {
  const t = document.createElement('i');
  t.className = 'sp-star';
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  ensureLayer().appendChild(t);
  setTimeout(() => t.remove(), 1200);
}

export interface SpawnOptions {
  /** how fast it bursts out, px/s; 0 for one that walks */
  burst?: number;
  /** the burst's direction in radians; random when left out */
  angle?: number;
  /** seconds it wanders before it leaves; residents stay */
  life?: number;
  stays?: boolean;
  size?: number;
  home?: { x: number; y: number } | null;
  onRest?: (s: { x: number; y: number }) => void;
}

/** Let a spider loose at (x, y). Returns how many are about now. */
export function spawnSpider(x: number, y: number, opts: SpawnOptions = {}): number {
  const host = ensureLayer();
  const size = opts.size ?? 24 + Math.random() * 12;
  const el = document.createElement('div');
  el.className = 'sp';
  el.style.width = el.style.height = `${size.toFixed(0)}px`;
  el.appendChild(spiderSvg());
  host.appendChild(el);
  const a = opts.angle ?? Math.random() * Math.PI * 2;
  const burst = still() ? 0 : opts.burst ?? 0;
  const s: Spider = {
    el, x, y, vx: Math.cos(a) * burst, vy: Math.sin(a) * burst, a: (a * 180) / Math.PI + 90, size,
    mode: 'run', life: opts.life ?? 9 + Math.random() * 6, wander: Math.random() * 6.3, restUntil: 0,
    home: opts.home ?? null, stays: opts.stays ?? false, onRest: opts.onRest,
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (s.mode === 'space') return;
    held = s;
    s.mode = 'held';
    s.home = null;
    el.classList.add('held');
    px = e.clientX; py = e.clientY;
    trail.length = 0;
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  spiders.push(s);
  place(s);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  return spiders.length;
}

/** How many residents (spiders that stay) there are now. */
export const residents = () => spiders.filter((s) => s.stays).length;

/** Send every resident away, for when the bloody night comes off. */
export function dismissResidents(): void {
  for (const s of spiders) if (s.stays) { s.stays = false; s.life = 0; s.home = null; if (s.mode === 'rest') s.mode = 'run'; }
}

/** Some spider's place, for a resident to lay its young beside. */
export function someResident(): { x: number; y: number } | null {
  const r = spiders.filter((s) => s.stays && s.mode === 'rest');
  const s = r[Math.floor(Math.random() * r.length)];
  return s ? { x: s.x, y: s.y } : null;
}
