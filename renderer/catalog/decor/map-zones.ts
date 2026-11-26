/* The map's light where the camera stands, as the game picks it: the default map has four lighting
 * zones a look (ent_dota_lightinfo: the Radiant's forest and bottom, the Dire's forest and top,
 * map_build.rs zone_places), each standing somewhere with an inner and an outer radius. The game
 * (client.dll 0x181e3aae0, read 2026-11-26) takes the zones that reach the view (within their
 * outer radius: the function gets them listed, and with all four the Dire's own base came out half
 * Radiant), gives each r = 1 - (d - inner) / (outer - inner), not held to 0..1, weighs it r_i × the
 * product of (1 - r_j) over the others and divides by the sum; every number of the light is then
 * the sum of the zones' by those shares (inside one zone's inner radius a neighbour's goes below 0),
 * and what is not a number comes from the zone with the largest share. Where none reaches, the
 * nearest lights the view. The point is where the game's camera stands, 567 inches south of what it
 * looks at (map-light.ts CAMERA_BACK): with it a frame of the game read in RenderDoc comes out to the
 * digit, the forests at mid 22/31 and 9/31. So the Dire's woods take their bluer sun, purple shadows
 * and red fog, and mid a mix leaning to the Radiant. */
import type { ZoneLight, ZonePlace } from '../../api/decor.ts';

/** A zone's own weight at this distance from it, as the game counts it: 1 at its inner radius, 0 at its outer. */
export function reach(z: ZonePlace, distance: number): number {
  return 1 - (distance - z.inner) / Math.max(1, z.outer - z.inner);
}

/** Each zone's share at (x, y) in the map's inches, summing to 1, as the game weighs them. */
export function shares(zones: ZonePlace[], x: number, y: number): number[] {
  const far = zones.map((z) => Math.hypot(x - (z.at[0] ?? 0), y - (z.at[1] ?? 0)));
  const near = zones.map((z, i) => far[i] < z.outer);
  const r = zones.map((z, i) => reach(z, far[i]));
  const w = r.map((ri, i) => (near[i] ? r.reduce((acc, rj, j) => (j === i || !near[j] ? acc : acc * (1 - rj)), ri) : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum !== 0) return w.map((v) => v / sum);
  const nearest = far.indexOf(Math.min(...far));
  return zones.map((_, i) => (i === nearest ? 1 : 0));
}

/** The zones' light blended by their shares over the look's own (which keeps what all zones share):
 * numbers and lists of numbers by share, a share below 0 taking its zone away, anything else from
 * the zone with the largest share (the game's: the first above every one before it, from 0). */
export function blendZones(base: ZoneLight, zones: ZonePlace[], w: number[]): ZoneLight {
  if (!zones.length) return base;
  const out: Record<string, unknown> = { ...base };
  let top = 0, best = 0;
  w.forEach((v, i) => { if (v > best) { best = v; top = i; } });
  const keys = new Set(zones.flatMap((z) => Object.keys(z.light)));
  for (const key of keys) {
    const vals = zones.map((z) => (z.light as Record<string, unknown>)[key]);
    const first = vals[top] ?? vals.find((v) => v !== undefined);
    if (typeof first === 'number') {
      let sum = 0, weight = 0;
      vals.forEach((v, i) => { if (typeof v === 'number') { sum += v * w[i]; weight += w[i]; } });
      out[key] = weight !== 0 ? sum / weight : first;
    } else if (Array.isArray(first)) {
      const acc = first.map(() => 0);
      let weight = 0;
      vals.forEach((v, i) => {
        if (!Array.isArray(v) || w[i] === 0) return;
        weight += w[i];
        first.forEach((_, j) => { acc[j] += (typeof v[j] === 'number' ? v[j] : first[j]) * w[i]; });
      });
      out[key] = weight !== 0 ? acc.map((a) => a / weight) : first;
    } else if (first !== undefined) {
      out[key] = first;
    }
  }
  return out as ZoneLight;
}
