/* One slot of a hero: its wearables to choose from, the effects to put on top, and the button that
 * puts the choice on. Nothing reaches the game until it is pressed (views/item-builder.ts,
 * stagedItemAction): a pick used to be written on every click. The card the border marks is the
 * one chosen here; "Надето" is said only of what the game shows. */
import { catalogName } from '../../ui/catalog-name.ts';
import { useRef, type CSSProperties } from 'react';
import { plural } from '../../ui/format.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { SlotPickerActions, SlotPickerModel } from './model.ts';
import { BuilderFoot, BuilderHead, CosThumb, EmptySearch, PickerSearch } from './parts.tsx';

export function SlotPicker({ m, actions }: { m: SlotPickerModel; actions: SlotPickerActions }) {
  const search = useRef<HTMLInputElement>(null);
  const clear = () => {
    actions.search('');
    search.current?.focus();
  };
  return (
    <div className="modal-body item-picker-body">
      <BuilderHead back={m.back} onBack={actions.back} title={m.title} onClose={actions.close}
        sub={<><span>{L`вид для стандартного предмета`}</span><span>{`· ${m.optionsCount} ${plural(m.optionsCount, 'вариант', 'варианта', 'вариантов')}`}</span></>} />
      <PickerSearch id="itemSlotSearch" value={m.query} onChange={actions.search} inputRef={search} />
      <div className="item-pick-grid" id="itemPickGrid">
        {m.options.length ? m.options.map((o, i) => (
          <button key={o.id || 'stock'} className={`card item-pick-card ${o.picked ? 'picked' : ''} ${o.on ? 'installed' : ''}`}
            data-item-option={o.id} data-tags={o.tags} aria-pressed={o.picked}
            style={{ '--i': Math.min(i, 24) } as CSSProperties} onClick={() => actions.choose(o.id)}>
            <div className="card-media">
              {o.id === '' ? <div className="noimg"><span className="ms">block</span></div> : <CosThumb name={o.name} fallback={m.slotIcon} />}
            </div>
            <div className="card-body">
              <div className="card-name" title={o.name}>{cosmeticName(o.name)}</div>
              <div className="card-meta"><span>{o.on ? L`Надето` : o.tags || ' '}</span></div>
            </div>
          </button>
        )) : <EmptySearch onClear={clear} />}
      </div>
      {m.effects && (
        <>
          <div className="section-h item-fx-head"><span className="ms">auto_awesome</span>{L`Эффекты`}</div>
          <div className="text-meta item-fx-hint" id="itemFxHint">{m.effects.hint}</div>
          <div className="item-pick-grid" id="effectGrid">
            <button className={`card item-pick-card ${m.effects.none ? 'picked' : ''}`} data-effect-none="true"
              style={{ '--i': 0 } as CSSProperties} aria-pressed={m.effects.none} disabled={!m.effects.enabled}
              onClick={() => actions.effect('')}>
              <div className="card-media"><div className="noimg"><span className="ms">block</span></div></div>
              <div className="card-body"><div className="card-name">{L`Без эффектов`}</div></div>
            </button>
            {m.effects.list.map((fx, idx) => (
              <button key={fx.id} className={`card item-pick-card ${fx.picked ? 'picked' : ''}`} data-effect-id={fx.id}
                style={{ '--i': idx + 1 } as CSSProperties} aria-pressed={fx.picked} disabled={!m.effects?.enabled}
                onClick={() => actions.effect(fx.id)}>
                <div className="card-media">
                  {fx.picture
                    ? <span className="card-thumb"><img src={fx.picture} alt="" loading="lazy" /></span>
                    : <div className="noimg"><span className="ms">auto_awesome</span></div>}
                </div>
                <div className="card-body"><div className="card-name" title={fx.name}>{catalogName(fx.name)}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="modal-note">{L`Вид подставляется в схему предметов игры — стандартный предмет просто рисуется как выбранный. Файлы модов это не трогает, и видно только тебе.`}</div>
      <div className="item-picker-foot" id="itemPickFoot">
        <BuilderFoot action={m.action} onApply={actions.apply}
          summary={<><b>{cosmeticName(m.summary.name)}</b>{m.summary.effects ? ` · ${m.summary.effects}` : ''}</>} />
      </div>
    </div>
  );
}
