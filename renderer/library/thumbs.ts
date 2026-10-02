/* Where a mod's picture comes from, for the tiles of My mods and the presets (ui/thumb.ts has the
 * sources in order): a preview, a picture fetched by name, or only a glyph. */
import { isVideo, previewUrl } from '../ui/media.ts';
import { recPreviewUrl, wikiFallbackKey, pictureChain, catalogPreviewFor } from '../ui/thumb.ts';
import type { Thumb } from './model.ts';
import type { ExternalFile, LibRecord, Member } from './types.ts';

const picture = (url: string): Thumb => ({ url, video: isVideo(url) });

/** A record's own picture, else the catalog's, else one fetched out of the mod or the wiki (ui/thumb.ts). */
export function recThumb(rec: LibRecord | Member): Thumb {
  const url = recPreviewUrl(rec);
  if (url) return picture(url);
  const fb = wikiFallbackKey(rec);
  const chain = pictureChain(rec, fb && fb.key);
  return chain ? { key: chain, icon: fb ? fb.icon : null } : { icon: null };
}

/* A foreign file's tile, from the same sources a row uses: the catalog's picture when the file is
 * recognised, otherwise the wiki portrait of the hero it turned out to be about. */
export function extThumb(f: ExternalFile): Thumb {
  if (f.kind === 'cursor') return { key: 'generic:cursor', icon: 'arrow_selector_tool' };
  if (f.kind === 'font') return { icon: 'text_fields' };
  const cp = catalogPreviewFor(f.match);
  if (cp && f.match) return picture(previewUrl(f.match[0].categoryId, cp));
  const heroes = f.heroNames || [];
  const fb = heroes.length === 1 ? { key: 'hero:' + heroes[0], icon: 'person' }
    : heroes.length > 1 ? { key: 'generic:pack', icon: 'auto_awesome' }
      : { key: null, icon: 'folder_zip' };
  const chain = pictureChain(f, fb.key);
  return chain ? { key: chain, icon: fb.icon } : { icon: fb.icon };
}
