// Reading items_game.txt (src/schema.ts): the items section, one item's fields, the list the
// pickers show, the free item of a slot, and the game's own table out of its pak01. Text is latin1,
// byte for byte, so a block found here can be spliced back without re-encoding.
import fs from 'node:fs';
import path from 'node:path';
import { readVpkEntryFile } from './vpk.ts';
import { t } from './i18n.ts';
import { blockBounds, eachChild, eachChildSteps, type Bounds } from './schema-kv.ts';
import { drain, PAUSE } from './steps.ts';

/** An item of items_game as the pickers read it; see listItems. */
export interface SchemaItem {
  id: string; name: string; slot: string; prefab: string; itemName: string; itemDescription: string;
  image: string; model: string; typeName: string;
  /** the free item of its slot that every account owns */
  baseitem: boolean;
  hasVisuals: boolean;
  bundleItems: string[];
  /** where its block starts and ends in the table, for a byte-exact splice */
  start: number; end: number;
}


/** The game's own table, and the marker that changes when an update replaces it. */
export interface GameSchema { text: string; stamp: string }


/** Where the item table sits inside a VPK. */
export const SCHEMA_REL = 'scripts/items/items_game.txt';

// The "items" section of items_game.txt (all item definitions live directly under it).
export function itemsSection(text: string): Bounds {
  return drain(itemsSectionSteps(text));
}

/** itemsSection, a pause after each of the table's sections: finding their ends is a walk of 50 MB. */
function* itemsSectionSteps(text: string): Generator<typeof PAUSE, Bounds> {
  const root = blockBounds(text, 0);
  yield PAUSE;
  // set from inside the walk, which is why it is widened by hand
  let found = null as Bounds | null;
  yield* eachChildSteps(text, root, (c) => {
    if (!found && c.isBlock && c.key.toLowerCase() === 'items') found = c.body;
  }, 1);
  if (!found) throw new Error(t('items_game: секция items не найдена'));
  return found;
}

/**
 * One item definition, by id. Returns the exact source range so a splice is byte-exact.
 */
export function findItem(text: string, id: string | number, section?: Bounds | null): { id: string; start: number; end: number; text: string } | null {
  // The parsed list already knows where every item begins and ends, and callers that hand in
  // no section are asking about the whole table - which is the one that is usually warm.
  // Walking all 25 000 children instead cost about 200 ms a call, and dressing one cosmetic
  // slot makes two of them.
  if (!section) {
    const item = itemsById(text).get(String(id));
    if (item) return { id: item.id, start: item.start, end: item.end, text: text.slice(item.start, item.end) };
  }
  // A named section, or an id the item list does not carry (it keeps numbered items only).
  const bounds = section || itemsSection(text);
  let hit = null as { id: string; start: number; end: number; text: string } | null;
  eachChild(text, bounds, (c) => {
    if (!hit && c.isBlock && c.key === String(id)) {
      hit = { id: c.key, start: c.start, end: c.end, text: text.slice(c.start, c.end) };
    }
  });
  return hit;
}

/** Direct scalar fields of an item block ("name", "prefab", "item_slot"...). */
export function itemFields(text: string, item: { start: number }): Map<string, string> {
  const out = new Map<string, string>();
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock) out.set(c.key.toLowerCase(), c.value);
  });
  return out;
}

/**
 * Every item in the schema, as light records. Used for the free-cosmetics picker
 * (weather / terrain / HUD / killstreak...) which is generated from the live schema
 * rather than hardcoded, so anything Valve adds later shows up on its own.
 */
// Walking 25k item blocks costs ~300 ms, and a rebuild asks for the list several times
// over the same string, so keep the last result around.
/* Two tables, not one.
 *
 * Every rebuild walks the game's own table and then the merged one, and they alternate:
 * patches() reads vanilla, validateSchema reads merged and then vanilla again to compare the
 * counts. With room for a single answer each of those evicted the last, so one rebuild paid
 * for the walk three times over - about 350 ms each on the real 48.5 MB table, and it is
 * exactly the wait somebody feels when they remove a mod that carries item blocks.
 *
 * Two is the number the work actually alternates between; a third would only hold a table
 * nothing is going to ask for again. */
const ITEMS_CACHE_SIZE = 2;
let itemsCache: { text: string; list: SchemaItem[]; byId?: Map<string, SchemaItem> }[] = [];

/**
 * How many items listItems would list, without reading what each one says: all a check of a built
 * table (validateSchema) asks, and a third of the walk.
 */
export function countItems(text: string): number {
  return drain(countItemsSteps(text));
}

/** countItems, a pause every few thousand items (validateSchemaSteps). */
export function* countItemsSteps(text: string): Generator<typeof PAUSE, number> {
  const hit = itemsCache.find((e) => e.text === text);
  if (hit) return hit.list.length;
  let n = 0;
  const section = yield* itemsSectionSteps(text);
  yield* eachChildSteps(text, section, (c) => { if (c.isBlock && /^\d+$/.test(c.key)) n++; }, 4000);
  return n;
}

/** listItems by id, the first of an id winning as in the list; made once per table. */
function itemsById(text: string): Map<string, SchemaItem> {
  const list = listItems(text);
  const entry = itemsCache.find((e) => e.list === list)!;
  if (!entry.byId) {
    entry.byId = new Map();
    for (const item of list) if (!entry.byId.has(item.id)) entry.byId.set(item.id, item);
  }
  return entry.byId;
}

export function listItems(text: string): SchemaItem[] {
  return drain(listItemsSteps(text));
}

/** listItems, a pause every thousand items: the first list of a table is 300 ms of walking. */
export function* listItemsSteps(text: string): Generator<typeof PAUSE, SchemaItem[]> {
  const hit = itemsCache.find((e) => e.text === text);
  if (hit) return hit.list;
  const section = yield* itemsSectionSteps(text);
  const out: SchemaItem[] = [];
  yield* eachChildSteps(text, section, (c) => {
    if (!c.isBlock || !/^\d+$/.test(c.key)) return;
    const fields = new Map<string, string>();
    let hasVisuals = false;
    const bundleItems: string[] = [];
    eachChild(text, c.body, (f) => {
      if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value);
      else if (f.key.toLowerCase() === 'visuals') hasVisuals = true;
      else if (f.key.toLowerCase() === 'bundle') {
        eachChild(text, f.body, (bundleItem) => {
          if (!bundleItem.isBlock && bundleItem.value === '1') {
            bundleItems.push(bundleItem.key);
          }
        });
      }
    });
    out.push({
      id: c.key,
      name: fields.get('name') || '',
      slot: fields.get('item_slot') || '',
      prefab: fields.get('prefab') || '',
      itemName: fields.get('item_name') || '',
      itemDescription: fields.get('item_description') || '',
      image: fields.get('image_inventory') || '',
      model: fields.get('model_player') || '',
      typeName: fields.get('item_type_name') || '',
      baseitem: fields.get('baseitem') === '1',
      hasVisuals,
      bundleItems,
      start: c.start,
      end: c.end,
    });
  }, 1000);
  // somebody who could not wait listed it in the meantime: theirs is the one kept
  const meanwhile = itemsCache.find((e) => e.text === text);
  if (meanwhile) return meanwhile.list;
  itemsCache.unshift({ text, list: out });
  itemsCache.length = Math.min(itemsCache.length, ITEMS_CACHE_SIZE);
  return out;
}

// The table is read as latin1 so every splice stays byte-exact, which leaves names with
// non-ASCII characters (curly quotes, accents) as raw UTF-8 bytes. Anything shown to a
// person goes back through UTF-8 first.
/** A name out of the latin1 table, as the person should read it. */
export function toUtf8(s: string): string {
  return /[\x80-\xff]/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s;
}

/** An item's words in one lowercase string, for telling an arcana or persona by its name. */
export function itemSearchText(item: Partial<SchemaItem> | null | undefined): string {
  return [item?.slot, item?.prefab, item?.name, item?.itemName, item?.itemDescription, item?.image, item?.model, item?.typeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * A hero item's slot as the game reads it. A wearable or stock item that names no item_slot is
 * a weapon: the "wearable" and "default_item" prefabs of items_game both say "item_slot"
 * "weapon", and on the game of 2026-09-24 that covers 1857 wearables and 96 stock items.
 *
 * It used to be guessed from the item's words, which put Oblivion Headmaster Wand on the head,
 * Emerald Frenzy Flail on the back and 99 other weapons nowhere, so a set carried two heads
 * and the builder offered a wand for a helmet.
 */
export function inferredItemSlot(item: Partial<SchemaItem> | null | undefined): string {
  if (item?.slot) return item.slot;
  return item?.prefab === 'wearable' || item?.prefab === 'default_item' ? 'weapon' : '';
}

// Which slot an item belongs to. Wearables say it outright; the whole-match cosmetics
// (weather, terrain, HUD...) leave item_slot out and only name their prefab. No guessing here:
// the guess moved 22 loading screens, their default among them, into "back" (2026-09-24).
function slotOf(item: SchemaItem): string {
  return item.slot || item.prefab || '';
}

/**
 * The free "base item" of a slot - the one every account owns (555 Default Weather,
 * 590 Default Terrain, ...). Dressing it in another item's visuals is what makes a paid
 * cosmetic the default one.
 */
export function baseItemFor(text: string, slot: string | null | undefined): SchemaItem | null {
  return listItems(text).find((i) => i.baseitem && slotOf(i) === slot) || null;
}

/**
 * What can be put on that base item, read straight out of the installed game: anything Valve
 * adds to the schema later shows up on its own, without an app update.
 * @returns name is the schema's own English name, sorted A-Z
 */
export function cosmeticOptions(text: string, slot: string): { id: string; name: string }[] {
  return listItems(text)
    .filter((i) => slotOf(i) === slot && !i.baseitem && i.hasVisuals && i.name)
    .map((i) => ({ id: i.id, name: toUtf8(i.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pull scripts/items/items_game.txt out of the game's pak01. This is the base every
 * build starts from, so a game update simply means a rebuild, never a stale schema.
 * @param gamePath  ...\dota 2 beta\game
 * @returns stamp = version marker of the base file
 */
export function readGameSchema(gamePath: string): GameSchema {
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak)) throw new Error(t('Не найден {0}', pak));
  let key: string | null = null;
  try { key = `${gamePath}|${pakFiles(gamePath, (st) => `${st.size}:${st.mtimeMs}:${st.ino}`)}`; } catch { /* read it anew */ }
  if (key && lastRead?.key === key) return lastRead.schema;
  const hit = readVpkEntryFile(pak, SCHEMA_REL);
  if (!hit) throw new Error(t('items_game.txt не найден в pak01 игры'));
  const schema = { text: hit.data.toString('latin1'), stamp: `${hit.data.length}:${hit.crc >>> 0}` };
  lastRead = key ? { key, schema } : null;
  return schema;
}

/* The table as it was last read, for as long as the game's paks are the files it was read from.
 *
 * The item builder, the game's pictures and the mod identifier each read the table, and each held
 * a copy of its own: 50 MB apiece, and worse, three strings with the same text. A string has no
 * identity in JavaScript, so finding one table's list of items (listItems) in a cache that held
 * another copy compared all 50 MB of them, and the item builder looks an item up a dozen times a
 * pick: 60 ms a pick, two seconds for thirty, spent proving that a table equals itself. One read,
 * one string, and the comparison is the engine seeing the same string twice. */
let lastRead: { key: string; schema: GameSchema } | null = null;

/** Each of the game's pak01 files, as `describe` puts its stat, in name order. */
function pakFiles(gamePath: string, describe: (st: fs.Stats) => string): string {
  const dir = path.join(gamePath, 'dota');
  const parts: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^pak01_(dir|\d{3})\.vpk$/i.test(f)) continue;
    parts.push(`${f}:${describe(fs.statSync(path.join(dir, f)))}`);
  }
  return parts.sort().join('|');
}

/** Cheap "did the game update?" probe: size+mtime of the paks that carry the schema. */
export function gameSchemaStamp(gamePath: string): string {
  return pakFiles(gamePath, (st) => `${st.size}:${Math.floor(st.mtimeMs)}`);
}
