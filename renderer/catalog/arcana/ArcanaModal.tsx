/* The arcana's window (issue #118): the mod window's twin, with the same markup and classes. The
 * colours are the looks a mod offers (.style-btn), and the picture is the arcana's own out of the
 * game, drawn in the colour pointed at before anything is built (tint.ts). */
import { useRef, useState, type CSSProperties } from 'react';
import { GEM, toHex, useTinted, type Rgb } from './tint.ts';

export type ArcanaMode = 'mod' | 'recolor';

export interface ArcanaModalModel {
  picture: string | null;
  /** the colour picked in the window */
  chosen: Rgb;
  /** the colour of the "own colour" button, once one was picked there */
  own: Rgb | null;
  installed: { color: Rgb; mode: ArcanaMode } | null;
  /** what is being built right now */
  busy: ArcanaMode | null;
}

export interface ArcanaModalActions {
  close: () => void;
  choose: (c: Rgb, own?: boolean) => void;
  install: (mode: ArcanaMode) => void;
  remove: () => void;
}

/** The colours offered, the game's own first. */
export const PRESETS: { color: Rgb; label: () => string }[] = [
  { color: GEM, label: () => L`Как в игре` },
  { color: [255, 193, 220], label: () => L`Розовый` },
  { color: [163, 92, 255], label: () => L`Фиолетовый` },
  { color: [60, 120, 255], label: () => L`Синий` },
  { color: [0, 210, 200], label: () => L`Бирюзовый` },
  { color: [76, 255, 106], label: () => L`Зелёный` },
  { color: [255, 194, 60], label: () => L`Золотой` },
  { color: [242, 242, 255], label: () => L`Белый` },
];

const same = (a: Rgb | null | undefined, b: Rgb | null | undefined) => Boolean(a && b && a.every((n, i) => n === b[i]));

export function ArcanaModal({ m, actions }: { m: ArcanaModalModel; actions: ArcanaModalActions }) {
  // pointing at a colour shows it, so the picture answers before the click does
  const [hover, setHover] = useState<Rgb | null>(null);
  const picture = useTinted(m.picture, hover ?? m.chosen);
  const own = useRef<HTMLInputElement>(null);
  const isPreset = PRESETS.some((p) => same(p.color, m.chosen));
  const ownColor = m.own ?? (isPreset ? null : m.chosen);
  const installed = m.installed;
  const current = installed && same(installed.color, m.chosen);
  const wholeArcana = installed?.mode !== 'recolor';

  return (
    <>
      <div className="modal-media cos arcana-media">
        {picture ? <img src={picture} alt="" /> : <div className="noimg"><span className="ms">palette</span></div>}
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-body">
        <div className="modal-title-row">
          <div className="modal-title">Fractal Horns of Inner Abysm</div>
        </div>
        <div className="modal-sub">
          <span>{L`Террорблейд`}</span>
          <span>{`· ${L`аркана из файлов игры`}`}</span>
          {installed && <span>{`· ${wholeArcana ? L`стоит` : L`стоит только цвет`} ${toHex(installed.color).toUpperCase()}`}</span>}
        </div>
        <div className="style-row" onMouseLeave={() => setHover(null)}>
          {PRESETS.map((p) => (
            <button key={p.label()} className={`style-btn ${same(p.color, m.chosen) ? 'active' : ''}`}
              style={{ '--c': toHex(p.color) } as CSSProperties}
              onMouseEnter={() => setHover(p.color)} onClick={() => actions.choose(p.color)}>
              {p.label()}
            </button>
          ))}
          <button className={`style-btn arcana-own ${ownColor && same(ownColor, m.chosen) ? 'active' : ''}`}
            style={ownColor ? { '--c': toHex(ownColor) } as CSSProperties : undefined}
            onMouseEnter={() => ownColor && setHover(ownColor)} onClick={() => own.current?.click()}>
            {!ownColor && <span className="ms">colorize</span>}
            {ownColor ? toHex(ownColor).toUpperCase() : L`Свой цвет`}
            <input ref={own} type="color" tabIndex={-1} aria-hidden="true" value={toHex(ownColor ?? m.chosen)}
              onInput={(e) => actions.choose(hexRgb(e.currentTarget.value), true)} />
          </button>
        </div>
        <div className="modal-actions">
          {m.busy
            ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
            : !installed
              ? <button className="btn btn-primary" id="arcanaInstallBtn" onClick={() => actions.install('mod')}><span className="ms">download</span>{L`Установить`}</button>
              : current
                ? <button className="btn btn-primary" disabled><span className="ms">check</span>{L`Установлено`}</button>
                : <button className="btn btn-primary" id="arcanaInstallBtn" onClick={() => actions.install(installed.mode)}><span className="ms">palette</span>{L`Перекрасить`}</button>}
          {installed && !m.busy && (
            <button className="btn btn-danger" id="arcanaRemoveBtn" onClick={actions.remove}><span className="ms">delete</span>{L`Убрать`}</button>
          )}
          {/* the other build, for the few who have the arcana: an action of its own, not a switch */}
          {!m.busy && (
            <button className="btn btn-ghost btn-sm arcana-mode" id="arcanaModeBtn" onClick={() => actions.install(wholeArcana ? 'recolor' : 'mod')}>
              {wholeArcana ? L`Аркана уже куплена? Только цвет` : L`Поставить аркану целиком`}
            </button>
          )}
        </div>
        <div className="modal-note">
          {wholeArcana
            ? L`Собирается из файлов твоей игры: модель, рога, свечение и иконки. Эффекта убийства и звуков арканы нет, их даёт сам предмет. После обновления Доты соберётся заново сам.`
            : L`Только цвет: перекрашивает аркану, которая у тебя уже есть. Модель и свечение даёт сама игра.`}
        </div>
      </div>
    </>
  );
}

function hexRgb(value: string): Rgb {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
