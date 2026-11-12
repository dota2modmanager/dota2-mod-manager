/* The bloody night's dressing, worn with the tenth theme (ui/theme.ts; colours in themes.css
 * [data-theme='blood'], the rest in styles/blood.css). The pumpkin's key opens it (ui/pumpkin.ts).
 *
 * The one thing it is remembered by is the blood: it seeps from under the title bar along its
 * whole length, every so often a drop lets go of a streak, falls the height of the window and
 * bursts on the status bar, and what falls stays. A pool gathers along the top of the status bar
 * over the session, deeper where more has fallen, until it brims and spills.
 *
 * Around that, at the edges: webs in all four corners, spiders that live in them and breed (each
 * newborn walks off to a spot of its own and spins a web there; ui/spiders.ts lets any of them be
 * caught and thrown), a bloody hand that slaps against the side of the window and slides down, and
 * now and then a severed hand dragging itself along the status bar. The content in the middle is
 * left alone: this is a tool somebody is working in. While a mod's window is open the blood moves
 * onto it: the band seeps from its top edge, the pool gathers along its bottom, and the top-left
 * web hangs from its corner.
 *
 * One layer, out of the pointer's way, and one canvas for the drops and the pool, drawn only
 * while the window is visible. With less motion asked for, the blood hangs still, nothing falls,
 * nobody breeds or crawls, and the pool is drawn once at a fixed depth.
 */
import { spawnSpider, residents, dismissResidents, someResident } from './spiders.ts';
import { svg, div, cornerWeb, wheel, handPrint, crawler } from './blood-art.ts';
import { peeker } from './blood-peek.ts';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let undress: (() => void) | null = null;

function dress(): () => void {
  const live = !still();
  const layer = div('bn');
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };

  // ---- the band of blood under the title bar, and its streaks ----
  const band = div('bn-band');
  const lip = svg('svg', { class: 'bn-lip', viewBox: '0 0 1000 14', preserveAspectRatio: 'none' });
  let d = 'M0 0 H1000 V5';
  for (let x = 1000; x > 0; x -= 25) d += ` Q${x - 12} ${(9 + Math.random() * 5).toFixed(1)} ${x - 25} ${(4 + Math.random() * 3).toFixed(1)}`;
  lip.appendChild(svg('path', { d: `${d} Z` }));
  band.appendChild(lip);
  const streaks: HTMLElement[] = [];
  const n = Math.max(14, Math.round(innerWidth / 52));
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const h = 10 + Math.random() ** 1.6 * 90;
    s.style.setProperty('--x', `${((i + 0.15 + Math.random() * 0.7) / n) * 100}%`);
    s.style.setProperty('--w', `${(3 + Math.random() * 7).toFixed(1)}px`);
    s.style.setProperty('--h', `${h.toFixed(0)}px`);
    // each runs down once, the long ones slower, and not all at the same moment
    s.style.setProperty('--t', `${(1.5 + h / 30 + Math.random() * 1.5).toFixed(1)}s`);
    s.style.setProperty('--wait', `${(Math.random() * 2.5).toFixed(1)}s`);
    band.appendChild(s);
    streaks.push(s);
  }
  layer.appendChild(band);

  // ---- webs in the four corners ----
  for (const c of ['tl', 'tr', 'bl', 'br']) {
    const w = div(`bn-web ${c}`);
    w.appendChild(cornerWeb(c[0] === 't' ? 210 : 170, c === 'tr' || c === 'bl'));
    layer.appendChild(w);
  }

  // ---- the drops, the splashes and the pool, on one canvas ----
  const canvas = document.createElement('canvas');
  canvas.className = 'bn-canvas';
  layer.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let top = 46, bottom = 30;
  // where the blood runs: the window between its bars, or a mod's window while one is open
  let fl = -1, fr = -1, ft = -1, fb = -1;
  const COL = 6;
  let pool: number[] = [];
  const fit = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.ceil(innerWidth / COL) + 2;
    pool = Array.from({ length: cols }, (_, i) => pool[i] ?? (live ? 0 : 3 + Math.sin(i * 0.3) * 1.5));
  };
  const placeBars = () => {
    top = document.getElementById('titlebar')?.getBoundingClientRect().bottom ?? 46;
    const bar = document.getElementById('statusbar');
    bottom = bar && bar.offsetParent ? innerHeight - bar.getBoundingClientRect().top : 0;
    layer.style.setProperty('--top', `${Math.round(top)}px`);
    layer.style.setProperty('--bottom', `${Math.round(bottom)}px`);
    placeFrame();
  };
  const overlay = document.getElementById('modalOverlay');
  const placeFrame = () => {
    const open = overlay && !overlay.classList.contains('hidden') ? document.getElementById('modalContent')?.getBoundingClientRect() : null;
    const box = open?.width ? open : { left: 0, right: innerWidth, top, bottom: innerHeight - bottom };
    if (box.left === fl && box.right === fr && box.top === ft && box.bottom === fb) return;
    fl = box.left; fr = box.right; ft = box.top; fb = box.bottom;
    layer.classList.toggle('on-modal', !!open?.width);
    layer.style.setProperty('--ftop', `${Math.round(ft)}px`);
    layer.style.setProperty('--left', `${Math.round(fl)}px`);
    layer.style.setProperty('--right', `${Math.round(innerWidth - fr)}px`);
    if (!live) { ctx.clearRect(0, 0, innerWidth, innerHeight); drawPool(); }
  };
  const shown = new MutationObserver(() => placeFrame());
  if (overlay) shown.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  placeBars();
  fit();
  const watch = new ResizeObserver(() => { placeBars(); });
  for (const id of ['titlebar', 'statusbar']) { const e = document.getElementById(id); if (e) watch.observe(e); }
  const onResize = () => { placeBars(); fit(); };
  addEventListener('resize', onResize);

  type Drop = { x: number; y: number; vy: number; r: number };
  type Bit = { x: number; y: number; vx: number; vy: number; r: number; life: number };
  let drops: Drop[] = [];
  let bits: Bit[] = [];
  const MAX_POOL = 16;

  function drawPool() {
    const floor = fb, a = Math.max(0, Math.floor(fl / COL)), z = Math.min(pool.length - 1, Math.ceil(fr / COL));
    ctx.save();
    ctx.beginPath();
    ctx.rect(fl, 0, fr - fl, innerHeight);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(a * COL, floor + 2);
    for (let i = a; i <= z; i++) ctx.lineTo(i * COL, floor + 1 - pool[i]);
    ctx.lineTo(z * COL, floor + 2);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, floor - MAX_POOL, 0, floor);
    g.addColorStop(0, '#b0101c');
    g.addColorStop(1, '#4a0309');
    ctx.fillStyle = g;
    ctx.fill();
    // the wet shine along the top of it
    ctx.beginPath();
    let on = false;
    for (let i = a; i <= z; i++) {
      if (pool[i] < 1.5) { on = false; continue; }
      const x = i * COL, y = floor - pool[i] + 2.2;
      if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 140, 140, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** Blood landing at x: the pool rises there and runs out to the sides. */
  const land = (x: number, amount: number) => {
    const c = Math.round(x / COL);
    for (let k = -6; k <= 6; k++) {
      const i = c + k;
      if (i < 0 || i >= pool.length) continue;
      pool[i] = Math.min(MAX_POOL, pool[i] + amount * Math.exp(-(k * k) / 10));
    }
  };

  const drip = () => {
    const s = streaks[Math.floor(Math.random() * streaks.length)];
    const r = s.getBoundingClientRect();
    if (!r.height) return;
    drops.push({ x: r.left + r.width / 2, y: r.bottom - 2, vy: 0, r: Math.max(2, r.width * 0.5) });
  };

  let raf = 0, last = performance.now(), nextDrip = 1.5;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden) return;
    if ((nextDrip -= dt) <= 0) { drip(); nextDrip = 0.9 + Math.random() * 2.6; }
    if (overlay && !overlay.classList.contains('hidden') || fb !== innerHeight - bottom) placeFrame();
    const floor = fb;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = '#a10d18';
    drops = drops.filter((dr) => {
      dr.vy = Math.min(dr.vy + 1700 * dt, 1500);
      dr.y += dr.vy * dt;
      const surface = floor - (pool[Math.round(dr.x / COL)] ?? 0);
      if (dr.y >= surface) {
        land(dr.x, dr.r * 0.55);
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const v = 90 + Math.random() * 190;
          bits.push({ x: dr.x, y: surface, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.8 + Math.random() * 1.8, life: 1 });
        }
        return false;
      }
      // a falling drop is long and thin at the top, round at the bottom
      const stretch = 1 + dr.vy / 420;
      ctx.beginPath();
      ctx.ellipse(dr.x, dr.y, dr.r * 0.8, dr.r * stretch, 0, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    bits = bits.filter((b) => {
      b.vy += 900 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt * 1.6;
      if (b.life <= 0 || b.y > floor) return false;
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });
    // the pool settles: it levels out a little, and where it brims it spills sideways
    for (let i = 1; i < pool.length - 1; i++) pool[i] += (pool[i - 1] + pool[i + 1] - 2 * pool[i]) * Math.min(1, dt * 1.2);
    drawPool();
  };
  if (live) raf = requestAnimationFrame(frame);
  else drawPool();

  // ---- the spiders that live here, and breed ----
  const WEBS = 8;
  const webs: HTMLElement[] = [];
  const spin = (p: { x: number; y: number }) => {
    if (webs.length >= WEBS) return;
    const w = div('bn-woven');
    w.appendChild(wheel(16 + Math.random() * 12));
    w.style.left = `${p.x.toFixed(0)}px`;
    w.style.top = `${p.y.toFixed(0)}px`;
    layer.appendChild(w);
    webs.push(w);
  };
  /** A spot in one of the four corners, among the webs: never over the middle where the work is. */
  const edgeSpot = () => {
    const w = innerWidth, h = innerHeight;
    const right = Math.random() < 0.5, low = Math.random() < 0.5;
    const a = Math.random() * Math.PI / 2, d = 30 + Math.random() * 110;
    const x = right ? w - 14 - Math.cos(a) * d : 14 + Math.cos(a) * d;
    const y = low ? h - bottom - 12 - Math.sin(a) * d : top + 12 + Math.sin(a) * d;
    return { x, y };
  };
  const resident = (from: { x: number; y: number }) => spawnSpider(from.x, from.y, {
    stays: true, size: 18 + Math.random() * 14, home: edgeSpot(), onRest: (s) => spin(s),
  });
  if (live) {
    resident({ x: 40, y: top + 40 });
    resident({ x: innerWidth - 40, y: top + 50 });
    resident({ x: innerWidth - 50, y: innerHeight - bottom - 30 });
    const breed = () => {
      later(breed, 22000 + Math.random() * 26000);
      if (document.hidden || residents() >= 10) return;
      const mother = someResident();
      if (mother) resident(mother);
    };
    later(breed, 15000);
  }

  // ---- a bloody hand slapped against the side, sliding down ----
  const slap = () => {
    later(slap, 38000 + Math.random() * 40000);
    if (document.hidden) return;
    const p = div('bn-slap');
    const right = Math.random() < 0.5;
    p.classList.toggle('right', right);
    p.style.top = `${(top + 30 + Math.random() * (innerHeight - top - bottom - 200)).toFixed(0)}px`;
    p.style.setProperty('--tilt', `${((right ? 1 : -1) * (8 + Math.random() * 20)).toFixed(0)}deg`);
    p.appendChild(handPrint());
    layer.appendChild(p);
    later(() => p.remove(), 26000);
  };
  // ---- and one that crawls ----
  const crawl = () => {
    later(crawl, 70000 + Math.random() * 60000);
    if (document.hidden) return;
    const h = div('bn-crawl');
    if (Math.random() < 0.5) h.classList.add('back');
    h.appendChild(crawler());
    layer.appendChild(h);
    h.addEventListener('animationend', () => h.remove(), { once: true });
  };
  // ---- and somebody in a mask, looking in from the edge while nobody moves (ui/blood-peek.ts) ----
  const unpeek = live ? peeker(layer, () => ({ top, bottom })) : () => {};
  if (live) {
    later(slap, 9000 + Math.random() * 8000);
    later(crawl, 25000 + Math.random() * 20000);
  }

  return () => {
    for (const t of timers) clearTimeout(t);
    cancelAnimationFrame(raf);
    watch.disconnect();
    shown.disconnect();
    unpeek();
    removeEventListener('resize', onResize);
    dismissResidents();
    layer.remove();
  };
}

/** Put the dressing on or take it off. Called on every theme change; only the change does anything. */
export function dressBlood(on: boolean): void {
  if (on && !undress) undress = dress();
  else if (!on && undress) { undress(); undress = null; }
}
