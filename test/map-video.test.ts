// The 3D map's switches for the player's Dota video settings (renderer/catalog/decor/map-video.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVideo } from '../renderer/catalog/decor/map-video.ts';
import type { VideoSettings } from '../renderer/api/decor.ts';

// the quick slider's presets as the game ships them (pak01 cfg/video_defaults_0..3.txt) and as
// crates/mm-core/src/game/video_settings.rs reads them: "0"/"1" come in as numbers
const preset = (water: number, ssao: number, shadow: number, additive: number, world: number, specular: number): VideoSettings => ({
  dota_cheap_water: water, r_ssao: ssao, cl_globallight_shadow_mode: shadow,
  r_deferred_additive_pass: additive, r_deferred_simple_light: world, r_deferred_specular: specular,
});
const fastest = preset(1, 0, 0, 0, 0, 0);
const medium = preset(1, 0, 2, 1, 1, 0);
const good = preset(1, 1, 2, 1, 1, 1);
const best = preset(0, 1, 2, 1, 1, 1);

test('the slider at its fastest draws the cheap map', () => {
  assert.deepEqual(mapVideo(fastest), { cheapWater: true, shadows: false, ssao: false, specular: false, smallLights: false });
});

test('each step of the slider turns on what its preset turns on', () => {
  assert.deepEqual(mapVideo(medium), { cheapWater: true, shadows: true, ssao: false, specular: false, smallLights: true });
  assert.deepEqual(mapVideo(good), { cheapWater: true, shadows: true, ssao: true, specular: true, smallLights: true });
  assert.deepEqual(mapVideo(best), { cheapWater: false, shadows: true, ssao: true, specular: true, smallLights: true });
});

test('the options screen writes its checkboxes as true and false, which mean the same', () => {
  const own: VideoSettings = {
    dota_cheap_water: true, r_ssao: false, cl_globallight_shadow_mode: 0,
    r_deferred_additive_pass: false, r_deferred_simple_light: 0, r_deferred_specular: false,
  };
  assert.deepEqual(mapVideo(own), mapVideo(fastest));
});

test('the lamps need both the additive pass and the world lights', () => {
  assert.equal(mapVideo({ ...best, r_deferred_simple_light: 0 }).smallLights, false);
  assert.equal(mapVideo({ ...best, r_deferred_additive_pass: false }).smallLights, false);
});

test('without a video.txt the map draws the game at its defaults', () => {
  assert.deepEqual(mapVideo(null), mapVideo(best));
  assert.deepEqual(mapVideo({}), mapVideo(best));
});

test('any shadow size is shadows, and only 0 is none', () => {
  for (const mode of [1, 2, 3]) assert.equal(mapVideo({ cl_globallight_shadow_mode: mode }).shadows, true);
  assert.equal(mapVideo({ cl_globallight_shadow_mode: 0 }).shadows, false);
});
