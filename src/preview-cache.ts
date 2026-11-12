/* The catalog's pictures, kept on this disk and served from it.
 *
 * The window used to ask raw.githubusercontent.com for every preview itself and turn to the mirror
 * only once that failed. Where GitHub answers, that is under a second. Where it is blocked the
 * connection hangs rather than failing: measured 2026-11-07, 33 category pictures on a clean run
 * and not one drawn a minute later, while the catalog itself had loaded in seconds. The picture
 * did not fail for the fallback to start, it just never came.
 *
 * So the window's requests for a catalog picture are redirected here (servePreviews). A picture on
 * disk is answered from disk. One that is not goes to the mirror first, because that host is not
 * blocked and its edge cache keeps a picture a few hundred kilobytes away from anybody; the other
 * hosts join in after a moment instead of after a timeout. warm() then fetches the rest of the
 * catalog in the background, a few at a time, so a category somebody opens for the first time is
 * on disk already.
 *
 * Hosts that fetch GitHub on behalf of anybody (ghproxy and friends) stay out of this list. They
 * carry mod archives because a digest checks those. A picture has no digest and goes straight to
 * an image decoder, so it comes from a host that holds the catalog's own files.
 *
 * Videos stay out too: they are hundreds of megabytes together and the player wants Range
 * requests. The window asks the mirror for those directly (ui/media.ts).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { pictureBases } from './net-mirrors.ts';
import { downloadProxyFetchInit } from './download-proxy.ts';

/** The address scheme the window's pictures are answered on. */
export const SCHEME = 'mm-preview';
/** What the window has to be told about the scheme, before the app is ready. */
export const PRIVILEGED_SCHEME = { scheme: SCHEME, privileges: { standard: true, secure: true } };
const ORIGIN = `${SCHEME}://catalog/`;
const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/';
const MIRROR = 'https://cdn.dota2modmanager.com/';
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/h6rd/Dota2PornFxWeb@main/';
const PREVIEWS = 'assets/previews/';

/** The address pattern the window's picture requests are caught by. */
export const WATCHED = `${RAW}${PREVIEWS}*`;

/** How long the next host waits for the one before it to answer. */
const STAGGER_MS = 1500;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 8 * 1024 * 1024;
/** A picture older than this is asked about again, in case its author replaced it under the same name. */
export const FRESH_MS = 7 * 24 * 3600 * 1000;
const WARM_WORKERS = 3;
/** This many misses in a row and the network is down, so warming stops until the next start. */
const WARM_GIVE_UP = 8;

/** The catalog path of a picture address, encoded as it arrived, or null for anything else. */
export function pictureOf(url: string): string | null {
  const at = url.startsWith(RAW) ? RAW.length : url.startsWith(ORIGIN) ? ORIGIN.length : -1;
  if (at < 0) return null;
  const rel = url.slice(at).split(/[?#]/)[0];
  if (!rel.startsWith(PREVIEWS) || !/\.(webp|png|gif|jpe?g|ico)$/i.test(rel)) return null;
  let plain: string;
  try { plain = decodeURIComponent(rel); } catch { return null; }
  return plain.split(/[\\/]/).includes('..') ? null : rel;
}

/** Where the window's request goes instead; null leaves it alone. */
export function redirectFor(url: string): string | null {
  const rel = url.startsWith(RAW) ? pictureOf(url) : null;
  return rel ? ORIGIN + rel : null;
}

/** What these bytes really are, or null when they are no picture at all: a host's error page, say. */
export function pictureType(b: Uint8Array): string | null {
  const is = (at: number, ...sig: number[]) => sig.every((v, i) => b[at + i] === v);
  if (is(0, 0x52, 0x49, 0x46, 0x46) && is(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (is(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (is(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (is(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (is(0, 0, 0, 1, 0)) return 'image/x-icon';
  return null;
}

/** Hosts that carry this picture, best first. */
export function hostsFor(rel: string): string[] {
  const below = rel.slice(PREVIEWS.length);
  return [MIRROR + rel, RAW + rel, JSDELIVR + rel, ...pictureBases().map((b) => b + below)];
}

/** Every picture the catalog names, categories first, encoded the way the window asks for them. */
export function picturesIn(mods: unknown, constants: unknown): string[] {
  const out = new Set<string>();
  const add = (cat: string, name: string) => {
    if (/^https?:/i.test(name)) return;
    const rel = name.startsWith(PREVIEWS) ? name : `${PREVIEWS}${cat}/${name}`;
    const safe = rel.split('/').map(encodeURIComponent).join('/');
    if (pictureOf(RAW + safe)) out.add(safe);
  };
  const walk = (node: unknown, cat: string) => {
    if (Array.isArray(node)) { for (const x of node) walk(x, cat); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'preview' && typeof v === 'string' && v) add(cat, v);
      else if (typeof v === 'object') walk(v, cat);
    }
  };
  const categories = (constants as { categories?: { preview?: string }[] } | null)?.categories;
  for (const c of categories || []) if (c.preview) add('categories', c.preview);
  const byCat = (mods as { modsData?: Record<string, unknown> } | null)?.modsData || {};
  for (const [cat, data] of Object.entries(byCat)) walk(data, cat);
  return [...out];
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface StoreOptions {
  dir: string;
  fetchFn?: Fetch;
  stagger?: number;
  log?: (msg: string) => void;
}

/** A picture ready to hand over. */
export interface Picture { bytes: Uint8Array; type: string }

/** The folder of pictures, and the one way in and out of it. */
export function createPreviewStore({
  dir, fetchFn = (url, init) => fetch(url, { ...init, ...downloadProxyFetchInit() } as RequestInit), stagger = STAGGER_MS, log = () => {},
}: StoreOptions) {
  const pending = new Map<string, Promise<Picture | null>>();
  const fileOf = (rel: string) => path.join(dir, crypto.createHash('sha1').update(rel).digest('hex'));

  async function attempt(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Picture | 'same' | null> {
    const res = await fetchFn(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    if (res.status === 304) return 'same';
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length')) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = bytes.length <= MAX_BYTES ? pictureType(bytes) : null;
    return type ? { bytes, type } : null;
  }

  /** The first host with the picture. A slow host loses its turn without losing its chance. */
  function firstAnswer(rel: string): Promise<Picture | null> {
    const urls = hostsFor(rel);
    const stop = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      let left = urls.length;
      let next = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (p: Picture | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop.abort();
        resolve(p);
      };
      const failed = () => { left -= 1; if (left <= 0) finish(null); else launch(); };
      const launch = () => {
        clearTimeout(timer);
        if (settled || next >= urls.length) return;
        const url = urls[next++];
        timer = setTimeout(launch, stagger);
        attempt(url, stop.signal).then((p) => {
          if (p && p !== 'same') finish(p); else failed();
        }, failed);
      };
      launch();
    });
  }

  async function keep(file: string, bytes: Uint8Array): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
    const part = `${file}.${process.pid}.part`;
    await fsp.writeFile(part, bytes);
    await fsp.rename(part, file);
  }

  /** Asks the mirror whether a picture on disk has changed. The next look shows the new one. */
  async function recheck(rel: string, file: string, since: Date): Promise<void> {
    const headers = { 'If-Modified-Since': since.toUTCString() };
    const p = await attempt(MIRROR + rel, new AbortController().signal, headers);
    if (p === 'same') await fsp.utimes(file, new Date(), new Date());
    else if (p) await keep(file, p.bytes);
  }

  async function fromDisk(rel: string, file: string): Promise<Picture | null> {
    let bytes: Uint8Array;
    try { bytes = await fsp.readFile(file); } catch { return null; }
    const type = pictureType(bytes);
    if (!type) return null;
    const { mtime } = await fsp.stat(file);
    if (Date.now() - mtime.getTime() > FRESH_MS && !pending.has(`?${rel}`)) {
      const check = recheck(rel, file, mtime).catch(() => {}).then(() => { pending.delete(`?${rel}`); return null; });
      pending.set(`?${rel}`, check);
    }
    return { bytes, type };
  }

  /** The picture, from disk if it is there and from the network if not; null when nobody has it. */
  function get(rel: string): Promise<Picture | null> {
    const running = pending.get(rel);
    if (running) return running;
    const file = fileOf(rel);
    const work = (async () => {
      const held = await fromDisk(rel, file);
      if (held) return held;
      const got = await firstAnswer(rel);
      if (got) await keep(file, got.bytes).catch((e) => log(`picture not kept: ${(e as Error).message}`));
      return got;
    })().finally(() => pending.delete(rel));
    pending.set(rel, work);
    return work;
  }

  let warming = false;

  /** Fetches whatever of this list is not on disk, without getting in the way of the window. */
  async function warm(rels: string[]): Promise<number> {
    if (warming) return 0;
    warming = true;
    try {
      const have = new Set(await fsp.readdir(dir).catch(() => [] as string[]));
      const todo = rels.filter((r) => !have.has(path.basename(fileOf(r))));
      let misses = 0;
      let fetched = 0;
      const worker = async () => {
        while (todo.length && misses < WARM_GIVE_UP) {
          if (await get(todo.shift()!)) { misses = 0; fetched += 1; } else misses += 1;
        }
      };
      await Promise.all(Array.from({ length: WARM_WORKERS }, worker));
      if (fetched) log(`pictures: ${fetched} fetched ahead, ${todo.length} left`);
      return fetched;
    } finally { warming = false; }
  }

  return { get, warm };
}

/** What createPreviewStore hands back. */
export type PreviewStore = ReturnType<typeof createPreviewStore>;

/** Answers the scheme from the store and points the window's picture requests at it. */
export function servePreviews(session: Electron.Session, store: PreviewStore): void {
  session.protocol.handle(SCHEME, async (req) => {
    const rel = pictureOf(req.url);
    const got = rel ? await store.get(rel) : null;
    if (!got) return new Response(null, { status: 502 });
    return new Response(Buffer.from(got.bytes), {
      headers: { 'Content-Type': got.type, 'X-Content-Type-Options': 'nosniff' },
    });
  });
  session.webRequest.onBeforeRequest({ urls: [WATCHED] }, (details, answer) => {
    const to = redirectFor(details.url);
    answer(to ? { redirectURL: to } : {});
  });
}
