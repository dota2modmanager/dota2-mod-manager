/* The in-game HUD laid out by hand, as a record in My mods (issue #420; the CSS is
 * src/hud-scale.ts). One record. The style it starts from is the one in force: a HUD mod's copy
 * when one is switched on (first in the load order wins, as in the game), else the game's own.
 * Its CSS is read out of it, the layout goes at its end, and the style is written again here
 * (src/panorama-files.ts), without ValveResourceFormat or Valve's compiler; the pak goes early in
 * the load order, so it wins over the HUD mod it was made from.
 *
 * A Dota update that reached the record builds it again from the new style, after the update's
 * repair has answered, and the record's mark from src/update-impact.ts is lifted when it is done. */
import { cleanParts, partsOfScale, STYLE, withLayout, type HudPart } from './hud-scale.ts';
import path from 'node:path';
import { fileInForce, swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { readStyle, writeStyle } from './panorama-files.ts';
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** What a HUD record was built from. `hud` is the bottom bar's scale; a record from before the editor has nothing else. */
export interface HudGenerated { hud: number; base: string; parts?: HudPart[] }

/** The layout a record holds. */
const partsOf = (g: HudGenerated): HudPart[] => g.parts ?? partsOfScale(g.hud);

/** What the window shows: the layout on now, if any. */
export interface HudState {
  installed: { id: string; parts: HudPart[]; base: string; enabled: boolean } | null;
  /** the HUD mod whose style the layout would go on, or null for the game's own */
  hudMod: string | null;
}

/** The service the hud:* channels call. */
export function createHudScale({ gamePath, installer, library, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** a record built again after an update, so its mark can go */
  onRebuilt?: (id: string) => void;
  log?: (msg: string) => void;
}) {
  const mine = (): LibRecord | null => library.list().find((r) => typeof (r.generated as HudGenerated | undefined)?.hud === 'number') ?? null;

  /** The style in force before ours: the first switched-on mod's copy that carries it, else the game's. */
  function baseStyle(): { data: Buffer; from: LibRecord | null } {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    const got = fileInForce({ game, langFolder: installer.langFolder(), records: library.list(), own: mine()?.id, file: STYLE });
    if (!got) throw new Error(t('В игре нет файла {0}', STYLE));
    return got;
  }

  async function build(parts: HudPart[]): Promise<{ vpk: Buffer; base: string }> {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    const readable = (data: Buffer) => { try { readStyle(data); return true; } catch { return false; } };
    const got = fileInForce({
      game, langFolder: installer.langFolder(), records: library.list(), own: mine()?.id, file: STYLE, usable: readable,
      passedOver: (rec) => log(`hud layout: ${rec.name} carries ${STYLE} in a form the app cannot read, using the next copy`),
    });
    if (!got) throw new Error(t('В игре нет файла {0}', STYLE));
    const pak01 = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    if (!readable(got.data)) throw new Error(t('Не удалось прочитать стиль {0}', STYLE));
    const style = writeStyle(got.data, withLayout(readStyle(got.data).css, parts), () => null, (p) => pak01.read(p));
    return { vpk: buildVpk([entryAt(STYLE, style)]), base: got.from?.name || 'game' };
  }

  const nameOf = (parts: HudPart[]) => t('Интерфейс в игре: панелей изменено {0}', parts.length);

  /** The record built with `parts`: in the old one's slot, or a new record. */
  async function put(parts: HudPart[], keepOff: boolean): Promise<LibRecord> {
    const { vpk, base } = await build(parts);
    const g: HudGenerated = { hud: parts.find((p) => p.id === 'lower_hud')?.scale ?? 100, base, parts };
    const old = mine();
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name: nameOf(parts), files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name: nameOf(parts), categoryId: 'huds', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  return {
    state(): HudState {
      const rec = mine();
      const g = rec?.generated as HudGenerated | undefined;
      let hudMod: string | null = null;
      try { hudMod = baseStyle().from?.name ?? null; } catch { /* no game yet: nothing to say */ }
      return {
        installed: rec && g ? { id: rec.id, parts: partsOf(g), base: g.base, enabled: rec.enabled !== false } : null,
        hudMod,
      };
    },

    /** The HUD with this layout, put in My mods in place of the one before. */
    async install(raw: unknown): Promise<LibRecord> {
      const parts = cleanParts(raw);
      const rec = await put(parts, false);
      log(`hud layout: ${parts.length} panels changed, from ${(rec.generated as HudGenerated).base}`);
      return rec;
    },

    /**
     * After a Dota update: the record among `ids` built again from the new style, after this
     * returns. Nothing is answered as built yet; `onRebuilt` says when it is.
     */
    rebuild(ids: string[]): string[] {
      const rec = mine();
      const g = rec?.generated as HudGenerated | undefined;
      if (!rec || !g || !ids.includes(rec.id)) return [];
      setTimeout(() => {
        put(partsOf(g), true).then(() => onRebuilt(rec.id), (err) => log(`hud layout: could not build again after the update: ${(err as Error).message}`));
      }, 0);
      return [];
    },
  };
}
