/* A hero's window in the item builder: its sets as one tile, then a tile per item slot showing the
 * look on it, or how many there are to choose from. */
import type { CSSProperties } from 'react';
import { plural } from '../../ui/format.ts';
import { heroName } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { HeroModalActions, HeroModalModel } from './model.ts';
import { CosThumb } from './parts.tsx';
import { Preview3d } from '../preview3d/Preview3d.tsx';

const noStagger = { '--i': 0 } as CSSProperties;

export function HeroModal({ m, actions }: { m: HeroModalModel; actions: HeroModalActions }) {
  return (
    <div className="modal-body">
      <div className="modal-title-row">
        <div className="modal-title">{heroName(m.hero)}</div>
        {m.preview && (
          <button className={`btn btn-sm preview3d-toggle ${m.preview.open ? 'on' : ''}`} id="preview3dBtn" aria-pressed={m.preview.open}
            title={L`Посмотреть героя в 3D в том, что надето`} onClick={actions.togglePreview}>
            <span className="ms">view_in_ar</span>3D
          </button>
        )}
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub">
        <span>{m.hub}</span>
        <span>{`· ${m.slots.length} ${plural(m.slots.length, 'слот', 'слота', 'слотов')}`}</span>
      </div>
      {m.preview?.open && <Preview3d hero={m.preview.hero} slots={m.preview.slots} sig={m.preview.sig} />}
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
              <div className="card-meta"><span>{cosmeticName(s.meta)}</span></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
