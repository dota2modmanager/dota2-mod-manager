/**
 * The arcana bases (src/arcana-bases.ts) brought down from their repository and kept here, so a
 * build reads them from disk like it reads pak01.
 *
 * The repository holds each base as its compiled files under src/<id>/, and a VPK of the same
 * files beside them for people to try by hand; the app takes the files. What is there is read from
 * manifest.json in the repository, every file of every base with git's hash of it, and
 * manifest.json.sig beside it: tools/arcana-bases-manifest.mjs writes both from the files, so
 * they go up in the same commit. The app takes the list only when the signature is good against
 * BASES_PUBLIC_KEY, and then each file only when it matches its hash, so a mirror (src/net.ts) can
 * be trusted with all of it. Where neither can be had, or the signature is not good, the list from
 * last time, checked again.
 *
 * Signed since 2026-10-30. Before that the list was the repository's git tree, and whatever was
 * pushed to its main reached everybody who picked that arcana with no signature of ours: a second
 * key now stands between a push and the users, as the catalog's does (src/catalog-signature.ts).
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
import { verify } from './catalog-signature.ts';
import { entryAt, type VpkEntry } from './vpk.ts';

/** Where the bases are published, owner/name on GitHub: J0nathan550/d2pfx-arcana-fixes until 2026-10-30. */
export const BASES_REPO = 'dota2modmanager/hero-base-fixes';
const BRANCH = 'main';
/**
 * Base64 SPKI of the ed25519 key the bases' manifest is signed with. J0nathan550 holds the
 * private half; `tools/sign-catalog.js --keygen` makes a pair in this form. Not the catalog's key:
 * that one belongs to the catalog's author, and the bases are not his to vouch for.
 */
export const BASES_PUBLIC_KEY = 'MCowBQYDK2VwAyEAAzqINyzZu0s84UbXXU+9uRuN0Z8IH7TO2oSCMO0tcMU=';
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

/**
 * The bases in a manifest, or null when its signature is not the bases' key's over exactly these
 * bytes. Nothing in an unsigned list is taken, not even what safeListing would let through.
 */
export function signedListing(manifest: string, sig: string, key: string = BASES_PUBLIC_KEY): Listing | null {
  if (!verify(manifest, sig, key)) return null;
  try {
    return safeListing((JSON.parse(manifest) as { bases?: unknown }).bases);
  } catch {
    return null;
  }
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
  /** the network, for tests: a URL to a Response. Mirrored, since everything it brings is signed or hashed */
  fetchUrl?: (url: string, opts: { small?: boolean }) => Promise<Response>;
  /** the key the list has to be signed with, for tests; BASES_PUBLIC_KEY */
  key?: string;
}

/** The bases on disk, and bringing one down when a build needs it (the header says how). */
export function createBaseStore({ dir, onReady = () => {}, log = () => {}, fetchUrl = fetchMirrored, key = BASES_PUBLIC_KEY }: BaseStoreDeps) {
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
  /** the files of each base coming down now, which no sweep may take before it is ready */
  const coming = new Map<string, Record<string, string>>();

  async function fetchListing(): Promise<Listing> {
    // stored as it came, signature and all, and checked again when read: a list on disk is only as
    // good as the key that signed it, and one kept from before the signing is not taken
    const cached = readJson<{ manifest?: string; sig?: string }>(listingFile, {});
    try {
      const get = async (rel: string) => {
        const res = await fetchUrl(rawUrl(rel), { small: true });
        if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
        return res.text();
      };
      const [manifest, sig] = await Promise.all([get('manifest.json'), get('manifest.json.sig')]);
      // the two are cached apart on the way, so for a few minutes after a push they can disagree:
      // that reads as a bad signature, and the list from last time does until they agree
      const bases = signedListing(manifest, sig, key);
      if (!bases) throw new Error('manifest.json is not signed by the bases\' key');
      if (!Object.keys(bases).length) throw new Error('no bases in it');
      fs.mkdirSync(dir, { recursive: true });
      writeJson(listingFile, { manifest, sig });
      return bases;
    } catch (err) {
      log(`arcana bases: the list could not be had: ${(err as Error).message}`);
    }
    const bases = cached.manifest && cached.sig ? signedListing(cached.manifest, cached.sig, key) : null;
    if (bases) return bases;
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

  /**
   * Files no base here uses any more: an old version's, once the new one is whole. Not those of a
   * base still coming down: Anti-Mage's base whole swept a file Invoker's had already brought, and
   * his was then ready with it missing (2026-10-27).
   */
  function sweep(have: Listing) {
    const used = new Set([...Object.values(have), ...coming.values()].flatMap((files) => Object.values(files)));
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
    coming.set(id, files);
    try {
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    } finally {
      coming.delete(id);
    }
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
        // a file gone from the disk: brought down again by the next want, in this run and not the next
        asked.delete(id);
        return null;
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
