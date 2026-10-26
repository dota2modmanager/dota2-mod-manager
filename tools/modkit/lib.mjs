/**
 * The parts of `npm run modkit` that decide things, apart from the parts that touch the disk or
 * the game, so a test can hold them to what they promise (test/modkit.test.js).
 *
 * modkit is the command line a person or an AI assistant uses to make a mod of their own: the
 * steps the Necrophos "Scream" set needed again and again (skills/dota2-modding), each as one
 * command instead of a script with the author's paths written into it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * argv as { _: [positional...], flag: value | true }. A flag takes the next word as its value
 * unless that word is another flag; `--one-pass` and the like stand alone.
 */
export function parseArgs(argv, bare = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (bare.includes(key) || next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    // a flag given twice collects its values: --include a --include b
    out[key] = key in out ? [].concat(out[key], next) : next;
    i++;
  }
  return out;
}

/** A flag's values as a list, whether it was given once, twice or not at all. */
export const listOf = (v) => (v === undefined || v === true ? [] : [].concat(v));

/** "255,0,0", "#ff0000" or "ff0000" as [r, g, b], or null. */
export function parseColor(text) {
  const s = String(text || '').trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(s);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const parts = s.split(/[\s,;]+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/**
 * The two colours of a two-pass recolour toward `target` (src/recolor.ts shade):
 * pass 1 to the target's hue at full saturation and brightness, which gives every colour that hue
 * and keeps its own saturation and brightness; pass 2 from that hue at half saturation to the
 * target, which leaves the hue and scales saturation by 2 x the target's and brightness by the
 * target's. One pass with a `from` turns every hue by the same angle, and a hero whose effects
 * run from yellow-green to teal (Necrophos) came out purple and orange.
 */
export function twoPass(target) {
  const [r, g, b] = target.map((n) => n / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) + 360) % 360;
  const at = (s) => {
    const c = s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 1 - c;
    const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [rr, gg, bb].map((n) => Math.round((n + m) * 255));
  };
  return { first: at(1), from: at(0.5) };
}

/**
 * The game's own name for a hero ("necrolyte") from what a person writes: the id itself,
 * "Necrophos", "queen of pain". `display` is src/hero-names.ts HERO_DISPLAY (id -> name).
 */
export function heroId(text, display = {}) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  for (const [id, name] of Object.entries(display)) if (name.toLowerCase() === s) return id;
  return s.replace(/^npc_dota_hero_/, '').replace(/[\s-]+/g, '_').replace(/'/g, '');
}

/** Text to match as it is inside a RegExp: a hero name off the command line is not a pattern. */
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of the game's particles are a hero's own: its folder under particles/units/heroes, and
 * the status effects named after it (Necrophos' Ghost Shroud tint lives in particles/status_fx).
 * `extra` adds folders of one's own choosing, such as an item's particles/econ/items/<hero>/.
 */
export function heroParticlePaths(paths, hero, extra = []) {
  const own = `particles/units/heroes/hero_${hero}/`;
  const status = new RegExp(`^particles/status_fx/status_effect_${escapeRe(hero)}[_.]`);
  const more = extra.map((p) => p.toLowerCase().replace(/\\/g, '/'));
  const out = [];
  for (const p of paths) {
    if (!p.endsWith('.vpcf_c')) continue;
    if (p.startsWith(own) || status.test(p) || more.some((m) => p.startsWith(m))) out.push(p);
  }
  return out.sort();
}

/** The heroes that have a particle folder, for "did you mean" when a name matches none. */
export function heroesWithParticles(paths) {
  const set = new Set();
  for (const p of paths) {
    const m = /^particles\/units\/heroes\/hero_([^/]+)\//.exec(p);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
}

/** The pak01 paths that hold every word (any case), at most `limit` of them. */
export function findPaths(paths, words, { ext = null, limit = 200 } = {}) {
  const want = words.map((w) => w.toLowerCase());
  const out = [];
  for (const p of paths) {
    if (ext && !p.endsWith(ext.startsWith('.') ? ext : `.${ext}`)) continue;
    if (want.every((w) => p.includes(w))) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A mod's file that is byte for byte the game's own adds nothing and only takes the game's place
 * when Valve changes it: a texture copied along with a model, the compiler writing a shared
 * picture out again. `gameRead(path)` is the game's file or null.
 */
export function isUnchanged(rel, data, gameRead) {
  const theirs = gameRead(rel);
  return !!theirs && theirs.length === data.length && theirs.equals(data);
}

/** A compiled texture at a path the game has, not named in `keep`: the compiler's copy of a shared picture. */
export function isSharedTexture(rel, index, keep = new Set()) {
  return rel.endsWith('.vtex_c') && index.has(rel) && !keep.has(rel);
}

/** Every file under `root` as [relative path with "/", absolute path], junk left out. */
export function walkFiles(root, readdir = fs.readdirSync) {
  const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|\.git|\.gitignore|__macosx)$/i;
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of readdir(dir, { withFileTypes: true })) {
      if (JUNK.test(e.name) || e.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.push([rel, path.join(dir, e.name)]);
    }
  };
  walk(root, '');
  return out;
}

/** The sources resourcecompiler takes, by extension. */
export const SOURCE_EXT = /\.(vmdl|vmat|vpcf|vtex|vsndevts|vsnd|wav|mp3|vsnap|vanmgrph|css|vjs|vxml|xml)$/i;

/** The game folder the app has in its settings (%APPDATA%/Dota 2 Mod Manager/settings.json). */
export function appGamePath(env = process.env, home = os.homedir(), read = fs.readFileSync) {
  const base = env.APPDATA || path.join(home, '.config');
  try { return JSON.parse(read(path.join(base, 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath || null; } catch { return null; }
}

/**
 * Where a tool may be, in the order to look: an environment variable naming it, then the usual
 * install folders. `globDirs` are folders whose children are version folders (Blender 5.2/).
 */
export function toolCandidates(tool, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const win = platform === 'win32';
  const pf = env.ProgramFiles || 'C:/Program Files';
  if (tool === 'blender') {
    return {
      env: env.BLENDER || null,
      names: [win ? 'blender.exe' : 'blender'],
      globDirs: win ? [path.join(pf, 'Blender Foundation')] : [],
      files: win ? [] : ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender'],
    };
  }
  if (tool === 'vrf') {
    return {
      env: env.VRF_CLI || null,
      names: [win ? 'Source2Viewer-CLI.exe' : 'Source2Viewer-CLI'],
      globDirs: [],
      files: [path.join(home, 'Tools', 'vrf', win ? 'Source2Viewer-CLI.exe' : 'Source2Viewer-CLI')],
    };
  }
  if (tool === 'python') {
    return {
      env: env.PYTHON || null,
      names: win ? ['python.exe', 'py.exe'] : ['python3', 'python'],
      globDirs: win ? [path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Python')] : [],
      files: [],
    };
  }
  throw new Error(`no such tool: ${tool}`);
}

/** The first candidate that exists: the env value, a name on PATH, a version folder, a file. */
export function locate(c, { exists = fs.existsSync, readdir = fs.readdirSync, pathEnv = process.env.PATH || '' } = {}) {
  if (c.env && exists(c.env)) return c.env;
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const n of c.names) if (exists(path.join(dir, n))) return path.join(dir, n);
  }
  for (const base of c.globDirs) {
    let kids = [];
    try { kids = readdir(base).sort().reverse(); } catch { continue; }   // newest version first
    for (const k of kids) for (const n of c.names) if (exists(path.join(base, k, n))) return path.join(base, k, n);
  }
  return c.files.find((f) => exists(f)) || null;
}
