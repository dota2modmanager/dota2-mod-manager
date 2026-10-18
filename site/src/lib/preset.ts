/**
 * A preset link worked out when the site is built, for the pages that know their mods in advance.
 *
 * The same format as the app's own (src/preset-link.ts) and the browser's (src/scripts/catalog.ts):
 * the JSON {v, n, m} deflated raw and written in base64url. A mod's page offers "Open in Mod
 * Manager" as a preset of that one mod, which every released version of the app opens; the
 * d2mm://mod/ link that opens the mod's window instead arrives with the app version that reads it.
 * test/mod-page.test.mjs decodes these with the app's own decoder.
 */
import { deflateRawSync } from 'node:zlib';

export interface PresetMod { cat: string; name: string; style: string | null }

export function presetCode(name: string, mods: PresetMod[]): string {
  const payload = {
    v: 1,
    n: name.slice(0, 120),
    m: mods.map((m) => (m.style ? [m.cat, m.name, m.style] : [m.cat, m.name])),
  };
  return deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
}

export const appLink = (code: string) => `d2mm://preset/${code}`;
