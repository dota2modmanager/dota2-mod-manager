/**
 * Which installed mods a Dota update reached.
 *
 * A mod replaces some of Valve's files with its own copies. When an update changes one of those
 * files, the mod keeps serving the copy it was built from, and the game gets the old version back
 * on top of the new one. Most of the time nothing shows; sometimes a HUD loses a new element or a
 * versus screen breaks. Build 6946 (2026-10-07) changed 221 HUD layouts, and a HUD mod in daily
 * use replaced 15 of them. Nothing told its owner which mod to look at.
 *
 * The game's pak01 index says what each of Valve's files is (path and CRC), but only for the build
 * on disk: the build before is gone the moment Steam writes the new one. So this keeps a note of
 * Valve's CRC for every path an installed mod replaces, taken while the game is unchanged, and
 * after an update compares the note with the new index. That is thousands of paths, not the
 * 388 000 in the index, and the index is read only when the game or the set of paths changed.
 *
 * A mod stays marked until its own file changes (an update of the mod, a reinstall) or it is
 * removed: an older patch does not make a stale copy fresh again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listVpkPathsFile, listVpkPathCrcsFile } from './vpk.ts';
import type { LibRecord } from './types.ts';

/** A mod as this module reads it: who it is, and its index on disk. */
export interface ImpactMod { id: string; name: string; dir: string }

/** What an update did to one mod's files. */
export interface ModImpact {
  /** the build that first changed files under this mod */
  since: string | null;
  /** Valve changed (or newly shipped) a file the mod replaces */
  changed: string[];
  /** Valve removed a file the mod replaces: that part of the mod does nothing now */
  removed: string[];
  /** the mod's own file when this was found; a different one means the mod changed since */
  sig: string;
}

/** The update a check just found, and the mods it reached: what the banner after a patch says. */
export interface Reached { from: string | null; to: string | null; ids: string[] }

interface Store {
  /** pak01_dir.vpk as size:mtime, the moment the note below was taken */
  key: string | null;
  build: string | null;
  /** Valve's CRC per path a mod replaces; null where Valve has no such file */
  crcs: Record<string, number | null>;
  mods: Record<string, ModImpact>;
}

const EMPTY: Store = { key: null, build: null, crcs: {}, mods: {} };

/** A file as size:mtime, or null when it is not there. */
function fileSig(file: string): string | null {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch { return null; }
}

/** The library's mods as this module reads them: every record with a pak of its own in the language folder. */
export function impactMods(records: Pick<LibRecord, 'id' | 'name' | 'files'>[], fileOnDisk: (relPath: string) => string): ImpactMod[] {
  const out: ImpactMod[] = [];
  for (const r of records) {
    const dir = (r.files || []).find((f) => f.root === 'lang' && /_dir.vpk$/i.test(f.relPath));
    if (dir) out.push({ id: r.id, name: r.name, dir: fileOnDisk(dir.relPath) });
  }
  return out;
}

/**
 * @param file     where the note lives (userData)
 * @param gamePath the game folder, or null when there is none
 * @param mods     the installed mods, read when asked
 * @param build    the game's build number, for the words on the screen
 */
export function createUpdateImpact({ file, gamePath, mods, build, log = () => {} }: {
  file: string; gamePath: () => string | null; mods: () => ImpactMod[]; build: (game: string) => string | null; log?: (msg: string) => void;
}) {
  const pakOf = (game: string) => path.join(game, 'dota', 'pak01_dir.vpk');

  function load(): Store {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...EMPTY, ...s, crcs: s.crcs || {}, mods: s.mods || {} };
    } catch { return { ...EMPTY, crcs: {}, mods: {} }; }
  }

  function save(s: Store): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s));
  }

  /** Each mod's replaced paths and its own signature; a mod that cannot be read is left out. */
  function read(mods: ImpactMod[]) {
    const out: { mod: ImpactMod; paths: string[]; sig: string }[] = [];
    for (const mod of mods) {
      const sig = fileSig(mod.dir);
      if (!sig) continue;
      try { out.push({ mod, paths: listVpkPathsFile(mod.dir), sig }); } catch { /* a broken index is reported elsewhere */ }
    }
    return out;
  }

  /**
   * Bring the note up to date with the game on disk, and say which mods an update reached.
   * Called at start and after a patch. Cheap when nothing moved: a stat of the game's index and
   * the mods' own indexes, which are a few kilobytes each.
   * @returns the update this check found and the mods it reached, or null
   */
  function check(): Reached | null {
    const game = gamePath();
    if (!game) return null;
    const s = load();
    const key = fileSig(pakOf(game));
    if (!key) return null;
    const now = build(game);
    const current = read(mods());
    // a mod that changed or went away since it was marked is no longer the copy that went stale
    const alive = new Map(current.map((c) => [c.mod.id, c.sig]));
    for (const id of Object.keys(s.mods)) if (alive.get(id) !== s.mods[id].sig) delete s.mods[id];

    const wanted = new Set<string>();
    for (const c of current) for (const p of c.paths) wanted.add(p);

    if (s.key === key) {
      const missing = [...wanted].filter((p) => !(p in s.crcs));
      if (missing.length) {
        const valve = listVpkPathCrcsFile(pakOf(game));
        for (const p of missing) s.crcs[p] = valve.get(p) ?? null;
      }
      save(s);
      return null;
    }

    const valve = listVpkPathCrcsFile(pakOf(game));
    let reached: Reached | null = null;
    if (s.key) {
      const ids: string[] = [];
      for (const c of current) {
        const changed: string[] = [];
        const removed: string[] = [];
        for (const p of c.paths) {
          if (!(p in s.crcs)) continue;
          const was = s.crcs[p];
          const is = valve.get(p) ?? null;
          if (was === is) continue;
          if (is === null) removed.push(p); else changed.push(p);
        }
        if (!changed.length && !removed.length) continue;
        ids.push(c.mod.id);
        const prev = s.mods[c.mod.id];
        const merge = (a: string[] = [], b: string[]) => [...new Set([...a, ...b])].sort();
        s.mods[c.mod.id] = {
          since: prev?.since ?? now,
          changed: merge(prev?.changed, changed),
          removed: merge(prev?.removed, removed),
          sig: c.sig,
        };
      }
      if (ids.length) {
        reached = { from: s.build, to: now, ids };
        log(`update ${s.build || '?'} -> ${now || '?'} reached ${ids.length} mod(s): ${current.filter((c) => ids.includes(c.mod.id)).map((c) => c.mod.name).join(', ')}`);
      }
    }
    // the note for the build now on disk, over the paths the mods replace now
    s.crcs = {};
    for (const p of wanted) s.crcs[p] = valve.get(p) ?? null;
    s.key = key;
    s.build = now;
    save(s);
    return reached;
  }

  /**
   * The installed mods that are marked, by id, without reading the game. A mod whose file
   * changed since it was marked is left out at once rather than at the next check.
   */
  function marked(): Map<string, ModImpact> {
    const all = load().mods;
    const out = new Map<string, ModImpact>();
    for (const m of mods()) {
      const hit = all[m.id];
      if (hit && fileSig(m.dir) === hit.sig) out.set(m.id, hit);
    }
    return out;
  }

  return { check, marked };
}
