/**
 * Save the pictures of the builder's effects that the window still draws live, to ship with the
 * app (renderer/public/assets/effects/). A live picture takes seconds of WebGL on each machine,
 * so a shelf of forty stays a wall of glyphs for minutes. Run this after a Dota patch adds effects,
 * then list the new ids in EFFECT_PICTURES (renderer/catalog/builder/logic.ts).
 *
 * Usage: node tools/effect-pictures.mjs <throwaway folder> [hero]
 * The game is read through junctions, the app runs in a write jail on that folder.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'site', 'package.json'))('playwright-core');
if (!process.argv[2]) { console.error('usage: node tools/effect-pictures.mjs <throwaway folder> [hero]'); process.exit(2); }
const JAIL = path.resolve(process.argv[2]);
const hero = process.argv[3] ?? 'Juggernaut';
const REAL = process.env.DOTA_GAME ?? 'C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game';
const GAME = path.join(JAIL, 'g', 'game');
const USER = path.join(JAIL, 'ud');
const OUT = path.join(root, 'renderer', 'public', 'assets', 'effects');

if (!fs.existsSync(GAME)) {
  fs.mkdirSync(path.join(GAME, 'dota_russian'), { recursive: true });
  for (const n of ['dota', 'bin', 'core']) fs.symlinkSync(path.join(REAL, n), path.join(GAME, n), 'junction');
}
fs.mkdirSync(USER, { recursive: true });
const HAVE = path.join(process.env.APPDATA, 'Dota 2 Mod Manager', 'toolchain');
if (!fs.existsSync(path.join(USER, 'toolchain')) && fs.existsSync(HAVE)) fs.symlinkSync(HAVE, path.join(USER, 'toolchain'), 'junction');
fs.writeFileSync(path.join(USER, 'settings.json'), JSON.stringify({ dotaGamePath: GAME, uiLang: 'en', langPromptSeen: true }));
const app = await _electron.launch({
  executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [root, `--user-data-dir=${USER}`, `--write-jail=${JAIL}`],
  timeout: 60000,
});
try {
  const win = await app.firstWindow();
  await win.waitForTimeout(9000);
  for (let i = 0; i < 6; i++) {
    const quiet = win.locator('button').filter({ hasText: /^(Remind me later|Do not show|Not now|Got it)$/ });
    if (!(await quiet.count())) break;
    await quiet.first().click().catch(() => {});
    await win.waitForTimeout(500);
  }
  await win.click('[data-view="items"]');
  await win.waitForTimeout(1800);
  await win.click(`[data-item-hero="${hero}"]`);
  await win.waitForSelector('[data-item-slot]', { timeout: 20000 });
  await win.waitForTimeout(1000);
  await win.locator('[data-item-slot]').first().click();
  await win.waitForTimeout(1000);
  await win.locator('[data-item-option]').nth(2).click();
  await win.waitForTimeout(1500);
  await win.click('[data-slot-view="effects"]');
  await win.waitForSelector('[data-effect-id]');
  const ids = await win.locator('[data-effect-id]').evaluateAll((cards) => cards.map((c) => c.dataset.effectId));
  const saved = [];
  const dark = [];
  for (const id of ids) {
    const card = win.locator(`[data-effect-id="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    if (await card.locator('img[src*="assets/effects"]').count()) continue;
    let uri = null;
    // the queue draws in order, so a card waits for the ones before it
    for (let i = 0; i < 60 && !uri; i++) {
      uri = await card.locator('img').getAttribute('src', { timeout: 100 }).catch(() => null);
      if (!uri) await win.waitForTimeout(500);
    }
    if (!uri?.startsWith('data:image/webp')) { dark.push(id); continue; }
    fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(uri.split(',')[1], 'base64'));
    saved.push(id);
    console.log('saved', id);
  }
  console.log(`saved ${saved.length}: ${saved.join(' ')}`);
  console.log(`no picture ${dark.length}: ${dark.join(' ')}`);
} finally {
  await app.close();
}
