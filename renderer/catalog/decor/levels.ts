/* The Optimization window's levels of detail and its sliders. Each slider is a kind of thing with
 * steps, each step taking out one more group (crates/mm-core/src/looks/map_optimize.rs): the plants lose
 * their flowers and creatures first and their grass after, the trees become the lightest of their
 * kind first and the lightest of the map after. A level of detail is a step for every slider;
 * moving a slider by hand makes the level "custom". */
import type { DecorGroup } from '../../api/content.ts';

export type LevelId = 'original' | 'high' | 'medium' | 'low' | 'minimal';
export type SliderId = 'plants' | 'debris' | 'water' | 'lights' | 'mapFx' | 'courierFx' | 'eventFx' | 'weather' | 'dark';

/** Each slider's groups in the order its steps take them out. */
export const SLIDER_GROUPS: Record<SliderId, DecorGroup[]> = {
  plants: ['critters', 'grass'],
  debris: ['stains', 'rocks'],
  water: ['waterfalls', 'river'],
  lights: ['rays', 'fires'],
  mapFx: ['mapFx'],
  courierFx: ['courierFx'],
  eventFx: ['eventFx'],
  weather: ['weather'],
  dark: ['dusk', 'dark'],
};

/** The look of the map, not what it costs: a level of detail leaves it as it is. */
export const LOOK_GROUPS: DecorGroup[] = ['dusk', 'dark'];

export const ALL_GROUPS: DecorGroup[] = ['critters', 'grass', 'stains', 'rocks', 'waterfalls', 'river', 'mapFx', 'rays', 'fires',
  'courierFx', 'eventFx', 'weather', 'dusk', 'dark'];

/** Each level as a step per slider (a slider left out stays at 0). */
const STEPS: Record<LevelId, Partial<Record<SliderId, number>>> = {
  original: {},
  high: { weather: 1, eventFx: 1 },
  medium: { weather: 1, eventFx: 1, courierFx: 1, plants: 1, debris: 1, lights: 1 },
  low: { weather: 1, eventFx: 1, courierFx: 1, plants: 1, debris: 2, lights: 2, mapFx: 1, water: 1 },
  minimal: { weather: 1, eventFx: 1, courierFx: 1, plants: 2, debris: 2, lights: 2, mapFx: 1, water: 2 },
};

export const LEVELS: LevelId[] = ['original', 'high', 'medium', 'low', 'minimal'];

/** The groups a step of each slider takes out, in the window's order. */
export function groupsOfSteps(steps: Partial<Record<SliderId, number>>): DecorGroup[] {
  const want = new Set<DecorGroup>();
  for (const [id, n] of Object.entries(steps) as [SliderId, number][]) SLIDER_GROUPS[id].slice(0, n).forEach((g) => want.add(g));
  return ALL_GROUPS.filter((g) => want.has(g));
}

export const groupsOf = (id: LevelId): DecorGroup[] => groupsOfSteps(STEPS[id]);

/** A slider's step for these groups: how many of its groups, from the first, are taken out. */
export function stepOf(id: SliderId, groups: readonly DecorGroup[]): number {
  const list = SLIDER_GROUPS[id];
  let n = 0;
  while (n < list.length && groups.includes(list[n])) n++;
  return n;
}

/** The groups with one slider moved to a step, the others as they were. */
export function withStep(groups: readonly DecorGroup[], id: SliderId, step: number): DecorGroup[] {
  const mine = new Set(SLIDER_GROUPS[id]);
  const steps = Object.fromEntries((Object.keys(SLIDER_GROUPS) as SliderId[]).map((s) => [s, s === id ? step : stepOf(s, groups)]));
  return groupsOfSteps(steps).filter((g) => !mine.has(g) || SLIDER_GROUPS[id].indexOf(g) < step);
}

/** The level whose groups are exactly these (the look aside), or 'custom'. */
export function levelOf(groups: readonly DecorGroup[]): LevelId | 'custom' {
  const set = new Set(groups.filter((g) => !LOOK_GROUPS.includes(g)));
  const hit = LEVELS.find((l) => { const g = groupsOf(l); return g.length === set.size && g.every((x) => set.has(x)); });
  return hit ?? 'custom';
}

/** Groups as a record written before the steps names them (plants, debris, water, lights) opened into the steps, in the window's order. */
export function fromRecord(names: readonly string[]): DecorGroup[] {
  const old: Record<string, DecorGroup[]> = { plants: ['critters', 'grass'], debris: ['stains', 'rocks'], water: ['waterfalls', 'river'], lights: ['rays', 'fires'] };
  const want = new Set<string>(names.flatMap((n) => old[n] ?? [n]));
  return ALL_GROUPS.filter((g) => want.has(g));
}
