#!/usr/bin/env node
/**
 * What it takes to build an item as a mod from the game's own files (crates/mm-core/src/item_builder/item_visuals.rs): the
 * item's changes read from items_game, each with how a build gives it and whether this code does.
 *
 *   npm run item-plan -- "Fractal Horns"            by name (part of it, any case)
 *   npm run item-plan -- 13738                      by id
 *   npm run item-plan -- 13738 --game "<...>\dota 2 beta\game"
 *
 * Without --game, the game folder in the app's settings is used. The first thing to run before
 * a new arcana or set: Terrorblade's arcana took a day of reading items_game by hand to get here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// the app's own code, through mm-cli (tools/dev/mm-cli.js)
const { call, vpkFile } = createRequire(import.meta.url)('../dev/mm-cli.js');

const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const query = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--game');
let game = arg('--game');
if (!game) {
  try { game = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath; } catch { /* none */ }
}
if (!query || !game) {
  console.error('usage: npm run item-plan -- <item name or id> [--game "<...>\\dota 2 beta\\game"]');
  process.exit(2);
}
const text = { $file: vpkFile(path.join(game, 'dota', 'pak01_dir.vpk'), 'scripts/items/items_game.txt') };
const hits = call('item-visuals.findItems', text, query);
if (hits.length !== 1) {
  console.log(hits.length ? `${hits.length} items match, give one id:` : 'no item matches');
  for (const h of hits.slice(0, 40)) console.log(`  ${h.id.padStart(6)}  ${h.name}`);
  process.exit(hits.length ? 0 : 1);
}
const v = call('item-visuals.itemVisuals', text, hits[0].id);
console.log(`${v.id} ${v.name}: slot ${v.slot || '-'}, for ${v.heroes.join(', ') || '-'}, model ${v.model || '-'}`);
if (v.styles.length) console.log(`styles: ${v.styles.map((s, i) => `${i} ${s}`).join(', ')}`);
const mark = { built: 'built  ', 'by hand': 'by hand', cannot: 'cannot ' };
// the same change made more than once (nine voice lines) is one line, with how many
const steps = new Map();
for (const s of call('item-visuals.buildPlan', text, v.id)) {
  const key = `${s.done}|${s.what}|${s.how}`;
  steps.set(key, { ...s, times: (steps.get(key)?.times ?? 0) + 1 });
}
for (const done of ['built', 'by hand', 'cannot']) {
  for (const s of steps.values()) {
    if (s.done === done) console.log(`  ${mark[s.done]}  ${s.what}${s.times > 1 ? ` x${s.times}` : ''}\n             ${s.how}`);
  }
}
