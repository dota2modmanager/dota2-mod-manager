/* The arcana built out of the game's own files (issue #118): its card among the tools and its
 * window. What the window shows comes from the main process (src/arcana-service.ts); what it
 * builds is a mod in My mods like any other, so switching it off and the load order are there. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showArcanaModal } from '../../catalog/modal/root.tsx';
import type { ArcanaCardModel } from '../../catalog/arcana/ArcanaCard.tsx';
import type { ArcanaMode } from '../../catalog/arcana/ArcanaModal.tsx';
import { GEM, type Rgb } from '../../catalog/arcana/tint.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

type State = Awaited<ReturnType<typeof window.api.arcana.state>>;

let state: State | null = null;
let open = false;
let chosen: Rgb = GEM;
let own: Rgb | null = null;
let busy: ArcanaMode | null = null;
sharesOverlay(() => { open = false; });

async function load(): Promise<State | null> {
  try {
    const s = await window.api.arcana.state();
    state = s.error ? null : s;
  } catch {
    state = null;
  }
  return state;
}

/** The card among the tools, or nothing when the game has no arcana to build from. */
export async function arcanaLead(): Promise<ArcanaCardModel | null> {
  const s = await load();
  if (!s?.available) return null;
  return { picture: s.picture, installed: s.installed?.color ?? null };
}

export async function openArcanaWindow(from: Element | null): Promise<void> {
  const s = state ?? await load();
  if (!s?.available) return;
  takeOverlay();
  open = true;
  chosen = s.installed?.color ?? GEM;
  own = null;
  openOverlay(draw, from);
}

function draw(): void {
  if (!open || !state) return;
  const installed = state.installed;
  showArcanaModal({
    picture: state.picture,
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

/** From My mods: the catalog's tools, with the arcana's window open over them. */
export async function recolorFromLibrary(): Promise<void> {
  store.activeCategory = 'tools';
  await switchView('catalog');
  await screen.redraw(); // a catalog kept from before is still on the category it had
  await openArcanaWindow(null);
}

async function install(mode: ArcanaMode): Promise<void> {
  if (busy) return;
  busy = mode;
  draw();
  let r: { error?: string };
  try {
    r = await window.api.arcana.install(chosen, mode);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  busy = null;
  if (r.error) { toast(r.error, 'error'); draw(); return; }
  toast(mode === 'mod' ? L`Аркана собрана и стоит в «Моих модах»` : L`Цвет арканы стоит в «Моих модах»`);
  await after();
}

async function remove(): Promise<void> {
  const id = state?.installed?.id;
  if (!id || busy) return;
  const r = await window.api.mods.remove(id);
  if (r.error) { toast(r.error, 'error'); return; }
  toast(L`Аркана убрана`);
  await after();
}

/** Everything the build shows on: My mods' index, the card, the open window. */
async function after(): Promise<void> {
  await load();
  await refreshInstalledIndex();
  await screen.redraw(); // the card's picture and frame follow what was built
  draw();
}
