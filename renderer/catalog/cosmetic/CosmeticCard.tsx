/* One free look, drawn like a mod card (same .card/.grid classes): a picture, a star, and the same
 * green edge on whichever look is live. Its picture comes out of the game's own files and is
 * fetched once the card is near the screen (ui/cosmetic-icons.ts, watchIconFor). */
import { useEffect, useReducer, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { cosmeticIcon, subscribeIcon, watchIconFor } from '../../ui/cosmetic-icons.ts';
import { toggleFavorite, isFavKey } from '../favorites.ts';
import { CardName } from '../card/CardName.tsx';

export interface CosmeticItem {
  slot: string;
  id: string;
  name: string;
  /** "cosmetic:<slot>|<value>": how the star is kept (a hero item by id, anything else by name) */
  favKey: string;
  picked: boolean;
  fallbackIcon: string;
  /** the slot's name, on lists that mix several (favourites, search) */
  catName?: string;
}

/** A look's picture, re-read when it arrives. */
export function useCosmeticIcon(name: string): string | null | undefined {
  return useSyncExternalStore((fn) => subscribeIcon(name, fn), () => cosmeticIcon(name));
}

interface Props {
  item: CosmeticItem;
  index: number;
  onOpen: (slot: string, id: string, card: HTMLElement) => void;
  onFavChanged: () => void;
}

export function CosmeticCard({ item, index, onOpen, onFavChanged }: Props) {
  const thumb = useRef<HTMLSpanElement>(null);
  const icon = useCosmeticIcon(item.name);
  const fav = isFavKey(item.favKey);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (thumb.current ? watchIconFor(thumb.current, item.name) : undefined), [item.name]);

  const flip = async (e: MouseEvent) => {
    e.stopPropagation();
    const cut = item.favKey.indexOf('|');
    await toggleFavorite(item.favKey.slice(0, cut), item.favKey.slice(cut + 1));
    redraw();
    onFavChanged();
  };
  const favLabel = fav ? L`Убрать из избранного` : L`В избранное`;
  return (
    <div className={`card ${item.picked ? 'installed' : ''}`} data-cos={item.slot} data-cos-id={item.id}
      style={{ '--i': Math.min(index, 28) } as CSSProperties} onClick={(e) => onOpen(item.slot, item.id, e.currentTarget)}>
      <div className="card-media">
        <span className="card-thumb" data-name={item.name} data-owned="react" ref={thumb}>
          {icon ? <img src={icon} alt="" loading="lazy" /> : <div className="noimg"><span className="ms">{item.fallbackIcon}</span></div>}
        </span>
        <div className="card-actions">
          <button className={`fav-btn ${fav ? 'on' : ''}`} data-fav={item.favKey} data-owned="react"
            aria-pressed={fav} title={favLabel} aria-label={favLabel} onClick={flip}>
            <span className="ms">{fav ? 'favorite' : 'favorite_border'}</span>
          </button>
        </div>
      </div>
      <div className="card-body">
        <CardName>{item.name}</CardName>
        {item.catName && <div className="card-meta"><span>{item.catName}</span></div>}
      </div>
    </div>
  );
}

/** The cards of a list of looks, or what an empty one says. */
export function CosmeticGrid({ items, emptyText, onOpen, onFavChanged }: {
  items: CosmeticItem[]; emptyText?: string; onOpen: Props['onOpen']; onFavChanged: () => void;
}) {
  if (!items.length) return emptyText ? <div className="empty-note">{emptyText}</div> : null;
  return <>{items.map((it, i) => <CosmeticCard key={`${it.slot}|${it.id}`} item={it} index={i} onOpen={onOpen} onFavChanged={onFavChanged} />)}</>;
}
