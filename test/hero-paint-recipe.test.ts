/* The recolour window's paint finer than a layer (renderer/catalog/paint/paint-recipe.ts,
 * renderer/views/hero-paint-model.ts, preview-paint.ts): the same keys, values and zones the build
 * reads (crates/mm-core/src/looks/paint_recipe.rs), what the window sends, and what the 3D preview
 * paints each material in. */
import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g.window = { I18N_LANG: 'ru' };
g.L = (strings: TemplateStringsArray | string, ...values: unknown[]) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const recipe = await import('../renderer/catalog/paint/paint-recipe.ts');
const model = await import('../renderer/views/hero-paint-model.ts');
const preview = await import('../renderer/catalog/paint/preview-paint.ts');

test('a value carries a colour, its mode and the material, and goes back the same', () => {
  const look = recipe.parseLook('#FF0000:full;m=100;g=80');
  assert.deepEqual(look, { hex: '#ff0000', mode: 'full', mats: [100, 80, null, null, null] });
  assert.equal(recipe.parseLook('keep;d=0')?.mats[4], 0, 'the detail off');
  assert.equal(recipe.lookValue(look!), '#ff0000:full;m=100;g=80');
  assert.equal(recipe.lookValue({ hex: null, mode: 'tint', mats: [null, null, 0, null] }), 'keep;s=0');
  assert.equal(recipe.parseLook('keep'), null, 'nothing to change');
  assert.equal(recipe.parseLook('#ff0000;m=101'), null);
  assert.equal(recipe.parseLook('#00ff00')?.mode, 'tint', 'the old form still reads');
});

test('a gradient carries its light colour, and the shader gets it', () => {
  const look = recipe.parseLook('#101014:grad;t=FFB020;m=0');
  assert.equal(look?.to, '#ffb020');
  assert.equal(recipe.lookValue(look!), '#101014:grad;t=ffb020;m=0');
  const shader = recipe.shaderPaint({ base: look, zones: recipe.ZONES.map(() => null) });
  assert.equal(shader.tones[0][3], 5, 'mode 5: the gradient map');
  assert.deepEqual(shader.tos[0].map((n) => Math.round(n * 255)), [255, 176, 32, 128]);
  assert.equal(recipe.lookValue({ ...look!, at: 70 }), '#101014:grad;t=ffb020;b=70;m=0');
});

test('zones and parts are named as the build names them', () => {
  assert.equal(recipe.ZONES[recipe.zoneOf([10, 10, 12])], 'dark');
  assert.equal(recipe.ZONES[recipe.zoneOf([180, 180, 185])], 'light');
  assert.equal(recipe.ZONES[recipe.zoneOf([210, 170, 40])], 'yellow');
  assert.equal(recipe.partOf('materials/models/heroes/knight/helmet_color_tga_72202aee.vtex_c'), 'helmet_color');
  assert.equal(recipe.partName('helmet_color'), 'helmet');
  assert.deepEqual(recipe.splitKey('itemModel:12@blade_color~light'), { layer: 'itemModel:12', part: 'blade_color', zone: 'light' });
  assert.equal(recipe.keyOf('body', null, 'red'), 'body~red');
});

test('the precise key wins: zone over part over layer', () => {
  const values = { body: '#ff0000;m=10', 'body@helmet_color': '#00ff00', 'body~light': '#0000ff:full;g=90', 'body@blade_color~light': 'keep;m=100' };
  const helmet = recipe.recipeOf(values, 'body', 'helmet_color');
  assert.equal(helmet.base?.hex, '#00ff00');
  assert.equal(helmet.base?.mats[0], 10, 'the layer material where the part has none');
  const blade = recipe.recipeOf(values, 'body', 'blade_color');
  assert.equal(blade.zones[1]?.mats[0], 100);
  assert.equal(blade.zones[1]?.hex, '#0000ff', 'the layer zone colour stays');
  const shader = recipe.shaderPaint(blade);
  assert.equal(shader.tones[1][3], 3 + 8, 'a zone asked for: full, greys too');
  assert.equal(shader.tones[2][3], 1, 'another zone takes the layer tint');
  assert.deepEqual(shader.mats[1], [1, 0.9, -1, -1, -1]);
});

const layers = [
  { id: 'body', kind: 'body' as const, name: null, files: 2, parts: [
    { id: 'helmet_color', file: 'materials/models/heroes/knight/helmet_color_tga_1.vtex_c', materials: ['materials/models/heroes/knight/helmet_color.vmat'], masks: true },
    { id: 'belt_color', file: 'materials/models/heroes/knight/belt_color_tga_2.vtex_c', materials: ['materials/models/heroes/knight/belt_color.vmat'], masks: false },
  ] },
  { id: 'effects', kind: 'effects' as const, name: null, files: 3, particles: ['particles/a.vpcf_c'] },
];

test('the window sends a value per key that is on, a part or zone with no colour as keep', () => {
  const st = {
    layers, all: '#7f5af0', allMode: 'tint' as const,
    on: new Set(['body@helmet_color', 'effects', 'body~light']),
    looks: new Map([['body@helmet_color', { hex: null, mode: 'full' as const, mats: [100, 90, 100, null] }], ['body~light', { hex: '#222222', mode: 'full' as const, mats: [null, null, null, null] }]]),
  };
  assert.deepEqual(model.wantedValues(st), { 'body@helmet_color': 'keep;m=100;g=90;s=100', effects: '#7f5af0', 'body~light': '#222222:full' });
});

test('the editor of a part lists the parts, the zones of its texture and its material', () => {
  const e = model.editorOf({
    layers, all: '#7f5af0', allMode: 'tint', selected: 'body@belt_color', gems: [],
    on: new Set(['body@belt_color~red']),
    looks: new Map(),
    pictures: { 'materials/models/heroes/knight/belt_color_tga_2.vtex_c': { picture: 'data:x', zones: [['red', 0.5, '#aa2222'], ['dark', 0.3, '#111111']] } },
  });
  assert.equal(e.keep, true, 'a part has no colour of its own until one is picked');
  assert.deepEqual(e.model?.zones.map((z) => [z.zone, z.painted]), [['dark', false], ['red', true]]);
  assert.equal(e.model?.parts[1].picture, 'data:x');
  assert.equal(e.model?.loading, false);
  assert.equal(e.model?.masks, false, 'the belt has no masks: only its colour changes in the game');
  assert.equal(model.moveKey('body@belt_color', { zone: 'red' }), 'body@belt_color~red');
  assert.equal(model.moveKey('body@belt_color~red', { part: null }), 'body~red');
});

test('the 3D preview paints a material by its part, an item over the body', () => {
  const paint = preview.previewPaint(layers, { 'body@helmet_color': '#00ff00;m=100', effects: '#ff0000' }, { weapon: '77' });
  const helmet = preview.materialPaint('hero', 'materials/models/heroes/knight/helmet_color.vmat', undefined, paint);
  assert.equal(helmet?.mats[4][0], 1);
  assert.equal(preview.materialPaint('hero', 'materials/models/heroes/knight/belt_color.vmat', undefined, paint), null, 'the belt has nothing of its own');
  assert.deepEqual(paint.effects['particles/a.vpcf'], [255, 0, 0]);
});
