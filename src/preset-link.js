// Presets as a link: "d2mm://preset/<code>", where <code> is the whole preset squeezed
// into a pasteable string. Only a preset made purely of catalog mods can travel this way —
// a mod the receiver can't fetch has to go as bytes, and bytes don't fit in a link.
//
// The payload is deliberately tiny: short keys, mods as bare arrays, deflate, base64url.
// Thirty catalog mods land around a thousand characters, which pastes into a Discord
// message; a .d2mm file stays the answer for anything with imports in it.
const zlib = require('zlib');
const { t } = require('./i18n.ts');

const SCHEME = 'd2mm';
/* The clickable wrapper for a d2mm:// link. Chat clients only linkify http(s), so a bare
 * d2mm:// link sits in Discord as dead text; the web form is a static page that hands the code
 * to the app. The code rides in the FRAGMENT, which browsers never send to a server, so the page
 * is served without anyone seeing the preset.
 *
 * On this project's own domain since 2026-09-10, and not on GitHub Pages, because a preset is
 * the one thing people paste to each other and a link that does not open for the part of the
 * userbase that cannot reach GitHub is not a shared preset. The same page is still served from
 * the old address, so every link anybody has already sent keeps working.
 */
const WEB_BASE = 'https://dota2modmanager.com/p/';
const CODE_RE = /^[A-Za-z0-9_-]+$/;
const MAX_CODE = 64 * 1024;
const MAX_JSON = 512 * 1024;   // inflate bomb guard
const MAX_MODS = 500;

// Cosmetic entries are tagged with this sentinel as their first array slot so a single
// compact `m` array can carry both kinds — no real categoryId is ever "$cos".
const COSMETIC_TAG = '$cos';

/**
 * @param {{name: string, author?: string, mods: Array<{kind?, categoryId, name, styleLabel, slot, itemId, effectId}>}} preset
 * @returns {{code: string, web: string, direct: string}} the clickable form and the raw one
 */
function encodePresetLink({ name, author, mods }) {
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

// Pull the code out of whatever got pasted: the web link, the d2mm:// link, or the bare
// code. Chat clients love to wrap things in spaces, angle brackets and backticks, and
// Windows hands a clicked link over with a trailing slash.
function codeFrom(input) {
  let s = String(input || '').trim().replace(/^[<`'"]+|[>`'"]+$/g, '').trim();
  if (s.includes('#')) s = s.slice(s.lastIndexOf('#') + 1);          // web form
  else s = s.replace(new RegExp(`^${SCHEME}://preset/`, 'i'), '');   // direct form
  return s.replace(/\/+$/, '').trim();
}

function decodePresetLink(input) {
  const code = codeFrom(input);
  if (!CODE_RE.test(code)) throw new Error(t('Это не похоже на ссылку на пресет'));
  if (code.length > MAX_CODE) throw new Error(t('Ссылка слишком длинная'));

  let json;
  try {
    json = zlib.inflateRawSync(Buffer.from(code, 'base64url'), { maxOutputLength: MAX_JSON }).toString('utf-8');
  } catch {
    throw new Error(t('Ссылка повреждена'));
  }
  let raw;
  try { raw = JSON.parse(json); } catch { throw new Error(t('Ссылка повреждена')); }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.m)) throw new Error(t('Ссылка повреждена'));
  if (raw.m.length > MAX_MODS) throw new Error(t('Слишком много модов в пресете'));

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
    name: (typeof raw.n === 'string' && raw.n.slice(0, 120)) || t('Пресет'),
    author: (typeof raw.a === 'string' && raw.a.slice(0, 80)) || '',
    mods,
  };
}

module.exports = { SCHEME, encodePresetLink, decodePresetLink };
