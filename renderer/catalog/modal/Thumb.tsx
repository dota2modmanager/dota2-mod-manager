/* A pack member's thumbnail, as thumbHtml() in ui/thumb.ts draws it: a still for a picture, the
 * first frame for a clip, an empty box when there is nothing to show. */
import { Picture } from '../../ui/Picture.tsx';

export function Thumb({ url, cls = 'pack-thumb' }: { url: string | null; cls?: string }) {
  if (!url) return <div className={cls} />;
  return <Picture url={url} cls={cls} />;
}
