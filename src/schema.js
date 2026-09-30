// Item-schema engine: the game's own scripts/items/items_game.txt is the only place
// where a mod can attach new particles to a hero, redirect a stock effect, or turn a
// free "base item" (default weather / terrain / HUD...) into a paid one.
//
// Two rules shape everything here:
//   1. Only one items_game.txt may be live, so mods never ship theirs — we lift the
//      changed item blocks out of them and splice those into the game's CURRENT file.
//   2. The result is rebuilt from the installed game every time, so it can never go
//      stale the way a schema shipped inside a mod does.
//
// The file is ~50 MB of KeyValues with a few non-UTF8 bytes in it, so everything here
// works on latin1 strings: byte-exact in and out, no re-encoding surprises.
const fs = require('fs');
const path = require('path');
const { readVpkEntryFile, buildVpk, crc32 } = require('./vpk.ts');
const { t } = require('./i18n.ts');

const SCHEMA_REL = 'scripts/items/items_game.txt';
// Our folder is registered ahead of "dota", so the first pak in it wins the MOD path.
const SCHEMA_VPK = 'pak01_dir.vpk';

// ---------- KeyValues navigation (no full parse: 50 MB, and we only need blocks) ----------

// Skip whitespace and // line comments starting at i.
function skipGap(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return text.length;
      i = nl + 1;
      continue;
    }
    return i;
  }
}

// Read a token (quoted or bare) at i. Returns { value, start, next } or null at a closing brace.
function readToken(text, i) {
  i = skipGap(text, i);
  if (i >= text.length || text[i] === '}') return null;
  if (text[i] === '"') {
    const end = text.indexOf('"', i + 1);
    if (end === -1) throw new Error(t('items_game: незакрытая кавычка'));
    return { value: text.slice(i + 1, end), start: i, next: end + 1 };
  }
  let end = i;
  while (end < text.length && !/[\s{}"]/.test(text[end])) end++;
  return { value: text.slice(i, end), start: i, next: end };
}

/**
 * Bounds of the { ... } block that starts at (or after) i.
 * @returns {[number, number]} [open, close+1]
 */
function blockBounds(text, i) {
  const open = text.indexOf('{', i);
  if (open === -1) throw new Error(t('items_game: не найдено открытие блока'));
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    const c = text[k];
    if (c === '"') { const e = text.indexOf('"', k + 1); if (e === -1) break; k = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [open, k + 1]; }
  }
  throw new Error(t('items_game: незакрытый блок'));
}

/**
 * Walk the direct children of a block.
 * @param {string} text
 * @param {[number, number]} bounds  from blockBounds()
 * @param {(child: {key: string, start: number, end: number, isBlock: boolean, value: string|null, body: [number, number]|null}) => void} fn
 */
function eachChild(text, bounds, fn) {
  let i = bounds[0] + 1;
  const end = bounds[1] - 1;
  while (i < end) {
    const key = readToken(text, i);
    if (!key) break;
    const at = skipGap(text, key.next);
    if (text[at] === '{') {
      const b = blockBounds(text, at);
      fn({ key: key.value, start: key.start, end: b[1], isBlock: true, value: null, body: b });
      i = b[1];
    } else {
      const val = readToken(text, at);
      if (!val) break;
      fn({ key: key.value, start: key.start, end: val.next, isBlock: false, value: val.value, body: null });
      i = val.next;
    }
  }
}

// The "items" section of items_game.txt (all item definitions live directly under it).
function itemsSection(text) {
  const root = blockBounds(text, 0);
  let found = null;
  eachChild(text, root, (c) => {
    if (!found && c.isBlock && c.key.toLowerCase() === 'items') found = c.body;
  });
  if (!found) throw new Error(t('items_game: секция items не найдена'));
  return found;
}

/**
 * One item definition, by id. Returns the exact source range so a splice is byte-exact.
 * @returns {{ id: string, start: number, end: number, text: string } | null}
 */
function findItem(text, id, section) {
  // The parsed list already knows where every item begins and ends, and callers that hand in
  // no section are asking about the whole table - which is the one that is usually warm.
  // Walking all 25 000 children instead cost about 200 ms a call, and dressing one cosmetic
  // slot makes two of them.
  if (!section) {
    const want = String(id);
    const item = listItems(text).find((i) => i.id === want);
    if (item) return { id: item.id, start: item.start, end: item.end, text: text.slice(item.start, item.end) };
  }
  // A named section, or an id the item list does not carry (it keeps numbered items only).
  const bounds = section || itemsSection(text);
  let hit = null;
  eachChild(text, bounds, (c) => {
    if (!hit && c.isBlock && c.key === String(id)) {
      hit = { id: c.key, start: c.start, end: c.end, text: text.slice(c.start, c.end) };
    }
  });
  return hit;
}

// Direct scalar fields of an item block ("name", "prefab", "item_slot"...).
function itemFields(text, item) {
  const out = new Map();
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock) out.set(c.key.toLowerCase(), c.value);
  });
  return out;
}

/**
 * Every item in the schema, as light records. Used for the free-cosmetics picker
 * (weather / terrain / HUD / killstreak...) which is generated from the live schema
 * rather than hardcoded, so anything Valve adds later shows up on its own.
 * @returns {Array<{id, name, slot, prefab, itemName, image, baseitem, start, end}>}
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
let itemsCache = [];

function listItems(text) {
  const hit = itemsCache.find((e) => e.text === text);
  if (hit) return hit.list;
  const section = itemsSection(text);
  const out = [];
  eachChild(text, section, (c) => {
    if (!c.isBlock || !/^\d+$/.test(c.key)) return;
    const fields = new Map();
    let hasVisuals = false;
    let bundleItems = [];
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
  });
  itemsCache.unshift({ text, list: out });
  itemsCache.length = Math.min(itemsCache.length, ITEMS_CACHE_SIZE);
  return out;
}

// The table is read as latin1 so every splice stays byte-exact, which leaves names with
// non-ASCII characters (curly quotes, accents) as raw UTF-8 bytes. Anything shown to a
// person goes back through UTF-8 first.
function toUtf8(s) {
  return /[\x80-\xff]/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s;
}

/** An item's words in one lowercase string, for telling an arcana or persona by its name. */
function itemSearchText(item) {
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
function inferredItemSlot(item) {
  if (item?.slot) return item.slot;
  return item?.prefab === 'wearable' || item?.prefab === 'default_item' ? 'weapon' : '';
}

// Which slot an item belongs to. Wearables say it outright; the whole-match cosmetics
// (weather, terrain, HUD...) leave item_slot out and only name their prefab. No guessing here:
// the guess moved 22 loading screens, their default among them, into "back" (2026-09-24).
function slotOf(item) {
  return item.slot || item.prefab || '';
}

/**
 * The free "base item" of a slot - the one every account owns (555 Default Weather,
 * 590 Default Terrain, ...). Dressing it in another item's visuals is what makes a paid
 * cosmetic the default one.
 */
function baseItemFor(text, slot) {
  return listItems(text).find((i) => i.baseitem && slotOf(i) === slot) || null;
}

/**
 * What can be put on that base item, read straight out of the installed game: anything Valve
 * adds to the schema later shows up on its own, without an app update.
 * @returns {Array<{id, name}>}  name is the schema's own English name, sorted A-Z
 */
function cosmeticOptions(text, slot) {
  return listItems(text)
    .filter((i) => slotOf(i) === slot && !i.baseitem && i.hasVisuals && i.name)
    .map((i) => ({ id: i.id, name: toUtf8(i.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pull scripts/items/items_game.txt out of the game's pak01. This is the base every
 * build starts from, so a game update simply means a rebuild, never a stale schema.
 * @param {string} gamePath  ...\dota 2 beta\game
 * @returns {{ text: string, stamp: string }}  stamp = version marker of the base file
 */
function readGameSchema(gamePath) {
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak)) throw new Error(t('Не найден {0}', pak));
  const hit = readVpkEntryFile(pak, SCHEMA_REL);
  if (!hit) throw new Error(t('items_game.txt не найден в pak01 игры'));
  return { text: hit.data.toString('latin1'), stamp: `${hit.data.length}:${hit.crc >>> 0}` };
}

// Cheap "did the game update?" probe: size+mtime of the paks that carry the schema.
function gameSchemaStamp(gamePath) {
  const dir = path.join(gamePath, 'dota');
  const parts = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^pak01_(dir|\d{3})\.vpk$/i.test(f)) continue;
    const st = fs.statSync(path.join(dir, f));
    parts.push(`${f}:${st.size}:${Math.floor(st.mtimeMs)}`);
  }
  return parts.sort().join('|');
}

// ---------- mod deltas ----------

// Skinchanger exports are written as one endless line; re-indent so the merged file
// stays readable (and diffable) when someone opens it.
function reindent(block, indent) {
  const first = readToken(block, 0);
  if (!first) return '';
  const at = skipGap(block, first.next);
  if (block[at] !== '{') return String(block).trim();
  const nl = '\r\n';
  const formatBlock = (text, key, bounds, pad) => {
    const rows = [];
    eachChild(text, bounds, (c) => {
      if (c.isBlock) rows.push(formatBlock(text, c.key, c.body, pad + '\t'));
      else rows.push(`${pad}\t"${c.key}"\t\t"${c.value}"`);
    });
    return `${pad}"${key}"${nl}${pad}{${rows.length ? `${nl}${rows.join(nl)}${nl}` : nl}${pad}}`;
  };
  return formatBlock(block, first.value, blockBounds(block, at), indent).trimStart();
}

/**
 * Asset paths a mod ships, in the form items_game refers to them: lowercase, no _c.
 * @param {string[]} vpkPaths
 * @param {{ roots?: boolean }} [opts]  roots: also match Skinchanger's numeric content
 *   root as a whole. Right for "did this mod change that block", wrong when splitting a
 *   pack per hero — there the root is shared by every hero in it.
 */
function ownedAssetNeedles(vpkPaths, opts = {}) {
  const withRoots = opts.roots !== false;
  const out = new Set();
  for (const p of vpkPaths) {
    const clean = p.toLowerCase().replace(/"+$/, '').replace(/_c$/, '');
    if (!clean || clean.length < 8) continue;
    // Stock/global files carry no identity — they are in every export.
    if (/^(scripts\/|resource\/|panorama\/styles\/|materials\/default\/)/.test(clean)) continue;
    out.add(clean);
    // A block can point a slot at one of Valve's own models and still belong to the mod: the
    // author repaints that item by shipping its materials, and the block only names the model.
    // Tinker's cape is that case - the mod carries nothing of deep_sea_robot_back but its
    // textures, and without this the redirect was dropped and the back never appeared.
    const item = /materials\/models\/items\/([a-z0-9_]+)\/([a-z0-9_]+)\//.exec(clean);
    if (item) out.add(`models/items/${item[1]}/${item[2]}/`);
    const root = clean.split('/')[0];
    if (withRoots && /^\d{3,}$/.test(root)) out.add(root + '/');
  }
  return [...out];
}

// Does an item block talk about any of these files? Used when a multi-hero pack is split:
// each part keeps only the blocks that belong to its own assets.
function blockUsesAssets(blockText, vpkPaths) {
  const hay = blockText.toLowerCase();
  return ownedAssetNeedles(vpkPaths, { roots: false }).some((n) => hay.includes(n));
}

/**
 * The blocks a mod changed, written back out as a table of their own: the shape items_game
 * has, holding nothing but this mod's items.
 *
 * Installing a mod lifts its item blocks onto the library record and drops the 47 MB table
 * it shipped (see installer.harvestSchema) - which is right for this install, and wrong for
 * a file leaving it. A mod exported or shared without those blocks travels without its
 * effects and icons, so anything built for somewhere else carries this instead: small, and
 * read straight back by the same harvest on the other side.
 * @param {Array<{id, name, block}>} deltas
 * @returns {string}
 */
function deltaTable(deltas) {
  const nl = '\r\n';
  // verbatim, not reindented: the block is already valid KV, and keeping its own bytes is
  // what makes the trip out and back byte-identical to what was lifted in the first place
  const blocks = (deltas || []).map((d) => '\t\t' + d.block).join(nl);
  return `"items_game"${nl}{${nl}\t"items"${nl}\t{${nl}${blocks}${nl}\t}${nl}}${nl}`;
}

/**
 * Which item blocks a mod actually changed. Diffing two schemas line by line is
 * useless (the mod's copy is months behind the game's), so instead: a real change
 * always names a file the mod itself ships. Blocks that mention one of those, and
 * differ from the installed schema, are the delta.
 * @param {string} modText     items_game.txt taken out of the mod
 * @param {string[]} vpkPaths  every path inside that mod's VPK
 * @param {string} baseText    the game's current schema (to drop no-op blocks)
 * @returns {Array<{ id: string, name: string, block: string }>}
 */
function extractDeltas(modText, vpkPaths, baseText) {
  const needles = ownedAssetNeedles(vpkPaths);
  if (!needles.length) return [];
  const section = itemsSection(modText);
  const baseSection = baseText ? itemsSection(baseText) : null;
  const deltas = [];
  eachChild(modText, section, (c) => {
    if (!c.isBlock || !/^\d+$/.test(c.key)) return;
    const raw = modText.slice(c.start, c.end);
    const hay = raw.toLowerCase();
    if (!needles.some((n) => hay.includes(n))) return;
    let name = '';
    eachChild(modText, c.body, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'name') name = f.value; });
    if (baseText) {
      const cur = findItem(baseText, c.key, baseSection);
      if (cur && cur.text.replace(/\s+/g, ' ') === raw.replace(/\s+/g, ' ')) return; // unchanged
    }
    deltas.push({ id: c.key, name, block: raw });
  });
  return deltas;
}

// Remove every "<key> { … }" sub-block from a KV fragment, with the whitespace in front
// of it, so the result still reads like the file it came from.
function stripKeyBlocks(text, key) {
  let out = text;
  for (;;) {
    const at = out.indexOf(`"${key}"`);
    if (at === -1) return out;
    const open = out.indexOf('{', at);
    if (open === -1) return out;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    if (end === -1) return out;
    let start = at;
    while (start > 0 && /[ \t\r\n]/.test(out[start - 1])) start--;
    out = out.slice(0, start) + out.slice(end);
  }
}

/**
 * Free cosmetics: copy the visuals of a real item onto a "base item" everyone owns
 * (555 Default Weather, 590 Default Terrain, ...). Returns the block to splice in.
 *
 * Styles come along with the visuals, but a paid item locks its extra styles behind
 * "unlock { price, item_def }" - on a base item that only produces a "style locked"
 * button, so those gates come off.
 */
function baseItemPatch(baseText, targetId, sourceId) {
  const target = findItem(baseText, targetId);
  if (!target) throw new Error(t('items_game: предмет {0} не найден', targetId));
  const source = findItem(baseText, sourceId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', sourceId));

  let visuals = null;
  eachChild(baseText, blockBounds(baseText, source.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') visuals = baseText.slice(c.start, c.end);
  });
  if (!visuals) throw new Error(t('items_game: у предмета {0} нет блока visuals', sourceId));
  visuals = stripKeyBlocks(visuals, 'unlock');

  // Drop any visuals the base item already has, then append the donor's.
  let stripped = target.text;
  eachChild(baseText, blockBounds(baseText, target.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') {
      const rel = [c.start - target.start, c.end - target.start];
      stripped = target.text.slice(0, rel[0]) + target.text.slice(rel[1]);
    }
  });
  const close = stripped.lastIndexOf('}');
  return stripped.slice(0, close) + '\t' + visuals.trim() + '\r\n\t\t' + stripped.slice(close);
}

/**
 * Splice blocks into the base schema. Later entries win; every patch is applied to the
 * game's current text, so nothing Valve ships is rolled back except the patched blocks.
 * @param {string} baseText
 * @param {Array<{id: string, block: string, source?: string}>} patches
 * @returns {{ text: string, applied: Array, missing: Array, conflicts: Array }}
 */
function mergeSchema(baseText, patches) {
  const applied = [];
  const missing = [];
  const conflicts = [];
  const seen = new Map();
  const edits = [];

  // Same block from two sources is not a conflict: Skinchanger bakes the whole cart into
  // every export, so its packs routinely carry a byte-identical copy of each other's blocks.
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  for (const p of patches) {
    const prev = seen.get(String(p.id));
    if (prev && flat(prev.block) !== flat(p.block)) {
      conflicts.push({ id: String(p.id), a: prev.source || '', b: p.source || '' });
    }
    seen.set(String(p.id), p);
  }
  const section = itemsSection(baseText);
  for (const p of seen.values()) {
    const item = findItem(baseText, p.id, section);
    if (!item) { missing.push(String(p.id)); continue; }
    edits.push({ start: item.start, end: item.end, text: reindent(p.block, '\t\t') });
    applied.push({ id: String(p.id), source: p.source || '' });
  }

  edits.sort((a, b) => b.start - a.start); // splice from the tail so offsets stay valid
  let text = baseText;
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return { text, applied, missing, conflicts };
}

/**
 * Refuse to ship a schema that could crash the client on load. Cheap structural checks
 * only: a malformed file is what makes the game die with "ERROR PARSING SCRIPT".
 */
function validateSchema(text, baseText) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { const e = text.indexOf('"', i + 1); if (e === -1) throw new Error(t('items_game: незакрытая кавычка')); i = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) throw new Error(t('items_game: лишняя закрывающая скобка')); }
  }
  if (depth !== 0) throw new Error(t('items_game: незакрытый блок'));
  const items = listItems(text).length;
  if (items < 1000) throw new Error(t('items_game: подозрительно мало предметов ({0})', items));
  if (baseText) {
    const baseItems = listItems(baseText).length;
    if (items < baseItems) throw new Error(t('items_game: предметов меньше, чем в игре ({0} < {1})', items, baseItems));
  }
  return { items, bytes: text.length };
}

// crc32 comes from src/vpk.ts, where the VPK writer needs it too, and is re-exported below
// for everything that was already taking it from here.

// Pack the merged schema as a one-file VPK holding nothing but items_game.txt.
function buildSchemaVpk(text, extraEntries = []) {
  const data = Buffer.from(text, 'latin1');
  return buildVpk([{ ext: 'txt', folder: 'scripts/items', name: 'items_game', crc: crc32(data), preload: Buffer.alloc(0), data }, ...extraEntries]);
}

/**
 * Build the schema and put it in the mod folder. Always rebuilt from the installed
 * game, so a Dota update is repaired by calling this again - never by shipping a copy.
 *
 * `base` is the game's own table, which the caller has usually just read: it is 50 MB out of
 * a VPK and reading it twice for one deploy was most of what removing a mod cost. Left out,
 * it is read here as before.
 * @param {object} opts
 * @param {string} opts.gamePath
 * @param {string} opts.folder            the mod folder the schema VPK is written into
 * @param {Array} opts.patches
 * @param {{ text: string, stamp: string }} [opts.base]  the game's own table, if already read
 * @returns {{ applied: Array, missing: string[], conflicts: Array, stamp: string, bytes: number, items: number }}
 */
function deploy({ gamePath, folder, patches, base = readGameSchema(gamePath) }) {
  const merged = mergeSchema(base.text, patches);
  const checked = validateSchema(merged.text, base.text);
  const extras = [];
  const seen = new Set();
  for (const p of patches || []) {
    for (const en of p.assets || []) {
      const key = `${en.folder}/${en.name}.${en.ext}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(en);
    }
  }
  const buf = buildSchemaVpk(merged.text, extras);
  const dir = path.join(gamePath, folder);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, SCHEMA_VPK);
  const tmp = dest + '.mmtmp';
  fs.writeFileSync(tmp, buf);
  try {
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return { ...merged, stamp: base.stamp, bytes: checked.bytes, items: checked.items };
}

// Any real file left in a directory tree (the engine drops empty rpt/ and save/ folders
// into every mounted content path, and those must not keep the folder alive).
function hasFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (hasFiles(path.join(dir, e.name))) return true; }
    else return true;
  }
  return false;
}

// Drop the built schema, and the folder with it once nothing of ours is left there.
function undeploy({ gamePath, folder }) {
  const dir = path.join(gamePath, folder);
  const dest = path.join(dir, SCHEMA_VPK);
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  if (fs.existsSync(dir) && !hasFiles(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function isDeployed(gamePath, folder) {
  return fs.existsSync(path.join(gamePath, folder, SCHEMA_VPK));
}

module.exports = {
  eachChild,
  blockBounds,
  stripKeyBlocks,
  toUtf8,
  itemSearchText,
  inferredItemSlot,
  SCHEMA_REL,
  SCHEMA_VPK,
  deploy,
  undeploy,
  isDeployed,
  readGameSchema,
  gameSchemaStamp,
  listItems,
  baseItemFor,
  cosmeticOptions,
  findItem,
  itemFields,
  extractDeltas,
  deltaTable,
  ownedAssetNeedles,
  blockUsesAssets,
  baseItemPatch,
  mergeSchema,
  validateSchema,
  buildSchemaVpk,
  reindent,
  crc32,
};
