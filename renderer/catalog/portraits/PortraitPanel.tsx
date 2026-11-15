/* The panel beside the hero up close: his picture and his movie, each as the game has it then as
 * it will be, a file to change either, and the build. A part left as the game's says so. */
import { motion } from 'motion/react';
import { dur, ease } from '../../motion/tokens.ts';
import { PickerCard } from './PickerCard.tsx';
import type { PortraitDetail, PortraitStudioActions } from './model.ts';

const enter = () => ({ duration: dur('--dur-medium'), ease: ease('--ease-standard') });

function FilePick({ id, icon, label, accept, pick }: { id: string; icon: string; label: string; accept: string; pick: (f: File) => void }) {
  return (
    <label className="btn" id={id}>
      <span className="ms">{icon}</span>{label}
      <input type="file" accept={accept} hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) pick(f); }} />
    </label>
  );
}

function Was({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="portrait-was"><span className="portrait-was-label">{label}</span>{children}</div>;
}

export function PortraitPanel({ d, busy, actions }: { d: PortraitDetail; busy: number | null; actions: PortraitStudioActions }) {
  const mine = !!(d.ownPicture || d.ownMovie);
  return (
    <motion.aside className="portrait-panel" id="portraitPanel" initial={{ opacity: 0, x: 48 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 48 }} transition={enter()}>
      <div className="portrait-panel-head">
        <button className="btn btn-ghost" id="portraitBack" onClick={actions.back}><span className="ms">arrow_back</span>{L`Все герои`}</button>
        <div className="portrait-panel-name">{d.name}</div>
      </div>

      <section className="portrait-part">
        <div className="portrait-part-title">{L`Портрет в выборе героя`}</div>
        <div className="portrait-compare">
          <Was label={L`Было`}>{d.gamePicture ? <img src={d.gamePicture} alt="" /> : <span className="ms">image</span>}</Was>
          <span className="ms portrait-arrow">arrow_forward</span>
          <Was label={L`Стало`}>{d.ownPicture ? <img src={d.ownPicture} alt="" /> : <span className="portrait-same">{L`как в игре`}</span>}</Was>
        </div>
        <div className="portrait-part-actions">
          <FilePick id="portraitStillBtn" icon="add_photo_alternate" label={d.ownPicture ? L`Другая картинка…` : L`Своя картинка…`} accept="image/*" pick={actions.still} />
          {d.ownPicture && <button className="btn btn-ghost" id="portraitStillDrop" onClick={() => actions.drop('still')}>{L`Как в игре`}</button>}
        </div>
      </section>

      <section className="portrait-part">
        <div className="portrait-part-title">{L`Видео при наведении`}</div>
        <div className="portrait-compare">
          <Was label={L`Было`}><PickerCard picture={d.gamePicture} movie={d.gameMovie} className="small" /></Was>
          <span className="ms portrait-arrow">arrow_forward</span>
          <Was label={L`Стало`}>{d.ownMovie || d.ownPicture
            ? <PickerCard picture={d.ownPicture ?? d.gamePicture} movie={d.ownMovie ?? d.gameMovie} className="small" />
            : <span className="portrait-same">{L`как в игре`}</span>}</Was>
        </div>
        <div className="portrait-hint">{L`Наведи на карточку: так ролик играет в выборе героя`}</div>
        <div className="portrait-part-actions">
          <FilePick id="portraitMovieBtn" icon="movie" label={d.ownMovie ? L`Другой ролик…` : L`Своё видео или GIF…`} accept="image/gif,image/webp,video/*" pick={actions.movie} />
          {d.ownMovie && <button className="btn btn-ghost" id="portraitMovieDrop" onClick={() => actions.drop('movie')}>{L`Как в игре`}</button>}
        </div>
      </section>

      <div className="modal-actions">
        {busy !== null
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{busy < 1 ? L`Готовлю ролик… ${Math.round(busy * 100)}%` : L`Собираю…`}</button>
          : <button className="btn btn-primary" id="portraitInstallBtn" disabled={!d.dirty} onClick={actions.install}>
            <span className="ms">download</span>{!mine && d.installed ? L`Вернуть как в игре` : d.installed ? L`Обновить` : L`Поставить`}
          </button>}
      </div>
      <div className="modal-note">{L`Картинка обрезается под портрет игры по центру. Видео до 12 секунд, без звука, по кругу.`}</div>
    </motion.aside>
  );
}
