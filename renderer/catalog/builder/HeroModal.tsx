/* A hero's window in the item builder: its sets as one tile, then a tile per item slot showing the
 * look on it, or how many there are to choose from. */
import type { CSSProperties } from 'react';
import { plural } from '../../ui/format.js';
import type { HeroModalActions, HeroModalModel } from './model.ts';
import { CosThumb } from './parts.tsx';

const noStagger = { '--i': 0 } as CSSProperties;

export function HeroModal({ m, actions }: { m: HeroModalModel; actions: HeroModalActions }) {
  return (
    <div className="modal-body">
      <div className="modal-title-row">
        <div className="modal-title">{m.hero}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub">
        <span>{m.hub}</span>
        <span>{`· ${m.slots.length} ${plural(m.slots.length, 'слот', 'слота', 'слотов')}`}</span>
      </div>
      <div className="item-slot-grid item-hero-slots">
        {m.sets && (
          <button className={`card item-slot-card ${m.sets.on ? 'installed' : ''}`} data-item-sets="true" style={noStagger} onClick={actions.openSets}>
            <div className="card-media"><CosThumb name={m.sets.name} fallback="inventory_2" cls="item-slot-thumb" /></div>
            <div className="card-body">
              <div className="card-name">{L`Наборы`}</div>
              <div className="card-meta"><span>{`${m.sets.count} ${plural(m.sets.count, 'набор', 'набора', 'наборов')}`}</span></div>
            </div>
          </button>
        )}
        {m.slots.map((s) => (
          <button key={s.slot} className={`card item-slot-card ${s.liveName ? 'installed' : ''}`} data-item-slot={s.slot} style={noStagger}
            onClick={() => actions.openSlot(s.slot)}>
            <div className="card-media">
              {s.liveName
                ? <CosThumb name={s.liveName} fallback={s.icon} cls="item-slot-thumb" />
                : <span className="item-slot-thumb"><div className="noimg"><span className="ms">{s.icon}</span></div></span>}
            </div>
            <div className="card-body">
              <div className="card-name">{s.label}</div>
              <div className="card-meta"><span>{s.meta}</span></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
