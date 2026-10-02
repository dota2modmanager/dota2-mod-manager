/* Pictures for a mod, wherever it came from.
 *
 * Four sources, tried in order: the catalog's own preview, a preview the record carries,
 * a frame lifted from the file itself, and finally the hero portrait the name implies. A
 * mod with no picture is a card the eye slides off, so the fallbacks are worth the code.
 *
 * Shared by the catalog and the library, which is why it lives here rather than in either. */
import { state } from '../core/store.ts';
import { isCursorRec } from '../core/records.ts';
import { esc } from './format.ts';
import { previewUrl, isVideo } from './media.ts';
import type { LibFile, LibRecord, Match, Member } from '../library/types.ts';

/** A row, a pack member or a foreign file: anything the tiles of My mods picture. */
type Pictured = Pick<LibRecord, 'categoryId' | 'name'> & Partial<Pick<LibRecord, 'preview' | 'match' | 'styleLabel' | 'fileRef' | 'files'>>;

// The catalog's own picture for a mod, by the name it is filed under. Styles have one each,
// so the record's file (or its style label) says which of them is this one's.
function catalogPreviewUrl(categoryId: string, name: string, styleLabel?: string | null, fileRef?: string): string | null {
  const hit = state.modIndex.get(String(name || '').toLowerCase());
  if (!hit || hit.categoryId !== categoryId) return null;
  const styles = hit.mod.styles || [];
  const style = styles.find((s) => fileRef && s.file === fileRef)
    || styles.find((s) => (s.label || null) === (styleLabel || null));
  const preview = style?.preview || hit.mod.preview || styles[0]?.preview;
  return preview ? previewUrl(categoryId, preview) : null;
}

// Picture for one library entry — a row or a pack member: its own, else the catalog's for
// the same mod. The fallback is what gives a record installed without a preview (and an
// import recognised by its fingerprint) a thumbnail instead of an empty box.
export function recPreviewUrl(rec: Pictured | LibRecord | Member): string | null {
  if (rec.preview) return previewUrl(rec.categoryId, rec.preview);
  // a pack member carries no match of its own shape, so only an array is read as one
  const match = Array.isArray(rec.match) ? rec.match as Match : null;
  if (match) {
    const cp = catalogPreviewFor(match);
    if (cp) return previewUrl(match[0].categoryId, cp);
  }
  return catalogPreviewUrl(rec.categoryId, rec.name, rec.styleLabel, typeof rec.fileRef === 'string' ? rec.fileRef : undefined);
}

// A library thumbnail: a still for a picture, the first frame for a clip (a few catalog
// entries only ship an .mp4), an empty box when there is nothing to show.
export function thumbHtml(cls: string, url: string | null | undefined): string {
  if (!url) return `<div class="${cls}"></div>`;
  if (isVideo(url)) return `<video class="${cls}" src="${esc(url)}" muted playsinline preload="metadata"></video>`;
  return `<img class="${cls}" src="${esc(url)}" loading="lazy" alt="">`;
}

// A stand-in for a record with no picture of its own and no catalog match: a cursor set
// (whatever its category - a data gap in the catalog is as blank as an unmatched import), an
// imported mod recognised as skinning exactly one hero (see installer.analyzeRecord), or an
// unsplit bundle of several heroes at once. Each is a real thing the wiki itself illustrates
// with one picture; a font, or anything the app cannot place in one of these, stays a plain
// icon rather than guess.
export function wikiFallbackKey(rec: LibRecord | Member): { key: string; icon: string } | null {
  if (isCursorRec(rec)) return { key: 'generic:cursor', icon: 'arrow_selector_tool' };
  const heroes = rec.heroNames;
  if (rec.categoryId !== 'imported' || !Array.isArray(heroes) || !heroes.length) return null;
  return heroes.length === 1
    ? { key: 'hero:' + heroes[0], icon: 'person' }
    : { key: 'generic:pack', icon: 'auto_awesome' };
}

// The mod's own *_dir.vpk, which is what a picture can be taken out of (see src/mod-preview.ts).
function modFileRef(files: LibFile[] | undefined): string | null {
  const f = (files || []).find((x) => x.root === 'lang' && /_dir\.vpk$/i.test(x.relPath));
  return f ? f.relPath : null;
}

/**
 * Every source that could picture this mod, best first, as one key for the tile.
 *
 * The order is the whole point and it lives here. A mod that replaces the hero's animated
 * portrait wins outright: that clip is the author's own showcase of the thing. Then art they
 * drew (the selection screen, an item icon), which still beats the wiki's picture of the
 * hero, because the wiki shows the *vanilla* hero and this mod is what replaced him. A raw
 * model texture loses to the wiki instead - it is a UV layout and reads as a coloured smear.
 */
export function pictureChain(rec: { files?: LibFile[] }, fallbackKey: string | null | undefined): string {
  const ref = modFileRef(rec.files);
  return [ref && `modvid:${ref}`, ref && `modart:${ref}`, fallbackKey, ref && `modtex:${ref}`]
    .filter(Boolean).join('|');
}

// catalog thumbnail for a fingerprint match, resolved from the loaded catalog index
export function catalogPreviewFor(match: Match | null | undefined): string | null {
  const m = match && match[0];
  if (!m) return null;
  const hit = state.modIndex.get(m.name.toLowerCase());
  if (!hit) return null;
  const mod = hit.mod;
  if (m.styleLabel && mod.styles) {
    const st = mod.styles.find((s) => s.label === m.styleLabel);
    if (st && st.preview) return st.preview;
  }
  return mod.preview || (mod.styles && mod.styles[0] && mod.styles[0].preview) || null;
}
