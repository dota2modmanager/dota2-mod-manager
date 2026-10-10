#!/usr/bin/env node
/**
 * The bench: a mod tried in the real game, by the machine, with pictures to read afterwards.
 *
 *   npm run dota:bench -- --vpk <mod_dir.vpk> [--hero terrorblade] [--out <folder>] [--camera 900] [--short]
 *   npm run dota:bench -- --hero terrorblade                the game as it is, for comparison
 *
 * It puts the mod into the language folder through the app's own installer (a free slot), starts
 * Dota straight into hero demo with the hero (`+dota_demo_hero`, no client screens), and plays a
 * scenario: level 30, a target dummy to attack, Metamorphosis, Conjure Image (--short stops after the
 * attack). After each step it
 * captures the Dota window and a close-up around the hero, and copies the console log. Then it
 * closes Dota and takes the mod out again. The window fills a 1920x1080 screen, and the camera is
 * brought closer than the game's 1134 (`+dota_camera_distance`, allowed in the demo's cheats).
 *
 * Nothing is typed into the game: buttons are clicked at their place in the window, and the
 * abilities are their keys sent as scan codes (Dota reads keys that way; SendKeys did nothing). A
 * key with no Enter after it cannot send anything to a chat, whatever has focus. It refuses to
 * start when Dota is already running, so it never takes over a game somebody is playing.
 *
 * Windows only, and Steam has to be running. The network consoles (-netconport, -vconsole) do not
 * answer in the retail game, which is why it works through the window. Written 2026-10-10 for
 * issue #118, where three bugs of a built arcana were found only by playing it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEAM = 'C:/Program Files (x86)/Steam/steam.exe';
const W = 1920;
const H = 1080;
/** The demo panel and the hero on screen, measured in a 1600x900 window: the panel scales with the height. */
const AT900 = { level30: [170, 270], dummy: [189, 213], hero: [500, 40, 600, 600], fight: [630, 200, 290, 310] };
const AT = Object.fromEntries(Object.entries(AT900).map(([k, v]) => [k, v.map((n) => Math.round(n * H / 900))]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i === -1 ? fallback : process.argv[i + 1]; };

function appSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'settings.json'), 'utf8')); } catch { return {}; }
}

function dotaRunning() {
  try { return /dota2\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq dota2.exe'], { encoding: 'utf8' })); } catch { return false; }
}

function ps(script, ...args) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'dota-bench', script), ...args.map(String)], { encoding: 'utf8' }).trim();
}

async function until(test, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await sleep(1500); }
  throw new Error(`bench: timed out waiting for ${what}`);
}

/** The mod into a free slot of the language folder, through the app's installer; its file. */
async function install(vpk, game, lang) {
  const { Installer } = await import('../src/installer.ts');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bench-'));
  const inst = new Installer({ userDataDir: scratch, getGamePath: () => game, getLangSuffix: () => lang, onProgress: () => {} });
  inst.ensureLangFolder();
  const pak = inst.allocatePak(inst.usedPakNames(), true);
  const to = path.join(inst.langFolder(), pak);
  inst.writeInto(fs.readFileSync(vpk), to);
  fs.rmSync(scratch, { recursive: true, force: true });
  return to;
}

async function main() {
  const hero = arg('--hero', 'terrorblade');
  const camera = arg('--camera', '900');
  const vpk = arg('--vpk');
  const out = path.resolve(arg('--out', path.join(os.tmpdir(), `d2mm-bench-${Date.now()}`)));
  fs.mkdirSync(out, { recursive: true });
  if (dotaRunning()) throw new Error('bench: Dota is running; close it first, the bench does not take over a game');
  const settings = appSettings();
  const game = settings.dotaGamePath;
  if (!game) throw new Error('bench: no game folder in the app settings');
  const log = path.join(game, 'dota', 'console.log');
  const placed = vpk ? await install(path.resolve(vpk), game, settings.langSuffix || 'russian') : null;
  if (placed) console.log(`bench: mod in ${placed}`);
  const shots = [];
  const shot = (name) => {
    const full = path.join(out, `${name}.png`);
    ps('shot.ps1', '-Out', full);
    const [x, y, w, h] = AT.hero;
    ps('crop.ps1', '-In', full, '-Out', path.join(out, `${name}_hero.png`), '-X', x, '-Y', y, '-W', w, '-H', h, '-Scale', 1.5);
    shots.push(name);
    console.log(`bench: ${name}`);
  };
  try {
    const started = Date.now();
    spawn(STEAM, ['-applaunch', '570', '-windowed', '-noborder', '-w', String(W), '-h', String(H), '+dota_demo_hero', `npc_dota_hero_${hero}`, '+dota_camera_distance', camera], { detached: true, stdio: 'ignore' }).unref();
    await until(() => fs.existsSync(log) && fs.statSync(log).mtimeMs > started && /OnAddNewHeroEntry/.test(fs.readFileSync(log, 'utf8')), 240000, 'the demo to start');
    await sleep(4000);
    shot('01-idle');
    ps('input.ps1', 'click', ...AT.level30);
    await sleep(1500);
    ps('input.ps1', 'click', ...AT.dummy);
    await sleep(2500);
    shot('02-attack');
    // the swing itself: one picture a second would catch it at the same point every time
    const [fx, fy, fw, fh] = AT.fight;
    ps('burst.ps1', '-Out', out, '-Prefix', '02-swing', '-X', fx, '-Y', fy, '-W', fw, '-H', fh, '-Count', 16, '-EveryMs', 80);
    const swing = Array.from({ length: 16 }, (_, i) => path.join(out, `02-swing-${String(i).padStart(2, '0')}.png`));
    ps('sheet.ps1', '-Out', path.join(out, '02-swing.png'), '-Columns', 8, '-Scale', 0.6, ...swing);
    console.log('bench: 02-swing, 16 pictures 80 ms apart');
    if (!process.argv.includes('--short')) {
      ps('input.ps1', 'key', 'e');
      await sleep(2500);
      shot('03-metamorphosis');
      // the illusion comes out of the demon: the bugs of issue #118 showed on it, so it is looked
      // at as it appears and after it has settled
      ps('input.ps1', 'key', 'w');
      await sleep(1000);
      shot('04-conjure');
      await sleep(1500);
      shot('05-conjure-settled');
      await sleep(3000);
      shot('06-conjure-later');
    }
  } finally {
    try { execFileSync('taskkill', ['/IM', 'dota2.exe'], { stdio: 'ignore' }); } catch { /* not running */ }
    await until(() => !dotaRunning(), 60000, 'Dota to close').catch(() => {});
    if (fs.existsSync(log)) fs.copyFileSync(log, path.join(out, 'console.log'));
    if (placed) { fs.rmSync(placed, { force: true }); console.log('bench: mod taken out'); }
  }
  console.log(`bench: ${shots.length} pictures in ${out}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
