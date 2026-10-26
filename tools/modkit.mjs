#!/usr/bin/env node
/**
 * modkit: making a Dota 2 mod of your own, one command per step. Written for people and for AI
 * assistants following skills/dota2-modding, which says when each step comes.
 *
 *   npm run modkit -- check                                what is installed, what is missing
 *   npm run modkit -- find necrolyte death_pulse            paths in the game's pak01
 *   npm run modkit -- extract particles/units/heroes/hero_necrolyte --out work/raw
 *   npm run modkit -- recolor necrolyte 190,6,6 --out work/mod     a hero's effects in a colour
 *   npm run modkit -- compile my_mod                       Valve's compiler on an addon's sources
 *   npm run modkit -- pack work/mod --out my_mod.vpk        a folder of compiled files as a VPK
 *   npm run modkit -- model necrolyte --out work/model.json  bones, sequences, activities
 *   npm run modkit -- clips <compiled.vmdl_c> --hero necrolyte --out work/mod   new clips in Valve's model
 *   npm run modkit -- sounds necrolyte [--layer Hero_Necrolyte.DeathPulse=scream.wav --addon a --out work/mod]
 *   npm run modkit -- pictures necrolyte --out work/pics     icons and portraits as PNG, and back with --from
 *
 * Every command takes --game "<...>/dota 2 beta/game"; without it the app's settings and then
 * Steam's libraries are searched. Nothing here writes into the folders the game mounts: a mod is
 * installed by importing its VPK in the app.
 */
import { check } from './modkit/check.mjs';
import { clips, model } from './modkit/clips.mjs';
import { compile, extract, find, pack, recolor } from './modkit/commands.mjs';
import { parseArgs } from './modkit/lib.mjs';
import { pictures } from './modkit/pictures.mjs';
import { sounds } from './modkit/sounds.mjs';

const COMMANDS = { check, find, extract, recolor, pack, compile, model, clips, sounds, pictures };
const BARE = ['json', 'one-pass', 'keep-unchanged', 'dry-run', 'vo'];

async function main(argv) {
  const [name, ...rest] = argv;
  const cmd = COMMANDS[name];
  if (!cmd) {
    const head = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 19);
    console.log(head.map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    if (name && name !== 'help') process.exitCode = 1;
    return;
  }
  await cmd(parseArgs(rest, BARE));
}

main(process.argv.slice(2)).catch((e) => { console.error(`modkit: ${e.message}`); process.exitCode = 1; });
