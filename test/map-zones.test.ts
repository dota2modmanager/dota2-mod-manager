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

test('inside one zone alone, the view takes that zone', () => {
  const w = shares(zones, 7020, 6146);
  assert.deepEqual(w.map((v) => Math.round(v * 100)), [0, 0, 0, 100]);
  assert.deepEqual(blendZones({}, zones, w).color_day, [200, 194, 251]);
});

test('between the sides, the light is a mix by how far each zone reaches', () => {
  const w = shares(zones, 0, 0);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(w[0] > 0.3 && w[3] > 0.3, String(w));
  const z = blendZones({}, zones, w);
  assert.ok(z.light_scale_day! > 5 && z.light_scale_day! < 7);
  assert.ok(z.color_day![2] > 207 && z.color_day![2] < 251);
});

test('where no zone reaches, the nearest lights the view', () => {
  const w = shares(zones.slice(1, 3), 20000, -20000);
  assert.deepEqual(w, [1, 0]);
});

test('the look keeps what the zones do not carry', () => {
  const z = blendZones({ global_specular_power: 28, color_day: [1, 1, 1] }, zones, shares(zones, 7020, 6146));
  assert.equal(z.global_specular_power, 28);
  assert.deepEqual(z.color_day, [200, 194, 251]);
});
