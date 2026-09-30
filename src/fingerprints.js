// Fingerprint index: fetch + cache the fp -> mod identity map published alongside the
// app, so a foreign vpk sitting in the game folder can be recognised as a specific
// catalog mod (see tools/gen-fingerprints.js). Dormant until the map is hosted.
const fs = require('fs');
const path = require('path');
const { fetchText } = require('./net.ts');

const FP_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/fingerprints.json';

class Fingerprints {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'fingerprints.json');
    this.map = null;   // fp -> [ { name, categoryId, styleLabel } ]
    this.fonts = [];   // [ { name, categoryId, styleLabel, files: { basename: sha1 } } ]
  }

  apply(data) {
    this.map = data.mods || {};
    this.fonts = data.fonts || [];
    return this.map;
  }

  loadCache() {
    try { this.apply(JSON.parse(fs.readFileSync(this.file, 'utf-8'))); } catch { this.map = {}; this.fonts = []; }
    return this.map;
  }

  ensure() {
    if (this.map === null) this.loadCache();
    return this.map;
  }

  // whether we have any data to match against (skip folder scans otherwise)
  hasData() {
    return Object.keys(this.ensure()).length > 0 || this.fonts.length > 0;
  }

  async refresh() {
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
  match(fp) {
    if (!fp) return null;
    const v = this.ensure()[fp];
    if (!v) return null;
    return Array.isArray(v) ? v : [v]; // tolerate the older object-valued format
  }

  // Font mods share panorama\fonts with vanilla files, so they can't be matched by an
  // exact folder fingerprint. Instead: which known font mods have *all* their files
  // present in the folder (by basename + content hash)? -> array of matched entries.
  matchFonts(folderHashes) {
    this.ensure();
    return this.fonts.filter((m) =>
      Object.entries(m.files).every(([name, hash]) => folderHashes[name] === hash));
  }
}

module.exports = { Fingerprints, FP_URL };
