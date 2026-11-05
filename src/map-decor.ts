/* The map without its decor: grass, flowers, ferns and critters, or stones, bones, debris and the
 * stains on the ground, gone from the map, as a record in My mods.
 *
 * The list is the map's own, read each time it is built: every material the map names, and every
 * material of each model it names, out of the map in force (a whole-map terrain's in the language
 * folder, else the game's) and its models in pak01. A hand-kept list goes stale with every patch
 * (ArdysaModsTools keeps 646 paths, 195 of them still on the map of 2026-11-04); this one is rebuilt
 * after an update, like the HUD scale.
 *
 * A material, not a model, is what goes: most of the decor is baked into the map's own meshes
 * (worldnodes/*agg_prop_flowers*), which no file in pak01 replaces, but those meshes draw with
 * pak01's materials. Each decor material is a copy of the game's dev/transparent, which draws
 * nothing and casts no shadow. tools/toolsnodraw was tried first: the game draws its "NODRAW"
 * texture. Trees, buildings, cliffs, water, the ground and everything a player plays around are
 * left alone (bench, 2026-11-04). What is left of a mesh costs nothing to speak of: on an RTX 4060
 * both groups off gave 1-2% more FPS at each spot of the map (dota:bench --fps, 2026-11-06). */
import fs from 'node:fs';
import path from 'node:path';
import { buildVpk, entryAt, openVpkIndex, sharedVpkIndexSteps, type VpkIndex } from './vpk.ts';
import { runSteps, PAUSE } from './steps.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** The two kinds of decor, each switched on its own. */
export type DecorGroup = 'plants' | 'debris';
export const DECOR_GROUPS: DecorGroup[] = ['plants', 'debris'];

/** What each group takes, by material path. */
const GROUP_PATHS: Record<DecorGroup, RegExp> = {
  plants: /^materials\/(models\/(props_nature|props_wildlife)\/|nature\/card_(grass|flowers))/,
  debris: /^materials\/(models\/(props_debris|props_bones|props_rock|props_magic)\/|overlays\/(blood|petals|leaves))/,
};

/** The material every decor material becomes: the game's own, which draws nothing. */
export const BLANK = 'materials/dev/transparent.vmat_c';
const MAP_REL = 'maps/dota.vpk';
const MATERIAL = /materials\/[\w/.-]+?\.vmat/g;
const MODEL = /models\/[\w/.-]+?\.vmdl/g;

/** What a decor record was built from. */
export interface DecorGenerated { decor: DecorGroup[] }

/** Each group's materials on `map`, in pak01, sorted. A pause after each stretch of files. */
export function* decorMaterialsSteps(map: VpkIndex, pak: VpkIndex): Generator<typeof PAUSE, Record<DecorGroup, string[]>> {
  const mats = new Set<string>();
  const models = new Set<string>();
  let n = 0;
  for (const p of map.paths()) {
    const text = map.read(p)?.toString('latin1') ?? '';
    for (const m of text.matchAll(MATERIAL)) mats.add(m[0].toLowerCase());
    for (const m of text.matchAll(MODEL)) models.add(m[0].toLowerCase());
    if (++n % 200 === 0) yield PAUSE;
  }
  for (const m of models) {
    for (const x of pak.read(`${m}_c`)?.toString('latin1').matchAll(MATERIAL) ?? []) mats.add(x[0].toLowerCase());
    if (++n % 200 === 0) yield PAUSE;
  }
  const out = { plants: [], debris: [] } as Record<DecorGroup, string[]>;
  for (const m of [...mats].sort()) {
    const g = DECOR_GROUPS.find((k) => GROUP_PATHS[k].test(m));
    if (g && pak.has(`${m}_c`)) out[g].push(m);
  }
  return out;
}

/** The pak: each material of the groups asked for, as the blank one. */
export function decorPak(pak: VpkIndex, mats: Record<DecorGroup, string[]>, groups: DecorGroup[]): Buffer {
  const blank = pak.read(BLANK);
  if (!blank) throw new Error(t('В игре нет файла {0}', BLANK));
  return buildVpk(groups.flatMap((g) => mats[g]).map((m) => entryAt(`${m}_c`, blank)));
}

/** The groups the window sent that are groups, each once, in their order. */
export function clampGroups(raw: unknown): DecorGroup[] {
  return Array.isArray(raw) ? DECOR_GROUPS.filter((g) => raw.includes(g)) : [];
}

/** What the window shows: the groups on now, and how many materials each takes on this map. */
export interface DecorState {
  installed: { id: string; groups: DecorGroup[]; enabled: boolean } | null;
  counts: Record<DecorGroup, number> | null;
}

/** The service the decor:* channels call. */
export function createMapDecor({ gamePath, installer, library, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  onRebuilt?: (id: string) => void;
  log?: (msg: string) => void;
}) {
  const mine = (): LibRecord | null => library.list().find((r) => Array.isArray((r.generated as DecorGenerated | undefined)?.decor)) ?? null;
  let counted: { key: string; counts: Record<DecorGroup, number> } | null = null;

  /** The map in force: a whole-map terrain's, else the game's. */
  function mapFile(game: string): string {
    const own = path.join(installer.langFolder(), MAP_REL);
    return fs.existsSync(own) ? own : path.join(game, 'dota', MAP_REL);
  }

  function* scanSteps(): Generator<typeof PAUSE, { pak: VpkIndex; mats: Record<DecorGroup, string[]> }> {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    const map = mapFile(game);
    if (!fs.existsSync(map)) throw new Error(t('В игре нет файла {0}', MAP_REL));
    const pak = yield* sharedVpkIndexSteps(path.join(game, 'dota', 'pak01_dir.vpk'));
    yield PAUSE;
    const mats = yield* decorMaterialsSteps(openVpkIndex(map), pak);
    const st = fs.statSync(map);
    counted = { key: `${map}|${st.size}|${st.mtimeMs}`, counts: { plants: mats.plants.length, debris: mats.debris.length } };
    return { pak, mats };
  }

  async function put(groups: DecorGroup[], keepOff: boolean): Promise<LibRecord> {
    const { pak, mats } = await runSteps(scanSteps());
    const vpk = decorPak(pak, mats, groups);
    const g: DecorGenerated = { decor: groups };
    const name = t('Карта без декора');
    const old = mine();
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name, files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name, categoryId: 'optimization', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  return {
    /** The record on now, and the counts of the last scan of the map that is there now. */
    async state(): Promise<DecorState> {
      const rec = mine();
      const g = rec?.generated as DecorGenerated | undefined;
      const game = gamePath();
      let counts: Record<DecorGroup, number> | null = null;
      if (game) {
        const map = mapFile(game);
        const st = fs.existsSync(map) ? fs.statSync(map) : null;
        if (st && counted?.key !== `${map}|${st.size}|${st.mtimeMs}`) await runSteps(scanSteps());
        counts = counted?.counts ?? null;
      }
      return { installed: rec && g ? { id: rec.id, groups: g.decor, enabled: rec.enabled !== false } : null, counts };
    },

    /** The groups asked for taken off the map, put in My mods in place of the record before. */
    async install(raw: unknown): Promise<LibRecord> {
      const groups = clampGroups(raw);
      if (!groups.length) throw new Error(t('Выбери, что убрать с карты'));
      const rec = await put(groups, false);
      log(`map decor: ${groups.join(', ')} off the map`);
      return rec;
    },

    /** After a Dota update: the record among `ids` built again from the new map, after this returns. */
    rebuild(ids: string[]): string[] {
      const rec = mine();
      const g = rec?.generated as DecorGenerated | undefined;
      if (!rec || !g || !ids.includes(rec.id)) return [];
      setTimeout(() => {
        put(g.decor, true).then(() => onRebuilt(rec.id), (err) => log(`map decor: could not build again after the update: ${(err as Error).message}`));
      }, 0);
      return [];
    },
  };
}
