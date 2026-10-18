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
import { ARCANA_SETS, arcanaForms, arcanaPictures, arcanaSwaps, buildArcana } from './arcana.ts';
import { buildRecolor, RECOLOR_SETS, type Rgb } from './recolor.ts';
import { TERRORBLADE_BASE } from './arcana-bases.ts';
import { baseInColor, WINDOW_SET } from './arcana-base-color.ts';
import type { BaseStore } from './arcana-base-store.ts';
import { buildVpk, entryAt, entryPath, listVpkPathsFile, sharedVpkIndex } from './vpk.ts';
import { pngFromVtex } from './vtex.ts';
import { t } from './i18n.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';

/** The whole arcana, or only its colour over one the player has. */
export type ArcanaMode = 'mod' | 'recolor';

/**
 * What a generated record was built from, kept on it to build it again. `under`: the paths, as
 * the pak lists them, it leaves to the item builder's picks; `forms`: the picks whose form's
 * particle it carries (src/arcana.ts arcanaForms); `code`: the app's code it was built by. A
 * change to any of them builds it again (giveWay).
 */
export interface Generated { set: string; color: Rgb; mode: ArcanaMode; under?: string[]; forms?: string[]; code?: string }

/** What the window shows. */
export interface ArcanaState {
  /** the game has the files to build from */
  available: boolean;
  /** the arcana's own picture out of the game, as a data URL */
  picture: string | null;
  installed: { id: string; color: Rgb; mode: ArcanaMode; enabled: boolean } | null;
}

const SET = WINDOW_SET;
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

export function createArcanaService({ gamePath, installer, library, log = () => {}, bases, code = () => null }: {
  gamePath: () => string | null | undefined;
  installer: Pick<Installer, 'langFolder' | 'langFileOnDisk' | 'ensureLangFolder' | 'usedPakNames' | 'allocatePak' | 'writeInto' | 'remove' | 'slotBase' | 'moveToSlot' | 'setEnabled'>;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  log?: (msg: string) => void;
  /** the arcana bases kept on disk (src/arcana-base-store.ts): the whole arcana is built from
   *  Terrorblade's when it is here, and from Valve's files until it is */
  bases?: Pick<BaseStore, 'entries' | 'want'>;
  /** the stamp of the app's code (src/schema-service.ts builderStamp): a record built by other code
   *  is built again, so a fix reaches an arcana installed before it */
  code?: () => string | null;
}) {
  const pak01 = () => { const g = gamePath(); return g ? path.join(g, 'dota', 'pak01_dir.vpk') : null; };
  /* What the game has, read once per pak01: its index is 384 000 entries and the tools screen
   * asks every time it opens. A Dota update rewrites the file, and that is read again. */
  let probe: { pak: string; mtime: number; available: boolean; picture: string | null } | null = null;

  /* The builder's enabled picks whose form has a particle for the arcana to carry. */
  const formsPicked = (set: string): string[] => {
    const items = new Set((ARCANA_SETS[set]?.forms || []).map((f) => f.item));
    return [...new Set(library.list().filter((r) => r.enabled !== false && r.categoryId === 'cosmetic' && items.has(String(r.itemId))).map((r) => String(r.itemId)))].sort();
  };
  const mine = (): LibRecord | null => library.list().find((r) => (r.generated as Generated | undefined)?.set === SET) ?? null;

  function build(params: Generated): Buffer {
    const pak = pak01();
    if (!pak) throw new Error(t('Не указана папка игры'));
    const under = new Set(params.under);
    const args = { pak01: pak, set: params.set, target: params.color, skip: (p: string) => under.has(p) };
    if (params.mode !== 'mod') return buildRecolor(args).vpk;
    const forms = params.forms || [];
    const base = bases?.entries(TERRORBLADE_BASE);
    void bases?.want(TERRORBLADE_BASE);
    if (!base) return buildArcana({ ...args, forms }).vpk;
    // the base under the plain paths in the chosen colour, the arcana's pictures and swaps from the game
    const colored = baseInColor(base, params.color, RECOLOR_SETS[params.set].gem);
    if (colored.failed.length) log(`arcana: ${colored.failed.length} files of the base kept their own colour, first ${colored.failed[0]}`);
    const files = new Map(colored.entries.map((e) => [entryPath(e), e.data]));
    for (const [p, data] of [...arcanaPictures(pak, params.set), ...arcanaSwaps(pak, params.set, params.color)]) if (!files.has(p)) files.set(p, data);
    arcanaForms(pak, params.set, params.color, forms, files, log);
    return buildVpk([...files].filter(([p]) => !under.has(p.toLowerCase())).map(([p, data]) => entryAt(p, data)));
  }

  /** What a record was built from, with the code that built it. */
  const stamped = (params: Generated): Generated => {
    const c = code();
    return c ? { ...params, code: c } : params;
  };

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
    return library.update(rec.id, { files, styleLabel: hex(params.color), generated: stamped(params), enabled: !off, updatedAt: Date.now() }) as LibRecord;
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
            const index = sharedVpkIndex(pak);
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
      const old = mine();
      // what it left to the builder's picks stays left to them: the picks are the same
      const under = (old?.generated as Generated | undefined)?.under;
      const forms = formsPicked(SET);
      const params: Generated = { set: SET, color: c, mode: mode === 'recolor' ? 'recolor' : 'mod', ...(under ? { under } : {}), ...(forms.length ? { forms } : {}) };
      if (old) {
        const rec = replace(old, params);
        log(`arcana: built again in ${hex(c)} (${params.mode})`);
        return rec;
      }
      const files = write(build(params));
      const rec = library.add({ name: RECOLOR_SETS[SET].name, categoryId: CATEGORY, styleLabel: hex(c), fileRef: null, preview: null, files });
      log(`arcana: built in ${hex(c)} (${params.mode})`);
      return library.update(rec.id, { generated: stamped(params) }) as LibRecord;
    },

    /**
     * The arcana in step with the item builder, after each build of its table. Its pak loads ahead
     * of the builder's folder, so where both write a path it won over the pick, and Rictus Ripper's
     * head and demon came out as the arcana's. Every other pick wins over an arcana base
     * (src/arcana-bases.ts), and so over this one: built again without the paths `filled`
     * (lowercased, what the builder's table carries) shares with it, and with those it gave up
     * before that the table no longer fills. Built again too when the picks whose form it dresses
     * change, or the app's code that built it did.
     * @returns whether it was built again
     */
    giveWay(filled: Set<string>): boolean {
      const rec = mine();
      const g = rec?.generated as Generated | undefined;
      const pakFile = rec?.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
      if (!rec || !g || !pakFile) return false;
      let own: string[];
      try { own = listVpkPathsFile(installer.langFileOnDisk(pakFile.relPath)); } catch { return false; }
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);
      const was = g.under || [];
      const under = [...new Set([...own.map((p) => p.toLowerCase()), ...was])].filter((p) => filled.has(p)).sort();
      const forms = formsPicked(g.set);
      const c = code();
      if (same(under, was) && same(forms, g.forms || []) && (!c || c === g.code)) return false;
      try {
        replace(rec, { ...g, under: under.length ? under : undefined, forms: forms.length ? forms : undefined }, true);
        log(`arcana: built again around the item builder's picks, ${under.length} paths left to them, ${forms.length} forms carried`);
        return true;
      } catch (err) {
        log(`arcana: could not give way to the item builder: ${(err as Error).message}`);
        return false;
      }
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
