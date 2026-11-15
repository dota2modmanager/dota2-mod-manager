#!/usr/bin/env node
/**
 * The mod doctor from the command line: what is wrong with a mod's VPK, found in its files and
 * the game's, before anybody starts the game to see it (crates/mm-core/src/app/mod_doctor.rs).
 *
 *   npm run doctor -- <mod_dir.vpk> [--game "<...>\dota 2 beta\game"]
 *
 * Without --game, the game folder the app has in its settings is used. Exits with 1 when it finds
 * an error, so a script can stop on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// the app's own code, through mm-cli (tools/dev/mm-cli.js)
const { call } = createRequire(import.meta.url)('../dev/mm-cli.js');

const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };

function gameFolder() {
  const given = arg('--game');
  if (given) return given;
  try {
    return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath;
  } catch { return null; }
}

const mod = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--game');
const game = gameFolder();
if (!mod || !game) {
  console.error('usage: npm run doctor -- <mod_dir.vpk> [--game "<...>\\dota 2 beta\\game"]');
  process.exit(2);
}
const findings = call('mod-doctor.examine', path.resolve(mod), path.join(game, 'dota', 'pak01_dir.vpk'));
for (const f of findings) console.log(`${f.level.padEnd(7)} ${f.file}\n        ${f.what}`);
const errors = findings.filter((f) => f.level === 'error').length;
console.log(findings.length ? `${findings.length} found, ${errors} of them errors` : 'nothing found');
process.exitCode = errors ? 1 : 0;
