// Fingerprint index: fetch + cache the fp -> mod identity map published alongside the
// app, so a foreign vpk sitting in the game folder can be recognised as a specific
// catalog mod (see tools/gen-fingerprints.js). Dormant until the map is hosted.
import fs from 'node:fs';
import path from 'node:path';
import { fetchText } from './net.ts';

/**
 * Where the fingerprint map is published: the catalog-data branch the catalog job commits to.
 * Copies before 2.8.0 read it from main, where the job keeps writing it until they have updated
 * (DECISIONS.md, "The catalog job commits to a branch of its own").
 */
export const FP_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/catalog-data/fingerprints.json';

/** A catalog mod a fingerprint points at. */
export interface CatalogIdentity { name: string; categoryId: string; styleLabel?: string | null }

/** A font mod, known by the hash of every file it puts in panorama/fonts. */
interface FontMod extends CatalogIdentity { files: Record<string, string> }

/** What fingerprints.json holds: the older files carry one identity per print instead of a list. */
interface FingerprintData { mods?: Record<string, CatalogIdentity | CatalogIdentity[]>; fonts?: FontMod[] }

/** The fingerprint map, cached in userData: tells which catalog mod a VPK is from the hash of its
 * content, and which font mod a set of font files is. */
export class Fingerprints {
  file: string;
  /** fingerprint -> the catalog mods that file is; null until read */
  map: Record<string, CatalogIdentity | CatalogIdentity[]> | null;
  fonts: FontMod[];
  /** the map turned round: a catalog mod -> its fingerprints; built when first asked */
  byMod: Map<string, Set<string>> | null;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'fingerprints.json');
    this.map = null;
    this.fonts = [];
    this.byMod = null;
  }

  apply(data: FingerprintData): Record<string, CatalogIdentity | CatalogIdentity[]> {
    this.map = data.mods || {};
    this.byMod = null;
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

  /**
   * The fingerprints a catalog mod's file has today, or null when the index does not know the mod.
   * Several, when the catalog keeps one name over a few files. src/mod-update.ts holds an installed
   * mod against this to tell that its author replaced the archive.
   */
  printsOf(id: CatalogIdentity): Set<string> | null {
    const key = (x: CatalogIdentity) => `${x.categoryId}\u0000${x.name}\u0000${x.styleLabel || ''}`;
    if (!this.byMod) {
      this.byMod = new Map();
      for (const [fp, v] of Object.entries(this.ensure())) {
        for (const x of (Array.isArray(v) ? v : [v])) {
          const k = key(x);
          if (!this.byMod.has(k)) this.byMod.set(k, new Set());
          this.byMod.get(k)!.add(fp);
        }
      }
    }
    return this.byMod.get(key(id)) || null;
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

