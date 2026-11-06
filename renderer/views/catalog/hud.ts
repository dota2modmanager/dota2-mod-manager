/* The HUD editor (issue #420): the card first among the HUDs and its window. The style is built in the main process (src/hud-scale-service.ts) and is a mod in My
 * mods like any other, one at a time. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showHudModal } from '../../catalog/modal/root.tsx';
import type { HudCardModel } from '../../catalog/hud/HudCard.tsx';
import type { HudModalModel } from '../../catalog/hud/HudModal.tsx';
import { layoutKey, type HudPart } from '../../catalog/hud/parts.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
const EMPTY: HudModalModel = { parts: [], chosen: 'lower_hud', saved: true, installed: false, hudMod: null, vrf: false, busy: null };
let m = EMPTY;
/** The layout on now, to tell a change from it. */
let on: HudPart[] = [];
sharesOverlay(() => { open = false; });

/** How many panels the layout on now changes, or null with none on. */
const changedNow = (): number | null => {
  const g = [...store.installedIndex.values()].map((r) => r.generated as { hud?: number; parts?: HudPart[] } | undefined).find((x) => typeof x?.hud === 'number');
  return g ? g.parts?.length ?? 2 : null;
};

/** The card first among the HUDs. */
export function hudLead(category: string): HudCardModel | null {
  return category === 'huds' ? { changed: changedNow() } : null;
}

async function load(): Promise<boolean> {
  const r = await window.api.hud.state();
  if (r.error || !('vrf' in r)) { toast(r.error || L`Не удалось прочитать интерфейс игры`, 'error'); return false; }
  on = r.installed?.parts ?? [];
  m = { ...m, parts: on, saved: true, installed: !!r.installed, hudMod: r.hudMod, vrf: r.vrf };
  return true;
}

/** The window, on the layout on now when there is one. */
export async function openHud(from: Element | null): Promise<void> {
  m = EMPTY;
  if (!(await load())) return;
  takeOverlay();
  open = true;
  openOverlay(draw, from);
}

function draw(): void {
  if (!open) return;
  showHudModal(m, {
    close: closeOverlay,
    choose: (chosen) => { if (chosen !== m.chosen) { m = { ...m, chosen }; draw(); } },
    parts: (parts) => { m = { ...m, parts, saved: layoutKey(parts) === layoutKey(on) }; draw(); },
    getTool: () => void getTool(),
    install: () => void install(),
  });
}

async function getTool(): Promise<void> {
  m = { ...m, busy: 'tool' };
  draw();
  const r = await window.api.tools.install('vrf').catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r && 'error' in r && r.error) toast(r.error, 'error', 8000);
  const made = m.parts;
  await load();
  m = { ...m, parts: made, saved: layoutKey(made) === layoutKey(on) };
  draw();
}

async function install(): Promise<void> {
  if (m.busy) return;
  m = { ...m, busy: 'build' };
  draw();
  const r = await window.api.hud.install(m.parts).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  on = m.parts;
  m = { ...m, saved: true, installed: true };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}

/** From My mods: the HUDs, with the window open. */
export async function hudFromLibrary(): Promise<void> {
  store.activeCategory = 'huds';
  await switchView('catalog');
  await screen.redraw();
  await openHud(null);
}
