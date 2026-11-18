/* The window for a cursor set of the user's own: every cursor of the game, each taken from the game,
 * from one of the game's own cursor sets (the cosmetics' ones in resource\cursor), or from a picture
 * of the user's. A set picked on top puts all of its cursors on at once; a cursor picked in the grid
 * shows in the column on the right, where it changes alone, and the strip under it wears the result
 * to try it before it goes in. Nothing is added or taken out of the layout as the user picks, so
 * nothing jumps. */
import { useEffect, useRef, useState } from 'react';
import { GROUPS } from './kinds.ts';
import { CursorPanel } from './CursorPanel.tsx';
import { CursorPlay } from './CursorPlay.tsx';
import { droppedPicture, type CursorModalActions, type CursorModalModel } from './model.ts';

/** The row of sets scrolls sideways with no bar: the wheel turns it, and an arrow stands at each end
 * there is more beyond. The browser's own smooth scroll starts over on every notch of the wheel, which
 * stutters; here the notches add up to one target the row glides to, a frame at a time. */
function useSideways() {
  const row = useRef<HTMLDivElement>(null);
  const glide = useRef({ target: 0, frame: 0 });
  const [ends, setEnds] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEnds((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  const toward = (delta: number) => {
    const el = row.current;
    if (!el) return;
    const g = glide.current;
    const max = el.scrollWidth - el.clientWidth;
    // a new gesture starts from where the row is, not from where the last one meant to stop
    if (!g.frame) g.target = el.scrollLeft;
    g.target = Math.min(max, Math.max(0, g.target + delta));
    if (g.frame) return;
    const step = () => {
      const d = g.target - el.scrollLeft;
      if (Math.abs(d) < 0.5) {
        el.scrollLeft = g.target;
        g.frame = 0;
        measure();
        return;
      }
      el.scrollLeft += d * 0.22;
      g.frame = requestAnimationFrame(step);
    };
    g.frame = requestAnimationFrame(step);
  };
  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    measure();
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!d) return;
      e.preventDefault();
      toward(d * (e.deltaMode === 1 ? 32 : 1));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('wheel', wheel); ro.disconnect(); cancelAnimationFrame(glide.current.frame); glide.current.frame = 0; };
  }, []);
  const by = (dir: number) => toward(dir * ((row.current?.clientWidth ?? 400) - 80));
  return { row, ends, measure, by };
}

function Packs({ m, actions }: { m: CursorModalModel; actions: CursorModalActions }) {
  const none = m.tiles.every((t) => t.source.from === 'game');
  const { row, ends, measure, by } = useSideways();
  return (
    <section className="cursor-packs">
      <div className="cursor-section-title">{L`Наборы курсоров из Доты`}<span>{L`клик — поставить набор целиком`}</span></div>
      <div className="cursor-packs-wrap">
      <button className={`cursor-pack-arrow left${ends.left ? ' show' : ''}`} aria-label={L`Назад`} onClick={() => by(-1)}><span className="ms">chevron_left</span></button>
      <button className={`cursor-pack-arrow right${ends.right ? ' show' : ''}`} aria-label={L`Дальше`} onClick={() => by(1)}><span className="ms">chevron_right</span></button>
      <div className="cursor-pack-row" id="cursorPacks" ref={row} onScroll={measure}>
        <button className={`cursor-pack${none ? ' on' : ''}`} data-pack="game" onClick={() => actions.pack(null)}>
          <span className="cursor-pack-pic checker"><img src={m.gamePicture} alt="" /></span>
          <span className="cursor-pack-name">{L`Как в игре`}</span>
        </button>
        {m.packs.map((p) => (
          <button key={p.id} className={`cursor-pack${m.whole === p.id ? ' on' : ''}`} data-pack={p.id} title={p.name} onClick={() => actions.pack(p.id)}>
            <span className="cursor-pack-pic checker"><img src={p.picture} alt="" /></span>
            <span className="cursor-pack-name">{p.name}</span>
          </button>
        ))}
      </div>
      </div>
    </section>
  );
}

export function CursorModal({ m, actions }: { m: CursorModalModel; actions: CursorModalActions }) {
  const selected = m.tiles.find((t) => t.kind.name === m.selected) ?? m.tiles[0];
  const changed = m.tiles.filter((t) => t.source.from !== 'game').length;
  return (
    <div className="modal-body cursor-maker">
      <div className="modal-title-row">
        <div className="modal-title">{L`Свой курсор`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub"><span>{L`Каждый курсор Доты — как в игре, из любого набора курсоров игры или своей картинкой.`}</span></div>

      <div className="cursor-layout">
        <div className="cursor-main">
          <Packs m={m} actions={actions} />
          <div className="cursor-groups" id="cursorGroups">
            {GROUPS.map((g) => {
              const tiles = m.tiles.filter((t) => t.kind.group === g.id);
              if (!tiles.length) return null;
              return (
                <section key={g.id} className="cursor-group">
                  <div className="cursor-group-title">{g.title()}</div>
                  <div className="cursor-grid">
                    {tiles.map((t) => (
                      <button key={t.kind.name} className={`cursor-tile${selected?.kind.name === t.kind.name ? ' on' : ''} is-${t.source.from}`} data-cursor={t.kind.name} data-own-drop
                        onClick={() => actions.select(t.kind.name)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); const f = droppedPicture(e); if (f) actions.own(t.kind.name, f); }}>
                        <span className="cursor-tile-pic checker"><img src={t.mine ?? t.game} alt="" draggable={false} /></span>
                        <span className="cursor-tile-name">{t.kind.label}</span>
                        <span className={`cursor-chip chip-${t.source.from}`} title={t.from}>{t.from}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <aside className="cursor-side">
          {selected && <CursorPanel t={selected} actions={actions} />}
          <CursorPlay tiles={m.tiles} play={m.play} actions={actions} />
        </aside>
      </div>

      <div className="modal-actions">
        <button className="btn btn-primary" id="cursorInstallBtn" disabled={m.busy || (!changed && !m.installed) || (m.installed && m.saved)} onClick={actions.install}>
          <span className="ms">{m.busy ? 'progress_activity' : 'download'}</span>
          {m.busy ? L`Собираю…` : m.installed ? (m.saved ? L`Стоит` : L`Обновить`) : L`Поставить`}
        </button>
        <span className="cursor-count">{L`Изменено курсоров: ${changed} из ${m.tiles.length}`}</span>
        <span className="cursor-foot">{L`Одновременно включён только один набор курсоров. Каждый курсор пишется во всех четырёх размерах из настроек Доты.`}</span>
      </div>
    </div>
  );
}
