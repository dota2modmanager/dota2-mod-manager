/* The effect editor's window, opened from the Workshop. The files are changed in the main process
 * (src/effect-edit-service.ts): what plays here comes back from there after each change, a moment
 * later, so what is drawn is what would be built. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { showEffectModal } from '../../catalog/modal/root.tsx';
import { WHOLE, type EffectModalModel } from '../../catalog/fx/EffectModal.tsx';
import type { EffectEdit, EffectEdits } from '../../api/fx.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

const EMPTY: EffectModalModel = { query: '', results: [], saved: [], open: null, chosen: WHOLE, edits: {}, same: true, installed: false, busy: null };
/** How long after a slider stops the effect is asked for again. */
const SETTLE = 120;

let open = false;
let m = EMPTY;
/** The changes on now, to tell a change from them. */
let on = '{}';
let asked = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
sharesOverlay(() => { open = false; });

const key = (e: EffectEdits) => JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));

/** The window. */
export async function openEffects(from: Element | null): Promise<void> {
  m = EMPTY;
  takeOverlay();
  open = true;
  openOverlay(draw, from);
  await search('');
}

function draw(): void {
  if (!open) return;
  showEffectModal(m, {
    close: closeOverlay,
    query: (q) => { m = { ...m, query: q }; draw(); void search(q); },
    open: (p) => void load(p),
    back: () => { m = { ...m, open: null, edits: {}, chosen: WHOLE, same: true, installed: false }; draw(); },
    choose: (chosen) => { m = { ...m, chosen }; draw(); },
    edit,
    reset: () => changed({}),
    install: () => void install(),
  });
}

async function search(q: string): Promise<void> {
  const r = await window.api.fx.search(q);
  if (r.error || !('paths' in r)) { toast(r.error || L`Не удалось прочитать эффект`, 'error'); return; }
  if (q !== m.query) return;
  m = { ...m, results: r.paths, saved: r.saved };
  draw();
}

async function load(path: string): Promise<void> {
  m = { ...m, busy: 'load' };
  draw();
  const r = await window.api.fx.load(path);
  if (r.error || !('def' in r)) { m = { ...m, busy: null }; toast(r.error || L`Не удалось прочитать эффект`, 'error', 8000); draw(); return; }
  on = key(r.edits);
  m = { ...m, busy: null, chosen: WHOLE, edits: r.edits, same: true, installed: Object.keys(r.edits).length > 0,
    open: { path: r.path, systems: r.systems, def: r.def, sprites: r.sprites } };
  draw();
}

function edit(patch: Partial<EffectEdit>): void {
  const next: EffectEdit = { ...(m.edits[m.chosen] ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof EffectEdit)[]) if (next[k] === undefined) delete next[k];
  const edits = { ...m.edits };
  if (Object.keys(next).length) edits[m.chosen] = next; else delete edits[m.chosen];
  changed(edits);
}

function changed(edits: EffectEdits): void {
  m = { ...m, edits, same: key(edits) === on };
  draw();
  clearTimeout(timer);
  timer = setTimeout(() => void replay(), SETTLE);
}

async function replay(): Promise<void> {
  const showing = m.open;
  if (!showing) return;
  const ask = ++asked;
  const r = await window.api.fx.preview(showing.path, m.edits);
  if (ask !== asked || m.open?.path !== showing.path || !('def' in r) || !r.def) return;
  m = { ...m, open: { ...showing, def: r.def } };
  draw();
}

async function install(): Promise<void> {
  const effect = m.open?.path;
  if (m.busy || !effect) return;
  m = { ...m, busy: 'build' };
  draw();
  const r = await window.api.fx.install(effect, m.edits).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  on = key(m.edits);
  m = { ...m, same: true, installed: true };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}
