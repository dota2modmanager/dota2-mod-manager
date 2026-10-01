/* What the built-in player can show for a mod: only a dedicated "preview" link to a clip or a
 * sound. A mod whose card picture is itself a video already plays it on hover and in the window. */
import type { Mod } from './types.ts';
import { isMedia, resolveUrl } from '../ui/media.js';

export function playablePreview(mod: Mod): string | null {
  const link = (mod.links || []).find((l) => l.type === 'preview' && isMedia(l.url));
  return link ? resolveUrl(link.url) : null;
}
