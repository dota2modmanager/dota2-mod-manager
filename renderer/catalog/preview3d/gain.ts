/* How bright a particle system is drawn in the 3D preview (particles.ts). The game's sprites are
 * mostly empty frames around a speck or a wisp; drawn on top of each other in the window, they would
 * whiten the stage, so a system gives back light for the area it covers and, additive, for its crowd. */
import type { ParticleSpec } from './particle-def.ts';

/** An additive system of hundreds shines as twenty would, so a burst of snow sparkles rather than stands as a white column: the game's flecks are mostly empty frames. */
export function crowdGain(s: Pick<ParticleSpec, 'rate' | 'burst' | 'life' | 'max'>): number {
  const alive = Math.min(s.max, s.burst + s.rate * (s.life[0] + s.life[1]) / 2);
  return Math.min(1, 20 / Math.max(1, alive));
}

/**
 * How much of its light a system keeps for the area it covers at once: a few dozen large sprites in
 * the game are thin veils of smoke and rays, and drawn as solid dots on top of each other they would
 * whiten the stage. Snow (hundreds of specks) keeps all of it; an arcana's base mist, a tenth.
 */
export function coverGain(s: Pick<ParticleSpec, 'rate' | 'burst' | 'life' | 'max' | 'radius' | 'size'>): number {
  const alive = Math.min(s.max, s.burst + s.rate * (s.life[0] + s.life[1]) / 2);
  // at its largest: a speck that starts twelve times its radius covers what a cloud does
  const r = (s.radius[0] + s.radius[1]) / 2 * Math.max(s.size.from, s.size.to, 0.01);
  return Math.min(1, Math.sqrt(6000 / Math.max(1, alive * r * r)));
}
