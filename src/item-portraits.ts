/**
 * A hero's HUD portrait and minimap icon as an item builder pick makes them, written once for the
 * whole build: two picks want the same two files, and the build keeps the first file of a path it is
 * given, so the second pick's change would have been lost.
 * - the portrait: the HUD draws the hero's model with the camera and lights scripts/npc/portraits.txt
 *   gives its path, so an arcana's model under the plain path is framed and lit for the plain model.
 *   Its own settings are written under the plain path (Drow's arcana has a camera of its own);
 * - the minimap icon: drawn out of a sprite sheet that scripts/mod_textures.txt cuts up by name, so
 *   the plain icon's sprite is cut where the item's is.
 * Both files are written whole, as the game's with those entries changed, and only when something
 * changed. The approach is BetterSource2Viewer's character export (ExportPortraits,
 * CharacterIcons.ReplaceSprites; MIT). The pictures themselves are plain copies (item-builder-assets.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sharedVpkIndex, entryAt, type VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import { heroModelPath, normalizeAssetPath, type PortraitSwap, type SpriteSwap } from './item-builder-assets.ts';

const PORTRAITS = 'scripts/npc/portraits.txt';
const SPRITES = 'scripts/mod_textures.txt';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a model's top-level block in the portrait settings starts (at its name) and ends (after its brace). */
function portraitBlock(text: string, model: string): { start: number; nameEnd: number; end: number } | null {
  const name = new RegExp(`^\\t"${escape(model)}"[ \\t]*(?=\\r?$)`, 'mi').exec(text);
  if (!name) return null;
  let depth = 0;
  let quoted = false;
  for (let i = text.indexOf('{', name.index); i >= 0 && i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '{') depth++;
    else if (!quoted && c === '}' && --depth === 0) return { start: name.index, nameEnd: name.index + name[0].length, end: i + 1 };
  }
  return null;
}

/** The portrait settings with each arcana's block written under the model it stands in for. */
export function withPortraits(text: string, swaps: { from: string; to: string }[]): string {
  let out = text;
  for (const { from, to } of swaps) {
    const own = portraitBlock(text, from);
    if (!own) continue; // no settings of its own: the plain model's are the best there are
    const block = `\t"${to}"${text.slice(own.nameEnd, own.end)}`;
    const at = portraitBlock(out, to);
    if (at) out = out.slice(0, at.start) + block + out.slice(at.end);
    else { const close = out.lastIndexOf('}'); out = `${out.slice(0, close)}${block}\r\n${out.slice(close)}`; }
  }
  return out;
}

/** The sprite definitions with each swapped sprite cut out where its replacement is (a definition holds values only). */
export function withSprites(text: string, swaps: SpriteSwap[]): string {
  const find = (s: string, name: string) => new RegExp(`"${escape(name)}"\\s*(\\{[^{}]*\\})`, 'i').exec(s);
  let out = text;
  for (const { sprite, as } of swaps) {
    const source = find(text, as);
    const target = find(out, sprite);
    if (!source || !target) continue;
    const at = target.index + target[0].length - target[1].length;
    out = out.slice(0, at) + source[1] + out.slice(at + target[1].length);
  }
  return out;
}

/**
 * The portrait settings and sprite sheet of every pick, to go into the build ahead of the picks' own
 * files. A hero whose own model the game does not name is left out and said in `log`.
 */
export function portraitEntries(gamePath: string, portraits: PortraitSwap[], sprites: SpriteSwap[], log: (msg: string) => void = () => {}): VpkEntry[] {
  if (!portraits.length && !sprites.length) return [];
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak)) throw new Error(t('Не найден {0}', pak));
  const ix = sharedVpkIndex(pak);
  const swaps: { from: string; to: string }[] = [];
  for (const p of portraits) {
    try {
      swaps.push({ from: normalizeAssetPath(p.model), to: normalizeAssetPath(heroModelPath(ix, p.hero)) });
    } catch (err) {
      log(`schema: the portrait of ${p.hero} left out of the build: ${(err as Error)?.message || err}`);
    }
  }
  const out: VpkEntry[] = [];
  // written only when changed: a file of the game's put back as it was would still cover the
  // game's own after the next patch changes it
  const rewrite = (file: string, change: (text: string) => string) => {
    const was = ix.read(file)?.toString('latin1');
    const now = was === undefined ? was : change(was);
    if (now !== undefined && now !== was) out.push(entryAt(file, Buffer.from(now, 'latin1')));
  };
  if (swaps.length) rewrite(PORTRAITS, (text) => withPortraits(text, swaps));
  if (sprites.length) rewrite(SPRITES, (text) => withSprites(text, sprites));
  return out;
}
