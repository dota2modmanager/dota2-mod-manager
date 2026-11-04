/* The map without its decor: the card first in Optimization and its window. The pak is built in the
 * main process (src/map-decor.ts) and is a mod in My mods like any other, one at a time. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { toast } from '../../ui/toast.ts';
import { showDecorModal } from '../../catalog/modal/root.tsx';
import type { DecorCardModel } from '../../catalog/decor/DecorCard.tsx';
import type { DecorModalModel } from '../../catalog/decor/DecorModal.tsx';
import type { DecorGroup } from '../../api/content.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
let m: DecorModalModel = { groups: ['plants', 'debris'], installed: null, counts: null, busy: false };
sharesOverlay(() => { open = false; });

const installed = () => [...store.installedIndex.values()].some((r) => Array.isArray((r.generated as { decor?: unknown } | undefined)?.decor));

/** The card first in Optimization. */
export function decorLead(category: string): DecorCardModel | null {
  return category === 'optimization' ? { installed: installed() } : null;
}

/** The window, on the groups off the map now when there are any. */
export async function openDecor(from: Element | null): Promise<void> {
  const r = await window.api.decor.state();
  if (r.error || !('counts' in r)) { toast(r.error || L`Не удалось прочитать карту`, 'error'); return; }
  m = { groups: r.installed?.groups ?? ['plants', 'debris'], installed: r.installed?.groups ?? null, counts: r.counts, busy: false };
  takeOverlay();
  open = true;
  openOverlay(draw, from);
}

function draw(): void {
  if (!open) return;
  showDecorModal(m, {
    close: closeOverlay,
    toggle: (g: DecorGroup) => { m = { ...m, groups: m.groups.includes(g) ? m.groups.filter((x) => x !== g) : [...m.groups, g] }; draw(); },
    install: () => void install(),
  });
}

async function install(): Promise<void> {
  if (m.busy) return;
  m = { ...m, busy: true };
  draw();
  const r = await window.api.decor.install(m.groups).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: false };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  m = { ...m, installed: m.groups };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}
