/* The window for the in-game HUD made smaller or larger (issue #420): a scale, then the build. The
 * bar under the slider is the bottom of a 16:9 screen with the HUD drawn at that scale, so the
 * size reads before the game is started. The mod window's markup and classes (.modal-body,
 * .style-btn), so it reads as one of them. */

export interface HudModalModel {
  scale: number;
  /** the scale on now, if any */
  installed: number | null;
  /** the HUD mod the scale goes on, or null for the game's own */
  hudMod: string | null;
  /** ValveResourceFormat is downloaded */
  vrf: boolean;
  busy: 'tool' | 'build' | null;
}

export interface HudModalActions {
  close: () => void;
  scale: (v: number) => void;
  getTool: () => void;
  install: () => void;
}

export function HudModal({ m, actions }: { m: HudModalModel; actions: HudModalActions }) {
  const k = m.scale / 100;
  return (
    <div className="modal-body hud-scale">
      <div className="modal-title-row">
        <div className="modal-title">{L`Размер интерфейса в игре`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Нижняя панель и мини-карта меньше или больше, чем даёт игра`}</span></div>

      <div className="hud-screen" id="hudPreview" aria-hidden="true">
        <div className="hud-minimap" style={{ width: `${18 * k}%` }} />
        <div className="hud-bar" style={{ width: `${46 * k}%`, height: `${20 * k}%` }} />
      </div>

      <label className="sound-volume">
        <span>{L`Размер`} {m.scale}%{m.installed !== null && m.installed !== m.scale ? ` · ${L`сейчас ${m.installed}%`}` : ''}</span>
        <input type="range" className="scale-range" id="hudScale" min={60} max={130} step={5} value={m.scale} onChange={(e) => actions.scale(Number(e.currentTarget.value))} />
      </label>

      {m.hudMod && <div className="share-hint">{L`Поверх HUD-мода «${m.hudMod}»: если его выключить, собери размер заново.`}</div>}

      <div className="modal-actions">
        {!m.vrf
          ? <button className="btn btn-primary" id="hudToolBtn" disabled={m.busy !== null} onClick={actions.getTool}>
            <span className="ms">{m.busy === 'tool' ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
          </button>
          : m.busy === 'build'
            ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
            : <button className="btn btn-primary" id="hudInstallBtn" onClick={actions.install}>
              <span className="ms">download</span>{m.installed !== null ? L`Обновить` : L`Поставить`}
            </button>}
      </div>

      <div className="modal-note">
        {m.vrf
          ? L`Стиль интерфейса собирает компилятор Valve из Dota 2 Workshop Tools, бесплатного DLC в Steam. После обновления Доты приложение соберёт его заново само.`
          : L`Стиль интерфейса из игры читает ValveResourceFormat, его нужно один раз скачать. Собирает компилятор Valve из Dota 2 Workshop Tools.`}
      </div>
    </div>
  );
}
