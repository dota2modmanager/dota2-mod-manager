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

/**
 * A severed hand, seen from the side, dragging itself along on its fingers: the back of the hand
 * with its knuckles, tendons and a vein, four jointed fingers with nails (the two on the far side
 * darker), the thumb tucked under, and the torn wrist with the bone showing, still dripping.
 */
export function crawler(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 100 54', class: 'bn-hand' });
  s.appendChild(svg('path', { class: 'smear', d: 'M-46 48.6c14-1.4 34-2.2 58-1.4l2 2.6c-26 .8-46 .4-60-.6z' }));
  const finger = (k: number, far: boolean, pts: number[]) => {
    const [x, y, jx, jy, tx, ty] = pts;
    const g = svg('g', { class: `finger f${k}${far ? ' far' : ''}`, style: `transform-origin: ${x}px ${y}px` });
    const line = `${x},${y} ${jx},${jy} ${tx},${ty}`;
    g.appendChild(svg('polyline', { class: 'edge', points: line }));
    g.appendChild(svg('polyline', { class: 'flesh', points: line }));
    g.appendChild(svg('path', { class: 'crease', d: `M${jx - 2.4} ${jy - 3.2}q2.4 1.6 4.6-.2M${jx - 1.6} ${jy - 1.6}q1.8 1 3.4 0` }));
    const a = Math.atan2(ty - jy, tx - jx), deg = (a * 180) / Math.PI;
    const nx = tx - Math.cos(a) * 2.2 - Math.sin(a) * 1.8, ny = ty - Math.sin(a) * 2.2 + Math.cos(a) * 1.8;
    g.appendChild(svg('ellipse', { class: 'nail', cx: nx.toFixed(1), cy: ny.toFixed(1), rx: 2.6, ry: 1.7, transform: `rotate(${deg.toFixed(0)} ${nx.toFixed(1)} ${ny.toFixed(1)})` }));
    return g;
  };
  // the far fingers, behind the hand
  s.appendChild(finger(3, true, [53, 19, 68, 20, 77, 43]));
  s.appendChild(finger(2, true, [57, 21, 73, 23, 83, 45]));
  // the thumb, under the palm on the near side
  s.appendChild(svg('path', { class: 'skin', d: 'M38 35c5 2 9 5 13 8 3 2 7 3 9 4 1.6.8.8 2.6-1 2.4-4-.4-9-2-13-4-4-2-8-4-10-7z' }));
  s.appendChild(svg('path', { class: 'crease', d: 'M49 42.5q1.4 1.8.6 3.6' }));
  // the back of the hand
  s.appendChild(svg('path', { class: 'skin', d: 'M16 21C24 14 40 11 52 14c6 1 10 5 9 11-1 6-7 10-15 12-10 2-22 1-30-1z' }));
  s.appendChild(svg('path', { class: 'shade', d: 'M17 31c10 2 24 2 34-1 4-1 8-3 10-6-1 6-7 10-15 12-10 2-22 1-30-1z' }));
  s.appendChild(svg('path', { class: 'tendon', d: 'M22 21c10-4 20-5 30-4M23 25c10-3 21-4 32-3M24 29c10-2 20-2 31-2' }));
  s.appendChild(svg('path', { class: 'vein', d: 'M20 27c5-2 8 1 13-1s7-3 11-2c3 .6 5-.6 7-2' }));
  s.appendChild(svg('path', { class: 'knuckle', d: 'M46 14.6q3-2.4 6-.4M52.4 16q3-1.6 5.4.8M56.6 19.4q2.2-.6 3.4 2' }));
  // the near fingers, in front
  s.appendChild(finger(1, false, [58, 25, 76, 28, 87, 47]));
  s.appendChild(finger(0, false, [56, 30, 71, 34, 80, 49]));
  // where it was cut off: torn skin, the stump, two bones, and what still runs out
  s.appendChild(svg('path', { class: 'torn', d: 'M17 20l-3 2 2 2-3 3 2 2-3 3 2 3-2 2 4 1z' }));
  s.appendChild(svg('ellipse', { class: 'stump', cx: 15, cy: 28.5, rx: 4.2, ry: 8.6 }));
  s.appendChild(svg('ellipse', { class: 'bone', cx: 15.4, cy: 25, rx: 1.7, ry: 2.2 }));
  s.appendChild(svg('ellipse', { class: 'bone', cx: 15, cy: 31.6, rx: 1.4, ry: 1.8 }));
  s.appendChild(svg('path', { class: 'gore', d: 'M12.6 22c-1 4-.8 9 .4 13M17.4 21.4c.8 3 .6 6-.2 8' }));
  s.appendChild(svg('path', { class: 'drip', d: 'M13 36.6c.8 3 1.4 6 .4 8.4-1.6-1.4-1.8-4.6-.4-8.4zM16.6 36.8c.6 2 .8 3.6 0 4.8-1-.8-1-2.6 0-4.8z' }));
  return s;
}

/**
 * The Scream mask (the prize mod is Necrophos wearing it): a long pale face, eyes and mouth
 * pulled down into black, the way it is always remembered. Its own colours, since it is drawn
 * the same in the window and over the site.
 */
export function screamMask(): SVGElement {
  const s = svg('svg', { viewBox: '0 0 60 96', class: 'bn-mask' });
  s.appendChild(svg('path', { class: 'hood', d: 'M30 0C8 0-2 22 1 52c2 24 14 44 29 44s27-20 29-44C62 22 52 0 30 0z' }));
  s.appendChild(svg('path', { class: 'face', d: 'M30 10c-13 0-20 14-19 32 1 20 9 42 19 46 10-4 18-26 19-46 1-18-6-32-19-32z' }));
  s.appendChild(svg('path', { class: 'hole', d: 'M15 36c3-6 10-6 12 2 1 6-3 13-7 13-4 0-7-8-5-15zM45 36c-3-6-10-6-12 2-1 6 3 13 7 13 4 0 7-8 5-15z' }));
  s.appendChild(svg('path', { class: 'hole', d: 'M30 56c-6 0-8 8-7 16 1 7 4 12 7 12s6-5 7-12c1-8-1-16-7-16z' }));
  s.appendChild(svg('path', { class: 'blood', d: 'M20 18c-2 6 1 10 0 16-1 3-2 1-2-1 0-5-1-10 2-15z' }));
  return s;
}
