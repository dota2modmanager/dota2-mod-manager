// Fingerprint index: fetch + cache the fp -> mod identity map published alongside the
// app, so a foreign vpk sitting in the game folder can be recognised as a specific
// catalog mod (see tools/gen-fingerprints.js). Dormant until the map is hosted.
import fs from 'node:fs';
import path from 'node:path';
import { fetchText } from './net.ts';

/** Where the fingerprint map is published, next to the app's own source. */
export const FP_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/fingerprints.json';

/** A catalog mod a fingerprint points at. */
export interface CatalogIdentity { name: string; categoryId: string; styleLabel?: string | null }

/** A font mod, known by the hash of every file it puts in panorama/fonts. */
export interface FontMod extends CatalogIdentity { files: Record<string, string> }

/** What fingerprints.json holds: the older files carry one identity per print instead of a list. */
interface FingerprintData { mods?: Record<string, CatalogIdentity | CatalogIdentity[]>; fonts?: FontMod[] }

/** The fingerprint map, cached in userData: tells which catalog mod a VPK is from the hash of its
 * content, and which font mod a set of font files is. */
export class Fingerprints {
  file: string;
  /** fingerprint -> the catalog mods that file is; null until read */
  map: Record<string, CatalogIdentity | CatalogIdentity[]> | null;
  fonts: FontMod[];

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'fingerprints.json');
    this.map = null;
    this.fonts = [];
  }

  apply(data: FingerprintData): Record<string, CatalogIdentity | CatalogIdentity[]> {
    this.map = data.mods || {};
    this.fonts = data.fonts || [];
    return this.map;
  }

  loadCache(): Record<string, CatalogIdentity | CatalogIdentity[]> | null {
    try { this.apply(JSON.parse(fs.readFileSync(this.file, 'utf-8'))); } catch { this.map = {}; this.fonts = []; }
    return this.map;
  }

  ensure(): Record<string, CatalogIdentity | CatalogIdentity[]> {
    if (this.map === null) this.loadCache();
    return this.map || {};
  }

  // whether we have any data to match against (skip folder scans otherwise)
  hasData(): boolean {
    return Object.keys(this.ensure()).length > 0 || this.fonts.length > 0;
  }

  async refresh(): Promise<Record<string, CatalogIdentity | CatalogIdentity[]> | null> {
    try {
      const text = await fetchText(FP_URL);
      this.apply(JSON.parse(text)); // validate before persisting
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, text);
    } catch {
      // no hosted map yet, or offline — keep whatever cache we have
      this.ensure();
    }
    return this.map;
  }

  // -> array of matching catalog identities (a fingerprint can map to several entries
  // that share the same file, e.g. GLaDOS + Ru GLaDOS), or null when unknown.
  match(fp: string | null | undefined): CatalogIdentity[] | null {
    if (!fp) return null;
    const v = this.ensure()[fp];
    if (!v) return null;
    return Array.isArray(v) ? v : [v]; // tolerate the older object-valued format
  }

  // Font mods share panorama\fonts with vanilla files, so they can't be matched by an
  // exact folder fingerprint. Instead: which known font mods have *all* their files
  // present in the folder (by basename + content hash)? -> array of matched entries.
  matchFonts(folderHashes: Record<string, string | undefined>): FontMod[] {
    this.ensure();
    return this.fonts.filter((m) =>
      Object.entries(m.files).every(([name, hash]) => folderHashes[name] === hash));
  }
}

