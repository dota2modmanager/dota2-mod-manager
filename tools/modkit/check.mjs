/**
 * `modkit check`: what is on this computer for making mods, and how to get what is missing. The
 * first thing an assistant runs, so it knows which recipes it can follow before it promises any.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gameFolder } from './game.mjs';
import { locate, toolCandidates } from './lib.mjs';

const run = (exe, args) => {
  try { return execFileSync(exe, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim(); } catch { return null; }
};

export async function check(opts) {
  const rows = [];
  const add = (name, ok, found, fix, need) => rows.push({ name, ok, found, fix, need });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 24, process.version, 'Install Node.js 24 or newer: https://nodejs.org', 'every modkit command');

  let game = null;
  try { game = await gameFolder(opts); } catch { /* reported below */ }
  add('dota 2', !!game, game, 'Install Dota 2 in Steam, or pass --game "<...>/dota 2 beta/game"', 'everything');

  const compiler = game && path.join(game, 'bin', 'win64', 'resourcecompiler.exe');
  add('workshop tools', !!compiler && fs.existsSync(compiler), compiler,
    'Steam > Dota 2 > Properties > DLC > tick "Dota 2 Workshop Tools" (Windows only)',
    'new models, materials, textures, sounds, clips: anything compiled');

  const vrf = locate(toolCandidates('vrf'));
  add('vrf', !!vrf, vrf,
    'Download Source2Viewer-CLI from https://github.com/ValveResourceFormat/ValveResourceFormat/releases, put it on PATH or set VRF_CLI',
    'decompiling the game\'s models, materials, particles and clips into editable sources');

  const blender = locate(toolCandidates('blender'));
  const bver = blender && run(blender, ['--version']);
  add('blender', !!blender, blender ? `${blender}${bver ? ` (${bver.split('\n')[0].trim()})` : ''}` : null,
    'Install Blender 4.2 or newer from https://www.blender.org (or set BLENDER); add the SourceIO add-on for importing game models',
    'new or changed meshes, rigging, animation clips, renders of the result');

  const py = locate(toolCandidates('python'));
  const libs = py && run(py, ['-c', 'import PIL, numpy; print(PIL.__version__, numpy.__version__)']);
  add('python', !!py, py ? `${py}${libs ? ` (Pillow ${libs.split(' ')[0]}, numpy ${libs.split(' ')[1]})` : ' (no Pillow/numpy)'}` : null,
    'Install Python 3.11+ and run: python -m pip install pillow numpy',
    'textures, the scripts in skills/dota2-modding/scripts');
  if (py && !libs) rows[rows.length - 1].ok = false;

  if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return rows; }
  for (const r of rows) {
    console.log(`${r.ok ? 'ok     ' : 'MISSING'}  ${r.name.padEnd(15)} ${r.found || ''}`);
    if (!r.ok) console.log(`         for: ${r.need}\n         fix: ${r.fix}`);
  }
  const missing = rows.filter((r) => !r.ok).map((r) => r.name);
  console.log(missing.length ? `\nmissing: ${missing.join(', ')}. Recolours and items from the game's own files need only node and dota 2.`
    : '\neverything is here.');
  return rows;
}
