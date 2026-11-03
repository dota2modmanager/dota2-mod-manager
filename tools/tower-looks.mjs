#!/usr/bin/env node
/**
 * Tower looks as a VPK to import (issue #446): the towers an item dresses, under the default
 * tower's file names, so they show with safe mode on and for items nobody can equip any more.
 *
 *   npm run tower-looks                                  every look the game's table has
 *   npm run tower-looks -- 17538 --side dire             New Bloom's dragon towers for Dire
 *   npm run tower-looks -- 17538 --side both --out towers.vpk --game "<...>\dota 2 beta\game"
 *
 * The files come out of the game's own pak01 (src/tower-looks.ts). Without --game, the game folder
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
  const game = opt('--game') || appGame();
  if (!game) throw new Error('no game folder: pass --game "<...>\\dota 2 beta\\game"');
  const { sharedVpkIndex } = await import('../src/vpk.ts');
  const { towerLooks, buildTowerLook } = await import('../src/tower-looks.ts');
  const pak01 = path.join(game, 'dota', 'pak01_dir.vpk');
  const text = sharedVpkIndex(pak01).read('scripts/items/items_game.txt').toString('latin1');
  const id = argv.find((a, i) => /^\d+$/.test(a) && !['--out', '--game', '--side'].includes(argv[i - 1]));
  if (!id) {
    for (const l of towerLooks(text)) console.log(`${l.id}  ${l.name}  (${l.sides.join(', ')})`);
    return;
  }
  const side = opt('--side') || 'radiant';
  if (!['radiant', 'dire', 'both'].includes(side)) throw new Error('--side is radiant, dire or both');
  const r = buildTowerLook({ pak01, text, id, sides: side === 'both' ? ['radiant', 'dire'] : [side] });
  const out = path.resolve(opt('--out') || `towers-${id}-${side}_dir.vpk`);
  fs.writeFileSync(out, r.vpk);
  console.log(`${r.name} for ${side}: ${r.files} files -> ${out}`);
  for (const f of r.missing) console.log(`not in the game, left out: ${f}`);
  for (const s of r.skipped) console.log(`a file cannot carry it, left out: ${s}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
