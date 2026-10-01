/* The heroes category as a grid of heroes: a tile per hero with how many mods it has, and a tick
 * when one of them is installed. Portraits come out of the player's own game; without one, the
 * first of the hero's mods stands in, which is still that hero and still not a grey box. */
import type { CSSProperties } from 'react';
import type { HeroTileModel, ScreenActions } from './model.ts';

export function HeroGrid({ tiles, actions }: { tiles: HeroTileModel[]; actions: ScreenActions }) {
  if (!tiles.length) return <div className="empty-note">{L`Ничего не найдено — сбрось фильтры`}</div>;
  return (
    <div className="hero-grid" id="heroGrid">
      {tiles.map((t, i) => {
        const name = t.hero || tr('Прочее');
        return (
          <button key={t.hero} className={`hero-tile ${t.installed ? 'installed' : ''}`} data-hero={t.hero}
            style={{ '--i': Math.min(i, 40) } as CSSProperties} title={name} onClick={() => actions.pickHero(t.hero)}>
            <span className="hero-art">
              {t.art
                ? <img src={t.art} alt="" loading="lazy" className={t.standIn ? 'stand-in' : undefined} />
                : <span className="ms">person</span>}
            </span>
            <span className="hero-count">{t.count}</span>
            {t.installed && <span className="hero-installed ms" aria-hidden="true">check_circle</span>}
            <span className="hero-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
