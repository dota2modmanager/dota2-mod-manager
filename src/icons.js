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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const WIKI = 'https://dota2.fandom.com/wiki/Special:FilePath/';
const API = 'https://dota2.fandom.com/api.php';
// Fandom answers 403 without a browser agent
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 512 * 1024;
const MISS_TTL = 7 * 24 * 3600 * 1000; // retry a missing picture next week, not next second
// How many pictures are fetched at once. The wiki starts refusing a burst of a hundred,
// and a refusal used to be remembered as "no such picture" for a week.
const CONCURRENCY = 6;

// Liquipedia's own image host, tried once Fandom has come up with nothing at all. Its terms
// require a project-identifying agent (a browser UA gets treated as abuse there, the exact
// opposite of Fandom) and cap every request at one per two seconds - a limit worth respecting
// on its own merits, and this path is rare enough (a handful of names, ever, per install -
// see MISS_TTL) that the wait never shows up as a slower picker.
const LIQ_API = 'https://liquipedia.net/commons/api.php';
const LIQ_UA = `Dota2ModManager/${pkg.version} (+${pkg.homepage})`;
const LIQ_MIN_GAP_MS = 2100;

// Runs queued jobs one at a time, each starting no sooner than minGapMs after the previous
// one finished. A job's own outcome is independent of the pacing that follows it.
function rateGate(minGapMs) {
  let queue = Promise.resolve();
  return (fn) => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, minGapMs)));
    return result;
  };
}

// Names compared without spacing, punctuation or case: the wiki and the game write those
// their own ways, and none of it changes which item is meant. Nor does the trailing "Skin"
// the schema gives some HUDs and the wiki does not.
const plain = (s) => String(s).replace(/\bHUD[ _]Skin$/i, 'HUD').toLowerCase().replace(/[^a-z0-9]+/g, '');

// The parts a typo check must never forgive: "Loading Screen VI" and "Loading Screen IV"
// are two different pictures one swapped letter apart.
const numbering = (s) => (String(s).match(/\d+|\b[IVXLC]{1,6}\b/g) || []).join(' ');

// Levenshtein distance, only ever asked about strings that are nearly the same already.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// A "Loading Screen" / "Versus Screen" cosmetic is routinely undocumented on its own, even
// when the outfit it belongs to has a picture: the wiki draws the line at the outfit, not
// every slot it fills. Stripped of the suffix, the name is worth one more try against the
// same two wikis - the outfit's own icon is still a recognisable stand-in for its own screen.
const SCREEN_SUFFIX = /\s*-?\s*(?:Loading[ ]?Screen|Versus[ ]?Screen|LS)$/i;
function stripScreenSuffix(name) {
  const base = String(name).replace(SCREEN_SUFFIX, '').trim();
  return base && base !== String(name).trim() ? base : null;
}

/**
 * Which of a list of "File:..." / "Cosmetic_icon_....png" titles is this item's picture,
 * shared by both wikis' listings. A title counts only when it is the same name give or take
 * a typo: a loose match would put a stranger's picture on the card, which is worse than an
 * empty tile, so an extra word ("… Bundle") or a different number is enough to rule it out.
 * @returns {(titles: string[]) => string|null}
 */
function titlePicker(name) {
  const want = plain(name);
  return (titles) => {
    let best = null;
    for (const rawTitle of titles) {
      const title = rawTitle.replace(/^File:/i, '');
      const m = /^Cosmetic[ _]icon[ _](.+)\.(?:png|jpe?g|webp)$/i.exec(title);
      if (!m || numbering(m[1]) !== numbering(name)) continue;
      const got = plain(m[1]);
      // a typo swaps or replaces letters, it does not add or drop words: same length only,
      // which is what keeps "Alliance HUD Bundle" away from "Alliance HUD"
      const d = got === want ? 0 : got.length === want.length ? editDistance(got, want) : Infinity;
      if (d <= 2 && (!best || d < best.d)) best = { d, file: title.replace(/ /g, '_') };
    }
    return best ? best.file : null;
  };
}

// The wiki serves WebP to a browser and PNG to anything else; both render in the app.
function sniff(buf) {
  const hex = buf.slice(0, 4).toString('hex');
  if (hex === '89504e47') return 'image/png';
  if (hex === '52494646' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return null;
}

class Icons {
  /**
   * @param {string} userDataDir
   * @param {typeof fetch} [fetchImpl]  Electron's net.fetch in the app: the wiki sits behind
   *   a bot check that plain Node requests do not pass, while the browser stack does.
   */
  constructor(userDataDir, fetchImpl) {
    this.fetch = fetchImpl || globalThis.fetch;
    this.dir = path.join(userDataDir, 'icons');
    fs.mkdirSync(this.dir, { recursive: true });
    // v6: the older files hold names that missed because the app hadn't yet tried the exact
    // title's own page picture (see pageImage), so they are not carried over
    this.missFile = path.join(this.dir, 'misses.v6.json');
    this.misses = new Map();
    this.inflight = new Map();
    this.liqGate = rateGate(LIQ_MIN_GAP_MS);
    try {
      for (const [k, at] of Object.entries(JSON.parse(fs.readFileSync(this.missFile, 'utf8')))) this.misses.set(k, at);
    } catch { /* no misses recorded yet */ }
  }

  /**
   * Wiki file names to try for a cosmetic: "Weather Rain" -> Cosmetic_icon_Weather_Rain.png.
   * The schema's own name is right about nine times out of ten; the rest differ by
   * punctuation the wiki spells its own way, so a couple of spellings follow before the
   * picture counts as missing. "Mega-Kills: Axe" is filed as both Mega-Kills_Axe and
   * Mega-Kills-_Axe, and the game's typographic apostrophe is a plain one there.
   * @returns {string[]}
   */
  static fileNames(name) {
    const clean = String(name).replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    const out = [];
    for (const form of [clean, clean.replace(/:/g, ''), clean.replace(/:/g, '-'), String(name).trim()]) {
      const file = 'Cosmetic_icon_' + form.replace(/\s+/g, '_') + '.png';
      if (form && !out.includes(file)) out.push(file);
    }
    return out;
  }

  cachePath(name) {
    return path.join(this.dir, crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 16) + '.img');
  }

  saveMisses() {
    try { fs.writeFileSync(this.missFile, JSON.stringify(Object.fromEntries(this.misses))); } catch { /* cache only */ }
  }

  /**
   * @returns {Promise<object|undefined>} parsed answer, or undefined when the wiki did not
   *   answer at all (which is never a "no such file")
   */
  async askWiki(api, ua, params, gate) {
    const call = async () => {
      const res = await this.fetch(`${api}?${new URLSearchParams({ format: 'json', ...params })}`,
        { headers: { 'User-Agent': ua } });
      if (!res.ok) return undefined;
      return res.json();
    };
    try {
      return await (gate ? gate(call) : call());
    } catch {
      return undefined;
    }
  }

  askFandom(params) { return this.askWiki(API, UA, params); }
  askLiquipedia(params) { return this.askWiki(LIQ_API, LIQ_UA, params, this.liqGate); }

  /**
   * Files whose name starts with the item's first word or two. Exact and always answered,
   * unlike the search, which returns nothing at all for half of these names.
   */
  static prefixOf(name) {
    const words = String(name).replace(/[^\w\s'.-]/g, '').split(/\s+/).filter(Boolean);
    return words.length ? words.slice(0, words[0].length < 5 ? 2 : 1).join('_') : null;
  }

  async filesByPrefix(name) {
    const head = Icons.prefixOf(name);
    if (!head) return [];
    const json = await this.askFandom({ action: 'query', list: 'allimages', aiprefix: `Cosmetic_icon_${head}`, ailimit: '100' });
    return json && (json.query?.allimages || []).map((i) => String(i.name));
  }

  /** The wiki's own full-text search, for names whose first word is spelled its own way. */
  async filesBySearch(name) {
    const json = await this.askFandom({ action: 'query', list: 'search', srnamespace: '6', srlimit: '10', srsearch: `Cosmetic icon ${name}` });
    return json && (json.query?.search || []).map((s) => String(s.title));
  }

  /**
   * The lead picture of the wiki article at this EXACT title, when one exists - not every
   * cosmetic's picture is filed as "Cosmetic_icon_...": a courier with its own page (rare
   * outfits, mostly) is routinely illustrated with a plain screenshot under some other name
   * entirely, which no amount of guessing the file name would ever find. MediaWiki resolves
   * the title itself (case, spacing, real redirects), so this needs no typo tolerance of its
   * own - it only ever answers for the name the game already got right.
   * @returns {Promise<string|null|undefined>} a ready-to-fetch image URL · null = no such
   *   page, or the page has no picture · undefined = the wiki never answered
   */
  async pageImage(title) {
    const json = await this.askFandom({
      action: 'query', titles: title, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '512', redirects: '1',
    });
    if (!json) return undefined;
    const page = Object.values(json.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return page.thumbnail ? String(page.thumbnail.source) : null;
  }

  // Liquipedia keeps every wiki's uploads on one shared image host ("commons"), same
  // listing shape as Fandom's - only the endpoint, the agent and the pacing differ.
  async liqFilesByPrefix(name) {
    const head = Icons.prefixOf(name);
    if (!head) return [];
    const json = await this.askLiquipedia({ action: 'query', list: 'allimages', aiprefix: `Cosmetic_icon_${head}`, ailimit: '100' });
    return json && (json.query?.allimages || []).map((i) => String(i.name));
  }

  async liqFilesBySearch(name) {
    const json = await this.askLiquipedia({ action: 'query', list: 'search', srnamespace: '6', srlimit: '10', srsearch: `Cosmetic icon ${name}` });
    return json && (json.query?.search || []).map((s) => String(s.title));
  }

  /**
   * The raw image URL for a file name Liquipedia is known to have. Its terms rule out
   * automated fetches of rendered wiki pages, so the URL is asked for through the API
   * (imageinfo) rather than guessed at from the file name.
   * @returns {Promise<string|null|undefined>}
   */
  async liqResolveUrl(fileName) {
    const json = await this.askLiquipedia({
      action: 'query', titles: `File:${fileName.replace(/_/g, ' ')}`, prop: 'imageinfo', iiprop: 'url',
    });
    if (!json) return undefined;
    const info = Object.values(json.query?.pages || {})[0]?.imageinfo?.[0];
    return info ? String(info.url) : null;
  }

  /**
   * One pass over both wikis (prefix listing, then full-text search) for one exact name.
   * @returns {Promise<{wiki: 'fandom', file: string}|{wiki: 'liquipedia', url: string}|null|undefined>}
   */
  async searchOneName(name) {
    const pick = titlePicker(name);
    let silent = false;

    for (const ask of [() => this.filesByPrefix(name), () => this.filesBySearch(name)]) {
      const list = await ask();
      if (!list) { silent = true; continue; }
      const file = pick(list);
      if (file) return { wiki: 'fandom', file };
    }

    for (const ask of [() => this.liqFilesByPrefix(name), () => this.liqFilesBySearch(name)]) {
      const list = await ask();
      if (!list) { silent = true; continue; }
      const file = pick(list);
      if (!file) continue;
      const url = await this.liqResolveUrl(file);
      if (url === undefined) { silent = true; continue; }
      if (url) return { wiki: 'liquipedia', url };
    }

    return silent ? undefined : null;
  }

  /**
   * Which file a wiki keeps this item's picture under, when it is not the name the game
   * uses - "Aghanim's Labryinth 2021 HUD" is the schema's own typo, and some HUDs carry a
   * "Skin" the wiki leaves off. Fandom is tried first; Liquipedia only for names it has
   * nothing at all for (a handful - old Battle Passes, some Mega-Kills). A "Loading Screen" /
   * "Versus Screen" name that comes up with nothing anywhere gets one more pass under its
   * outfit's own name (see stripScreenSuffix) - not the exact picture, but the same look.
   * @returns {Promise<{wiki: 'fandom', file: string}|{wiki: 'liquipedia', url: string}|null|undefined>}
   *   null = no wiki has this picture · undefined = one of them never answered, so nothing
   *   here counts as a real "no" and it is worth asking again later
   */
  async searchFileName(name) {
    const own = await this.searchOneName(name);
    if (own !== null) return own; // a hit, or a network hiccup worth retrying later - either way, done

    const base = stripScreenSuffix(name);
    return base ? this.searchOneName(base) : null;
  }

  fetchBytes(url, ua, gate) {
    const call = async () => {
      let res;
      try {
        res = await this.fetch(url, { headers: { 'User-Agent': ua } });
      } catch {
        return undefined; // dropped request: says nothing about whether the file exists
      }
      if (res.status === 404) return null; // the one answer that means "no such picture"
      if (!res.ok) return undefined;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = buf.length && buf.length <= MAX_BYTES ? sniff(buf) : null;
      return mime ? { buf, mime } : undefined; // an unreadable body isn't a "no" either
    };
    return gate ? gate(call) : call();
  }

  fetchFandomFile(fileName) { return this.fetchBytes(WIKI + encodeURIComponent(fileName), UA); }
  fetchLiquipediaFile(url) { return this.fetchBytes(url, LIQ_UA, this.liqGate); }

  /**
   * Disk cache + in-flight de-dup + miss bookkeeping, shared by every picture this class
   * fetches regardless of where it comes from. `resolve()` does the actual lookup and
   * returns `{buf, mime}` on a hit, `null` for a confirmed "no such picture", or `undefined`
   * when nothing answered either way (network hiccup) - which must never be remembered as a
   * miss, or a bad burst turns into a permanently half-empty picker.
   * @param {string} key   cache/miss-list key - namespaced by caller so a cosmetic named
   *   the same as a hero can never collide with that hero's own portrait
   * @param {() => Promise<{buf:Buffer,mime:string}|null|undefined>} resolve
   * @returns {Promise<string|null>} data URI, or null when there is no such picture
   */
  async cached(key, resolve) {
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
    if (this.inflight.has(key)) return this.inflight.get(key);

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
   * @returns {Promise<string|null>} data URI, or null when the wiki has no such picture
   */
  async get(name) {
    if (!name) return null;
    return this.cached(name, async () => {
      for (const wikiName of Icons.fileNames(name)) {
        const hit = await this.fetchFandomFile(wikiName);
        if (hit) return hit;
      }
      const pageUrl = await this.pageImage(name);
      if (pageUrl) {
        const hit = await this.fetchBytes(pageUrl, UA);
        if (hit) return hit;
      }
      const found = await this.searchFileName(name);
      if (found === undefined) return undefined;
      if (found === null) return null;
      return found.wiki === 'fandom' ? this.fetchFandomFile(found.file) : this.fetchLiquipediaFile(found.url);
    });
  }

  /**
   * Wiki file names for a hero's own default portrait - not a cosmetic look, the hero
   * itself. Unlike a cosmetic's, this naming is exact (every hero has exactly one page,
   * named after the hero), so there is no search fallback to fall through to.
   * @returns {string[]}
   */
  static heroFileNames(heroName) {
    const clean = String(heroName).replace(/\s+/g, '_');
    return [`${clean}_icon.png`, `${clean}_minimap_icon.png`];
  }

  /**
   * A hero's own portrait, for an imported mod the app recognises as skinning exactly one
   * hero (see src/vpk.js analyzeVpkPaths): a stand-in so an "Elder Titan" import shows Elder
   * Titan's own picture instead of an empty box in the Library.
   * @returns {Promise<string|null>}
   */
  async getHero(heroName) {
    if (!heroName) return null;
    return this.cached('hero:' + heroName, async () => {
      let answered = true;
      for (const fileName of Icons.heroFileNames(heroName)) {
        const hit = await this.fetchFandomFile(fileName);
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
  static GENERIC_PAGES = {
    // several heroes' worth of emoticons in one picture - the closest the wiki has to
    // "several heroes bundled into one thing", which is exactly what an unsplit import is
    pack: 'DAC Compendium 2015 Emoticon Pack',
    cursor: 'Cursor Pack',
  };

  /**
   * @returns {Promise<string|null>}
   */
  async getGeneric(kind) {
    const title = Icons.GENERIC_PAGES[kind];
    if (!title) return null;
    return this.cached('generic:' + kind, async () => {
      const url = await this.pageImage(title);
      if (url === undefined) return undefined;
      if (!url) return null;
      return this.fetchBytes(url, UA);
    });
  }

  /**
   * Pictures for a batch of names, a few requests at a time. A name prefixed "hero:" asks
   * for that hero's own portrait (see getHero), "generic:" for a category stand-in (see
   * getGeneric), instead of a cosmetic look - the same batch call and the same on-screen
   * loader cover all three, so the renderer needs only one pipeline.
   * @returns {Promise<Record<string, string|null>>}
   */
  async getMany(names) {
    const list = [...new Set((Array.isArray(names) ? names : []).filter(Boolean))];
    /** @type {Record<string, string|null>} */
    const out = {};
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

  size() {
    let total = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) total += fs.statSync(path.join(this.dir, f)).size;
    } catch { /* nothing cached */ }
    return total;
  }

  clear() {
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* noop */ }
    fs.mkdirSync(this.dir, { recursive: true });
    this.misses.clear();
  }
}

module.exports = { Icons };
