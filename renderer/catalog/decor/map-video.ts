/* What the 3D map draws for the player's Dota video settings (video.txt, read by
 * crates/mm-core/src/game/video_settings.rs). The options screen (panorama popup_settings_reborn)
 * writes "true"/"false" for its checkboxes, while the quick slider copies its preset
 * (cfg/video_defaults_0..3.txt in the game's pak01) as "0"/"1": both mean the same here.
 *
 * Read from RenderDoc frames of the game, 2026-11-27:
 *   dota_cheap_water                 the water as one flat lit sheet (map-water.ts)
 *   cl_globallight_shadow_mode 0     no sun shadows at all (1-3 are their sizes)
 *   r_ssao                           the ambient occlusion pass (map-ao.ts)
 *   r_deferred_specular              the props' shine (map-spec.ts)
 *   r_deferred_additive_pass and     the lamps and braziers light what is around them: the game
 *   r_deferred_simple_light          draws them only with both on
 * The glows (the haze over the Dire's lava pit) the game draws at every setting, after its post pass. */
import type { VideoSettings } from '../../api/decor.ts';

export interface MapVideo {
  cheapWater: boolean;
  shadows: boolean;
  ssao: boolean;
  specular: boolean;
  smallLights: boolean;
}

/** A setting as a switch: true, a number above 0 or a string of one; unknown is `fallback`. */
function on(video: VideoSettings | null, key: string, fallback: boolean): boolean {
  const v = video?.[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  if (typeof v === 'string' && v.trim() !== '') {
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    if (!Number.isNaN(n)) return n > 0;
  }
  return fallback;
}

/** The map's switches for these settings; without any (no Steam account, no file) the game's defaults. */
export function mapVideo(video: VideoSettings | null): MapVideo {
  return {
    cheapWater: on(video, 'dota_cheap_water', false),
    shadows: on(video, 'cl_globallight_shadow_mode', true),
    ssao: on(video, 'r_ssao', true),
    specular: on(video, 'r_deferred_specular', true),
    smallLights: on(video, 'r_deferred_additive_pass', true) && on(video, 'r_deferred_simple_light', true),
  };
}
