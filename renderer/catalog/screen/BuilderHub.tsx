/* The item builder's front: every hero whose items the game's own table lets it build, laid out as
 * the game's hero grid: four columns side by side (strength, agility, intelligence, universal, each
 * alphabetical) of upright portraits without names, so a hero is found where a player already looks
 * for it. The name shows on hover and in the tooltip with what the hero wears; a tick marks a hero
 * wearing something. A hero opens its window (builder/HeroModal.tsx). */
import type { CSSProperties } from 'react';
import { heroName } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { ScreenActions, ScreenModel } from './model.ts';

type Model = Extract<ScreenModel, { kind: 'builder' }>;

export function BuilderHub({ m, actions }: { m: Model; actions: ScreenActions }) {
  let i = 0;
  return (
    <>
      <div className="view-header"><h1 className="view-title">{m.title}</h1></div>
      <div className="toolbar">
        <div className="tb-line">
          <div className="tb-search cat-search">
            <span className="ms">search</span>
            <input type="text" id="cosSearch" placeholder={L`Поиск…`} value={m.search} autoComplete="off"
              onChange={(e) => actions.cosmeticFilter({ search: e.target.value })} />
          </div>
          <div className="sep" />
          <button className={`fchip ${m.installedOnly ? 'active' : ''}`} id="cosInstalledChip"
            onClick={() => actions.cosmeticFilter({ installedOnly: !m.installedOnly })}>
            <span className="ms">check_circle</span>{L`Надетые`}
          </button>
          <span className="count" id="cosCount">{m.count}</span>
        </div>
      </div>
      <div id="itemHub" className="hub-columns">
        {m.groups.length ? m.groups.map((g) => (
          <section key={g.attr} className="hub-group" data-attr={g.attr}>
            <h2 className="hub-group-title"><span className="hub-attr" aria-hidden="true" />{g.name}<span className="hub-group-count">{g.heroes.length}</span></h2>
            <div className="hub-grid">
              {g.heroes.map((h) => {
                const name = heroName(h.hero);
                return (
                  <button key={h.hero} className={`hero-tile hub-tile ${h.installed ? 'installed' : ''}`} data-item-hero={h.hero} aria-label={name}
                    style={{ '--i': Math.min(i++, 40) } as CSSProperties} title={`${name}\n${cosmeticName(h.meta)}`}
                    onClick={(e) => actions.openHero(h.hero, e.currentTarget)}>
                    <span className="hero-art">{h.icon ? <img src={h.icon} alt="" loading="lazy" /> : <span className="ms">person</span>}</span>
                    {h.installed && <span className="hero-installed ms" aria-hidden="true">check_circle</span>}
                    <span className="hero-name">{name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )) : <div className="empty-note">{L`Ничего не найдено — сбрось фильтры`}</div>}
      </div>
    </>
  );
}
