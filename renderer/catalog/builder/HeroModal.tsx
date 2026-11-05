/* A hero's window in the item builder, its changing room, laid out as the game's loadout: the hero
 * on the left (its portrait, or the 3D view), its tabs down the middle (the sets, each slot with
 * what is on it and a way to take it off, the looks saved for it), and the tab's grid on the
 * right. The window keeps one size whatever the tab: only the grid scrolls. */
import { plural } from '../../ui/format.ts';
import { heroName } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { HeroModalActions, HeroModalModel, HeroPane } from './model.ts';
import { CosThumb } from './parts.tsx';
import { SlotPane } from './SlotPane.tsx';
import { SetPane, SetsPane } from './SetsPane.tsx';
import { LooksPane } from './LooksPane.tsx';
import { Preview3d } from '../preview3d/Preview3d.tsx';

export function HeroModal({ m, actions }: { m: HeroModalModel; actions: HeroModalActions }) {
  const name = heroName(m.hero);
  const portrait = <div className="ward-portrait">{m.portrait ? <img src={m.portrait} alt="" /> : <span className="ms">person</span>}</div>;
  return (
    <div className="modal-body wardrobe" data-attr={m.attr || undefined}>
      <div className="ward-head">
        <span className="hub-attr" aria-hidden="true" />
        <div className="modal-title">{name}</div>
        <span className="ward-state">{m.changed ? L`Изменено ${m.changed} из ${m.slots.length}` : L`Всё стандартное`}</span>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="ward-body">
        <aside className="ward-stage">
          {m.preview?.open
            ? <Preview3d hero={m.preview.hero} slots={m.preview.slots} sig={m.preview.sig} fallback={portrait} />
            : portrait}
          <div className="ward-stage-tools">
            {m.preview && (
              <button className={`btn btn-sm preview3d-toggle ${m.preview.open ? 'on' : ''}`} id="preview3dBtn" aria-pressed={m.preview.open}
                title={L`Посмотреть героя в 3D в том, что надето`} onClick={actions.togglePreview}>
                <span className="ms">view_in_ar</span>3D
              </button>
            )}
            {m.paint && (
              <button className="btn btn-sm hero-paint-btn" id="heroPaintBtn" title={L`Свой цвет для способностей, иконок и предметов`} onClick={actions.openPaint}>
                <span className="ms">format_paint</span>{L`Перекрасить`}
              </button>
            )}
          </div>
          <button className="btn btn-sm btn-ghost ward-reset" id="dressReset" disabled={!m.changed || m.busy} onClick={actions.resetAll}>
            <span className="ms">restart_alt</span>{L`Вернуть всё стандартное`}
          </button>
        </aside>
        <nav className="ward-rail" role="tablist" aria-orientation="vertical" aria-label={name}>
          {m.sets && (
            <RailTab id="sets" tab={m.tab} actions={actions} icon="inventory_2" label={L`Наборы`} count={m.sets.count}
              sub={m.sets.on ? cosmeticName(m.sets.on) : `${m.sets.count} ${plural(m.sets.count, 'набор', 'набора', 'наборов')}`} on={!!m.sets.on} data={{ 'data-item-sets': 'true' }} />
          )}
          <div className="ward-rail-sep" />
          {m.slots.map((s) => (
            <div key={s.slot} className={`ward-rail-row ${s.liveName ? 'on' : ''}`}>
              <button role="tab" className={`ward-rail-tab ${m.tab === s.slot ? 'active' : ''}`} aria-selected={m.tab === s.slot}
                data-item-slot={s.slot} onClick={() => actions.tab(s.slot)}>
                {s.liveName
                  ? <CosThumb name={s.liveName} fallback={s.icon} cls="ward-thumb" />
                  : <span className="ward-thumb"><div className="noimg"><span className="ms">{s.icon}</span></div></span>}
                <span className="ward-rail-text">
                  <span className="ward-rail-label card-name">{s.label}</span>
                  <span className="ward-rail-sub">{s.liveName ? cosmeticName(s.liveName) : `${L`Стандартный`} · ${s.options}`}</span>
                </span>
              </button>
              {s.liveName && (
                <button className="ward-off" data-take-off={s.slot} disabled={m.busy}
                  title={L`Снять и вернуть стандартный`} aria-label={L`Снять`} onClick={() => actions.takeOff(s.slot)}>
                  <span className="ms">close</span>
                </button>
              )}
            </div>
          ))}
          <div className="ward-rail-sep" />
          <RailTab id="looks" tab={m.tab} actions={actions} icon="bookmarks" label={L`Мои образы`} count={m.looks}
            sub={m.looks ? `${m.looks} ${plural(m.looks, 'образ', 'образа', 'образов')}` : L`Сохрани надетое`} on={false} data={{ 'data-looks-tab': 'true' }} />
        </nav>
        <section className="ward-pane">
          <Pane pane={m.pane} m={m} actions={actions} />
        </section>
      </div>
    </div>
  );
}

function RailTab({ id, tab, actions, icon, label, count, sub, on, data }: {
  id: string; tab: string; actions: HeroModalActions; icon: string; label: string; count: number; sub: string; on: boolean; data: Record<string, string>;
}) {
  return (
    <div className={`ward-rail-row ${on ? 'on' : ''}`}>
      <button role="tab" className={`ward-rail-tab ${tab === id ? 'active' : ''}`} aria-selected={tab === id} onClick={() => actions.tab(id)} {...data}>
        <span className="ward-thumb ward-thumb-icon"><span className="ms">{icon}</span></span>
        <span className="ward-rail-text">
          <span className="ward-rail-label card-name">{label}{count > 0 && <span className="ward-tab-count">{count}</span>}</span>
          <span className="ward-rail-sub">{sub}</span>
        </span>
      </button>
    </div>
  );
}

function Pane({ pane, m, actions }: { pane: HeroPane; m: HeroModalModel; actions: HeroModalActions }) {
  switch (pane.kind) {
    case 'slot': return <SlotPane m={pane.m} actions={pane.actions} />;
    case 'sets': return <SetsPane m={pane.m} actions={pane.actions} />;
    case 'set': return <SetPane m={pane.m} actions={pane.actions} />;
    default: return <LooksPane looks={pane.looks} canSave={pane.canSave} busy={m.busy} actions={actions} />;
  }
}
