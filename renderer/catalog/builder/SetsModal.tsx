/* A hero's sets, and one set: every piece of it put on in one write (src/item-builder.ts itemSets).
 * A piece the builder cannot put on stays in the picture, dimmed, with why: it is part of what the
 * set looks like, and without it "4 of 6" would not add up. */
import { useRef, type CSSProperties } from 'react';
import { plural } from '../../ui/format.ts';
import { heroName } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { SetModalActions, SetModalModel, SetsModalActions, SetsModalModel } from './model.ts';
import { BuilderFoot, BuilderHead, CosThumb, EmptySearch, PickerSearch } from './parts.tsx';
import { Dropdown } from '../../ui/Dropdown.tsx';

const stagger = (i: number) => ({ '--i': Math.min(i, 24) }) as CSSProperties;

export function SetsModal({ m, actions }: { m: SetsModalModel; actions: SetsModalActions }) {
  const search = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-body item-picker-body">
      <BuilderHead back={heroName(m.hero)} onBack={actions.back} title={L`Наборы`} onClose={actions.close}
        sub={<span>{`${m.count} ${plural(m.count, 'набор', 'набора', 'наборов')}`}</span>} />
      <PickerSearch id="itemSetSearch" value={m.query} onChange={actions.search} inputRef={search} />
      <SetsToolbar m={m} actions={actions} />
      <div className="item-pick-grid" id="itemSetGrid">
        {m.sets.length ? m.sets.map((s, i) => (
          <button key={s.id} className={`card item-pick-card ${s.on ? 'installed' : ''}`} data-item-set={s.id} data-rarity={s.rarity || undefined} style={stagger(i)}
            onClick={() => actions.open(s.id)}>
            <div className="card-media"><CosThumb name={s.name} fallback="inventory_2" /></div>
            <div className="card-body">
              <div className="card-name" title={s.name}>{cosmeticName(s.name)}</div>
              <div className="card-meta">
                {s.rarityName && <span className="set-rarity">{s.rarityName}</span>}
                {s.year && <span>{s.year}</span>}
                {s.meta.trim() && <span>{s.meta}</span>}
              </div>
            </div>
          </button>
        )) : <EmptySearch onClear={() => { actions.search(''); actions.reset(); search.current?.focus(); }} />}
      </div>
    </div>
  );
}

const SORTS = (): { value: string; label: string }[] => [
  { value: 'name', label: L`По названию` }, { value: 'new', label: L`Сначала новые` },
  { value: 'old', label: L`Сначала старые` }, { value: 'rare', label: L`Сначала редкие` },
];

/** Sort and filters over a hero's sets (catalog/builder/set-filters.ts); a filter the hero's sets cannot use is not shown. */
function SetsToolbar({ m, actions }: { m: SetsModalModel; actions: SetsModalActions }) {
  const f = m.filters;
  const years = m.facets.years.map((y) => ({ value: y, label: y }));
  return (
    <div className="tb-line set-toolbar">
      <Dropdown icon="sort" id="setSort" label={L`Сортировка`} value={f.sort} options={SORTS()}
        onPick={(sort) => actions.filter({ sort: sort as typeof f.sort })} />
      {m.facets.rarities.length > 1 && (
        <Dropdown icon="diamond" id="setRarity" label={L`Редкость`} value={f.rarity} first={L`Редкость`}
          options={m.facets.rarities} onPick={(rarity) => actions.filter({ rarity })} />
      )}
      {years.length > 1 && (
        <>
          <Dropdown icon="event" id="setFrom" label={L`С года`} value={f.from} first={L`С года`} options={years} onPick={(from) => actions.filter({ from })} />
          <Dropdown icon="event" id="setTo" label={L`По год`} value={f.to} first={L`По год`} options={years} onPick={(to) => actions.filter({ to })} />
        </>
      )}
      {m.facets.events.length > 0 && (
        <Dropdown icon="celebration" id="setEvent" label={L`Событие`} value={f.event} first={L`Событие`}
          options={m.facets.events.map((e) => ({ value: e, label: e }))} onPick={(event) => actions.filter({ event })} />
      )}
      {m.facets.styled && (
        <button className={`fchip ${f.styled ? 'active' : ''}`} id="setStyled" onClick={() => actions.filter({ styled: !f.styled })}>
          <span className="ms">palette</span>{L`Со стилями`}
        </button>
      )}
      {m.active > 0 && (
        <button className="btn btn-sm btn-ghost" id="setReset" onClick={actions.reset}><span className="ms">filter_alt_off</span>{L`Сбросить`}</button>
      )}
    </div>
  );
}

export function SetModal({ m, actions }: { m: SetModalModel; actions: SetModalActions }) {
  return (
    <div className="modal-body item-picker-body">
      <BuilderHead back={L`Наборы`} onBack={actions.back} title={cosmeticName(m.name)} onClose={actions.close}
        sub={<><span>{heroName(m.hero)}</span><span>{`· ${m.count}`}</span></>} />
      {(m.facts.rarityName || m.facts.date || m.facts.event) && (
        <div className="set-facts" data-rarity={m.facts.rarity || undefined}>
          {m.facts.rarityName && <span className="set-rarity">{m.facts.rarityName}</span>}
          {m.facts.date && <span>{m.facts.date}</span>}
          {m.facts.event && <span>{m.facts.event}</span>}
        </div>
      )}
      {m.facts.description && <div className="set-desc">{m.facts.description}</div>}
      {m.styles && (
        <div className="set-styles" role="group" aria-label={L`Стиль набора`}>
          <span className="set-styles-label">{L`Стиль`}</span>
          {m.styles.map((st) => (
            <button key={st.index} className={`fchip ${st.picked ? 'active' : ''}`} data-set-style={st.index} aria-pressed={st.picked}
              onClick={() => actions.style(st.index)}>{st.name}</button>
          ))}
        </div>
      )}
      <div className="item-pick-grid">
        {m.pieces.map((p) => {
          const cls = `card item-pick-card item-piece ${p.fits ? '' : 'is-disabled'} ${p.on ? 'installed' : ''}`;
          const body = (
            <>
              <div className="card-media"><CosThumb name={p.name} fallback="checkroom" /></div>
              <div className="card-body">
                <div className="card-name" title={p.name}>{cosmeticName(p.name)}</div>
                <div className="card-meta"><span>{p.meta}</span></div>
              </div>
            </>
          );
          // typed into the search, so the one card sits right above the effects
          return p.fits
            ? <button key={p.index} className={cls} data-piece={p.index} style={stagger(p.index)} onClick={() => actions.piece(p.index)}>{body}</button>
            : <div key={p.index} className={cls} style={stagger(p.index)}>{body}</div>;
        })}
      </div>
      <div className="modal-note">{L`Набор надевается без эффектов. Чтобы добавить эффект, открой деталь.`}</div>
      <div className="item-picker-foot">
        <BuilderFoot action={m.action} onApply={actions.apply} summary={<><b>{cosmeticName(m.name)}</b>{` · ${m.count}`}</>} />
      </div>
    </div>
  );
}
