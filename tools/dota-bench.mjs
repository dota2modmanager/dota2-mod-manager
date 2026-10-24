#!/usr/bin/env node
/**
 * The bench: a mod tried in the real game, by the machine, with pictures to read afterwards.
 *
 *   npm run dota:bench -- --vpk <mod_dir.vpk> [--hero terrorblade] [--out <folder>] [--camera 900]
 *                          [--skills "q,w,r@enemy"] [--console-key "\\"] [--short] [--now]
 *   npm run dota:bench -- --hero terrorblade                the game as it is, for comparison
 *
 * It puts the mod into the language folder through the app's own installer (a free slot), starts
 * Dota straight into hero demo with the hero (`+dota_demo_hero`, no client screens), and plays a
 * scenario: level 30 with Aghanim's Scepter and Shard (a picture after each, then the ability
 * icons), the hero close in the in-world inspect turned by dragging, a target dummy placed away
 * from the hero, the hero turned on the spot to four sides, an enemy hero, the attack on the dummy
 * (from afar and in the inspect), every ability with the aimed ones on the enemy (--skills, the
 * hero's own list in tools/dota-bench/scene.mjs), with no cooldowns (--short stops after the attack). Units are found by their health bars (tools/dota-bench/bars.ps1).
 * Whether the hero swings through its attacks it says by itself, from the burst
 * (tools/dota-bench/verdict.mjs), into verdict.json: a fidget at rest was once taken for the attack
 * by eye. Then it closes Dota, copies the console log and takes the mod out again. The window fills
 * a 1920x1080 screen, and the camera is brought closer than the game's 1134 (`+dota_camera_distance`).
 *
 * Buttons are clicked at their place in the window, and abilities are their keys sent as scan
 * codes (Dota reads keys that way; SendKeys did nothing). A few steps go through the console
 * (tools/dota-bench/console.ps1): the chat's -wtf, by its console name dota_ability_debug_enable.
 * The console key and the inspect key are the player's own, read from dotakeys_personal.lst. Each
 * batch of commands starts with a mark, a command the game does not know: its "Unknown command"
 * in console.log (-condebug) says the console took them (what echo prints never reaches the log); without it Esc closes whatever opened and the bench goes on without the console. It
 * refuses to start when Dota is already running, or when somebody touched the mouse or keyboard
 * in the last two minutes (--now overrides that, when the computer's owner agrees), and every
 * click, key and picture first checks that Dota's window is in front: once it clicked into a video
 * playing over the game.
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
import { attackVerdict, readDiffs } from './dota-bench/verdict.mjs';
import { readBars, bodyOf, spawned, follow, frame, readSkills, bindOf, unknownCommands, SCAN, SKILLS, DEFAULT_SKILLS } from './dota-bench/scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEAM = 'C:/Program Files (x86)/Steam/steam.exe';
const W = 1920;
const H = 1080;
/** The demo panel, the ability bar and the hero on screen, measured in a 1600x900 window: they scale with the height. */
const AT900 = {
  level30: [170, 270], scepter: [117, 303], shard: [193, 303], dummy: [189, 213], enemy: [117, 213], mana: [18, 393], refresh: [126, 446],
  icons: [583, 771, 467, 96], hero: [500, 40, 600, 600], fight: [630, 200, 290, 310],
};
const AT = Object.fromEntries(Object.entries(AT900).map(([k, v]) => [k, v.map((n) => Math.round(n * H / 900))]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i === -1 ? fallback : process.argv[i + 1]; };

/** The key file of the Steam account that played last (its localconfig.vdf was written last), or ''. */
function playerKeys() {
  const root = path.join(path.dirname(STEAM), 'userdata');
  let best = null;
  try {
    for (const id of fs.readdirSync(root)) {
      const t = (() => { try { return fs.statSync(path.join(root, id, 'config', 'localconfig.vdf')).mtimeMs; } catch { return 0; } })();
      if (t && (!best || t > best.t)) best = { id, t };
    }
    return best ? fs.readFileSync(path.join(root, best.id, '570', 'remote', 'cfg', 'dotakeys_personal.lst'), 'utf8') : '';
  } catch { return ''; }
}

function appSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'settings.json'), 'utf8')); } catch { return {}; }
}

function dotaRunning() {
  try { return /dota2\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq dota2.exe'], { encoding: 'utf8' })); } catch { return false; }
}

/**
 * The game's console log, if it was written after `since`, else ''. One open file is asked both
 * when it changed and what it says, so the two cannot be of different files.
 */
function logSince(log, since) {
  let fd;
  try { fd = fs.openSync(log, 'r'); } catch { return ''; }
  try { return fs.fstatSync(fd).mtimeMs > since ? fs.readFileSync(fd, 'utf8') : ''; } finally { fs.closeSync(fd); }
}

function ps(script, ...args) {
  try {
    return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'dota-bench', script), ...args.map(String)], { encoding: 'utf8' }).trim();
  } catch (e) {
    // the scripts say why they stopped on stdout ("dota is not in front"), which the error leaves out
    throw new Error(`bench: ${script} stopped: ${String(e.stdout ?? '').trim() || e.message}`);
  }
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
  const cam = Number(camera);
  const vpk = arg('--vpk');
  const skills = readSkills(arg('--skills', SKILLS[hero] ?? DEFAULT_SKILLS));
  // the player's own keys: the in-world inspect and the console are bound by each player
  const keys = playerKeys();
  const inspectKey = arg('--inspect-key', (bindOf(keys, 'InspectHeroInWorld') ?? 'i').toLowerCase());
  const consoleKey = SCAN[arg('--console-key', bindOf(keys, 'Console') ?? '`')];
  // without --out, a folder of its own in the temp dir, named at random and made in one step
  const given = arg('--out');
  const out = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bench-'));
  fs.mkdirSync(out, { recursive: true });
  if (dotaRunning()) throw new Error('bench: Dota is running; close it first, the bench does not take over a game');
  // it fills the screen and clicks: once it clicked into a video somebody was watching
  const idle = Number(ps('idle.ps1'));
  if (idle < 120 && !process.argv.includes('--now')) {
    throw new Error(`bench: somebody used this computer ${idle} s ago; the bench takes the screen and clicks, so run it when the computer is free, or with --now when its owner says so`);
  }
  const settings = appSettings();
  const game = settings.dotaGamePath;
  if (!game) throw new Error('bench: no game folder in the app settings');
  const log = path.join(game, 'dota', 'console.log');
  const placed = vpk ? await install(path.resolve(vpk), game, settings.langSuffix || 'russian') : null;
  if (placed) console.log(`bench: mod in ${placed}`);
  const shots = [];
  const notes = [];
  const note = (msg) => { notes.push(msg); console.log(`bench: ${msg}`); };
  const input = (...a) => ps('input.ps1', ...a);
  const click = ([x, y]) => input('click', x, y);
  // a picture of the window and the bars in it; with a point, a close-up around it as well
  const shot = (name, around = null) => {
    const full = path.join(out, `${name}.png`);
    ps('shot.ps1', '-Out', full);
    if (around) {
      const [x, y, w, h] = frame([around], { pad: 0, min: AT.hero.slice(2) });
      ps('crop.ps1', '-In', full, '-Out', path.join(out, `${name}_hero.png`), '-X', x, '-Y', y, '-W', w, '-H', h, '-Scale', 1.5);
    }
    shots.push(name);
    console.log(`bench: ${name}`);
    return readBars(ps('bars.ps1', '-In', full));
  };
  // a run of pictures of a region, kept as one sheet; the differences between them, for the verdict
  const burst = (name, [x, y, w, h], count, every, scale) => {
    const diffs = readDiffs(ps('burst.ps1', '-Out', out, '-Prefix', name, '-X', x, '-Y', y, '-W', w, '-H', h, '-Count', count, '-EveryMs', every));
    const parts = Array.from({ length: count }, (_, i) => path.join(out, `${name}-${String(i).padStart(2, '0')}.png`));
    ps('sheet.ps1', '-Out', path.join(out, `${name}.png`), '-Columns', count > 8 ? 8 : 4, '-Scale', scale, ...parts);
    for (const f of parts) fs.rmSync(f, { force: true });
    shots.push(name);
    console.log(`bench: ${name}, ${count} pictures ${every} ms apart`);
    return diffs;
  };
  // Commands through the console, each batch after a mark of its own, a made-up command: the game
  // logs "Unknown command: <mark>" (echo's output stays out of console.log), so the console took
  // them. When it is not there the console did not open, Enter may have opened the chat, so Esc
  // closes it and the bench does without commands from then on. A command of the batch the game
  // does not know (the developers' ones, dota_camera_yaw among them) makes the batch fail too.
  let consoleWorks = consoleKey ? null : false;
  const command = async (...cmds) => {
    if (consoleWorks === false) return false;
    const mark = `d2mm_bench_${Date.now()}`;
    const since = Date.now() - 1000;
    ps('console.ps1', '-Key', `0x${consoleKey.toString(16)}`, mark, ...cmds);
    const took = await until(() => logSince(log, since).includes(`Unknown command: ${mark}`), 4000, 'the console').then(() => true, () => false);
    if (!took) {
      input('key', 'esc');
      consoleWorks = false;
      note('the console did not take commands; the steps that need it are left out');
      return false;
    }
    consoleWorks = true;
    await sleep(1000);
    const unknown = unknownCommands(logSince(log, since), cmds);
    if (unknown.length) note(`the game does not know ${unknown.join(', ')}`);
    return !unknown.length;
  };
  const me = (bars, last) => follow(bars, last, 'green');
  const close = [W / 2 - 400, H / 2 - 330, 800, 660];
  const turn = [W / 2 + 200, H / 2, W / 2 - 250, H / 2].join(',');
  try {
    const started = Date.now();
    spawn(STEAM, ['-applaunch', '570', '-windowed', '-noborder', '-w', String(W), '-h', String(H), '+dota_demo_hero', `npc_dota_hero_${hero}`, '+dota_camera_distance', camera], { detached: true, stdio: 'ignore' }).unref();
    await until(() => /OnAddNewHeroEntry/.test(logSince(log, started)), 240000, 'the demo to start');
    await sleep(4000);
    const centre = { x: AT.hero[0] + AT.hero[2] / 2, y: AT.hero[1] + AT.hero[3] / 3 };
    let bars = shot('01-idle', [centre.x, centre.y + 80]);
    let heroBar = me(bars, centre);
    if (!heroBar) throw new Error('bench: the hero\'s health bar is not on screen');
    // the hero at its height, with Aghanim's Scepter and Shard and mana that does not run out:
    // every ability can be cast, the ones those two add included, and the bar shows all the icons
    // A picture after each: what one of them switches on is seen on its own (the Scepter can).
    for (const [name, at] of [['level30', AT.level30], ['scepter', AT.scepter], ['shard', AT.shard]]) {
      click(at);
      await sleep(1800);
      shot(`02-${name}`, bodyOf(heroBar, cam));
    }
    click(AT.mana);
    await sleep(1500);
    // the chat's -wtf by its console name: no cooldowns and no mana, so no refresh before each ability
    const wtf = await command('dota_ability_debug_enable');
    const full = path.join(out, '02-abilities.png');
    ps('shot.ps1', '-Out', full);
    const [ix, iy, iw, ih] = AT.icons;
    ps('crop.ps1', '-In', full, '-Out', path.join(out, '02-icons.png'), '-X', ix, '-Y', iy, '-W', iw, '-H', ih, '-Scale', 2);
    fs.rmSync(full, { force: true });
    shots.push('02-icons');
    // the hero close, from in front and round it: the in-world inspect, turned by dragging
    click(bodyOf(heroBar, cam));
    await sleep(500);
    input('key', inspectKey);
    await sleep(2000);
    shot('03-inspect-0');
    burst('03-inspect-idle', close, 8, 250, 0.5);
    for (const k of [1, 2, 3]) {
      input('drag', turn, 'left');
      await sleep(900);
      shot(`03-inspect-${k}`);
    }
    input('key', inspectKey);
    await sleep(2000);
    bars = shot('04-back');
    heroBar = me(bars, heroBar) ?? heroBar;
    // the dummy comes in front of the hero, then the hero walks away from it: an attack from
    // right next to it looked crooked, and a ranged hero attacks from where it stands
    const before = bars;
    click(AT.dummy);
    await sleep(2000);
    bars = shot('04-dummy');
    let dummy = spawned(before, bars);
    if (!dummy) throw new Error('bench: the dummy\'s bar did not show up');
    const away = [heroBar.x - Math.round(320 * 700 / cam), heroBar.y + Math.round(150 * 700 / cam)];
    input('rclick', ...away);
    await sleep(3000);
    // the hero turned on the spot, to see it from every side in the game's own camera
    let i = 0;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const to = [away[0] + dx * 70, away[1] + dy * 70];
      input('rclick', ...to);
      await sleep(1300);
      shot(`05-turn-${++i}`, [to[0], to[1] - Math.round(90 * 700 / cam)]);
    }
    input('rclick', ...away);
    await sleep(1500);
    // the enemy hero, for the abilities aimed at a hero; it comes in front of where ours now stands
    bars = shot('05-before-enemy');
    click(AT.enemy);
    await sleep(2500);
    let withEnemy = shot('05-enemy');
    let enemy = spawned(bars, withEnemy);
    if (!enemy) note('the enemy hero\'s bar did not show up; aimed abilities go to the dummy');
    // it comes up inside our hero: ours steps back from both, or the two models are one blot
    input('rclick', away[0] + Math.round(60 * 700 / cam), away[1] + Math.round(200 * 700 / cam));
    await sleep(2500);
    withEnemy = shot('05-apart');
    enemy = enemy && follow(withEnemy, enemy, 'red', [dummy]);
    dummy = follow(withEnemy, dummy, 'red', enemy ? [enemy] : []) ?? dummy;
    heroBar = me(withEnemy, heroBar) ?? heroBar;
    // the attack, on the dummy
    input('rclick', ...bodyOf(dummy, cam));
    await sleep(2500);
    bars = shot('06-attack', bodyOf(heroBar, cam));
    heroBar = me(bars, heroBar) ?? heroBar;
    // the swing itself: one picture a second would catch it at the same point every time
    const [hx, hy] = bodyOf(heroBar, cam);
    const diffs = burst('06-swing', frame([[hx, hy - 40]], { pad: 0, min: AT.fight.slice(2) }), 16, 80, 0.6);
    const verdict = attackVerdict(diffs);
    fs.writeFileSync(path.join(out, 'verdict.json'), JSON.stringify({ vpk: vpk ?? null, hero, ...verdict, diffs, notes }, null, 2));
    console.log(`bench: the attack ${verdict.swings ? 'swings' : verdict.swings === false ? 'DOES NOT SWING' : 'could not be judged'} (median change ${verdict.median})`);
    // the same attack close, in the inspect, from the front and turned once
    input('key', inspectKey);
    await sleep(1800);
    burst('06-attack-close', close, 12, 120, 0.5);
    input('drag', turn, 'left');
    await sleep(700);
    burst('06-attack-close-side', close, 12, 120, 0.5);
    input('key', inspectKey);
    await sleep(2000);
    if (!process.argv.includes('--short')) {
      // every ability, cooldowns refreshed before each, the ones aimed at a hero on the enemy
      for (const { key, enemy: aimed } of skills) {
        const look = path.join(out, `07-before-${key}.png`);
        ps('shot.ps1', '-Out', look);
        bars = readBars(ps('bars.ps1', '-In', look));
        fs.rmSync(look, { force: true });
        heroBar = me(bars, heroBar) ?? heroBar;
        const target = aimed ? (enemy && follow(bars, enemy, 'red', [dummy])) || follow(bars, dummy, 'red') : null;
        if (aimed && enemy && target) enemy = target;
        if (!wtf) {
          click(AT.refresh);
          await sleep(600);
        }
        if (target) input('hover', ...bodyOf(target, cam));
        await sleep(200);
        input('key', key);
        await sleep(150);
        if (target) click(bodyOf(target, cam));
        else if (aimed) note(`${key}: no enemy on screen to aim at`);
        const points = [bodyOf(heroBar, cam), ...(target ? [bodyOf(target, cam)] : [])];
        burst(`07-skill-${key}`, frame(points, { pad: 260, min: [900, 640] }), 12, 220, 0.45);
        shot(`07-skill-${key}-after`, bodyOf(heroBar, cam));
        // back to our hero: a click on an enemy with no ability waiting selected that enemy
        click(bodyOf(heroBar, cam));
        await sleep(1500);
      }
    }
    shot('08-end');
  } finally {
    try { execFileSync('taskkill', ['/IM', 'dota2.exe'], { stdio: 'ignore' }); } catch { /* not running */ }
    await until(() => !dotaRunning(), 60000, 'Dota to close').catch(() => {});
    try { fs.copyFileSync(log, path.join(out, 'console.log')); } catch { /* the game wrote none */ }
    if (placed) { fs.rmSync(placed, { force: true }); console.log('bench: mod taken out'); }
  }
  console.log(`bench: ${shots.length} pictures in ${out}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
