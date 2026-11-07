/* An item's ability effects without its model, as the game's loadout wears them.
 *
 * Every hero has hidden loadout slots, ability_effects_1 to ability_effects_9, one per ability
 * that has effects to change: the hero's script names the ability of each (Earthshaker's
 * ability_effects_2 is earthshaker_enchant_totem). An item that can go in one says so in its
 * static attributes, `"can_equip_as_ability_effects" "2"`, once for each slot it fits, and marks
 * the modifiers that slot takes, `"apply_when_equipped_in_ability_effects_slot" "2"`. Worn there,
 * the item gives those modifiers and nothing else: Bracers of the Cavern Luminar's Enchant Totem
 * on the Intergalactic Orbliterator's arms. Totem of Deep Magma fits all four of Earthshaker's.
 *
 * The slot's stock item is one for all heroes, "All Heroes' Default Ability Effects 2", with no
 * model and no visuals. A pick writes the marked modifiers into it (src/item-builder-fx-patch.ts),
 * so the picks of every hero in slot 2 share one block: mergeFxPatches joins them. Their
 * particles, icons and sounds go under the plain paths as any pick's do (src/item-builder-assets.ts),
 * ahead of the other picks', as the slot wins over the item worn in the game.
 *
 * The persona slots (ability_effects_1_persona_1) and the shared asset_modifiers sets, which the
 * game hands out per account and no item names, are not offered.
 */
import { t } from './i18n.ts';
import { blockBounds, eachChild, inferredItemSlot, toUtf8, type SchemaItem } from './schema.ts';
import { withModifiers } from './item-builder-donor.ts';
import { itemFacts } from './item-builder-details.ts';
import { styleTokens } from './item-builder-styles.ts';
import { localizationTokens } from './cosmetic-names.ts';
import type { SchemaPatch } from './schema-merge.ts';
import type { ItemSlot } from './item-builder-slots.ts';

/** A hero's ability effects slot, by its name in the table. */
export const FX_SLOT = /^ability_effects_(\d+)$/;

/** The number of an ability effects slot, from its name or a builder slot's id (item:earthshaker:ability_effects_2); 0 for any other. */
export function fxSlotOf(slot: unknown): number {
  const name = String(slot || '').toLowerCase().split(':').pop() || '';
  return Number(FX_SLOT.exec(name)?.[1] || 0);
}

const TAG = 'apply_when_equipped_in_ability_effects_slot';

/** The slots an item block says it can be worn in as ability effects, in either form the table writes the attribute. */
export function fxSlotsOf(block: string): number[] {
  const out = new Set<number>();
  for (const m of block.matchAll(/"can_equip_as_ability_effects"\s*(?:"(\d+)"|\{[^}]*?"value"\s*"(\d+)")/gi)) out.add(Number(m[1] || m[2]));
  return [...out].filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * The visuals with only the modifiers ability effects slot `n` takes, in the first style. The pick
 * is made the first style first (src/item-builder-styles.ts withStyle), so a style of 0, of none,
 * or Valve's "default" on Totem of Deep Magma, is the one worn; its mark goes, as the stock item
 * has no styles to choose from.
 */
export function fxVisuals(visuals: string, n: number): string {
  const kept: string[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
    const f = new Map<string, string>();
    eachChild(visuals, c.body, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value); });
    if (Number(f.get(TAG)) !== n || (Number(f.get('style')) || 0) !== 0) return;
    kept.push(visuals.slice(c.start, c.end).replace(/^"asset_modifier\d*"/i, '"asset_modifier"').replace(/\s*"style"\s+"[^"]*"/i, ''));
  });
  return withModifiers('"visuals"\r\n{\r\n}', kept);
}

/** Whether a visuals block has a modifier left in it. */
export const hasModifiers = (visuals: string): boolean => /"asset_modifier\d*"/i.test(visuals);

/** The stock item of ability effects slot `n`: the one for all heroes, with no persona in its slot. */
export function fxTarget(items: SchemaItem[], n: number): SchemaItem | null {
  return items.find((i) => i.prefab === 'default_item' && inferredItemSlot(i).toLowerCase() === `ability_effects_${n}`) || null;
}

/** A slot's name for an ability effects slot, before the hero's script names its ability (src/schema-cosmetics.ts). */
export const fxSlotLabel = (n: number): string => t('Эффекты способности {0}', n);

/** A slot's name once its ability is known: "Эффекты: Enchant Totem". */
export const fxAbilityLabel = (ability: string): string => t('Эффекты: {0}', ability);

/**
 * The builder's ability effects slots: one for each hero and slot some item of his fits, with the
 * items that fit it. Whether the hero has that slot is his script's to say (src/schema-cosmetics.ts).
 * @param slotOf  the builder's slot fields for a hero and a slot name (src/item-builder-slots.ts)
 * @param heroesOf  an item's heroes, npc_dota_hero_*
 */
export function fxSlots(text: string, items: SchemaItem[], heroesOf: (item: SchemaItem) => string[],
  slotOf: (hero: string, equipSlot: string, targetId: string) => ItemSlot): ItemSlot[] {
  const slots = new Map<string, ItemSlot>();
  const targets = new Map<number, SchemaItem | null>();
  for (const item of items) {
    if (item.prefab !== 'wearable' || !item.name) continue;
    const block = text.slice(item.start, item.end);
    if (!block.includes('can_equip_as_ability_effects')) continue;
    for (const n of fxSlotsOf(block)) {
      // an item that names the slot and gives it nothing would be a pick that does nothing
      if (!new RegExp(`"${TAG}"\\s*"${n}"`).test(block)) continue;
      if (!targets.has(n)) targets.set(n, fxTarget(items, n));
      const target = targets.get(n);
      if (!target) continue;
      const styles = block.includes('"styles"') ? styleTokens(visualsOf(block)) : [];
      for (const hero of heroesOf(item)) {
        const made = slotOf(hero, `ability_effects_${n}`, target.id);
        let at = slots.get(made.slot);
        if (!at) slots.set(made.slot, at = { ...made, abilityFx: n });
        at.options.push({ id: item.id, name: toUtf8(item.name), ...itemFacts(block), ...(styles.length ? { styles } : {}) });
      }
    }
  }
  return [...slots.values()];
}

const LANG_FILE: Record<string, string> = { ru: 'russian', en: 'english', 'zh-CN': 'schinese' };

/**
 * The ability effects slots named by their ability, as the hero's script and the game's text say
 * ("Эффекты: Enchant Totem"), and without those of a hero whose script has no such slot. Without
 * the game's files they keep their numbers.
 * @param read  a file of pak01
 * @param lang  the app's language
 */
export function namedFxSlots<S extends Pick<ItemSlot, 'abilityFx' | 'heroIds' | 'equipSlot' | 'slotLabel' | 'label' | 'heroLabel'>>(slots: S[], read: (file: string) => Buffer | null, lang: string): S[] {
  if (!slots.some((s) => s.abilityFx)) return slots;
  const abilityOf = new Map<string, Map<string, string> | null>();
  const abilities = (hero: string) => {
    if (!abilityOf.has(hero)) {
      const script = read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`)?.toString('utf8');
      abilityOf.set(hero, script == null ? null : new Map([...script.matchAll(/"SlotName"\s+"(ability_effects_\d+)"\s*"SlotText"\s+"([^"]+)"/gi)]
        .map((m) => [m[1].toLowerCase(), m[2]])));
    }
    return abilityOf.get(hero)!;
  };
  let words: Map<string, string> | null = null;
  const word = (ability: string) => {
    if (!words) {
      words = new Map();
      for (const language of new Set([LANG_FILE[lang] || 'english', 'english'])) {
        const data = read(`resource/localization/abilities_${language}.txt`);
        if (data) for (const [k, v] of localizationTokens(data)) if (!words.has(k)) words.set(k, v);
      }
    }
    return words.get(`dota_tooltip_ability_${ability.toLowerCase()}`) || null;
  };
  return slots.flatMap((s) => {
    const own = s.abilityFx && s.heroIds[0] ? abilities(s.heroIds[0]) : undefined;
    if (!own) return [s];
    const ability = own.get(s.equipSlot);
    if (!ability) return [];
    const name = word(ability);
    if (!name) return [s];
    const slotLabel = fxAbilityLabel(name);
    return [{ ...s, slotLabel, label: `${s.heroLabel} · ${slotLabel}` }];
  });
}

function visualsOf(block: string): string | null {
  let out: string | null = null;
  eachChild(block, blockBounds(block, 0), (c) => { if (!out && c.isBlock && c.key.toLowerCase() === 'visuals') out = block.slice(c.start, c.end); });
  return out;
}

/** The modifiers of a block's visuals, each as its text. */
function modifiersOf(block: string): string[] {
  const visuals = visualsOf(block);
  if (!visuals) return [];
  const out: string[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => { if (c.isBlock && /^asset_modifier\d*$/i.test(c.key)) out.push(visuals.slice(c.start, c.end)); });
  return out;
}

/**
 * The patches with each ability effects slot's picks joined into one: the first pick's block with
 * every other one's modifiers added, and all their files, the first pick's ahead. Two blocks of
 * one id would leave the last alone in the table (src/schema-merge.ts), and with it one hero's effects.
 * @param isFx  whether a patch is an ability effects pick
 */
export function mergeFxPatches(list: SchemaPatch[], isFx: (p: SchemaPatch) => boolean): SchemaPatch[] {
  const joined = new Map<string, SchemaPatch>();
  const out: SchemaPatch[] = [];
  for (const p of list) {
    if (!isFx(p)) { out.push(p); continue; }
    const had = joined.get(String(p.id));
    if (!had) { const first = { ...p, assets: [...(p.assets || [])] }; joined.set(String(p.id), first); out.push(first); continue; }
    const at = visualsOf(had.block);
    if (at) {
      const start = had.block.indexOf(at);
      had.block = had.block.slice(0, start) + withModifiers(at, modifiersOf(p.block)) + had.block.slice(start + at.length);
    }
    had.assets!.push(...(p.assets || []));
    had.source = `${had.source}, ${p.source}`;
  }
  return out;
}
