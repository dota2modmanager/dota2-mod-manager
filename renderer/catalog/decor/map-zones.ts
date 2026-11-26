/* The map's light where the view looks, as the game lights it: the default map has four lighting
 * zones a look (ent_dota_lightinfo: the Radiant's forest and bottom, the Dire's forest and top,
 * map_build.rs zone_places), each standing somewhere with an inner and an outer radius. A zone
 * counts in full within its inner radius and fades out by its outer one; the zones that reach the
 * view's middle are blended by those shares. So the Dire's woods take their bluer sun, purple
 * shadows and red fog, and the river between the two sides a mix of both. */
import type { ZoneLight, ZonePlace } from '../../api/decor.ts';

/** How much a zone counts at this distance from it: all within its inner radius, none past its outer. */
export function reach(z: ZonePlace, distance: number): number {
  if (distance <= z.inner) return 1;
  if (distance >= z.outer) return 0;
  return (z.outer - distance) / Math.max(1, z.outer - z.inner);
}

/** Each zone's share at (x, y) in the map's inches, summing to 1; the nearest alone when none reaches. */
export function shares(zones: ZonePlace[], x: number, y: number): number[] {
  const far = zones.map((z) => Math.hypot(x - (z.at[0] ?? 0), y - (z.at[1] ?? 0)));
  const w = zones.map((z, i) => reach(z, far[i]));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) return w.map((v) => v / sum);
  const near = far.indexOf(Math.min(...far));
  return zones.map((_, i) => (i === near ? 1 : 0));
}

/** The zones' light blended by their shares over the look's own (which keeps what all zones share):
 * numbers and lists of numbers by share, anything else from the zone with the largest. */
export function blendZones(base: ZoneLight, zones: ZonePlace[], w: number[]): ZoneLight {
  if (!zones.length) return base;
  const out: Record<string, unknown> = { ...base };
  const top = w.indexOf(Math.max(...w));
  const keys = new Set(zones.flatMap((z) => Object.keys(z.light)));
  for (const key of keys) {
    const vals = zones.map((z) => (z.light as Record<string, unknown>)[key]);
    const first = vals[top] ?? vals.find((v) => v !== undefined);
    if (typeof first === 'number') {
      let sum = 0, weight = 0;
      vals.forEach((v, i) => { if (typeof v === 'number') { sum += v * w[i]; weight += w[i]; } });
      out[key] = weight > 0 ? sum / weight : first;
    } else if (Array.isArray(first)) {
      const acc = first.map(() => 0);
      let weight = 0;
      vals.forEach((v, i) => {
        if (!Array.isArray(v) || w[i] <= 0) return;
        weight += w[i];
        first.forEach((_, j) => { acc[j] += (typeof v[j] === 'number' ? v[j] : first[j]) * w[i]; });
      });
      out[key] = weight > 0 ? acc.map((a) => a / weight) : first;
    } else if (first !== undefined) {
      out[key] = first;
    }
  }
  return out as ZoneLight;
}
