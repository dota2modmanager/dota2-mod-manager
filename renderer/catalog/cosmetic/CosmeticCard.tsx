/* One free look, drawn like a mod card (same .card/.grid classes): a picture, a star, and the same
 * green edge on whichever look is live. Its picture comes out of the game's own files and is
 * fetched once the card is near the screen (ui/cosmetic-icons.ts, watchIconFor). Until it is known
 * the tile shows the same spinner a mod's picture on its way does, and a picture that arrives
 * fades in over it; one the game has not got is the slot's icon. */
import { useEffect, useReducer, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { GrowMarker, useGrowing } from '../../ui/growing.ts';
import { cosmeticIcon, prefetchIcons, subscribeIcon, watchIconFor } from '../../ui/cosmetic-icons.ts';
import { toggleFavorite, isFavKey } from '../favorites.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
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
  /** a look that needs the item table, which is off: greyed until it is on (ui/game-files.ts) */
  muted?: boolean;
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
  // a picture already known when the tile is drawn (scrolled back to) is simply there
  const waited = useRef(icon === undefined);
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
    <div className={`card ${item.picked ? 'installed' : ''}${item.muted ? ' muted' : ''}`} data-cos={item.slot} data-cos-id={item.id}
      style={{ '--i': Math.min(index, 28) } as CSSProperties} onClick={(e) => onOpen(item.slot, item.id, e.currentTarget)}>
      <div className="card-media">
        <span className={`card-thumb ${icon === undefined ? 'loading' : ''}`} data-name={item.name} data-owned="react" ref={thumb}>
          {icon ? <img decoding="async" src={icon} alt="" className={waited.current ? 'arrived' : undefined} />
            : icon === null ? <div className="noimg"><span className="ms">{item.fallbackIcon}</span></div> : null}
        </span>
        <div className="card-actions">
          <button className={`fav-btn ${fav ? 'on' : ''}`} data-fav={item.favKey} data-owned="react"
            aria-pressed={fav} title={favLabel} aria-label={favLabel} onClick={flip}>
            <span className="ms">{fav ? 'favorite' : 'favorite_border'}</span>
          </button>
        </div>
      </div>
      <div className="card-body">
        <CardName>{cosmeticName(item.name)}</CardName>
        {item.catName && <div className="card-meta"><span>{item.catName}</span></div>}
      </div>
    </div>
  );
}

/** The cards of a list of looks, or what an empty one says. A page at a time, as the mods are
 * (ui/growing.ts): the loading screens are over two thousand cards, and drawn whole they held
 * the window for the moment the slot opened and made every star and filter redraw all of them. */
export function CosmeticGrid({ items, emptyText, onOpen, onFavChanged }: {
  items: CosmeticItem[]; emptyText?: string; onOpen: Props['onOpen']; onFavChanged: () => void;
}) {
  const first = items[0], last = items[items.length - 1];
  // another slot, filter or search starts at the top again; a star changes none of these
  const listKey = `${items.length}|${first?.slot}|${first?.id}|${last?.id}`;
  // A page of loading screens is thirty rows of tall cards, which a fling crosses in a moment:
  // the next page joins three screens ahead, so the list never runs out under the scroll.
  const { limit, marker, more } = useGrowing(items.length, listKey, '3600px 0px');
  // the slot's pictures come in its order while the user looks at the first ones
  useEffect(() => prefetchIcons(items.map((it) => it.name)), [listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return emptyText ? <div className="empty-note">{emptyText}</div> : null;
  return (
    <>
      {items.slice(0, limit).map((it, i) => <CosmeticCard key={`${it.slot}|${it.id}`} item={it} index={i} onOpen={onOpen} onFavChanged={onFavChanged} />)}
      {more && <GrowMarker marker={marker} total={items.length} className="grid-more" />}
    </>
  );
}
