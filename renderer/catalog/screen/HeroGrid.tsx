/* The heroes category as the game's hero grid, the same one the item builder opens on
 * (BuilderHub.tsx), and drawn the same way: four columns side by side, strength, agility,
 * intelligence, universal, each alphabetical, of the game's own upright portraits with no number
 * on them. The name shows on hover, a tick marks a hero with something installed, a click opens
 * that hero's mods.
 *
 * Every hero is here, whatever the list view was narrowed to: the grid is for finding a hero, so
 * its bar is a search and the switch to the list, and the sort, authors, tags and the two library
 * chips wait in the list, where they have mods to narrow.
 *
 * The attribute comes from the game's own item table. Without it (no game found yet) the heroes
 * stay one alphabetical grid of wide tiles with their names and a mod's picture standing in: four
 * columns of nothing but "other" would be the same list drawn worse. */
import { useState, type CSSProperties } from 'react';
import { heroName } from '../../ui/hero-name.ts';
import type { HeroTileModel, ScreenActions } from './model.ts';

const ORDER: HeroTileModel['attr'][] = ['str', 'agi', 'int', 'all', 'other'];
/** The groups' names, as the game's hero grid heads them (views/item-hub.ts says the same). */
const NAMES = (): Record<HeroTileModel['attr'], string> => ({
  str: L`Сила`, agi: L`Ловкость`, int: L`Интеллект`, all: L`Универсальные`, other: L`Другие`,
});
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function HeroGrid({ tiles, actions }: { tiles: HeroTileModel[]; actions: ScreenActions }) {
  const [search, setSearch] = useState('');
  if (!tiles.length) return <div className="empty-note">{L`Ничего не найдено — сбрось фильтры`}</div>;
  const flat = tiles.every((t) => t.attr === 'other');
  const q = fold(search);
  // the mods that name no hero are not a hero: they stay in the list, not as a tile among portraits
  const heroes = flat ? tiles : tiles.filter((t) => t.hero);
  const shown = q ? heroes.filter((t) => fold(t.hero).includes(q) || fold(heroName(t.hero)).includes(q)) : heroes;
  return (
    <>
      <div className="toolbar">
        <div className="tb-line">
          <div className="tb-search cat-search">
            <span className="ms">search</span>
            <input type="text" id="heroSearch" placeholder={L`Поиск…`} value={search} autoComplete="off"
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="layout-toggle" role="group" aria-label={L`Вид`}>
            <button className="seg-btn active" data-layout="grid"
              onClick={() => actions.layout('grid')}>
              <span className="ms">grid_view</span>{L`Сеткой героев`}
            </button>
            <button className="seg-btn" data-layout="list"
              onClick={() => actions.layout('list')}>
              <span className="ms">view_agenda</span>{L`Все моды списком`}
            </button>
          </div>
        </div>
      </div>
      {!shown.length ? <div className="empty-note">{L`Ничего не найдено`}</div>
        : flat ? <FlatGrid tiles={shown} actions={actions} /> : <Columns tiles={shown} actions={actions} />}
    </>
  );
}

function Columns({ tiles, actions }: { tiles: HeroTileModel[]; actions: ScreenActions }) {
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
                // only the hero's own portrait: a mod's picture in this grid reads as another hero
                const art = t.standIn ? null : t.art;
                return (
                  <button key={t.hero} className={`hero-tile hub-tile ${t.installed ? 'installed' : ''} ${art ? '' : 'no-art'}`} data-hero={t.hero}
                    style={{ '--i': Math.min(i++, 40) } as CSSProperties} title={name} aria-label={name} onClick={() => actions.pickHero(t.hero)}>
                    <span className="hero-art">{art ? <img decoding="async" src={art} alt="" loading="lazy" /> : <span className="ms">person</span>}</span>
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
                ? <img decoding="async" src={t.art} alt="" loading="lazy" className={t.standIn ? 'stand-in' : undefined} />
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
