// Catalog: fetch + cache mods.json / constants.json / guides.json from the Dota2PornFx repo
const fs = require('fs');
const path = require('path');
const { fetchText } = require('./net.ts');
const signature = require('./catalog-signature.ts');

const RAW_BASE = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main';
const DATA_FILES = ['mods.json', 'constants.json', 'guides.json'];

/* The published sha256 of every archive in the catalog, signed like the data.
 *
 * Deliberately not one of DATA_FILES. Those are the files the app cannot start without, and
 * this one it has never had: until 2026-09-09 an archive was trusted on first sight and
 * checked against that first copy afterwards, which catches a substitution on every download
 * except the one that matters. So it is fetched beside them and a failure costs the old
 * behaviour rather than the catalog.
 */
const HASH_FILE = 'mod-hashes.json';

/** The site's own copy, which goes out in one deploy and so is never half-updated. */
const SNAPSHOT_BASE = 'https://dota2modmanager.com/mirror/';

// Walk every mod in a mods.json, whatever shape its category is in: a plain array, or a
// group list for the categories that are sorted by hero.
function eachMod(modsData, fn) {
  for (const category of Object.values(modsData || {})) {
    if (!category) continue;
    const lists = Array.isArray(category)
      ? [category]
      : Array.isArray(category.groups)
        ? category.groups.map((g) => g.mods || [])
        : [category.mods || []];
    for (const list of lists) {
      for (const mod of list) if (mod && typeof mod === 'object') fn(mod);
    }
  }
}

/**
 * The catalog describes a mod's links two ways: a `links` array, and an older pair of fields
 * on the mod itself. 32 mods still carry the old pair and 26 of those are previews - the
 * whole TI battle-pass row - so a reader that knows only the array shows them with no
 * preview at all. The site reads both; folding one into the other here means the rest of the
 * app only ever sees the array. The cache on disk keeps whatever the author wrote.
 */
function normalizeCatalog(mods) {
  eachMod(mods && mods.modsData, (mod) => {
    if (!mod.linkType || !mod.linkUrl) return;
    const link = { type: mod.linkType, url: mod.linkUrl };
    if (mod.senderName) link.name = mod.senderName;
    if (!Array.isArray(mod.links)) mod.links = [link];
    else if (!mod.links.some((l) => l.type === link.type && l.url === link.url)) mod.links.push(link);
  });
  return mods;
}

class Catalog {
  /**
   * @param {string} userDataDir
   * @param {object} [opts]
   * @param {string} [opts.snapshotBase]  where to look for a data-and-signature pair that is
   *   guaranteed to be from one moment; the site's own copy unless a test says otherwise
   * @param {string} [opts.publicKey]  the key the catalog is signed with; the pinned one unless a
   *   test signs its own catalog
   */
  constructor(userDataDir, { snapshotBase = SNAPSHOT_BASE, publicKey = signature.CATALOG_PUBLIC_KEY } = {}) {
    this.cacheDir = path.join(userDataDir, 'catalog-cache');
    this.snapshotBase = snapshotBase;
    this.publicKey = publicKey;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  cachePath(name) {
    return path.join(this.cacheDir, name);
  }

  cacheInfo() {
    const metaFile = this.cachePath('meta.json');
    try {
      return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    } catch {
      return { fetchedAt: null };
    }
  }

  hasCache() {
    return DATA_FILES.every((f) => fs.existsSync(this.cachePath(f)));
  }

  /** Fetches one published file and, when a key is pinned, refuses bytes it did not sign. */
  /**
   * Fetches one published file and, when a key is pinned, refuses bytes it did not sign.
   *
   * The signatures sit in a folder of their own rather than beside the data. They were
   * published as assets/data/<name>.sig on 2026-09-09 and moved to assets/signatures/ the same
   * day, which is why this is built from a path and not from a suffix glued onto the data URL:
   * a layout that has already moved once can move again.
   */
  async fetchSigned(name) {
    const dataUrl = `${RAW_BASE}/assets/data/${name}`;
    const sigUrl = `${RAW_BASE}/${signature.SIG_DIR}/${name}${signature.SIG_SUFFIX}`;
    const text = await fetchText(dataUrl);
    if (!signature.configured(this.publicKey)) {
      JSON.parse(text);
      return text;
    }

    const sig = await fetchText(sigUrl);
    if (signature.verify(text, sig, this.publicKey)) {
      JSON.parse(text); // validate before persisting
      return text;
    }

    /* A pair that does not verify is usually not an attack. It is the two files arriving from
     * different moments in time.
     *
     * The catalog writes a data file and its signature in one commit, so the repository is
     * never inconsistent. raw.githubusercontent is: it caches per file and purges per file,
     * and on 2026-09-10 it served this project its own config from one commit and that
     * config's signature from the one before, for minutes after the push. Measured, not
     * feared. A query string does not shake it loose either.
     *
     * So before calling it a forgery, ask the one source that cannot be half-updated: the
     * site's own copy goes out in a single deploy, where the data and the signature are
     * always from the same snapshot. It can be up to a day behind, and a day-old catalog that
     * verifies beats no catalog at all - which is what a fresh install would otherwise get.
     *
     * A real rewrite fails here too, because whoever rewrote the proxy did not write this.
     */
    const snapshot = `${this.snapshotBase}${name}`;
    const consistent = await fetchText(snapshot);
    const consistentSig = await fetchText(`${snapshot}${signature.SIG_SUFFIX}`);
    if (!signature.verify(consistent, consistentSig, this.publicKey)) {
      throw new Error(`${name}: signature does not match the catalog's key`);
    }
    JSON.parse(consistent);
    return consistent;
  }

  async refresh() {
    for (const name of DATA_FILES) {
      // through the mirrors: this is the one fetch that has to work before the app can show
      // anything at all, and raw.githubusercontent is not reachable everywhere.
      //
      // CodeQL reads this as network data written to a file, and so it is. What reaches the
      // disk has already passed fetchSigned: an ed25519 signature against the key pinned in
      // catalog-signature.js, then JSON.parse. The name is one of DATA_FILES, a constant, so
      // nothing that arrives over the network decides where it is written.
      fs.writeFileSync(this.cachePath(name), await this.fetchSigned(name));
    }

    // and the hashes, which the app is allowed to do without
    try {
      fs.writeFileSync(this.cachePath(HASH_FILE), await this.fetchSigned(HASH_FILE));
    } catch {
      this.hashes = undefined; // re-read whatever is on disk next time it is asked
    }
    fs.writeFileSync(this.cachePath('meta.json'), JSON.stringify({ fetchedAt: Date.now() }));
  }

  async load({ forceRefresh = false } = {}) {
    let stale = null;
    if (forceRefresh || !this.hasCache()) {
      try {
        await this.refresh();
      } catch (e) {
        // A catalog that could not be fetched is not the same as no catalog. GitHub was down
        // for three hours on 2026-08-17 and the window came up empty for everyone whose cache
        // had passed half an hour, when yesterday's list of mods would have done fine. With
        // nothing on disk there is still nothing to show, and that error goes up as before.
        if (!this.hasCache()) throw e;
        stale = String(e.message || e);
      }
    }
    const out = { fetchedAt: this.cacheInfo().fetchedAt };
    if (stale) out.stale = stale;
    for (const name of DATA_FILES) {
      out[name.replace('.json', '')] = JSON.parse(fs.readFileSync(this.cachePath(name), 'utf-8'));
    }
    normalizeCatalog(out.mods);
    return out;
  }
  /**
   * What the catalog says this archive should hash to, or null when it does not say.
   *
   * Null is the common case for a mod added since the list was last rebuilt - 21 of 992 on the
   * day this was written - and it means the old behaviour, not a refusal. A list that has not
   * caught up must never be a reason a mod cannot be installed.
   *
   * @param {string} categoryId  e.g. "heroes"
   * @param {string} file        the archive's name in the catalog, e.g. "Bare Brewmaster.zip"
   * @returns {string|null} sha256 in lower-case hex
   */
  publishedHash(categoryId, file) {
    if (this.hashes === undefined) {
      try { this.hashes = JSON.parse(fs.readFileSync(this.cachePath(HASH_FILE), 'utf-8')); } catch { this.hashes = null; }
    }
    if (!this.hashes || !categoryId || !file) return null;
    const value = this.hashes[`${categoryId}/${file}`];
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
  }
}

module.exports = { Catalog, RAW_BASE, HASH_FILE, normalizeCatalog };
