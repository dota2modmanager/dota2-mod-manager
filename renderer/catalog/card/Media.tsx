/* A preview: a picture, a looping clip, a sound, or the category's icon when there is none.
 * The same four answers as mediaHtml() in ui/media.js, drawn by React. A picture that fails asks
 * the mirror once, then gives up to the placeholder and counts towards the one warning.
 * Give it key={url}: a new address is a new picture, with its own retry. */
import { useState } from 'react';
import { isVideo, isAudio, mirrorOf, mediaGaveUp } from '../../ui/media.js';

interface Props {
  url: string | null;
  hoverPlay?: boolean;
  /** a window's picture plays on its own, loaded whole rather than from its first frame */
  autoplay?: boolean;
  fallbackIcon?: string;
}

export function Media({ url, hoverPlay = false, autoplay = false, fallbackIcon = 'image' }: Props) {
  const [src, setSrc] = useState(url);
  const [gaveUp, setGaveUp] = useState(false);

  if (!src || gaveUp) {
    return <div className="noimg"><span className="ms">{gaveUp ? 'image_not_supported' : fallbackIcon}</span></div>;
  }
  const failed = () => {
    const spare = src === url ? mirrorOf(url) : null;
    if (spare) setSrc(spare);
    else { setGaveUp(true); mediaGaveUp(); }
  };
  if (isVideo(src)) {
    return (
      <video
        src={src} muted loop playsInline preload={autoplay ? 'auto' : 'metadata'} autoPlay={autoplay} data-owned="react"
        data-hoverplay={hoverPlay ? '1' : undefined}
        onMouseEnter={hoverPlay ? (e) => { e.currentTarget.play().catch(() => {}); } : undefined}
        onMouseLeave={hoverPlay ? (e) => e.currentTarget.pause() : undefined}
        onError={failed}
      />
    );
  }
  if (isAudio(src)) {
    return <div className="audio-wrap"><span className="ms audio-icon">graphic_eq</span><audio src={src} controls preload="none" /></div>;
  }
  return <img src={src} loading="lazy" alt="" data-owned="react" onError={failed} />;
}
