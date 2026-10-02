// Mod deltas and the merge (src/schema.ts): which item blocks a mod changed, lifted out of the
// table it shipped, and those blocks spliced into the game's current table, with the result
// checked before anything is written.
import type { VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import { blockBounds, eachChild, readToken, skipGap, type Bounds } from './schema-kv.ts';
import { findItem, itemsSection, listItems } from './schema-items.ts';

/** An item block a mod changed, lifted out of the table it shipped. */
export interface SchemaDelta { id: string; name: string; block: string }

/** One block to splice into the game's table, and the files that come with it. */
export interface SchemaPatch { id: string | number; block: string; source?: string; assets?: VpkEntry[] }


/** What a merge did with each patch; see mergeSchema. */
export interface MergeResult {
  text: string;
  applied: { id: string; source: string }[];
  /** ids the game's table does not have */
  missing: string[];
  /** the same id changed differently by two sources */
  conflicts: { id: string; a: string; b: string }[];
}

// ---------- mod deltas ----------

/** Skinchanger exports are written as one endless line; re-indent so the merged file
 * stays readable (and diffable) when someone opens it. */
export function reindent(block: string, indent: string): string {
  const first = readToken(block, 0);
  if (!first) return '';
  const at = skipGap(block, first.next);
  if (block[at] !== '{') return String(block).trim();
  const nl = '\r\n';
  const formatBlock = (text: string, key: string, bounds: Bounds, pad: string): string => {
    const rows: string[] = [];
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
 * @param opts.roots  also match Skinchanger's numeric content
 *   root as a whole. Right for "did this mod change that block", wrong when splitting a
 *   pack per hero — there the root is shared by every hero in it.
 */
export function ownedAssetNeedles(vpkPaths: string[], opts: { roots?: boolean } = {}): string[] {
  const withRoots = opts.roots !== false;
  const out = new Set<string>();
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

/** Does an item block talk about any of these files? Used when a multi-hero pack is split:
 * each part keeps only the blocks that belong to its own assets. */
export function blockUsesAssets(blockText: string, vpkPaths: string[]): boolean {
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
 */
export function deltaTable(deltas: { id?: string; name?: string; block: string }[] | null | undefined): string {
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
 * @param modText     items_game.txt taken out of the mod
 * @param vpkPaths    every path inside that mod's VPK
 * @param baseText    the game's current schema (to drop no-op blocks)
 */
export function extractDeltas(modText: string, vpkPaths: string[], baseText?: string | null): SchemaDelta[] {
  const needles = ownedAssetNeedles(vpkPaths);
  if (!needles.length) return [];
  const section = itemsSection(modText);
  const baseSection = baseText ? itemsSection(baseText) : null;
  const deltas: SchemaDelta[] = [];
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

/** Remove every "<key> { … }" sub-block from a KV fragment, with the whitespace in front
 * of it, so the result still reads like the file it came from. */
export function stripKeyBlocks(text: string, key: string): string {
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
export function baseItemPatch(baseText: string, targetId: string | number, sourceId: string | number): string {
  const target = findItem(baseText, targetId);
  if (!target) throw new Error(t('items_game: предмет {0} не найден', targetId));
  const source = findItem(baseText, sourceId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', sourceId));

  let visuals = null as string | null;
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
 */
export function mergeSchema(baseText: string, patches: SchemaPatch[]): MergeResult {
  const applied: MergeResult['applied'] = [];
  const missing: string[] = [];
  const conflicts: MergeResult['conflicts'] = [];
  const seen = new Map<string, SchemaPatch>();
  const edits: { start: number; end: number; text: string }[] = [];

  // Same block from two sources is not a conflict: Skinchanger bakes the whole cart into
  // every export, so its packs routinely carry a byte-identical copy of each other's blocks.
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
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
export function validateSchema(text: string, baseText?: string | null): { items: number; bytes: number } {
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
