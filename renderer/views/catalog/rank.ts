/* The rank medal and hero levels of the player's own screen: the card first among the ranks and
 * its window. The pak is built in the main process (src/rank-look-service.ts) and is a mod in My
 * mods like any other, one at a time. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showRankModal } from '../../catalog/modal/root.tsx';
import type { RankCardModel } from '../../catalog/rank/RankCard.tsx';
import type { RankModalModel } from '../../catalog/rank/RankModal.tsx';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

const fresh = (): RankModalModel => ({
  look: { medal: null, levels: {}, every: null }, installed: false, heroes: [], portraits: {}, medals: {}, badges: [], filter: '', vrf: false, busy: null,
});
let open = false;
let m: RankModalModel = fresh();
sharesOverlay(() => { open = false; });

const installedNow = () => [...store.installedIndex.values()].some((r) => typeof (r.generated as { rank?: unknown } | undefined)?.rank === 'object');

/** The card first among the ranks. */
export function rankLead(category: string): RankCardModel | null {
  return category === 'ranks' ? { installed: installedNow() } : null;
}

async function load(): Promise<boolean> {
  const r = await window.api.rank.state();
  if (r.error || !('vrf' in r)) { toast(r.error || L`Не удалось прочитать файлы игры`, 'error'); return false; }
  m = { ...m, heroes: r.heroes, vrf: r.vrf, installed: !!r.installed, look: r.installed?.look ?? m.look };
  return true;
}

/** The pictures out of the game, after the window is up: the medals take ValveResourceFormat a second. */
async function loadPictures(): Promise<void> {
  const [pics, portraits] = await Promise.all([
    window.api.rank.pictures().catch(() => null),
    window.api.cosmetics.heroPortraits(m.heroes.map((h) => h.id)).catch(() => ({})),
  ]);
  if (pics && !pics.error && 'medals' in pics) m = { ...m, medals: pics.medals, badges: pics.badges };
  m = { ...m, portraits };
  draw();
}

/** The window, on the look on now when there is one. */
export async function openRank(from: Element | null): Promise<void> {
  m = fresh();
  if (!(await load())) return;
  takeOverlay();
  open = true;
  openOverlay(draw, from);
  void loadPictures();
}

function draw(): void {
  if (!open) return;
  showRankModal(m, {
    close: closeOverlay,
    medal: (medal) => { m = { ...m, look: { ...m.look, medal } }; draw(); },
    every: (every) => { m = { ...m, look: { ...m.look, every } }; draw(); },
    level: (hero, n) => {
      const levels = { ...m.look.levels };
      if (n === null) delete levels[hero]; else levels[hero] = n;
      m = { ...m, look: { ...m.look, levels } };
      draw();
    },
    filter: (filter) => { m = { ...m, filter }; draw(); },
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
  void loadPictures();
}

async function install(): Promise<void> {
  if (m.busy) return;
  m = { ...m, busy: 'build' };
  draw();
  const r = await window.api.rank.install(m.look).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  m = { ...m, installed: true };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}

/** From My mods: the ranks, with the window open. */
export async function rankFromLibrary(): Promise<void> {
  store.activeCategory = 'ranks';
  await switchView('catalog');
  await screen.redraw();
  await openRank(null);
}
