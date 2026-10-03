// A picture for a mod that came with none, taken out of the mod itself.
//
// The catalog ships a preview for every mod it lists. A mod the user dragged in, or one that
// was simply lying in the game folder, has nothing - the row showed an empty box, or the wiki
// portrait of the hero it changes, which is a picture of the *vanilla* hero and so quietly
// lies about what is installed.
//
// Almost every mod carries its own picture though: authors put the hero's portrait, the
// selection art, spell and item icons into the archive, because the game draws those from
// there. Measured over 96 real mods (2026-08-07): 50 of them can be given a picture this way,
// and the 46 that cannot are packs of particles, sounds and bare models - there is genuinely
// nothing to show.
//
// Which file to show and whether it is worth showing are src/mod-preview-pick.ts.
//
// The picture inside a mod is a compiled Source 2 texture, so this needs the toolchain
// (src/toolchain.ts). Without it nothing here answers and the old fallbacks stand.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { NativeImage } from 'electron';
import { electron } from './electron.ts';
import { runTool } from './toolchain.ts';
import { folderSize } from './folder-size.ts';
import { readVpkIndexFile, listVpkPathCrcs, readVpkEntryFile } from './vpk.ts';
import { pickCandidate, worthShowing, type Bitmap, type Kind } from './mod-preview-pick.ts';

/** Decoding and resizing, injected so this module runs under plain node in tests. */
export interface Images { read(file: string): Bitmap | null; toSmallPng(bmp: Bitmap): Buffer }

/** One picture to make: the mod file, the texture inside it, and where the answer is kept. */
type Job = { file: string; inner: string; cache: string; miss: string };

// One call decodes a whole folder, so a batch costs what a single file costs (258 ms for
// five, measured). This caps how much work one screenful can ask for.
const MAX_PER_CALL = 40;
// Rows are 76x47 CSS pixels; 320 leaves room for a denser screen without caching megabytes.
const MAX_SIDE = 320;

/** Sources this module answers for, best first. Anything else is somebody else's key. */
export const VID = 'modvid:';
/** The key prefix for a mod's drawn art. */
export const ART = 'modart:';
/** The key prefix for a model texture out of a mod. */
export const TEX = 'modtex:';

// What crosses to the window in one piece. The hero portraits measured are 3.3 MB; anything
// far past that is not a portrait and not worth the trip.
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

// What a mod's file is allowed to be called: "pak24_dir.vpk", "maps/dota.vpk". No walking up
// out of the mod folder, no drive letters, no backslashes.
const SAFE_REL = /^[A-Za-z0-9][A-Za-z0-9_.\-]*(\/[A-Za-z0-9][A-Za-z0-9_.\-]*)*$/;

/** The real decoder: Electron's own image support. */
function electronImages(): Images {
  // asked for only when the real decoder is, so the tests run under plain node
  const { nativeImage } = electron();
  return {
    read(file) {
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      // nativeImage hands back BGRA; only channel order differs and nothing here cares
      return { width, height, data: img.toBitmap(), img };
    },
    toSmallPng(bmp) {
      const { width, height } = bmp;
      const img = bmp.img as NativeImage;
      const long = Math.max(width, height);
      const small = long > MAX_SIDE
        ? img.resize({ width: Math.round(width * MAX_SIDE / long), height: Math.round(height * MAX_SIDE / long), quality: 'better' })
        : img;
      return small.toPNG();
    },
  };
}

/**
 * Pictures for mods that came with none, cached in userData.
 * @param deps.langFileOf where a mod's *_dir.vpk actually is
 * @param deps.images test seam for decode/resize
 * @param deps.run test seam for the texture tool, which is somebody else's program
 */
export function createModPreviews({ userDataDir, toolchain, langFileOf, images = null, run = runTool, log = () => {} }: {
  userDataDir: string; toolchain: { pathOf: (name: string) => string | null };
  langFileOf: (relPath: string) => string | null; images?: Images | null;
  run?: (exe: string, args: string[]) => Promise<void>; log?: (msg: string) => void;
}) {
  const root = path.join(userDataDir, 'icons', 'mods');
  const img = images || electronImages();

  const ready = () => !!toolchain.pathOf('vrf');

  /** Does this key belong to us, and if so which mod and which kind of picture? */
  function parseKey(key: unknown): { kind: Kind; relPath: string } | null {
    if (typeof key !== 'string') return null;
    if (key.startsWith(VID)) return { kind: 'video', relPath: key.slice(VID.length) };
    if (key.startsWith(ART)) return { kind: 'art', relPath: key.slice(ART.length) };
    if (key.startsWith(TEX)) return { kind: 'texture', relPath: key.slice(TEX.length) };
    return null;
  }

  /**
   * What this mod would show, and under what name it is cached. The CRC comes free with the
   * index, and keying the cache on it means a mod moved to another pak slot keeps its
   * picture instead of being decoded again.
   */
  function candidateFor({ kind, relPath }: { kind: Kind; relPath: string }): Job | null {
    // A key names a file in the mod folder and nothing else. Nothing but this window's own
    // code builds these, but a key is still a string that turns into a path, and a string
    // that turns into a path gets checked.
    if (!SAFE_REL.test(relPath)) return null;
    let file: string | null;
    try { file = langFileOf(relPath); } catch { return null; }
    if (!file || !fs.existsSync(file)) return null;
    let crcs: Map<string, number>;
    try { crcs = listVpkPathCrcs(readVpkIndexFile(file)); } catch { return null; }
    const inner = pickCandidate(crcs.keys(), kind);
    if (!inner) return null;
    const stamp = crypto.createHash('sha1').update(`${inner}:${crcs.get(inner)}`).digest('hex').slice(0, 16);
    return { file, inner, cache: path.join(root, `${stamp}.png`), miss: path.join(root, `${stamp}.none`) };
  }

  /**
   * Decode these candidates into the cache. One temp folder, one call: the tool takes a
   * folder with --recursive, so a batch costs what one file costs.
   */
  async function decodeInto(jobs: Job[]): Promise<void> {
    const exe = toolchain.pathOf('vrf');
    if (!exe || !jobs.length) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-preview-'));
    try {
      const staged: (Job & { stem: string })[] = [];
      for (const job of jobs) {
        let entry;
        try { entry = readVpkEntryFile(job.file, job.inner); } catch (err) {
          log(`mod preview: ${job.inner} not readable (${(err as Error)?.message || err})`);
          continue;
        }
        if (!entry || !entry.data || !entry.data.length) continue;
        const stem = String(staged.length);
        fs.writeFileSync(path.join(tmp, `${stem}.vtex_c`), entry.data);
        staged.push({ ...job, stem });
      }
      if (!staged.length) return;
      await run(exe, ['-i', tmp, '-o', tmp, '-d', '--recursive']);

      fs.mkdirSync(root, { recursive: true });
      for (const job of staged) {
        const produced = path.join(tmp, `${job.stem}.png`);
        if (!fs.existsSync(produced)) { fs.writeFileSync(job.miss, ''); continue; }
        let bmp: Bitmap | null = null;
        try { bmp = img.read(produced); } catch { /* unreadable: treated as nothing to show */ }
        if (!bmp || !worthShowing(bmp)) {
          // remembered, so a mod whose only texture is empty is not decoded again every
          // time its row scrolls past
          fs.writeFileSync(job.miss, '');
          continue;
        }
        fs.writeFileSync(job.cache, img.toSmallPng(bmp));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const dataUri = (file: string) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

  /**
   * Pictures for these keys, as data URIs. Keys that are not ours, mods with nothing to
   * show, and everything at all doubtful come back missing - the caller then falls through
   * to whatever it used before.
   * @param keys "modart:pak54_dir.vpk" / "modtex:pak54_dir.vpk"
   */
  async function getMany(keys: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};

    const todo = new Map<string, Job>(); // cache path -> job (two keys can want the same picture)
    const asking = new Map<string, string[]>(); // cache path -> keys waiting on it
    for (const key of keys) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const job = candidateFor(parsed);
      if (!job) continue;
      if (fs.existsSync(job.cache)) { out[key] = dataUri(job.cache); continue; }
      if (fs.existsSync(job.miss)) continue; // already looked, there was nothing
      // a still out of a video is made in the window, not here: the caller comes back for
      // the bytes and hands the frame over (see videoBytes / saveFrame)
      if (parsed.kind === 'video') continue;
      if (!ready()) continue; // the rest needs the toolchain, and it is not here
      if (!todo.has(job.cache)) { todo.set(job.cache, job); asking.set(job.cache, []); }
      asking.get(job.cache)?.push(key);
    }
    if (!todo.size) return out;

    const jobs = [...todo.values()];
    for (let i = 0; i < jobs.length; i += MAX_PER_CALL) {
      try {
        await decodeInto(jobs.slice(i, i + MAX_PER_CALL));
      } catch (err) {
        log(`mod preview: extraction failed (${(err as Error)?.message || err})`);
        break; // the old fallbacks answer for the rest
      }
    }
    for (const [cache, keysWaiting] of asking) {
      if (!fs.existsSync(cache)) continue;
      const uri = dataUri(cache);
      for (const key of keysWaiting) out[key] = uri;
    }
    return out;
  }

  /**
   * Is there a clip here whose frame has not been taken yet? Asked for a whole screenful at
   * once, so it only reads indexes - the bytes come later, and only for these.
   */
  function hasVideo(key: string): boolean {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== 'video') return false;
    const job = candidateFor(parsed);
    return !!job && !fs.existsSync(job.cache) && !fs.existsSync(job.miss);
  }

  /**
   * The mod's own video, for the window to take a frame out of. Only ever asked for once
   * per mod: whatever comes back from saveFrame settles the question for good.
   */
  function videoBytes(key: string): { bytes: Buffer } | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== 'video') return null;
    const job = candidateFor(parsed);
    if (!job || fs.existsSync(job.cache) || fs.existsSync(job.miss)) return null;
    let entry;
    try { entry = readVpkEntryFile(job.file, job.inner); } catch (err) {
      log(`mod preview: ${job.inner} not readable (${(err as Error)?.message || err})`);
      return null;
    }
    if (!entry || !entry.data || !entry.data.length) return null;
    if (entry.data.length > MAX_VIDEO_BYTES) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(job.miss, '');
      return null;
    }
    return { bytes: entry.data };
  }

  /**
   * Keep the frame the window decoded - if it is worth keeping. The same judgement the
   * decoded textures go through, in the same place: a portrait that opens on a fade from
   * black is a black square, and a black square is not a picture of anything.
   * @returns the picture, or null if it was not worth keeping
   */
  function saveFrame(key: string, png: Buffer | null | undefined): string | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== 'video' || !png || !png.length) return null;
    const job = candidateFor(parsed);
    if (!job) return null;
    fs.mkdirSync(root, { recursive: true });
    const tmp = path.join(root, `${path.basename(job.cache, '.png')}.frame`);
    try {
      fs.writeFileSync(tmp, png);
      let bmp: Bitmap | null = null;
      try { bmp = img.read(tmp); } catch { /* unreadable: nothing to show */ }
      if (!bmp || !worthShowing(bmp)) { fs.writeFileSync(job.miss, ''); return null; }
      fs.writeFileSync(job.cache, img.toSmallPng(bmp));
      return dataUri(job.cache);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  const size = (): number => folderSize(root);

  function clear(): void {
    fs.rmSync(root, { recursive: true, force: true });
  }

  return { getMany, hasVideo, videoBytes, saveFrame, ready, size, clear, root, VID, ART, TEX };
}

export { pickCandidate, worthShowing } from './mod-preview-pick.ts';
export type { Bitmap, Kind } from './mod-preview-pick.ts';
