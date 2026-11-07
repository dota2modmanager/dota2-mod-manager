/* A hero's ability icons picked one by one from the icons his own cosmetics already ship: Fissure
 * as the plain one, or as the arcana's, the Deep Magma totem's, the TI9 one... The window and the
 * record are src/ability-icons-service.ts.
 *
 * What there is to pick is read off the game's item table: a cosmetic that changes an icon says so
 * with an asset modifier of type ability_icon, "asset" the ability (its icon is
 * panorama/images/spellicons/<asset>_png.vtex_c) and "modifier" the picture it shows instead, under
 * the same folder. Only items whose used_by_heroes names the hero count, so a hero is offered his
 * own icons and nobody else's. The game of 2026-11-07 has 1053 such modifiers; Earthshaker's
 * Fissure alone has a dozen.
 *
 * Putting one on needs no compiler: the picked icon's compiled file is copied, byte for byte, to the
 * ability's own path, which is what the item builder does with a cosmetic's icon
 * (src/item-builder-assets.ts PICTURES), and over every picture a cosmetic would show for the
 * ability instead (`forcedFiles`), so the pick is what the HUD draws whatever the hero wears. */
import { blockBounds, eachChild } from './schema-kv.ts';
import { itemHeroes } from './item-builder-slots.ts';
import { entryAt, type VpkEntry } from './vpk.ts';

/** An icon's name as items_game writes a modifier: a path under spellicons, without the suffix. */
export const ICON_NAME = /^[a-z0-9_]+(?:\/[a-z0-9_]+){0,5}$/;

/** The compiled picture of an icon (an ability's own, or one a cosmetic shows instead). */
export const iconFile = (icon: string) => `panorama/images/spellicons/${icon}_png.vtex_c`;

/** One ability_icon modifier of the item table. */
export interface IconModifier { asset: string; modifier: string; style: number | null; at: number }

/** One icon the window offers for an ability: the picture, and the cosmetic or set it comes from. */
export interface IconChoice { icon: string; item: string; itemId: string; style: number | null; locKey?: string }

/** An ability the hero has a choice of icons for, with its choices in the table's order. */
export interface AbilityIcons { ability: string; choices: IconChoice[] }

const MODIFIER_BLOCK = /"type"\s+"ability_icon"/g;

/**
 * Every ability_icon modifier in the table, wherever it sits. The fields are read by key: one in
 * the game of 2026-11-07 (Wraith King's Frostivus Bone Guard) has "modifier" before "asset".
 */
export function iconModifiers(text: string): IconModifier[] {
  const out: IconModifier[] = [];
  for (const m of text.matchAll(MODIFIER_BLOCK)) {
    const open = text.lastIndexOf('{', m.index);
    const close = text.indexOf('}', m.index);
    if (open < 0 || close < 0) continue;
    const body = text.slice(open + 1, close);
    const field = (key: string) => new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(body)?.[1];
    const asset = field('asset')?.toLowerCase();
    const modifier = field('modifier')?.toLowerCase().replace(/\\/g, '/');
    const style = field('style');
    if (!asset || !modifier || !ICON_NAME.test(asset) || !ICON_NAME.test(modifier) || asset === modifier) continue;
    out.push({ asset, modifier, style: style != null && /^\d+$/.test(style) ? Number(style) : null, at: m.index });
  }
  return out;
}

/** "tine_of_the_behemoth_icons" as "Tine of the Behemoth": a shared set's name has no text of its own. */
export function setLabel(name: string): string {
  const words = name.replace(/_?ability_icons?$|_icons?$/i, '').split(/_+/).filter(Boolean);
  const small = new Set(['of', 'the', 'and', 'a', 'in', 'on']);
  return words.map((w, i) => (i && small.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ') || name;
}

/**
 * The entries of the table's asset_modifiers section, each a named set of modifiers that is not an
 * item and names no hero (Earthshaker's SLTV icons, Phantom Assassin's Ravening ones: 151 icon
 * modifiers on the game of 2026-11-07). An id of `set:<n>` keeps them apart from items.
 */
export function modifierSets(text: string): IconSource[] {
  const head = /\n\t"asset_modifiers"\s*\{/.exec(text);
  if (!head) return [];
  const [, sectionEnd] = blockBounds(text, head.index + head[0].length - 1);
  const out: IconSource[] = [];
  eachChild(text, [text.indexOf('{', head.index), sectionEnd], (c) => {
    if (!c.isBlock) return;
    const top = text.slice(c.body[0], Math.min(c.body[1], c.body[0] + 400));
    const name = /"name"\s+"([^"]+)"/.exec(top)?.[1] || c.key;
    const locKey = /"loc_key"\s+"#?([^"]+)"/.exec(top)?.[1];
    out.push({ id: `set:${c.key}`, name: setLabel(name), locKey, start: c.start, end: c.body[1], shared: true });
  });
  return out;
}

/** The item a position in the table falls in, among items sorted by start. */
function itemAt<T extends { start: number; end: number }>(items: T[], at: number): T | null {
  let lo = 0, hi = items.length - 1, hit: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start <= at) { hit = items[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return hit && at < hit.end ? hit : null;
}

/** An item of the table, or a set of its asset_modifiers section (`shared`), with where its block is. */
export interface IconSource {
  id: string; name: string; start: number; end: number;
  /** a set of the asset_modifiers section, not an item */
  shared?: boolean;
  /** a set's localization token, for its name in the game's words */
  locKey?: string;
}

/**
 * The icons a hero can pick for each ability, once each by picture, those whose picture the game has
 * and whose ability has an icon of its own to replace. They come from the items whose used_by_heroes
 * names him, and from the shared sets (`modifierSets`) for an ability in his script: a set names no
 * hero, so the ability is what makes it his. Abilities in `order` (his script's) come first, in that
 * order; any other his items name (a summon's) follow by name.
 * @param sources the table's items (src/schema-items.ts listItems) and its shared sets
 * @param has     whether pak01 holds a file
 */
export function heroIconChoices(text: string, sources: IconSource[], hero: string,
  order: string[], has: (file: string) => boolean, modifiers: IconModifier[] = iconModifiers(text)): AbilityIcons[] {
  const sorted = [...sources].sort((a, b) => a.start - b.start);
  const npc = `npc_dota_hero_${hero}`;
  const heroesOf = new Map<string, boolean>();
  const byAbility = new Map<string, IconChoice[]>();
  for (const mod of modifiers) {
    const item = itemAt(sorted, mod.at);
    if (!item) continue;
    let his = item.shared ? order.includes(mod.asset) : heroesOf.get(item.id);
    if (his === undefined) heroesOf.set(item.id, his = itemHeroes(text, item).includes(npc));
    if (!his) continue;
    const list = byAbility.get(mod.asset) ?? [];
    if (list.some((c) => c.icon === mod.modifier)) continue;
    list.push({ icon: mod.modifier, item: item.name || item.id, itemId: item.id, style: mod.style, ...(item.locKey ? { locKey: item.locKey } : {}) });
    byAbility.set(mod.asset, list);
  }
  const rank = (a: string) => (order.includes(a) ? order.indexOf(a) : order.length);
  return [...byAbility]
    .filter(([ability]) => has(iconFile(ability)))
    .map(([ability, choices]) => ({ ability, choices: choices.filter((c) => has(iconFile(c.icon))) }))
    .filter((a) => a.choices.length)
    .sort((a, b) => rank(a.ability) - rank(b.ability) || a.ability.localeCompare(b.ability));
}

/**
 * Every file a pick of `ability` has to cover: its own icon, and each picture a cosmetic swaps it to.
 * A cosmetic that is on (worn on the account, or picked in the item builder through the item table)
 * makes the HUD draw its own picture instead of the ability's: with Bracers of the Cavern Luminar on,
 * Enchant Totem is earthshaker/bracers_of_the_cavern_luminar/earthshaker_enchant_totem, and a pick
 * under the plain path alone was never seen (J0nathan550, 2026-11-07). The picked picture is left as
 * it is: it already is what it should show.
 */
export function forcedFiles(ability: string, icon: string, modifiers: IconModifier[]): string[] {
  const out = new Set([iconFile(ability)]);
  for (const m of modifiers) if (m.asset === ability && m.modifier !== icon) out.add(iconFile(m.modifier));
  return [...out];
}

/**
 * The pak's files: each picked icon's compiled picture under every path its ability can be drawn
 * from (`forcedFiles`), those the game has. A picture two abilities share (10 of 976 on the game
 * of 2026-11-07: Keeper's Illuminate and its Spirit Form one) goes to the pick that comes first in
 * `picks`. A pick the game has no file for any more (a Dota update took it) is left out and named
 * in `gone`.
 * @param has  whether the game has a file; a path nothing is drawn from is not worth a copy
 */
export function iconEntries(read: (file: string) => Buffer | null, picks: Record<string, string>,
  modifiers: IconModifier[] = [], has: (file: string) => boolean = () => true): { entries: VpkEntry[]; gone: string[] } {
  const taken = new Map<string, VpkEntry>();
  const gone: string[] = [];
  for (const [ability, icon] of Object.entries(picks)) {
    const data = ICON_NAME.test(ability) && ICON_NAME.test(icon) ? read(iconFile(icon)) : null;
    if (!data) { gone.push(ability); continue; }
    for (const file of forcedFiles(ability, icon, modifiers)) {
      if (!taken.has(file) && (file === iconFile(ability) || has(file))) taken.set(file, entryAt(file, data));
    }
  }
  return { entries: [...taken.values()], gone };
}
