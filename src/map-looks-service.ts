/**
 * Towers and trees from the game's own looks, per side, built in the app (issues #446, #421).
 * The window picks a look for Radiant and one for Dire; the pak comes out of the player's pak01
 * (src/tower-looks.ts, src/tree-sets.ts) and goes into My mods as one record per kind, marked
 * `generated` with what it was built from. Choosing again builds it again in its slot, and a
 * Dota update that reached it builds it again from the new files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTowers, DEFAULT_TOWER, towerLooks, type Side, type TowerLook } from './tower-looks.ts';
import { buildTrees, DEFAULT_TREES, TREE_SETS } from './tree-sets.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { sharedVpkIndex } from './vpk.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** The two kinds the window builds, each its catalog category. */
export type MapKind = 'towers' | 'trees';

/** What a generated record was built from. A side left null keeps the game's own. */
export interface MapGenerated { map: MapKind; radiant: string | null; dire: string | null }

/** One look a side can take, and the model it puts on each side, which the window draws where the game has no picture of it. */
export interface MapOption { id: string; name: string; sides: Side[]; models: Partial<Record<Side, string>> }

/** What the window shows: the looks of each kind, and the record built before, if any. */
export interface MapLooksState {
  towers: MapOption[];
  trees: MapOption[];
  installed: Record<MapKind, { id: string; radiant: string | null; dire: string | null; enabled: boolean } | null>;
  /** the model each side stands in as the game ships, for the picture of "As in the game" */
  own: Record<MapKind, Record<Side, string>>;
}

const KINDS: MapKind[] = ['towers', 'trees'];
const BOTH: Side[] = ['radiant', 'dire'];

/** The tree sets the window offers: the tinted ones come out washed white on the default map. */
export const OFFERED_TREES: MapOption[] = TREE_SETS.filter((s) => !s.tinted).map((s) => ({ id: s.id, name: s.name, sides: BOTH, models: { radiant: s.models[0], dire: s.models[0] } }));

/** The service the map:* channels call, over the game folder, the installer and the library. */
export function createMapLooks({ gamePath, installer, library, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  log?: (msg: string) => void;
}) {
  const pak01 = () => { const g = gamePath(); return g ? path.join(g, 'dota', 'pak01_dir.vpk') : null; };
  /* items_game is 50 MB: read once per pak01, and again after a Dota update rewrites the file */
  let table: { pak: string; mtime: number; text: string; towers: TowerLook[] } | null = null;
  function read(): typeof table {
    const pak = pak01();
    if (!pak) return null;
    try {
      const mtime = fs.statSync(pak).mtimeMs;
      if (table?.pak === pak && table.mtime === mtime) return table;
      const text = sharedVpkIndex(pak).read('scripts/items/items_game.txt')?.toString('latin1') ?? '';
      return table = { pak, mtime, text, towers: towerLooks(text) };
    } catch (err) {
      log(`map looks: the game could not be read: ${(err as Error).message}`);
      return null;
    }
  }

  const mine = (kind: MapKind): LibRecord | null =>
    library.list().find((r) => (r.generated as MapGenerated | undefined)?.map === kind) ?? null;

  /** The options of a kind, as the window offers them. */
  const options = (kind: MapKind): MapOption[] => (kind === 'trees' ? OFFERED_TREES : read()?.towers ?? []);

  /** The pak for `g` and the name its record goes by. */
  function build(g: MapGenerated): { vpk: Buffer; name: string } {
    const pak = pak01();
    if (!pak) throw new Error(t('Не указана папка игры'));
    // "Grasp of the Elder Gods - Radiant Towers" as "Grasp of the Elder Gods": the name says the side
    const label = (id: string | null) => (id
      ? (options(g.map).find((o) => o.id === id)?.name ?? id).replace(/\s*-?\s*(Radiant|Dire) Towers$/i, '').replace(/\s+Building Effects$/i, '')
      : t('как в игре'));
    const name = t(g.map === 'trees' ? 'Деревья: Radiant {0}, Dire {1}' : 'Башни: Radiant {0}, Dire {1}', label(g.radiant), label(g.dire));
    if (g.map === 'trees') {
      const r = buildTrees({ pak01: pak, radiant: g.radiant, dire: g.dire });
      if (r.missing.length) log(`map looks: ${r.missing.length} tree models are not in the game, first ${r.missing[0]}`);
      return { vpk: r.vpk, name };
    }
    const r = buildTowers({ pak01: pak, text: read()?.text ?? '', radiant: g.radiant, dire: g.dire });
    if (r.missing.length) log(`map looks: ${r.missing.length} tower files are not in the game, first ${r.missing[0]}`);
    return { vpk: r.vpk, name };
  }

  /** A side's pick from the window: an id of that kind for that side, or nothing. */
  function pick(kind: MapKind, side: Side, id: unknown): string | null {
    if (id === null || id === undefined || id === '') return null;
    const o = options(kind).find((x) => x.id === id && x.sides.includes(side));
    if (!o) throw new Error(t('Такого вида нет в игре'));
    return o.id;
  }

  /** A record built again from `g`, in the slot it had, off if it was off and `keepOff`. */
  function replace(rec: LibRecord, g: MapGenerated, keepOff: boolean): LibRecord {
    const { vpk, name } = build(g);
    const off = keepOff && rec.enabled === false;
    const files = swapPak(installer, rec, vpk, off);
    return library.update(rec.id, { name, files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
  }

  return {
    state(): MapLooksState {
      const installed = {} as MapLooksState['installed'];
      for (const kind of KINDS) {
        const rec = mine(kind);
        const g = rec?.generated as MapGenerated | undefined;
        installed[kind] = rec && g ? { id: rec.id, radiant: g.radiant, dire: g.dire, enabled: rec.enabled !== false } : null;
      }
      const own = { towers: DEFAULT_TOWER, trees: { radiant: DEFAULT_TREES.radiant[0], dire: DEFAULT_TREES.dire[0] } };
      return { towers: options('towers'), trees: options('trees'), installed, own };
    },

    /** Build a kind with a look per side and install it, in place of the one built before. */
    install(kind: unknown, radiant: unknown, dire: unknown): LibRecord {
      if (kind !== 'towers' && kind !== 'trees') throw new Error(t('Такого вида нет в игре'));
      const g: MapGenerated = { map: kind, radiant: pick(kind, 'radiant', radiant), dire: pick(kind, 'dire', dire) };
      if (!g.radiant && !g.dire) throw new Error(t('Выбери вид хотя бы для одной стороны'));
      const old = mine(kind);
      if (old) {
        const rec = replace(old, g, false);
        log(`map looks: ${kind} built again, Radiant ${g.radiant ?? 'as is'}, Dire ${g.dire ?? 'as is'}`);
        return rec;
      }
      const { vpk, name } = build(g);
      const files = writePak(installer, vpk);
      const rec = library.add({ name, categoryId: kind, styleLabel: null, fileRef: null, preview: null, files });
      log(`map looks: ${kind} built, Radiant ${g.radiant ?? 'as is'}, Dire ${g.dire ?? 'as is'}`);
      return library.update(rec.id, { generated: g }) as LibRecord;
    },

    /**
     * After a Dota update: the map records among `ids` built again from the new files.
     * @returns the ids built again
     */
    rebuild(ids: string[]): string[] {
      const done: string[] = [];
      for (const rec of library.list()) {
        const g = rec.generated as MapGenerated | undefined;
        if (!g?.map || !ids.includes(rec.id)) continue;
        try {
          replace(rec, g, true);
          done.push(rec.id);
        } catch (err) {
          log(`map looks: could not build again after the update: ${(err as Error).message}`);
        }
      }
      return done;
    },
  };
}
