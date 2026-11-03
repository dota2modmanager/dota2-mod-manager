// Models out of the installed game as glTF, for a 3D preview of a hero in the chosen items (issue #417).
//
// The Source 2 toolchain (src/toolchain.ts) turns a compiled model straight out of pak01 into a
// GLB with its textures as PNG files beside it, and with the clips asked for. Measured on the
// real game (2026-11-03): Techies with its idle 1.2 s and 2.3 MB, a wearable 1.1 s, and most of
// that is the program starting, so the models a preview asks for go out in one call, the way
// src/game-icons.ts fetches its pictures.
//
// The export runs as a child process, which keeps the main process free. The cache lives in
// userData under the game's build: a new build can change any model, so the old cache goes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runTool } from './toolchain.ts';
import { gameSchemaStamp } from './schema-items.ts';

type Run = (exe: string, args: string[]) => Promise<void>;

/** A model path as the game names it, compiled or not, or null for one that is not a model. */
export function modelFile(model: string): string | null {
  const m = /^(models\/[\w/.-]+?)\.vmdl(_c)?$/i.exec(String(model || '').replace(/\\/g, '/').trim());
  return m && !m[1].includes('..') ? `${m[1].toLowerCase()}.vmdl_c` : null;
}

/** Where the toolchain puts a model's GLB under its output folder: the archive's layout, .glb for .vmdl_c. */
export function glbAt(root: string, file: string): string {
  return path.join(root, ...file.replace(/\.vmdl_c$/, '.glb').split('/'));
}

/** The toolchain's arguments for these models out of this archive into this folder. */
export function exportArgs(pakFile: string, out: string, files: string[], clips: string[]): string[] {
  const args = ['-i', pakFile, '-o', out, '-d', '-f', files.join(','), '--gltf_export_format', 'glb', '--gltf_export_materials'];
  if (clips.length) args.push('--gltf_export_animations', '--gltf_animation_list', clips.join(','));
  return args;
}

/** GLB files of the game's models, made on demand and kept per game build. */
export function createModelGlb({ userDataDir, toolchain, getGamePath, run = runTool, log = () => {} }: {
  userDataDir: string; toolchain: { pathOf: (name: string) => string | null };
  getGamePath: () => string | null; run?: Run; log?: (msg: string) => void;
}) {
  const base = path.join(userDataDir, 'models3d');
  // one export at a time: two at once would both start the program and fight over the disk
  let queue: Promise<unknown> = Promise.resolve();

  /** This build's folder, made empty the first time a build is seen. */
  function buildRoot(game: string): string {
    let stamp = 'unknown';
    try { stamp = gameSchemaStamp(game); } catch { /* unreadable: one folder for all */ }
    const dir = path.join(base, crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 12));
    if (!fs.existsSync(dir)) {
      fs.rmSync(base, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * The GLB of each model, exported if it is not in the cache yet; a model the game lacks, or
   * any model when the toolchain is not downloaded, comes back as null.
   * @param models model paths as items_game names them, "models/heroes/techies/techies.vmdl"
   * @param clips animation clips to keep, for the hero's body; wearables follow its bones
   */
  async function glbs(models: string[], clips: string[] = []): Promise<Record<string, string | null>> {
    const game = getGamePath();
    const exe = toolchain.pathOf('vrf');
    const out: Record<string, string | null> = Object.fromEntries(models.map((m) => [m, null]));
    if (!game || !exe) return out;
    const pakFile = path.join(game, 'dota', 'pak01_dir.vpk');
    // the clips are part of the file: a body with its idle is another cache entry than one without
    const root = path.join(buildRoot(game), clips.length ? `clips-${clips.join('-').replace(/[^\w-]/g, '')}` : 'still');
    const files = new Map(models.map((m) => [m, modelFile(m)]));
    const wanted = [...new Set([...files.values()].filter((f): f is string => !!f && !fs.existsSync(glbAt(root, f))))];
    if (wanted.length) {
      const job = queue.then(async () => {
        const started = Date.now();
        try {
          await run(exe, exportArgs(pakFile, root, wanted, clips));
          log(`models 3d: ${wanted.length} exported in ${Date.now() - started} ms`);
        } catch (err) {
          log(`models 3d: export failed (${(err as Error)?.message || err})`);
        }
      });
      queue = job;
      await job;
    }
    for (const [m, f] of files) if (f && fs.existsSync(glbAt(root, f))) out[m] = glbAt(root, f);
    return out;
  }

  /** Everything exported so far, gone. */
  function clear(): void { fs.rmSync(base, { recursive: true, force: true }); }

  return { glbs, clear };
}
