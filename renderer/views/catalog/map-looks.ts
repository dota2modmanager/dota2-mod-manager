/* Towers and trees out of the game's own looks (issues #446, #421): the card first in each of the
 * two categories and its window. What the window offers comes from the main process
 * (src/map-looks-service.ts); what it builds is a mod in My mods like any other. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { loadCosmeticIcons } from '../../ui/cosmetic-icons.ts';
import { showMapLookModal } from '../../catalog/modal/root.tsx';
import type { MapLookCardModel } from '../../catalog/map/MapLookCard.tsx';
import type { Side } from '../../catalog/map/MapLookModal.tsx';
import type { MapKind } from '../../api/content.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

type State = Extract<Awaited<ReturnType<typeof window.api.map.state>>, { towers: unknown }>;

let state: State | null = null;
let open = false;
let kind: MapKind = 'towers';
let chosen: Record<Side, string | null> = { radiant: null, dire: null };
let busy = false;
sharesOverlay(() => { open = false; });

async function load(): Promise<State | null> {
  try {
    const s = await window.api.map.state();
    state = s.error || !('towers' in s) ? null : s as State;
  } catch {
    state = null;
  }
  return state;
}

/** The card first in the towers or trees category, or nothing when the game offers no look. */
export async function mapLookLead(category: string): Promise<MapLookCardModel | null> {
  if (category !== 'towers' && category !== 'trees') return null;
  const s = await load();
  if (!s || !s[category].length) return null;
  const picture = category === 'towers' ? s.towers[0].name : null;
  if (picture) void loadCosmeticIcons([picture], () => {});
  return { kind: category, picture, installed: Boolean(s.installed[category]) };
}

export async function openMapLooks(which: MapKind, from: Element | null): Promise<void> {
  if (!state) await load();
  if (!state) return;
  takeOverlay();
  open = true;
  kind = which;
  const had = state.installed[kind];
  chosen = { radiant: had?.radiant ?? null, dire: had?.dire ?? null };
  if (kind === 'towers') void loadCosmeticIcons(state.towers.map((o) => o.name), () => {});
  openOverlay(draw, from);
}

function draw(): void {
  if (!open || !state) return;
  const had = state.installed[kind];
  showMapLookModal({
    kind,
    options: state[kind],
    chosen,
    installed: had ? { radiant: had.radiant, dire: had.dire } : null,
    busy,
  }, {
    close: closeOverlay,
    choose: (side, id) => { chosen = { ...chosen, [side]: id }; draw(); },
    install: () => void install(),
    remove: () => void remove(),
  });
}

/** From My mods: the record's category, with its window open over it. */
export async function mapLooksFromLibrary(which: MapKind): Promise<void> {
  store.activeCategory = which;
  await switchView('catalog');
  await screen.redraw();
  await openMapLooks(which, null);
}

async function install(): Promise<void> {
  if (busy) return;
  busy = true;
  draw();
  let r: { error?: string };
  try {
    r = await window.api.map.install(kind, chosen.radiant, chosen.dire);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  busy = false;
  if (r.error) { toast(r.error, 'error'); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  await after();
}

async function remove(): Promise<void> {
  const id = state?.installed[kind]?.id;
  if (!id || busy) return;
  const r = await window.api.mods.remove(id);
  if (r.error) { toast(r.error, 'error'); return; }
  toast(L`Убрано`);
  chosen = { radiant: null, dire: null };
  await after();
}

async function after(): Promise<void> {
  await load();
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}
