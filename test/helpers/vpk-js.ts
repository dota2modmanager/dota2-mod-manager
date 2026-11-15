// A VPK read in plain JavaScript, for the tests that pick their inputs out of the game's paks: the
// index, the paths and one file's bytes, as crates/mm-core/src/formats/vpk.rs reads them. Writing
// one is mm-cli's (`vpk-build`).
import fs from 'node:fs';
import zlib from 'node:zlib';

export type Entry = { ext: string; folder: string; name: string; crc: number; preload: Buffer; archive: number; offset: number; length: number };

/** folder/name.ext, where " " stands for no folder or no extension. */
export const joinPath = (folder: string, name: string, ext: string) =>
  `${folder === ' ' || folder === '' ? '' : `${folder}/`}${name}${ext === ' ' || ext === '' ? '' : `.${ext}`}`;

export const entryPath = (e: { folder: string; name: string; ext: string }) => joinPath(e.folder, e.name, e.ext);

/** Every entry of a _dir.vpk in the order its tree keeps them, and where its own data starts. */
export function readTree(buf: Buffer): { entries: Map<string, Entry>; dataAt: number } {
  if (buf.readUInt32LE(0) !== 0x55aa1234) throw new Error('not a VPK');
  const headerSize = buf.readUInt32LE(4) === 1 ? 12 : 28;
  const treeEnd = headerSize + buf.readUInt32LE(8);
  const entries = new Map<string, Entry>();
  let i = headerSize;
  const cstr = () => { const e = buf.indexOf(0, i); const s = buf.toString('latin1', i, e); i = e + 1; return s; };
  for (;;) {
    const ext = cstr();
    if (!ext) break;
    for (;;) {
      const folder = cstr();
      if (!folder) break;
      for (;;) {
        const name = cstr();
        if (!name) break;
        const crc = buf.readUInt32LE(i);
        const preloadLen = buf.readUInt16LE(i + 4);
        const archive = buf.readUInt16LE(i + 6);
        const offset = buf.readUInt32LE(i + 8);
        const length = buf.readUInt32LE(i + 12);
        i += 18;
        const preload = buf.subarray(i, i + preloadLen);
        i += preloadLen;
        entries.set(joinPath(folder, name, ext), { ext, folder, name, crc, preload, archive, offset, length });
      }
    }
  }
  return { entries, dataAt: treeEnd };
}

export type Index = { file: string; size: number; has(p: string): boolean; paths(): IterableIterator<string>; read(p: string): Buffer | null; crc(p: string): number | undefined; toJSON(): string };

const opened = new Map<string, Index>();
/** A _dir.vpk's index; given to Rust it is the pak's path. */
export function openIndex(file: string): Index {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const was = opened.get(key);
  if (was) return was;
  const buf = fs.readFileSync(file);
  const { entries, dataAt } = readTree(buf);
  const base = file.replace(/_dir\.vpk$/i, '');
  const archives = new Map<number, number>();
  const archive = (n: number) => {
    if (!archives.has(n)) archives.set(n, fs.openSync(`${base}_${String(n).padStart(3, '0')}.vpk`, 'r'));
    return archives.get(n)!;
  };
  const index: Index = {
    file,
    size: entries.size,
    has: (p) => entries.has(String(p).toLowerCase()),
    paths: () => entries.keys(),
    crc: (p) => entries.get(String(p).toLowerCase())?.crc,
    read(p) {
      const e = entries.get(String(p).toLowerCase());
      if (!e) return null;
      if (!e.length) return Buffer.from(e.preload);
      let data: Buffer;
      if (e.archive === 0x7fff) data = buf.subarray(dataAt + e.offset, dataAt + e.offset + e.length);
      else { data = Buffer.alloc(e.length); fs.readSync(archive(e.archive), data, 0, e.length, e.offset); }
      return Buffer.concat([e.preload, data]);
    },
    toJSON: () => file,
  };
  opened.set(key, index);
  return index;
}

export const crc32 = (b: Buffer) => zlib.crc32(b) >>> 0;
