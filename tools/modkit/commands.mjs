/**
 * The modkit commands that read the game or write a mod: find, extract, recolor, pack, compile.
 * Each prints what it did in a form an assistant can read back, and writes only where it is told.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pak01, gameFolder, src } from './game.mjs';
import {
  findPaths, heroId, heroParticlePaths, heroesWithParticles, isSharedTexture, isUnchanged, listOf, parseColor, SOURCE_EXT, twoPass, walkFiles,
} from './lib.mjs';

const need = (v, what) => { if (!v || v === true) throw new Error(`missing ${what}`); return v; };

/** modkit find <words...> [--ext vpcf_c] [--limit 200] */
export async function find(opts) {
  const { index } = await pak01(opts);
  const words = need(opts._.length && opts._, 'words to look for');
  const hits = findPaths(index.paths(), words, { ext: typeof opts.ext === 'string' ? opts.ext : null, limit: Number(opts.limit) || 200 });
  for (const p of hits) console.log(p);
  console.log(`\n${hits.length} path(s)${hits.length >= (Number(opts.limit) || 200) ? ' (limit reached: add words or --limit)' : ''}`);
}

/** modkit extract <path or folder prefix>... --out <dir>: the game's compiled files, as they are. */
export async function extract(opts) {
  const { index } = await pak01(opts);
  const out = need(opts.out, '--out <folder>');
  const wants = need(opts._.length && opts._, 'a path or folder').map((w) => w.toLowerCase().replace(/\\/g, '/'));
  let n = 0;
  for (const p of index.paths()) {
    if (!wants.some((w) => p === w || p.startsWith(w.endsWith('/') ? w : `${w}/`))) continue;
    const data = index.read(p);
    if (!data) continue;
    fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
    fs.writeFileSync(path.join(out, p), data); n++;
  }
  console.log(`${n} file(s) into ${out}${n ? '' : ' - nothing matched: try modkit find'}`);
}

/**
 * modkit recolor <hero> <colour> --out <dir> [--include <folder>]... [--one-pass]
 * A hero's own particles (and its status effects) in one colour, compiled and ready to pack.
 */
export async function recolor(opts) {
  const { index } = await pak01(opts);
  const [heroText, colorText] = opts._;
  const { HERO_DISPLAY } = await src('hero-names.ts');
  const hero = heroId(need(heroText, 'a hero (necrolyte, "Necrophos")'), HERO_DISPLAY);
  const target = parseColor(colorText);
  if (!target) throw new Error('give a colour: 190,6,6 or #be0606');
  const out = need(opts.out, '--out <folder>');
  const all = [...index.paths()];
  const files = heroParticlePaths(all, hero, listOf(opts.include));
  if (!files.length) {
    const near = heroesWithParticles(all).filter((h) => h.includes(hero.slice(0, 4)));
    throw new Error(`no particles for "${hero}"${near.length ? `; did you mean ${near.join(', ')}?` : ' (use the game\'s name: necrolyte, nevermore, zuus...)'}`);
  }
  const { recolorResource } = await src('recolor.ts');
  const { first, from } = twoPass(target);
  let n = 0, colours = 0;
  const failed = [];
  for (const p of files) {
    try {
      const raw = index.read(p);
      const a = opts['one-pass'] ? recolorResource(raw, target, { own: true }) : recolorResource(raw, first, { own: true });
      const r = !opts['one-pass'] && a.changed ? recolorResource(a.file, target, { own: true, from }) : a;
      if (!r.changed) continue;
      fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
      fs.writeFileSync(path.join(out, p), r.file); n++; colours += r.changed;
    } catch (e) { failed.push(`${p}: ${e.message}`); }
  }
  console.log(`${hero}: ${n} of ${files.length} particle(s) recoloured (${colours} colours) into ${out}`);
  if (failed.length) console.log(`left as Valve's (could not read):\n  ${failed.join('\n  ')}`);
  console.log('Colours drawn in textures (projected rings, colour warps) do not move: see references/recolor.md.');
}

/**
 * modkit pack <folder> --out <mod.vpk> [--keep <path>]... [--keep-unchanged]
 * A folder of compiled game files as one VPK. Left out: files byte for byte the game's, and
 * textures at a path the game already has. The compiler writes every texture a material names
 * out again (materials/default/..., a hero's masks), with other bytes, and a mod carrying those
 * replaces a picture every hero shares. A texture meant to replace the game's goes in by --keep.
 */
export async function pack(opts) {
  const dir = need(opts._[0], 'a folder');
  const out = need(opts.out, '--out <file.vpk>');
  const { findContentRoot, entryAt, buildVpk } = await src('vpk.ts');
  const root = findContentRoot(path.resolve(dir));
  if (!root) throw new Error(`no game folders (models/, materials/, particles/...) under ${dir}`);
  const { index } = opts['keep-unchanged'] ? { index: null } : await pak01(opts);
  const keep = new Set(listOf(opts.keep).map((k) => k.toLowerCase().replace(/\\/g, '/')));
  const entries = [];
  const dropped = [];
  const shared = [];
  const raw = [];
  for (const [rel, abs] of walkFiles(root)) {
    const data = fs.readFileSync(abs);
    const key = rel.toLowerCase();
    if (index && isUnchanged(key, data, (p) => index.read(p))) { dropped.push(key); continue; }
    if (index && isSharedTexture(key, index, keep)) { shared.push(key); continue; }
    if (SOURCE_EXT.test(key) && !/\.(css|xml)$/.test(key)) raw.push(key);
    entries.push(entryAt(rel, data));
  }
  if (!entries.length) throw new Error('nothing to pack: every file is the game\'s own');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buildVpk(entries));
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`${entries.length} file(s) from ${root} into ${out} (${mb} MB); ${dropped.length} left out as the game's own`);
  if (shared.length) console.log(`left out, textures the game already has (--keep <path> to replace one on purpose):\n  ${shared.join('\n  ')}`);
  if (raw.length) console.log(`warning: source files the game does not read (compile them first): ${raw.slice(0, 8).join(', ')}${raw.length > 8 ? ' ...' : ''}`);
  console.log('Next: npm run doctor -- <vpk>, then import it in the app (My mods) or test it with npm run dota:bench.');
}

/**
 * modkit compile <addon> [source...] [--dry-run]
 * Valve's resourcecompiler on an addon's sources (content/dota_addons/<addon>/); the compiled files
 * land in game/dota_addons/<addon>/, which the game does not mount, ready for modkit pack.
 */
export async function compile(opts) {
  const game = await gameFolder(opts);
  const addon = need(opts._[0], 'an addon name');
  if (!/^[a-z0-9_]{1,64}$/.test(addon)) throw new Error('an addon name is lower case letters, digits and _');
  const install = path.dirname(game);
  const content = path.join(install, 'content', 'dota_addons', addon);
  const exe = path.join(game, 'bin', 'win64', 'resourcecompiler.exe');
  if (!fs.existsSync(exe)) throw new Error('resourcecompiler.exe not found: install the Dota 2 Workshop Tools (Steam > Dota 2 > Properties > DLC)');
  if (!fs.existsSync(content)) {
    if (opts['dry-run']) { console.log(`no addon yet: modkit compile ${addon} makes ${content}`); return; }
    fs.mkdirSync(content, { recursive: true });
    fs.mkdirSync(path.join(game, 'dota_addons', addon), { recursive: true });
    console.log(`made the addon: put sources under ${content}`);
    if (!opts._[1]) return;
  }
  const sources = opts._.length > 1 ? opts._.slice(1).map((s) => path.resolve(content, s))
    : walkFiles(content).map(([, abs]) => abs).filter((f) => /\.(vmdl|vmat|vpcf|vtex|vsndevts|wav|mp3|vsnap)$/i.test(f));
  if (!sources.length) throw new Error(`no sources under ${content}`);
  if (opts['dry-run']) {
    const args = ['-nop4', '-f', '-game', path.join(game, 'dota'), ...sources.flatMap((s) => ['-i', s])];
    console.log(`"${exe}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    return;
  }
  const r = runCompiler(game, sources);
  for (const l of r.lines.filter((x) => /ERROR|Error|failed|OK:|Warning: .*(not found|missing)/.test(x)).slice(-60)) console.log(l.trim());
  console.log(`compiled files: ${path.join(game, 'dota_addons', addon)}`);
  if (!r.ok) process.exitCode = 1;
}

/** Valve's resourcecompiler on source files of an addon (flags such as -r go before them); its
 *  output lines and whether it succeeded. */
export function runCompiler(game, sources, flags = []) {
  const exe = path.join(game, 'bin', 'win64', 'resourcecompiler.exe');
  if (!fs.existsSync(exe)) throw new Error('resourcecompiler.exe not found: install the Dota 2 Workshop Tools (Steam > Dota 2 > Properties > DLC)');
  const args = ['-nop4', '-f', '-game', path.join(game, 'dota'), ...flags, ...sources.flatMap((s) => ['-i', s])];
  const r = spawnSync(exe, args, { cwd: path.dirname(exe), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/);
  const failed = lines.some((l) => /[1-9]\d* failed/.test(l));
  return { ok: !r.status && !failed, lines };
}
