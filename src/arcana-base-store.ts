/**
 * The arcana bases (src/arcana-bases.ts) brought down from their repository and kept here, so a
 * build reads them from disk like it reads pak01.
 *
 * The repository holds each base as its compiled files under src/<id>/, and a VPK of the same
 * files beside them for people to try by hand; the app takes the files. What is there is read from
 * the repository's git tree, which names every file with git's hash of it: nothing to keep in step
 * by hand, and each file is checked against its hash, so a mirror (src/net.ts) can be trusted with
 * the bytes. The tree comes from api.github.com, which has no mirrors; where it cannot be reached a
 * manifest.json in the repository, the same list (tools/arcana-bases-manifest.mjs writes it), comes
 * through them; and where neither can, the list from last time.
 *
 * On disk: blobs/<hash>, one per file whatever base it is in (both of Juggernaut's styles share
 * most of theirs), and ready.json, each base that is all here with the hash of each of its files.
 * A base is only in ready.json once every file of it is, so a build never takes half of one, and
 * an update keeps the old one in use until the new one is whole.
 *
 * Builds are synchronous and a download is not: `entries` answers from disk at once, null when a
 * base is not here, and `want` starts bringing it down and calls onReady once it is, for the
 * caller to build again. Everything that needs the network fails quietly into the log.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchMirrored } from './net.ts';
import { downloadProxyFetchInit } from './download-proxy.ts';
import { entryAt, type VpkEntry } from './vpk.ts';

/** Where the bases are published, owner/name on GitHub. */
export const BASES_REPO = 'J0nathan550/d2pfx-arcana-fixes';
const BRANCH = 'main';
const TREE_URL = `https://api.github.com/repos/${BASES_REPO}/git/trees/${BRANCH}?recursive=1`;
const rawUrl = (rel: string) => `https://raw.githubusercontent.com/${BASES_REPO}/${BRANCH}/${rel}`;
/** how long a base that could not be had waits before it is asked for again: a build runs on every pick */
const RETRY_MS = 5 * 60 * 1000;
/** files brought down at once: Rubick's base is 135 of them */
const PARALLEL = 6;

/** Each base's files: its path inside the base, as the repository spells it -> git's hash of it. */
export type Listing = Record<string, Record<string, string>>;

/** git's hash of a file: what the repository's tree names it by. */
export const blobSha = (data: Buffer) => crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

const SHA = /^[0-9a-f]{40}$/;
const BASE_ID = /^[a-z0-9_]+$/i;
/** what a base holds: the hero's models, materials and particles (tools/clean-arcana-bases.mjs) */
const BASE_FILE = /^(models|materials|particles)\/[^\\:]+$/i;

/**
 * Only what a base can be out of a list: a file under models/, materials/ or particles/, named by
 * a git hash. The list can come from a mirror (the manifest), and a mirror that served a list of
 * its own and the bytes to match it could otherwise have put a file at any path of the user's
 * game pak, a script among them; and a hash is a file name here, so it has to be one.
 */
export function safeListing(raw: unknown): Listing {
  const out: Listing = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, files] of Object.entries(raw as Record<string, unknown>)) {
    if (!BASE_ID.test(id) || !files || typeof files !== 'object') continue;
    for (const [rel, sha] of Object.entries(files as Record<string, unknown>)) {
      if (typeof sha !== 'string' || !SHA.test(sha) || !BASE_FILE.test(rel) || rel.split('/').some((s) => s === '..' || s === '.' || !s)) continue;
      (out[id] ||= {})[rel] = sha;
    }
  }
  return out;
}

/** The bases in a git tree (GET /git/trees/<branch>?recursive=1): every file under src/<id>/ but the VPK of them. */
export function listingFromTree(tree: { tree?: { path: string; type: string; sha: string }[] }): Listing {
  const out: Listing = {};
  for (const e of tree.tree || []) {
    const m = e.type === 'blob' ? /^src\/([^/]+)\/(.+)$/.exec(e.path) : null;
    if (!m || (!m[2].includes('/') && m[2].toLowerCase().endsWith('.vpk'))) continue;
    (out[m[1]] ||= {})[m[2]] = e.sha;
  }
  return safeListing(out);
}

const sameFiles = (a: Record<string, string> | undefined, b: Record<string, string>) =>
  !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

/** What a store is made with: where it keeps the bases, and whom it tells. */
export interface BaseStoreDeps {
  /** where the bases are kept (userData/arcana-bases) */
  dir: string;
  /** a base came down, or a newer version of it did */
  onReady?: (id: string) => void;
  log?: (msg: string) => void;
  /** the network, for tests: a URL and the headers to send, to a Response */
  fetchUrl?: (url: string, opts: { headers?: Record<string, string>; small?: boolean }) => Promise<Response>;
}

/**
 * The network as the store asks it: the raw files along the mirrors, which their hashes make safe
 * to take from a stranger; the tree straight from api.github.com, which has no mirrors and whose
 * "unchanged" (304) the mirror chain would count as the host failing.
 */
const fetchDefault: NonNullable<BaseStoreDeps['fetchUrl']> = (url, opts) => (url.startsWith('https://api.github.com/')
  ? fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(20000), ...downloadProxyFetchInit() } as RequestInit)
  : fetchMirrored(url, opts));

/** The bases on disk, and bringing one down when a build needs it (the header says how). */
export function createBaseStore({ dir, onReady = () => {}, log = () => {}, fetchUrl = fetchDefault }: BaseStoreDeps) {
  const blobs = path.join(dir, 'blobs');
  const readyFile = path.join(dir, 'ready.json');
  const listingFile = path.join(dir, 'listing.json');
  // a hash is the file's name, so only ever a hash: never a path somebody wrote into a list
  const blobPath = (sha: string) => { if (!SHA.test(sha)) throw new Error(`not a file hash: ${sha}`); return path.join(blobs, sha); };
  const ready = (): Listing => readJson<Listing>(readyFile, {});
  /** the repository's list, asked for once a run: a second base picked a minute later needs no new one */
  let listing: Promise<Listing> | null = null;
  /** bases asked for this run, so a build that runs ten times asks the network once */
  const asked = new Map<string, Promise<boolean>>();
  const failedAt = new Map<string, number>();

  async function fetchListing(): Promise<Listing> {
    const cached = readJson<{ etag?: string; bases?: Listing }>(listingFile, {});
    try {
      const res = await fetchUrl(TREE_URL, { headers: { Accept: 'application/vnd.github+json', ...(cached.etag ? { 'If-None-Match': cached.etag } : {}) } });
      // an unchanged tree answers 304, which GitHub does not count against the hourly limit
      if (res.status === 304 && cached.bases) return safeListing(cached.bases);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bases = listingFromTree(await res.json() as Parameters<typeof listingFromTree>[0]);
      fs.mkdirSync(dir, { recursive: true });
      writeJson(listingFile, { etag: res.headers.get('etag') || undefined, bases });
      return bases;
    } catch (err) {
      log(`arcana bases: the repository's tree could not be read: ${(err as Error).message}`);
    }
    try {
      const res = await fetchUrl(rawUrl('manifest.json'), { small: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bases = safeListing((await res.json() as { bases?: unknown }).bases);
      if (Object.keys(bases).length) return bases;
      throw new Error('no bases in it');
    } catch (err) {
      log(`arcana bases: no manifest.json either: ${(err as Error).message}`);
    }
    if (cached.bases) return safeListing(cached.bases);
    throw new Error('the list of bases could not be had');
  }

  async function bring(id: string, rel: string, sha: string): Promise<void> {
    if (fs.existsSync(blobPath(sha))) return;
    const url = rawUrl(`src/${id}/${rel.split('/').map(encodeURIComponent).join('/')}`);
    const res = await fetchUrl(url, {});
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (blobSha(data) !== sha) throw new Error(`${rel}: not the file the repository names`);
    fs.mkdirSync(blobs, { recursive: true });
    // CodeQL reads this as network data written to a file, and so it is. What reaches the disk
    // has already been hashed the way git hashes a blob and matched against the sha the listing
    // names (the line above), and the listing keeps only 40-hex shas (safeListing). The file is
    // named by that sha and nothing else, and blobPath refuses any name that is not one, so
    // nothing that arrives over the network decides where it is written or what it says.
    const tmp = `${blobPath(sha)}.part`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, blobPath(sha));
  }

  /** Files no base here uses any more: an old version's, once the new one is whole. */
  function sweep(have: Listing) {
    const used = new Set(Object.values(have).flatMap((files) => Object.values(files)));
    let names: string[] = [];
    try { names = fs.readdirSync(blobs); } catch { return; }
    for (const n of names) if (!used.has(n.replace(/\.part$/, ''))) fs.rmSync(path.join(blobs, n), { force: true });
  }

  /** @returns whether the base on disk changed */
  async function fetchBase(id: string): Promise<boolean> {
    listing ||= fetchListing();
    let files: Record<string, string> | undefined;
    try {
      files = (await listing)[id];
    } catch (err) {
      listing = null; // asked again next time, the network may be back
      throw err;
    }
    if (!files || !Object.keys(files).length) throw new Error(`the repository has no base ${id}`);
    if (sameFiles(ready()[id], files) && Object.values(files).every((sha) => fs.existsSync(blobPath(sha)))) return false;
    const queue = Object.entries(files);
    const worker = async () => { for (let next = queue.shift(); next; next = queue.shift()) await bring(id, next[0], next[1]); };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    const have = { ...ready(), [id]: files };
    writeJson(readyFile, have);
    sweep(have);
    return true;
  }

  return {
    /** A base's files to build with, or null when it is not all here. */
    entries(id: string): VpkEntry[] | null {
      const files = ready()[id];
      if (!files) return null;
      try {
        return Object.entries(files).map(([rel, sha]) => entryAt(rel, fs.readFileSync(blobPath(sha))));
      } catch {
        return null; // a file deleted by hand: brought down again by the next want
      }
    },

    /** Bring a base down, or its newer version, once a run; onReady when the disk changed. */
    want(id: string): Promise<boolean> {
      const known = asked.get(id);
      if (known) return known;
      if (Date.now() - (failedAt.get(id) ?? -Infinity) < RETRY_MS) return Promise.resolve(false);
      const run = fetchBase(id).then((changed) => {
        if (changed) { log(`arcana bases: ${id} is here`); onReady(id); }
        return changed;
      }, (err) => {
        asked.delete(id); // tried again after RETRY_MS, not once a run: the network may come back
        failedAt.set(id, Date.now());
        log(`arcana bases: ${id} could not be brought down: ${(err as Error).message}`);
        return false;
      });
      asked.set(id, run);
      return run;
    },
  };
}

/** A store as the builder and the arcana window take it. */
export type BaseStore = ReturnType<typeof createBaseStore>;
