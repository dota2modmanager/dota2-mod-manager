#!/usr/bin/env node
/* global document, window */
/**
 * The site's and the README's big pictures of the app, in English and in Russian.
 *
 * tools/guide-shots.mjs takes the crops inside the guides from the sandbox. The sandbox has no hero
 * models, so the builder, the 3D preview and the effect editor have nothing to draw there. This run
 * reads the real game instead, through junctions, with --write-jail on a throwaway folder: the app
 * cannot write anywhere else.
 *
 *   node tools/site-shots.mjs <throwaway folder>
 *
 * Writes site/public/screenshots/dota-2-mod-manager-<name>-<lang>.webp at 1360x860, and a copy 1200
 * wide into site/public/guides for the ones a guide shows (site/src/i18n/doc-shots.ts). Needs Windows,
 * the game and playwright-core and sharp from site/node_modules. Move the window's look, run it again.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromSite = createRequire(path.join(root, 'site', 'package.json'));
const { _electron } = fromSite('playwright-core');
const sharp = fromSite('sharp');

const JAIL = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node tools/site-shots.mjs <throwaway folder>'); process.exit(1); }
const REAL = process.env.DOTA_GAME || 'C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game';
const GAME = path.join(JAIL, 'g', 'game');
const USER = path.join(JAIL, 'ud');
const DEST = path.join(root, 'site', 'public', 'screenshots');
const ONLY = (process.env.SHOTS || '').split(',').filter(Boolean);
const GUIDE = ['builder', 'workshop', 'effects', 'hud'];
const MODS = [
  { categoryId: 'heroes', name: 'Morphling Pink', styleLabel: null, fileRef: 'Morphling Pink.zip', preview: 'Morphling Pink.webp' },
  { categoryId: 'roshan', name: 'Aghanims Roshan', styleLabel: null, fileRef: 'pak52_dir.vpk', preview: null },
];

// the 3D preview's model tools, as the installed app already downloaded them
const TOOLS = path.join(USER, 'toolchain');
const HAVE = path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'toolchain');
if (!fs.existsSync(GAME)) {
  fs.mkdirSync(path.join(GAME, 'dota_russian'), { recursive: true });
  fs.mkdirSync(USER, { recursive: true });
  for (const n of ['dota', 'bin', 'core']) {
    execSync(`cmd /c mklink /J "${path.join(GAME, n)}" "${path.join(REAL, n).replace(/\//g, '\\')}"`);
  }
}

const settle = (win, ms) => win.waitForTimeout(ms);

async function clearDialogs(win) {
  for (let i = 0; i < 6; i++) {
    const quiet = win.locator('button').filter({ hasText: /^(Напомнить позже|Не показывать|Не сейчас|Remind me later|Do not show|Not now)$/ });
    if (!(await quiet.count())) return;
    await quiet.first().click().catch(() => {});
    await settle(win, 500);
  }
}

async function open(win, view) {
  await win.click(`[data-view="${view}"]`);
  await settle(win, 1800);
  await clearDialogs(win);
}

async function closeWindow(win) {
  await win.keyboard.press('Escape');
  await settle(win, 600);
  const close = win.locator('#modalCloseBtn');
  if (await close.count()) await close.first().click().catch(() => {});
  await settle(win, 600);
}

/** An effect plays once, so stop the frame near its peak: the moment the stage is brightest. */
async function brightest(win) {
  let best = 0;
  let bestAt = 300;
  const from = Date.now();
  for (let i = 0; i < 12; i++) {
    const shot = await win.locator('#fxCanvas').screenshot();
    const { channels } = await sharp(shot).stats();
    const lit = channels[0].mean + channels[1].mean + channels[2].mean;
    if (lit > best) { best = lit; bestAt = Date.now() - from; }
  }
  await win.click('#fxReplay').catch(() => {});
  await settle(win, bestAt);
}

function linkTools() {
  if (!fs.existsSync(TOOLS) && fs.existsSync(HAVE)) execSync(`cmd /c mklink /J "${TOOLS}" "${HAVE}"`);
}

const STEPS = {
  async catalog(win) { await open(win, 'catalog'); await settle(win, 2500); },
  async 'my-mods'(win) { await open(win, 'library'); await settle(win, 1500); },
  async builder(win) {
    await open(win, 'items');
    await win.click('[data-item-hero="Juggernaut"]');
    await win.waitForSelector('#preview3dBtn', { timeout: 15000 });
    await settle(win, 800);
    if (!(await win.locator('.item-pick-card.installed').count())) {
      await win.locator('.item-pick-card').first().click();
      await settle(win, 1500);
      await win.locator('button').filter({ hasText: /Equip the whole set|Надеть весь набор/ }).first().click();
      await settle(win, 30000);
      await clearDialogs(win);
    }
    if ((await win.getAttribute('#preview3dBtn', 'aria-pressed')) !== 'true') await win.click('#preview3dBtn');
    await win.waitForFunction(() => document.querySelector('#preview3d')?.dataset.status === 'shown', null, { timeout: 120000 });
    await settle(win, 9000);
  },
  async workshop(win) { await open(win, 'studio'); await settle(win, 1500); },
  async hud(win) { await open(win, 'studio'); await win.click('[data-tool="hud"]'); await settle(win, 3500); },
  async effects(win) {
    await open(win, 'studio');
    await win.click('[data-tool="effects"]');
    await win.waitForSelector('.fx-editor', { timeout: 30000 });
    await settle(win, 2500);
    await win.click('[data-hero="lina"]');
    await settle(win, 1500);
    await win.click('[data-group]:has-text("Dragon Slave"), [data-group]');
    await settle(win, 6000);
    await win.click('#fxReplay').catch(() => {});
    await brightest(win);
  },
};

linkTools();
for (const lang of ['en', 'ru']) {
  const file = path.join(USER, 'settings.json');
  const was = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
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
  await settle(win, 9000);
  await clearDialogs(win);
  await win.evaluate((mods) => Promise.all(mods.map((m) => window.api.mods.install(m).catch(() => null))), MODS);

  for (const [name, step] of Object.entries(STEPS)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    try {
      await step(win);
      await win.mouse.move(2, 2);
      const png = await win.screenshot();
      await sharp(png).resize(1360, 860, { fit: 'cover', position: 'top' }).webp({ quality: 86 })
        .toFile(path.join(DEST, `dota-2-mod-manager-${name}-${lang}.webp`));
      if (GUIDE.includes(name)) await sharp(png).resize({ width: 1200 }).webp({ quality: 84 }).toFile(path.join(root, 'site', 'public', 'guides', `${name}-${lang}.webp`));
      console.log(`${name}-${lang}`);
    } catch (e) {
      console.log(`${name}-${lang} FAILED: ${e.message.slice(0, 200)}`);
      await win.screenshot({ path: path.join(JAIL, `${name}-${lang}-fail.png`) });
    }
    await closeWindow(win);
  }
  await app.close();
}
