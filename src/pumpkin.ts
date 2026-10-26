/* The pumpkin's side of the key (renderer/ui/pumpkin.ts asks, tools/pumpkin-worker answers).
 *
 * Each key the site hands out opens one pumpkin. This install has a name of its own for that, a
 * random one made the first time it is needed and never sent anywhere else, and the worker ties
 * a key to the first name that brings it. A key posted in a channel is spent by whoever is first;
 * everybody after gets "used".
 *
 * What the key opens: the bloody theme (settings `blood`) and a mod nobody else has yet, which is
 * downloaded from the worker, the one place that knows whether this install may have it, and
 * then taken in the way any .vpk somebody drops on the window is (src/import.ts). The key is
 * kept, so the mod can be fetched again after it was removed.
 *
 * Forgiving about typing in the same way the old lock was: case, spaces and dashes do not count,
 * and a key typed on a Russian layout or with Cyrillic look-alikes is read back as the Latin it
 * meant.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { downloadProxyFetchInit } from './download-proxy.ts';
import { errorText } from './error-text.ts';

/** The worker that keeps the keys and the prize (tools/pumpkin-worker). */
export const PUMPKIN_HOST = 'https://pumpkin.dota2modmanager.com';
/** What the mod is called in the library. */
export const PRIZE_NAME = 'Necrophos - Scream';

// the ЙЦУКЕН keys, in the order of the QWERTY keys they sit on
const RU_KEYS = 'йцукенгшщзфывапролдячсмить';
const EN_KEYS = 'qwertyuiopasdfghjklzxcvbnm';
// Cyrillic capitals that look like Latin ones
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Every reading of what was typed that could be a key: 16 Latin letters and digits. */
export function readings(typed: string): string[] {
  const asKeys = [...typed.toLowerCase()].map((c) => { const i = RU_KEYS.indexOf(c); return i < 0 ? c : EN_KEYS[i]; }).join('');
  const asLooks = [...typed.toUpperCase()].map((c) => LOOKALIKE[c] ?? c).join('');
  return [...new Set([plain(asLooks), plain(typed), plain(asKeys)])].filter((r) => r.length === 16);
}

/** Which night this install has been through: a new number makes everybody walk it again. */
export const NIGHT_ROUND = 1;

/**
 * The night from the beginning, once per round, for every install: the pumpkin goes back in, the
 * two themes it opened close, and a window wearing one of them goes back to Ursa. The key spent
 * and the mod it brought stay: that mod was earned (src/scream-guard.ts), only the way to the
 * theme has to be found again. True when this start was the one that reset it.
 */
export function beginNightAgain(settings: Deps['settings']): boolean {
  if (settings.get('nightRound') === NIGHT_ROUND) return false;
  for (const k of ['pumpkin', 'secret', 'pumpkinLit', 'blood']) settings.set(k, false);
  const theme = settings.get('theme');
  if (theme === 'secret' || theme === 'blood') settings.set('theme', 'ursa');
  settings.set('nightRound', NIGHT_ROUND);
  return true;
}

/** What the window is told after a key: the night opened (and whether the mod came with it), or why not. */
export type RedeemAnswer =
  | { ok: true; installed: string | null; installError?: string }
  | { error: 'empty' | 'wrong' | 'used' | 'offline' | 'broken'; detail?: string };

interface Deps {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  /** take a .vpk in as a mod (src/services.ts importVpkPaths) */
  importVpkPaths: (paths: string[]) => Promise<unknown>;
  library: { list(): Array<{ id: string; name: string; files: Array<{ relPath: string }> }>; update(id: string, fields: { preview?: string | null }): unknown };
  fetch?: typeof fetch;
  host?: string;
  log?: (msg: string) => void;
}

/** The pumpkin's side in the main process: spend a key, fetch the prize again, say whether it is here. */
export function createPumpkin({ settings, importVpkPaths, library, fetch: get = fetch, host = PUMPKIN_HOST, log = () => {} }: Deps) {
  const call = (p: string, init: RequestInit = {}) => get(`${host}${p}`, {
    ...init, signal: AbortSignal.timeout(120000), ...downloadProxyFetchInit(),
  } as RequestInit);

  /** This install's name for the worker, made the first time it is asked for. */
  const install = (): string => {
    let id = settings.get('pumpkinInstall');
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
      id = crypto.randomBytes(16).toString('hex');
      settings.set('pumpkinInstall', id);
    }
    return id as string;
  };

  /** Download the prize and take it in as a mod. The name of the record, or why not. */
  async function fetchPrize(key: string): Promise<{ name: string } | { error: string }> {
    const q = `key=${encodeURIComponent(key)}&install=${install()}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pumpkin-'));
    try {
      const res = await call(`/mod?${q}`);
      if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };
      const file = path.join(dir, `${PRIZE_NAME}.vpk`);
      await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(file));
      const answer = await importVpkPaths([file]) as { imported?: Array<{ name: string; relPath: string }>; errors?: Array<{ error?: string }>; error?: string };
      const got = answer.imported?.[0];
      if (!got) return { error: answer.error || answer.errors?.[0]?.error || 'not imported' };
      // its picture, so the library shows what it is rather than a blank
      try {
        const pic = await call(`/mod/preview?${q}`);
        if (pic.ok) {
          const rec = library.list().find((r) => r.files?.[0]?.relPath === got.relPath);
          const data = Buffer.from(await pic.arrayBuffer()).toString('base64');
          if (rec) library.update(rec.id, { preview: `data:${pic.headers.get('Content-Type') || 'image/png'};base64,${data}` });
        }
      } catch { /* a mod without a picture is still the mod */ }
      return { name: got.name };
    } catch (err) {
      return { error: errorText(err) };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }

  /** Spend a key on this install: the theme, then the mod. */
  async function redeem(typed: unknown): Promise<RedeemAnswer> {
    const tries = readings(String(typed ?? ''));
    if (!tries.length) return { error: String(typed ?? '').trim() ? 'wrong' : 'empty' };
    let answer: RedeemAnswer = { error: 'wrong' };
    for (const key of tries) {
      let res: Response;
      try {
        res = await call('/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, install: install() }) });
      } catch (err) {
        log(`pumpkin: ${errorText(err)}`);
        return { error: 'offline', detail: errorText(err) };
      }
      if (res.ok) {
        settings.set('blood', true);
        settings.set('bloodKey', key);
        const prize = await fetchPrize(key);
        if ('error' in prize) log(`pumpkin: the prize did not land: ${prize.error}`);
        return 'error' in prize ? { ok: true, installed: null, installError: prize.error } : { ok: true, installed: prize.name };
      }
      if (res.status === 409) answer = { error: 'used' };
      else if (res.status !== 404 && res.status !== 400) answer = { error: 'broken', detail: `HTTP ${res.status}` };
    }
    return answer;
  }

  /** The mod again, for an install that has spent its key and removed the mod since. */
  async function prizeAgain(): Promise<{ ok: true; installed: string } | { error: string }> {
    const key = settings.get('bloodKey');
    if (typeof key !== 'string' || !key) return { error: 'no key' };
    const prize = await fetchPrize(key);
    return 'error' in prize ? prize : { ok: true, installed: prize.name };
  }

  /** Whether the prize is in the library now. */
  const hasPrize = () => library.list().some((r) => r.name === PRIZE_NAME);

  return { redeem, prizeAgain, hasPrize, install };
}
