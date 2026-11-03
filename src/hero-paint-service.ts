/* A hero recoloured part by part, as one record in My mods (issue #422; what the parts are is
 * src/recolor-layers.ts). The window lists the hero's layers and sends a colour for each one that is
 * on; the pak is built from the game's own pak01, a file at a time, and goes early in the load order
 * with the hero items, so it wins over a catalog mod of the same hero.
 *
 * Particles take the colour through src/recolor.ts. A picture is a compiled texture. Most of the
 * hero's are block-compressed (all his small icons, nearly every ability icon): ValveResourceFormat
 * reads one out as a PNG, it is repainted (`repaint`, Electron's image codec in the app), and
 * Valve's compiler builds it again, as the child of a stylesheet that names it, which is how
 * Panorama compiles a picture. The body's textures go the same way, as the colour of a material of
 * the hero shader, and come back under the game's own names. A texture with a PNG inside
 * (src/vtex.ts) needs neither tool: its PNG is repainted and put back behind the same header.
 *
 * A Dota update that reached the record builds it again with the same colours, a step at a time,
 * after the update's repair has answered; the record's mark goes when that is done. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { heroAbilities, heroLayers, heroModelFolder, withChildren, type RecolorLayer } from './recolor-layers.ts';
import { recolorResource, type Rgb } from './recolor.ts';
import { references } from './resource.ts';
import { pngFromVtex } from './vtex.ts';
import { localizationTokens } from './cosmetic-names.ts';
import { findItem } from './schema-items.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { buildVpk, entryAt, entryPath, sharedVpkIndex, type VpkEntry } from './vpk.ts';
import { runTool } from './toolchain.ts';
import type { CompileJob } from './resource-compiler.ts';
import { PAUSE, runSteps } from './steps.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** What a hero's paint record was built from: the hero, and each layer's colour as #rrggbb. */
export interface PaintGenerated { paint: string; label: string; layers: Record<string, string> }

/** One layer as the window lists it. */
export interface PaintLayerView { id: string; kind: RecolorLayer['kind']; name: string | null; files: number }

const HEX = /^#[0-9a-f]{6}$/i;
const HERO = /^[a-z0-9_]{2,40}$/;
const LANG_FILE: Record<string, string> = { ru: 'russian', en: 'english', 'zh-CN': 'schinese' };
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
// the item's own particles, as its visuals name them
const PARTICLE = /"(?:modifier|asset)"\s+"(particles\/[^"]+\.vpcf)"/gi;

/** The service the paint:* channels call. */
export function createHeroPaint({ gamePath, installer, library, vanilla, repaint, vrf = () => null, compile, decode = vrfPng, lang = () => 'en', onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** the game's own item table */
  vanilla: () => string;
  /** a PNG in the chosen colour; Electron's codec in the app, a fake in tests */
  repaint: (png: Buffer, color: Rgb) => Buffer;
  /** ValveResourceFormat's CLI, when it is downloaded: it reads the compressed pictures */
  vrf?: () => string | null;
  /** Valve's compiler, which builds those pictures again */
  compile?: (job: CompileJob) => Promise<VpkEntry[]>;
  /** a compressed picture read out as a PNG; tests hand one in */
  decode?: (exe: string, vtex: Buffer) => Promise<Buffer>;
  lang?: () => string;
  onRebuilt?: (id: string) => void;
  log?: (msg: string) => void;
}) {
  const pak01 = () => {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    return sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
  };
  const mine = (hero: string): LibRecord | null => library.list().find((r) => (r.generated as PaintGenerated | undefined)?.paint === hero) ?? null;

  /** The items picked for the hero in the item builder, with the particles they name. */
  function picked(hero: string): { id: string; name: string; particles: string[] }[] {
    const ids = [...new Set(library.list()
      .filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false && String(r.slot || '').startsWith(`item:${hero}:`) && r.itemId)
      .map((r) => String(r.itemId)))];
    if (!ids.length) return [];
    const text = vanilla();
    return ids.flatMap((id) => {
      const block = findItem(text, id)?.text;
      const name = block && /"name"\s+"([^"]+)"/.exec(block)?.[1];
      return block ? [{ id, name: name || id, particles: [...block.matchAll(PARTICLE)].map((m) => m[1]) }] : [];
    });
  }

  function layers(hero: string): RecolorLayer[] {
    if (!HERO.test(hero)) throw new Error(t('Нет такого героя: {0}', hero));
    const index = pak01();
    const script = index.read(`scripts/npc/heroes/npc_dota_hero_${hero}.txt`);
    if (!script) throw new Error(t('Нет такого героя: {0}', hero));
    const text = script.toString('utf8');
    const all = heroLayers(index.paths(), hero, heroAbilities(text), picked(hero), heroModelFolder(text));
    // an item's particles create others: those are its effect too
    const refs = (p: string) => { try { return references(index.read(p) as Buffer).map((r) => (r.toLowerCase().endsWith('_c') ? r.toLowerCase() : `${r.toLowerCase()}_c`)); } catch { return []; } };
    for (const l of all) if (l.kind === 'item') l.files = withChildren(l.files, refs).filter((p) => index.read(p));
    return all;
  }

  /** Ability names in the app's language, out of the game's abilities_*.txt. */
  function abilityNames(): Map<string, string> {
    try {
      const data = pak01().read(`resource/localization/abilities_${LANG_FILE[lang()] || 'english'}.txt`);
      return data ? localizationTokens(data) : new Map();
    } catch { return new Map(); }
  }

  type Built = { entries: Map<string, VpkEntry>; compressed: { path: string; file: Buffer; color: Rgb }[] };
  function* buildSteps(hero: string, colors: Record<string, string>): Generator<typeof PAUSE, Built> {
    const index = pak01();
    const entries = new Map<string, VpkEntry>();
    const compressed: Built['compressed'] = [];
    let since = Date.now();
    for (const layer of layers(hero)) {
      const hex = colors[layer.id];
      if (!hex) continue;
      const color = rgbOf(hex);
      for (const p of layer.files) {
        if (Date.now() - since > 40) { yield PAUSE; since = Date.now(); }
        const file = index.read(p) as Buffer | null;
        if (!file) continue;
        try {
          if (p.endsWith('.vpcf_c')) {
            const r = recolorResource(file, color, { own: true });
            if (r.changed) entries.set(p, entryAt(p, r.file));
          } else {
            const png = pngFromVtex(file);
            if (png) entries.set(p, entryAt(p, Buffer.concat([file.subarray(0, file.length - png.length), repaint(png, color)])));
            else compressed.push({ path: p, file, color });
          }
        } catch (e) {
          log(`hero paint: ${p} left as it is: ${(e as Error).message}`);
        }
      }
    }
    return { entries, compressed };
  }

  /** The compressed pictures, read out, repainted and compiled again; none without both tools. */
  async function pictures(list: Built['compressed']): Promise<VpkEntry[]> {
    const exe = vrf();
    if (!list.length || !exe || !compile) {
      if (list.length) log(`hero paint: ${list.length} compressed picture(s) left as they are, ${exe ? 'no compiler' : 'no ValveResourceFormat'}`);
      return [];
    }
    try {
      const files: { path: string; data: Buffer }[] = [];
      const rules: string[] = [];
      const compileList: string[] = [];
      // a model's texture comes back under a name of the compiler's: put it under the game's
      const textures = new Map<string, string>();
      for (const p of list) {
        const png = repaint(await decode(exe, p.file), p.color);
        if (p.path.startsWith('panorama/images/')) {
          const source = p.path.replace(/_png\.vtex_c$/, '.png');
          files.push({ path: source, data: png });
          rules.push(`.p${rules.length} { background-image: url("file://{images}/${source.slice('panorama/images/'.length)}"); }`);
        } else {
          // a model's texture compiles as the colour of a material of the hero shader
          const n = textures.size;
          const source = `materials/d2mm_paint/t${n}.png`;
          const vmat = `materials/d2mm_paint/t${n}.vmat`;
          files.push({ path: source, data: png }, { path: vmat, data: Buffer.from(`Layer0\n{\n\tshader "hero.vfx"\n\tTextureColor "${source}"\n}\n`) });
          compileList.push(vmat);
          textures.set(`t${n}`, p.path);
        }
      }
      // Panorama compiles a picture as the child of a style that names it
      if (rules.length) {
        const css = 'panorama/styles/d2mm_hero_paint.css';
        files.push({ path: css, data: Buffer.from(rules.join('\n')) });
        compileList.push(css);
      }
      const wanted = new Set(list.map((p) => p.path));
      const out = await compile({ id: 'hero_paint', files, compile: compileList });
      return out.flatMap((e) => {
        const p = entryPath(e);
        const own = /^materials\/d2mm_paint\/(t\d+)_png_[0-9a-f]+\.vtex_c$/.exec(p);
        if (own) return textures.has(own[1]) ? [entryAt(textures.get(own[1])!, e.data)] : [];
        return wanted.has(p) ? [e] : [];
      });
    } catch (e) {
      // no Workshop Tools, or the tool failed: the particles still go in
      log(`hero paint: ${list.length} compressed picture(s) left as they are: ${(e as Error).message}`);
      return [];
    }
  }

  async function put(hero: string, label: string, colors: Record<string, string>, keepOff: boolean): Promise<LibRecord> {
    const { entries, compressed } = await runSteps(buildSteps(hero, colors));
    for (const e of await pictures(compressed)) entries.set(entryPath(e), e);
    if (!entries.size) throw new Error(t('Ни один файл не взял цвет'));
    const vpk = buildVpk([...entries.values()]);
    const count = entries.size;
    const g: PaintGenerated = { paint: hero, label, layers: colors };
    const name = t('Перекраска: {0}', label);
    const old = mine(hero);
    log(`hero paint: ${hero}, ${Object.keys(colors).length} layer(s), ${count} file(s)`);
    if (old) {
      const off = keepOff && old.enabled === false;
      const files = swapPak(installer, old, vpk, off);
      return library.update(old.id, { name, files, generated: g, enabled: !off, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name, categoryId: 'hero-items', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated: g }) as LibRecord;
  }

  return {
    /** The hero's layers and the colours on now. */
    state(hero: string): { layers: PaintLayerView[]; installed: { id: string; layers: Record<string, string>; enabled: boolean } | null; vrf: boolean } {
      const names = abilityNames();
      const rec = mine(hero);
      const g = rec?.generated as PaintGenerated | undefined;
      return {
        layers: layers(hero).map((l) => ({
          id: l.id, kind: l.kind, files: l.files.length,
          name: l.kind === 'item' ? l.name! : l.name ? names.get(`dota_tooltip_ability_${l.name}`) || l.name : null,
        })),
        installed: rec && g ? { id: rec.id, layers: g.layers, enabled: rec.enabled !== false } : null,
        vrf: !!vrf(),
      };
    },

    /**
     * The hero in the colours given, one #rrggbb per layer that is on, in place of the record before.
     * @param label the hero's name as the window shows it, for the record's
     */
    async install(hero: unknown, colors: unknown, label?: unknown): Promise<LibRecord> {
      if (typeof hero !== 'string' || !HERO.test(hero)) throw new Error(t('Нет такого героя: {0}', String(hero)));
      const picked = Object.fromEntries(Object.entries((colors || {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && HEX.test(e[1])));
      if (!Object.keys(picked).length) throw new Error(t('Выбери цвет хотя бы для одного слоя'));
      return put(hero, typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : hero, picked, false);
    },

    /** After a Dota update: the records among `ids` built again with their colours, after this returns. */
    rebuild(ids: string[]): string[] {
      for (const rec of library.list().filter((r) => ids.includes(r.id) && (r.generated as PaintGenerated | undefined)?.paint)) {
        const g = rec.generated as PaintGenerated;
        setTimeout(() => {
          put(g.paint, g.label || g.paint, g.layers, true).then(() => onRebuilt(rec.id), (err) => log(`hero paint: could not build again after the update: ${(err as Error).message}`));
        }, 0);
      }
      return [];
    },
  };
}

/** A compressed picture read out as a PNG by ValveResourceFormat, in a folder of its own that goes after. */
export async function vrfPng(exe: string, vtex: Buffer): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-paint-'));
  try {
    const src = path.join(dir, 'picture.vtex_c');
    const out = path.join(dir, 'picture.png');
    fs.writeFileSync(src, vtex);
    await runTool(exe, ['-i', src, '-o', out, '-d']);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
