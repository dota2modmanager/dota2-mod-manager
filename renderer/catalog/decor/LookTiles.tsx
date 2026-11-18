/* A choice of looks as pictures rather than a list: each a tile with the item's own icon (the
 * game's, ui/cosmetic-icons.ts) or the catalog mod's preview, its name under it, the one picked
 * ringed and ticked. The first tile is always the game as it is. A dropdown of a dozen grey names
 * said neither what each one looks like nor which was on. */
import { useEffect, useState } from 'react';
import { cosmeticIcon, loadCosmeticIcons } from '../../ui/cosmetic-icons.ts';

export interface LookTile {
  id: string;
  name: string;
  /** a line under the name ("10 grounds") */
  note?: string;
  /** a picture's own address (a catalog preview) */
  picture?: string | null;
  /** or the game item whose icon it wears, by its name */
  item?: string | null;
}

/** The icons of these items, the tile drawn again as each arrives. */
function useItemIcons(names: string[]): (name: string | null | undefined) => string | null {
  const [, bump] = useState(0);
  const key = names.join('|');
  useEffect(() => {
    let gone = false;
    void loadCosmeticIcons(names, () => { if (!gone) bump((n) => n + 1); });
    return () => { gone = true; };
    // the names, not the array the caller made this render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (name) => (name ? cosmeticIcon(name) ?? null : null);
}

export function LookTiles({ tiles, value, onPick, label, wide }: {
  tiles: LookTile[]; value: string | null; onPick: (id: string | null) => void; label: string;
  /** pictures wider than tall: a catalog preview is a screenshot */
  wide?: boolean;
}) {
  const icon = useItemIcons(tiles.map((t) => t.item).filter((n): n is string => !!n));
  const tile = (id: string | null, name: string, pic: string | null, note?: string) => (
    <button key={id ?? ''} type="button" role="radio" aria-checked={value === id} title={name}
      className={`opt-tile ${value === id ? 'on' : ''}`} onClick={() => onPick(id)}>
      <span className="opt-tile-pic">
        {pic ? <img src={pic} alt="" loading="lazy" /> : <span className="ms">{id === null ? 'landscape' : 'image'}</span>}
        {value === id && <span className="opt-tile-tick ms">check</span>}
      </span>
      <span className="opt-tile-name">{name}</span>
      {note && <span className="opt-tile-note">{note}</span>}
    </button>
  );
  return (
    <div className={`opt-tiles ${wide ? 'wide' : ''}`} role="radiogroup" aria-label={label}>
      {tile(null, L`Как в игре`, null)}
      {tiles.map((t) => tile(t.id, t.name, t.picture ?? icon(t.item), t.note))}
    </div>
  );
}
