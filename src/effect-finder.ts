/* Finding an effect by what it is, not by its file: a hero, his abilities, and the effects that
 * belong to each. What belongs to an ability is read off the game's file names, the same way a
 * hero's recolour reads it (src/recolor-layers.ts). An ability's files include what its effects
 * create, so a file that another one in the group brings along is left out of the list: it is
 * reached through that effect's systems. */
import { heroAbilities, heroLayers } from './recolor-layers.ts';
import { localizationTokens } from './cosmetic-names.ts';
import { references } from './resource.ts';
import type { VpkIndex } from './vpk-read.ts';

/** One line of a hero's effects: an ability's, his other ones, or his items'. */
export interface EffectGroup { id: string; kind: 'ability' | 'effects' | 'items'; ability: string | null; name: string | null; paths: string[] }
/** An ability a search found. */
export interface AbilityHit { hero: string; ability: string; name: string }

const LANG_FILE: Record<string, string> = { ru: 'russian', en: 'english', 'zh-CN': 'schinese' };
const HERO = /^[a-z0-9_]{2,40}$/;
const vpcf = (p: string) => p.replace(/\.vpcf_c$/, '.vpcf');
/** How many item effects a hero's list holds: some heroes have thousands of files. */
const ITEMS_SHOWN = 200;
const HITS_SHOWN = 12;

/** The files of a group that no other file of it brings along. */
function roots(read: (p: string) => Buffer | null, files: string[]): string[] {
  const inside = new Set<string>();
  for (const f of files) {
    try {
      for (const r of references(read(f) as Buffer)) {
        const child = r.toLowerCase().replace(/_c$/, '');
        if (`${child}_c` !== f) inside.add(`${child}_c`);
      }
    } catch { /* a file the reader cannot take is listed as it is */ }
  }
  const top = files.filter((f) => !inside.has(f));
  return top.length ? top : files;
}

/** The finder over the game's pak. */
export function createEffectFinder({ index, lang, heroes }: {
  index: () => VpkIndex;
  lang: () => string;
  /** the heroes, with their name in the npc's and in the app's language */
  heroes: () => { hero: string; name: string }[];
}) {
  let names: { lang: string; map: Map<string, string> } | null = null;
  let abilities: { lang: string; list: AbilityHit[] } | null = null;

  /** Ability names in the app's language, out of the game's abilities_*.txt. */
  function abilityNames(): Map<string, string> {
    const now = lang();
    if (names?.lang === now) return names.map;
    let map = new Map<string, string>();
    try {
      const data = index().read(`resource/localization/abilities_${LANG_FILE[now] || 'english'}.txt`);
      if (data) map = localizationTokens(data);
    } catch { /* no names: the window shows the game's ids */ }
    names = { lang: now, map };
    return map;
  }
  const nameOf = (ability: string) => abilityNames().get(`dota_tooltip_ability_${ability}`) || null;
  const scriptOf = (hero: string) => (HERO.test(hero) ? index().read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`)?.toString('utf8') ?? null : null);

  return {
    /** A hero's effects, ability by ability, in his script's order. */
    hero(hero: string): EffectGroup[] {
      const script = scriptOf(hero);
      if (!script) return [];
      const ix = index();
      const paths = [...ix.paths()];
      const read = (p: string) => ix.read(p);
      const out: EffectGroup[] = [];
      for (const l of heroLayers(paths, hero, heroAbilities(script))) {
        if (l.kind === 'ability' && l.name) out.push({ id: l.id, kind: 'ability', ability: l.name, name: nameOf(l.name), paths: roots(read, l.files).map(vpcf) });
        if (l.kind === 'effects') out.push({ id: l.id, kind: 'effects', ability: null, name: null, paths: roots(read, l.files).map(vpcf) });
      }
      const flat = hero.replace(/_/g, '');
      const items = paths.filter((p) => p.endsWith('.vpcf_c') && (p.startsWith(`particles/econ/items/${hero}/`) || p.startsWith(`particles/econ/items/${flat}/`)));
      if (items.length) out.push({ id: 'items', kind: 'items', ability: null, name: null, paths: items.sort((a, b) => a.length - b.length).slice(0, ITEMS_SHOWN).map(vpcf) });
      return out;
    },

    /** The abilities with every word of `query` in their name, in the app's language or the game's id. */
    abilities(query: string): AbilityHit[] {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const now = lang();
      if (abilities?.lang !== now) {
        const list: AbilityHit[] = [];
        for (const { hero } of heroes()) {
          const script = scriptOf(hero);
          if (script) for (const ability of heroAbilities(script)) list.push({ hero, ability, name: nameOf(ability) || ability });
        }
        abilities = { lang: now, list };
      }
      return abilities.list.filter((a) => words.every((w) => a.name.toLowerCase().includes(w) || a.ability.includes(w))).slice(0, HITS_SHOWN);
    },
  };
}
