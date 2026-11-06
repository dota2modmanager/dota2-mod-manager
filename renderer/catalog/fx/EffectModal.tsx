/* The effect editor: find one of the game's effects, change its size, count, life, speed and
 * colour, for all of it or one of the systems it is made of, and see it play. The list on the
 * left is the search until an effect is open, then that effect's systems. */
import { EffectStage } from './EffectStage.tsx';
import type { EffectEdit, EffectEdits } from '../../api/fx.ts';
import type { ParticleDef } from '../../api/preview3d.ts';

export const WHOLE = '*';

export interface EffectOpen {
  path: string;
  systems: { path: string; depth: number }[];
  def: ParticleDef;
  sprites: Record<string, Uint8Array>;
}

export interface EffectModalModel {
  query: string;
  results: string[];
  saved: { path: string; name: string }[];
  open: EffectOpen | null;
  /** the system the sliders are on, or WHOLE */
  chosen: string;
  edits: EffectEdits;
  /** the changes are what is on now */
  same: boolean;
  /** the effect has a record in My mods */
  installed: boolean;
  busy: 'load' | 'build' | null;
}

export interface EffectModalActions {
  close: () => void;
  query: (q: string) => void;
  open: (path: string) => void;
  back: () => void;
  choose: (key: string) => void;
  edit: (patch: Partial<EffectEdit>) => void;
  reset: () => void;
  install: () => void;
}

const last = (p: string) => p.replace(/\.vpcf$/, '').split('/').pop() ?? p;
const folder = (p: string) => p.replace(/^particles\//, '').split('/').slice(0, -1).join('/');

function Slider({ id, label, value, on }: { id: string; label: string; value: number; on: (v: number) => void }) {
  return (
    <label className="sound-volume">
      <span>{label} {value}%</span>
      <input type="range" className="scale-range" id={id} min={10} max={300} step={5} value={value} onChange={(e) => on(Number(e.currentTarget.value))} />
    </label>
  );
}

function Controls({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const e = m.edits[m.chosen] ?? {};
  const set = (k: 'size' | 'count' | 'life' | 'speed', v: number) => actions.edit({ [k]: v === 100 ? undefined : v });
  return (
    <div className="fx-controls">
      <Slider id="fxSize" label={L`Размер`} value={e.size ?? 100} on={(v) => set('size', v)} />
      <Slider id="fxCount" label={L`Количество`} value={e.count ?? 100} on={(v) => set('count', v)} />
      <Slider id="fxLife" label={L`Время жизни`} value={e.life ?? 100} on={(v) => set('life', v)} />
      <Slider id="fxSpeed" label={L`Скорость`} value={e.speed ?? 100} on={(v) => set('speed', v)} />
      <div className="hud-panel-row fx-tint">
        <label className="hud-tint">
          <input type="color" id="fxTint" aria-label={L`Цвет`} value={e.tint ?? '#ffffff'} onInput={(ev) => actions.edit({ tint: ev.currentTarget.value })} />
          <span>{e.tint ? L`Цвет ${e.tint}` : L`Свой цвет эффекта`}</span>
        </label>
        {e.tint && <button type="button" className="btn btn-ghost" onClick={() => actions.edit({ tint: undefined })}>{L`Убрать`}</button>}
      </div>
    </div>
  );
}

function Finder({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const list = m.query.trim() ? m.results : m.saved.map((s) => s.path);
  return (
    <div className="fx-list">
      <input type="search" className="fx-search" id="fxSearch" autoFocus value={m.query} placeholder={L`Герой, предмет или способность`}
        aria-label={L`Найти эффект`} onChange={(e) => actions.query(e.currentTarget.value)} />
      {!m.query.trim() && m.saved.length > 0 && <div className="fx-list-head">{L`Уже изменённые`}</div>}
      <ul>
        {list.map((p) => (
          <li key={p}><button type="button" className="fx-row" data-effect={p} onClick={() => actions.open(p)}>
            <span>{last(p)}</span><small>{folder(p)}</small>
          </button></li>
        ))}
      </ul>
      {m.query.trim() && !m.results.length && <div className="modal-note">{L`Таких эффектов нет. Названия в файлах игры английские: juggernaut, blade fury.`}</div>}
    </div>
  );
}

function Systems({ open, m, actions }: { open: EffectOpen; m: EffectModalModel; actions: EffectModalActions }) {
  return (
    <div className="fx-list">
      <button type="button" className="btn btn-ghost fx-back" id="fxBack" onClick={actions.back}><span className="ms">arrow_back</span>{L`К поиску`}</button>
      <ul>
        <li><button type="button" className={`fx-row${m.chosen === WHOLE ? ' is-chosen' : ''}`} data-system={WHOLE} onClick={() => actions.choose(WHOLE)}>
          <span>{L`Весь эффект`}</span>{m.edits[WHOLE] && <i className="hud-list-mark" />}
        </button></li>
        {open.systems.map((s) => (
          <li key={s.path}><button type="button" className={`fx-row${m.chosen === s.path ? ' is-chosen' : ''}`} data-system={s.path} data-depth={Math.min(s.depth, 3)} onClick={() => actions.choose(s.path)}>
            <span>{last(s.path)}</span>{m.edits[s.path] && <i className="hud-list-mark" />}
          </button></li>
        ))}
      </ul>
    </div>
  );
}

export function EffectModal({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const changed = Object.keys(m.edits).length > 0;
  return (
    <div className="modal-body fx-editor">
      <div className="modal-title-row">
        <div className="modal-title">{m.open ? last(m.open.path) : L`Редактор эффектов`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="fx-room">
        {m.open ? <Systems open={m.open} m={m} actions={actions} /> : <Finder m={m} actions={actions} />}
        <div className="fx-view">
          {m.open
            ? <EffectStage path={m.open.path} def={m.open.def} sprites={m.open.sprites} />
            : <div className="fx-empty"><span className="ms">{m.busy === 'load' ? 'progress_activity' : 'auto_awesome'}</span><span>{L`Выбери эффект слева: он заиграет здесь`}</span></div>}
          {m.open && <Controls m={m} actions={actions} />}
        </div>
      </div>
      {m.open && <div className="modal-actions">
        {m.busy === 'build'
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : <button className="btn btn-primary" id="fxInstallBtn" disabled={!changed || m.same} onClick={actions.install}>
            <span className="ms">download</span>{m.installed ? L`Обновить` : L`Поставить`}
          </button>}
        {changed && <button type="button" className="btn btn-ghost" id="fxResetBtn" onClick={actions.reset}>{L`Вернуть всё как в игре`}</button>}
      </div>}
      {m.open && <div className="modal-note">{L`Просмотр примерный: форму спрайтов и следы точно показывает только игра. Эффект заменится везде, где игра его играет.`}</div>}
    </div>
  );
}
