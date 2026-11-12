/* The main menu background of the user's own as a record in My mods (issue #418; the pak itself is
 * src/menu-background.ts). One record: a new background takes the place of the one before, in its
 * slot. The window encodes the user's file to WebM and hands it over; the WebM is kept in
 * userData/menu-backgrounds by its sha1, so a Dota update that reached the record builds it again
 * out of the new layouts with nothing asked of the user, and a new dimming or blur needs no file. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildBackground, webmProblem, type BackgroundLook } from './menu-background.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { sharedVpkIndex } from './vpk.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** What a background record was built from. */
export interface BackgroundGenerated extends BackgroundLook { background: string; source: string }

/** What the window shows: the background on now, if any. */
export interface BackgroundState { installed: { id: string; source: string; dim: number; blur: number; enabled: boolean } | null }

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (Number.isFinite(Number(n)) ? Math.min(Math.max(Number(n), lo), hi) : fallback);

/** The service the background:* channels call. */
export function createMenuBackground({ gamePath, userDataDir, installer, library, log = () => {} }: {
  gamePath: () => string | null | undefined;
  userDataDir: string;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  log?: (msg: string) => void;
}) {
  const store = path.join(userDataDir, 'menu-backgrounds');
  const movie = (sha: string) => path.join(store, `${sha}.webm`);
  const mine = (): LibRecord | null => library.list().find((r) => (r.generated as BackgroundGenerated | undefined)?.background) ?? null;

  function build(g: BackgroundGenerated): Buffer {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    const file = movie(g.background);
    if (!fs.existsSync(file)) throw new Error(t('Файла фона больше нет: выбери его заново'));
    return buildBackground(sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')), fs.readFileSync(file), g);
  }

  const nameOf = (g: BackgroundGenerated) => t('Свой фон меню: {0}', g.source);

  /** The record built from `g`: in the old one's slot, or a new record. */
  function put(g: BackgroundGenerated, keepOff: boolean): LibRecord {
    const vpk = build(g);
    const old = mine();
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name: nameOf(g), files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name: nameOf(g), categoryId: 'backgrounds', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  /** Movies no record uses any more. */
  function tidy(keep: string): void {
    try {
      for (const f of fs.readdirSync(store)) if (f.endsWith('.webm') && f !== `${keep}.webm`) fs.rmSync(path.join(store, f), { force: true });
    } catch { /* nothing kept yet */ }
  }

  return {
    state(): BackgroundState {
      const rec = mine();
      const g = rec?.generated as BackgroundGenerated | undefined;
      return { installed: rec && g ? { id: rec.id, source: g.source, dim: g.dim, blur: g.blur, enabled: rec.enabled !== false } : null };
    },

    /** The user's movie behind the menu; with no movie, the one on now with a new look. */
    install(webm: Uint8Array | null, source: unknown, dim: unknown, blur: unknown): LibRecord {
      const had = mine()?.generated as BackgroundGenerated | undefined;
      let sha = had?.background;
      if (webm) {
        const bytes = Buffer.from(webm);
        const why = webmProblem(bytes);
        if (why) throw new Error(why);
        sha = crypto.createHash('sha1').update(bytes).digest('hex');
        fs.mkdirSync(store, { recursive: true });
        fs.writeFileSync(movie(sha), bytes);
      }
      if (!sha) throw new Error(t('Выбери картинку, GIF или видео'));
      const g: BackgroundGenerated = {
        background: sha,
        source: String(webm ? source || 'video' : had?.source || source || 'video').slice(0, 120),
        dim: clamp(dim, 0, 0.9, 0.2),
        blur: clamp(blur, 0, 20, 0),
      };
      const rec = put(g, false);
      tidy(sha);
      log(`menu background: ${sha.slice(0, 8)} on, dim ${g.dim}, blur ${g.blur}`);
      return rec;
    },

    /**
     * After a Dota update: the background record among `ids` built again from the new layouts.
     * @returns the ids built again
     */
    rebuild(ids: string[]): string[] {
      const rec = mine();
      const g = rec?.generated as BackgroundGenerated | undefined;
      if (!rec || !g || !ids.includes(rec.id)) return [];
      try {
        put(g, true);
        return [rec.id];
      } catch (err) {
        log(`menu background: could not build again after the update: ${(err as Error).message}`);
        return [];
      }
    },
  };
}
