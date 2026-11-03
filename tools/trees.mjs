#!/usr/bin/env node
/**
 * Trees on the map from another of the game's tree sets, per side, as a VPK to import (issue #421).
 *
 *   npm run trees                                   the sets the game has
 *   npm run trees -- --radiant winter --dire coloseum
 *   npm run trees -- --dire autumn --out trees.vpk --game "<...>\dota 2 beta\game"
 *
 * The files come out of the game's own pak01 (src/tree-sets.ts). Without --game, the game folder
 * the app has in its settings is used. Import the VPK in My mods like any other.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function appGame() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  try { return JSON.parse(fs.readFileSync(path.join(base, 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath || null; } catch { return null; }
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const { buildTrees, TREE_SETS } = await import('../src/tree-sets.ts');
  const radiant = opt('--radiant');
  const dire = opt('--dire');
  if (!radiant && !dire) {
    for (const s of TREE_SETS) console.log(`${s.id.padEnd(12)} ${s.name}: ${s.models.map((m) => path.basename(m, '.vmdl')).join(', ')}`);
    return;
  }
  const game = opt('--game') || appGame();
  if (!game) throw new Error('no game folder: pass --game "<...>\\dota 2 beta\\game"');
  const r = buildTrees({ pak01: path.join(game, 'dota', 'pak01_dir.vpk'), radiant, dire });
  const out = path.resolve(opt('--out') || `trees-${radiant || 'radiant'}-${dire || 'dire'}_dir.vpk`);
  fs.writeFileSync(out, r.vpk);
  console.log(`trees, Radiant ${radiant || 'as they are'}, Dire ${dire || 'as they are'}: ${r.files} files -> ${out}`);
  for (const f of r.missing) console.log(`not in the game, left out: ${f}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
