/* The 3D side of a river mod's window (stage.ts): the map's own 3D view (decor/map-view.ts) of the
 * middle of the map alone, where the middle lane crosses the river, the water flowing, in the mod's colours. A river
 * mod is a pak of the game's water materials (crates/mm-core/src/looks/map_paint.rs Water), so the
 * map is the default one and only its water changes. The map is exported once and kept; until it
 * is in, the mod's picture stands where it will be. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModStage as Stage } from './stage.ts';

type Ready = { kind: 'wait'; note: string | null } | { kind: 'shown' } | { kind: 'none'; text: string };

export function RiverStage({ stage, picture }: { stage: Stage; picture: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<Ready>({ kind: 'wait', note: null });
  const key = `${stage.category}|${stage.file}`;
  useEffect(() => {
    let gone = false;
    let view: { dispose(): void } | null = null;
    setReady({ kind: 'wait', note: null });
    void (async () => {
      try {
        const [state, paint] = await Promise.all([window.api.decor.state(), window.api.decor.paint(stage.file, 'river')]);
        if (gone) return;
        if (state.error || !('samples' in state) || !state.samples) { setReady({ kind: 'none', text: state.error || L`Для 3D нужны инструменты Source 2: их можно скачать в настройках` }); return; }
        if (!paint || 'error' in paint || paint.kind !== 'pak') {
          setReady({ kind: 'none', text: (paint && 'error' in paint && paint.error) || L`Не удалось показать мод в 3D` });
          return;
        }
        const { mountMapView } = await import('../decor/map-view.ts');
        if (gone || !host.current) return;
        const v = await mountMapView(host.current, state.samples, null, (t) => {
          if (!gone) setReady(t ? { kind: 'wait', note: t } : { kind: 'shown' });
        }, 'mid');
        if (gone) { v.dispose(); return; }
        view = v;
        v.paint(paint);
        v.focusRiver();
      } catch (err) {
        if (!gone) setReady({ kind: 'none', text: String((err as Error)?.message || err) });
      }
    })();
    return () => { gone = true; view?.dispose(); };
    // the stage is the mod's file; a new object each draw is not a new mod
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="preview3d preview3d-studio prop-stage" id="preview3d" data-status={ready.kind === 'shown' ? 'shown' : ready.kind === 'wait' ? 'loading' : 'failed'}>
      {ready.kind !== 'shown' && picture}
      <div className="prop-stage-canvas" ref={host} />
      {ready.kind === 'wait' && <div className="preview3d-note"><span className="ms">progress_activity</span>{ready.note ?? L`Скачиваю мод и готовлю карту…`}</div>}
      {ready.kind === 'none' && <div className="preview3d-missing" title={ready.text}>{ready.text}</div>}
      {ready.kind === 'shown' && <div className="prop-stage-hint">{L`Мышью: крутить, приближать, двигать (правая кнопка)`}</div>}
    </div>
  );
}
