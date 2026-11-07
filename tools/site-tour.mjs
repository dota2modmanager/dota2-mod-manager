#!/usr/bin/env node
/* global document, window */
/**
 * The site's tour of the app, in English and in Russian: the real window on the real game, filmed
 * off Chromium's screencast. The time spent waiting for a model or a build is left out of the film
 * and nothing else is, so the clip plays at the speed the app does.
 *
 *   node tools/site-tour.mjs <folder>
 *
 * <folder> is the throwaway one tools/site-shots.mjs made: run that first, the builder there leaves
 * a set on the hero and the models in its cache. Writes site/public/video/dota-2-mod-manager-tour-
 * <lang>.webm and its poster. Needs the ffmpeg playwright-core installs (npx playwright-core install
 * ffmpeg) and, from site/node_modules, playwright-core and sharp.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromSite = createRequire(path.join(root, 'site', 'package.json'));
const { _electron } = fromSite('playwright-core');
const sharp = fromSite('sharp');

if (!process.argv[2]) { console.error('usage: node tools/site-tour.mjs <folder>'); process.exit(1); }
const JAIL = path.resolve(process.argv[2]);
const GAME = path.join(JAIL, 'g', 'game');
const USER = path.join(JAIL, 'ud');
const DEST = path.join(root, 'site', 'public', 'video');
const FPS = 25;

function ffmpeg() {
  const home = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
  const dirs = fs.readdirSync(home).filter((d) => d.startsWith('ffmpeg-')).sort().reverse();
  if (!dirs.length) throw new Error('no ffmpeg: npx playwright-core install ffmpeg');
  return path.join(home, dirs[0], 'ffmpeg-win64.exe');
}

/** Frames of the screencast, on a clock that stops while the film is paused. */
function camera(cdp) {
  const frames = [];
  let rolling = false;
  let clock = 0;
  let last = 0;
  const ticks = () => (rolling ? clock + (Date.now() - last) : clock);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    if (rolling) frames.push({ at: ticks(), jpeg: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  return {
    start: () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 }),
    stop: () => cdp.send('Page.stopScreencast'),
    roll() { last = Date.now(); rolling = true; },
    cut() { clock = ticks(); rolling = false; },
    frames,
  };
}

async function encode(frames, out) {
  const proc = spawn(ffmpeg(), ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libvpx-vp9', '-vf', 'scale=1100:-2', '-b:v', '550k', '-deadline', 'good', '-cpu-used', '3', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an', out],
  { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((resolve, reject) => proc.on('close', (c) => (c ? reject(new Error(`ffmpeg ${c}`)) : resolve())));
  // the screencast sends frames when the screen changes: for each frame of the film, the latest one
  const end = frames.at(-1).at + 500;
  let i = 0;
  for (let n = 0; (n * 1000) / FPS < end; n++) {
    while (i + 1 < frames.length && frames[i + 1].at <= (n * 1000) / FPS) i++;
    if (!proc.stdin.write(frames[i].jpeg)) await new Promise((r) => proc.stdin.once('drain', r));
  }
  proc.stdin.end();
  await done;
}

/** A dot for the mouse: the screencast does not draw one. It follows the real events. */
const showMouse = (win) => win.evaluate(() => {
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed', left: '0', top: '0', width: '18px', height: '18px', margin: '-9px 0 0 -9px', borderRadius: '50%', zIndex: '2147483647',
    pointerEvents: 'none', background: 'rgba(255,255,255,.92)', border: '2px solid rgba(20,18,28,.85)', boxShadow: '0 1px 6px rgba(0,0,0,.6)',
    transition: 'scale 120ms', transform: 'translate(680px, 430px)',
  });
  document.body.append(dot);
  window.addEventListener('mousemove', (e) => { dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }, true);
  window.addEventListener('mousedown', () => { dot.style.scale = '0.7'; }, true);
  window.addEventListener('mouseup', () => { dot.style.scale = '1'; }, true);
});

function director(win, cam) {
  const wait = (ms) => win.waitForTimeout(ms);
  const glideTo = async (x, y) => { await win.mouse.move(x, y, { steps: 22 }); await wait(160); };
  const centre = async (sel) => {
    const box = await win.locator(sel).first().boundingBox();
    if (!box) throw new Error(`not on screen: ${sel}`);
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const press = async (sel) => {
    await win.locator(sel).first().scrollIntoViewIfNeeded();
    await glideTo(...await centre(sel));
    await win.mouse.down();
    await win.mouse.up();
  };
  const offCamera = async (work) => { cam.cut(); await work(); cam.roll(); };
  const drag = async (from, to) => {
    await glideTo(...from);
    await win.mouse.down();
    await win.mouse.move(to[0], to[1], { steps: 40 });
    await wait(160);
    await win.mouse.up();
  };
  return { wait, glideTo, press, centre, offCamera, drag };
}

async function shoot(win, cam, lang) {
  const d = director(win, cam);
  const closeTool = async () => { await win.keyboard.press('Escape'); await d.wait(700); };

  // the catalog: a section, a mod, install
  await d.wait(900);
  await d.press('[data-cat="heroes"]');
  await d.wait(1100);
  await d.press('text=Juggernaut');
  await d.wait(1200);
  await d.press(`.card-open >> nth=${lang === 'en' ? 0 : 1}`);
  await d.wait(1500);
  if (await win.locator('#installBtn').count()) await d.press('#installBtn');
  await d.wait(1800);
  await closeTool();

  // the item builder, on a hero already dressed
  await d.press('[data-view="items"]');
  await d.wait(900);
  await d.press('[data-item-hero="Juggernaut"]');
  await d.offCamera(async () => {
    await win.waitForSelector('#preview3dBtn', { timeout: 15000 });
    if ((await win.getAttribute('#preview3dBtn', 'aria-pressed')) !== 'true') await win.click('#preview3dBtn');
    await win.waitForFunction(() => document.querySelector('#preview3d')?.dataset.status === 'shown', null, { timeout: 120000 });
    await d.wait(2500);
  });
  await d.wait(900);
  const [sx, sy] = await d.centre('#preview3d');
  await d.drag([sx, sy], [sx + 170, sy + 10]);
  await d.wait(900);
  await d.drag([sx + 170, sy + 10], [sx - 120, sy - 10]);
  await d.wait(1200);
  await closeTool();

  // the Workshop
  await d.press('[data-view="studio"]');
  await d.wait(1200);
  await d.glideTo(700, 500);
  await win.mouse.wheel(0, 360);
  await d.wait(1400);
  await win.mouse.wheel(0, -360);
  await d.wait(600);

  // the effect editor: a whole ability, bigger
  await d.press('[data-tool="effects"]');
  await d.offCamera(async () => { await win.waitForSelector('.fx-editor', { timeout: 30000 }); await d.wait(1500); });
  await win.locator('[data-hero="ember_spirit"]').scrollIntoViewIfNeeded();
  await d.press('[data-hero="ember_spirit"]');
  await d.wait(900);
  await d.press('[data-group="ability:ember_spirit_sleight_of_fist"]');
  await d.offCamera(() => d.wait(4000));
  await d.press('#fxReplay');
  await d.wait(1600);
  // bigger and slower, so the fire stays on screen long enough to read
  const sliders = win.locator('.fx-editor input[type="range"]');
  const along = async (nth, from, to) => {
    const box = await sliders.nth(nth).boundingBox();
    const y = box.y + box.height / 2;
    await d.drag([box.x + box.width * from, y], [box.x + box.width * to, y]);
  };
  await along(0, 0.31, 0.62);
  await d.wait(300);
  await along(3, 0.31, 0.1);
  await d.wait(300);
  await d.press('#fxReplay');
  await d.wait(4200);
  await closeTool();
  await closeTool();

  // the HUD editor: the minimap across the screen
  await d.press('[data-tool="hud"]');
  await d.offCamera(() => d.wait(3000));
  const map = await win.locator('[data-part="minimap_container"]').boundingBox();
  await d.drag([map.x + map.width / 2, map.y + map.height / 2], [map.x + map.width / 2 + 330, map.y + map.height / 2 - 150]);
  await d.wait(1400);
  await closeTool();

  // My mods: everything in one list
  await d.press('[data-view="library"]');
  await d.wait(1300);
  await d.press('.toggle[data-id]');
  await d.wait(900);
  await d.press('.toggle[data-id]');
  await d.wait(1500);

  await win.screenshot({ path: path.join(JAIL, `tour-end-${lang}.png`) });
}

for (const lang of ['en', 'ru']) {
  const file = path.join(USER, 'settings.json');
  let was = {};
  try { was = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first run has no settings yet */ }
  fs.writeFileSync(file, JSON.stringify({ ...was, dotaGamePath: GAME, uiLang: lang, langPromptSeen: true }));

  const app = await _electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [root, `--user-data-dir=${USER}`, `--write-jail=${JAIL}`],
    timeout: 60000,
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('pageerror', e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setContentSize(1360, 860);
    w.center();
  });
  await win.waitForTimeout(9000);
  for (let i = 0; i < 6; i++) {
    const quiet = win.locator('button').filter({ hasText: /^(Напомнить позже|Не показывать|Не сейчас|Понятно|Remind me later|Do not show|Not now|Got it)$/ });
    if (!(await quiet.count())) break;
    await quiet.first().click().catch(() => {});
    await win.waitForTimeout(500);
  }
  await showMouse(win);
  await win.click('[data-view="catalog"]');
  await win.waitForTimeout(2500);

  const cam = camera(await win.context().newCDPSession(win));
  await cam.start();
  cam.roll();
  try {
    await shoot(win, cam, lang);
  } catch (e) {
    console.log(`${lang} stopped: ${e.message.slice(0, 200)}`);
    await win.screenshot({ path: path.join(JAIL, `tour-fail-${lang}.png`) });
  }
  cam.cut();
  await cam.stop().catch(() => {});
  await app.close();

  const seconds = cam.frames.length ? cam.frames.at(-1).at / 1000 : 0;
  console.log(`${lang}: ${cam.frames.length} frames, ${seconds.toFixed(1)} s`);
  const name = `dota-2-mod-manager-tour-${lang}`;
  await encode(cam.frames, path.join(DEST, `${name}.webm`));
  await sharp(cam.frames[Math.floor(cam.frames.length * 0.42)].jpeg).resize(1360, 860, { fit: 'cover' }).webp({ quality: 82 }).toFile(path.join(DEST, `${name}.webp`));
  console.log(`${name}: ${(fs.statSync(path.join(DEST, `${name}.webm`)).size / 1048576).toFixed(1)} MB`);
}
