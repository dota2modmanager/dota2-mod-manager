/**
 * Arcana bases: an arcana rebuilt by hand in Valve's Workshop Tools so that it works as the hero's
 * own look, for the item builder (src/schema-service.ts) and the arcana window (src/arcana-service.ts).
 *
 * The builder's arcana is Valve's model under the plain hero's path, and the pass through every
 * arcana (src/arcana-notes.ts) found a dozen that do not survive it: Razor walks backwards, Pudge's
 * back is torn, Juggernaut has one run. J0nathan550 compiled each of those again, body, animations,
 * particles and materials, with every file at the path the plain hero reads, and published them in
 * a repository of their own (src/arcana-base-store.ts brings them down). This file says which base
 * a pick puts on and how its files share the hero with the user's other picks.
 *
 * A base is the whole arcana set made the hero's default look: the body at the hero's model path,
 * and each of the set's parts at the path of the stock item of its slot (Razor's
 * models/heroes/razor/razor_armor is the arcana's armour). So the rule is by path:
 * - a pick of another item for a slot writes that slot's path, and the user's pick wins: the base
 *   goes under every pick (schema.deploy `beneath`);
 * - a pick of one of the set's own parts would write Valve's version of the part there, which is
 *   what the base fixes: such a pick leaves the base's paths to the base (`withoutBaseFiles`).
 */
import { entryPath, type VpkEntry } from './vpk.ts';
import { drain, PAUSE } from './steps.ts';

/** One base: a folder of the repository, and the picks it is for. */
export interface ArcanaBase {
  /** its folder in the repository, src/<id>/ */
  id: string;
  /** the hero, as items_game names it without npc_dota_hero_ */
  hero: string;
  /** the arcana item whose pick puts the base on */
  item: string;
  /** the item's styles the base is, by items_game's numbering (0 the first); none: all of them */
  styles?: number[];
  /** items that must be picked as well; of the bases that fit, the one with most of them wins */
  requires?: string[];
  /** the set's items: a pick of one leaves the base's paths to the base */
  parts: string[];
}

const JUGGERNAUT = ['9059', '30261', '7592'];
const WINDRUNNER = ['13804', '13805', '13806', '13807', '13808', '32650'];
const DROW = ['19088', '19089', '19090', '19091', '19092', '19093', '19094', '37144'];
const PUDGE = ['7756', '29687'];
const EARTHSHAKER = ['12692', '34379', '34380', '34381', '34382'];
const SKYWRATH = ['18539', '18540', '18541', '18542', '18543', '18544'];
const RAZOR = ['23095', '23096', '23097', '23098', '23099'];
const FACELESS_VOID = ['18033', '22822', '22823', '22824', '22825'];
const AXE_UNLEASHED = ['12964', '12965', '12966', '12968'];

/*
 * Rubick's Magus Cypher has 41 styles, colours of its particles, and Crystal Maiden's Frost
 * Avalanche four: their bases are the first style's, and the others build from Valve's files as
 * before. Spectre's first style works from Valve's (the 2026-10-15 pass), so only the second has one.
 *
 * Drow's bases are her body and the arcana's own effects, and nothing at another slot's stock path:
 * her cape, armour and quiver are the user's picks, or the stock items. Her first bases wrote the
 * set's cape, armour and quiver there too, so she wore the arcana's cape whatever was picked, and
 * her second style had a variant for under Mania's Mask (both replaced on 2026-10-23). Axe's Fists
 * of Axe Unleashed is an immortal, not an arcana, but it swaps his whole model the same way.
 */
export const ARCANA_BASES: readonly ArcanaBase[] = [
  { id: 'bladeform_legacy', hero: 'juggernaut', item: '9059', styles: [0], parts: JUGGERNAUT },
  { id: 'bladeform_legacy_v2', hero: 'juggernaut', item: '9059', styles: [1], parts: JUGGERNAUT },
  { id: 'blades_of_voth_domosh', hero: 'legion_commander', item: '5810', parts: ['5810', '37140'] },
  { id: 'claszian_apostasy', hero: 'faceless_void', item: '18033', styles: [0], parts: FACELESS_VOID },
  { id: 'claszian_apostasy_v2', hero: 'faceless_void', item: '18033', styles: [1], parts: FACELESS_VOID },
  { id: 'compass_of_the_rising_gale_bundle', hero: 'windrunner', item: '13806', styles: [0], parts: WINDRUNNER },
  { id: 'compass_of_the_rising_gale_bundle_v2', hero: 'windrunner', item: '13806', styles: [1], parts: WINDRUNNER },
  { id: 'dread_retribution', hero: 'drow_ranger', item: '19090', styles: [0], parts: DROW },
  { id: 'dread_retribution_v2', hero: 'drow_ranger', item: '19090', styles: [1], parts: DROW },
  { id: 'feast_of_abscession', hero: 'pudge', item: '7756', styles: [0], parts: PUDGE },
  { id: 'feast_of_abscession_v2', hero: 'pudge', item: '7756', styles: [1], parts: PUDGE },
  { id: 'fists_of_axe_unleashed', hero: 'axe', item: '12964', parts: AXE_UNLEASHED },
  { id: 'fractal_horns_of_inner_abysm', hero: 'terrorblade', item: '5957', parts: ['5957', '37161'] },
  { id: 'frost_avalanche', hero: 'crystal_maiden', item: '7385', styles: [0], parts: ['7385'] },
  { id: 'phantom_advent_v2', hero: 'spectre', item: '9662', styles: [1], parts: ['9662', '9663', '12312', '12313', '12314', '18750'] },
  { id: 'planetfall', hero: 'earthshaker', item: '12692', styles: [0], parts: EARTHSHAKER },
  { id: 'planetfall_v2', hero: 'earthshaker', item: '12692', styles: [1], parts: EARTHSHAKER },
  { id: 'the_devotions_of_dragonus', hero: 'skywrath_mage', item: '18539', styles: [0], parts: SKYWRATH },
  { id: 'the_devotions_of_dragonus_v2', hero: 'skywrath_mage', item: '18539', styles: [1], parts: SKYWRATH },
  { id: 'the_magus_cypher', hero: 'rubick', item: '12451', styles: [0], parts: ['12451', '12427'] },
  { id: 'voidstorm_asylum', hero: 'razor', item: '23095', styles: [0], parts: RAZOR },
  { id: 'voidstorm_asylum_v2', hero: 'razor', item: '23095', styles: [1], parts: RAZOR },
];

/** The Terrorblade base, which the arcana window builds in the user's colour. */
export const TERRORBLADE_BASE = 'fractal_horns_of_inner_abysm';

/** A pick as the builder keeps it: the item and its style (src/item-builder-styles.ts styleOf). */
export interface BasePick { itemId: string; style: number }

/** Whether an arcana has a base for any of its styles: the builder's note on it is then out of date. */
export function hasBase(itemId: string): boolean {
  return ARCANA_BASES.some((b) => b.item === itemId);
}

/** The bases a set of picks puts on, at most one per hero, in the order of the picks. */
export function chooseBases(picks: BasePick[], bases: readonly ArcanaBase[] = ARCANA_BASES): ArcanaBase[] {
  const picked = new Set(picks.map((p) => p.itemId));
  const out: ArcanaBase[] = [];
  for (const pick of picks) {
    const best = bases
      .filter((b) => b.item === pick.itemId && (!b.styles || b.styles.includes(pick.style)) && (b.requires || []).every((r) => picked.has(r)))
      .sort((a, b) => (b.requires?.length || 0) - (a.requires?.length || 0))[0];
    if (best && !out.some((b) => b.hero === best.hero)) out.push(best);
  }
  return out;
}

/** A base whose files are here, and the paths it fills, as entryPath writes them. */
export interface ReadyBase { base: ArcanaBase; entries: VpkEntry[]; paths: Set<string> }

/** A base with the files the store had for it, and the paths they fill. */
export function readyBase(base: ArcanaBase, entries: VpkEntry[]): ReadyBase {
  return { base, entries, paths: new Set(entries.map((e) => entryPath(e).toLowerCase())) };
}

/**
 * The bases a set of picks puts on that are here, for a build. One that is not is asked for, and
 * the build goes on from the game's files: the store builds again once it has come
 * (src/services.ts), so a pick never waits on the network. One that is here is asked for too, once
 * a run, for a newer version of it.
 */
export function basesHere(picks: BasePick[], store: BaseSource, log: (msg: string) => void = () => {}): ReadyBase[] {
  return drain(basesHereSteps(picks, store, log));
}

/** Where a build reads bases from (src/arcana-base-store.ts). */
export interface BaseSource { entries(id: string): VpkEntry[] | null; want(id: string): Promise<boolean> }

/** basesHere, a pause after each base: one is up to 20 MB read off the disk. */
export function* basesHereSteps(picks: BasePick[], store: BaseSource, log: (msg: string) => void = () => {}): Generator<typeof PAUSE, ReadyBase[]> {
  const out: ReadyBase[] = [];
  for (const base of chooseBases(picks)) {
    const entries = store.entries(base.id);
    void store.want(base.id);
    if (entries) out.push(readyBase(base, entries));
    else log(`schema: the arcana base ${base.id} is not here yet; built from the game's files until it is`);
    yield PAUSE;
  }
  return out;
}

/**
 * A pick's own files with the ones a base of its set provides taken out: Valve's version of a part
 * under the stock path is what the base replaced. A pick of anything else keeps every file, and
 * wins over the base where both write one path.
 */
export function withoutBaseFiles(itemId: string, assets: VpkEntry[], ready: ReadyBase[]): VpkEntry[] {
  const own = ready.filter((r) => r.base.parts.includes(itemId));
  if (!own.length) return assets;
  return assets.filter((e) => !own.some((r) => r.paths.has(entryPath(e).toLowerCase())));
}
