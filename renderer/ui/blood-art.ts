/* What the bloody night is drawn with (ui/blood.ts hangs it up): webs, hands, and the two
 * small helpers that make elements for them. Kept apart so the dressing reads as what it does.
 */
const NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
export function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

/** A web out of a corner: spokes, and threads between them sagging towards the corner. */
export function cornerWeb(size: number, torn = false): SVGElement {
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  const spokes = 8;
  const angle = (i: number) => (i / (spokes - 1)) * (Math.PI / 2);
  for (let i = 0; i < spokes; i++) s.appendChild(svg('line', { x1: 0, y1: 0, x2: Math.cos(angle(i)) * size * 1.04, y2: Math.sin(angle(i)) * size * 1.04 }));
  let ring = 0;
  for (let r = 0.12; r < 1; r += 0.11 + r * 0.06, ring++) {
    let d = '';
    for (let i = 0; i < spokes; i++) {
      const rr = size * r * (0.95 + 0.1 * ((i * 5 + ring) % 3) / 2);
      const x = Math.cos(angle(i)) * rr, y = Math.sin(angle(i)) * rr;
      // a torn web misses a stretch here and there
      const gap = torn && (i * 7 + ring * 3) % 11 === 0;
      if (!i || gap) { d += ` M${x.toFixed(1)} ${y.toFixed(1)}`; continue; }
      const am = (angle(i - 1) + angle(i)) / 2, sag = size * r * 0.8;
      d += ` Q${(Math.cos(am) * sag).toFixed(1)} ${(Math.sin(am) * sag).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    s.appendChild(svg('path', { d }));
  }
  return s;
}

/** A small round web, every thread with pathLength 1 so it can be spun in. */
export function wheel(r: number): SVGElement {
  const s = svg('svg', { viewBox: `${-r} ${-r} ${r * 2} ${r * 2}`, width: r * 2, height: r * 2 });
  const spokes = 9;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    s.appendChild(svg('line', { x1: 0, y1: 0, x2: (Math.cos(a) * r).toFixed(1), y2: (Math.sin(a) * r).toFixed(1), pathLength: 1 }));
  }
  for (let k = 1; k <= 5; k++) {
    const rr = (r * k) / 5.4;
    let d = '';
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (!i) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; continue; }
      const am = ((i - 0.5) / spokes) * Math.PI * 2;
      d += ` Q${(Math.cos(am) * rr * 0.86).toFixed(1)} ${(Math.sin(am) * rr * 0.86).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    s.appendChild(svg('path', { d, pathLength: 1 }));
  }
  return s;
}

/** A hand, palm towards the viewer, as a print: palm, four fingers, a thumb. */
export function handPrint(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 60 80', class: 'bn-print' });
  s.appendChild(svg('path', { d: 'M14 44c-2-8 0-14 6-16 3-1 6 0 8 1 3-2 7-2 10 0 5 3 7 10 6 18-1 9-4 17-8 22-5 6-14 7-19 2-4-4-2-9-3-14z' }));
  for (const [x, y, rot, len] of [[19, 30, -12, 22], [27, 26, -4, 26], [35, 27, 4, 25], [42, 31, 12, 20]]) {
    s.appendChild(svg('rect', { x: x - 3.4, y: y - len, width: 6.8, height: len + 3, rx: 3.4, transform: `rotate(${rot} ${x} ${y})` }));
  }
  s.appendChild(svg('rect', { x: 2, y: 40, width: 6.6, height: 20, rx: 3.3, transform: 'rotate(-48 8 52)' }));
  return s;
}

/** A severed hand, seen from the side, that drags itself along on its fingers. */
export function crawler(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 70 40', class: 'bn-hand' });
  s.appendChild(svg('path', { class: 'stump', d: 'M2 18c0-6 3-9 8-9l4 1-1 18-4 1c-5 0-7-4-7-11z' }));
  s.appendChild(svg('path', { class: 'skin', d: 'M10 10c8-3 22-4 32-2 6 1 9 4 9 8 0 5-5 9-13 10-10 1-21 1-28 0z' }));
  const g = svg('g', { class: 'fingers' });
  [[44, 14], [46, 19], [45, 24], [41, 27]].forEach(([x, y], i) => {
    g.appendChild(svg('path', { class: `finger f${i}`, d: `M${x} ${y}q10 2 14 10q1 3-2 3q-6-6-14-8z` }));
  });
  s.appendChild(g);
  s.appendChild(svg('path', { class: 'thumb', d: 'M30 26q4 6 0 11q-3 1-3-2q2-4 0-8z' }));
  s.appendChild(svg('path', { class: 'gore', d: 'M3 13c2 4 2 9 0 13M7 11c1 5 1 11 0 16' }));
  return s;
}
