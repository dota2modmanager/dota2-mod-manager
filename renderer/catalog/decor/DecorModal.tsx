/* The window for the map without its decor: two groups, each on or off, with how much of this
 * map's decor it takes, then the build (src/map-decor.ts). The mod window's markup and classes
 * (.modal-body, .modal-actions), so it reads as one of them. */
import type { DecorGroup } from '../../api/content.ts';

export interface DecorModalModel {
  groups: DecorGroup[];
  /** the groups off the map now, or null when nothing is */
  installed: DecorGroup[] | null;
  /** how many materials each group takes on this map, or null before the map is read */
  counts: Record<DecorGroup, number> | null;
  busy: boolean;
}

export interface DecorModalActions {
  close: () => void;
  toggle: (g: DecorGroup) => void;
  install: () => void;
}

const GROUPS: { id: DecorGroup; name: () => string; what: () => string }[] = [
  { id: 'plants', name: () => L`Растения`, what: () => L`Трава, цветы, папоротники, звери и птицы` },
  { id: 'debris', name: () => L`Камни и мусор`, what: () => L`Камни, кости, обломки, пятна крови и лепестки` },
];

export function DecorModal({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  const same = m.installed !== null && m.installed.length === m.groups.length && m.groups.every((g) => m.installed?.includes(g));
  return (
    <div className="modal-body map-decor">
      <div className="modal-title-row">
        <div className="modal-title">{L`Карта без декора`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Убирает с карты то, вокруг чего не играют. Деревья, постройки, вода и земля остаются`}</span></div>

      <div className="decor-groups" id="decorGroups">
        {GROUPS.map((g) => {
          const on = m.groups.includes(g.id);
          return (
            <button key={g.id} className={`decor-group ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => actions.toggle(g.id)}>
              <span className="ms">{on ? 'check_box' : 'check_box_outline_blank'}</span>
              <span className="decor-group-text">
                <b>{g.name()}</b>
                <span>{g.what()}</span>
              </span>
              {m.counts && <span className="decor-count">{L`Материалов: ${m.counts[g.id]}`}</span>}
            </button>
          );
        })}
      </div>

      <div className="modal-actions">
        {m.busy
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : <button className="btn btn-primary" id="decorInstallBtn" disabled={!m.groups.length || same} onClick={actions.install}>
            <span className="ms">download</span>{m.installed ? L`Обновить` : L`Поставить`}
          </button>}
      </div>

      <div className="modal-note">
        {L`Список берётся из самой карты при каждой сборке, а после обновления Доты приложение соберёт его заново. Чтобы вернуть декор, выключи или удали мод в «Моих модах».`}
      </div>
    </div>
  );
}
