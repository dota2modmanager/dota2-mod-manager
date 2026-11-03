/* The in-game HUD made smaller or larger, as a record in My mods (issue #420; the CSS is
 * src/hud-scale.ts). One record. The style it starts from is the one in force: a HUD mod's copy
 * when one is switched on (first in the load order wins, as in the game), else the game's own.
 * ValveResourceFormat reads it back as CSS, the scale goes at its end, and Valve's compiler builds
 * it again; the pak goes early in the load order, so it wins over the HUD mod it was made from.
 *
 * A Dota update that reached the record builds it again from the new style. That takes the two
 * tools a few seconds, so it runs after the update's repair has answered, and the record's mark
 * from src/update-impact.ts is lifted when it is done. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clampScale, SOURCE, STYLE, withScale } from './hud-scale.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { buildVpk, entryPath, sharedVpkIndex } from './vpk.ts';
import { runTool } from './toolchain.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import type { CompileJob } from './resource-compiler.ts';
import type { VpkEntry } from './vpk.ts';

/** What a HUD scale record was built from. */
export interface HudGenerated { hud: number; base: string }

/** What the window shows: the scale on now, if any, and whether the two tools are there. */
export interface HudState {
  installed: { id: string; scale: number; base: string; enabled: boolean } | null;
  /** the HUD mod whose style the scale would go on, or null for the game's own */
  hudMod: string | null;
  vrf: boolean;
}

const pakNumber = (rel: string) => Number(/pak(\d+)_/i.exec(rel)?.[1] ?? Infinity);

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
    const own = mine()?.id;
    const paks = library.list()
      .filter((r) => r.id !== own && r.enabled !== false)
      .flatMap((r) => (r.files || []).filter((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath)).map((f) => ({ r, rel: f.relPath })))
      .sort((a, b) => pakNumber(a.rel) - pakNumber(b.rel));
    for (const { r, rel } of paks) {
      try {
        const data = sharedVpkIndex(path.join(installer.langFolder(), rel)).read(STYLE);
        if (data) return { data, from: r };
      } catch { /* a pak that cannot be read is not the one in force either */ }
    }
    const data = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')).read(STYLE);
    if (!data) throw new Error(t('В игре нет файла {0}', STYLE));
    return { data, from: null };
  }

  async function build(scale: number): Promise<{ vpk: Buffer; base: string }> {
    const exe = vrf();
    if (!exe) throw new Error(t('Нужен ValveResourceFormat: скачай его в окне'));
    const { data, from } = baseStyle();
    const css = withScale(await decompile(exe, data), scale);
    const entries = await compile({ id: 'hud_scale', files: [{ path: SOURCE, data: Buffer.from(css) }], compile: [SOURCE] });
    const style = entries.filter((e) => entryPath(e) === STYLE);
    if (!style.length) throw new Error(t('resourcecompiler.exe не собрал {0}: {1}', SOURCE, STYLE));
    return { vpk: buildVpk(style), base: from?.name || 'game' };
  }

  const nameOf = (scale: number) => t('Размер интерфейса в игре: {0}%', scale);

  /** The record built at `scale`: in the old one's slot, or a new record. */
  async function put(scale: number, keepOff: boolean): Promise<LibRecord> {
    const { vpk, base } = await build(scale);
    const g: HudGenerated = { hud: scale, base };
    const old = mine();
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name: nameOf(scale), files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name: nameOf(scale), categoryId: 'huds', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  return {
    state(): HudState {
      const rec = mine();
      const g = rec?.generated as HudGenerated | undefined;
      let hudMod: string | null = null;
      try { hudMod = baseStyle().from?.name ?? null; } catch { /* no game yet: nothing to say */ }
      return {
        installed: rec && g ? { id: rec.id, scale: g.hud, base: g.base, enabled: rec.enabled !== false } : null,
        hudMod,
        vrf: !!vrf(),
      };
    },

    /** The HUD at `scale` percent, put in My mods in place of the one before. */
    async install(scale: unknown): Promise<LibRecord> {
      const s = clampScale(scale);
      const rec = await put(s, false);
      log(`hud scale: ${s}% on, from ${(rec.generated as HudGenerated).base}`);
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
        put(g.hud, true).then(() => onRebuilt(rec.id), (err) => log(`hud scale: could not build again after the update: ${(err as Error).message}`));
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
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
