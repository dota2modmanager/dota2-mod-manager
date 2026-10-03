/**
 * Terrains that replace the whole map, and whether the game's own map has moved on since.
 *
 * A terrain in the catalog is one of two things. Most are paks that recolour the ground and leave
 * the map alone. The rest, the TI and Dota+ ones among them, are a whole map: they install as
 * <language>\maps\dota.vpk, and the game loads that file instead of its own. Such a map is Valve's
 * as it was on the day it was built, and when Valve changes the map the old copy keeps being
 * served. On 2026-09-23 a player got a map with no trees, a third of the frame rate and
 * matchmaking refused (issue #122), from a Dota+ Autumn built on 19 August over a map Valve had
 * updated on 3 September.
 *
 * Nothing inside a map pack says which build of the map it was made from, so the date its file
 * carries in the archive stands in for it. A terrain built before the game's current map is
 * marked, in the catalog and in My mods, and switched off once when the game's map changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LibFile, LibRecord } from './types.ts';

/** Where a whole-map terrain puts its map, under the language folder. */
const MAP_REL = 'maps/dota.vpk';
const MAP_IN_ARCHIVE = /(^|\/)maps\/dota\.vpk$/i;
/* A zip keeps the local time of whoever packed it, in no named zone, and the game's file carries
   the moment Steam wrote it. A day either way covers every zone there is; a terrain packed the
   same day Valve changed the map is let through rather than marked on a guess. */
const MARGIN_MS = 24 * 60 * 60 * 1000;
/** The end of a zip holds its table of contents. A terrain archive has two or three files, so
 *  the table is a few hundred bytes; this much reaches it even behind a long archive comment. */
export const TAIL_BYTES = 64 * 1024;

/** What is worked out once and kept: the map last acted on, and each catalog terrain by its hash. */
interface Store {
  mapSeen?: number;
  catalog?: Record<string, { hash: string; builtAt: number | null }>;
}

/** A record as far as this module reads it. */
type TerrainRecord = Pick<LibRecord, 'id' | 'name' | 'files' | 'enabled' | 'categoryId' | 'fileRef'> & { mapBuiltAt?: unknown };

/** The record's map file, when the record is a whole-map terrain. */
function mapFileOf(rec: Pick<LibRecord, 'files'> | null | undefined): LibFile | null {
  return (rec && rec.files || []).find((f) => f.root === 'lang' && String(f.relPath).toLowerCase() === MAP_REL) || null;
}

/** When Steam last wrote the game's own map, or null with no game or no map. */
function gameMapTime(gamePath: string | null | undefined): number | null {
  if (!gamePath) return null;
  try { return fs.statSync(path.join(gamePath, 'dota', 'maps', 'dota.vpk')).mtimeMs; } catch { return null; }
}

/** A DOS date and time, as a zip stores them, in milliseconds. */
function fromDos(date: number, time: number): number | null {
  const d = new Date(((date >> 9) & 0x7f) + 1980, Math.max(((date >> 5) & 0x0f) - 1, 0), Math.max(date & 0x1f, 1),
    (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

/**
 * When the map inside a zip was packed, read from the zip's table of contents, which sits at the
 * end: `buf` may be the whole archive or only its last bytes. null when there is no map in it or
 * the bytes are not a zip.
 */
export function mapTimeInZip(buf: unknown): number | null {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  let end = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return null;
  const size = buf.readUInt32LE(end + 12);
  // the table ends where the end record starts, so its start is found from there, which works
  // for the last bytes of an archive as well as for all of it
  let at = end - size;
  if (at < 0) return null;
  while (at + 46 <= end && buf.readUInt32LE(at) === 0x02014b50) {
    const time = buf.readUInt16LE(at + 12);
    const date = buf.readUInt16LE(at + 14);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen).replace(/\\/g, '/');
    if (MAP_IN_ARCHIVE.test(name)) return fromDos(date, time);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The same, for an archive on disk: only its tail is read. */
export function mapTimeInArchive(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size; // the open file, not the path again (js/file-system-race)
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return mapTimeInZip(buf);
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

/** Built for a map older than the one the game has. Unknown either way is not old. */
export function isStale(builtAt: unknown, mapAt: unknown): boolean {
  return typeof builtAt === 'number' && typeof mapAt === 'number' && Number.isFinite(builtAt) && Number.isFinite(mapAt)
    && builtAt < mapAt - MARGIN_MS;
}

/**
 * @param deps.downloadsDir  where downloaded archives are kept, <category>/<file>
 * @param deps.storeFile     a small JSON file of what has been worked out
 * @param deps.fetchTail     the last bytes of a catalog archive, for a terrain nobody has downloaded yet
 */
export function createTerrainAges({ downloadsDir, gamePath, storeFile, fetchTail = async () => null }: {
  downloadsDir?: string;
  gamePath: () => string | null;
  storeFile?: string;
  fetchTail?: (categoryId: string, fileRef: string) => Promise<Buffer | null>;
}) {
  const load = (): Store => { try { return JSON.parse(fs.readFileSync(String(storeFile), 'utf8')); } catch { return {}; } };
  const save = (s: Store) => { if (storeFile) try { fs.writeFileSync(storeFile, JSON.stringify(s, null, 1)); } catch { /* next time */ } };

  /** When a record's map was built: what the record says, or its archive in the download cache. */
  function builtAtOf(rec: TerrainRecord): number | null {
    const map = mapFileOf(rec);
    if (!map) return null;
    if (typeof rec.mapBuiltAt === 'number' && Number.isFinite(rec.mapBuiltAt)) return rec.mapBuiltAt;
    if (!downloadsDir || !rec.fileRef ||/[\\/]/.test(rec.fileRef)) return null;
    return mapTimeInArchive(path.join(downloadsDir, String(rec.categoryId || ''), rec.fileRef));
  }

  /** For each whole-map terrain in the list: when it was built and whether that is too old. */
  function forRecords(records: TerrainRecord[]): Map<string, { builtAt: number | null; stale: boolean }> {
    const mapAt = gameMapTime(gamePath());
    const out = new Map<string, { builtAt: number | null; stale: boolean }>();
    for (const rec of records) {
      if (!mapFileOf(rec)) continue;
      const builtAt = builtAtOf(rec);
      out.set(rec.id, { builtAt, stale: isStale(builtAt, mapAt) });
    }
    return out;
  }

  /**
   * Switch off the whole-map terrains that are older than the game's map, once per map: the
   * first time a map is seen, and again after Valve changes it. Somebody who turns one back on
   * afterwards has been told and chosen, and is left alone until the next map.
   * @returns the names of what was switched off
   */
  function switchOffStale<R extends TerrainRecord>(records: R[], switchOff: (rec: R) => void): string[] {
    const mapAt = gameMapTime(gamePath());
    if (mapAt === null || !Number.isFinite(mapAt)) return [];
    const store = load();
    if (store.mapSeen === mapAt) return [];
    const names: string[] = [];
    for (const rec of records) {
      if (rec.enabled === false || !mapFileOf(rec) || !isStale(builtAtOf(rec), mapAt)) continue;
      switchOff(rec);
      names.push(rec.name);
    }
    save({ ...store, mapSeen: mapAt });
    return names;
  }

  /**
   * When each whole-map terrain in the catalog was built, by file name, and which of them are
   * older than the game's map. Read from the end of each
   * archive over the network, a few kilobytes each, and kept by the archive's published hash, so
   * a terrain is asked about again only when its author replaces it.
   * @param terrains  the catalog's terrains category
   * @param hashOf    the catalog's published sha256 for a file
   */
  async function forCatalog(terrains: ({ file?: string } | null | undefined)[] | null | undefined, hashOf: (file: string) => string | null) {
    const store = load();
    const known = store.catalog || {};
    const ages: Record<string, number | null> = {};
    let changed = false;
    for (const m of terrains || []) {
      const file = m?.file || '';
      if (!/\.zip$/i.test(file)) continue;
      const hash = hashOf(file) || `name:${file}`;
      if (known[file] && known[file].hash === hash) { ages[file] = known[file].builtAt; continue; }
      let builtAt: number | null = null;
      try { builtAt = mapTimeInZip(await fetchTail('terrains', file)); } catch { /* unknown is not old */ }
      // an archive with no map in it is remembered as such, and not asked about again
      known[file] = { hash, builtAt };
      ages[file] = builtAt;
      changed = true;
    }
    if (changed) save({ ...load(), catalog: known });
    const mapAt = gameMapTime(gamePath());
    const stale: Record<string, boolean> = {};
    for (const [file, builtAt] of Object.entries(ages)) if (isStale(builtAt, mapAt)) stale[file] = true;
    return { mapAt, ages, stale };
  }

  return { builtAtOf, forRecords, switchOffStale, forCatalog };
}

