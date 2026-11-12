/* The window for a main menu background of the user's own (issue #418): a picture, GIF or video,
 * how dark and how blurred it sits behind the menu, then the build. The preview shows the file under
 * the same veil and blur the game will draw. The mod window's markup and classes (.modal-body,
 * .style-btn), so it reads as one of them. */

export interface BackgroundModalModel {
  /** the file picked here, or the one on now (no url: it is only a name) */
  file: { name: string; url: string | null; kind: 'still' | 'animation' | 'video' } | null;
  dim: number;
  blur: number;
  /** the background on now, if any */
  installed: { source: string; enabled: boolean } | null;
  /** encoding: how far, 0 to 1; building: 1 */
  busy: number | null;
}

export interface BackgroundModalActions {
  close: () => void;
  file: (f: File) => void;
  dim: (v: number) => void;
  blur: (v: number) => void;
  install: () => void;
}

export function BackgroundModal({ m, actions }: { m: BackgroundModalModel; actions: BackgroundModalActions }) {
  const look = { filter: m.blur ? `blur(${m.blur / 4}px)` : undefined };
  return (
    <div className="modal-body background-own">
      <div className="modal-title-row">
        <div className="modal-title">{L`Свой фон меню`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Твоя картинка или ролик за главным меню Доты`}</span></div>

      <div className="background-preview" id="backgroundPreview">
        {m.file?.url && (m.file.kind === 'video'
          ? <video src={m.file.url} autoPlay loop muted playsInline style={look} />
          : <img src={m.file.url} alt="" style={look} />)}
        {!m.file?.url && <div className="background-empty"><span className="ms">wallpaper</span>{m.file?.name || L`Пока пусто`}</div>}
        <div className="background-veil" style={{ opacity: m.dim }} />
      </div>

      <div className="sound-file">
        <label className="btn" id="backgroundFileBtn">
          <span className="ms">add_photo_alternate</span>{m.file ? L`Другой файл…` : L`Выбрать файл…`}
          <input type="file" accept="image/*,video/*,.gif,.webm,.mp4" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) actions.file(f); }} />
        </label>
        {m.file && <span className="sound-file-name">{m.file.name}</span>}
      </div>

      <div className="background-look">
        <label className="sound-volume">
          <span>{L`Затемнение`} {Math.round(m.dim * 100)}%</span>
          <input type="range" className="scale-range" id="backgroundDim" min={0} max={90} step={5} value={Math.round(m.dim * 100)} onChange={(e) => actions.dim(Number(e.currentTarget.value) / 100)} />
        </label>
        <label className="sound-volume">
          <span>{L`Размытие`} {m.blur}</span>
          <input type="range" className="scale-range" id="backgroundBlur" min={0} max={20} step={1} value={m.blur} onChange={(e) => actions.blur(Number(e.currentTarget.value))} />
        </label>
      </div>

      <div className="modal-actions">
        {m.busy !== null
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{m.busy < 1 ? L`Готовлю ролик… ${Math.round(m.busy * 100)}%` : L`Собираю…`}</button>
          : <button className="btn btn-primary" id="backgroundInstallBtn" disabled={!m.file} onClick={actions.install}>
            <span className="ms">download</span>{m.installed && m.file && !m.file.url ? L`Обновить` : L`Поставить`}
          </button>}
      </div>

      <div className="modal-note">
        {L`Картинка, GIF или видео до 30 секунд. Ролик повторяется по кругу. Видео готовится в реальном времени: ролик на 30 секунд займёт 30 секунд.`}
      </div>
    </div>
  );
}
