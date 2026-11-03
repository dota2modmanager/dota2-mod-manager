/* The in-game HUD made smaller or larger (issue #420): the card first among the HUDs and its
 * window. The style is built in the main process (src/hud-scale-service.ts) and is a mod in My
 * mods like any other, one at a time. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showHudModal } from '../../catalog/modal/root.tsx';
import type { HudCardModel } from '../../catalog/hud/HudCard.tsx';
import type { HudModalModel } from '../../catalog/hud/HudModal.tsx';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
let m: HudModalModel = { scale: 85, installed: null, hudMod: null, vrf: false, busy: null };
sharesOverlay(() => { open = false; });

const scaleOf = () => {
  const rec = [...store.installedIndex.values()].find((r) => typeof (r.generated as { hud?: number } | undefined)?.hud === 'number');
  return rec ? (rec.generated as { hud: number }).hud : null;
};

/** The card first among the HUDs. */
export function hudLead(category: string): HudCardModel | null {
  return category === 'huds' ? { scale: scaleOf() } : null;
}

async function load(): Promise<boolean> {
  const r = await window.api.hud.state();
  if (r.error || !('vrf' in r)) { toast(r.error || L`Не удалось прочитать интерфейс игры`, 'error'); return false; }
  m = { ...m, installed: r.installed?.scale ?? null, scale: r.installed?.scale ?? m.scale, hudMod: r.hudMod, vrf: r.vrf };
  return true;
}

/** The window, on the scale on now when there is one. */
export async function openHud(from: Element | null): Promise<void> {
  m = { scale: 85, installed: null, hudMod: null, vrf: false, busy: null };
  if (!(await load())) return;
  takeOverlay();
  open = true;
  openOverlay(draw, from);
}

function draw(): void {
  if (!open) return;
  showHudModal(m, {
    close: closeOverlay,
    scale: (scale) => { m = { ...m, scale }; draw(); },
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
  await load();
  draw();
}

async function install(): Promise<void> {
  if (m.busy) return;
  m = { ...m, busy: 'build' };
  draw();
  const r = await window.api.hud.install(m.scale).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  m = { ...m, installed: m.scale };
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
