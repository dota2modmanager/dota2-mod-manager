// The map's lighting zones blended where the view looks (renderer/catalog/decor/map-zones.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendZones, shares } from '../renderer/catalog/decor/map-zones.ts';
import type { ZonePlace } from '../renderer/api/decor.ts';

// the default map's four everyday zones, as map_build.rs zone_places reads them
const zones: ZonePlace[] = [
  { zone: 'RF', at: [-6784, -6304], inner: 7000, outer: 13000, light: { color_day: [216, 208, 207], light_scale_day: 5 } },
  { zone: 'RB', at: [6528, -6304], inner: 3000, outer: 6000, light: { color_day: [216, 208, 207], light_scale_day: 5 } },
  { zone: 'DT', at: [-5904, 5904], inner: 2000, outer: 4500, light: { color_day: [200, 194, 251], light_scale_day: 5 } },
  { zone: 'DF', at: [6416, 5904], inner: 7000, outer: 11000, light: { color_day: [200, 194, 251], light_scale_day: 7 } },
];

test('in the Dire base, the view takes the Dire forest', () => {
  const w = shares(zones, 7020, 6146);
  assert.deepEqual(w, [0, 0, 0, 1]);
  assert.deepEqual(blendZones({}, zones, w).color_day, [200, 194, 251]);
});

test('between the sides, the zones mix by the shares the game gives them, the far ones taken away', () => {
  const w = shares(zones, 0, 0);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // the two forests reach mid, the bottom and the top do not
  assert.deepEqual(w.map((v) => Math.round(v * 100)), [55, 0, 0, 45]);
  const z = blendZones({}, zones, w);
  assert.ok(Math.abs(z.light_scale_day! - (5 * w[0] + 7 * w[3])) < 1e-9, String(z.light_scale_day));
});

test('at mid the camera of the game, 567 south of the middle, takes the forests by 22/31 and 9/31', () => {
  // read from a frame of the game: the shadow scale of the zones (1 and 2) came out 40/31 there
  const w = shares(zones, 0, -567);
  assert.ok(Math.abs(w[0] - 22 / 31) < 1e-4 && Math.abs(w[3] - 9 / 31) < 1e-4, String(w));
});

test('inside one zone and in reach of another, the other goes below 0', () => {
  // 1000 from the Dire top, within its inner radius; the Radiant forest reaches there too
  const w = shares(zones, -5904, 4904);
  assert.ok(w[2] > 1 && w[0] < 0, String(w));
});

test('where no zone reaches, the nearest lights the view', () => {
  assert.deepEqual(shares(zones.slice(1, 3), 20000, -20000), [1, 0]);
});

test('the look keeps what the zones do not carry', () => {
  const z = blendZones({ global_specular_power: 28, color_day: [1, 1, 1] }, zones, shares(zones, 7020, 6146));
  assert.equal(z.global_specular_power, 28);
  assert.deepEqual(z.color_day, [200, 194, 251]);
});
