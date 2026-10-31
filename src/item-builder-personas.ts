/* Personas in the item builder: a hero's second look, with slots and items of its own.
 *
 * A persona is an item in the hero's persona_selector slot whose visuals switch the hero to a
 * second loadout: the Toy Butcher wears weapon_persona_1, armor_persona_1 and the rest, slots of
 * their own, each with a stock item every account has. The builder cannot switch loadouts the way
 * the paid item does: what a match loads is the server's own table, and that keeps the plain hero.
 * So a persona goes on the way an arcana does (src/arcana-bases.ts): its body, compiled again by
 * J0nathan550, under the plain hero's model path, with an empty model at each of the plain hero's
 * slots. Its own items go under those slots' paths. Each of its slots is given one of the plain
 * hero's (personaLayouts), and wears the game's own item for it until something is picked there.
 *
 * With a persona on, the hero wears its items and nothing else (J0nathan550, 2026-10-23): a plain
 * item hangs off the persona's body where the persona has nothing, and Valve drew the persona's
 * own for it. The window shows that hero's persona slots alone, a pick of a persona switches the
 * hero's plain picks off (src/schema-cosmetics.ts), and the build leaves out any that are left on,
 * from a preset say (personaRecords). Arcanas have no such rule: their heroes wear anything.
 */
import { listItems, inferredItemSlot, toUtf8, type SchemaItem } from './schema.ts';
import { ARCANA_BASES, type ReadyBase } from './arcana-bases.ts';
import {
  canonicalItemSlot, itemHeroes, matchItemSlot, itemSlotId, itemSlotIcon, itemSlotLabel, slotDisplayLabel, type ItemSlot,
} from './item-builder-slots.ts';
import { heroDisplayName } from './hero-names.ts';
import { entryPath, type VpkEntry } from './vpk.ts';
import { heroModelPath } from './item-builder-assets.ts';
import { modelScaleAgainst } from './model-scale.ts';
import type { LibRecord } from './types.ts';

/** The slot a persona is picked in. */
export const SELECTOR = 'persona_selector';
/** A persona's own slot: weapon_persona_1 is the first persona's weapon. */
const OWN = /^(.+)_persona_(\d+)$/;
/** Persona slots nothing is put under: a pet and a voice are no part of the body. */
const UNWORN = new Set(['summon', 'voice']);
/** Plain slots no persona item goes under: the persona's own, a pet, a voice, an arcana's and a costume's. */
const NOT_HOSTS = new Set([SELECTOR, 'summon', 'voice', 'hero_base', 'costume']);
/** The order a persona slot with no plain slot of its name takes what is left. */
const HOST_ORDER = ['head', 'body_head', 'hair', 'neck', 'shoulder', 'arms', 'back', 'weapon', 'offhand_weapon', 'armor', 'belt', 'legs', 'mount', 'misc'];

/** The personas the builder offers: the ones with a base. */
export const PERSONA_BASES = ARCANA_BASES.filter((b) => b.persona);

/** One of a persona's slots: the plain stock item it is worn under, the game's own item for it, and the paid ones. */
export interface PersonaPart { slot: string; host: SchemaItem; given: SchemaItem | null; options: SchemaItem[] }

/** A hero's persona as the builder puts it on. */
export interface PersonaLayout { hero: string; selector: SchemaItem; personas: SchemaItem[]; parts: PersonaPart[] }

const slotOf = (item: SchemaItem) => canonicalItemSlot(inferredItemSlot(item));
const rank = (slot: string) => { const at = HOST_ORDER.indexOf(slot); return at === -1 ? HOST_ORDER.length : at; };

/** The persona number an item switches to, from its "persona" modifier; the first when it says none. */
function personaNumber(text: string, item: SchemaItem): string {
  return /"type"\s+"persona"\s+"persona"\s+"(\d+)"/.exec(text.slice(item.start, item.end))?.[1] || '1';
}

/**
 * Which plain slot each persona slot goes under: the one of its name, else the one of its kind
 * (offhand is offhand_weapon), else a plain slot with a model nobody took, else one without. The
 * persona's base blanks every plain slot, so which one an armour or a tail takes does not show.
 * Morphling's plain slots have no models at all, so his persona's neck shows until a reconnect
 * (arcana-notes.ts UNTIL_RECONNECT). A slot with no model and no plain slot of its kind is left off.
 */
function layoutOf(text: string, hero: string, items: SchemaItem[]): PersonaLayout | null {
  const personas = PERSONA_BASES.filter((b) => b.hero === hero).map((b) => items.find((i) => i.id === b.item)).filter((i): i is SchemaItem => !!i);
  const selector = items.find((i) => i.prefab === 'default_item' && slotOf(i) === SELECTOR);
  if (!personas.length || !selector) return null;
  const n = personaNumber(text, personas[0]);
  const own = new Map<string, { given: SchemaItem | null; options: SchemaItem[] }>();
  for (const i of items) {
    const m = OWN.exec(slotOf(i));
    if (!m || m[2] !== n || UNWORN.has(m[1])) continue;
    const at = own.get(m[0]) || { given: null, options: [] };
    own.set(m[0], at);
    if (i.prefab === 'default_item') at.given ??= i;
    else if (i.name) at.options.push(i);
  }
  const free = items.filter((i) => i.prefab === 'default_item' && !OWN.test(slotOf(i)) && !NOT_HOSTS.has(slotOf(i)))
    .sort((a, b) => rank(slotOf(a)) - rank(slotOf(b)) || Number(a.id) - Number(b.id));
  const take = (fits: (host: SchemaItem) => boolean) => { const at = free.findIndex(fits); return at === -1 ? null : free.splice(at, 1)[0]; };
  const slots = [...own.keys()].sort((a, b) => rank(OWN.exec(a)![1]) - rank(OWN.exec(b)![1]));
  const hosts = new Map<string, SchemaItem>();
  const passes: ((slot: string) => (host: SchemaItem) => boolean)[] = [
    (slot) => (host) => slotOf(host) === OWN.exec(slot)![1],
    (slot) => (host) => matchItemSlot(slotOf(host)) === matchItemSlot(OWN.exec(slot)![1]),
    (slot) => (host) => modelled(own.get(slot)!) && !!host.model,
    (slot) => () => modelled(own.get(slot)!),
  ];
  for (const pass of passes) {
    for (const slot of slots) {
      if (hosts.has(slot)) continue;
      const host = take(pass(slot));
      if (host) hosts.set(slot, host);
    }
  }
  const parts = slots.filter((s) => hosts.has(s)).map((slot) => ({ slot, host: hosts.get(slot)!, ...own.get(slot)! }));
  return { hero, selector, personas, parts };
}

const modelled = (part: { given: SchemaItem | null; options: SchemaItem[] }) => !!part.given?.model || part.options.some((o) => o.model);

let cached: { text: string; layouts: Map<string, PersonaLayout> } | null = null;

/** Each hero with a persona the builder offers, and how it is put on. Kept while the game's table is the same. */
export function personaLayouts(text: string): Map<string, PersonaLayout> {
  if (cached?.text === text) return cached.layouts;
  const heroes = new Set(PERSONA_BASES.map((b) => b.hero));
  const byHero = new Map<string, SchemaItem[]>();
  for (const item of listItems(text)) {
    if (item.prefab !== 'default_item' && item.prefab !== 'wearable') continue;
    const ids = itemHeroes(text, item);
    const hero = ids.length === 1 ? ids[0].replace(/^npc_dota_hero_/, '') : '';
    if (heroes.has(hero)) byHero.set(hero, [...(byHero.get(hero) || []), item]);
  }
  const layouts = new Map<string, PersonaLayout>();
  for (const [hero, items] of byHero) {
    const layout = layoutOf(text, hero, items);
    if (layout) layouts.set(hero, layout);
  }
  cached = { text, layouts };
  return layouts;
}

/** Each persona with a base, a slot to pick it in, and a slot for each of its own (src/item-builder-personas.ts). */
export function personaSlots(text: string): ItemSlot[] {
  return [...personaLayouts(text).values()].flatMap(({ hero, selector, personas, parts }) => [
    { slot: SELECTOR, target: selector, options: personas, part: false },
    ...parts.map((p) => ({ slot: p.slot, target: p.host, options: p.options, part: true })),
  ].map(({ slot, target, options, part }) => {
    const plain = slot.replace(/_persona_\d+$/, '');
    return {
      slot: itemSlotId([hero], slot), kind: 'item-effect' as const, base: target.id, targetId: target.id, equipSlot: slot, heroIds: [hero],
      heroLabel: heroDisplayName(hero), slotLabel: slotDisplayLabel(plain), label: itemSlotLabel([hero], plain), icon: itemSlotIcon(plain),
      options: options.map((o) => ({ id: o.id, name: toUtf8(o.name) })), persona: { hero, part },
    };
  }));
}

/** A builder pick's heroes and slot, out of its slot id (item:<heroes>:<slot>); null for anything else. */
function pickSlot(rec: Pick<LibRecord, 'categoryId' | 'slot'>): { heroes: string[]; slot: string } | null {
  const m = rec.categoryId === 'cosmetic' ? /^item:([^:]+):(.+)$/.exec(String(rec.slot || '')) : null;
  return m ? { heroes: m[1].split('+'), slot: m[2] } : null;
}

/** Whether a slot id is a hero's persona slot, where a persona is picked. */
export const isSelectorSlot = (slot: string | undefined): boolean => String(slot || '').endsWith(`:${SELECTOR}`);

/** The heroes with a persona on, each with the persona's item: an enabled pick of one the builder offers. */
export function personasOn(records: LibRecord[]): Map<string, string> {
  const on = new Map<string, string>();
  for (const rec of records) {
    const at = rec.enabled !== false ? pickSlot(rec) : null;
    if (!at || at.slot !== SELECTOR) continue;
    const base = PERSONA_BASES.find((b) => b.item === String(rec.itemId) && at.heroes.includes(b.hero));
    if (base) on.set(base.hero, base.item);
  }
  return on;
}

const PLAIN = 'the hero has a persona on';

/** Why a pick stays out of the build while these personas are on; null when it goes in. */
export function leftOut(rec: LibRecord, on: Map<string, string>): string | null {
  const at = pickSlot(rec);
  if (!at || at.slot === SELECTOR) return null;
  const mine = at.heroes.some((h) => on.has(h));
  if (OWN.test(at.slot)) return mine ? null : 'its persona is not on';
  return mine ? PLAIN : null;
}

/** The enabled plain picks of the heroes with a persona on: a pick of the persona switches them off. */
export function displaced(records: LibRecord[]): LibRecord[] {
  const on = personasOn(records);
  return on.size ? records.filter((r) => r.enabled !== false && leftOut(r, on) === PLAIN) : [];
}

/** A record as the build takes it: a persona's with the stock item it is written over. */
export type BuildRecord = LibRecord & {
  persona?: { target: string; host: string | null; given: boolean };
};

const compiled = (model: string) => {
  const p = model.toLowerCase().replace(/\\/g, '/');
  return p.endsWith('_c') ? p : `${p}_c`;
};

/**
 * The enabled records a build takes, personas sorted out: a pick that cannot be worn with the
 * personas on is left out, with why; a persona's pick names the stock item it goes over; and
 * each slot of a persona on with nothing picked wears the game's own item for it.
 */
export function personaRecords(records: LibRecord[], text: string): { records: BuildRecord[]; left: { rec: LibRecord; why: string }[] } {
  const on = personasOn(records);
  const layouts = on.size ? personaLayouts(text) : new Map<string, PersonaLayout>();
  const out: BuildRecord[] = [];
  const left: { rec: LibRecord; why: string }[] = [];
  const picked = new Set<string>();
  for (const rec of records) {
    const why = leftOut(rec, on);
    if (why) { left.push({ rec, why }); continue; }
    const at = pickSlot(rec);
    const layout = at ? at.heroes.map((h) => layouts.get(h)).find(Boolean) : undefined;
    if (!at || !layout || !(at.slot === SELECTOR || OWN.test(at.slot))) { out.push(rec); continue; }
    if (at.slot === SELECTOR) { out.push({ ...rec, persona: { target: layout.selector.id, host: null, given: false } }); continue; }
    const part = layout.parts.find((p) => p.slot === at.slot);
    if (!part) { left.push({ rec, why: 'its persona has no such slot' }); continue; }
    picked.add(`${layout.hero}:${part.slot}`);
    out.push({ ...rec, persona: { target: part.host.id, host: part.host.model ? compiled(part.host.model) : null, given: false } });
  }
  for (const hero of on.keys()) {
    const layout = layouts.get(hero);
    for (const part of layout?.parts || []) {
      if (!part.given || picked.has(`${hero}:${part.slot}`)) continue;
      out.push({
        id: `persona:${hero}:${part.slot}`, name: toUtf8(part.given.name), categoryId: 'cosmetic', files: [], enabled: true,
        slot: `item:${hero}:${part.slot}`, itemId: part.given.id,
        persona: { target: part.host.id, host: part.host.model ? compiled(part.host.model) : null, given: true },
      });
    }
  }
  return { records: out, left };
}

/** A base's file at a path is an empty model: what a persona's base puts at the plain hero's slots (2 KB). */
const emptyAt = (base: ReadyBase, path: string) => {
  const e = base.entries.find((x) => entryPath(x).toLowerCase() === path);
  return !!e && path.endsWith('.vmdl_c') && e.data.length < 8192;
};

/**
 * A persona slot's files over the persona's base. The base wins wherever it has a file, its
 * particles rebuilt to fit the body, except at the slot's own model: there a pick wins, and the
 * game's own item wins over an empty model but not over one rebuilt by hand (Mirana's mount).
 */
export function personaAssets(rec: BuildRecord, assets: VpkEntry[], ready: ReadyBase[]): VpkEntry[] {
  const at = pickSlot(rec);
  const base = at && ready.find((r) => r.base.persona && at.heroes.includes(r.base.hero));
  if (!base || !rec.persona) return assets;
  const { host, given } = rec.persona;
  return assets.filter((e) => {
    const p = entryPath(e).toLowerCase();
    return !base.paths.has(p) || (p === host && (!given || emptyAt(base, p)));
  });
}

/** A hero script's persona model: the "Model" of its Persona block, which the game keeps for its tools. */
const PERSONA_MODEL = /"Persona"[\s\S]*?"Model"\s+"([^"]+)"/;

/**
 * How much bigger each persona's base body is than Valve's persona model, for each hero with a
 * persona on whose base is here: what its items are made bigger by (src/model-scale.ts). The
 * server draws the persona at the plain hero's scale, and a body compiled bigger to make up for it
 * needs its items as big. Measured, not written down, so the items follow whatever the bases'
 * repository publishes: a body compiled as Valve's measures 1, and nothing is scaled.
 * @param read  a file of the game's pak01: the hero's script and Valve's persona model
 */
export function personaScales(on: Map<string, string>, ready: ReadyBase[], read: (path: string) => Buffer | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const hero of on.keys()) {
    const base = ready.find((r) => r.base.persona && r.base.hero === hero);
    const script = read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`)?.toString('latin1');
    const valve = script && PERSONA_MODEL.exec(script)?.[1];
    if (!base || !script || !valve) continue;
    try {
      const body = base.entries.find((e) => entryPath(e).toLowerCase() === compiled(heroModelPath({ read }, `npc_dota_hero_${hero}`)));
      const reference = read(compiled(valve));
      const scale = body && reference ? modelScaleAgainst(body.data, reference) : null;
      // a body compiled as Valve's measures 1 to within a thousandth
      if (scale && Math.abs(scale - 1) > 0.01) out.set(hero, Math.round(scale * 1000) / 1000);
    } catch { /* a body or a script that does not read: its items as they are */ }
  }
  return out;
}

/** What a pick's models are made bigger by: a persona's own slot's, while its body is bigger (personaScales). */
export function personaScaleOf(rec: BuildRecord, scales: Map<string, number>): number | undefined {
  const at = pickSlot(rec);
  return rec.persona && at && at.slot !== SELECTOR ? at.heroes.map((h) => scales.get(h)).find(Boolean) : undefined;
}
