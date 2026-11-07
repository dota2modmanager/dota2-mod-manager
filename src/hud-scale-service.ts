/* The in-game HUD laid out by hand, as a record in My mods (issue #420; the CSS is
 * src/hud-scale.ts). One record. The style it starts from is the one in force: a HUD mod's copy
 * when one is switched on (first in the load order wins, as in the game), else the game's own.
 * ValveResourceFormat reads it back as CSS, the layout goes at its end, and Valve's compiler builds
 * it again; the pak goes early in the load order, so it wins over the HUD mod it was made from.
 *
 * A Dota update that reached the record builds it again from the new style. That takes the two
 * tools a few seconds, so it runs after the update's repair has answered, and the record's mark
 * from src/update-impact.ts is lifted when it is done. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanParts, partsOfScale, SOURCE, STYLE, withLayout, type HudPart } from './hud-scale.ts';
import { cssInForce, fileInForce, swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { buildVpk, entryPath } from './vpk.ts';
import { runTool } from './toolchain.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import type { CompileJob } from './resource-compiler.ts';
import type { VpkEntry } from './vpk.ts';

/** What a HUD record was built from. `hud` is the bottom bar's scale; a record from before the editor has nothing else. */
export interface HudGenerated { hud: number; base: string; parts?: HudPart[] }

/** The layout a record holds. */
const partsOf = (g: HudGenerated): HudPart[] => g.parts ?? partsOfScale(g.hud);

/** What the window shows: the layout on now, if any, and whether the two tools are there. */
export interface HudState {
  installed: { id: string; parts: HudPart[]; base: string; enabled: boolean } | null;
  /** the HUD mod whose style the layout would go on, or null for the game's own */
  hudMod: string | null;
  vrf: boolean;
}

/** The service the hud:* channels call. */
export function createHudScale({ gamePath, installer, library, vrf, compile, decompile = vrfCss, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** ValveResourceFormat's CLI, when it is downloaded */
  vrf: () => string | null;
  compile: (job: CompileJob) => Promise<VpkEntry[]>;
  /** a compiled style read back as CSS; tests hand one in */
  decompile?: (exe: string, style: Buffer) => Promise<string>;
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
    const exe = vrf();
    if (!exe) throw new Error(t('Нужен ValveResourceFormat: скачай его в окне'));
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    const got = await cssInForce({ game, langFolder: installer.langFolder(), records: library.list(), own: mine()?.id, file: STYLE }, (style) => decompile(exe, style), log);
    if (!got) throw new Error(t('В игре нет файла {0}', STYLE));
    const { from } = got;
    const css = withLayout(got.css, parts);
    const entries = await compile({ id: 'hud_scale', files: [{ path: SOURCE, data: Buffer.from(css) }], compile: [SOURCE] });
    const style = entries.filter((e) => entryPath(e) === STYLE);
    if (!style.length) throw new Error(t('resourcecompiler.exe не собрал {0}: {1}', SOURCE, STYLE));
    return { vpk: buildVpk(style), base: from?.name || 'game' };
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
        vrf: !!vrf(),
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

/** A compiled style read back as CSS by ValveResourceFormat, in a folder of its own that goes after. */
export async function vrfCss(exe: string, style: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-hud-'));
  try {
    const src = path.join(dir, 'hud_reborn.vcss_c');
    const out = path.join(dir, 'hud_reborn.css');
    fs.writeFileSync(src, style);
    await runTool(exe, ['-i', src, '-o', out, '-d']);
    // it answers 0 for a file it could not read, and writes nothing
    if (!fs.existsSync(out)) throw new Error(t('ValveResourceFormat не смог прочитать стиль интерфейса'));
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
