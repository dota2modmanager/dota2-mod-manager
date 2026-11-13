/* The rank medal and hero levels of the player's own screen, as one record in My mods (what goes
 * into it is src/rank-look.ts). The two styles' CSS is read out of the copy in force (a mod's when
 * one carries them, else the game's), the medal's rules go at its end, and the styles and the
 * levels script are written here (src/panorama-files.ts), without Valve's compiler; the layouts get
 * the script's include. The pak goes early in the load order, so it wins over the mod it was made from.
 *
 * A Dota update that reached the record builds it again from the new files, after the update's
 * repair has answered, and the record's mark from src/update-impact.ts is lifted when it is done.
 * The window's pictures (the medals, the badge tiers) come out of the game too: the badges are
 * PNGs in their textures, the medals are compressed and need ValveResourceFormat. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clampLook, LAYOUTS, lookIsEmpty, SCRIPT, STYLES, takesScript, withMedal, withScript, type RankLook } from './rank-look.ts';
import { levelsScript } from './rank-look-script.ts';
import { fileInForce, swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { imagesOf, readStyle, writeScript, writeStyle } from './panorama-files.ts';
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';
import { pngFromVtex } from './vtex.ts';
import { runTool } from './toolchain.ts';
import { heroDisplayName } from './hero-names.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import type { VpkEntry } from './vpk.ts';

/** What a rank record was built from, and the script it carries (SCRIPT_MARK when it was built). */
export interface RankGenerated { rank: RankLook; script?: string }

/**
 * The script and the layouts it goes into, as a short mark. A record built by an older app keeps
 * that app's script in its pak, so a new part of it (the level in a match) stays out of the game
 * until the record is built again; the app does that at start when the marks differ.
 */
// the function's source has the line endings of the checkout it was built from: CRLF on Windows
export const SCRIPT_MARK = createHash('sha1').update(levelsScript.toString().replace(/\r\n/g, '\n') + JSON.stringify(LAYOUTS)).digest('hex').slice(0, 12);

/** What the window shows: the look on now, if any, the heroes of this patch, and whether ValveResourceFormat is there. */
export interface RankState {
  installed: { id: string; look: RankLook; enabled: boolean } | null;
  heroes: { id: string; name: string }[];
  vrf: boolean;
}

/** The game's script the levels script takes the shape of; any other does where it is gone. */
const SCRIPT_TEMPLATE = 'panorama/scripts/popups/popup_settings.vjs_c';

/** The medals the window offers, by the name of their picture, and the six badge tiers. */
export const MEDAL_PICTURES = [...Array.from({ length: 9 }, (_, i) => `rank${i}`), 'rank8a', 'rank8b', 'rank8c'];

/** The service the rank:* channels call. */
export function createRankLook({ gamePath, installer, library, vrf, run = runTool, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** ValveResourceFormat's CLI, when it is downloaded: the medals' pictures in the window */
  vrf: () => string | null;
  /** how ValveResourceFormat is run for the pictures; tests hand one in */
  run?: (exe: string, args: string[]) => Promise<unknown>;
  /** a record built again after an update, so its mark can go */
  onRebuilt?: (id: string) => void;
  log?: (msg: string) => void;
}) {
  const mine = (): LibRecord | null => library.list().find((r) => typeof (r.generated as RankGenerated | undefined)?.rank === 'object') ?? null;
  const game = (): string => {
    const g = gamePath();
    if (!g) throw new Error(t('Не указана папка игры'));
    return g;
  };
  const pak01 = () => sharedVpkIndex(path.join(game(), 'dota', 'pak01_dir.vpk'));
  const inForce = (file: string, usable?: (data: Buffer) => boolean): Buffer => {
    const got = fileInForce({
      game: game(), langFolder: installer.langFolder(), records: library.list(), own: mine()?.id, file, usable,
      passedOver: (rec) => log(`rank look: ${rec.name} carries ${file} in a form the script cannot go into, using the next copy`),
    });
    if (!got) throw new Error(t('В игре нет файла {0}', file));
    return got.data;
  };

  /** The number the game gives each of these heroes, out of its hero script; a hero it lacks is left out. */
  const heroIds = (heroes: string[]): Record<number, string> => {
    const ids: Record<number, string> = {};
    for (const hero of heroes) {
      try {
        const id = /"HeroID"\s+"(\d+)"/.exec(pak01().read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`)?.toString('utf8') ?? '')?.[1];
        if (id) ids[Number(id)] = hero;
      } catch { /* not in this game: the name is enough where the game gives one */ }
    }
    return ids;
  };

  /** One of the game's scripts, as the shape the levels script is written into (writeScript). */
  const scriptTemplate = (): Buffer => {
    const ix = pak01();
    const own = ix.read(SCRIPT_TEMPLATE);
    if (own) return own;
    for (const p of ix.paths()) if (p.endsWith('.vjs_c')) return ix.read(p)!;
    throw new Error(t('В игре нет файла {0}', SCRIPT_TEMPLATE));
  };
  const readable = (data: Buffer) => { try { readStyle(data); return true; } catch { return false; } };

  async function build(look: RankLook): Promise<Buffer> {
    const entries: VpkEntry[] = [];
    if (look.medal) {
      const styles = STYLES.map((s) => ({ s, data: inForce(s.compiled, readable) }));
      // a picture one style lacks is in the other, or in the game's own copy of it
      const known = imagesOf([...styles.map((x) => x.data), ...STYLES.map((s) => pak01().read(s.compiled)).filter((b): b is Buffer => !!b)]);
      for (const { s, data } of styles) {
        entries.push(entryAt(s.compiled, writeStyle(data, withMedal(readStyle(data).css, look.medal), known, (p) => pak01().read(p))));
      }
    }
    entries.push(entryAt(SCRIPT.compiled, writeScript(scriptTemplate(), levelsScript(look, heroIds(Object.keys(look.levels))))));
    return buildVpk([...entries, ...LAYOUTS.map((p) => entryAt(p, withScript(inForce(p, takesScript))))]);
  }

  /** The record built from `look`: in the old one's slot, or a new record. */
  async function put(look: RankLook, keepOff: boolean): Promise<LibRecord> {
    const vpk = await build(look);
    const g: RankGenerated = { rank: look, script: SCRIPT_MARK };
    const name = t('Ранг и уровни героев');
    const old = mine();
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name, files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name, categoryId: 'ranks', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  let heroCache: { key: string; list: RankState['heroes'] } | null = null;
  let pictureCache: { key: string; medals: Record<string, string>; badges: string[] } | null = null;

  return {
    state(): RankState {
      const rec = mine();
      const g = rec?.generated as RankGenerated | undefined;
      let heroes: RankState['heroes'] = [];
      try {
        const key = game();
        if (heroCache?.key !== key) {
          const ids = [...pak01().paths()].map((p) => /^scripts\/npc\/heroes\/npc_dota_hero_([a-z0-9_]+)\.txt$/.exec(p)?.[1]).filter((id): id is string => !!id && id !== 'base');
          heroCache = { key, list: ids.map((id) => ({ id, name: heroDisplayName(id) })).sort((a, b) => a.name.localeCompare(b.name)) };
        }
        heroes = heroCache.list;
      } catch { /* no game yet: no heroes to list */ }
      return { installed: rec && g ? { id: rec.id, look: g.rank, enabled: rec.enabled !== false } : null, heroes, vrf: !!vrf() };
    },

    /** The medals and the six badge tiers as data URIs, out of the game; a medal is missing without ValveResourceFormat. */
    async pictures(): Promise<{ medals: Record<string, string>; badges: string[] }> {
      const exe = vrf();
      const key = `${game()}|${!!exe}`;
      if (pictureCache?.key === key) return { medals: pictureCache.medals, badges: pictureCache.badges };
      const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
      const badges = Array.from({ length: 6 }, (_, i) => pngFromVtex(pak01().read(`panorama/images/hero_badges/hero_badge_rank_${i}_png.vtex_c`)));
      const medals: Record<string, string> = {};
      if (exe) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-rank-'));
        try {
          const filter = MEDAL_PICTURES.map((n) => `panorama/images/rank_tier_icons/${n}_psd.vtex_c`).join(',');
          await run(exe, ['-i', path.join(game(), 'dota', 'pak01_dir.vpk'), '-o', dir, '-d', '-f', filter]);
          for (const n of MEDAL_PICTURES) {
            const file = path.join(dir, 'panorama', 'images', 'rank_tier_icons', `${n}_psd.png`);
            if (fs.existsSync(file)) medals[n] = uri(fs.readFileSync(file));
          }
        } catch (err) {
          log(`rank look: medal pictures unreadable: ${(err as Error).message}`);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      pictureCache = { key, medals, badges: badges.map((b) => (b ? uri(b) : '')) };
      return { medals, badges: pictureCache.badges };
    },

    /** The look the window sent, put in My mods in place of the one before. */
    async install(raw: unknown): Promise<LibRecord> {
      const look = clampLook(raw);
      if (lookIsEmpty(look)) throw new Error(t('Выбери медаль или уровень хотя бы одного героя'));
      const rec = await put(look, false);
      log(`rank look: on, medal ${look.medal ? `${look.medal.tier}/${look.medal.stars}/${look.medal.top}` : 'own'}, ${Object.keys(look.levels).length} hero level(s), every ${look.every ?? '-'}`);
      return rec;
    },

    /**
     * After a Dota update: the record among `ids` built again from the new files, after this
     * returns. Nothing is answered as built yet; `onRebuilt` says when it is.
     */
    rebuild(ids: string[]): string[] {
      return again(ids);
    },

    /** The record built again when its pak carries another app's script; its id then, else null. */
    refreshScript(): string | null {
      const rec = mine();
      const g = rec?.generated as RankGenerated | undefined;
      if (!rec || !g || g.script === SCRIPT_MARK) return null;
      log(`rank look: the script changed (${g.script ?? 'none'} -> ${SCRIPT_MARK}), building again`);
      again([rec.id]);
      return rec.id;
    },
  };

  /** The record among `ids` built again from the files in force, after this returns; `onRebuilt` says when. */
  function again(ids: string[]): string[] {
    const rec = mine();
    const g = rec?.generated as RankGenerated | undefined;
    if (!rec || !g || !ids.includes(rec.id)) return [];
    heroCache = null;
    pictureCache = null;
    setTimeout(() => {
      put(clampLook(g.rank), true).then(() => onRebuilt(rec.id), (err) => log(`rank look: could not build again: ${(err as Error).message}`));
    }, 0);
    return [];
  }
}
