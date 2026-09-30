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
// Two things this file exists to get right:
//   what to show - art that was drawn to be looked at (panorama) beats a model's texture,
//     which is a UV layout and reads as a coloured smear. The two are kept apart as "art" and
//     "texture" so the caller can put the wiki's hero portrait between them;
//   whether it is worth showing at all - a mod that strips a hero's armour ships an *empty*
//     texture. It decodes perfectly and shows nothing, so the decoded pixels are judged
//     before anything is cached.
//
// The picture inside a mod is a compiled Source 2 texture, so this needs the toolchain
// (src/toolchain.ts). Without it nothing here answers and the old fallbacks stand.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import type { NativeImage } from 'electron';
import { readVpkIndexFile, listVpkPathCrcs, readVpkEntryFile } from './vpk.ts';

// electron is asked for only when the real decoder is, so the tests run under plain node
const require = createRequire(import.meta.url);

/** The three kinds of picture a mod can give: drawn art, a model's texture, an animated portrait. */
type Kind = 'art' | 'texture' | 'video';

/** A decoded picture: 4 bytes a pixel, alpha last, and what the decoder needs to resize it. */
export interface Bitmap { width: number; height: number; data: Buffer | Uint8Array; img?: unknown }

/** Decoding and resizing, injected so this module runs under plain node in tests. */
export interface Images { read(file: string): Bitmap | null; toSmallPng(bmp: Bitmap): Buffer }

/** One picture to make: the mod file, the texture inside it, and where the answer is kept. */
type Job = { file: string; inner: string; cache: string; miss: string };

// One call decodes a whole folder, so a batch costs what a single file costs (258 ms for
// five, measured). This caps how much work one screenful can ask for.
const MAX_PER_CALL = 40;
const CALL_TIMEOUT_MS = 60000;
// Rows are 76x47 CSS pixels; 320 leaves room for a denser screen without caching megabytes.
const MAX_SIDE = 320;

/** Sources this module answers for, best first. Anything else is somebody else's key. */
export const VID = 'modvid:';
/** The key prefix for a mod's drawn art. */
export const ART = 'modart:';
/** The key prefix for a model texture out of a mod. */
export const TEX = 'modtex:';

// A mod that replaces a hero's animated portrait carries the best picture of itself there is:
// the author's own showcase of the thing, in motion. Getting a still out of it needs a video
// decoder, and the app is one - Electron carries ffmpeg inside, which is why no copy of it is
// downloaded here. The decoding happens in the window (see renderer/ui/cosmetic-icons.js);
// this file hands over the bytes and judges and keeps what comes back.
const VIDEO_RANKS: [RegExp, number][] = [
  [/^panorama\/videos\/heroes\/[^/]+\.webm$/, 100],
  [/^panorama\/videos\/.+\.webm$/, 80],
];
// What crosses to the window in one piece. The hero portraits measured are 3.3 MB; anything
// far past that is not a portrait and not worth the trip.
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

// What a mod's file is allowed to be called: "pak24_dir.vpk", "maps/dota.vpk". No walking up
// out of the mod folder, no drive letters, no backslashes.
const SAFE_REL = /^[A-Za-z0-9][A-Za-z0-9_.\-]*(\/[A-Za-z0-9][A-Za-z0-9_.\-]*)*$/;

// Pictures drawn to be looked at, best first. The game draws each of these somewhere in its
// own UI, so whatever the mod put there is what the mod wants shown.
const ART_RANKS: [RegExp, number][] = [
  [/^panorama\/images\/heroes\/selection\/[^/]+\.vtex_c$/, 100], // full-body selection art
  [/^panorama\/images\/heroes\/[^/]+\.vtex_c$/, 95],             // the hero's own portrait
  [/^panorama\/images\/loadingscreens\/[^/]+\.vtex_c$/, 90],
  [/^panorama\/images\/econ\/.+\.vtex_c$/, 85],                  // the item's own icon
  [/^panorama\/images\/heroes\/icons\/[^/]+\.vtex_c$/, 60],
  [/^panorama\/images\/spellicons\/[^/]+\.vtex_c$/, 55],         // small, but real art
  [/^panorama\/images\/.+\.vtex_c$/, 70],
];

/**
 * Which file inside a mod to show, for one of the three kinds.
 * Pure, so the ranking can be held by tests against real path lists.
 * @param paths lowercased inner paths of the mod's VPK
 * @param kind  video is a hero's animated portrait, a .webm
 */
export function pickCandidate(paths: Iterable<string>, kind: Kind): string | null {
  let best: string | null = null;
  let bestRank = 0;
  for (const p of paths) {
    if (kind === 'video' ? !p.endsWith('.webm') : !p.endsWith('.vtex_c')) continue;
    const rank = kind === 'video' ? videoRank(p) : kind === 'art' ? artRank(p) : textureRank(p);
    // ties go to the first one seen, so the same mod always yields the same picture
    if (rank > bestRank) { bestRank = rank; best = p; }
  }
  return best;
}

function videoRank(p: string): number {
  for (const [re, rank] of VIDEO_RANKS) if (re.test(p)) return rank;
  return 0;
}

function artRank(p: string): number {
  for (const [re, rank] of ART_RANKS) if (re.test(p)) return rank;
  return 0;
}

// Maps the renderer reads as numbers rather than looks at: a normal map is flat lavender
// noise, a mask is grey shapes. They sit next to the colour texture under the same name and
// win on tree order if nothing stops them, and then the mod looks like a dud (measured: a
// tree mod offered its normal map first and so ended up with no picture at all).
const DATA_MAP = /_(normal|normals|mask|masks|rough|roughness|metal|metalness|ao|spec|specular|gloss|illum|selfillum|detail|flow|noise|ramp|cubemap|height|disp|trans|fresnel|tint|blend|alpha)[_.]/;

function textureRank(p: string): number {
  if (p.startsWith('panorama/')) return 0; // that is art, and art is asked for separately
  if (DATA_MAP.test(p)) return 0;
  // "default_color" and friends are filler the exporter drops in, not the mod's own look
  if (/(^|\/)(default|dev)\//.test(p)) return 5;
  const colour = /_(color|tcolor|diffuse|albedo)[_.]/.test(p);
  if (p.startsWith('materials/models/')) return colour ? 40 : 20;
  return colour ? 30 : 10;
}

/**
 * Is this decoded picture worth showing? A mod that removes something ships a texture that
 * is empty or a single flat colour: it decodes fine and shows nothing.
 * Pure, so tests can hand it pixels without an image library.
 * @param bmp 4 bytes per pixel, alpha last
 */
export function worthShowing({ width, height, data }: Bitmap): boolean {
  if (!width || !height || width < 32 || height < 32) return false;
  const px = width * height;
  if (!data || data.length < px * 4) return false;
  // walk a grid of at most ~4000 samples: enough to catch "empty" and "one flat colour",
  // cheap enough for a 2048x2048 texture
  const step = Math.max(1, Math.floor(Math.sqrt(px / 4000)));
  let seen = 0;
  let visible = 0;
  let min = [255, 255, 255];
  let max = [0, 0, 0];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      seen++;
      if (data[i + 3] <= 16) continue; // transparent: nothing there to look at
      visible++;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
  }
  if (!seen || visible / seen < 0.05) return false;          // all but empty
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) >= 12; // not one flat colour
}

/** The real decoder: Electron's own image support. */
function electronImages(): Images {
  const { nativeImage } = require('electron') as typeof import('electron');
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
 */
export function createModPreviews({ userDataDir, toolchain, langFileOf, images = null, log = () => {} }: {
  userDataDir: string; toolchain: { pathOf: (name: string) => string | null };
  langFileOf: (relPath: string) => string | null; images?: Images | null; log?: (msg: string) => void;
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

  function runCli(exe: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(exe, args, { timeout: CALL_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()));
    });
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
      await runCli(exe, ['-i', tmp, '-o', tmp, '-d', '--recursive']);

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

  function size(): number {
    let bytes = 0;
    try { for (const f of fs.readdirSync(root)) bytes += fs.statSync(path.join(root, f)).size; } catch { /* nothing cached */ }
    return bytes;
  }

  function clear(): void {
    fs.rmSync(root, { recursive: true, force: true });
  }

  return { getMany, hasVideo, videoBytes, saveFrame, ready, size, clear, root, VID, ART, TEX };
}

