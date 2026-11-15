#!/usr/bin/env node
/**
 * Tower looks as a VPK to import (issue #446): the towers an item dresses, under the default
 * tower's file names, so they show with safe mode on and for items nobody can equip any more.
 *
 *   npm run tower-looks                                  every look the game's table has
 *   npm run tower-looks -- 17538 --side dire             New Bloom's dragon towers for Dire
 *   npm run tower-looks -- 17538 --side both --out towers.vpk --game "<...>\dota 2 beta\game"
 *
 * The files come out of the game's own pak01 (crates/mm-core/src/looks/tower_looks.rs). Without --game, the game folder
 * the app has in its settings is used. Import the VPK in My mods like any other.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// the app's own code, through mm-cli (tools/dev/mm-cli.js)
const { mm, call, jsonFile, vpkFile, appGame } = createRequire(import.meta.url)('../dev/mm-cli.js');


async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const game = opt('--game') || appGame();
  if (!game) throw new Error('no game folder: pass --game "<...>\\dota 2 beta\\game"');
  const pak01 = path.join(game, 'dota', 'pak01_dir.vpk');
  const table = vpkFile(pak01, 'scripts/items/items_game.txt');
  const id = argv.find((a, i) => /^\d+$/.test(a) && !['--out', '--game', '--side'].includes(argv[i - 1]));
  if (!id) {
    for (const l of call('tower-looks.looks', { $file: table })) console.log(`${l.id}  ${l.name}  (${l.sides.join(', ')})`);
    return;
  }
  const side = opt('--side') || 'radiant';
  if (!['radiant', 'dire', 'both'].includes(side)) throw new Error('--side is radiant, dire or both');
  const out = path.resolve(opt('--out') || `towers-${id}-${side}_dir.vpk`);
  const r = mm('build', 'towers', out, jsonFile({ pak01, table, radiant: side === 'dire' ? null : id, dire: side === 'radiant' ? null : id }));
  console.log(`${[...new Set(r.names)].join(', ') || id} for ${side}: ${r.files} files -> ${out}`);
  for (const f of r.missing) console.log(`not in the game, left out: ${f}`);
  for (const s of r.skipped) console.log(`a file cannot carry it, left out: ${s}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
