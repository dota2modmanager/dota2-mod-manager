/* A hero's own pedestal on the loadout screen, the right side of its window when the Pedestal tab
 * is open: the game's pedestals (the ones arcanas and other items bring, then the plain ones), and
 * "as in the game". The choice is sewn into the hero's loadout animation by the next build
 * (crates/mm-core/src/item_builder/hero_pedestals.rs); with nothing chosen an arcana's own
 * pedestal goes on by itself.
 *
 * The game's pedestal under it: with the item table it is hidden for this hero alone; without it
 * a file can only hide it for everybody, which is the switch at the top, said in so many words. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { state } from '../../core/store.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import { Toggle } from '../../settings/Toggle.tsx';
import type { PedestalOption } from '../../api/content.ts';

let options: Promise<PedestalOption[]> | null = null;
/** the names of the pedestals read so far, by model, for the tab under the list */
const names = new Map<string, string>();

/** A pedestal's name: its item's once the list is read, else its model's file. */
export function pedestalName(model: string): string {
  return names.get(model) ?? (model.split('/').pop() ?? model).replace(/.vmdl$/, '').replace(/_/g, ' ');
}

/** The game's pedestals, asked once: they change only with the game. */
function loadOptions(): Promise<PedestalOption[]> {
  options ??= window.api.cosmetics.pedestals().then((r) => {
    if ('error' in r) throw Error(r.error);
    for (const o of r.options) names.set(o.model, o.name);
    return r.options;
  });
  options.catch(() => { options = null; });
  return options;
}

/** A pedestal's picture: the one kept in the app's folder, else drawn out of its model and kept
 * there, so the next time opens with every picture at once. */
async function pedestalPicture(model: string): Promise<string | null> {
  const kept = await window.api.preview3d.pedestalPicture(model).catch(() => null);
  if (kept) return kept;
  const { modelThumb } = await import('../preview3d/model-thumb.ts');
  const uri = await modelThumb(model);
  if (uri?.startsWith('data:image/webp;base64,')) {
    const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    void window.api.preview3d.keepPedestalPicture(model, bytes).catch(() => null);
  }
  return uri;
}

/** A pedestal's picture drawn out of its own model (preview3d/model-thumb.ts), once its card is
 * near the screen: seventy models are not exported for a pane looked at for its first row. */
function PedestalPicture({ model }: { model: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const at = ref.current;
    if (!at) return;
    let gone = false;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      void pedestalPicture(model).then((uri) => { if (!gone) setSrc(uri); }, () => { if (!gone) setSrc(null); });
    }, { rootMargin: '200px' });
    seen.observe(at);
    return () => { gone = true; seen.disconnect(); };
  }, [model]);
  return (
    <span ref={ref} className={`card-thumb ${src === undefined ? 'loading' : ''}`}>
      {src ? <img src={src} alt="" className="arrived" draggable={false} /> : src === null ? <div className="noimg"><span className="ms">podium</span></div> : null}
    </span>
  );
}

const stagger = (i: number) => ({ '--i': Math.min(i, 24) }) as CSSProperties;

export function PedestalPane({ hero, onChange }: { hero: string; onChange: () => void }) {
  const [list, setList] = useState<PedestalOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    loadOptions().then((o) => { if (live) setList(o); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const chosen = state.settings?.heroPedestals?.[hero] ?? '';
  const table = Boolean(state.settings?.schemaPatch);
  const hideBase = Boolean(state.settings?.pedestalHideBase);

  const savedLift = state.settings?.heroPedestalHeights?.[hero] ?? 0;
  const [lift, setLift] = useState(savedLift);
  useEffect(() => setLift(savedLift), [hero, savedLift]);
  const save = async (key: 'heroPedestals' | 'pedestalHideBase' | 'heroPedestalHeights', value: Record<string, string> | Record<string, number> | boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      state.settings = key === 'heroPedestals'
        ? await window.api.settings.set('heroPedestals', value as Record<string, string>)
        : key === 'heroPedestalHeights'
          ? await window.api.settings.set('heroPedestalHeights', value as Record<string, number>)
          : await window.api.settings.set('pedestalHideBase', value as boolean);
      onChange();
    } finally {
      setBusy(false);
    }
  };
  const choose = (model: string) => {
    const next = { ...(state.settings?.heroPedestals ?? {}) };
    if (model) next[hero] = model;
    else delete next[hero];
    void save('heroPedestals', next);
  };
  const shown: (PedestalOption | null)[] = [null, ...(list ?? [])];
  // the height is kept when the slider is let go, not on every step it passes
  const keepLift = (n: number) => {
    if (n === savedLift) return;
    const next = { ...(state.settings?.heroPedestalHeights ?? {}) };
    if (n) next[hero] = n;
    else delete next[hero];
    void save('heroPedestalHeights', next);
  };

  return (
    <div className="ward-slot" id="pedestalPane">
      <div className="ward-pane-head">
        <h3 className="ward-pane-title">{L`Пьедестал`}</h3>
      </div>
      <div className="ward-shelf-note" role="note">
        {L`Пьедестал вшивается в анимацию героя на экране снаряжения и в матче не виден. Если тут ничего не выбрано, аркана со своим пьедесталом ставит его сама.`}
      </div>
      {table
        ? <div className="ward-shelf-note" id="pedestalTableNote">{L`Пьедестал игры под героем скрывается через таблицу предметов, только у героев со своим пьедесталом.`}</div>
        : (
          <div className="ward-shelf-note pedestal-base">
            <Toggle id="pedestalHideBase" on={hideBase} label={L`Скрыть пьедестал игры у всех героев`} disabled={busy} onClick={() => { void save('pedestalHideBase', !hideBase); }} />
            <span>{hideBase
              ? L`Включено: пьедестал игры пропадает у всех героев. Свой стоит у тех, кому ты его выбрал, остальные остаются без пьедестала.`
              : L`Выключено: свой пьедестал ставится поверх пьедестала игры. Таблица предметов выключена, поэтому скрыть пьедестал игры у одного героя нельзя.`}</span>
          </div>
        )}
      <label className="sound-volume pedestal-lift" title={L`Ноги героя проваливаются в пьедестал или висят над ним: подвинь пьедестал. Каждому герою — своя высота.`}>
        <span>{L`Высота пьедестала`} {lift > 0 ? `+${lift}` : lift}</span>
        <input type="range" className="scale-range" id="pedestalLift" min={-64} max={64} step={1} value={lift} disabled={busy}
          onChange={(e) => setLift(Number(e.currentTarget.value))}
          onPointerUp={(e) => keepLift(Number(e.currentTarget.value))}
          onKeyUp={(e) => keepLift(Number(e.currentTarget.value))} />
        {lift !== 0 && <button className="btn btn-sm btn-ghost" id="pedestalLiftReset" disabled={busy} onClick={(e) => { e.preventDefault(); setLift(0); keepLift(0); }}>{L`Сбросить`}</button>}
      </label>
      <div className="ward-scroll">
        {failed
          ? <div className="ward-shelf-note warn">{L`Не удалось прочитать пьедесталы из файлов игры.`}</div>
          : !list
            ? <div className="ward-shelf-note">{L`Загрузка…`}</div>
            : (
              <div className="item-pick-grid ward-grid" id="pedestalGrid">
                {shown.map((o, i) => {
                  const model = o?.model ?? '';
                  const picked = model === chosen;
                  return (
                    <button key={model || 'game'} className={`card item-pick-card ${picked ? 'picked installed' : ''}`} data-pedestal={model}
                      aria-pressed={picked} disabled={busy} style={stagger(i)} onClick={() => { if (!picked) choose(model); }}>
                      <div className="card-media">
                        {o ? <PedestalPicture model={o.model} /> : <div className="noimg"><span className="ms">block</span></div>}
                      </div>
                      <div className="card-body">
                        <div className="card-name" title={o?.model ?? ''}>{o ? cosmeticName(o.name) : L`Как в игре`}</div>
                        <div className="card-meta">{picked ? <span className="ward-on">{L`Выбрано`}</span> : null}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
      </div>
    </div>
  );
}
