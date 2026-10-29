/**
 * Build the hero pages' data, and fetch the pictures that go on them.
 *
 * Two sources have to meet here. hero-index.json, written by the fingerprint job in the repo
 * root, says which heroes a mod is actually about - the catalog does not record that, and
 * "Bare Brewmaster" says Brewmaster only to a human. The catalog says what each mod looks
 * like and who made it.
 *
 * The previews are copied onto our own domain rather than linked from the catalog's raw
 * GitHub URLs. Two reasons: raw.githubusercontent is not a CDN and hotlinking it is somebody
 * else's bandwidth, and an image served from another domain is not an image an image search
 * will credit to this site, which is the whole point of putting them here. h6rd gave
 * permission for the previews and the names on 2026-08-15, and every mod carries its author's
 * name and profile link where the catalog records one.
 *
 * All 468 hero previews are webp averaging 14 KB, so they are committed as they are rather
 * than re-encoded: six megabytes total, and re-encoding somebody's artwork to save three of
 * them is not a trade worth making.
 *
 * Usage: npm run heroes
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { uniqueSlug } from '../src/lib/slug.ts';
// One record per line, so the scheduled run that commits these two tables shows which mods
// changed instead of one line the width of the file. Shared with tools/gen-fingerprints.js,
// which writes the other two files that same workflow pushes.
import { jsonLinesFile } from '../../tools/json-lines.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(siteRoot, '..');

const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main';
const IMG_DIR = path.join(siteRoot, 'public', 'mods');
const DATA_OUT = path.join(siteRoot, 'src', 'data', 'heroes.json');
const INDEX_IN = path.join(repoRoot, 'hero-index.json');

const args = new Set(process.argv.slice(2));
const SKIP_IMAGES = args.has('--no-images');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dota2modmanager-site' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * Fold what the archives said into the list of heroes that actually exist.
 *
 * The folder name inside a VPK is whatever its author typed, so the raw index came back with
 * 147 "heroes": Phoenix spelled "Pheonix", Phantom Assassin with one s, Night Stalker as
 * "Nightstlaker", Riki as "Rikimaru", Naga Siren as "Naga", and a few that are not heroes at
 * all ("Zmdl", "Shopkeeper"). Publishing a page for Pheonix would be worse than publishing
 * nothing, and dropping it would lose the mod, so each one is matched against the catalog's
 * own list of heroes and merged into the right page.
 *
 * Three ways to match, in order of how much they can be trusted. Anything none of them
 * recognises is left out and printed, so a new spelling shows up as a line in the log rather
 * than as a page nobody meant to publish.
 */
const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Names no amount of string comparison will get right, and the ones it gets wrong.
 *
 * Lanaya is Templar Assassin's actual name and looks like nothing else in the list. "Siren"
 * is Naga Siren and comes out as Sven two edits away, which is how a Naga skin ends up on
 * Sven's page. "Bard" is not a hero at all and lands on Bane by the same accident. A null
 * means "recognised, and deliberately not a hero".
 */
const NICKNAME = {
  lanaya: 'Templar Assassin',
  siren: 'Naga Siren',
  abyssalundelord: 'Underlord',
  abyssalunderlord: 'Underlord',
  bard: null,
};

function canonicaliser(heroList) {
  const exact = new Map(heroList.map((n) => [flat(n), n]));
  return (name) => {
    const key = flat(name);
    if (key in NICKNAME) return NICKNAME[key];
    if (exact.has(key)) return exact.get(key);
    // "Naga" for Naga Siren, "Rikimaru" for Riki: one contains the other from the start
    for (const [k, n] of exact) if (k.startsWith(key) || key.startsWith(k)) return n;
    // A typo: "pheonix", "phantomassasin", "nightstlaker". Only for names long enough that
    // two edits cannot land on a different hero by chance - at five letters "siren" reaches
    // "sven", which is exactly the mistake this guard exists to stop.
    if (key.length < 7) return null;
    let best = null, bestD = 3;
    for (const [k, n] of exact) {
      const d = editDistance(key, k);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  };
}

/** Every catalog entry that can be a hero mod, keyed the way hero-index.json keys them. */
function catalogIndex(modsData) {
  const byKey = new Map();
  for (const [categoryId, data] of Object.entries(modsData)) {
    /* the group a mod sits in is part of its download counter's key (category/group/name) */
    const arr = Array.isArray(data) ? data.map((mod) => [null, mod])
      : (data?.groups ? data.groups.flatMap((g) => (g.mods || []).map((mod) => [typeof g.id === 'string' ? g.id : null, mod])) : []);
    for (const [group, mod] of arr) {
      if (!mod?.name) continue;
      const author = (mod.links || []).find((l) => l.type === 'author')?.url
        || (mod.linkType === 'author' ? mod.linkUrl : null);
      const common = { author, group, date: mod.meta?.date ?? null, tags: mod.tags || {} };
      if (Array.isArray(mod.styles) && mod.styles.length) {
        for (const st of mod.styles) {
          byKey.set(`${categoryId} ${mod.name} ${st.label || ''}`, { ...common, preview: st.preview || mod.preview });
        }
      } else {
        byKey.set(`${categoryId} ${mod.name} `, { ...common, preview: mod.preview });
      }
    }
  }
  return byKey;
}

/**
 * Fetch one preview, and check it is a picture before keeping it.
 *
 * Two entries in the catalog are MP4 files carrying a .webp name, which the site would have
 * served as broken images. The extension is not the evidence; what sharp can read is.
 *
 * @returns {{width:number,height:number}|null}
 */
async function download(categoryId, preview, dest) {
  const url = preview.startsWith('assets/previews/')
    ? `${RAW}/${preview.split('/').map(encodeURIComponent).join('/')}`
    : `${RAW}/assets/previews/${encodeURIComponent(categoryId)}/${encodeURIComponent(preview)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'dota2modmanager-site' } });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;

    // Downscale what is bigger than the page can use. The card is about 640px wide, so a
    // 1920px render is three times the pixels nobody sees, and these are committed to a public
    // repository that keeps every version of every file forever: the untouched set came to
    // 51 MB and would grow with the catalog. MAX is double the display width, which covers a
    // dense screen with room to spare, and 82 is the quality where the difference stops being
    // visible on artwork like this.
    const MAX = 1280;
    if (meta.width > MAX) {
      const out = await sharp(bytes).resize({ width: MAX, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      const resized = await sharp(out).metadata();
      fs.writeFileSync(dest, out);
      return { width: resized.width, height: resized.height };
    }
    fs.writeFileSync(dest, bytes);
    return { width: meta.width, height: meta.height };
  } catch {
    return null; // a video wearing an image's file extension
  }
}

/** Size of a preview already on disk, so a re-run does not re-download to learn it. */
async function measure(file) {
  try {
    const meta = await sharp(file).metadata();
    if (meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch { /* not an image after all */ }
  return null;
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(INDEX_IN)) {
  console.error(`no ${INDEX_IN}. Run "node tools/gen-fingerprints.js" in the repo root first.`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(INDEX_IN, 'utf-8'));
const [mods, constants] = await Promise.all([
  getJson(`${RAW}/assets/data/mods.json`),
  getJson(`${RAW}/assets/data/constants.json`),
]);
const catalog = catalogIndex(mods.modsData);
const profile = (name) => constants.MOD_AUTHOR?.[name] || constants.MOD_SENDER?.[name] || null;

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATA_OUT), { recursive: true });

const canonical = canonicaliser(constants.HEROES_LIST || []);

/** Fold the spellings together first, so a hero is one page however its folders were typed. */
const merged = new Map();
const dropped = [];
const renamed = [];
for (const [id, entry] of Object.entries(index.byHero)) {
  const name = canonical(entry.name);
  if (!name) { dropped.push(`${entry.name} (${entry.mods.length})`); continue; }
  if (name !== entry.name) renamed.push(`${entry.name} -> ${name}`);
  const hero = merged.get(name) || { id, name, mods: [] };
  hero.mods.push(...entry.mods);
  merged.set(name, hero);
}
if (renamed.length) console.log(`folded: ${renamed.join(', ')}`);
if (dropped.length) console.log(`not heroes, left out: ${dropped.join(', ')}`);
console.log(`${Object.keys(index.byHero).length} folder spellings -> ${merged.size} heroes\n`);

const heroSlugs = new Set();
const imageSlugs = new Set();
/** One image per catalog entry even when three heroes share the mod. */
const imageFor = new Map();

const heroes = [];
let fetched = 0, reused = 0, missing = 0;

for (const [, entry] of merged) {
  const id = entry.id;
  const heroSlug = uniqueSlug(entry.name, heroSlugs);
  const list = [];
  const seen = new Set();

  for (const m of entry.mods) {
    // two spellings of one hero inside one mod would otherwise list it twice
    const dedupe = `${m.categoryId} ${m.name} ${m.styleLabel || ''}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = `${m.categoryId} ${m.name} ${m.styleLabel || ''}`;
    const meta = catalog.get(key);
    let image = null;

    if (meta?.preview) {
      if (imageFor.has(key)) {
        image = imageFor.get(key);
      } else {
        const file = `${uniqueSlug(m.styleLabel ? `${m.name} ${m.styleLabel}` : m.name, imageSlugs)}.webp`;
        const dest = path.join(IMG_DIR, file);
        let size = null;
        if (fs.existsSync(dest)) {
          size = await measure(dest);
          if (size) reused++;
          else fs.rmSync(dest, { force: true }); // an old run kept a video here
        }
        if (!size && !SKIP_IMAGES) {
          size = await download(m.categoryId, meta.preview, dest);
          if (size) {
            fetched++;
            if (fetched % 25 === 0) console.log(`  ${fetched} previews`);
          }
        }
        if (size) image = { src: `/mods/${file}`, ...size };
        else missing++;
        if (image) imageFor.set(key, image);
      }
    }

    list.push({
      name: m.name,
      categoryId: m.categoryId,
      styleLabel: m.styleLabel,
      group: meta?.group ?? null,
      slots: m.slots,
      image,
      author: meta?.author ?? null,
      authorUrl: meta?.author ? profile(meta.author) : null,
      date: meta?.date ?? null,
    });
  }

  // Skins for the hero first, then whatever replaces the most, then by name. A page that
  // opens on an item-effect pack because its name starts with A is a page that looks like it
  // has nothing for the hero it is named after.
  list.sort((a, b) => {
    const skin = (m) => (m.categoryId === 'heroes' ? 0 : 1);
    return skin(a) - skin(b) || b.slots.length - a.slots.length || a.name.localeCompare(b.name);
  });

  heroes.push({ id, name: entry.name, slug: heroSlug, mods: list });
}

heroes.sort((a, b) => b.mods.length - a.mods.length || a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// The same again, by category.
//
// Heroes answer "what is there for Pudge". Categories answer the other half of what people
// type: terrains, trees, the river, shaders, cursors, fonts, the menu background, creep deny.
// Those are searched by somebody who does not yet know the word "mod" - they are looking for
// how to change a thing in their game - which is exactly the visitor this site never had a
// page for.
//
// Categories that hold no mods are skipped: tools are programs, guides are text, `sites` and
// `news` are links. A page listing those would be a page about nothing.
//
// `other` is emphatically not one of them, though it looks like it. It holds the mods somebody
// finds by searching for a problem rather than for a mod: the Techies mine radius, the tower
// re-aggro radius, the colour of your click, the dummy in your profile. Skipping it as a
// junk drawer hid the ten mods this whole idea is best demonstrated by.

const NOT_MODS = new Set(['tools', 'guides', 'sites', 'news']);

const categories = [];
for (const [categoryId, data] of Object.entries(mods.modsData)) {
  if (NOT_MODS.has(categoryId)) continue;
  if (categoryId === 'heroes') continue; // those have their own pages

  const arr = Array.isArray(data) ? data : (data?.groups ? data.groups.flatMap((g) => g.mods || []) : []);
  const list = [];

  for (const mod of arr) {
    if (!mod?.name) continue;
    const entries = Array.isArray(mod.styles) && mod.styles.length
      ? mod.styles.map((st) => ({ styleLabel: st.label || null, preview: st.preview || mod.preview }))
      : [{ styleLabel: null, preview: mod.preview }];

    for (const e of entries) {
      const key = `${categoryId} ${mod.name} ${e.styleLabel || ''}`;
      const meta = catalog.get(key);
      let image = imageFor.get(key) ?? null;

      if (!image && e.preview) {
        const file = `${uniqueSlug(e.styleLabel ? `${mod.name} ${e.styleLabel}` : mod.name, imageSlugs)}.webp`;
        const dest = path.join(IMG_DIR, file);
        let size = fs.existsSync(dest) ? await measure(dest) : null;
        if (size) reused++;
        else if (!SKIP_IMAGES) {
          size = await download(categoryId, e.preview, dest);
          if (size) {
            fetched++;
            if (fetched % 25 === 0) console.log(`  ${fetched} previews`);
          }
        }
        if (size) {
          image = { src: `/mods/${file}`, ...size };
          imageFor.set(key, image);
        } else missing++;
      }

      list.push({
        name: mod.name,
        styleLabel: e.styleLabel,
        group: meta?.group ?? null,
        image,
        author: meta?.author ?? null,
        authorUrl: meta?.author ? profile(meta.author) : null,
        date: meta?.date ?? null,
      });
    }
  }

  if (!list.length) continue;
  list.sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || a.name.localeCompare(b.name));
  categories.push({ id: categoryId, mods: list });
}

categories.sort((a, b) => b.mods.length - a.mods.length || a.id.localeCompare(b.id));
fs.writeFileSync(
  path.join(siteRoot, 'src', 'data', 'categories.json'),
  jsonLinesFile({ categories }),
);
console.log(`\n${categories.length} categories, ${categories.reduce((n, c) => n + c.mods.length, 0)} mod entries`);

// No timestamp: this file is committed, and one that changes on every run is a commit that
// says nothing. Same rule the fingerprints and the hero index follow.
fs.writeFileSync(DATA_OUT, jsonLinesFile({ heroes }));

const totalMods = heroes.reduce((n, h) => n + h.mods.length, 0);
const withImage = heroes.reduce((n, h) => n + h.mods.filter((m) => m.image).length, 0);
console.log(`\n${heroes.length} heroes, ${totalMods} mod entries, ${withImage} with a picture`);
console.log(`previews: ${fetched} fetched, ${reused} already here, ${missing} missing`);
console.log(`-> ${DATA_OUT}`);
