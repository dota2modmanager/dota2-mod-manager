/* The effect editor's window, opened from the Workshop. The files are changed in the main process
 * (src/effect-edit-service.ts): what plays here comes back from there after each change, a moment
 * later, so what is drawn is what would be built. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { showEffectModal } from '../../catalog/modal/root.tsx';
import { WHOLE, type EffectModalModel } from '../../catalog/fx/EffectModal.tsx';
import type { AbilityHit, EffectEdit, EffectEdits } from '../../api/fx.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

const EMPTY: EffectModalModel = { query: '', results: [], hits: [], saved: [], heroes: [], portraits: {}, icons: {}, hero: null, groups: [], group: null, play: 0, open: null, chosen: WHOLE, edits: {}, same: true, installed: false, busy: null };
/** How long after a slider stops the effect is asked for again. */
const SETTLE = 120;

let open = false;
let m = EMPTY;
/** The changes on now, to tell a change from them. */
let on = '{}';
let asked = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
sharesOverlay(() => { open = false; });

const key = (e: EffectEdits, items = false) => JSON.stringify([items, ...Object.keys(e).sort().map((k) => [k, e[k]])]);
const settle = () => { m = { ...m, same: key(m.edits, m.open?.items) === on }; };

/** The window. */
export async function openEffects(from: Element | null): Promise<void> {
  m = EMPTY;
  takeOverlay();
  open = true;
  openOverlay(draw, from);
  await search('');
  await heroes();
}

/** The heroes, and their portraits when the game has given them. */
async function heroes(): Promise<void> {
  const r = await window.api.fx.heroes();
  if (r.error || !('heroes' in r)) return;
  const list = [...r.heroes].sort((a, b) => a.name.localeCompare(b.name));
  m = { ...m, heroes: list };
  draw();
  const portraits: Record<string, string> = await window.api.cosmetics.heroPortraits(list.map((h) => h.hero)).catch(() => ({}));
  m = { ...m, portraits };
  draw();
}

/** A hero's effects, with an ability's line open when one is given. */
async function showHero(hero: string | null, group: string | null = null): Promise<void> {
  if (!hero) { m = { ...m, hero: null, groups: [], group: null }; draw(); return; }
  const r = await window.api.fx.hero(hero);
  if (r.error || !('groups' in r)) { toast(r.error || L`Не удалось прочитать эффект`, 'error'); return; }
  m = { ...m, hero, groups: r.groups, group, query: '', results: [], hits: [] };
  draw();
  const abilities = r.groups.flatMap((g) => (g.ability ? [g.ability] : []));
  const icons: Record<string, string> = await window.api.paint.icons(abilities).catch(() => ({}));
  m = { ...m, icons: { ...m.icons, ...icons } };
  draw();
}

/** A line of the hero's effects: one effect alone opens at once. */
function showGroup(id: string | null): void {
  const g = m.groups.find((x) => x.id === id);
  // an ability opens whole: one colour goes on all its files, and a file of it can still be picked
  if (g?.ability && m.hero) { void load(`ability:${m.hero}/${g.ability}`); return; }
  m = { ...m, group: id };
  draw();
  if (g?.paths.length === 1) void load(g.paths[0]);
}

async function showHit(hit: AbilityHit): Promise<void> {
  await showHero(hit.hero, null);
  showGroup(m.groups.find((g) => g.ability === hit.ability)?.id ?? null);
}

function draw(): void {
  if (!open) return;
  showEffectModal(m, {
    close: closeOverlay,
    query: (q) => { m = { ...m, query: q }; draw(); void search(q); },
    open: (p) => void load(p),
    hero: (hero) => void showHero(hero),
    group: showGroup,
    hit: (hit) => void showHit(hit),
    replay: () => { m = { ...m, play: m.play + 1 }; draw(); },
    back: () => { m = { ...m, open: null, edits: {}, chosen: WHOLE, same: true, installed: false }; draw(); },
    choose: (chosen) => { m = { ...m, chosen }; draw(); },
    items: (items) => { if (m.open) { m = { ...m, open: { ...m.open, items } }; settle(); draw(); } },
    edit,
    reset: () => changed({}),
    install: () => void install(),
  });
}

async function search(q: string): Promise<void> {
  const r = await window.api.fx.search(q);
  if (r.error || !('paths' in r)) { toast(r.error || L`Не удалось прочитать эффект`, 'error'); return; }
  if (q !== m.query) return;
  m = { ...m, results: r.paths, hits: r.abilities, saved: r.saved };
  draw();
}

async function load(path: string): Promise<void> {
  m = { ...m, busy: 'load' };
  draw();
  const r = await window.api.fx.load(path);
  if (r.error || !('defs' in r)) { m = { ...m, busy: null }; toast(r.error || L`Не удалось прочитать эффект`, 'error', 8000); draw(); return; }
  on = key(r.edits, r.items);
  m = { ...m, busy: null, chosen: WHOLE, edits: r.edits, same: true, installed: Object.keys(r.edits).length > 0,
    open: { path: r.path, name: r.name, systems: r.systems, defs: r.defs, sprites: r.sprites, variants: r.variants, items: r.items } };
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
  m = { ...m, edits };
  settle();
  draw();
  clearTimeout(timer);
  timer = setTimeout(() => void replay(), SETTLE);
}

async function replay(): Promise<void> {
  const showing = m.open;
  if (!showing) return;
  const ask = ++asked;
  const r = await window.api.fx.preview(showing.path, m.edits);
  if (ask !== asked || m.open?.path !== showing.path || !('defs' in r) || !r.defs.length) return;
  m = { ...m, open: { ...m.open, defs: r.defs } };
  draw();
}

async function install(): Promise<void> {
  const effect = m.open?.path;
  if (m.busy || !effect) return;
  m = { ...m, busy: 'build' };
  draw();
  const r = await window.api.fx.install(effect, m.edits, m.open?.items).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  on = key(m.edits, m.open?.items);
  m = { ...m, same: true, installed: true };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}
