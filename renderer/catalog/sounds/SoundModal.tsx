/* The window for a sound of the user's own on a hero's event (issue #423): a hero, one of his
 * events, a file, instead of the game's sound or over it, then the build. The sounds already on the
 * hero are listed under it, each to take off on its own. The mod window's markup and classes
 * (.modal-body, .style-btn), so it reads as one of them. The heroes are a searchable grid of their
 * portraits (SoundHeroes.tsx), the events a searchable list that scrolls inside the window. */
import { PickerSearch } from '../builder/parts.tsx';
import { SoundHeroes, SoundHeroHead } from './SoundHeroes.tsx';
import type { HeroEvent, SoundEdit, SoundMode } from '../../api/content.ts';

export interface SoundModalModel {
  heroes: { id: string; name: string }[];
  portraits: Record<string, string>;
  /** heroes with a sound of the user's on them */
  sounded: string[];
  heroFilter: string;
  hero: string | null;
  events: HeroEvent[];
  edits: SoundEdit[];
  filter: string;
  event: string | null;
  file: { name: string; seconds: number; url: string } | null;
  mode: SoundMode;
  volume: number;
  busy: boolean;
}

export interface SoundModalActions {
  close: () => void;
  hero: (id: string) => void;
  heroFilter: (text: string) => void;
  /** back to every hero */
  heroes: () => void;
  filter: (text: string) => void;
  event: (name: string) => void;
  file: (f: File) => void;
  mode: (m: SoundMode) => void;
  volume: (v: number) => void;
  install: () => void;
  remove: (event: string) => void;
}

/** "Hero_Lion.FingerOfDeath" as "FingerOfDeath": the window already says whose it is. */
export const eventLabel = (name: string) => name.replace(/^Hero_[A-Za-z]+\./, '') || name;

export function SoundModal({ m, actions }: { m: SoundModalModel; actions: SoundModalActions }) {
  const q = m.filter.trim().toLowerCase();
  const shown = m.events.filter((e) => !q || e.name.toLowerCase().includes(q));
  const has = new Set(m.edits.map((e) => e.event));
  return (
    <div className="modal-body sound-own">
      <div className="modal-title-row">
        <div className="modal-title">{L`Свой звук на способность`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Твой файл вместо звука игры или поверх него`}</span></div>

      {!m.hero && <SoundHeroes m={{ heroes: m.heroes, portraits: m.portraits, sounded: m.sounded, query: m.heroFilter }} pick={actions.hero} search={actions.heroFilter} />}

      {m.hero && (
        <div className="map-side">
          <SoundHeroHead name={m.heroes.find((h) => h.id === m.hero)?.name || m.hero} portrait={m.portraits[m.hero]} back={actions.heroes} />
          <div className="map-side-label">{L`Звук`} <span className="text-meta">{shown.length === m.events.length ? m.events.length : `${shown.length} / ${m.events.length}`}</span></div>
          <PickerSearch id="soundFilter" value={m.filter} onChange={actions.filter} />
          <div className="sound-events">
            {shown.map((e) => (
              <button key={e.name} className={`style-btn ${m.event === e.name ? 'active' : ''}`} title={e.name} onClick={() => actions.event(e.name)}>
                {has.has(e.name) && <span className="ms">graphic_eq</span>}{eventLabel(e.name)}
              </button>
            ))}
            {!shown.length && <div className="share-hint">{L`Ничего не нашлось`}</div>}
          </div>
        </div>
      )}

      {m.event && (
        <div className="map-side">
          <div className="map-side-label">{L`Файл`}</div>
          <div className="sound-file">
            <label className="btn" id="soundFileBtn">
              <span className="ms">audio_file</span>{m.file ? L`Другой файл…` : L`Выбрать файл…`}
              <input type="file" accept="audio/*,.mp3,.wav,.ogg,.flac" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) actions.file(f); }} />
            </label>
            {m.file && <span className="sound-file-name">{m.file.name} · {m.file.seconds.toFixed(1)} {L`с`}</span>}
          </div>
          {m.file && <audio className="sound-preview" controls src={m.file.url} />}
          <div className="style-row">
            <button className={`style-btn ${m.mode === 'replace' ? 'active' : ''}`} onClick={() => actions.mode('replace')}>{L`Вместо звука игры`}</button>
            <button className={`style-btn ${m.mode === 'layer' ? 'active' : ''}`} onClick={() => actions.mode('layer')}>{L`Поверх звука игры`}</button>
          </div>
          <label className="sound-volume">
            <span>{L`Громкость`} {Math.round(m.volume * 100)}%</span>
            <input type="range" className="scale-range" min={5} max={100} step={5} value={Math.round(m.volume * 100)} onChange={(e) => actions.volume(Number(e.currentTarget.value) / 100)} />
          </label>
        </div>
      )}

      {m.hero && <div className="modal-actions">
        {m.busy
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : <button className="btn btn-primary" id="soundInstallBtn" disabled={!m.event || !m.file} onClick={actions.install}>
            <span className="ms">download</span>{L`Поставить`}
          </button>}
      </div>}

      {m.edits.length > 0 && (
        <div className="map-side">
          <div className="map-side-label">{L`Уже стоят`}</div>
          {m.edits.map((e) => (
            <div className="sound-edit" key={e.event}>
              <span className="sound-edit-name" title={e.event}>{eventLabel(e.event)}</span>
              <span className="sound-edit-file">{e.name} · {e.mode === 'layer' ? L`поверх` : L`вместо`}</span>
              <button className="btn btn-ghost btn-xs" disabled={m.busy} onClick={() => actions.remove(e.event)} aria-label={L`Убрать`}><span className="ms">delete</span></button>
            </div>
          ))}
        </div>
      )}

      <div className="modal-note">
        {L`Звук собирает компилятор Valve из Dota 2 Workshop Tools, бесплатного DLC в Steam. Один файл до 30 секунд, громкий приводится к уровню звуков игры.`}
      </div>
    </div>
  );
}
