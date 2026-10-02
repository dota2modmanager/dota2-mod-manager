/* A hero's sets, and one set: every piece of it put on in one write (src/item-builder.ts itemSets).
 * A piece the builder cannot put on stays in the picture, dimmed, with why: it is part of what the
 * set looks like, and without it "4 of 6" would not add up. */
import { useRef, type CSSProperties } from 'react';
import { plural } from '../../ui/format.ts';
import type { SetModalActions, SetModalModel, SetsModalActions, SetsModalModel } from './model.ts';
import { BuilderFoot, BuilderHead, CosThumb, EmptySearch, PickerSearch } from './parts.tsx';

const stagger = (i: number) => ({ '--i': Math.min(i, 24) }) as CSSProperties;

export function SetsModal({ m, actions }: { m: SetsModalModel; actions: SetsModalActions }) {
  const search = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-body item-picker-body">
      <BuilderHead back={m.hero} onBack={actions.back} title={L`Наборы`} onClose={actions.close}
        sub={<span>{`${m.count} ${plural(m.count, 'набор', 'набора', 'наборов')}`}</span>} />
      <PickerSearch id="itemSetSearch" value={m.query} onChange={actions.search} inputRef={search} />
      <div className="item-pick-grid" id="itemSetGrid">
        {m.sets.length ? m.sets.map((s, i) => (
          <button key={s.id} className={`card item-pick-card ${s.on ? 'installed' : ''}`} data-item-set={s.id} style={stagger(i)}
            onClick={() => actions.open(s.id)}>
            <div className="card-media"><CosThumb name={s.name} fallback="inventory_2" /></div>
            <div className="card-body">
              <div className="card-name">{s.name}</div>
              <div className="card-meta"><span>{s.meta}</span></div>
            </div>
          </button>
        )) : <EmptySearch onClear={() => { actions.search(''); search.current?.focus(); }} />}
      </div>
    </div>
  );
}

export function SetModal({ m, actions }: { m: SetModalModel; actions: SetModalActions }) {
  return (
    <div className="modal-body item-picker-body">
      <BuilderHead back={L`Наборы`} onBack={actions.back} title={m.name} onClose={actions.close}
        sub={<><span>{m.hero}</span><span>{`· ${m.count}`}</span></>} />
      <div className="item-pick-grid">
        {m.pieces.map((p) => {
          const cls = `card item-pick-card item-piece ${p.fits ? '' : 'is-disabled'} ${p.on ? 'installed' : ''}`;
          const body = (
            <>
              <div className="card-media"><CosThumb name={p.name} fallback="checkroom" /></div>
              <div className="card-body">
                <div className="card-name">{p.name}</div>
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
        <BuilderFoot action={m.action} onApply={actions.apply} summary={<><b>{m.name}</b>{` · ${m.count}`}</>} />
      </div>
    </div>
  );
}
