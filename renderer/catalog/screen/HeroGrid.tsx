/* The heroes category as the game's hero grid, the same one the item builder opens on
 * (BuilderHub.tsx): four columns side by side, strength, agility, intelligence, universal, each
 * alphabetical, of upright portraits. A tile carries how many mods the hero has and a tick when one
 * of them is installed; the name shows on hover. A click opens that hero's mods.
 *
 * The attribute comes from the game's own item table. Without it (no game found yet) the heroes
 * stay one alphabetical grid of wide tiles with their names, as before: four columns of nothing but
 * "other" would be the same list drawn worse. */
import type { CSSProperties } from 'react';
import { heroName } from '../../ui/hero-name.ts';
import type { HeroTileModel, ScreenActions } from './model.ts';

const ORDER: HeroTileModel['attr'][] = ['str', 'agi', 'int', 'all', 'other'];
/** The groups' names, as the game's hero grid heads them (views/item-hub.ts says the same). */
const NAMES = (): Record<HeroTileModel['attr'], string> => ({
  str: L`Сила`, agi: L`Ловкость`, int: L`Интеллект`, all: L`Универсальные`, other: L`Другие`,
});

export function HeroGrid({ tiles, actions }: { tiles: HeroTileModel[]; actions: ScreenActions }) {
  if (!tiles.length) return <div className="empty-note">{L`Ничего не найдено — сбрось фильтры`}</div>;
  if (tiles.every((t) => t.attr === 'other')) return <FlatGrid tiles={tiles} actions={actions} />;
  const names = NAMES();
  let i = 0;
  return (
    <div className="hub-columns hero-columns" id="heroGrid">
      {ORDER.map((attr) => {
        const group = tiles.filter((t) => t.attr === attr);
        if (!group.length) return null;
        return (
          <section key={attr} className="hub-group" data-attr={attr}>
            <h2 className="hub-group-title"><span className="hub-attr" aria-hidden="true" />{names[attr]}<span className="hub-group-count">{group.length}</span></h2>
            <div className="hub-grid">
              {group.map((t) => {
                const name = heroName(t.hero) || tr('Прочее');
                return (
                  <button key={t.hero} className={`hero-tile hub-tile ${t.installed ? 'installed' : ''}`} data-hero={t.hero}
                    style={{ '--i': Math.min(i++, 40) } as CSSProperties} title={name} aria-label={name} onClick={() => actions.pickHero(t.hero)}>
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
          </section>
        );
      })}
    </div>
  );
}

function FlatGrid({ tiles, actions }: { tiles: HeroTileModel[]; actions: ScreenActions }) {
  return (
    <div className="hero-grid" id="heroGrid">
      {tiles.map((t, i) => {
        const name = heroName(t.hero) || tr('Прочее');
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
