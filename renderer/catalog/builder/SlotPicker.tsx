/* One slot of a hero: its wearables to choose from, the chosen one's styles when it has several,
 * the effects to put on top, and the button that puts the choice on. Nothing reaches the game until it is pressed (views/item-builder.ts,
 * stagedItemAction): a pick used to be written on every click. The card the border marks is the
 * one chosen here; "Надето" is said only of what the game shows. */
import { catalogName } from '../../ui/catalog-name.ts';
import { useRef, type CSSProperties } from 'react';
import { plural } from '../../ui/format.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { SlotPickerActions, SlotPickerModel } from './model.ts';
import { BuilderFoot, BuilderHead, CosThumb, EmptySearch, PickerSearch } from './parts.tsx';

/** The words on an item's note tag (src/arcana-notes.ts); the note itself is its tooltip, and the
 *  chosen item's note is spelled out under its name at the foot, beside the button that puts it on. */
const NOTE_TAG = { issues: () => L`Есть баги`, broken: () => L`Сломана`, untested: () => L`Не проверено` } as const;

export function SlotPicker({ m, actions }: { m: SlotPickerModel; actions: SlotPickerActions }) {
  const search = useRef<HTMLInputElement>(null);
  const noted = m.options.find((o) => o.picked && o.note)?.note;
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
              {o.note && <div className="media-tags"><span className="mtag warn" title={o.note.text}>{NOTE_TAG[o.note.status]()}</span></div>}
            </div>
            <div className="card-body">
              <div className="card-name" title={o.name}>{cosmeticName(o.name)}</div>
              <div className="card-meta"><span>{o.on ? L`Надето` : o.tags || ' '}</span></div>
            </div>
          </button>
        )) : <EmptySearch onClear={clear} />}
      </div>
      {m.styles && (
        <>
          <div className="section-h item-fx-head"><span className="ms">palette</span>{L`Стиль`}</div>
          <div className="item-pick-grid" id="styleGrid">
            {m.styles.map((s) => (
              <button key={s.index} className={`card item-pick-card ${s.picked ? 'picked' : ''}`} data-style={s.index}
                style={{ '--i': s.index } as CSSProperties} aria-pressed={s.picked} onClick={() => actions.style(s.index)}>
                <div className="card-media"><div className="noimg"><span className="ms">palette</span></div></div>
                <div className="card-body"><div className="card-name" title={s.name}>{s.name}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
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
          {m.effects.game.length > 0 && (
            <>
              <div className="text-meta item-fx-hint">{L`Эффекты из игры, как у необычных курьеров. Свечение глаз не садится, поэтому его здесь нет.`}</div>
              <div className="item-fx-game" id="gameEffectRow">
                {m.effects.game.map((fx) => (
                  <button key={fx.id} className={`style-btn ${fx.picked ? 'active' : ''}`} data-effect-id={fx.id} aria-pressed={fx.picked}
                    disabled={!m.effects?.enabled} onClick={() => actions.effect(fx.id)}>{fx.name}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {m.donors && (
        <>
          <div className="section-h item-fx-head"><span className="ms">swap_horiz</span>{L`Эффект другого предмета`}</div>
          <div className="text-meta item-fx-hint" id="itemDonorHint">
            {m.donors.enabled ? L`Частицы этого предмета на выбранном. Эффект, который держится на точке своей модели, может сесть иначе.` : L`Сначала выбери предмет выше.`}
          </div>
          <div className="item-pick-grid" id="donorGrid">
            <button className={`card item-pick-card ${m.donors.none ? 'picked' : ''}`} data-donor-none="true"
              style={{ '--i': 0 } as CSSProperties} aria-pressed={m.donors.none} disabled={!m.donors.enabled} onClick={() => actions.donor('')}>
              <div className="card-media"><div className="noimg"><span className="ms">block</span></div></div>
              <div className="card-body"><div className="card-name">{L`Свой эффект`}</div></div>
            </button>
            {m.donors.list.map((o, idx) => (
              <button key={o.id} className={`card item-pick-card ${o.picked ? 'picked' : ''}`} data-donor-id={o.id}
                style={{ '--i': Math.min(idx + 1, 24) } as CSSProperties} aria-pressed={o.picked} disabled={!m.donors?.enabled}
                onClick={() => actions.donor(o.id)}>
                <div className="card-media"><CosThumb name={o.name} fallback={m.slotIcon} /></div>
                <div className="card-body"><div className="card-name" title={o.name}>{cosmeticName(o.name)}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="modal-note">{L`Вид подставляется в схему предметов игры — стандартный предмет просто рисуется как выбранный. Файлы модов это не трогает, и видно только тебе.`}</div>
      <div className="item-picker-foot" id="itemPickFoot">
        <BuilderFoot action={m.action} onApply={actions.apply}
          summary={<><b>{cosmeticName(m.summary.name)}</b>{m.summary.effects ? ` · ${m.summary.effects}` : ''}
            {noted && <span className="item-note" role="note"><span className="ms">warning</span>{noted.text}</span>}</>} />
      </div>
    </div>
  );
}
