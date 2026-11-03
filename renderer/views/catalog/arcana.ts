/* The arcanas built out of the game's own files (issue #118): their cards among the tools and their
 * window. What the window shows comes from the main process (src/arcana-service.ts); what it
 * builds is a mod in My mods like any other, so switching it off and the load order are there. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showArcanaModal } from '../../catalog/modal/root.tsx';
import type { ArcanaCardModel } from '../../catalog/arcana/ArcanaCard.tsx';
import type { ArcanaMode } from '../../catalog/arcana/ArcanaModal.tsx';
import { gemOf, type Rgb } from '../../catalog/arcana/tint.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

type State = Extract<Awaited<ReturnType<typeof window.api.arcana.state>>, { arcanas: unknown }>;

let state: State | null = null;
let open = false;
let set = 'terrorblade-arcana';
let chosen: Rgb = gemOf(set);
let own: Rgb | null = null;
let busy: ArcanaMode | null = null;
sharesOverlay(() => { open = false; });

async function load(): Promise<State | null> {
  try {
    const s = await window.api.arcana.state();
    state = s.error || !('arcanas' in s) ? null : s as State;
  } catch {
    state = null;
  }
  return state;
}

const shown = () => state?.arcanas.find((a) => a.set === set) ?? null;

/** The cards among the tools, one for each arcana the game has the files for. */
export async function arcanaLeads(): Promise<ArcanaCardModel[]> {
  const s = await load();
  return (s?.arcanas || []).filter((a) => a.available)
    .map((a) => ({ set: a.set, name: a.name, picture: a.picture, installed: a.installed?.color ?? null }));
}

export async function openArcanaWindow(which: string, from: Element | null): Promise<void> {
  if (!state) await load();
  const a = state?.arcanas.find((x) => x.set === which);
  if (!a?.available) return;
  takeOverlay();
  open = true;
  set = which;
  chosen = a.installed?.color ?? gemOf(set);
  own = null;
  openOverlay(draw, from);
}

function draw(): void {
  const a = shown();
  if (!open || !state || !a) return;
  const installed = a.installed;
  showArcanaModal({
    set: a.set,
    name: a.name,
    picture: a.picture,
    gems: state.gems,
    chosen,
    own,
    installed: installed ? { color: installed.color, mode: installed.mode } : null,
    busy,
  }, {
    close: closeOverlay,
    choose: (c, isOwn) => {
      chosen = c;
      if (isOwn) own = c;
      draw();
    },
    install: (mode) => void install(mode),
    remove: () => void remove(),
  });
}

/** From My mods: the catalog's tools, with that arcana's window open over them. */
export async function recolorFromLibrary(which: string): Promise<void> {
  store.activeCategory = 'tools';
  await switchView('catalog');
  await screen.redraw(); // a catalog kept from before is still on the category it had
  await openArcanaWindow(which, null);
}

async function install(mode: ArcanaMode): Promise<void> {
  if (busy) return;
  busy = mode;
  draw();
  let r: { error?: string };
  try {
    r = await window.api.arcana.install(set, chosen, mode);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  busy = null;
  if (r.error) { toast(r.error, 'error'); draw(); return; }
  toast(mode === 'mod' ? L`Аркана собрана и стоит в «Моих модах»` : L`Цвет арканы стоит в «Моих модах»`);
  await after();
}

async function remove(): Promise<void> {
  const id = shown()?.installed?.id;
  if (!id || busy) return;
  const r = await window.api.mods.remove(id);
  if (r.error) { toast(r.error, 'error'); return; }
  toast(L`Аркана убрана`);
  await after();
}

/** Everything the build shows on: My mods' index, the cards, the open window. */
async function after(): Promise<void> {
  await load();
  await refreshInstalledIndex();
  await screen.redraw(); // the card's picture and frame follow what was built
  draw();
}
