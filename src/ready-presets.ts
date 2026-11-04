// The ready-made presets (issue #391): config/presets.json on main, fetched and checked the way the
// remote config is (src/remote-config.ts) and kept between starts, so the list is there offline
// once it has been seen. The format and its checks are src/ready-presets-format.ts.
//
// Default-safe like the remote config: no file, no network, a bad signature or malformed JSON all
// leave the last good list, or none, and the Presets screen simply shows no ready presets.
import fs from 'node:fs';
import path from 'node:path';
import { fetchText } from './net.ts';
import { verify } from './catalog-signature.ts';
import { CONFIG_PUBLIC_KEY } from './remote-config.ts';
import { normalizeReady, type ReadyPreset } from './ready-presets-format.ts';

/** The list every copy of the app reads, on main in this repository; its signature is this with .sig on the end. */
export const READY_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/presets.json';

/**
 * @param opts.publicKey  whose signature to accept; the remote config's unless a test signs its own
 */
export function createReadyPresets({ userDataDir, log = () => {}, publicKey = CONFIG_PUBLIC_KEY }: {
  userDataDir: string; log?: (msg: string) => void; publicKey?: string;
}) {
  const file = path.join(userDataDir, 'ready-presets.json');
  let cache: ReadyPreset[] | null = null;

  function list(): ReadyPreset[] {
    if (cache) return cache;
    try { cache = normalizeReady(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch { cache = []; }
    return cache;
  }

  /** Fetch, check and keep. Never throws: offline is the normal case. */
  async function refresh(): Promise<ReadyPreset[]> {
    try {
      const text = await fetchText(READY_URL);
      const sig = await fetchText(`${READY_URL}.sig`);
      if (!verify(text, sig, publicKey)) throw new Error('signature does not match');
      const raw = JSON.parse(text);
      cache = normalizeReady(raw);
      fs.writeFileSync(file, JSON.stringify(raw));
      log(`ready presets: ${cache.length}`);
    } catch (err) {
      log(`ready presets not fetched: ${err instanceof Error ? err.message : err}`);
      list();
    }
    return cache || [];
  }

  const get = (id: string): ReadyPreset | null => list().find((p) => p.id === id) || null;

  return { list, refresh, get };
}
