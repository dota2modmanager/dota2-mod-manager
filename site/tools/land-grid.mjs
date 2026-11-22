#!/usr/bin/env node
/**
 * Bakes the land under the downloads map into src/data/land-grid.json, once.
 *
 *   node tools/land-grid.mjs <land-110m.json>
 *
 * The input is Natural Earth's 1:110m land as TopoJSON, from the world-atlas package (Natural
 * Earth is public domain; world-atlas is ISC). The map draws land as a grid of cells rather
 * than coastlines: a cell is land when its centre falls inside a land polygon. Each row is
 * stored as runs of [first column, length], which the page turns into one path, so the site
 * carries a few kilobytes of numbers and no map library.
 *
 * Re-run only to change the grid's step or extent; the map page reads STEP, NORTH and SOUTH
 * from the file, not from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEP = 1.5;
const NORTH = 84;
const SOUTH = -57;

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/land-grid.mjs <land-110m.json>');
  process.exit(2);
}
const topo = JSON.parse(fs.readFileSync(src, 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;

// TopoJSON stores each arc as quantized deltas; this undoes both.
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});
const ring = (ids) => {
  const out = [];
  for (const id of ids) {
    const pts = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
};
const polygons = [];
for (const g of topo.objects.land.geometries) {
  const list = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const p of list) polygons.push(p.map(ring));
}

// even-odd over every ring of a polygon, so lakes cut out of land stay water
const inside = (x, y, rings) => {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
};
const boxes = polygons.map((rings) => {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
});
const land = (x, y) => polygons.some((rings, i) => {
  const [x0, y0, x1, y1] = boxes[i];
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside(x, y, rings);
});

const cols = Math.round(360 / STEP);
const rows = Math.round((NORTH - SOUTH) / STEP);
const runs = [];
let cells = 0;
for (let r = 0; r < rows; r++) {
  const y = NORTH - (r + 0.5) * STEP;
  const row = [];
  let start = -1;
  for (let c = 0; c <= cols; c++) {
    const on = c < cols && land(-180 + (c + 0.5) * STEP, y);
    if (on && start < 0) start = c;
    if (!on && start >= 0) {
      row.push([start, c - start]);
      cells += c - start;
      start = -1;
    }
  }
  runs.push(row);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'land-grid.json');
const body = {
  source: 'Natural Earth 1:110m land (public domain), via world-atlas 2.0.2. Rebuilt by tools/land-grid.mjs.',
  step: STEP,
  north: NORTH,
  south: SOUTH,
  cols,
  runs,
};
fs.writeFileSync(out, `${JSON.stringify(body)}\n`);
console.log(`${cells} land cells in ${rows} rows -> ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes)`);
