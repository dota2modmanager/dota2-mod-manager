/* The item builder's front: every hero whose items the game's own table lets it build, with what is
 * on the hero rather than how many slots it has (92 of 124 heroes have four to six, so "5 slots"
 * told nobody anything). A hero opens its window (builder/HeroModal.tsx). */
import type { CSSProperties } from 'react';
import type { ScreenActions, ScreenModel } from './model.ts';

type Model = Extract<ScreenModel, { kind: 'builder' }>;

export function BuilderHub({ m, actions }: { m: Model; actions: ScreenActions }) {
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
      <div id="itemHub">
        {m.heroes.length ? (
          <div className="grid">
            {m.heroes.map((h, i) => (
              <div key={h.hero} className={`card ${h.installed ? 'installed' : ''}`} data-item-hero={h.hero}
                style={{ '--i': Math.min(i, 28) } as CSSProperties} onClick={(e) => actions.openHero(h.hero, e.currentTarget)}>
                <div className="card-media">
                  <span className="card-thumb">
                    {h.icon ? <img src={h.icon} alt="" loading="lazy" /> : <div className="noimg"><span className="ms">person</span></div>}
                  </span>
                </div>
                <div className="card-body">
                  <div className="card-name">{h.hero}</div>
                  <div className="card-meta"><span>{h.meta}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="empty-note">{L`Ничего не найдено — сбрось фильтры`}</div>}
      </div>
    </>
  );
}
