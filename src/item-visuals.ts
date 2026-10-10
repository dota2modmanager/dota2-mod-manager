/**
 * What an item does to the game, read from its block in items_game ("visuals"), and what a mod
 * built from the game's own files has to do to show it on a hero who does not own the item: the
 * plan that src/arcana.ts carries out for Terrorblade's arcana (issue #118), worked out by hand
 * there, for any item.
 *
 * Each asset modifier is one change the item makes while it is worn. Some are files and can be
 * put under the plain names (a model, a particle, a picture); some only the item can switch on
 * (an activity modifier, which a model then needs taken off its animations, and a particle the
 * item creates, which needs a host); some live outside the files altogether (sounds, the kill
 * effect, voice lines) and a mod cannot give them.
 */
import { blockBounds, eachChild, type KvChild } from './schema-kv.ts';
import { findItem, itemFields, listItems, toUtf8 } from './schema-items.ts';

export interface AssetModifier { type: string; asset: string; modifier: string; style: string | null }

export interface ItemVisuals {
  id: string;
  name: string;
  slot: string;
  heroes: string[];
  /** the item's own model, worn in its slot */
  model: string;
  styles: string[];
  modifiers: AssetModifier[];
}

/** One thing a build from the game's files has to do, and whether this code does it. */
export interface PlanStep { what: string; how: string; done: 'built' | 'by hand' | 'cannot' }

const blockOf = (text: string, parent: KvChild | { body: [number, number] }, key: string) => {
  let hit: KvChild | null = null;
  eachChild(text, parent.body!, (c) => { if (!hit && c.isBlock && c.key.toLowerCase() === key) hit = c; });
  return hit as KvChild | null;
};

/** An item's visuals, by its id; null when the table has no such item. */
export function itemVisuals(text: string, id: string | number): ItemVisuals | null {
  const item = findItem(text, id);
  if (!item) return null;
  const fields = itemFields(text, item);
  const self = { body: blockBounds(text, item.start) as [number, number] };
  const heroes: string[] = [];
  const used = blockOf(text, self, 'used_by_heroes');
  if (used) eachChild(text, used.body!, (c) => { if (!c.isBlock && c.value === '1') heroes.push(c.key); });
  const modifiers: AssetModifier[] = [];
  const styles: string[] = [];
  const visuals = blockOf(text, self, 'visuals');
  if (visuals) {
    eachChild(text, visuals.body!, (c) => {
      if (!c.isBlock) return;
      if (/^asset_modifier\d*$/i.test(c.key)) {
        const f = new Map<string, string>();
        eachChild(text, c.body!, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value ?? ''); });
        modifiers.push({ type: f.get('type') ?? '', asset: f.get('asset') ?? '', modifier: f.get('modifier') ?? '', style: f.get('style') ?? null });
      } else if (c.key.toLowerCase() === 'styles') {
        eachChild(text, c.body!, (s) => {
          if (!s.isBlock) return;
          let name = '';
          eachChild(text, s.body!, (x) => { if (!x.isBlock && x.key.toLowerCase() === 'name') name = x.value ?? ''; });
          styles.push(name || s.key);
        });
      }
    });
  }
  return {
    id: item.id, name: toUtf8(fields.get('name') ?? ''), slot: fields.get('item_slot') ?? '', heroes,
    model: fields.get('model_player') ?? '', styles, modifiers,
  };
}

/** Items whose name has `query` in it (any case), or the one with that id. */
export function findItems(text: string, query: string): { id: string; name: string }[] {
  if (/^\d+$/.test(query)) return findItem(text, query) ? [{ id: query, name: itemVisuals(text, query)?.name ?? '' }] : [];
  const q = query.toLowerCase();
  return listItems(text).filter((i) => toUtf8(i.name).toLowerCase().includes(q)).map((i) => ({ id: i.id, name: toUtf8(i.name) }));
}

/** The free item of a hero's slot, whose model the item's own model takes the place of. */
export function defaultItem(text: string, hero: string, slot: string): { id: string; model: string } | null {
  for (const i of listItems(text)) {
    if (!i.baseitem || i.slot !== slot) continue;
    const v = itemVisuals(text, i.id);
    if (v?.heroes.includes(hero)) return { id: i.id, model: v.model };
  }
  return null;
}

const ONLY_THE_ITEM = new Set(['custom_kill_effect', 'response_criteria', 'chatwheel', 'arcana_level', 'persona', 'loading_screen', 'announcer']);

/** What a build from the game's files has to do for each of the item's changes. */
export function buildPlan(text: string, v: ItemVisuals): PlanStep[] {
  const out: PlanStep[] = [];
  for (const hero of v.heroes) {
    const plain = defaultItem(text, hero, v.slot);
    if (v.model && plain?.model) out.push({ what: `the item's own model, worn in its slot (${v.slot})`, how: `${v.model} under ${plain.model}`, done: 'built' });
  }
  for (const m of v.modifiers) {
    const at = m.style ? ` (style ${m.style})` : '';
    switch (m.type) {
      case 'entity_model': out.push({ what: `the hero's own model${at}`, how: `${m.modifier} under the hero's model path; its animations that need the item's activity modifier made the plain ones (asModel)`, done: 'built' }); break;
      case 'activity': out.push({ what: `activity modifier "${m.modifier}"${at}`, how: 'only the item switches it on: take it off the swapped model\'s animation clips (ANIM) and sequences (ASEQ), asModel; the game picks by the clips', done: 'built' }); break;
      case 'model': out.push({ what: `a model swap${at}`, how: `${m.modifier} under ${m.asset}`, done: 'by hand' }); break;
      case 'particle': out.push({ what: `a particle swap${at}`, how: `${m.modifier} under ${m.asset}; its children keep their own paths`, done: 'by hand' }); break;
      case 'particle_create': out.push({ what: `a particle the item creates${at}`, how: `${m.modifier}: no item creates it, so hang it as a child of a particle the hero always has, with a control point of its own on the attachment it is made for (withChildren)`, done: 'by hand' }); break;
      case 'sound': out.push({ what: `a sound${at}`, how: `${m.asset} plays ${m.modifier} instead: the item switches the event; a mod would put the new event's sound files under the old one's, not tried yet`, done: 'by hand' }); break;
      case 'ability_icon': case 'icon_replacement_hero': case 'icon_replacement_hero_minimap': out.push({ what: `a picture (${m.type})${at}`, how: `${m.modifier} under ${m.asset}, in panorama/images`, done: 'built' }); break;
      default: out.push(ONLY_THE_ITEM.has(m.type)
        ? { what: `${m.type}${at}`, how: 'comes with the item itself, outside the files: a mod cannot give it', done: 'cannot' }
        : { what: `${m.type}${at}`, how: `${m.asset} -> ${m.modifier}: not met before, look at it`, done: 'by hand' });
    }
  }
  return out;
}
