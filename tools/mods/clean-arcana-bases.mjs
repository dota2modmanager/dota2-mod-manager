/* Strips a compiled arcana base (game/dota_addons/<name>) down to what the base is for: the
   hero's models with their animations, its materials and textures, and its particles.

   Everything else is either the editor's own bookkeeping (tools_thumbnail_cache, tools_asset_info),
   something the app already writes for every pick at once (soundevents, which src/item-sounds.ts
   merges; panorama pictures, which it copies out of pak01), or a particle every hero in the match
   uses (Blink Dagger, stuns, item effects, the engine's error particle), which the game already
   switches for the arcana's owner and a mod would switch for everyone.

   Models are kept whoever they belong to: Rubick's arcana reshapes Lycan's wolf, Undying's golem
   and Pangolier's ball for when he steals them, and those are wanted.

   Usage: node tools/mods/clean-arcana-bases.mjs [--root <game/dota_addons>] [--apply] [name...]
     With no names, every addon without an addoninfo.txt (Valve's own all have one).
     Without --apply it only lists what it would take out. With --apply the files are moved to
     <root>/../dota_addons_removed/<name>/, not deleted, so a mistake costs a move back and not a
     recompile. */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ROOT = 'D:/SteamLibrary/steamapps/common/dota 2 beta/game/dota_addons';

const KEPT_ROOTS = ['models/', 'materials/', 'particles/'];

// particles every hero uses: items_fx..items5_fx, generic stuns and buffs, the error particle,
// and the placeholders item modifiers draw at
const SHARED_PARTICLES = /^particles\/(items\d*_fx|generic_gameplay|error|ability_modifier_placeholder)\//;

/** Why a file goes, or null when it stays. `rel` is lower case with forward slashes. */
function reasonToRemove(rel) {
  if (!KEPT_ROOTS.some((r) => rel.startsWith(r))) return rel.split('/')[0];
  if (SHARED_PARTICLES.test(rel)) return 'shared particle';
  return null;
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

/** Empty folders left behind, deepest first, the addon's own folder kept. */
function pruneEmpty(dir, top = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name), top);
  }
  if (dir !== top && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let apply = false;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--root') root = argv[++i];
    else names.push(argv[i]);
  }
  if (!fs.existsSync(root)) throw new Error(`no such folder: ${root}`);
  const addons = names.length ? names : fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !fs.existsSync(path.join(root, e.name, 'addoninfo.txt')))
    .map((e) => e.name);
  const trash = path.join(path.dirname(root), 'dota_addons_removed');

  let total = 0;
  for (const name of addons) {
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) { console.log(`${name}: not found, skipped`); continue; }
    const files = walk(dir);
    const gone = files.map((rel) => ({ rel, why: reasonToRemove(rel.toLowerCase()) })).filter((f) => f.why);
    const byWhy = new Map();
    for (const f of gone) byWhy.set(f.why, (byWhy.get(f.why) || 0) + 1);
    console.log(`${name}: ${files.length - gone.length} kept, ${gone.length} out`
      + (gone.length ? ` (${[...byWhy].map(([w, n]) => `${w} ${n}`).join(', ')})` : ''));
    for (const f of gone.filter((g) => g.why === 'shared particle')) console.log(`    ${f.rel}`);
    if (apply) {
      for (const f of gone) {
        const to = path.join(trash, name, f.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(dir, f.rel), to);
      }
      pruneEmpty(dir);
    }
    total += gone.length;
  }
  console.log(apply ? `\nmoved ${total} files to ${trash}` : `\n${total} files would go. Run again with --apply to move them.`);
}

main(process.argv.slice(2));
