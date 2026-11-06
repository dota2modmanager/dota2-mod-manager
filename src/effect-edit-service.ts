/* The effect editor: finding an effect among the game's, showing it changed, and a change put in
 * My mods. The changes themselves are src/effect-edit.ts. One record per effect, built from the
 * game's own file: making the same effect again replaces it, in its place in the load order. */
import path from 'node:path';
import { cleanEdits, editedEntries, systemsOf, type EffectEdits } from './effect-edit.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { particleDef, type ParticleDef } from './particle-spec.ts';
import { buildVpk, entryPath, sharedVpkIndex } from './vpk.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** How many effects a search hands back: past that the words are too wide. */
const SHOWN = 60;

/** What an effect's record was built from. */
export interface EffectGenerated { effect: string; edits: EffectEdits }

const valid = (p: unknown): string => {
  const s = String(p).toLowerCase();
  if (!/^particles\/[\w/.-]+\.vpcf$/.test(s)) throw new Error(t('Не удалось прочитать эффект'));
  return s;
};
const nameOf = (p: string) => path.posix.basename(p, '.vpcf');

/** The service the fx:* channels call. */
export function createEffectEdit({ gamePath, installer, library, sprites, onRebuilt = () => {}, log = () => {} }: {
  gamePath: () => string | null | undefined;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update'>;
  /** the textures of a system and its children, as the window takes them */
  sprites: (defs: ParticleDef[]) => Promise<Record<string, Uint8Array>>;
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

  /** The effect with changes on, as the window plays it. */
  function defOf(effect: string, edits: EffectEdits): ParticleDef | null {
    const { ix } = index();
    const changed = new Map(editedEntries((p) => ix.read(p), effect, edits).map((e) => [entryPath(e), e.data]));
    return particleDef((p) => changed.get(p) ?? ix.read(p), effect);
  }

  /** The effect with these changes, put in My mods in place of the one before. */
  function install(raw: unknown, rawEdits: unknown): LibRecord {
    const effect = valid(raw);
    const edits = cleanEdits(rawEdits);
    const { ix } = index();
    const entries = editedEntries((p) => ix.read(p), effect, edits);
    if (!entries.length) throw new Error(t('Здесь нечего менять: в этом эффекте нет таких чисел'));
    const vpk = buildVpk(entries);
    const generated: EffectGenerated = { effect, edits };
    const name = t('Эффект: {0}', nameOf(effect));
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
        return g?.effect ? [{ path: g.effect, name: nameOf(g.effect) }] : [];
      });
    },

    /** One effect: its systems, the changes on it now, and how it plays with them. */
    async load(raw: unknown) {
      const effect = valid(raw);
      const { ix } = index();
      const edits = (recordOf(effect)?.generated as EffectGenerated | undefined)?.edits ?? {};
      const def = defOf(effect, edits);
      if (!def) throw new Error(t('Не удалось прочитать эффект'));
      return { path: effect, edits, def, sprites: await sprites([def]), systems: systemsOf((p) => ix.read(p), effect) };
    },

    /** How an effect plays with these changes. */
    preview(raw: unknown, edits: unknown): ParticleDef | null {
      return defOf(valid(raw), cleanEdits(edits));
    },

    install,

    /** The records among `ids` built again from the game's new files, one at a time out of the way of the start. */
    rebuild(ids: string[]): string[] {
      for (const rec of library.list()) {
        const g = rec.generated as EffectGenerated | undefined;
        if (!g?.effect || !ids.includes(rec.id)) continue;
        setTimeout(() => {
          try { install(g.effect, g.edits); onRebuilt(rec.id); } catch (err) { log(`effect edit: could not build ${g.effect} again after the update: ${(err as Error).message}`); }
        }, 0);
      }
      return [];
    },
  };
}
