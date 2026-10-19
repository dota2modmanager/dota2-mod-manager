/* The window's Halloween dressing, worn with the ninth theme while the event is on
 * (ui/theme.ts, ui/season.ts; the colours are themes.css [data-theme='halloween']).
 *
 * Blood oozing from under the title bar, a spider on a thread letting itself down and back,
 * a web in the corner under the title bar and one over the status bar, and now and then a
 * spider scuttling along the top of the status bar. The same things the site wears, fewer of
 * them: this is a tool somebody is working in, and the dressing stays at its edges.
 *
 * One layer over the window, out of the pointer's way and outside the title bar, so the title
 * bar's drag region is not touched. Placed from where the two bars are, and again whenever they
 * change size. With less motion asked for it all holds still and nothing runs.
 */

const SVG = 'http://www.w3.org/2000/svg';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function web(size: number): SVGElement {
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  const spokes = 6;
  const angle = (i: number) => (i / (spokes - 1)) * (Math.PI / 2);
  for (let i = 0; i < spokes; i++) s.appendChild(svg('line', { x1: 0, y1: 0, x2: Math.cos(angle(i)) * size, y2: Math.sin(angle(i)) * size }));
  for (let r = 0.2; r < 1; r += 0.18 + r * 0.05) {
    let d = '';
    for (let i = 0; i < spokes; i++) {
      const x = Math.cos(angle(i)) * size * r, y = Math.sin(angle(i)) * size * r;
      if (!i) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; continue; }
      const am = (angle(i - 1) + angle(i)) / 2;
      d += ` Q${(Math.cos(am) * size * r * 0.84).toFixed(1)} ${(Math.sin(am) * size * r * 0.84).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    s.appendChild(svg('path', { d }));
  }
  return s;
}

function spider(): SVGElement {
  const s = svg('svg', { viewBox: '-20 -20 40 40', class: 'hwa-spider' });
  const legs = [[-3, -2, -11, -10, -16, -6], [-3, 0, -13, -4, -18, 1], [-3, 2, -12, 4, -17, 10], [-3, 4, -9, 9, -12, 16]];
  for (const side of [1, -1]) {
    const g = svg('g', { class: `legs ${side > 0 ? 'a' : 'b'}` });
    legs.forEach(([x1, y1, x2, y2, x3, y3], i) => g.appendChild(svg('polyline', { points: `${x1 * side},${y1} ${x2 * side},${y2} ${x3 * side},${y3}`, class: `leg${i % 2 ? ' odd' : ''}` })));
    s.appendChild(g);
  }
  s.appendChild(svg('ellipse', { cx: 0, cy: 5, rx: 6.2, ry: 7.6, class: 'ab' }));
  s.appendChild(svg('circle', { cx: 0, cy: -4, r: 4.2, class: 'hd' }));
  s.appendChild(svg('circle', { cx: -1.6, cy: -5, r: 1, class: 'eye' }));
  s.appendChild(svg('circle', { cx: 1.6, cy: -5, r: 1, class: 'eye' }));
  return s;
}

let undress: (() => void) | null = null;

function dress(): () => void {
  const layer = div('hwa');
  layer.setAttribute('aria-hidden', 'true');
  const blood = div('hwa-blood');
  for (let i = 0; i < 11; i++) {
    const d = document.createElement('i');
    d.style.setProperty('--x', `${((i + 0.2 + Math.random() * 0.6) / 11) * 100}%`);
    d.style.setProperty('--w', `${3 + Math.random() * 5}px`);
    d.style.setProperty('--h', `${8 + Math.random() * 26}px`);
    d.style.setProperty('--t', `${8 + Math.random() * 10}s`);
    d.style.setProperty('--wait', `${-Math.random() * 14}s`);
    blood.appendChild(d);
  }
  const hang = div('hwa-hang');
  hang.append(div('hwa-thread'), div('hwa-hanger'));
  hang.lastElementChild!.appendChild(spider());
  const webTop = div('hwa-web top');
  webTop.appendChild(web(120));
  const webBottom = div('hwa-web bottom');
  webBottom.appendChild(web(96));
  layer.append(blood, hang, webTop, webBottom);
  document.body.appendChild(layer);

  const place = () => {
    const top = document.getElementById('titlebar')?.getBoundingClientRect().bottom ?? 46;
    const bar = document.getElementById('statusbar');
    const bottom = bar && bar.offsetParent ? bar.getBoundingClientRect().top : innerHeight;
    layer.style.setProperty('--top', `${Math.round(top)}px`);
    layer.style.setProperty('--bottom', `${Math.round(innerHeight - bottom)}px`);
  };
  place();
  const watch = new ResizeObserver(place);
  for (const id of ['titlebar', 'statusbar']) { const e = document.getElementById(id); if (e) watch.observe(e); }
  addEventListener('resize', place);

  // a spider along the top of the status bar, every so often
  let timer = 0;
  const run = () => {
    timer = window.setTimeout(run, 40000 + Math.random() * 40000);
    if (document.hidden || still()) return;
    const r = div('hwa-runner');
    r.appendChild(spider());
    if (Math.random() < 0.5) r.classList.add('back');
    layer.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  };
  timer = window.setTimeout(run, 12000 + Math.random() * 15000);

  return () => {
    clearTimeout(timer);
    watch.disconnect();
    removeEventListener('resize', place);
    layer.remove();
  };
}

/** Put the dressing on or take it off. Called on every theme change; only the change does anything. */
export function dressHalloween(on: boolean): void {
  if (on && !undress) undress = dress();
  else if (!on && undress) { undress(); undress = null; }
}
