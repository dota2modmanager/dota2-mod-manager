// The two wikis the pictures come from. The Dota wiki on Fandom hosts a PNG for most cosmetics
// under a name built from the item's own, and answers only a browser's agent; Liquipedia, asked
// only when Fandom has nothing at all, wants an agent naming the project and one request every two
// seconds. Everything here asks or fetches; src/icons.ts decides what to keep.
import { createRequire } from 'node:module';
import { prefixOf, sniff, stripScreenSuffix, titlePicker } from './icon-match.ts';
// through require: package.json is read the same way inside the asar as outside it
const pkg = createRequire(import.meta.url)('../package.json') as { version: string; homepage: string };

/** What the pictures are fetched with: always a URL written out as text, which Electron's net.fetch takes too. */
export type IconFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A picture fetched and checked: the bytes, and what kind of image they are. */
export type Picture = { buf: Buffer; mime: string };

/** Where a wiki keeps an item's picture, when the game's own name is not the file's. */
export type Found = { wiki: 'fandom'; file: string } | { wiki: 'liquipedia'; url: string };

/** What the MediaWiki API answers, as far as the calls here read it. */
type WikiAnswer = {
  query?: {
    allimages?: { name: unknown }[];
    search?: { title: unknown }[];
    pages?: Record<string, { missing?: unknown; thumbnail?: { source: unknown }; imageinfo?: { url: unknown }[] }>;
  };
};

/** Runs a job in its turn; see rateGate. */
type Gate = <T>(fn: () => Promise<T>) => Promise<T>;

const WIKI = 'https://dota2.fandom.com/wiki/Special:FilePath/';
const API = 'https://dota2.fandom.com/api.php';
// Fandom answers 403 without a browser agent
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 512 * 1024;

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
function rateGate(minGapMs: number): Gate {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, minGapMs)));
    return result;
  };
}

/** Asks the Dota wikis for a picture's file and fetches its bytes, paced the way each wiki asks. */
export class IconWiki {
  fetch: IconFetch;
  liqGate: Gate;

  /**
   * @param fetchImpl  Electron's net.fetch in the app: the wiki sits behind
   *   a bot check that plain Node requests do not pass, while the browser stack does.
   */
  constructor(fetchImpl: IconFetch) {
    this.fetch = fetchImpl;
    this.liqGate = rateGate(LIQ_MIN_GAP_MS);
  }

  /**
   * @returns parsed answer, or undefined when the wiki did not
   *   answer at all (which is never a "no such file")
   */
  async askWiki(api: string, ua: string, params: Record<string, string>, gate?: Gate): Promise<WikiAnswer | undefined> {
    const call = async (): Promise<WikiAnswer | undefined> => {
      const res = await this.fetch(`${api}?${new URLSearchParams({ format: 'json', ...params })}`,
        { headers: { 'User-Agent': ua } });
      if (!res.ok) return undefined;
      return (await res.json()) as WikiAnswer;
    };
    try {
      return await (gate ? gate(call) : call());
    } catch {
      return undefined;
    }
  }

  askFandom(params: Record<string, string>) { return this.askWiki(API, UA, params); }
  askLiquipedia(params: Record<string, string>) { return this.askWiki(LIQ_API, LIQ_UA, params, this.liqGate); }

  async filesByPrefix(name: string): Promise<string[] | undefined> {
    const head = prefixOf(name);
    if (!head) return [];
    const json = await this.askFandom({ action: 'query', list: 'allimages', aiprefix: `Cosmetic_icon_${head}`, ailimit: '100' });
    return json && (json.query?.allimages || []).map((i) => String(i.name));
  }

  /** The wiki's own full-text search, for names whose first word is spelled its own way. */
  async filesBySearch(name: string): Promise<string[] | undefined> {
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
   * @returns a ready-to-fetch image URL · null = no such
   *   page, or the page has no picture · undefined = the wiki never answered
   */
  async pageImage(title: string): Promise<string | null | undefined> {
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
  async liqFilesByPrefix(name: string): Promise<string[] | undefined> {
    const head = prefixOf(name);
    if (!head) return [];
    const json = await this.askLiquipedia({ action: 'query', list: 'allimages', aiprefix: `Cosmetic_icon_${head}`, ailimit: '100' });
    return json && (json.query?.allimages || []).map((i) => String(i.name));
  }

  async liqFilesBySearch(name: string): Promise<string[] | undefined> {
    const json = await this.askLiquipedia({ action: 'query', list: 'search', srnamespace: '6', srlimit: '10', srsearch: `Cosmetic icon ${name}` });
    return json && (json.query?.search || []).map((s) => String(s.title));
  }

  /**
   * The raw image URL for a file name Liquipedia is known to have. Its terms rule out
   * automated fetches of rendered wiki pages, so the URL is asked for through the API
   * (imageinfo) rather than guessed at from the file name.
   */
  async liqResolveUrl(fileName: string): Promise<string | null | undefined> {
    const json = await this.askLiquipedia({
      action: 'query', titles: `File:${fileName.replace(/_/g, ' ')}`, prop: 'imageinfo', iiprop: 'url',
    });
    if (!json) return undefined;
    const info = Object.values(json.query?.pages || {})[0]?.imageinfo?.[0];
    return info ? String(info.url) : null;
  }

  /**
   * One pass over both wikis (prefix listing, then full-text search) for one exact name.
   */
  async searchOneName(name: string): Promise<Found | null | undefined> {
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
   * @returns null = no wiki has this picture · undefined = one of them never answered, so nothing
   *   here counts as a real "no" and it is worth asking again later
   */
  async searchFileName(name: string): Promise<Found | null | undefined> {
    const own = await this.searchOneName(name);
    if (own !== null) return own; // a hit, or a network hiccup worth retrying later - either way, done

    const base = stripScreenSuffix(name);
    return base ? this.searchOneName(base) : null;
  }

  fetchBytes(url: string, ua: string, gate?: Gate): Promise<Picture | null | undefined> {
    const call = async (): Promise<Picture | null | undefined> => {
      let res: Response;
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

  fetchFandomFile(fileName: string) { return this.fetchBytes(WIKI + encodeURIComponent(fileName), UA); }
  fetchLiquipediaFile(url: string) { return this.fetchBytes(url, LIQ_UA, this.liqGate); }
  /** An image URL on Fandom itself (a page's lead picture), fetched with Fandom's agent. */
  fetchFandomUrl(url: string) { return this.fetchBytes(url, UA); }
}
