/* One slot of a hero, the right side of its window: tabs over a grid, the slot's items, the chosen
 * one's styles, the effects to put on top and another item's effect, and the button that puts the
 * choice on. Nothing reaches the game until it is pressed (views/item-builder.ts, stagedItemAction):
 * a pick used to be written on every click. The card the border marks is the one chosen here;
 * "Надето" is said only of what the game shows.
 *
 * The four used to sit one under another in a window that scrolled past the screen; a person who
 * came for an effect scrolled through every item of the slot to reach it. */
import { useRef, type CSSProperties } from 'react';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { SlotPaneActions, SlotPaneModel, SlotView } from './model.ts';
import type { EffectGroup } from './logic.ts';
import { BuilderFoot, CosThumb, EmptySearch, FxThumb, PickerSearch } from './parts.tsx';

/** The words on an item's note tag (src/arcana-notes.ts); the note itself is its tooltip, and the
 *  chosen item's note is spelled out under its name at the foot, beside the button that puts it on. */
const NOTE_TAG = { issues: () => L`Есть баги`, broken: () => L`Сломана`, untested: () => L`Не проверено` } as const;

const SHELF: Record<EffectGroup, () => string> = {
  unusual: () => L`Необычные`, seasonal: () => L`Сезонные`, courier: () => L`От курьеров`,
};

const stagger = (i: number) => ({ '--i': Math.min(i, 24) }) as CSSProperties;

/** An effect without a picture of its own: a tile coloured by its name, so the shelf is not a wall of one glyph. */
const hue = (name: string) => ({ '--fx-hue': [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) }) as CSSProperties;

export function SlotPane({ m, actions }: { m: SlotPaneModel; actions: SlotPaneActions }) {
  const search = useRef<HTMLInputElement>(null);
  const noted = m.options.find((o) => o.picked && o.note)?.note;
  const picked = m.options.find((o) => o.picked && o.id);
  const clear = () => {
    actions.search('');
    search.current?.focus();
  };
  const tabs: { id: SlotView; label: string; count: number | string; off?: boolean; hint?: string }[] = [
    { id: 'items', label: L`Предметы`, count: m.optionsCount + 1 },
    ...(m.styles ? [{ id: 'styles' as const, label: L`Стиль`, count: m.styles.length }] : []),
    ...(m.effects ? [{ id: 'effects' as const, label: L`Эффекты`, count: m.effects.picked ? `${m.effects.picked} / ${m.effects.count}` : m.effects.count,
      off: !m.effects.enabled, hint: L`Эффект добавляется к предмету: сначала выбери его.` }] : []),
    ...(m.donors ? [{ id: 'donors' as const, label: L`Эффект другого предмета`, count: m.donors.count, off: !m.donors.enabled, hint: L`Сначала выбери предмет.` }] : []),
  ];
  return (
    <div className="ward-slot">
      <div className="ward-pane-head">
        <h3 className="ward-pane-title">{m.title}</h3>
        <div className="ward-tabs" role="tablist" aria-label={m.title}>
          {tabs.map((t) => (
            <button key={t.id} role="tab" className={`ward-tab ${m.view === t.id ? 'active' : ''}`} data-slot-view={t.id} aria-selected={m.view === t.id}
              disabled={t.off} title={t.off ? t.hint : undefined} onClick={() => actions.view(t.id)}>
              {t.label}<span className="ward-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        {m.view !== 'styles' && <PickerSearch id="itemSlotSearch" value={m.query} onChange={actions.search} inputRef={search} />}
      </div>
      <div className="ward-scroll" key={m.view}>
        {m.view === 'items' && (
          <div className="item-pick-grid ward-grid" id="itemPickGrid">
            {m.options.length ? m.options.map((o, i) => (
              <button key={o.id || 'stock'} className={`card item-pick-card ${o.picked ? 'picked' : ''} ${o.on ? 'installed' : ''}`}
                data-item-option={o.id} data-rarity={o.rarity || undefined} aria-pressed={o.picked}
                style={stagger(i)} onClick={() => actions.choose(o.id)}>
                <div className="card-media">
                  {o.id === '' ? <div className="noimg"><span className="ms">block</span></div> : <CosThumb name={o.name} fallback={m.slotIcon} />}
                  {o.note && <div className="media-tags"><span className="mtag warn" title={o.note.text}>{NOTE_TAG[o.note.status]()}</span></div>}
                </div>
                <div className="card-body">
                  <div className="card-name" title={o.name}>{cosmeticName(o.name)}</div>
                  <div className="card-meta">
                    {o.on ? <span className="ward-on">{L`Надето`}</span>
                      : <>{o.rarityName && <span className="set-rarity">{o.rarityName}</span>}{o.year && <span>{o.year}</span>}</>}
                  </div>
                </div>
              </button>
            )) : <EmptySearch onClear={clear} />}
          </div>
        )}
        {m.view === 'styles' && m.styles && (
          <div className="item-pick-grid ward-grid" id="styleGrid">
            {m.styles.map((s) => (
              <button key={s.index} className={`card item-pick-card ${s.picked ? 'picked' : ''}`} data-style={s.index}
                style={stagger(s.index)} aria-pressed={s.picked} onClick={() => actions.style(s.index)}>
                <div className="card-media"><CosThumb name={picked?.name || null} fallback="palette" /></div>
                <div className="card-body"><div className="card-name" title={s.name}>{s.name}</div></div>
              </button>
            ))}
          </div>
        )}
        {m.view === 'effects' && m.effects && (
          <div id="effectGrid" className="ward-shelves">
            <div className="ward-shelf-note">
              <span>{L`Можно выбрать несколько. Названия как в игре.`}</span>
              {m.effects.picked > 0 && (
                <button className="btn btn-sm btn-ghost" data-effect-none="true" onClick={() => actions.effect('')}>
                  <span className="ms">block</span>{L`Без эффектов`}
                </button>
              )}
            </div>
            {m.effects.groups.length ? m.effects.groups.map((g) => (
              <section key={g.group} className="ward-shelf" data-group={g.group}>
                <h4 className="ward-shelf-title">{SHELF[g.group]()}<span className="ward-tab-count">{g.list.length}</span></h4>
                <div className="item-pick-grid ward-grid fx-grid">
                  {g.list.map((fx, idx) => (
                    <button key={fx.id} className={`card item-pick-card fx-card ${fx.picked ? 'picked' : ''}`} data-effect-id={fx.id}
                      style={{ ...stagger(idx), ...(fx.picture ? {} : hue(fx.name)) }} aria-pressed={fx.picked} onClick={() => actions.effect(fx.id)}>
                      <div className="card-media">
                        <FxThumb id={fx.id} picture={fx.picture} />
                        {fx.picked && <span className="fx-check ms" aria-hidden="true">check_circle</span>}
                      </div>
                      <div className="card-body"><div className="card-name" title={fx.name}>{fx.name}</div></div>
                    </button>
                  ))}
                </div>
              </section>
            )) : <EmptySearch onClear={clear} />}
            <div className="ward-shelf-note">{L`Свечение глаз не садится на предмет, поэтому его здесь нет.`}</div>
          </div>
        )}
        {m.view === 'donors' && m.donors && (
          <>
            <div className="ward-shelf-note" id="itemDonorHint">{L`Частицы этого предмета на выбранном. Эффект, который держится на точке своей модели, может сесть иначе.`}</div>
            <div className="item-pick-grid ward-grid" id="donorGrid">
              <button className={`card item-pick-card ${m.donors.none ? 'picked' : ''}`} data-donor-none="true"
                style={stagger(0)} aria-pressed={m.donors.none} onClick={() => actions.donor('')}>
                <div className="card-media"><div className="noimg"><span className="ms">block</span></div></div>
                <div className="card-body"><div className="card-name">{L`Свой эффект`}</div></div>
              </button>
              {m.donors.list.map((o, idx) => (
                <button key={o.id} className={`card item-pick-card ${o.picked ? 'picked' : ''}`} data-donor-id={o.id}
                  style={stagger(idx + 1)} aria-pressed={o.picked} onClick={() => actions.donor(o.id)}>
                  <div className="card-media"><CosThumb name={o.name} fallback={m.slotIcon} /></div>
                  <div className="card-body"><div className="card-name" title={o.name}>{cosmeticName(o.name)}</div></div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="item-picker-foot" id="itemPickFoot">
        <BuilderFoot action={m.action} onApply={actions.apply}
          summary={<><b>{cosmeticName(m.summary.name)}</b>{m.summary.effects ? ` · ${m.summary.effects}` : ''}
            {noted && <span className="item-note" role="note"><span className="ms">warning</span>{noted.text}</span>}</>} />
      </div>
    </div>
  );
}
