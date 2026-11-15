/* A hero's card as Dota's hero picker draws it: the tall portrait, and while the pointer is on it
 * the hero's movie playing over it from the start, then still again when the pointer leaves. The
 * movie fades in once its first frame is up, so the card never flashes black, as in the game. */
import { useEffect, useRef, useState } from 'react';

export interface PickerCardProps {
  picture: string | null;
  movie: string | null;
  name?: string;
  /** play as if pointed at, without the pointer (the hero up close, in "play" mode) */
  playing?: boolean;
  className?: string;
  onHover?: () => void;
  onClick?: () => void;
}

export function PickerCard({ picture, movie, name, playing, className, onHover, onClick }: PickerCardProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [shown, setShown] = useState(false);
  const on = hover || !!playing;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (on) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
      setShown(false);
    }
  }, [on, movie]);

  return (
    <div className={`picker-card${on ? ' on' : ''}${className ? ` ${className}` : ''}`}
      onMouseEnter={() => { setHover(true); onHover?.(); }} onMouseLeave={() => setHover(false)} onClick={onClick}>
      {picture ? <img className="picker-card-pic" src={picture} alt="" draggable={false} /> : <span className="picker-card-pic ms">person</span>}
      {movie && <video ref={video} className={`picker-card-movie${shown && on ? ' shown' : ''}`} src={movie} muted loop playsInline preload="auto"
        onPlaying={() => setShown(true)} />}
      {name && <span className="picker-card-name">{name}</span>}
    </div>
  );
}
