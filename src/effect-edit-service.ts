/* The effect editor: finding an effect among the game's, showing it changed, and a change put in
 * My mods. The changes themselves are src/effect-edit.ts. One record per effect, built from the
 * game's own file: making the same effect again replaces it, in its place in the load order. */
import path from 'node:path';
import { cleanEdits, editedEntries, systemsOf, type EffectEdits } from './effect-edit.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { particleDef, type ParticleDef } from './particle-spec.ts';
import { buildVpk, entryPath, sharedVpkIndex, type VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import type { createEffectFinder } from './effect-finder.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** How many effects a search hands back: past that the words are too wide. */
const SHOWN = 60;

/** How many of an ability's effects the window plays at once. */
const PLAYED = 16;

/** What an effect's record was built from. `effect` is a file, or `ability:hero/ability` for all of an ability's. */
export interface EffectGenerated { effect: string; edits: EffectEdits; items?: boolean; name?: string }

const ABILITY = /^ability:([a-z0-9_]{2,40})\/([a-z0-9_]{2,80})$/;
const valid = (p: unknown): string => {
  const s = String(p).toLowerCase();
  if (!/^particles\/[\w/.-]+\.vpcf$/.test(s) && !ABILITY.test(s)) throw new Error(t('Не удалось прочитать эффект'));
  return s;
};
const nameOf = (p: string) => path.posix.basename(p, '.vpcf');

/** What one id stands for: the effects played, and what items put in their place. */
interface Target { name: string; roots: string[]; variants: string[] }

/** The service the fx:* channels call. */
export function createEffectEdit({ gamePath, installer, library, sprites, finder, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** the textures of a system and its children, as the window takes them */
  sprites: (defs: ParticleDef[]) => Promise<Record<string, Uint8Array>>;
  /** an ability's effects, read off the game (src/effect-finder.ts) */
  finder?: Pick<ReturnType<typeof createEffectFinder>, 'ability' | 'variants'>;
  onRebuilt?: (id: string) => void;
  log?: (msg: string) => void;
}) {
  let all: { game: string; paths: string[] } | null = null;
  const index = () => {
    const game = gamePath();
    if (!game) throw new Error(t('Не указана папка игры'));
    return { game, ix: sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')) };
  };
  const paths = (): string[] => {
    const { game, ix } = index();
    if (all?.game !== game) all = { game, paths: [...ix.paths()].filter((p) => p.startsWith('particles/') && p.endsWith('.vpcf_c')).map((p) => p.slice(0, -2)) };
    return all.paths;
  };
  const recordOf = (effect: string): LibRecord | null =>
    library.list().find((r) => (r.generated as EffectGenerated | undefined)?.effect === effect) ?? null;

  function targetOf(id: string): Target {
    const m = ABILITY.exec(id);
    if (!m) return { name: nameOf(id), roots: [id], variants: finder?.variants([id]) ?? [] };
    const a = finder?.ability(m[1], m[2]);
    if (!a?.paths.length) throw new Error(t('Не удалось прочитать эффект'));
    return { name: a.name || m[2], roots: a.paths, variants: finder?.variants(a.files) ?? [] };
  }

  /** The changed files of a target, each once; an item's effect the reader cannot take stays as the game has it. */
  function entriesOf(target: Target, edits: EffectEdits, items: boolean): VpkEntry[] {
    const { ix } = index();
    const read = (p: string) => ix.read(p);
    const out = new Map(target.roots.flatMap((r) => editedEntries(read, r, edits)).map((e) => [entryPath(e), e]));
    if (items) {
      for (const v of target.variants) {
        try {
          for (const e of editedEntries(read, v, edits)) if (!out.has(entryPath(e))) out.set(entryPath(e), e);
        } catch (err) { log(`effect edit: left ${v} as it is: ${(err as Error).message}`); }
      }
    }
    return [...out.values()];
  }

  /** The effects with changes on, as the window plays them. */
  function defsOf(target: Target, edits: EffectEdits): ParticleDef[] {
    const { ix } = index();
    const changed = new Map(entriesOf(target, edits, false).map((e) => [entryPath(e), e.data]));
    return target.roots.slice(0, PLAYED).flatMap((r) => particleDef((p) => changed.get(p) ?? ix.read(p), r) ?? []);
  }

  /** The effect with these changes, put in My mods in place of the one before. */
  function install(raw: unknown, rawEdits: unknown, items = false): LibRecord {
    const effect = valid(raw);
    const edits = cleanEdits(rawEdits);
    const target = targetOf(effect);
    const entries = entriesOf(target, edits, items);
    if (!entries.length) throw new Error(t('Здесь нечего менять: в этом эффекте нет таких чисел'));
    const vpk = buildVpk(entries);
    const generated: EffectGenerated = { effect, edits, items, name: target.name };
    const name = t('Эффект: {0}', target.name);
    const old = recordOf(effect);
    log(`effect edit: ${effect}, ${entries.length} systems`);
    if (old) {
      const off = old.enabled === false;
      return library.update(old.id, { name, files: swapPak(installer, old, vpk, off), generated, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name, categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated }) as LibRecord;
  }

  return {
    /** The effects whose path has every word of `query`, shortest first. */
    search(query: string): string[] {
      const words = query.toLowerCase().split(/[\s/]+/).filter(Boolean);
      if (!words.length) return [];
      return paths().filter((p) => words.every((w) => p.includes(w))).sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, SHOWN);
    },

    /** The effects changed so far. */
    saved(): { path: string; name: string }[] {
      return library.list().flatMap((r) => {
        const g = r.generated as EffectGenerated | undefined;
        return g?.effect ? [{ path: g.effect, name: g.name || nameOf(g.effect) }] : [];
      });
    },

    /** One effect: its systems, the changes on it now, and how it plays with them. */
    async load(raw: unknown) {
      const effect = valid(raw);
      const { ix } = index();
      const target = targetOf(effect);
      const made = recordOf(effect)?.generated as EffectGenerated | undefined;
      const edits = made?.edits ?? {};
      const defs = defsOf(target, edits);
      if (!defs.length) throw new Error(t('Не удалось прочитать эффект'));
      const seen = new Set<string>();
      const systems = target.roots.flatMap((r) => systemsOf((p) => ix.read(p), r)).filter((s) => !seen.has(s.path) && seen.add(s.path));
      return { path: effect, name: target.name, edits, defs, sprites: await sprites(defs), systems, variants: target.variants.length, items: !!made?.items };
    },

    /** How an effect plays with these changes. */
    preview(raw: unknown, edits: unknown): ParticleDef[] {
      return defsOf(targetOf(valid(raw)), cleanEdits(edits));
    },

    install,

    /** The records among `ids` built again from the game's new files, one at a time out of the way of the start. */
    rebuild(ids: string[]): string[] {
      for (const rec of library.list()) {
        const g = rec.generated as EffectGenerated | undefined;
        if (!g?.effect || !ids.includes(rec.id)) continue;
        setTimeout(() => {
          try { install(g.effect, g.edits, !!g.items); onRebuilt(rec.id); } catch (err) { log(`effect edit: could not build ${g.effect} again after the update: ${(err as Error).message}`); }
        }, 0);
      }
      return [];
    },
  };
}
