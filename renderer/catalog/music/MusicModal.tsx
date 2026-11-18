/* The window for background music of the user's own: the songs, added a handful at a time and
 * each heard before it goes in, where in the game they play, then the build. The mod window's
 * markup and classes (.modal-body, .modal-actions), so it reads as one of them. */

export type SongRole = 'calm' | 'fight' | 'roshan';

export interface MusicSong {
  /** the core's id once kept; null while still being read */
  id: string | null;
  name: string;
  seconds: number;
  /** an address to hear it, for a song added in this window */
  url: string | null;
  /** where it plays: the menu and calm minutes, the fights, or Roshan's fight (the game tells both itself) */
  role: SongRole;
}

export interface MusicModalModel {
  songs: MusicSong[];
  menu: boolean;
  game: boolean;
  installed: boolean;
  /** something here differs from what is on now */
  dirty: boolean;
  /** the song being heard */
  playing: number | null;
  /** songs being read: done of all; or building */
  busy: { done: number; of: number } | 'build' | null;
}

export interface MusicModalActions {
  close: () => void;
  add: (files: File[]) => void;
  remove: (i: number) => void;
  play: (i: number) => void;
  place: (where: 'menu' | 'game', on: boolean) => void;
  role: (i: number, role: SongRole) => void;
  install: () => void;
}

const clock = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

function Place({ id, on, label, set }: { id: string; on: boolean; label: string; set: (v: boolean) => void }) {
  return (
    <label className="music-place">
      <input type="checkbox" className="lib-check" id={id} checked={on} onChange={(e) => set(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function MusicModal({ m, actions }: { m: MusicModalModel; actions: MusicModalActions }) {
  const total = m.songs.reduce((s, x) => s + x.seconds, 0);
  const calm = m.songs.filter((s) => s.role === 'calm').length;
  const none = !(calm && (m.menu || m.game)) && calm === m.songs.length;
  return (
    <div className="modal-body music-own">
      <div className="modal-title-row">
        <div className="modal-title">{L`Своя музыка`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub"><span>{L`Твои песни вместо фоновой музыки Доты: в меню и в матче`}</span></div>

      <div className="sound-file">
        <label className="btn" id="musicAddBtn">
          <span className="ms">library_add</span>{L`Добавить песни…`}
          <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a" multiple hidden
            onChange={(e) => { const f = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (f.length) actions.add(f); }} />
        </label>
        {m.songs.length > 0 && <span className="sound-file-name">{L`Песен: ${m.songs.length}`} · {clock(total)}</span>}
      </div>

      <ol className="music-list" id="musicList">
        {m.songs.map((s, i) => (
          <li key={`${s.id ?? 'new'}-${i}`} className={`music-song${m.playing === i ? ' playing' : ''}`}>
            <button className="music-play" disabled={!s.url} aria-label={L`Слушать`} onClick={() => actions.play(i)}>
              <span className="ms">{m.playing === i ? 'pause' : 'play_arrow'}</span>
            </button>
            <span className="music-name">{s.name}</span>
            <button className={`music-fight${s.role === 'fight' ? ' on' : ''}`} aria-pressed={s.role === 'fight'} title={L`Играет в драках: Дота сама понимает, что началась драка`}
              onClick={() => actions.role(i, s.role === 'fight' ? 'calm' : 'fight')}><span className="ms">swords</span>{L`Для драк`}</button>
            <button className={`music-fight roshan${s.role === 'roshan' ? ' on' : ''}`} aria-pressed={s.role === 'roshan'} title={L`Играет, пока бьют Рошана: это Дота тоже понимает сама`}
              onClick={() => actions.role(i, s.role === 'roshan' ? 'calm' : 'roshan')}><span className="ms">pets</span>{L`Для Рошана`}</button>
            <span className="music-time">{s.id ? clock(s.seconds) : <span className="ms">progress_activity</span>}</span>
            <button className="music-remove" aria-label={L`Убрать`} onClick={() => actions.remove(i)}><span className="ms">close</span></button>
          </li>
        ))}
        {!m.songs.length && <li className="music-empty"><span className="ms">library_music</span>{L`Пока пусто: добавь MP3, WAV, FLAC или OGG`}</li>}
      </ol>

      <div className="music-places">
        <Place id="musicMenu" on={m.menu} label={L`В главном меню`} set={(v) => actions.place('menu', v)} />
        <Place id="musicGame" on={m.game} label={L`В матче, в спокойные минуты`} set={(v) => actions.place('game', v)} />
      </div>

      <div className="modal-actions">
        {m.busy !== null
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>
            {m.busy === 'build' ? L`Собираю музыку…` : L`Готовлю песни… ${m.busy.done} из ${m.busy.of}`}</button>
          : <button className="btn btn-primary" id="musicInstallBtn" disabled={!m.dirty || m.songs.some((s) => !s.id)} onClick={actions.install}>
            <span className="ms">{none && m.installed ? 'music_off' : 'download'}</span>
            {none && m.installed ? L`Вернуть музыку игры` : m.installed ? L`Обновить` : L`Поставить`}
          </button>}
      </div>
      <div className="modal-note">
        {L`Дота сама понимает, когда началась драка, и переключает музыку: песни с пометкой «Для драк» играют в драках, «Для Рошана» — пока бьют Рошана, остальные в меню и в спокойные минуты матча. Без таких песен драки и Рошан звучат как в игре. Песню игра выбирает случайно, в любом музыкальном наборе. Сборка идёт через компилятор Valve и для десятка песен занимает минуту-другую.`}
      </div>
    </div>
  );
}
