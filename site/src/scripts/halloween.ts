/**
 * Halloween's look, past its colours (site.css html.halloween has those).
 *
 * Webs in the corners that stir as if in a draught, and more left hanging still all down the page;
 * blood oozing from under the header, splashed all over the page behind what is written and
 * pooled on top of the footer; two spiders hanging in the margins that let themselves down as the
 * page is scrolled, one no further than the middle of the screen and the other, later, all the
 * way to its foot; spiders running across the screen and away from the pointer, more of them the
 * longer the page is open, each one able to be caught and thrown (hard enough upwards, and it
 * goes to space); and strings of jack-o'-lanterns between the sections and over the footer.
 *
 * Everything is built here, aria-hidden and out of the pointer's way, and taken down again when
 * the look comes off (scripts/look.ts says so with 'mm-look'). On a touch screen, or with less
 * motion asked for, it all holds still: no runners, nothing that loops (site.css, iOS budget).
 */

const SVG = 'http://www.w3.org/2000/svg';
const lively = () => matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.setAttribute('aria-hidden', 'true');
  return d;
}

/** A web out of one corner: spokes, and threads between them that sag towards the corner. */
function cornerWeb(size: number): SVGElement {
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  const spokes = 7;
  const angle = (i: number) => (i / (spokes - 1)) * (Math.PI / 2);
  for (let i = 0; i < spokes; i++) {
    const a = angle(i);
    s.appendChild(svg('line', { x1: 0, y1: 0, x2: Math.cos(a) * size * 1.05, y2: Math.sin(a) * size * 1.05 }));
  }
  for (let r = 0.16; r < 1; r += 0.15 + r * 0.06) {
    let d = '';
    for (let i = 0; i < spokes; i++) {
      const a = angle(i), rr = size * r * (0.94 + 0.12 * ((i * 7) % 3) / 2);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (!i) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; continue; }
      const am = (angle(i - 1) + a) / 2, sag = size * r * 0.82;
      d += ` Q${(Math.cos(am) * sag).toFixed(1)} ${(Math.sin(am) * sag).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    s.appendChild(svg('path', { d }));
  }
  return s;
}

/** A round web: spokes, and rings that sag a little between them. */
function roundWeb(r: number): SVGElement {
  const s = svg('svg', { viewBox: `${-r} ${-r} ${r * 2} ${r * 2}`, width: r * 2, height: r * 2 });
  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    s.appendChild(svg('line', { x1: 0, y1: 0, x2: (Math.cos(a) * r).toFixed(1), y2: (Math.sin(a) * r).toFixed(1) }));
  }
  for (let k = 1; k <= 6; k++) {
    const rr = (r * k) / 6.6;
    let d = '';
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (!i) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; continue; }
      const am = ((i - 0.5) / spokes) * Math.PI * 2;
      d += ` Q${(Math.cos(am) * rr * 0.86).toFixed(1)} ${(Math.sin(am) * rr * 0.86).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    s.appendChild(svg('path', { d }));
  }
  return s;
}

/** A spider, legs in two sets that can be made to scuttle. */
function spider(): SVGElement {
  const s = svg('svg', { viewBox: '-20 -20 40 40', class: 'hw-spider' });
  const legs = [[-3, -2, -11, -10, -16, -6], [-3, 0, -13, -4, -18, 1], [-3, 2, -12, 4, -17, 10], [-3, 4, -9, 9, -12, 16]];
  for (const side of [1, -1]) {
    const g = svg('g', { class: `legs ${side > 0 ? 'a' : 'b'}` });
    legs.forEach(([x1, y1, x2, y2, x3, y3], i) => {
      const odd = i % 2 ? ' odd' : '';
      g.appendChild(svg('polyline', { points: `${x1 * side},${y1} ${x2 * side},${y2} ${x3 * side},${y3}`, class: `leg${odd}` }));
    });
    s.appendChild(g);
  }
  s.appendChild(svg('ellipse', { cx: 0, cy: 5, rx: 6.2, ry: 7.6, class: 'ab' }));
  s.appendChild(svg('circle', { cx: 0, cy: -4, r: 4.2, class: 'hd' }));
  s.appendChild(svg('circle', { cx: -1.6, cy: -5, r: 1, class: 'eye' }));
  s.appendChild(svg('circle', { cx: 1.6, cy: -5, r: 1, class: 'eye' }));
  return s;
}

function lantern(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 64 64', class: 'hw-lantern' });
  s.appendChild(svg('path', { class: 'pk-stem', d: 'M30 14c0-5 2-9 7-11l2 3c-3 2-4 4-4 8z' }));
  s.appendChild(svg('path', { class: 'pk-body', d: 'M32 15c-6-4-17-3-23 4C2 27 2 43 9 51c6 7 16 9 23 6 7 3 17 1 23-6 7-8 7-24 0-32-6-7-17-8-23-4z' }));
  const face = svg('g', { class: 'pk-face' });
  face.appendChild(svg('path', { d: 'M16 31l7-7 6 8z' }));
  face.appendChild(svg('path', { d: 'M48 31l-7-7-6 8z' }));
  face.appendChild(svg('path', { d: 'M14 39c5 7 12 10 18 10s13-3 18-10l-5 2-3-4-4 5-6-4-6 4-4-5-3 4z' }));
  s.appendChild(face);
  return s;
}

/** A splash of blood: a body, ragged at the edge, and drops thrown off it. */
function splat(size: number): SVGElement {
  const s = svg('svg', { viewBox: '-50 -50 100 100', width: size, height: size });
  // points round a ragged edge, joined through their midpoints so the edge comes out soft
  const k = 13;
  const pts = Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2, r = 16 + Math.random() * 12 + (Math.random() < 0.3 ? 10 : 0);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const mid = (i: number) => pts[i % k].map((v, j) => ((v + pts[(i + 1) % k][j]) / 2).toFixed(1)).join(' ');
  let d = `M${mid(0)}`;
  for (let i = 1; i <= k; i++) d += ` Q${pts[i % k].map((v) => v.toFixed(1)).join(' ')} ${mid(i)}`;
  s.appendChild(svg('path', { d: `${d}Z` }));
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 18;
    s.appendChild(svg('circle', { cx: (Math.cos(a) * r).toFixed(1), cy: (Math.sin(a) * r).toFixed(1), r: (1 + Math.random() * 3.5).toFixed(1) }));
  }
  return s;
}

/** A string of `n` jack-o'-lanterns sagging between its ends, into `into`. */
function garland(into: HTMLElement, n: number): void {
  const string = svg('svg', { viewBox: '0 0 1000 60', preserveAspectRatio: 'none', class: 'hw-string' });
  let d = 'M0 6';
  const span = 1000 / Math.ceil(n / 2);
  for (let x = 0; x < 999; x += span) d += ` Q${(x + span / 2).toFixed(0)} 46 ${Math.min(1000, x + span).toFixed(0)} 8`;
  string.appendChild(svg('path', { d }));
  into.appendChild(string);
  for (let i = 0; i < n; i++) {
    const l = document.createElement('span');
    l.style.setProperty('--x', `${((i + 0.5) / n) * 100}%`);
    l.style.setProperty('--i', String(i));
    l.appendChild(lantern());
    into.appendChild(l);
  }
}

let mounted: (() => void) | null = null;

function mount(): () => void {
  const made: Element[] = [];
  const add = <T extends Element>(e: T, into: Element = document.body) => { into.appendChild(e); made.push(e); return e; };
  const live = lively();
  const stops: Array<() => void> = [];

  // ---- webs in the four corners ----
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const w = add(div(`hw-web ${corner}`));
    w.appendChild(cornerWeb(corner[0] === 't' ? 250 : 200));
  }

  // ---- blood all over the page, webs left hanging down it ----
  // In page coordinates, behind the content (site.css .hw-splat sits under the column): the
  // big ones in the gutters beside it where there are gutters, small ones anywhere, where they
  // show only between the cards and never over anything written.
  const vw0 = document.documentElement.clientWidth;
  const gut = Math.max(0, (vw0 - Math.min(1200, vw0)) / 2);
  const pageH = document.documentElement.scrollHeight;
  const n = Math.min(22, Math.round(pageH / 420) + 4);
  for (let i = 0; i < n; i++) {
    const wide = gut >= 80 && i % 3 !== 2;
    const size = Math.round(wide ? 40 + Math.random() * Math.min(150, gut - 30) : 26 + Math.random() * 60);
    const sp = add(div(wide ? 'hw-splat' : 'hw-splat faint'));
    sp.appendChild(splat(size));
    // turned at any angle its box grows by up to a fifth each way, and none of it may poke past the window
    const pad = size * 0.22;
    const x = wide
      ? (i % 2 === 0 ? pad + Math.random() * Math.max(0, gut - size - pad) : vw0 - gut + Math.random() * Math.max(0, gut - size - pad))
      : pad + Math.random() * Math.max(0, vw0 - size - pad * 2);
    sp.style.left = `${Math.round(x)}px`;
    sp.style.top = `${Math.round(((i + 0.3 + Math.random() * 0.4) / n) * pageH * 0.92 + 120)}px`;
    sp.style.rotate = `${Math.round(Math.random() * 360)}deg`;
  }
  // webs at odd heights down both sides, each its own size and turned its own way, none of them moving
  const webs = Math.min(8, Math.round(pageH / 1100) + 2);
  for (let i = 0; i < webs; i++) {
    const side = i % 2 ? 'r' : 'l';
    const r = Math.round(gut >= 80 ? Math.min(80, 28 + Math.random() * gut / 2.6) : 22 + Math.random() * 16);
    const w = add(div(`hw-strung ${side}`));
    w.appendChild(roundWeb(r));
    w.style.top = `${Math.round(((i + 0.2 + Math.random() * 0.6) / webs) * pageH * 0.9 + 80)}px`;
    w.style.setProperty('--gut', `${Math.round(gut >= 80 ? gut * (0.2 + Math.random() * 0.6) : r * 0.4)}px`);
    w.style.rotate = `${Math.round(Math.random() * 60 - 30)}deg`;
  }
  // and jack-o'-lanterns strung between some of the sections, the way they are over the footer
  const sections = [...document.querySelectorAll<HTMLElement>('main section, main .release')].filter((_, i) => i % 2 === 1);
  for (const sec of sections.slice(0, 4)) {
    const top = sec.getBoundingClientRect().top + scrollY;
    if (top < 400) continue;
    const g = add(div('hw-garland strung'));
    g.style.top = `${Math.round(top - 8)}px`;
    garland(g, 6 + (Math.random() * 3 | 0));
  }
  const footing = document.querySelector('.foot');
  if (footing) {
    const pool = add(div('hw-pool'), footing);
    const p = svg('svg', { viewBox: '0 0 1000 40', preserveAspectRatio: 'none' });
    let d = 'M0 0 H1000 V6';
    for (let x = 1000; x > 0; x -= 40 + Math.random() * 60) d += ` Q${(x - 20).toFixed(0)} ${(14 + Math.random() * 22).toFixed(0)} ${Math.max(0, x - 45).toFixed(0)} ${(4 + Math.random() * 6).toFixed(0)}`;
    p.appendChild(svg('path', { d: `${d} L0 6 Z` }));
    pool.appendChild(p);
  }

  // ---- blood from under the header ----
  const bar = document.querySelector('.topbar');
  if (bar) {
    const blood = add(div('hw-blood'), bar);
    const n = Math.max(10, Math.round(innerWidth / 64));
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.style.setProperty('--x', `${((i + 0.25 + Math.random() * 0.5) / n) * 100}%`);
      d.style.setProperty('--w', `${4 + Math.random() * 6}px`);
      d.style.setProperty('--h', `${16 + Math.random() ** 1.6 * 84}px`);
      d.style.setProperty('--t', `${7 + Math.random() * 9}s`);
      d.style.setProperty('--wait', `${-Math.random() * 12}s`);
      blood.appendChild(d);
    }
  }

  // ---- two spiders on threads, in the margins, letting themselves down as the page scrolls ----
  // Each by its own share of the way down the page: the first no further than the middle of the
  // screen, the second waiting a while and then going all the way to the bottom of it.
  const hangers = [0, 1].map(() => {
    const thread = add(div('hw-thread'));
    const body = add(div('hw-hanger'));
    body.appendChild(spider());
    return { thread, body, bob: Math.random() * 6 };
  });
  let t = 0, raf = 0;
  const head = () => (bar?.getBoundingClientRect().bottom ?? 64);
  const hang = () => {
    const top = head();
    const room = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const p = Math.min(1, Math.max(0, scrollY / room));
    const vw = document.documentElement.clientWidth;
    const gutter = Math.max(0, (vw - Math.min(1200, vw)) / 2);
    hangers.forEach((h, i) => {
      const inset = gutter >= 60 ? Math.round(gutter * (gutter >= 170 ? 0.26 : 0.5)) : 16;
      const x = i ? vw - inset : inset;
      const deepest = i ? innerHeight - top - 52 : innerHeight * 0.5 - top;
      const share = i ? Math.max(0, (p - 0.25) / 0.75) ** 1.3 : Math.min(1, p * 1.6);
      const len = 46 + Math.max(0, deepest - 46) * share + (live ? Math.sin(t * 1.4 + h.bob) * 6 : 0);
      h.thread.style.transform = `translate(${x}px, ${top}px) scaleY(${len})`;
      h.body.style.transform = `translate(${x - 21}px, ${top + len - 6}px) rotate(${(live ? Math.sin(t * 1.1 + h.bob) * 7 : 0).toFixed(1)}deg)`;
    });
  };
  const onScroll = () => { if (!live) hang(); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', hang);
  stops.push(() => { removeEventListener('scroll', onScroll); removeEventListener('resize', hang); });
  hang();

  // ---- spiders across the screen, away from the pointer, more of them as time goes on ----
  // A spider can be caught: press on it and it hangs from the pointer, kicking; let go mid-swing
  // and it flies off with the pointer's speed. Flung hard enough upwards it does not come down:
  // it shrinks into the sky and leaves a star. One that gets away now and then brings a friend.
  let px = -9999, py = -9999, pvx = 0, pvy = 0, lastMove = performance.now();
  const onMove = (e: PointerEvent) => {
    const now = performance.now(), dt = Math.max(8, now - lastMove) / 1000;
    if (px > -9000) {
      pvx = pvx * 0.4 + ((e.clientX - px) / dt) * 0.6;
      pvy = pvy * 0.4 + ((e.clientY - py) / dt) * 0.6;
    }
    px = e.clientX; py = e.clientY; lastMove = now;
  };
  type Runner = { el: HTMLElement; x: number; y: number; vx: number; vy: number; wob: number; spin: number; held?: boolean; space?: number };
  let runners: Runner[] = [];
  let next = 4 + Math.random() * 6;
  let calm = 16;    // seconds between arrivals; it shortens, and the page fills up
  const MOST = 7;
  const spawn = (at?: { x: number; y: number }) => {
    const el = add(div('hw-runner'));
    el.appendChild(spider());
    const fromLeft = Math.random() < 0.5;
    const speed = 150 + Math.random() * 140;
    const r: Runner = {
      el, x: fromLeft ? -30 : innerWidth + 30, y: innerHeight * (0.25 + Math.random() * 0.6),
      vx: fromLeft ? speed : -speed, vy: (Math.random() - 0.5) * 60, wob: Math.random() * 9, spin: 0,
    };
    if (at) {
      const a = Math.random() * Math.PI * 2;
      Object.assign(r, { x: at.x, y: at.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320 });
    }
    runners.push(r);
    el.addEventListener('pointerdown', (e) => {
      if (r.space) return;
      e.preventDefault();
      r.held = true;
      el.classList.add('held');
      el.setPointerCapture?.(e.pointerId);
    });
    const drop = () => {
      if (!r.held) return;
      r.held = false;
      el.classList.remove('held');
      r.vx = Math.max(-2600, Math.min(2600, pvx));
      r.vy = Math.max(-2600, Math.min(2600, pvy));
      r.spin = (Math.random() < 0.5 ? -1 : 1) * (500 + Math.random() * 900);
      if (r.vy < -1300 && Math.abs(r.vy) > Math.abs(r.vx) * 0.8) r.space = 1;
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  };
  const star = (x: number, y: number) => {
    const s = add(div('hw-star'));
    s.style.left = `${Math.round(x)}px`;
    s.style.top = `${Math.round(y)}px`;
    setTimeout(() => s.remove(), 1600);
  };
  if (live) {
    addEventListener('pointermove', onMove, { passive: true });
    stops.push(() => removeEventListener('pointermove', onMove));
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      t += dt;
      hang();
      if ((next -= dt) <= 0 && runners.length < MOST) {
        spawn();
        calm = Math.max(5, calm * 0.85);
        next = calm * (0.6 + Math.random() * 0.8);
      }
      const born: Array<{ x: number; y: number }> = [];
      runners = runners.filter((r) => {
        if (r.held) {
          r.x += (px - r.x) * Math.min(1, dt * 22);
          r.y += (py + 18 - r.y) * Math.min(1, dt * 22);
          const kick = Math.sin(t * 40) * 14;
          r.el.style.transform = `translate(${(r.x - 22).toFixed(1)}px, ${(r.y - 22).toFixed(1)}px) rotate(${(180 + kick).toFixed(1)}deg)`;
          return true;
        }
        if (r.space) {
          // off into the sky: smaller and slower until it is a point, then a star
          r.space -= dt * 0.9;
          r.x += r.vx * dt * r.space; r.y += r.vy * dt * r.space;
          r.el.style.transform = `translate(${(r.x - 22).toFixed(1)}px, ${(r.y - 22).toFixed(1)}px) rotate(${(t * r.spin).toFixed(0)}deg) scale(${Math.max(0.02, r.space).toFixed(3)})`;
          if (r.space <= 0.03) { star(r.x, r.y); r.el.remove(); return false; }
          return true;
        }
        const dx = r.x - px, dy = r.y - py, d = Math.hypot(dx, dy) || 1;
        if (d < 150) { r.vx += (dx / d) * 1000 * dt; r.vy += (dy / d) * 1000 * dt; }
        if (r.spin) {
          // thrown: it tumbles and slows, then finds its feet and runs again
          r.vx *= Math.pow(0.35, dt); r.vy = r.vy * Math.pow(0.35, dt) + 600 * dt;
          r.spin *= Math.pow(0.1, dt);
          if (Math.abs(r.spin) < 20) r.spin = 0;
        } else {
          r.vy += Math.sin(t * 3 + r.wob) * 40 * dt;
          const sp = Math.hypot(r.vx, r.vy), top = 560;
          if (sp > top) { r.vx *= top / sp; r.vy *= top / sp; }
        }
        r.x += r.vx * dt; r.y += r.vy * dt;
        const a = r.spin ? t * r.spin : (Math.atan2(r.vy, r.vx) * 180) / Math.PI + 90;
        r.el.style.transform = `translate(${(r.x - 22).toFixed(1)}px, ${(r.y - 22).toFixed(1)}px) rotate(${a.toFixed(1)}deg)`;
        const gone = r.x < -60 || r.x > innerWidth + 60 || r.y < -60 || r.y > innerHeight + 60;
        if (gone) {
          r.el.remove();
          // one in three that gets away comes back with another
          if (Math.random() < 0.34) born.push({ x: Math.min(innerWidth - 40, Math.max(40, r.x)), y: Math.min(innerHeight - 40, Math.max(40, r.y)) });
        }
        return !gone;
      });
      for (const b of born) {
        setTimeout(() => {
          if (!mounted) return;
          for (let k = 0; k < 2 && runners.length < MOST; k++) spawn(b);
        }, 2500 + Math.random() * 4000);
      }
    };
    raf = requestAnimationFrame(frame);
    stops.push(() => cancelAnimationFrame(raf));
  }

  // ---- jack-o'-lanterns strung over the footer ----
  const foot = document.querySelector('.foot');
  if (foot) garland(add(div('hw-garland'), foot), 8);

  return () => { for (const s of stops) s(); for (const e of made) e.remove(); runners = []; };
}

/** Put Halloween's dressing up while the page wears it, and take it down when it does not. */
export function mountHalloween(): void {
  const sync = () => {
    const on = document.documentElement.classList.contains('halloween');
    if (on && !mounted) mounted = mount();
    else if (!on && mounted) { mounted(); mounted = null; }
  };
  sync();
  document.addEventListener('mm-look', sync);
}
