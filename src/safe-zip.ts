// The one door every foreign archive comes through.
//
// Nothing the app opens as a zip is its own: mods, cursors, fonts and tools come down from
// the catalog's CDN, .d2mm presets travel between strangers over Discord, and the user can
// drop any file on the window. A zip describes itself in its own headers, so a hostile one
// can claim whatever it likes about what is inside — and until adm-zip 0.6.0 the library
// believed the claim, allocating the declared uncompressed size before reading a byte
// (GHSA-xcpc-8h2w-3j85: a few-KB file declares 4 GB and the app dies). That allocation is
// gone upstream, but a genuine bomb — 4 MB that honestly unpack to 4 GB — still unpacks,
// and an entry can still be named "../../../Windows/System32/x.dll". Both are stopped here.
//
// Callers get a flat list of files with forward-slash paths, already stripped of anything
// that could escape a folder, and write through safeJoin so a name can never resolve
// outside the folder it was meant for.
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { t } from './i18n.ts';
import type { Writer } from './file-tx.ts';

/** A file inside an archive that passed every check: its path, its size, and its bytes on demand. */
interface ZipFile { path: string; size: number; read(): Buffer }

/** A foreign archive, opened: what is safe to hand out of it, and a way to unpack it. */
export interface OpenedZip {
  label: string;
  files: ZipFile[];
  get(rel: string): ZipFile | null;
  extractTo(destRoot: string, tx?: Writer): number;
}

/** The budgets an archive is held to; tests lower them. */
type ZipLimits = typeof LIMITS;

const MB = 1024 * 1024;

// Measured against the 104 real archives on disk (catalog mods, fonts, cursors, packs),
// not guessed: the heaviest zip is 64 MB, the largest single entry unpacks to 301 MB, the
// fullest archive holds 111 files, and the tightest compression is 80x (cursor bitmaps).
// Every limit sits several times above that, so a legitimate archive never meets one.
// The ratio is only judged on entries big enough to matter — a 20 KB text file that packs
// 500x is not a threat, and small assets compress hard all the time.
const LIMITS = {
  archiveBytes: 1024 * MB,   // adm-zip reads the whole file into memory before parsing
  entries: 20000,
  entryBytes: 768 * MB,
  totalBytes: 2048 * MB,
  ratio: 200,
  ratioFloor: 1 * MB,
};

const toPosix = (name: unknown): string => String(name).replace(/\\/g, '/');

// Marked so a caller that turns "could not read this file" into its own wording can still
// let a refusal through with its reason intact.
function refuse(message: string): Error & { safeZip?: boolean } {
  const err: Error & { safeZip?: boolean } = new Error(message);
  err.safeZip = true;
  return err;
}

/* Names Windows will not create by itself: a component that ends in a dot or a space, and the
 * reserved device names, with or without an extension. Node writes them anyway, so an archive
 * could leave "...", ".. " or "CON" behind as files Explorer can neither open nor delete; a probe
 * on NTFS on 2026-09-16 did exactly that, in a folder that for fonts and cursors is the game's.
 * "." on its own is left alone: it is the folder itself, and some packers write "./name". None of
 * the 415 names in 147 real archives on the maintainer's machine is refused by this. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
const windowsRefuses = (part: string): boolean => part !== '.' && (/[. ]$/.test(part) || RESERVED.test(part));

// An entry name is data, not a path we agreed to. Absolute names, drive letters, any ".."
// segment and any segment Windows refuses are dropped before a caller ever sees them.
export function isUnsafeName(rel: string): boolean {
  if (!rel || rel.startsWith('/')) return true;
  if (/^[a-z]:/i.test(rel)) return true;
  return rel.split('/').some((part) => part === '..' || windowsRefuses(part));
}

/**
 * Join a path that came out of an archive to the folder it belongs in, refusing anything
 * that resolves outside. Second lock after isUnsafeName: the first decides what to hand
 * over, this one guards the actual write.
 */
export function safeJoin(rootAbs: string, rel: string): string {
  const root = path.resolve(rootAbs);
  const dest = path.resolve(root, rel);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw refuse(t('Недопустимый путь в архиве: {0}', rel));
  }
  return dest;
}

/**
 * Open a foreign archive with every claim in it checked first.
 * @param source        path on disk, or the bytes themselves
 * @param opts.label    what to call the archive in an error the user reads
 * @param opts.limits   override the budgets (tests)
 */
export function openZip(source: string | Buffer, { label, limits }: { label?: string; limits?: Partial<ZipLimits> } = {}): OpenedZip {
  const lim = { ...LIMITS, ...(limits || {}) };
  const name = label || (typeof source === 'string' ? path.basename(source) : t('архив'));
  const tooBig = () => refuse(t('{0}: архив слишком большой', name));

  if (typeof source === 'string') {
    if (fs.statSync(source).size > lim.archiveBytes) throw tooBig();
  } else if (source.length > lim.archiveBytes) {
    throw tooBig();
  }

  /* A damaged archive is a refusal like any other. Left alone, adm-zip explains it in its own
   * words ("ADM-ZIP: Invalid or unsupported zip format. No END header found"), in English
   * whatever language the window is in, and zlib now and then as a RangeError. Measured on
   * 2026-09-16: of 5000 damaged archives, 23 came out as this project's refusal and the rest as
   * those. test/safe-zip-fuzz.test.js holds the line. */
  const damaged = (inside?: string) => refuse(inside
    ? t('{0}: файл {1} в архиве повреждён', name, inside)
    : t('{0}: архив повреждён или не докачан', name));
  let all: AdmZip.IZipEntry[];
  try {
    all = new AdmZip(source).getEntries();
  } catch {
    throw damaged();
  }
  if (all.length > lim.entries) throw refuse(t('{0}: в архиве слишком много файлов', name));

  let total = 0;
  const files: ZipFile[] = [];
  for (const entry of all) {
    if (entry.isDirectory) continue;
    const size = entry.header.size;
    const packed = entry.header.compressedSize;
    if (size > lim.entryBytes) throw refuse(t('{0}: файл в архиве слишком большой', name));
    total += size;
    if (total > lim.totalBytes) throw refuse(t('{0}: архив распакуется в слишком большой объём', name));
    if (size >= lim.ratioFloor && packed > 0 && size / packed > lim.ratio) {
      throw refuse(t('{0}: архив сжат подозрительно плотно', name));
    }
    const rel = toPosix(entry.entryName);
    if (isUnsafeName(rel)) continue; // never handed out, so it can never be written
    files.push({
      path: rel,
      size,
      read() {
        // the checksum and the inflate both happen here, so a damaged file surfaces here too
        try { return entry.getData(); } catch { throw damaged(rel); }
      },
    });
  }

  return {
    label: name,
    files,
    get(rel: string) {
      const wanted = toPosix(rel);
      return files.find((f) => f.path === wanted) || null;
    },
    // Unpack everything, keeping the archive's own layout under destRoot. With a FileTx the
    // whole unpack is one change: a tool that fails on its last file leaves nothing behind.
    extractTo(destRoot: string, tx: Writer = null) {
      for (const file of files) {
        const dest = safeJoin(destRoot, file.path);
        if (tx) { tx.write(dest, file.read()); continue; }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.read());
      }
      return files.length;
    },
  };
}

