/**
 * The arcana window's side in the main process (issue #118): what the window shows, and the mod it
 * builds out of the player's own game files, installed like any other.
 *
 * Two builds: the whole arcana for a player who has not got it (src/arcana.ts), and only its
 * colour for one who has (src/recolor.ts), whose arcana brings its gem. Either is one record in
 * My mods, marked `generated` with what it was built from, so choosing again rebuilds it in its
 * place, and a Dota update that changes the files it was built from rebuilds it with the same
 * colour instead of leaving it behind the game.
 *
 * Its pak goes in the early part of the load order, with the hero items (src/slot-zones.ts):
 * an arcana from the catalog is a hero mod, so it loads later and this wins over it, which is
 * what a colour chosen on purpose should do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildArcana } from './arcana.ts';
import { buildRecolor, RECOLOR_SETS, type Rgb } from './recolor.ts';
import { openVpkIndex } from './vpk.ts';
import { pngFromVtex } from './vtex.ts';
import { t } from './i18n.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';

/** The whole arcana, or only its colour over one the player has. */
export type ArcanaMode = 'mod' | 'recolor';

/** What a generated record was built from, kept on it to build it again. */
export interface Generated { set: string; color: Rgb; mode: ArcanaMode }

/** What the window shows. */
export interface ArcanaState {
  /** the game has the files to build from */
  available: boolean;
  /** the arcana's own picture out of the game, as a data URL */
  picture: string | null;
  installed: { id: string; color: Rgb; mode: ArcanaMode; enabled: boolean } | null;
}

const SET = 'terrorblade-arcana';
const PICTURE = 'panorama/images/econ/heroes/terrorblade/arcana_terrorblade_png.vtex_c';
const MODEL = 'models/heroes/terrorblade/terrorblade_arcana.vmdl_c';
/** Where the record sits in My mods and in the load order. */
const CATEGORY = 'hero-items';

/** "#ff3c28" for a colour. */
export const hex = (c: Rgb) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** A colour from the window: three whole numbers 0-255, or nothing. */
export function validColor(c: unknown): Rgb | null {
  return Array.isArray(c) && c.length === 3 && c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? c as Rgb : null;
}

export function createArcanaService({ gamePath, installer, library, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: Pick<Installer, 'langFolder' | 'ensureLangFolder' | 'usedPakNames' | 'allocatePak' | 'writeInto' | 'remove' | 'slotBase' | 'moveToSlot' | 'setEnabled'>;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  log?: (msg: string) => void;
}) {
  const pak01 = () => { const g = gamePath(); return g ? path.join(g, 'dota', 'pak01_dir.vpk') : null; };
  /* What the game has, read once per pak01: its index is 384 000 entries and the tools screen
   * asks every time it opens. A Dota update rewrites the file, and that is read again. */
  let probe: { pak: string; mtime: number; available: boolean; picture: string | null } | null = null;

  const mine = (): LibRecord | null => library.list().find((r) => (r.generated as Generated | undefined)?.set === SET) ?? null;

  function build(params: Generated): Buffer {
    const pak = pak01();
    if (!pak) throw new Error(t('Не указана папка игры'));
    const args = { pak01: pak, set: params.set, target: params.color };
    return params.mode === 'mod' ? buildArcana(args).vpk : buildRecolor(args).vpk;
  }

  /** The built pak written into a slot in the early part of the load order; the files it took. */
  function write(vpk: Buffer): LibFile[] {
    installer.ensureLangFolder();
    const pakName = installer.allocatePak(installer.usedPakNames(), true);
    installer.writeInto(vpk, path.join(installer.langFolder(), pakName));
    return [{ root: 'lang', relPath: pakName }];
  }

  /**
   * A record built again from `params`, in the slot it had: the new pak goes in beside, then takes
   * the old one's place. Switched on, unless `keepOff` and it was off (a rebuild nobody asked for).
   */
  function replace(rec: LibRecord, params: Generated, keepOff = false): LibRecord {
    const vpk = build(params); // before anything on disk is touched: a build that fails leaves the old one
    const oldBase = installer.slotBase(rec);
    const off = keepOff && rec.enabled === false;
    let files = write(vpk);
    installer.remove(rec.files, { recId: rec.id });
    const newBase = installer.slotBase({ files });
    if (oldBase && newBase && newBase !== oldBase) files = installer.moveToSlot({ files }, oldBase, newBase);
    if (off) installer.setEnabled(files, false, rec.id);
    return library.update(rec.id, { files, styleLabel: hex(params.color), generated: params, enabled: !off, updatedAt: Date.now() }) as LibRecord;
  }

  return {
    state(): ArcanaState {
      const pak = pak01();
      let seen: typeof probe = null;
      if (pak) {
        try {
          const mtime = fs.statSync(pak).mtimeMs;
          if (probe?.pak === pak && probe.mtime === mtime) seen = probe;
          else {
            const index = openVpkIndex(pak);
            const png = pngFromVtex(index.read(PICTURE));
            seen = probe = { pak, mtime, available: Boolean(index.read(MODEL)), picture: png ? `data:image/png;base64,${png.toString('base64')}` : null };
          }
        } catch (err) {
          log(`arcana: the game could not be read: ${(err as Error).message}`);
        }
      }
      const rec = mine();
      const g = rec?.generated as Generated | undefined;
      return {
        available: Boolean(seen?.available),
        picture: seen?.available ? seen.picture : null,
        installed: rec && g ? { id: rec.id, color: g.color, mode: g.mode, enabled: rec.enabled !== false } : null,
      };
    },

    /** Build the arcana (or its colour) and install it, in place of the one built before. */
    install(color: unknown, mode: unknown): LibRecord {
      const c = validColor(color);
      if (!c) throw new Error(t('Не тот цвет'));
      const params: Generated = { set: SET, color: c, mode: mode === 'recolor' ? 'recolor' : 'mod' };
      const old = mine();
      if (old) {
        const rec = replace(old, params);
        log(`arcana: built again in ${hex(c)} (${params.mode})`);
        return rec;
      }
      const files = write(build(params));
      const rec = library.add({ name: RECOLOR_SETS[SET].name, categoryId: CATEGORY, styleLabel: hex(c), fileRef: null, preview: null, files });
      log(`arcana: built in ${hex(c)} (${params.mode})`);
      return library.update(rec.id, { generated: params }) as LibRecord;
    },

    /**
     * After a Dota update: the generated records among `ids` (the mods it reached) built again from
     * the new files, with the colour each had.
     * @returns the ids built again
     */
    rebuild(ids: string[]): string[] {
      const done: string[] = [];
      for (const rec of library.list()) {
        const g = rec.generated as Generated | undefined;
        if (!g || !ids.includes(rec.id)) continue;
        try {
          replace(rec, g, true);
          done.push(rec.id);
          log(`arcana: built again after the update: ${rec.name} ${hex(g.color)}`);
        } catch (err) {
          log(`arcana: could not build again after the update: ${(err as Error).message}`);
        }
      }
      return done;
    },
  };
}
