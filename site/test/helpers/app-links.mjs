// The app's two link formats, read and written the way the app does it, for the site's tests:
// a preset link (d2mm://preset/<code> or https://dota2modmanager.com/p/#<code>) and a mod link
// (d2mm://mod/<category>/<name>[/<look>]). The site builds both in its own code
// (site/src/lib/preset.ts, site/src/scripts/catalog.ts), and the tests read them back with this,
// so a link the site writes is one the app opens.
//
// The app's own code is Rust (crates/mm-core/src/presets/preset_link.rs and
// crates/mm-core/src/catalog/deep_links.rs). test/app-links.test.ts holds this module to it through
// mm-cli, so the two cannot drift. Errors here are in English; the app translates its own.
import zlib from 'node:zlib';

export const SCHEME = 'd2mm';
const WEB_BASE = 'https://dota2modmanager.com/p/';
const CODE_RE = /^[A-Za-z0-9_-]+$/;
const MAX_CODE = 64 * 1024;
const MAX_JSON = 512 * 1024;
const MAX_MODS = 500;
// a cosmetic pick rides in the same list as catalog mods, tagged by its first slot
const COSMETIC_TAG = '$cos';

/** A preset into its link: { code, web, direct }. */
export function encodePresetLink({ name, author, mods }) {
  const payload = {
    v: 1,
    n: String(name || '').slice(0, 120),
    m: mods.map((m) => (m.kind === 'cosmetic'
      ? [COSMETIC_TAG, m.slot, m.itemId, m.name, m.effectId || '']
      : (m.styleLabel ? [m.categoryId, m.name, m.styleLabel] : [m.categoryId, m.name]))),
  };
  if (author) payload.a = String(author).slice(0, 80);
  const code = zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf-8'), { level: 9 }).toString('base64url');
  return { code, web: `${WEB_BASE}#${code}`, direct: `${SCHEME}://preset/${code}` };
}

// the code out of whatever was pasted: the web link, the d2mm:// link or the bare code, with
// the spaces, brackets, backticks and trailing slash chat clients and Windows add
function codeFrom(input) {
  let s = String(input || '').trim().replace(/^[<`'"]+|[>`'"]+$/g, '').trim();
  if (s.includes('#')) s = s.slice(s.lastIndexOf('#') + 1);
  else s = s.replace(new RegExp(`^${SCHEME}://preset/`, 'i'), '');
  return s.replace(/\/+$/, '').trim();
}

/** A pasted link back into { name, author, mods }; throws when it is not a preset link. */
export function decodePresetLink(input) {
  const code = codeFrom(input);
  if (!CODE_RE.test(code)) throw new Error('not a preset link');
  if (code.length > MAX_CODE) throw new Error('the link is too long');
  let raw;
  try {
    raw = JSON.parse(zlib.inflateRawSync(Buffer.from(code, 'base64url'), { maxOutputLength: MAX_JSON }).toString('utf-8'));
  } catch {
    throw new Error('the link is damaged');
  }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.m)) throw new Error('the link is damaged');
  if (raw.m.length > MAX_MODS) throw new Error('too many mods in the preset');
  const mods = raw.m
    .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
    .map((e) => (e[0] === COSMETIC_TAG
      ? {
        kind: 'cosmetic',
        slot: e[1].slice(0, 60),
        itemId: String(e[2] ?? '').slice(0, 20),
        name: String(e[3] ?? '').slice(0, 300),
        effectId: typeof e[4] === 'string' ? e[4].slice(0, 60) : '',
      }
      : {
        kind: 'catalog',
        categoryId: e[0].slice(0, 60),
        name: e[1].slice(0, 300),
        styleLabel: typeof e[2] === 'string' ? e[2].slice(0, 300) : null,
        fp: null,
      }))
    .filter((e) => e.kind !== 'cosmetic' || (e.slot && e.itemId));
  return {
    name: (typeof raw.n === 'string' && raw.n.slice(0, 120)) || 'Preset',
    author: (typeof raw.a === 'string' && raw.a.slice(0, 80)) || '',
    mods,
  };
}

const MOD_LINK = new RegExp(`^${SCHEME}://mod(?:/|$)`, 'i');

/** d2mm://mod/<category>/<name>[/<look>], each part URL-encoded: a name may hold a slash. */
export function modLinkUrl({ cat, name, style }) {
  return [`${SCHEME}://mod`, cat, name, ...(style ? [style] : [])].map((p, i) => (i ? encodeURIComponent(p) : p)).join('/');
}

/** The { cat, name, style } a d2mm://mod/ link names, or null. A trailing slash, a query and a
 * fragment say nothing about the mod. */
export function parseModLink(url) {
  if (!MOD_LINK.test(url)) return null;
  const parts = url.replace(MOD_LINK, '').replace(/[?#].*$/, '').split('/').filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  try {
    const [cat, name, style] = parts.map((p) => decodeURIComponent(p).trim());
    return cat && name ? { cat, name, style: style || null } : null;
  } catch { return null; }
}
