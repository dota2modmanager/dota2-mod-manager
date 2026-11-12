/* A hero's ability icons picked from his own cosmetics': the window, opened from the Workshop and from
 * the hero's record in My mods. The heroes, their abilities and the icons come from the main process
 * (src/ability-icons-service.ts); a pick goes on at once, as a mod in My mods, one per hero. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showIconModal } from '../../catalog/modal/root.tsx';
import type { IconModalModel } from '../../catalog/icons/IconModal.tsx';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

type HeroPart = Omit<IconModalModel, 'heroes' | 'portraits' | 'picked' | 'heroFilter' | 'pictures'>;

let open = false;
let heroes: { id: string; name: string }[] = [];
let portraits: Record<string, string> = {};
const pictures: Record<string, string> = {};
let heroFilter = '';
let m: HeroPart = blank(null);
sharesOverlay(() => { open = false; });

function blank(hero: string | null): HeroPart {
  return { hero, abilities: [], picks: {}, busy: null, vrf: true, gettingTool: false };
}

const pickedHeroes = () => [...store.installedIndex.values()].map((r) => (r.generated as { abilityIcons?: string } | undefined)?.abilityIcons).filter((h): h is string => !!h);

/** How many heroes have icons picked, for the Workshop's tile. */
export const iconsPicked = (): number => pickedHeroes().length;

/** The window, on `hero` when one is given (from My mods). */
export async function openAbilityIcons(from: Element | null, hero: string | null = null): Promise<void> {
  if (!heroes.length) {
    const r = await window.api.icons.heroes();
    if (r.error || !('heroes' in r)) { toast(r.error || L`Не удалось прочитать иконки игры`, 'error'); return; }
    heroes = r.heroes.map((h) => ({ id: h.hero, name: h.name }));
  }
  takeOverlay();
  open = true;
  m = blank(null);
  heroFilter = '';
  openOverlay(draw, from);
  if (hero) await pickHero(hero);
  // the portraits come after the window is up: the first time they take the game a moment
  if (!Object.keys(portraits).length) {
    portraits = await window.api.cosmetics.heroPortraits(heroes.map((h) => h.id)).catch(() => ({}));
    draw();
  }
}

function draw(): void {
  if (!open) return;
  showIconModal({ ...m, heroes, portraits, picked: pickedHeroes(), heroFilter, pictures }, {
    close: closeOverlay,
    hero: (id) => void pickHero(id),
    heroFilter: (text) => { heroFilter = text; draw(); },
    heroes: () => { m = blank(null); draw(); },
    pick: (ability, icon) => void pick(ability, icon),
    clear: () => void clear(),
    getTool: () => void getTool(),
  });
}

async function pickHero(hero: string): Promise<void> {
  const r = await window.api.icons.hero(hero);
  if (r.error || !('abilities' in r)) { toast(r.error || L`Не удалось прочитать иконки игры`, 'error'); return; }
  m = { ...blank(hero), abilities: r.abilities, picks: r.picks, vrf: r.vrf };
  draw();
  await loadPictures(hero);
}

/** The hero's pictures, a screenful at a time, drawn as they come; the ones already here are not asked again. */
async function loadPictures(hero: string): Promise<void> {
  const want = m.abilities.flatMap((a) => [a.ability, ...a.choices.map((c) => c.icon)]).filter((n) => !pictures[n]);
  for (let i = 0; i < want.length && open && m.hero === hero; i += 40) {
    const got = await window.api.icons.pictures(want.slice(i, i + 40)).catch(() => ({}));
    Object.assign(pictures, got);
    draw();
  }
}

async function pick(ability: string, icon: string | null): Promise<void> {
  const { hero } = m;
  if (!hero || m.busy) return;
  m = { ...m, busy: ability };
  draw();
  const r = await window.api.icons.set(hero, ability, icon).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(icon ? L`Иконка стоит` : L`Иконка из игры`);
  await after();
}

async function clear(): Promise<void> {
  const { hero } = m;
  if (!hero || m.busy) return;
  m = { ...m, busy: '*' };
  draw();
  const r = await window.api.icons.clear(hero).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error'); draw(); return; }
  toast(L`Убрано`);
  await after();
}

/** ValveResourceFormat, downloaded once, and the pictures read with it. */
async function getTool(): Promise<void> {
  if (m.gettingTool) return;
  m = { ...m, gettingTool: true };
  draw();
  const r = await window.api.tools.install('vrf');
  m = { ...m, gettingTool: false, vrf: !r.error };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  draw();
  if (m.hero) await loadPictures(m.hero);
}

async function after(): Promise<void> {
  await refreshInstalledIndex();
  await screen.redraw();
  if (!m.hero) return;
  const r = await window.api.icons.hero(m.hero);
  if (!r.error && 'picks' in r) m = { ...m, picks: r.picks };
  draw();
}

/** From My mods: the Workshop, with the window open on that hero. */
export async function abilityIconsFromLibrary(hero: string): Promise<void> {
  await switchView('studio');
  await openAbilityIcons(null, hero);
}
