// Pictures for the cosmetics picker, and for the Library where a picture can be found for
// content that is not a cosmetic at all.
//
// The game keeps its own icons as compiled Source 2 textures inside pak01, which the app
// cannot draw. The Dota wiki hosts a PNG for most cosmetics under a name built from the
// item's own (a page under the exact name, or its search, finds the rest), so that is where
// they come from - fetched in the main process and handed to the renderer as data URIs, the
// same way the Discord avatar is handled: no third-party host in the page's CSP, and nothing
// about the user leaves with the request. A few dozen looks that Fandom never got a picture
// for at all (old Battle Passes, some Mega-Kills) are asked of Liquipedia instead, which
// mirrors the same file naming on its own image host.
//
// Everything is cached on disk, misses included: 2000 loading screens must not turn into
// 2000 requests every time the picker opens.
//
// Three files: src/icon-match.ts names the files to try and matches a wiki's listing,
// src/icon-wiki.ts asks the two wikis and fetches, and this one keeps the answers on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IconWiki, type IconFetch, type Picture } from './icon-wiki.ts';
import { cosmeticFileNames, heroFileNames, sniff } from './icon-match.ts';

const MISS_TTL = 7 * 24 * 3600 * 1000; // retry a missing picture next week, not next second
// How many pictures are fetched at once. The wiki starts refusing a burst of a hundred,
// and a refusal used to be remembered as "no such picture" for a week.
const CONCURRENCY = 6;

/** Cosmetic and hero pictures off the Dota wikis, cached on disk with the misses remembered. */
export class Icons {
  wiki: IconWiki;
  dir: string;
  missFile: string;
  /** name -> when the wikis last had no picture for it */
  misses: Map<string, number>;
  inflight: Map<string, Promise<string | null>>;

  /**
   * @param fetchImpl  Electron's net.fetch in the app: the wiki sits behind
   *   a bot check that plain Node requests do not pass, while the browser stack does.
   */
  constructor(userDataDir: string, fetchImpl?: IconFetch) {
    this.wiki = new IconWiki(fetchImpl || globalThis.fetch);
    this.dir = path.join(userDataDir, 'icons');
    fs.mkdirSync(this.dir, { recursive: true });
    // v6: the older files hold names that missed because the app hadn't yet tried the exact
    // title's own page picture (see IconWiki.pageImage), so they are not carried over
    this.missFile = path.join(this.dir, 'misses.v6.json');
    this.misses = new Map();
    this.inflight = new Map();
    try {
      for (const [k, at] of Object.entries(JSON.parse(fs.readFileSync(this.missFile, 'utf8')) as Record<string, number>)) this.misses.set(k, at);
    } catch { /* no misses recorded yet */ }
  }

  cachePath(name: string): string {
    return path.join(this.dir, crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 16) + '.img');
  }

  saveMisses(): void {
    try { fs.writeFileSync(this.missFile, JSON.stringify(Object.fromEntries(this.misses))); } catch { /* cache only */ }
  }

  /**
   * Disk cache + in-flight de-dup + miss bookkeeping, shared by every picture this class
   * fetches regardless of where it comes from. `resolve()` does the actual lookup and
   * returns `{buf, mime}` on a hit, `null` for a confirmed "no such picture", or `undefined`
   * when nothing answered either way (network hiccup) - which must never be remembered as a
   * miss, or a bad burst turns into a permanently half-empty picker.
   * @param key   cache/miss-list key - namespaced by caller so a cosmetic named
   *   the same as a hero can never collide with that hero's own portrait
   * @returns data URI, or null when there is no such picture
   */
  async cached(key: string, resolve: () => Promise<Picture | null | undefined>): Promise<string | null> {
    const file = this.cachePath(key);
    try {
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        const mime = sniff(buf);
        if (mime) return `data:${mime};base64,` + buf.toString('base64');
      }
    } catch { /* unreadable cache entry: refetch */ }

    const missedAt = this.misses.get(key);
    if (missedAt && Date.now() - missedAt < MISS_TTL) return null;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = (async () => {
      try {
        const hit = await resolve();
        if (hit) {
          fs.writeFileSync(file, hit.buf);
          this.misses.delete(key);
          return `data:${hit.mime};base64,` + hit.buf.toString('base64');
        }
        if (hit === null) {
          this.misses.set(key, Date.now());
          this.saveMisses();
        }
        return null;
      } catch {
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }

  /**
   * A cosmetic's picture by its name in the game.
   * @returns data URI, or null when the wiki has no such picture
   */
  async get(name: string | null | undefined): Promise<string | null> {
    if (!name) return null;
    return this.cached(name, async () => {
      /* Every step has to have answered for the end to be a "no". A file under the item's own
         name that came back 503 may be its picture all the same, and remembering a miss for it
         would leave the card empty for a week after one busy minute on the wiki. */
      let answered = true;
      for (const wikiName of cosmeticFileNames(name)) {
        const hit = await this.wiki.fetchFandomFile(wikiName);
        if (hit) return hit;
        if (hit === undefined) answered = false;
      }
      const pageUrl = await this.wiki.pageImage(name);
      if (pageUrl === undefined) answered = false;
      if (pageUrl) {
        const hit = await this.wiki.fetchFandomUrl(pageUrl);
        if (hit) return hit;
        if (hit === undefined) answered = false;
      }
      const found = await this.wiki.searchFileName(name);
      if (found === undefined) return undefined;
      if (found === null) return answered ? null : undefined;
      return found.wiki === 'fandom' ? this.wiki.fetchFandomFile(found.file) : this.wiki.fetchLiquipediaFile(found.url);
    });
  }

  /**
   * A hero's own portrait, for an imported mod the app recognises as skinning exactly one
   * hero (see src/vpk.ts analyzeVpkPaths): a stand-in so an "Elder Titan" import shows Elder
   * Titan's own picture instead of an empty box in the Library.
   */
  async getHero(heroName: string | null | undefined): Promise<string | null> {
    if (!heroName) return null;
    return this.cached('hero:' + heroName, async () => {
      let answered = true;
      for (const fileName of heroFileNames(heroName)) {
        const hit = await this.wiki.fetchFandomFile(fileName);
        if (hit) return hit;
        if (hit === undefined) answered = false;
      }
      return answered ? null : undefined;
    });
  }

  // A stand-in for content the app cannot name any more precisely than "a bundle of several
  // heroes" or "a cursor set" - a real category the wiki itself illustrates with one picture,
  // reused so an import that is neither a single recognised hero nor a catalog match still
  // shows something truer than an empty box. Not a per-item lookup, so it never needs a
  // second wiki or a typo-tolerant search: the title is fixed and known to exist.
  static GENERIC_PAGES: Record<string, string> = {
    // several heroes' worth of emoticons in one picture - the closest the wiki has to
    // "several heroes bundled into one thing", which is exactly what an unsplit import is
    pack: 'DAC Compendium 2015 Emoticon Pack',
    cursor: 'Cursor Pack',
  };

  /** The stand-in picture for a kind of content; see GENERIC_PAGES. */
  async getGeneric(kind: string): Promise<string | null> {
    const title = Icons.GENERIC_PAGES[kind];
    if (!title) return null;
    return this.cached('generic:' + kind, async () => {
      const url = await this.wiki.pageImage(title);
      if (url === undefined) return undefined;
      if (!url) return null;
      return this.wiki.fetchFandomUrl(url);
    });
  }

  /**
   * Pictures for a batch of names, a few requests at a time. A name prefixed "hero:" asks
   * for that hero's own portrait (see getHero), "generic:" for a category stand-in (see
   * getGeneric), instead of a cosmetic look - the same batch call and the same on-screen
   * loader cover all three, so the renderer needs only one pipeline.
   */
  async getMany(names: unknown): Promise<Record<string, string | null>> {
    const list = [...new Set((Array.isArray(names) ? names : []).filter(Boolean) as string[])];
    const out: Record<string, string | null> = {};
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const name = list[next++];
        if (name.startsWith('hero:')) out[name] = await this.getHero(name.slice(5));
        else if (name.startsWith('generic:')) out[name] = await this.getGeneric(name.slice(8));
        else out[name] = await this.get(name);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    return out;
  }

  size(): number {
    let total = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) total += fs.statSync(path.join(this.dir, f)).size;
    } catch { /* nothing cached */ }
    return total;
  }

  clear(): void {
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* noop */ }
    fs.mkdirSync(this.dir, { recursive: true });
    this.misses.clear();
  }
}
