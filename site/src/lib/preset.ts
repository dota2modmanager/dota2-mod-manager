/**
 * The links a mod's page offers the app, worked out when the site is built.
 *
 * A preset link is the app's own format (src/preset-link.ts) and the browser's
 * (src/scripts/catalog.ts): the JSON {v, n, m} deflated raw and written in base64url. Every
 * released version opens one. A mod link, d2mm://mod/<category>/<name>[/<style>] with each part
 * encoded as src/deep-links.ts modLinkUrl writes it, opens the mod's own window instead, and only
 * an app from 2.15.0 on reads it. A mod's page offers the mod link once a version that reads it
 * has been published, and the preset of that one mod until then, so no button leads an installed
 * app nowhere. test/mod-page.test.mjs and test/static.test.mjs read both back with the app's code.
 */
import { deflateRawSync } from 'node:zlib';
import { compareVersions, latestRelease } from './changes';

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

export const modLink = ({ cat, name, style }: PresetMod) =>
  ['d2mm://mod', cat, name, ...(style ? [style] : [])].map((p, i) => (i ? encodeURIComponent(p) : p)).join('/');

/** The first version that opens a d2mm://mod/ link. */
export const MOD_LINKS_SINCE = '2.15.0';

/**
 * How this build's mod pages open a mod in the app: by its own link when the newest published
 * release reads one, else as a preset of that mod. A build that could not ask GitHub keeps the
 * preset, which every version opens.
 */
export async function openInApp(): Promise<(m: PresetMod) => string> {
  const latest = await latestRelease();
  return latest && compareVersions(latest, MOD_LINKS_SINCE) >= 0 ? modLink : (m) => appLink(presetCode(m.name, [m]));
}
