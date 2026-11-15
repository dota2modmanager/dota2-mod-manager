#!/usr/bin/env node
/**
 * Trees on the map from another of the game's tree sets, per side, as a VPK to import (issue #421).
 *
 *   npm run trees                                   the sets the game has
 *   npm run trees -- --radiant winter --dire coloseum
 *   npm run trees -- --dire autumn --out trees.vpk --game "<...>\dota 2 beta\game"
 *
 * The files come out of the game's own pak01 (crates/mm-core/src/looks/tree_sets.rs). Without --game, the game folder
 * the app has in its settings is used. Import the VPK in My mods like any other.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// the app's own code, through mm-cli (tools/dev/mm-cli.js)
const { mm, jsonFile, appGame } = createRequire(import.meta.url)('../dev/mm-cli.js');


async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const radiant = opt('--radiant');
  const dire = opt('--dire');
  if (!radiant && !dire) {
    for (const s of mm('look-sets').trees) console.log(`${s.id.padEnd(12)} ${s.name}: ${s.models.map((m) => path.basename(m, '.vmdl')).join(', ')}`);
    return;
  }
  const game = opt('--game') || appGame();
  if (!game) throw new Error('no game folder: pass --game "<...>\\dota 2 beta\\game"');
  const out = path.resolve(opt('--out') || `trees-${radiant || 'radiant'}-${dire || 'dire'}_dir.vpk`);
  const r = mm('build', 'trees', out, jsonFile({ pak01: path.join(game, 'dota', 'pak01_dir.vpk'), radiant, dire }));
  console.log(`trees, Radiant ${radiant || 'as they are'}, Dire ${dire || 'as they are'}: ${r.files} files -> ${out}`);
  for (const f of r.missing) console.log(`not in the game, left out: ${f}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
