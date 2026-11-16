/* The cursor picked, in the column beside the grid: the game's beside the one it will be, and where
 * it comes from: the game, one of the game's cursor sets, or a picture of the user's (dropped or
 * picked, its hotspot set with a click). The column stays put; only what is in it changes, so
 * going from one cursor to the next moves nothing on the screen. */
import { droppedPicture, shareAt, type CursorModalActions, type CursorTile } from './model.ts';

export function CursorPanel({ t, actions }: { t: CursorTile; actions: CursorModalActions }) {
  const name = t.kind.name;
  const s = t.source;
  const own = s.from === 'own';
  return (
    <div className="cursor-panel" id="cursorPanel" data-cursor={name}>
      <div className="cursor-panel-name">{t.kind.label}</div>
      <div className="cursor-panel-file">{t.from}</div>
      <div className="cursor-compare">
        <figure>
          <div className="cursor-big checker"><img src={t.game} alt="" /></div>
          <figcaption>{L`В игре`}</figcaption>
        </figure>
        <span className="ms cursor-arrow">arrow_forward</span>
        <figure>
          <div className={`cursor-big checker${own ? ' can-aim' : ''}`} id="cursorBigMine" data-own-drop
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = droppedPicture(e); if (f) actions.own(name, f); }}
            onClick={own ? (e) => actions.hot(name, shareAt(e)) : undefined}>
            <img src={t.mine ?? t.game} alt="" />
            <span className="cursor-hot" style={{ left: `${t.hot[0] * 100}%`, top: `${t.hot[1] * 100}%` }} />
          </div>
          <figcaption>{own ? L`Клик — точка нажатия` : L`Будет`}</figcaption>
        </figure>
      </div>
      <div className="cursor-sources-title">{L`Взять из набора Доты`}</div>
      <div className="cursor-source-grid" id="cursorSources">
        <button className={`cursor-source checker${s.from === 'game' ? ' on' : ''}`} title={L`Как в игре`} data-pack="game"
          onClick={() => actions.source(name, { from: 'game' })}><img src={t.game} alt="" /></button>
        {t.options.map((o) => (
          <button key={o.id} className={`cursor-source checker${s.from === 'pack' && s.pack === o.id ? ' on' : ''}`} title={o.name} data-pack={o.id}
            onClick={() => actions.source(name, { from: 'pack', pack: o.id })}><img src={o.picture} alt="" /></button>
        ))}
      </div>
      <label className={`btn cursor-own-btn${own ? ' on' : ''}`} id="cursorOwnBtn">
        <span className="ms">add_photo_alternate</span>{own ? L`Другая картинка…` : L`Своя картинка…`}
        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) actions.own(name, f); e.currentTarget.value = ''; }} />
      </label>
      <div className="cursor-drop-hint">{L`Картинку можно просто перетащить на курсор. PNG с прозрачным фоном выглядит лучше всего.`}</div>
    </div>
  );
}
