/* The HUD editor (issue #420): the game's screen as a plan with its panels on it, to drag, size,
 * tint or hide, then the build. The plan is the point of the window: what stands where can be
 * judged before the game is started. The panels' list beside it reaches what the plan cannot, a
 * hidden panel, or a small one under a larger one. Arrow keys move the chosen panel a pixel, with
 * Shift ten. The mod window's markup and classes (.modal-body, .btn), so it reads as one of them. */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { boxOf, SHAPES, STAGE, withPatch, type HudPart, type PartShape } from './parts.ts';

export interface HudModalModel {
  /** the layout being made */
  parts: HudPart[];
  /** the panel chosen */
  chosen: string;
  /** the layout is what is on now */
  saved: boolean;
  /** a layout is on now */
  installed: boolean;
  /** the HUD mod the layout goes on, or null for the game's own */
  hudMod: string | null;
  busy: 'build' | null;
}

export interface HudModalActions {
  close: () => void;
  choose: (id: string) => void;
  parts: (parts: HudPart[]) => void;
  install: () => void;
}

/** A panel's name. */
export function partName(id: string): string {
  switch (id) {
    case 'lower_hud': return L`Нижняя панель`;
    case 'PortraitGroup': return L`Портрет`;
    case 'stats_container': return L`Характеристики`;
    case 'abilities': return L`Способности`;
    case 'health_mana': return L`Здоровье и мана`;
    case 'inventory': return L`Предметы`;
    case 'topbar': return L`Верхняя панель`;
    case 'minimap_container': return L`Мини-карта`;
    case 'shop_launcher_block': return L`Лавка и золото`;
    case 'combat_events': return L`Лента событий`;
    default: return L`Чат`;
  }
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function Block({ s, m, onDown, onKey, choose }: {
  s: PartShape; m: HudModalModel;
  onDown: (e: PointerEvent<HTMLButtonElement>, s: PartShape) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, s: PartShape) => void;
  choose: (id: string) => void;
}) {
  const b = boxOf(s, m.parts);
  const p = m.parts.find((x) => x.id === s.id);
  const cells = (s.cols ?? 0) * (s.rows ?? 0);
  return (
    <button type="button" className={`hud-block${m.chosen === s.id ? ' is-chosen' : ''}${p?.hidden ? ' is-hidden' : ''}${s.id === 'lower_hud' ? ' is-frame' : ''}`}
      data-part={s.id} aria-label={partName(s.id)} aria-pressed={m.chosen === s.id}
      style={{
        left: pct(b.x, STAGE.w), top: pct(b.y, STAGE.h), width: pct(b.w, STAGE.w), height: pct(b.h, STAGE.h),
        opacity: p?.hidden ? undefined : (p?.opacity ?? 100) / 100,
        ...(p?.tint ? { '--part-tint': p.tint } : {}),
        ...(cells ? { '--cols': s.cols, '--rows': s.rows } : {}),
      } as React.CSSProperties}
      onPointerDown={(e) => onDown(e, s)} onKeyDown={(e) => onKey(e, s)} onFocus={() => choose(s.id)}>
      {cells > 0 && Array.from({ length: cells }, (_, i) => <span className="hud-cell" key={i} />)}
    </button>
  );
}

function Panel({ m, actions }: { m: HudModalModel; actions: HudModalActions }) {
  const p: Partial<HudPart> = m.parts.find((x) => x.id === m.chosen) ?? {};
  const set = (patch: Partial<HudPart>) => actions.parts(withPatch(m.parts, m.chosen, patch));
  const shift = (p.x ?? 0) !== 0 || (p.y ?? 0) !== 0;
  return (
    <div className="hud-panel">
      <div className="hud-panel-name">{partName(m.chosen)}</div>
      <label className="sound-volume">
        <span>{L`Размер`} {p.scale ?? 100}%</span>
        <input type="range" className="scale-range" id="hudScale" min={60} max={130} step={5} value={p.scale ?? 100}
          onChange={(e) => set({ scale: Number(e.currentTarget.value) === 100 ? undefined : Number(e.currentTarget.value) })} />
      </label>
      <label className="sound-volume">
        <span>{L`Непрозрачность`} {p.opacity ?? 100}%</span>
        <input type="range" className="scale-range" id="hudOpacity" min={10} max={100} step={5} value={p.opacity ?? 100}
          onChange={(e) => set({ opacity: Number(e.currentTarget.value) === 100 ? undefined : Number(e.currentTarget.value) })} />
      </label>
      <div className="hud-panel-row">
        <label className="hud-tint">
          <input type="color" id="hudTint" aria-label={L`Оттенок`} value={p.tint ?? '#ffffff'} onInput={(e) => set({ tint: e.currentTarget.value })} />
          <span>{p.tint ? L`Оттенок ${p.tint}` : L`Без оттенка`}</span>
        </label>
        {p.tint && <button type="button" className="btn btn-ghost" onClick={() => set({ tint: undefined })}>{L`Убрать`}</button>}
      </div>
      <div className="hud-panel-row hud-shift">
        <span>{shift ? L`Сдвиг ${p.x ?? 0}, ${p.y ?? 0}` : L`На своём месте`}</span>
        {shift && <button type="button" className="btn btn-ghost" onClick={() => set({ x: undefined, y: undefined })}>{L`Вернуть`}</button>}
      </div>
    </div>
  );
}

function List({ m, actions }: { m: HudModalModel; actions: HudModalActions }) {
  return (
    <ul className="hud-list">
      {SHAPES.map((s) => {
        const p = m.parts.find((x) => x.id === s.id);
        return (
          <li key={s.id} className={`${m.chosen === s.id ? 'is-chosen' : ''}${s.inside ? ' is-inside' : ''}`}>
            <button type="button" className="hud-list-name" data-list={s.id} onClick={() => actions.choose(s.id)}>
              {partName(s.id)}{p && <span className="hud-list-mark" aria-label={L`Изменено`} />}
            </button>
            <button type="button" className="hud-list-eye" data-eye={s.id} aria-pressed={!!p?.hidden}
              aria-label={p?.hidden ? L`Показать: ${partName(s.id)}` : L`Скрыть: ${partName(s.id)}`}
              onClick={() => actions.parts(withPatch(m.parts, s.id, { hidden: p?.hidden ? undefined : true }))}>
              <span className="ms">{p?.hidden ? 'visibility_off' : 'visibility'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function HudModal({ m, actions }: { m: HudModalModel; actions: HudModalActions }) {
  const stage = useRef<HTMLDivElement>(null);

  /** A drag: the pointer's way across the plan, in the panel's own pixels, on a step of 5. */
  function down(e: PointerEvent<HTMLButtonElement>, s: PartShape): void {
    actions.choose(s.id);
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const { unit } = boxOf(s, m.parts);
    const k = STAGE.w / rect.width / unit;
    const from = { px: e.clientX, py: e.clientY, x: m.parts.find((p) => p.id === s.id)?.x ?? 0, y: m.parts.find((p) => p.id === s.id)?.y ?? 0 };
    let parts = m.parts;
    const move = (ev: globalThis.PointerEvent) => {
      const step = (v: number) => Math.round(v / 5) * 5;
      const x = step(from.x + (ev.clientX - from.px) * k);
      const y = step(from.y + (ev.clientY - from.py) * k);
      parts = withPatch(parts, s.id, { x: x || undefined, y: y || undefined });
      actions.parts(parts);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function key(e: KeyboardEvent<HTMLButtonElement>, s: PartShape): void {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const by = e.shiftKey ? 10 : 1;
    const p = m.parts.find((x) => x.id === s.id);
    const x = (p?.x ?? 0) + dir[0] * by;
    const y = (p?.y ?? 0) + dir[1] * by;
    actions.parts(withPatch(m.parts, s.id, { x: x || undefined, y: y || undefined }));
  }

  return (
    <div className="modal-body hud-editor">
      <div className="modal-title-row">
        <div className="modal-title">{L`Редактор интерфейса`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>

      <div className="hud-room">
        <div className="hud-plan">
          <div className="hud-screen" id="hudPreview" ref={stage}>
            {SHAPES.map((s) => <Block key={s.id} s={s} m={m} onDown={down} onKey={key} choose={actions.choose} />)}
          </div>
          <div className="modal-note">
            {m.hudMod
              ? L`Поверх HUD-мода «${m.hudMod}»: если его выключить, собери интерфейс заново.`
              : L`Перетаскивай панели мышью, стрелки двигают точнее.`}
          </div>
        </div>
        <div className="hud-side">
          <List m={m} actions={actions} />
          <Panel m={m} actions={actions} />
        </div>
      </div>

      <div className="modal-actions">
        {m.busy === 'build'
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : <button className="btn btn-primary" id="hudInstallBtn" disabled={m.saved} onClick={actions.install}>
            <span className="ms">download</span>{m.installed ? L`Обновить` : L`Поставить`}
          </button>}
        {m.parts.length > 0 && <button type="button" className="btn btn-ghost" id="hudResetBtn" onClick={() => actions.parts([])}>{L`Вернуть всё как в игре`}</button>}
      </div>

      <div className="modal-note">
        {L`После обновления Доты приложение соберёт стиль интерфейса заново само.`}
      </div>
    </div>
  );
}
