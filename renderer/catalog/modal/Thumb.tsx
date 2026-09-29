/* A pack member's thumbnail, as thumbHtml() in ui/thumb.ts draws it: a still for a picture, the
 * first frame for a clip, an empty box when there is nothing to show. */
import { isVideo } from '../../ui/media.ts';

export function Thumb({ url, cls = 'pack-thumb' }: { url: string | null; cls?: string }) {
  if (!url) return <div className={cls} />;
  if (isVideo(url)) return <video className={cls} src={url} muted playsInline preload="metadata" />;
  return <img className={cls} src={url} loading="lazy" alt="" />;
}
