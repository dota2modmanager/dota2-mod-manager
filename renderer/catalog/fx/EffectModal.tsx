/* The effect editor: find one of the game's effects, change its size, count, life, speed and
 * colour, for all of it or one of the systems it is made of, and see it play. The list on the
 * left is the search until an effect is open, then that effect's systems. */
import { EffectStage, hasSprites } from './EffectStage.tsx';
import { particleSpec } from '../preview3d/particle-def.ts';
import type { AbilityHit, EffectEdit, EffectEdits, EffectGroup } from '../../api/fx.ts';
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
  hits: AbilityHit[];
  saved: { path: string; name: string }[];
  heroes: { hero: string; name: string }[];
  /** the selection portraits out of the game, by hero */
  portraits: Record<string, string>;
  /** the abilities' icons, by ability */
  icons: Record<string, string>;
  /** the hero open in the list, and his effects */
  hero: string | null;
  groups: EffectGroup[];
  /** the line of his effects open in the list */
  group: string | null;
  /** goes up each time the effect is asked to play again */
  play: number;
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
  hero: (hero: string | null) => void;
  group: (id: string | null) => void;
  hit: (hit: AbilityHit) => void;
  replay: () => void;
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

const groupName = (g: EffectGroup) => (g.kind === 'ability' ? g.name || g.ability || '' : g.kind === 'items' ? L`Эффекты предметов` : L`Другие эффекты героя`);

function Files({ paths, actions }: { paths: string[]; actions: EffectModalActions }) {
  return (
    <ul>
      {paths.map((p) => (
        <li key={p}><button type="button" className="fx-row" data-effect={p} onClick={() => actions.open(p)}>
          <span>{last(p)}</span><small>{folder(p)}</small>
        </button></li>
      ))}
    </ul>
  );
}

function Heroes({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const q = m.query.trim().toLowerCase();
  const shown = q ? m.heroes.filter((h) => h.name.toLowerCase().includes(q) || h.hero.includes(q)) : m.heroes;
  if (!shown.length) return null;
  return (
    <div className="fx-heroes" id="fxHeroes">
      {shown.map((h) => (
        <button key={h.hero} type="button" className="fx-hero" data-hero={h.hero} title={h.name} aria-label={h.name} onClick={() => actions.hero(h.hero)}>
          {m.portraits[h.hero] ? <img src={m.portraits[h.hero]} alt="" draggable={false} /> : <span>{h.name}</span>}
        </button>
      ))}
    </div>
  );
}

function Hero({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const name = m.heroes.find((h) => h.hero === m.hero)?.name;
  const g = m.groups.find((x) => x.id === m.group);
  return (
    <>
      <button type="button" className="btn btn-ghost fx-back" id="fxHeroBack" onClick={() => (g ? actions.group(null) : actions.hero(null))}>
        <span className="ms">arrow_back</span>{g ? name : L`Все герои`}
      </button>
      {g
        ? <Files paths={g.paths} actions={actions} />
        : <ul>
          {m.groups.map((x) => (
            <li key={x.id}><button type="button" className="fx-row fx-group" data-group={x.id} onClick={() => actions.group(x.id)}>
              {x.ability && m.icons[x.ability] ? <img src={m.icons[x.ability]} alt="" draggable={false} /> : <span className="ms">{x.kind === 'items' ? 'shield' : 'auto_awesome'}</span>}
              <span>{groupName(x)}</span>
            </button></li>
          ))}
          {!m.groups.length && <li className="modal-note">{L`У этого героя не нашлось своих эффектов`}</li>}
        </ul>}
    </>
  );
}

function Finder({ m, actions }: { m: EffectModalModel; actions: EffectModalActions }) {
  const q = m.query.trim();
  return (
    <div className="fx-list">
      <input type="search" className="fx-search" id="fxSearch" autoFocus value={m.query} placeholder={L`Герой, способность или файл`}
        aria-label={L`Найти эффект`} onChange={(e) => actions.query(e.currentTarget.value)} />
      {q
        ? <>
          <Heroes m={m} actions={actions} />
          {m.hits.length > 0 && <ul>
            {m.hits.map((h) => (
              <li key={h.ability}><button type="button" className="fx-row" data-hit={h.ability} onClick={() => actions.hit(h)}>
                <span>{h.name}</span><small>{m.heroes.find((x) => x.hero === h.hero)?.name}</small>
              </button></li>
            ))}
          </ul>}
          <Files paths={m.results} actions={actions} />
          {!m.results.length && !m.hits.length && <div className="modal-note">{L`Ничего не нашлось`}</div>}
        </>
        : m.hero
          ? <Hero m={m} actions={actions} />
          : <>
            {m.saved.length > 0 && <div className="fx-list-head">{L`Уже изменённые`}</div>}
            {m.saved.length > 0 && <Files paths={m.saved.map((x) => x.path)} actions={actions} />}
            <Heroes m={m} actions={actions} />
          </>}
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
            ? <div className="fx-stage">
              <EffectStage path={m.open.path} def={m.open.def} sprites={m.open.sprites} play={m.play} />
              <button type="button" className="fx-replay" id="fxReplay" aria-label={L`Проиграть ещё раз`} title={L`Проиграть ещё раз`} onClick={actions.replay}><span className="ms">replay</span></button>
              {!hasSprites(particleSpec(m.open.def)) && <div className="fx-none">{L`Этот эффект сделан из моделей или света, просмотр его не рисует. В игре он есть.`}</div>}
            </div>
            : <div className="fx-empty"><span className="ms">{m.busy === 'load' ? 'progress_activity' : 'auto_awesome'}</span><span>{L`Выбери героя и способность слева: эффект заиграет здесь`}</span></div>}
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
