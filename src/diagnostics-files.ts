// What a support report reads off the disk: a folder's listing (names, sizes, dates, never the
// bytes) and the last part of a log. The user's home folder is written as ~ or %USERPROFILE%, so
// a report says where a file is without saying whose machine it came from.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** One row of a folder listing: its shape, never its bytes. */
type Listed = { name: string; size: number; mtime: number; dir: boolean };

// Nothing about a folder listing that matters for troubleshooting needs the file's bytes,
// only its shape - names, sizes, when they last changed.
function listFolder(dir: string): Listed[] | null {
  try {
    return fs.readdirSync(dir).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null; // missing or unreadable folder is itself worth knowing
  }
}

/** A folder with the home directory written as ~ (or %USERPROFILE% on Windows). */
export function redactHome<T extends string | null | undefined>(dir: T, home: string = os.homedir()): T | string {
  if (!dir || !home) return dir;

  const compareDir = process.platform === 'win32' ? dir.toLowerCase() : dir;
  const compareHome = process.platform === 'win32' ? home.toLowerCase() : home;

  if (compareDir !== compareHome && !compareDir.startsWith(`${compareHome}${path.sep}`)) {
    return dir;
  }

  return process.platform === 'win32'
    ? `%USERPROFILE%${dir.slice(home.length)}`
    : `~${dir.slice(home.length)}`;
}

/** A folder's listing as the text file the report carries. */
export function folderListingText(dir: string, filter?: ((f: Listed) => boolean) | null, home?: string): string {
  const list = listFolder(dir);
  if (!list) return `${redactHome(dir, home)}\n(not found or unreadable)`;
  const rows = filter ? list.filter(filter) : list;
  const lines = rows.map((f) =>
    `${f.dir ? 'DIR ' : '    '}${String(f.size).padStart(10)}  ${new Date(f.mtime).toISOString()}  ${f.name}`);
  return `${redactHome(dir, home)}\n\n${lines.join('\n') || '(empty)'}`;
}

// The last chunk of a log file - a support conversation is almost always about what just
// happened, not the file's whole history.
/** The last `maxBytes` of a log file, or null when it cannot be read. */
export function tailLog(file: string, maxBytes: number): string | null {
  // The size comes from the open file rather than from a look before opening it, so a log that
  // grows or is replaced in between cannot hand over a length that is not this file's.
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8');
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
