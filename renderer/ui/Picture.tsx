/* A picture React draws, that React looks after when it does not arrive: asked for once more from
 * the mirror, then the box it would have had with no picture at all, in the same size.
 *
 * ui/media.ts's listener used to do this for every picture on the page by swapping the element
 * for a placeholder. On a picture React owns that took the size with it (the placeholder had
 * none of the picture's classes), so a My mods row whose preview failed became one wide empty box
 * with the name squeezed into a column a word wide (issue #243), and it left React holding an
 * element no longer in the page. The listener now leaves React's elements alone, and everything
 * React draws as a picture goes through here or through catalog/card/Media.tsx.
 */
import { useState } from 'react';
import { isVideo, mirrorOf, mediaGaveUp } from './media.ts';

interface Props {
  url: string;
  /** the class the picture and its stand-in share, which is what gives both their size */
  cls?: string;
  /** the glyph the stand-in shows */
  fallback?: string;
  lazy?: boolean;
}

export function Picture({ url, cls, fallback = 'image_not_supported', lazy = true }: Props) {
  const [state, setState] = useState({ url, src: url, gaveUp: false });
  // a new address is a new picture, with its own retry
  if (state.url !== url) setState({ url, src: url, gaveUp: false });
  if (state.gaveUp) return <div className={cls}><span className="ms thumb-glyph">{fallback}</span></div>;
  const failed = () => {
    const spare = state.src === url ? mirrorOf(url) : null;
    if (spare) setState({ url, src: spare, gaveUp: false });
    else { setState({ url, src: state.src, gaveUp: true }); mediaGaveUp(); }
  };
  return isVideo(state.src)
    ? <video className={cls} src={state.src} muted playsInline preload="metadata" data-owned="react" onError={failed} />
    : <img className={cls} src={state.src} loading={lazy ? 'lazy' : undefined} alt="" data-owned="react" onError={failed} />;
}
