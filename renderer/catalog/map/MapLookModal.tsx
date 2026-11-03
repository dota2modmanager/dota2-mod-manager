/* The window for towers or trees out of the game's own looks (issues #446, #421): one row of looks
 * for Radiant and one for Dire, each starting with the game's own, then the build. The mod window's
 * markup and classes (.modal-body, .style-btn), so it reads as one of them. */
import { useCosmeticIcon } from '../cosmetic/CosmeticCard.tsx';
import type { MapKind, MapOption } from '../../api/content.ts';

export type Side = 'radiant' | 'dire';

export interface MapLookModalModel {
  kind: MapKind;
  options: MapOption[];
  /** the look picked per side, null for the game's own */
  chosen: Record<Side, string | null>;
  installed: Record<Side, string | null> | null;
  busy: boolean;
}

export interface MapLookModalActions {
  close: () => void;
  choose: (side: Side, id: string | null) => void;
  install: () => void;
  remove: () => void;
}

/** "Grasp of the Elder Gods - Radiant Towers" as "Grasp of the Elder Gods": the row already says the side. */
export const lookLabel = (name: string) =>
  name.replace(/\s*-?\s*(Radiant|Dire) Towers$/i, '').replace(/\s+Building Effects$/i, '') || name;

const SIDES: { side: Side; label: string }[] = [{ side: 'radiant', label: 'Radiant' }, { side: 'dire', label: 'Dire' }];

/** A look's own picture, by its item's name, through the item pictures' loader. */
function LookIcon({ name }: { name: string }) {
  const src = useCosmeticIcon(name);
  return src ? <img className="map-look-icon" src={src} alt="" /> : null;
}

export function MapLookModal({ m, actions }: { m: MapLookModalModel; actions: MapLookModalActions }) {
  const towers = m.kind === 'towers';
  const same = m.installed && m.installed.radiant === m.chosen.radiant && m.installed.dire === m.chosen.dire;
  const none = !m.chosen.radiant && !m.chosen.dire;
  return (
    <div className="modal-body map-looks">
      <div className="modal-title-row">
        <div className="modal-title">{towers ? L`Башни из игры` : L`Деревья из игры`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Своя для каждой стороны · из файлов игры`}</span></div>
      {SIDES.map(({ side, label }) => (
        <div className="map-side" key={side}>
          <div className="map-side-label">{label}</div>
          <div className="style-row">
            <button className={`style-btn ${!m.chosen[side] ? 'active' : ''}`} onClick={() => actions.choose(side, null)}>{L`Как в игре`}</button>
            {/* a side's own tree set is what "As in the game" already gives it */}
            {m.options.filter((o) => o.sides.includes(side) && o.id !== side).map((o) => (
              <button key={o.id} className={`style-btn map-look ${m.chosen[side] === o.id ? 'active' : ''}`} title={o.name}
                onClick={() => actions.choose(side, o.id)}>
                {towers && <LookIcon name={o.name} />}
                {lookLabel(o.name)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="modal-actions">
        {m.busy
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : same
            ? <button className="btn btn-primary" disabled><span className="ms">check</span>{L`Установлено`}</button>
            : <button className="btn btn-primary" id="mapInstallBtn" disabled={none} onClick={actions.install}>
              <span className="ms">download</span>{m.installed ? L`Применить` : L`Установить`}
            </button>}
        {m.installed && !m.busy && (
          <button className="btn btn-danger" id="mapRemoveBtn" onClick={actions.remove}><span className="ms">delete</span>{L`Убрать`}</button>
        )}
      </div>
      <div className="modal-note">
        {towers
          ? L`Модели башен и их обломков берутся из предметов игры. Эффекты, которые предмет создаёт сам, и его звуки в файл не входят.`
          : L`Меняются деревья, которые можно срубить. Деревья-декорации по краям карты встроены в саму карту и остаются как были.`}
      </div>
    </div>
  );
}
