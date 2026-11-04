/*
 * The preset bot (issue #434): somebody shares a preset link in Discord, and the bot answers with
 * what is in it, the mods' covers and a button that opens it. A Cloudflare Worker on Discord's
 * HTTP interactions, with no gateway connection to keep alive, so it is asked rather than reading
 * the channel: `/preset link:<link>`, or Apps > "Show preset" on a message that has one.
 *
 * The link is decoded here, without the app, the same way src/preset-link.ts decodes it (the test
 * holds the two to the same answers). Names, covers and pages come from the site's public catalog
 * data, /catalog/data.json, kept for an hour per instance. Nothing about the preset is stored.
 *
 * Secrets: DISCORD_PUBLIC_KEY (the application's public key, hex), which every request is
 * checked against, as Discord requires. README.md has the rest.
 */

const SITE = 'https://dota2modmanager.com';
const WEB_BASE = `${SITE}/p/`;
const COSMETIC_TAG = '$cos';
const MAX_CODE = 64 * 1024;
const MAX_JSON = 512 * 1024;
const MAX_MODS = 500;
const CODE_RE = /^[A-Za-z0-9_-]+$/;
// the embed's colour: the window's lavender
const COLOR = 0xb89cff;
const LISTED = 15;
const COVERS = 4;
const CATALOG_TTL = 60 * 60 * 1000;

/** A preset link's code in any text: the site's link, the app's d2mm:// link, or the bare code. */
export function findCode(text) {
  const s = String(text || '');
  const web = s.match(/dota2modmanager\.com\/p\/?#([A-Za-z0-9_-]+)/) || s.match(/github\.io\/dota2-mod-manager\/p\/?#([A-Za-z0-9_-]+)/);
  if (web) return web[1];
  const direct = s.match(/d2mm:\/\/preset\/([A-Za-z0-9_-]+)/i);
  if (direct) return direct[1];
  const bare = s.trim().replace(/^[<`'"]+|[>`'"]+$/g, '');
  return CODE_RE.test(bare) && bare.length > 16 ? bare : null;
}

function base64url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function inflateRaw(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON) { await reader.cancel(); throw new Error('too big'); }
    parts.push(value);
  }
  return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}

/**
 * A code back into a preset, with src/preset-link.ts's rules: its name, author and mods, or null
 * for anything that is not a preset.
 */
export async function decodeCode(code) {
  if (!code || !CODE_RE.test(code) || code.length > MAX_CODE) return null;
  let raw;
  try { raw = JSON.parse(await inflateRaw(base64url(code))); } catch { return null; }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.m) || raw.m.length > MAX_MODS) return null;
  const mods = raw.m
    .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
    .map((e) => (e[0] === COSMETIC_TAG
      ? { kind: 'cosmetic', slot: e[1].slice(0, 60), itemId: String(e[2] ?? '').slice(0, 20), name: String(e[3] ?? '').slice(0, 300), effectId: typeof e[4] === 'string' ? e[4].slice(0, 60) : '' }
      : { kind: 'catalog', categoryId: e[0].slice(0, 60), name: e[1].slice(0, 300), styleLabel: typeof e[2] === 'string' ? e[2].slice(0, 300) : null }))
    .filter((e) => e.kind !== 'cosmetic' || (e.slot && e.itemId));
  return {
    name: (typeof raw.n === 'string' && raw.n.slice(0, 120)) || '',
    author: (typeof raw.a === 'string' && raw.a.slice(0, 80)) || '',
    mods,
  };
}

let catalog = null;
/** The site's catalog, as a lookup by category and name, kept for an hour. */
export async function loadCatalog(fetchImpl = fetch, now = Date.now()) {
  if (catalog && now - catalog.at < CATALOG_TTL) return catalog;
  const r = await fetchImpl(`${SITE}/catalog/data.json`);
  if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
  const raw = await r.json();
  const cats = raw.cats.map((c) => ({ id: c[0], en: c[1], ru: c[2] }));
  const mods = new Map();
  for (const m of raw.mods) {
    const cat = cats[m[2]];
    if (cat) mods.set(`${cat.id}|${m[1].toLowerCase()}`, { key: m[0], img: m[4] ? `${SITE}/mods/${m[4]}.webp` : null });
  }
  catalog = { at: now, cats: new Map(cats.map((c) => [c.id, c])), mods };
  return catalog;
}
/** For the tests: forget the kept catalog. */
export const forgetCatalog = () => { catalog = null; };

const say = (ru, en) => (lang) => (lang === 'ru' ? ru : en);
const plural = (n, one, few, many) => {
  const t = n % 100;
  const u = n % 10;
  return t >= 11 && t <= 14 ? many : u === 1 ? one : u >= 2 && u <= 4 ? few : many;
};
const T = {
  noLink: say('В сообщении нет ссылки на пресет.', 'There is no preset link in that message.'),
  broken: say('Ссылка на пресет повреждена.', 'That preset link is damaged.'),
  preset: say('Пресет', 'Preset'),
  mods: (n) => say(`${n} ${plural(n, 'мод', 'мода', 'модов')}`, `${n} mod${n === 1 ? '' : 's'}`),
  more: (n) => say(`…и ещё ${n}`, `…and ${n} more`),
  look: say('вид из игры', 'in-game look'),
  open: say('Открыть пресет', 'Open the preset'),
  by: (a) => say(`от ${a}`, `by ${a}`),
};

/** The answer to a preset: an embed with its mods and up to four covers, and a button to it. */
export function presetMessage(preset, code, cat, lang) {
  const url = `${WEB_BASE}#${code}`;
  const covers = [];
  const lines = preset.mods.map((m) => {
    if (m.kind === 'cosmetic') return `• ${m.name || m.itemId} · *${T.look(lang)}*`;
    const hit = cat?.mods.get(`${m.categoryId}|${m.name.toLowerCase()}`);
    const c = cat?.cats.get(m.categoryId);
    if (hit?.img && covers.length < COVERS) covers.push(hit.img);
    const name = hit ? `[${m.name}](${SITE}${lang === 'ru' ? '/ru' : ''}/mods/${hit.key}/)` : m.name;
    return `• ${name}${m.styleLabel ? ` (${m.styleLabel})` : ''}${c ? ` · ${lang === 'ru' ? c.ru : c.en}` : ''}`;
  });
  const shown = lines.slice(0, LISTED);
  if (lines.length > LISTED) shown.push(T.more(lines.length - LISTED)(lang));
  const main = {
    title: (preset.name || T.preset(lang)).slice(0, 256),
    url,
    color: COLOR,
    description: shown.join('\n').slice(0, 4000),
    footer: { text: [T.mods(preset.mods.length)(lang), preset.author && T.by(preset.author)(lang)].filter(Boolean).join(' · ') },
  };
  // embeds that share a url are drawn by Discord as one embed with a gallery of their images
  const embeds = covers.length ? [{ ...main, image: { url: covers[0] } }, ...covers.slice(1).map((img) => ({ url, image: { url: img } }))] : [main];
  return {
    embeds,
    components: [{ type: 1, components: [{ type: 2, style: 5, label: T.open(lang), url }] }],
    allowed_mentions: { parse: [] },
  };
}

function hex(s) {
  return Uint8Array.from(String(s).match(/../g) || [], (b) => parseInt(b, 16));
}

/** Discord's check: the timestamp and the body, signed by the application's key. */
export async function verifyRequest(body, signature, timestamp, publicKeyHex) {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
// only the one who asked sees an answer that is an error
const privately = (content) => json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

/** An interaction: which text it points at, and the answer to it. */
export async function answer(interaction, fetchImpl = fetch) {
  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2) return json({ error: 'unknown interaction' }, 400);
  const lang = String(interaction.locale || '').startsWith('ru') ? 'ru' : 'en';
  const d = interaction.data || {};
  const text = d.type === 3
    ? Object.values(d.resolved?.messages || {})[0]?.content
    : (d.options || []).find((o) => o.name === 'link')?.value;
  const code = findCode(text);
  if (!code) return privately(T.noLink(lang));
  const preset = await decodeCode(code);
  if (!preset || !preset.mods.length) return privately(T.broken(lang));
  // the catalog only adds covers and pages: without it the answer still lists the mods
  const cat = await loadCatalog(fetchImpl).catch(() => null);
  return json({ type: 4, data: presetMessage(preset, code, cat, lang) });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('The Dota 2 Mod Manager preset bot. Discord sends its interactions here.', { status: 200 });
    const body = await request.text();
    const ok = await verifyRequest(body, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), env.DISCORD_PUBLIC_KEY);
    if (!ok) return new Response('bad signature', { status: 401 });
    let interaction;
    try { interaction = JSON.parse(body); } catch { return new Response('bad body', { status: 400 }); }
    return answer(interaction);
  },
};
