/* One slot of free looks: its own search (a slot runs to thousands), the sort, and the two answers
 * about the user's own library, over a grid of the looks. The same rule as the mod grid for the
 * count: a number only once the list in front of you is a subset. */
import { SORTS } from '../../core/constants.js';
import type { ScreenActions, ScreenModel } from './model.ts';
import { CosmeticGrid } from '../cosmetic/CosmeticCard.tsx';

type Model = Extract<ScreenModel, { kind: 'cosmetics' }>;

export function CosmeticScreen({ m, actions }: { m: Model; actions: ScreenActions }) {
  return (
    <>
      <div className="view-header"><h1 className="view-title">{m.title}</h1></div>
      {/* This toolbar lays its controls out as a line of text (it has no .tb-line), so the
          spaces between them are part of the layout, as they were in the markup it replaced. */}
      <div className="toolbar">
        <div className="select-wrap">
          <span className="ms">sort</span>
          <select id="cosSort" value={m.sort} onChange={(e) => actions.cosmeticFilter({ sort: e.target.value })}>
            {SORTS.filter((s: { key: string }) => s.key !== 'date').map((s: { key: string; label: string }) => (
              <option key={s.key} value={s.key}>{tr(s.label)}</option>
            ))}
          </select>
        </div>{' '}
        <div className="tb-search cat-search">
          <span className="ms">search</span>
          <input type="text" id="cosSearch" placeholder={L`Поиск…`} value={m.search} autoComplete="off"
            onChange={(e) => actions.cosmeticFilter({ search: e.target.value })} />
        </div>{' '}
        <div className="sep" />{' '}
        <button className={`fchip ${m.installedOnly ? 'active' : ''}`} id="cosInstalledChip"
          onClick={() => actions.cosmeticFilter({ installedOnly: !m.installedOnly })}>
          <span className="ms">check_circle</span>{L`Установленные`}
        </button>{' '}
        <button className={`fchip ${m.favOnly ? 'active' : ''}`} id="cosFavChip" onClick={() => actions.cosmeticFilter({ favOnly: !m.favOnly })}>
          <span className="ms">favorite</span>{L`Избранное`}
        </button>{' '}
        <span className="count" id="cosCount">{m.count}</span>
      </div>
      <div className="grid" id="cosGrid">
        <CosmeticGrid items={m.items} emptyText={L`Ничего не найдено — сбрось фильтры`}
          onOpen={actions.openCosmetic} onFavChanged={actions.cosmeticFavChanged} />
      </div>
    </>
  );
}
