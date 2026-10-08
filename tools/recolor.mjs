#!/usr/bin/env node
/**
 * An item's effects in a chosen colour, as a VPK to import: the engine of issue #118 without the
 * window around it, for trying a colour in the game before the app offers it.
 *
 *   npm run recolor -- 255,193,220                  Terrorblade's arcana in that colour
 *   npm run recolor -- #ffc1dc --out tb.vpk         the same, written where you say
 *   npm run recolor -- 255,193,220 --game "<...>\dota 2 beta\game"
 *
 * The files come out of the game's own pak01 (src/recolor.ts). Without --game, the game folder the
 * app has in its settings is used. Import the VPK in My mods like any other.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** "255,193,220", "#ffc1dc" or "ffc1dc" as [r, g, b], or null. */
export function parseColor(text) {
  const s = String(text || '').trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(s);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const parts = s.split(/[\s,;]+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function appGame() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  try { return JSON.parse(fs.readFileSync(path.join(base, 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath || null; } catch { return null; }
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const target = parseColor(argv.find((a, i) => !a.startsWith('--') && !['--out', '--game', '--set'].includes(argv[i - 1])));
  if (!target) throw new Error('give a colour: 255,193,220 or #ffc1dc');
  const game = opt('--game') || appGame();
  if (!game) throw new Error('no game folder: pass --game "<...>\\dota 2 beta\\game"');
  const set = opt('--set') || 'terrorblade-arcana';
  const { buildRecolor, RECOLOR_SETS } = await import('../src/recolor.ts');
  const hex = target.map((n) => n.toString(16).padStart(2, '0')).join('');
  const out = path.resolve(opt('--out') || `${set}-${hex}_dir.vpk`);
  const r = buildRecolor({ pak01: path.join(game, 'dota', 'pak01_dir.vpk'), set, target });
  fs.writeFileSync(out, r.vpk);
  console.log(`${RECOLOR_SETS[set].name} in #${hex}: ${r.changed} colours in ${r.files} files -> ${out}`);
  if (r.skipped) console.log(`${r.skipped} colours left as they were: a channel with no bytes of its own`);
  for (const f of r.failed) console.log(`not read, left as Valve ships it: ${f.path} (${f.error})`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
