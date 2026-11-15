/* The two windows over the 3D map, each a record of its own in My mods. "Своя карта" makes the map
 * (crates/mm-core/src/looks/map_make.rs): its card is first among the terrains. "Оптимизация" takes
 * things off the map that is on (crates/mm-core/src/looks/map_decor.rs): its card is first in its own
 * section. Both are built in Rust; this file only keeps what is picked and puts it on. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { toast } from '../../ui/toast.ts';
import { showDecorModal } from '../../catalog/modal/root.tsx';
import type { DecorCardModel } from '../../catalog/decor/DecorCard.tsx';
import type { DecorModalModel, Sides } from '../../catalog/decor/DecorModal.tsx';
import type { DecorGroup, MapKind } from '../../api/content.ts';
import { LOOK_GROUPS, fromRecord, groupsOf, withStep } from '../../catalog/decor/levels.ts';
import { catalogData } from '../../catalog/data.ts';
import type { Mod } from '../../catalog/types.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
let m: DecorModalModel = { kind: 'optimize', groups: groupsOf('medium'), installed: null, counts: null, samples: null, looks: null, installedDark: [], installedAny: false,
  groundFacets: null, installedGroundFacets: null, terrains: [], catalogTerrains: [], terrainLook: null, terrain: null, installedTerrain: null, weathers: [], weather: null, installedWeather: null,
  catalogTrees: [], modTree: null, installedModTree: null, modTreeModels: null, modTreeNote: null, weatherLight: null, mapName: null, busy: false };

/** The catalog's mods of a category with a file of their own, grouped or not. */
function catalogMods(category: 'trees' | 'terrains'): (Mod & { file: string })[] {
  const d = catalogData()?.mods?.modsData?.[category];
  const mods = Array.isArray(d) ? d : (d?.groups ?? []).flatMap((g) => g.mods ?? []);
  return mods.filter((x): x is Mod & { file: string } => !!x.file);
}

/** A catalog terrain picked: what it is read (downloaded first, as an install would), for the 3D map. */
async function pickTerrain(id: string | null): Promise<void> {
  m = { ...m, terrain: id, terrainLook: null };
  draw();
  const file = id?.startsWith('catalog:') ? id.slice('catalog:'.length) : null;
  if (!file) return;
  const r = await window.api.decor.paint(file).catch((e: unknown) => ({ error: String((e as Error)?.message || e) }));
  if (m.terrain !== id) return;
  if (r && 'error' in r) { toast(r.error, 'error', 8000); return; }
  m = { ...m, terrainLook: r && 'kind' in r ? r : null };
  draw();
}

const records = () => [...store.installedIndex.values()];
const on = (r: { enabled?: boolean }) => r.enabled !== false;

/** The catalog Trees mod on now, its library record. */
const modTreeRecord = () => records().find((r) => r.categoryId === 'trees' && on(r) && !!r.fileRef);

/** A catalog terrain put on from the catalog itself, not by the map's window. */
const catalogTerrainRecord = () => records().find((r) => r.categoryId === 'terrains' && on(r) && !!r.fileRef && !r.generated);

/** A catalog Trees mod picked: its tree models read (the mod downloaded first, as an install would). */
async function pickModTree(file: string | null): Promise<void> {
  m = { ...m, modTree: file, modTreeModels: null, modTreeNote: file ? L`Скачиваю мод и достаю из него деревья…` : null };
  draw();
  if (!file) return;
  const r = await window.api.decor.modTrees(file).catch((e: unknown) => ({ error: String((e as Error)?.message || e) }));
  if (m.modTree !== file) return;
  m = { ...m, modTreeModels: r && 'models' in r ? r.models ?? [] : [], modTreeNote: r?.error ?? (r ? null : L`Не удалось прочитать мод`) };
  draw();
}

/** The free cosmetics' terrain and weather picks: the map built now does what they did, so they go off. */
const slotPicks = () => records().filter((x) => ['terrain', 'weather'].includes(String((x as { slot?: string }).slot)) && on(x));
// the window is as wide as the hero builder's, a class of its own on the overlay's panel
const panel = () => document.getElementById('modalContent');
sharesOverlay(() => { open = false; panel()?.classList.remove('opt-modal'); });

const generated = (key: 'decor' | 'map') => records().some((r) => Array.isArray((r.generated as Record<string, unknown> | undefined)?.[key]));

/** The card first in Optimization, and the map's first among the terrains. */
export function decorLead(category: string): DecorCardModel | null {
  if (category === 'optimization') return { kind: 'optimize', installed: generated('decor') };
  if (category === 'terrains') return { kind: 'map', installed: generated('map') };
  return null;
}

const NONE: Sides = { radiant: null, dire: null };

/** The game's own tree sets, and the ones on now; none when the game's table cannot be read. */
async function looks(): Promise<DecorModalModel['looks']> {
  const r = await window.api.map.state().catch(() => null);
  if (!r || r.error || !('trees' in r)) return null;
  const was = (k: MapKind): Sides => (r.installed[k] ? { radiant: r.installed[k]!.radiant, dire: r.installed[k]!.dire } : NONE);
  const installedLooks = { trees: was('trees'), towers: was('towers') };
  return { options: { trees: r.trees, towers: r.towers }, chosen: installedLooks, installed: installedLooks };
}

/** A name of the record's (base:game:winter, weather:snow), after its key. */
const named = (names: string[], k: string) => names.find((g) => g.startsWith(`${k}:`))?.slice(k.length + 1) ?? null;
const darkOf = (names: string[]) => LOOK_GROUPS.filter((g) => names.includes(g));

/** One of the two windows, on what is on now. */
export async function openDecor(from: Element | null, kind: 'map' | 'optimize' = 'optimize'): Promise<void> {
  const [r, l] = await Promise.all([window.api.decor.state(), kind === 'map' ? looks() : Promise.resolve(null)]);
  if (r.error || !('counts' in r)) { toast(r.error || L`Не удалось прочитать карту`, 'error'); return; }
  const terrains = catalogMods('terrains').map((x) => ({ name: x.name, file: x.file, preview: x.preview }));
  const mapNames = r.map?.names ?? [];
  const mapOn = !!r.map && r.map.enabled;
  // the map in force: the map record's base, else a catalog terrain put on from the catalog
  const loose = catalogTerrainRecord();
  const base = kind === 'map' ? named(mapNames, 'base') : (mapOn ? named(mapNames, 'base') : (loose?.fileRef ? `catalog:${loose.fileRef}` : null));
  const weather = kind === 'map' || mapOn ? named(mapNames, 'weather') : null;
  const facets = named(mapNames, 'facets') as 'small' | 'large' | null;
  const optWas = r.installed ? fromRecord(r.installed.groups).filter((g) => !LOOK_GROUPS.includes(g)) : null;
  const mapGroups: DecorGroup[] = darkOf(mapNames);
  const baseName = base?.startsWith('catalog:') ? terrains.find((t) => `catalog:${t.file}` === base)?.name ?? null : null;
  m = { kind, groups: kind === 'map' ? mapGroups : optWas ?? groupsOf('medium'), installed: kind === 'map' ? (r.map ? mapGroups : null) : optWas,
    counts: r.counts, samples: r.samples ?? null, looks: l, installedDark: mapOn ? mapGroups : [], installedAny: !!r.map,
    groundFacets: facets, installedGroundFacets: facets, terrains: r.terrains ?? [], catalogTerrains: terrains, terrainLook: null,
    terrain: base, installedTerrain: base, weathers: r.weathers ?? [], weather, installedWeather: weather,
    catalogTrees: kind === 'map' ? catalogMods('trees').map((x) => ({ name: x.name, file: x.file, preview: x.preview })) : [],
    modTree: modTreeRecord()?.fileRef ?? null, installedModTree: modTreeRecord()?.fileRef ?? null, modTreeModels: null, modTreeNote: null,
    weatherLight: r.weatherLight ?? null, mapName: baseName ?? (mapOn ? L`своя карта` : null), busy: false };
  takeOverlay();
  open = true;
  openOverlay(draw, from);
  if (kind === 'map' && m.modTree) void pickModTree(m.modTree);
  if (m.terrain) void pickTerrain(m.terrain);
}

function draw(): void {
  if (!open) return;
  panel()?.classList.add('opt-modal');
  showDecorModal(m, {
    close: closeOverlay,
    step: (id, n) => { m = { ...m, groups: withStep(m.groups, id, n) }; draw(); },
    level: (id) => { m = { ...m, groups: groupsOf(id) }; draw(); },
    look: (kind, side, id) => {
      if (!m.looks) return;
      m = { ...m, looks: { ...m.looks, chosen: { ...m.looks.chosen, [kind]: { ...m.looks.chosen[kind], [side]: id } } } };
      draw();
    },
    groundFacets: (f) => { m = { ...m, groundFacets: f }; draw(); },
    terrain: (id) => void pickTerrain(id),
    weather: (id) => { m = { ...m, weather: id }; draw(); },
    modTree: (file) => void pickModTree(file),
    install: () => void install(),
  });
}

const sameSides = (a: Sides, b: Sides) => a.radiant === b.radiant && a.dire === b.dire;
const fail = (err: unknown) => ({ error: String((err as Error)?.message || err) });
const sameGroups = () => m.installed !== null && m.installed.length === m.groups.length && m.groups.every((g) => m.installed?.includes(g));

/** The map's own: its file and pak, then each tree set that changed, each a mod of its own. */
async function installMap(): Promise<string | null> {
  const changed = !sameGroups() || m.groundFacets !== m.installedGroundFacets || m.terrain !== m.installedTerrain || m.weather !== m.installedWeather;
  const names = [...m.groups, ...(m.terrain ? [`base:${m.terrain}`] : []), ...(m.weather ? [`weather:${m.weather}`] : [])];
  if (changed && (names.length || m.groundFacets)) {
    const r = await window.api.decor.install(names, '', m.groundFacets ?? '', 'map').catch(fail);
    if (r.error) return r.error;
    m = { ...m, installed: m.groups, installedAny: true, installedGroundFacets: m.groundFacets, installedTerrain: m.terrain, installedWeather: m.weather };
    for (const p of slotPicks()) await window.api.mods.setEnabled(p.id, false).catch(fail);
  }
  // a catalog Trees mod: put on as from the catalog, the one it replaces switched off
  if (m.modTree !== m.installedModTree) {
    const was = modTreeRecord();
    const mod = catalogMods('trees').find((x) => x.file === m.modTree);
    if (mod) {
      const r = await window.api.mods.install({ categoryId: 'trees', name: mod.name, styleLabel: null, fileRef: mod.file, preview: mod.preview }).catch(fail);
      if (r.error && !('already' in r && r.already)) return r.error;
    }
    if (was && was.fileRef !== m.modTree) await window.api.mods.setEnabled(was.id, false).catch(fail);
    m = { ...m, installedModTree: m.modTree };
  }
  const l = m.looks;
  if (l && !sameSides(l.chosen.trees, l.installed.trees)) {
    const r = await window.api.map.install('trees', l.chosen.trees.radiant, l.chosen.trees.dire).catch(fail);
    if (r.error) return r.error;
    m = { ...m, looks: { ...l, installed: { ...l.installed, trees: l.chosen.trees } } };
  }
  return null;
}

async function install(): Promise<void> {
  if (m.busy) return;
  m = { ...m, busy: true };
  draw();
  let error: string | null = null;
  if (m.kind === 'map') error = await installMap();
  else if (m.groups.length && !sameGroups()) {
    const r = await window.api.decor.install(m.groups, '', '').catch(fail);
    if (r.error) error = r.error;
    else m = { ...m, installed: m.groups };
  }
  m = { ...m, busy: false };
  if (error) { toast(error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}
