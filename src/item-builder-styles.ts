/**
 * An item's styles in the item builder: which ones it has, and its visuals with one of them made
 * its only one.
 *
 * A worn item is in a style the player chose in the game, and its visuals carry every style at
 * once: an entry marked "style" "1" applies in the second one only, and the style's own block says
 * which material the model takes ("skin") and sometimes another model. A stock item is in its first
 * style and nobody can choose another, so a pick in style N is written as an item whose only style
 * is N's, under the number 0: its entries marked N relabelled 0, every other style's taken out.
 * The game then shows the item in it, and the files the build copies (src/item-builder-assets.ts)
 * are that style's. The first style is the item as the builder always wrote it.
 */
import { blockBounds, eachChild, type KvChild } from './schema.ts';

const MODIFIER = /^asset_modifier\d*$/i;
/** What a style holds that only means something to its owner: what unlocks it, what it cost. */
const OWNER_ONLY = new Set(['unlock', 'item_def', 'price', 'auto_style_rule', 'auto_style_reason']);

function stylesBlock(visuals: string): KvChild | null {
  let hit: KvChild | null = null;
  eachChild(visuals, blockBounds(visuals, 0), (c) => { if (!hit && c.isBlock && c.key.toLowerCase() === 'styles') hit = c; });
  return hit;
}

/** The name token of each of an item's styles, in their order ("#DOTA_Style_..."); [] for an item with one look. */
export function styleTokens(visuals: string | null): string[] {
  const block = visuals ? stylesBlock(visuals) : null;
  if (!block) return [];
  const out: string[] = [];
  eachChild(visuals!, block.body!, (s) => {
    if (!s.isBlock || !/^\d+$/.test(s.key)) return;
    let name = '';
    eachChild(visuals!, s.body!, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'name') name = f.value ?? ''; });
    out[Number(s.key)] = name;
  });
  return out.length > 1 ? Array.from(out, (n) => n || '') : [];
}

/** A pick's style out of its options' key (src/item-builder.ts effectKey): "style-2" is 2, none is 0. */
export const styleOf = (key: string): number => Number(/(?:^|,)style-(\d+)(?:,|$)/.exec(key)?.[1] || 0);

/**
 * The visuals with style `style` made the item's only one, and the model that style puts on the
 * item instead of its own (null: its own). Style 0, or a style the item has not got, leaves the
 * visuals as they are (`applied` false): the builder strips the styles, which leaves the item in
 * its first.
 */
export function withStyle(visuals: string, style: number): { visuals: string; model: string | null; applied: boolean } {
  const block = stylesBlock(visuals);
  const own = block && style > 0 ? styleChild(visuals, block, style) : null;
  if (!block || !own) return { visuals, model: null, applied: false };
  return { ...onlyStyle(visuals, block, own, style, '0', 1), applied: true };
}

/**
 * A built item's visuals as they look whatever style it is worn in: its first style's entries with
 * their mark taken off, every other style's taken out, and the first style's block under each of
 * the `count` numbers the worn item can be in.
 *
 * For another player's item dressed in the user's look (src/item-builder-everyone.ts). The server
 * sends the style the player chose in the game, not the user's: another player's Bracers of the
 * Cavern Luminar in their second style, under the user's block with both styles in it, was drawn
 * with the second style's orange particles and the parts of it the build had not copied (#402).
 * The first style is the user's: the builder writes a pick in another one as the first (withStyle).
 */
export function inEveryStyle(visuals: string, count: number): string {
  // a pick in its first style is written with the styles block taken out and its entries still
  // marked: with no block to copy, the entries are what decides
  const block = stylesBlock(visuals);
  const own = block && styleChild(visuals, block, 0);
  return onlyStyle(visuals, own ? block : null, own, 0, null, Math.max(1, count)).visuals;
}

/** An item block's visuals, by where they sit in it, or null for an item with none. */
function visualsOf(block: string): KvChild | null {
  let hit: KvChild | null = null;
  eachChild(block, blockBounds(block, 0), (c) => { if (!hit && c.isBlock && c.key.toLowerCase() === 'visuals') hit = c; });
  return hit;
}

/** A built item block worn as `worn` (an item block of the game's), in every style `worn` has (inEveryStyle). */
export function blockInEveryStyle(block: string, worn: string): string {
  const at = visualsOf(block);
  if (!at) return block;
  const own = visualsOf(worn);
  const count = own ? styleTokens(worn.slice(own.start, own.end)).length : 0;
  const visuals = block.slice(at.start, at.end);
  return block.slice(0, at.start) + inEveryStyle(visuals, count) + block.slice(at.end);
}

function styleChild(visuals: string, block: KvChild, style: number): KvChild | null {
  let own: KvChild | null = null;
  eachChild(visuals, block.body!, (s) => { if (!own && s.isBlock && s.key === String(style)) own = s; });
  return own;
}

/**
 * The visuals with `style`'s entries kept, marked `mark` (null: unmarked, so in any style), every
 * other style's taken out, and its own block written under the numbers 0 to `copies` - 1.
 */
function onlyStyle(visuals: string, block: KvChild | null, chosen: KvChild | null, style: number, mark: string | null, copies: number): { visuals: string; model: string | null } {
  const fields: string[] = [];
  let model: string | null = null;
  if (chosen) eachChild(visuals, chosen.body!, (f) => {
    if (OWNER_ONLY.has(f.key.toLowerCase())) return;
    if (!f.isBlock && f.key.toLowerCase() === 'model_player') model = f.value ?? null;
    fields.push(visuals.slice(f.start, f.end));
  });
  const styles = Array.from({ length: copies }, (_, i) => `"${i}"\r\n{\r\n${fields.join('\r\n')}\r\n}`).join('\r\n');
  const cuts: { start: number; end: number; text: string }[] = block
    ? [{ start: block.start, end: block.end, text: `"styles"\r\n{\r\n${styles}\r\n}` }]
    : [];
  // a cut that takes a whole entry or line takes the whitespace before it with it
  const lineStart = (at: number) => at - (/[ \t]*\r?\n[ \t]*$/.exec(visuals.slice(0, at))?.[0].length ?? 0);
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !MODIFIER.test(c.key)) return;
    let at: KvChild | null = null;
    eachChild(visuals, c.body!, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'style') at = f; });
    if (at === null) return;
    const mine = at as KvChild;
    if (mine.value !== String(style)) { cuts.push({ start: lineStart(c.start), end: c.end, text: '' }); return; }
    if (mark === null) cuts.push({ start: lineStart(mine.start), end: mine.end, text: '' });
    else if (mark !== String(style)) cuts.push({ start: mine.start, end: mine.end, text: visuals.slice(mine.start, mine.end).replace(/("style"\s+")\d+(")/i, `$1${mark}$2`) });
  });
  let out = visuals;
  for (const cut of cuts.sort((a, b) => b.start - a.start)) out = out.slice(0, cut.start) + cut.text + out.slice(cut.end);
  return { visuals: out, model };
}
