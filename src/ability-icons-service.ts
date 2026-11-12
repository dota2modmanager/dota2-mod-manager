/* The window's half of a hero's ability icons picked from his own cosmetics' (what there is to pick
 * and how it goes in is src/ability-icons.ts). One record in My mods per hero, since two paks of the
 * same icon would hide each other; each ability's pick can be put back to the game's own on its
 * own, and putting back the last takes the record with it.
 *
 * The record goes early in the load order with the hero items (categoryId hero-items), so a catalog
 * mod of the hero does not cover it. What it holds is copies of the game's own pictures, so a Dota
 * update that reached it builds it again from the new ones. */
import path from 'node:path';
import { heroIconChoices, iconEntries, iconModifiers, modifierSets, ICON_NAME, type AbilityIcons, type IconModifier, type IconSource } from './ability-icons.ts';
import { heroAbilities } from './recolor-layers.ts';
import { localizationTokens } from './cosmetic-names.ts';
import { listItems } from './schema-items.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import type { Installer } from './installer.ts';
import { buildVpk, entryPath, sharedVpkIndex, type VpkIndex } from './vpk.ts';
import { heroDisplayName } from './hero-names.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** What an icons record was built from: the hero, and the icon picked for each ability. */
export interface IconsGenerated { abilityIcons: string; picks: Record<string, string> }

/** One icon as the window draws it. */
export interface IconChoiceView { icon: string; item: string; style: number | null }

/** An ability with its icons, its name in the app's language. */
export interface AbilityIconsView { ability: string; name: string; choices: IconChoiceView[] }

/** What the window shows for a hero. */
export interface HeroIcons {
  hero: string; abilities: AbilityIconsView[]; picks: Record<string, string>; recId: string | null; enabled: boolean;
  /** ValveResourceFormat is there: nearly every icon is compressed, and without it the window has names only */
  vrf: boolean;
}

const HERO = /^[a-z0-9_]{2,40}$/;
const LANG_FILE: Record<string, string> = { ru: 'russian', en: 'english', 'zh-CN': 'schinese' };

/** The service the icons:* channels call. */
export function createAbilityIcons({ gamePath, installer, library, vanilla, vrf = () => null, lang = () => 'en', log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller & Pick<Installer, 'swapSlots'>;
  library: Pick<Library, 'list' | 'add' | 'update' | 'removeRecord'>;
  /** the game's own item table */
  vanilla: () => string;
  /** ValveResourceFormat's CLI, when it is downloaded: the window's pictures are read with it */
  vrf?: () => string | null;
  lang?: () => string;
  log?: (msg: string) => void;
}) {
  const pak01 = (): VpkIndex => {
    const g = gamePath();
    if (!g) throw new Error(t('Не указана папка игры'));
    return sharedVpkIndex(path.join(g, 'dota', 'pak01_dir.vpk'));
  };

  // The table parsed once per table: 26k items and a thousand modifiers take a third of a second.
  type Table = { text: string; sources: IconSource[]; modifiers: IconModifier[] };
  let parsed: Table | null = null;
  const table = (): Table => {
    const text = vanilla();
    if (parsed?.text !== text) parsed = { text, sources: [...listItems(text), ...modifierSets(text)], modifiers: iconModifiers(text) };
    return parsed;
  };

  // the heroes with a choice, for this table and this pak01 (sharedVpkIndex opens it again when it changed)
  let heroList: { of: Table; ix: VpkIndex; list: { hero: string; name: string }[] } | null = null;

  const heroScript =(ix: VpkIndex, hero: string) => ix.read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`)?.toString('utf8') ?? null;

  function choicesOf(hero: string): AbilityIcons[] {
    if (!HERO.test(hero)) throw new Error(t('Нет такого героя: {0}', hero));
    const ix = pak01();
    const script = heroScript(ix, hero);
    if (script == null) throw new Error(t('Нет такого героя: {0}', hero));
    const { text, sources, modifiers } = table();
    return heroIconChoices(text, sources, hero, heroAbilities(script), (f) => ix.has(f), modifiers);
  }

  /** Game text in the app's language: ability names, and the shared sets' names. */
  function words(): Map<string, string> {
    const out = new Map<string, string>();
    try {
      const ix = pak01();
      // the app's language first, English for what it lacks
      for (const language of new Set([LANG_FILE[lang()] || 'english', 'english'])) {
        for (const file of ['abilities', 'dota']) {
          const data = ix.read(`resource/localization/${file}_${language}.txt`);
          if (data) for (const [k, v] of localizationTokens(data)) if (!out.has(k)) out.set(k, v);
        }
      }
    } catch { /* no game text: the names the table has */ }
    return out;
  }

  const recordOf = (hero: string): LibRecord | null =>
    library.list().find((r) => (r.generated as IconsGenerated | undefined)?.abilityIcons === hero) ?? null;
  const picksOf = (hero: string) => ({ ...((recordOf(hero)?.generated as IconsGenerated | undefined)?.picks ?? {}) });

  /** The hero built with `picks`: in his record's slot, a new record, or none when nothing is picked. */
  function apply(hero: string, picks: Record<string, string>, keepOff = false): LibRecord | null {
    const old = recordOf(hero);
    const ix = pak01();
    const script = heroScript(ix, hero);
    const order = script ? heroAbilities(script) : [];
    const rank = (a: string) => (order.includes(a) ? order.indexOf(a) : order.length);
    // a picture two abilities share goes to the one first in the hero's script
    const ordered = Object.fromEntries(Object.entries(picks).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)));
    const { entries, gone } = iconEntries((f) => ix.read(f), ordered, table().modifiers, (f) => ix.has(f));
    if (gone.length) log(`ability icons: ${hero}: ${gone.length} pick(s) the game has no picture for any more, first ${gone[0]}`);
    for (const a of gone) delete picks[a];
    if (!entries.length) {
      if (old) { installer.remove(old.files, { recId: old.id }); library.removeRecord(old.id); }
      return null;
    }
    const vpk = buildVpk(entries);
    const name = t('Иконки способностей: {0}', heroDisplayName(hero));
    const generated: IconsGenerated = { abilityIcons: hero, picks };
    log(`ability icons: ${hero}, ${entries.length} icon(s)`);
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return ahead(library.update(old.id, { name, files, generated, enabled: !off, updatedAt: Date.now() }) as LibRecord, entries.map(entryPath));
    }
    const rec = library.add({ name, categoryId: 'hero-items', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return ahead(library.update(rec.id, { generated }) as LibRecord, entries.map(entryPath));
  }

  const slotOf = (r: Pick<LibRecord, 'files'>) => Number(/^pak(\d+)$/.exec(installer.slotBase(r as LibRecord) ?? '')?.[1] ?? NaN);

  /**
   * The record moved ahead of every switched-on mod that carries one of its files, since the lower
   * pak wins: an item builder pick puts its cosmetic's icon under the ability's own path, in a pak of
   * the same early zone, and one built before the icons came first. Into a free slot below the
   * first such mod, or in its place (swapped) when there is none.
   */
  function ahead(rec: LibRecord, files: string[]): LibRecord {
    const mine = slotOf(rec);
    if (!Number.isFinite(mine)) return rec;
    const lang = installer.langFolder();
    let first: LibRecord | null = null;
    for (const other of library.list()) {
      if (other.id === rec.id || other.enabled === false) continue;
      const n = slotOf(other);
      if (!Number.isFinite(n) || n >= mine || (first && n >= slotOf(first))) continue;
      const covers = (other.files || []).some((f) => {
        if (f.root !== 'lang' || !/_dir\.vpk$/i.test(f.relPath)) return false;
        try { const pak = sharedVpkIndex(path.join(lang, f.relPath)); return files.some((p) => pak.has(p)); } catch { return false; }
      });
      if (covers) first = other;
    }
    if (!first) return rec;
    const used = installer.usedPakNames();
    const below = slotOf(first);
    let free: string | null = null;
    for (let i = below - 1; i >= 2 && !free; i--) {
      const base = `pak${String(i).padStart(2, '0')}`;
      if (!used.has(`${base}_dir.vpk`)) free = base;
    }
    log(`ability icons: ${first.name} covered the icons from a lower slot, moving ahead of it`);
    if (free) return library.update(rec.id, { files: installer.moveToSlot(rec, free) }) as LibRecord;
    let out = rec;
    for (const m of installer.swapSlots(rec, first)) {
      const updated = library.update(m.id, { files: m.files }) as LibRecord;
      if (m.id === rec.id) out = updated;
    }
    return out;
  }

  return {
    /** Every hero his cosmetics give a choice of icons to, by his npc name, with his name. */
    heroes(): { hero: string; name: string }[] {
      const ix = pak01();
      const parsedNow = table();
      if (heroList?.of === parsedNow && heroList.ix === ix) return heroList.list;
      const { text, sources, modifiers } = parsedNow;
      const out: { hero: string; name: string }[] = [];
      for (const p of ix.paths()) {
        const hero = /^scripts\/npc\/heroes\/npc_dota_hero_([a-z0-9_]+)\.txt$/.exec(p)?.[1];
        if (!hero || !HERO.test(hero)) continue;
        const script = ix.read(p)?.toString('utf8') ?? '';
        if (heroIconChoices(text, sources, hero, heroAbilities(script), (f) => ix.has(f), modifiers).length) out.push({ hero, name: heroDisplayName(hero) });
      }
      const list = out.sort((a, b) => a.name.localeCompare(b.name));
      heroList = { of: parsedNow, ix, list };
      return list;
    },

    /** A hero's abilities with the icons there are for each, and the picks on now. */
    hero(hero: string): HeroIcons {
      const tokens = words();
      const abilities = choicesOf(hero).map(({ ability, choices }) => ({
        ability,
        name: tokens.get(`dota_tooltip_ability_${ability}`) || ability,
        choices: choices.map((c) => ({ icon: c.icon, item: (c.locKey && tokens.get(c.locKey.toLowerCase())) || c.item, style: c.style })),
      }));
      const rec = recordOf(hero);
      return { hero, abilities, picks: picksOf(hero), recId: rec?.id ?? null, enabled: rec ? rec.enabled !== false : false, vrf: !!vrf() };
    },

    /** `icon` on `ability`, or the game's own back on it when `icon` is null. */
    set(hero: string, ability: string, icon: string | null): LibRecord | null {
      if (!ICON_NAME.test(ability)) throw new Error(t('У героя нет такой способности'));
      const picks = picksOf(hero);
      if (icon == null) delete picks[ability];
      else {
        const offered = choicesOf(hero).find((a) => a.ability === ability);
        if (!offered) throw new Error(t('У героя нет такой способности'));
        if (!offered.choices.some((c) => c.icon === icon)) throw new Error(t('Этой иконки нет у героя'));
        picks[ability] = icon;
      }
      const rec = apply(hero, picks);
      log(`ability icons: ${hero}: ${ability} ${icon ?? 'back to the game’s'}`);
      return rec;
    },

    /** Every pick of the hero taken off, and his record with them. */
    clear(hero: string): null {
      if (!HERO.test(hero)) throw new Error(t('Нет такого героя: {0}', hero));
      return apply(hero, {}) as null;
    },

    /**
     * After a Dota update: the records among `ids` built again from the game's new pictures, before
     * this returns (a copy of a few files, no compiler), so the ids answered are the ones done.
     */
    rebuild(ids: string[]): string[] {
      const done: string[] = [];
      for (const rec of library.list().filter((r) => ids.includes(r.id) && (r.generated as IconsGenerated | undefined)?.abilityIcons)) {
        const g = rec.generated as IconsGenerated;
        try {
          apply(g.abilityIcons, { ...g.picks }, true);
          done.push(rec.id);
        } catch (err) {
          log(`ability icons: could not build again after the update: ${(err as Error).message}`);
        }
      }
      return done;
    },
  };
}
