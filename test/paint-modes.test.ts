/* The recolour window's modes (src/recolor-modes.ts, renderer/catalog/paint/paint-mode.ts) and the
 * 3D hero it paints (renderer/catalog/paint/preview-paint.ts): the build and the window move a pixel
 * by one rule, the plain mode is the rule particles and icons always had, a colour carries its mode
 * as '#rrggbb:mode', and each of the scene's materials takes the colour the build will give it. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { hsv, paintPixel, paintPixels, paintValue, parsePaint, type Rgb } from '../src/recolor-modes.ts';
import { shade } from '../src/recolor.ts';
import { hsv01, paintPixel as windowPixel, splitPaint, paintValue as windowValue, PAINT_MODES } from '../renderer/catalog/paint/paint-mode.ts';
import { effectPalette, materialPaint, previewPaint, scenePaints } from '../renderer/catalog/paint/preview-paint.ts';
import type { PaintLayer } from '../renderer/api/content.ts';
import { editorOf, isPicture, layerLabel, paintSummary } from '../renderer/views/hero-paint-model.ts';

// the window's strings, as the Russian source
(globalThis as Record<string, unknown>).L = (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((o, p, i) => o + p + (i < v.length ? String(v[i]) : ''), '');

const SAMPLE: Rgb[] = [[200, 40, 40], [30, 160, 90], [120, 120, 120], [250, 250, 250], [10, 10, 10], [40, 60, 220], [255, 200, 0], [90, 20, 140]];
const TARGETS: Rgb[] = [[0, 255, 0], [64, 128, 255], [255, 80, 160], [128, 128, 128]];

test("a colour carries its mode; the plain form is tint, and nothing else passes", () => {
  assert.deepEqual(parsePaint('#00FF00'), { hex: '#00ff00', mode: 'tint' });
  assert.deepEqual(parsePaint('#00ff00:rgb'), { hex: '#00ff00', mode: 'rgb' });
  assert.equal(parsePaint('#00ff00:bogus'), null);
  assert.equal(parsePaint('green'), null);
  assert.equal(parsePaint(7), null);
  assert.equal(paintValue('#ABCDEF'), '#abcdef');
  assert.equal(paintValue('#abcdef', 'keep'), '#abcdef:keep');
  for (const mode of PAINT_MODES) assert.deepEqual(splitPaint(windowValue('#123456', mode)), { hex: '#123456', mode }, 'the window reads back what it writes');
  assert.deepEqual(splitPaint('#123456:odd'), { hex: '#123456', mode: 'tint' });
});

test('tint is the rule particles and icons always took', () => {
  for (const c of SAMPLE) for (const t of TARGETS) assert.deepEqual(paintPixel(c, hsv(t), 'tint') ?? c, shade(c, t), `${c} to ${t}`);
});

test('the window and the build move every pixel the same way, in every mode', () => {
  for (const mode of PAINT_MODES) for (const c of SAMPLE) for (const t of TARGETS) {
    assert.deepEqual(windowPixel(c, hsv01(t), mode, 0.3, 0.7), paintPixel(c, hsv(t), mode, 0.3, 0.7), `${mode}: ${c} to ${t}`);
  }
});

test('keep holds every shade; full paints greys too; rgb runs the hue across the texture', () => {
  const [, s, v] = hsv([200, 40, 40]);
  const kept = hsv(paintPixel([200, 40, 40], hsv([0, 0, 255]), 'keep')!);
  assert.ok(Math.abs(kept[0] - 2 / 3) < 0.01 && Math.abs(kept[1] - s) < 0.02 && Math.abs(kept[2] - v) < 0.01, 'only the hue moved');
  assert.equal(paintPixel([120, 120, 120], hsv([0, 0, 255]), 'keep'), null, 'a grey stays');
  const grey = paintPixel([120, 120, 120], hsv([0, 0, 255]), 'full')!;
  assert.ok(grey[2] > grey[0] && grey[2] > grey[1], 'a grey turns blue under full');
  const a = hsv(paintPixel([200, 40, 40], hsv([255, 0, 0]), 'rgb', 0.1, 0.1)!)[0];
  const b = hsv(paintPixel([200, 40, 40], hsv([255, 0, 0]), 'rgb', 0.6, 0.6)!)[0];
  assert.ok(Math.abs(a - b) > 0.3, 'two places on the texture, two hues');
});

test('a bitmap is painted in place, red and blue swapped where Electron swaps them', () => {
  const px = Buffer.from([200, 40, 40, 255, 120, 120, 120, 255, 200, 40, 40, 0]);
  assert.equal(paintPixels(px, 3, [0, 0, 255], 'tint'), 1, 'a grey and a see-through pixel stay');
  assert.deepEqual([...px.subarray(0, 3)], shade([200, 40, 40], [0, 0, 255]));
  const bgra = Buffer.from([40, 40, 200, 255]);
  paintPixels(bgra, 1, [0, 0, 255], 'tint', { bgra: true });
  assert.deepEqual([bgra[2], bgra[1], bgra[0]], shade([200, 40, 40], [0, 0, 255]));
});

const LAYERS: PaintLayer[] = [
  { id: 'body', kind: 'body', name: null, files: 3 },
  { id: 'effects', kind: 'effects', name: null, files: 2, particles: ['particles/units/heroes/hero_abaddon/abaddon_ambient.vpcf_c'] },
  { id: 'itemModel:7', kind: 'itemModel', name: 'Spectral Shadow Mount', files: 1 },
  { id: 'item:7', kind: 'item', name: 'Spectral Shadow Mount', files: 1, particles: ['particles/econ/items/abaddon/mount_fx.vpcf_c'] },
  { id: 'ability:abaddon_death_coil', kind: 'ability', name: 'Mist Coil', files: 1 },
];

test("the 3D hero takes the colours of the layers that are on, an item's own over the body's", () => {
  const color = (id: string) => (id === 'itemModel:7' ? { hex: '#0000ff', mode: 'keep' as const } : { hex: '#ff0000', mode: 'tint' as const });
  const none = previewPaint(LAYERS, new Set(), color, { 'abaddon:mount': '7' });
  assert.deepEqual(none, { body: null, parts: {}, effects: {} });
  const paint = previewPaint(LAYERS, new Set(['body', 'itemModel:7', 'item:7', 'ghost']), color, { 'abaddon:mount': '7', 'abaddon:head': '9' });
  assert.deepEqual(paint.body, [0, 1, 1, 1]);
  assert.deepEqual(paint.parts, { 'abaddon:mount': [2 / 3, 1, 1, 2] });
  assert.deepEqual(paint.effects, { 'particles/econ/items/abaddon/mount_fx.vpcf': [255, 0, 0] });
  assert.equal(materialPaint('hero', 'materials/models/heroes/abaddon/abaddon_body.vmat', undefined, paint), paint.body);
  assert.equal(materialPaint('part-0', 'materials/models/items/abaddon/x/x.vmat', 'abaddon:mount', paint), paint.parts['abaddon:mount']);
  assert.equal(materialPaint('part-1', 'materials/models/heroes/abaddon/abaddon_helm.vmat', 'abaddon:head', paint), paint.body, 'a stock item shares the body\'s textures');
  assert.equal(materialPaint('part-1', 'materials/models/items/abaddon/y/y.vmat', 'abaddon:head', paint), null, 'an item with no colour of its own stays');
  assert.equal(materialPaint('pedestal', 'materials/models/heroes/x.vmat', undefined, paint), null);
  assert.deepEqual(effectPalette({ 3: 'particles/econ/items/abaddon/mount_fx.vpcf', 4: 'particles/other.vpcf' }, paint), { 3: { rgb: [1, 0, 0], own: true, bake: false } });
});

test("every worn part finds its slot in the scene, not the body alone", () => {
  // as the scene listed them for Centaur in a real run; a regex that lost its backslash matched only the body
  const tone: [number, number, number, number] = [0.26, 0.65, 1, 1];
  const paint = { body: tone, parts: { 'item:centaur:head': tone, 'item:centaur:tail': tone }, effects: {} };
  const materials: [string, { owner: string; materialPath: string }][] = [
    ['hero::0', { owner: 'hero', materialPath: 'materials/models/heroes/centaur/centaur_color.vmat' }],
    ['part-0::0', { owner: 'part-0', materialPath: 'materials/models/items/centaur/corrupted_contender_head/corrupted_contender_head.vmat' }],
    ['part-1::0', { owner: 'part-1', materialPath: 'materials/models/items/centaur/corrupted_contender_weapon/corrupted_contender_weapon.vmat' }],
    ['part-12::0', { owner: 'part-12', materialPath: 'materials/models/items/centaur/x/x.vmat' }],
    ['pedestal::0', { owner: 'pedestal', materialPath: 'studio-stone' }],
  ];
  const slots = ['item:centaur:head', 'item:centaur:weapon', ...Array(10).fill('item:centaur:other'), 'item:centaur:tail'];
  assert.deepEqual(Object.keys(scenePaints(materials, slots, paint)), ['hero::0', 'part-0::0', 'part-12::0']);
});

test("the editor works on the layer picked, or on every layer that is on; only pictures take a mode", () => {
  assert.deepEqual(LAYERS.filter(isPicture).map((l) => l.id), ['body', 'itemModel:7']);
  assert.equal(layerLabel(LAYERS[2]), 'цвет Spectral Shadow Mount');
  assert.equal(layerLabel(LAYERS[3]), 'эффект Spectral Shadow Mount');
  assert.equal(paintSummary(['a', 'b', 'c', 'd', 'e', 'f']), 'a, b, c, d +2');
  const base = { layers: LAYERS, on: new Set(['itemModel:7']), colors: new Map([['itemModel:7', '#00ff00']]), modes: new Map([['itemModel:7', 'rgb' as const]]), all: '#7f5af0', allMode: 'full' as const, gems: [] };
  assert.deepEqual(editorOf({ ...base, selected: null }), { id: null, title: 'Все включённые', color: '#7f5af0', mode: 'full', picture: true, on: true, gems: [] });
  const item = editorOf({ ...base, selected: 'itemModel:7' });
  assert.deepEqual([item.title, item.color, item.mode, item.picture, item.on], ['Spectral Shadow Mount · цвет', '#00ff00', 'rgb', true, true]);
  const fx = editorOf({ ...base, selected: 'item:7' });
  assert.deepEqual([fx.mode, fx.picture, fx.on, fx.color], ['tint', false, false, '#7f5af0']);
  assert.equal(editorOf({ ...base, selected: 'gone' }).id, null, 'a layer that went away hands the editor back to all');
  const shared = editorOf({ ...base, layers: [...LAYERS.map((l) => (l.id === 'itemModel:7' ? { ...l, shares: ['itemModel:8'] } : l)), { id: 'itemModel:8', kind: 'itemModel', name: 'Spectral Shadow Back', files: 1 }], selected: 'itemModel:7' });
  assert.equal(shared.shared, 'Spectral Shadow Back', 'the editor names the items that share its texture');
});
