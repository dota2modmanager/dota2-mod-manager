/* One card in a catalog grid, drawn by React with the markup cardHtml() used to write, so every
 * style, the simulation and the screenshot harness find what they always found.
 *
 * A card is its picture. Everything else on it has to earn the room it takes, so what shows
 * depends on the list: a grid inside one category needs neither the category's own name nor a
 * date, while a search result and the "recently added" strip have to say where the mod was found.
 *
 * The card owns three things now that were patched into the DOM from outside: the look on show,
 * the star, and the plus. Switching a look redraws this card alone, where it used to rebuild the
 * picture by hand and bind its buttons again. */
import { useReducer, type CSSProperties, type MouseEvent, type Ref } from 'react';
import type { Mod } from '../types.ts';
import { catalogConstants } from '../data.ts';
import { keyOf } from '../../core/keys.ts';
import { catName, catIcon } from '../../core/categories.ts';
import { previewUrl } from '../../ui/media.ts';
import { openPlayer } from '../../ui/player.ts';
import { toggleQueued } from '../../ui/queue.ts';
import { staleTerrainWhy } from '../../core/terrain-age.ts';
import { installTarget } from '../mods.ts';
import { SLOT_TAGS, modTags, tagLabel } from '../tags.ts';
import { styleIndex, pickStyle, lookInstalled } from '../looks.ts';
import { canQueue, queueEntry } from '../queueing.ts';
import { favKey, isFav, toggleFavorite } from '../favorites.ts';
import { playablePreview } from '../preview.ts';
import { cssColor } from '../colors.ts';
import { Media } from './Media.tsx';
import { ToolMeta } from './ToolMeta.tsx';
import { useQueued, useTerrainMark } from './hooks.ts';
import { CardShell } from './CardShell.tsx';

interface CardProps {
  mod: Mod;
  index: number;
  /** say which category the mod is from: search results, favourites, the recent strip */
  withCat?: boolean;
  onOpen: (mod: Mod, card: HTMLElement) => void;
  /** after a star flips: the favourites list has to lose the card, anywhere else the rail recounts */
  onFavChanged: () => void;
  /** whether this card slides to its new place and fades out when it goes (the first screenful) */
  moves?: boolean;
  /** AnimatePresence holds a leaving card by this */
  ref?: Ref<HTMLDivElement>;
}

const stop = (e: MouseEvent) => e.stopPropagation();

export function ModCard({ mod: m, index, withCat = false, moves = false, onOpen, onFavChanged, ref }: CardProps) {
  const cat = m._cat || '';
  // read on every draw as well: the window can switch the look while the card stays put
  const look = styleIndex(cat, m);
  // read on every draw: the window's own star flips it too, and the grid redraws after
  const fav = isFav(cat, m.name);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const style = m.styles ? m.styles[look] ?? null : null;
  const installed = lookInstalled(cat, m);
  const entry = canQueue(cat, m) && !installed ? queueEntry(cat, m) : null;
  const queued = useQueued(entry?.key ?? null);
  const stale = useTerrainMark(cat, m);

  const isPack = m.type === 'pack';
  // a tool that is only a link says so under its name, in the row that also carries its pills
  const external = !installTarget(m) && !m.styles && !isPack && cat !== 'tools';
  /* Two chips, not three: the row is one line, and a 190px picture holding the looks as well has
   * room for about two words. Пак / Свой / Ссылка are about the mod itself, so they are counted
   * first and the tags take what is left; what a mod does comes before the slot it sits in. */
  const looks = m.styles ? Math.min(m.styles.length, 5) : 0;
  const badges = (isPack ? 1 : 0) + (m._custom ? 1 : 0) + (external ? 1 : 0);
  const room = Math.max(0, (looks > 2 ? 1 : 2) - badges);
  const labels = catalogConstants().TAG_CONFIGS?.[cat]?.map;
  const tags = modTags(m).sort((a, b) => (SLOT_TAGS.has(a) ? 1 : 0) - (SLOT_TAGS.has(b) ? 1 : 0)).slice(0, room);
  const playable = playablePreview(m);
  const author = typeof (m.author || m.sender) === 'string' ? String(m.author || m.sender) : '';
  const prev = previewUrl(cat, style?.preview || m.preview);

  const flipFav = async (e: MouseEvent) => {
    e.stopPropagation();
    await toggleFavorite(cat, m.name);
    redraw();
    onFavChanged();
  };
  const choose = (i: number) => (e: MouseEvent) => {
    e.stopPropagation();
    pickStyle(cat, m, i);
    redraw();
  };
  const favLabel = fav ? L`Убрать из избранного` : L`В избранное`;
  const addLabel = queued ? L`В списке установки` : L`Добавить в список`;

  return (
    <CardShell moves={moves} ref={ref} installed={installed} dataKey={keyOf(cat, m.name, null)} index={index}
      onClick={(e) => onOpen(m, e.currentTarget)}>
      <div className="card-media">
        <Media key={prev || ''} url={prev} hoverPlay fallbackIcon={catIcon(cat)} />
        <div className="card-actions">
          <button className={`fav-btn ${fav ? 'on' : ''}`} data-fav={favKey(cat, m.name)} data-owned="react"
            aria-pressed={fav} title={favLabel} aria-label={favLabel} onClick={flipFav}>
            <span className="ms">{fav ? 'favorite' : 'favorite_border'}</span>
          </button>
          {entry && (
            <button className={`card-add ${queued ? 'on' : ''}`} data-add={entry.key} data-owned="react"
              title={addLabel} aria-label={addLabel}
              onClick={(e) => { e.stopPropagation(); toggleQueued(queueEntry(cat, m)); }}>
              <span className="ms">{queued ? 'check' : 'add'}</span>
            </button>
          )}
        </div>
        {playable && (
          <button className="mtag-play" data-play={playable} data-title={m.name} aria-label={L`Смотреть превью`}
            onClick={(e) => { stop(e); openPlayer(playable, m.name); }}>
            <span className="ms">play_arrow</span>{L`Превью`}
          </button>
        )}
        <div className="media-tags" style={{ '--looks': looks } as CSSProperties}>
          {isPack && <span className="mtag">{L`Пак`}</span>}
          {stale && (
            <span className="mtag warn" title={staleTerrainWhy()} data-owned="react" hidden={stale === 'awaiting'}
              data-awaiting={stale === 'awaiting' ? 'old-map' : undefined} data-file={m.file}>{L`старая карта`}</span>
          )}
          {m._custom && <span className="mtag custom">{L`Свой`}</span>}
          {external && <span className="mtag">{L`Ссылка`}</span>}
          {tags.map((t) => <span key={t} className="mtag soft">{tagLabel(t, labels)}</span>)}
        </div>
        {m.styles && (
          <div className="media-swatches">
            {m.styles.slice(0, 5).map((s, i) => (
              <button key={i} className={`swatch-dot ${i === look ? 'active' : ''}`} data-style-dot={i}
                style={{ background: cssColor(s.color) }} title={s.label || tr('Обычный')} aria-label={s.label || tr('Обычный')}
                onClick={choose(i)} />
            ))}
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="card-name">{m.name}</div>
        {cat === 'tools'
          ? <ToolMeta mod={m} installed={installed} />
          : (withCat || author) && (
            <div className="card-meta">
              {withCat && <span>{catName(cat)}</span>}
              {author && <span className="author-chip"><span className="ms">person</span>{author}</span>}
            </div>
          )}
      </div>
    </CardShell>
  );
}
