/* The window a look opens: the mod window's twin, with the same markup and classes. A look goes
 * into the game's own item table rather than into a file, so the window says what taking it
 * will do to the slot, and which look it replaces. */
import { useCosmeticIcon } from './CosmeticCard.tsx';
import { plural } from '../../ui/format.ts';

export interface CosmeticModalModel {
  slot: string;
  id: string;
  name: string;
  fallbackIcon: string;
  label: string;
  /** how many looks the slot holds, when the game's table was read */
  options: number | null;
  favKey: string;
  fav: boolean;
  live: boolean;
  /** the look it would replace, when another one is live */
  replaces: string | null;
  busy: boolean;
}

export interface CosmeticModalActions {
  close: () => void;
  toggleFav: () => void;
  pick: () => void;
  remove: () => void;
}

export function CosmeticModal({ m, actions }: { m: CosmeticModalModel; actions: CosmeticModalActions }) {
  const icon = useCosmeticIcon(m.name);
  const favLabel = m.fav ? L`Убрать из избранного` : L`В избранное`;
  return (
    <>
      <div className="modal-media cos">
        {icon ? <img src={icon} alt="" /> : <div className="noimg"><span className="ms">{m.fallbackIcon}</span></div>}
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-body">
        <div className="modal-title-row">
          <div className="modal-title">{m.name}</div>
          <button className={`fav-btn ${m.fav ? 'on' : ''}`} data-fav={m.favKey} data-owned="react"
            aria-pressed={m.fav} title={favLabel} aria-label={favLabel} onClick={actions.toggleFav}>
            <span className="ms">{m.fav ? 'favorite' : 'favorite_border'}</span>
          </button>
        </div>
        <div className="modal-sub">
          <span>{m.label}</span>
          <span>{`· ${L`вид для стандартного предмета`}`}</span>
          {m.options !== null && <span>{`· ${m.options} ${plural(m.options, 'вариант', 'варианта', 'вариантов')}`}</span>}
        </div>
        <div className="modal-actions">
          {m.live
            ? <button className="btn btn-danger" id="cosRemoveBtn" onClick={actions.remove}><span className="ms">delete</span>{L`Убрать`}</button>
            : (
              <button className="btn btn-primary" id="cosPickBtn" disabled={m.busy} onClick={actions.pick}>
                <span className="ms">download</span>{m.busy ? L`Установка…` : L`Установить`}
              </button>
            )}
        </div>
        <div className="modal-note">
          {m.live
            ? L`Этот вид сейчас стоит в слоте «${m.label}». Убрать — вернуть то, что даёт игра; включить обратно можно в «Моих модах».`
            : m.replaces
              ? L`На один слот — только один вид: этот заменит «${m.replaces}». Прошлый выбор останется в «Моих модах» выключенным.`
              : L`Вид подставляется в схему предметов игры — стандартный предмет просто рисуется как выбранный. Файлы модов это не трогает, и видно только тебе.`}
        </div>
      </div>
    </>
  );
}
