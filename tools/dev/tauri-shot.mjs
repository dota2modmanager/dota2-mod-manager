#!/usr/bin/env node
/**
 * The Tauri build, started on the sandbox and looked at: a screenshot, the page's console errors,
 * and how long each step took. MM_SHOT's counterpart for the Rust shell (src-tauri/). The window
 * is started and attached to by tools/dev/tauri-window.mjs, so this needs a debug build.
 *
 *   node tools/dev/tauri-shot.mjs [--out shot.png] [--click "sel1||key:Escape||sel2"] [--wait 8000]
 *       [--eval "js expression"]   printed after the shot
 *       [--uninstall]              the uninstaller's run: its window, and the exit code it ends with
 *       [--link d2mm://...]        started by a link, as a click in the browser starts it
 *
 * Always on the sandbox (npm run sandbox:seed) and always with --write-jail=sandbox.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openWindow, root } from './tauri-window.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const out = path.resolve(arg('out', path.join(root, 'e2e-output', 'tauri.png')));
const wait = Number(arg('wait', '8000'));
const link = arg('link');
const uninstall = process.argv.includes('--uninstall');
const js = arg('eval');

if (!fs.existsSync(path.join(root, 'sandbox', 'userdata'))) { console.error('no sandbox: npm run sandbox:seed'); process.exit(1); }

const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
let win;
const finish = (code) => {
  try { win?.child.kill(); } catch { /* gone */ }
  if (code && win) console.error(win.log.join('').split('\n').slice(-40).join('\n'));
  process.exit(code);
};
setTimeout(() => { console.error('timed out'); finish(2); }, 120_000).unref();

const clicks = async (page, quiet) => {
  for (const sel of (arg('click') || '').split('||').filter(Boolean)) {
    const done = sel.startsWith('key:') ? page.keyboard.press(sel.slice(4)) : page.click(sel, { timeout: 10_000 });
    if (quiet) await done.catch(() => {});
    else { await done; await page.waitForTimeout(1500); }
  }
};
const shot = async (page) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`shot ${out} ${since()}`);
  if (js) console.log(JSON.stringify(await page.evaluate(js), null, 2));
};

try {
  win = await openWindow({
    args: ['--user-data-dir=sandbox/userdata', '--write-jail=sandbox', ...(link ? [link] : []), ...(uninstall ? ['--uninstall'] : [])],
    webviewData: path.join(root, 'sandbox', 'webview2'),
  });
  console.log(`attached ${since()}`);
  const { page } = win;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  // runs in the page, where window and document are
  // eslint-disable-next-line no-undef
  await page.waitForFunction(() => (window.api || window.uninstall) && document.querySelector('#root, #app, main, body > div'), null, { timeout: 30_000 });
  console.log(`page has its bridge ${since()}`);
  await page.waitForTimeout(wait);
  if (uninstall) {
    // the shot before the clicks: a click that answers ends the run, and the window with it
    await shot(page);
    await clicks(page, true);
    const code = await Promise.race([win.exited, new Promise((r) => setTimeout(() => r('still running'), 15_000))]);
    console.log(`exit code: ${code}`);
  } else {
    await clicks(page, false);
    await shot(page);
  }
  console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'console: no errors');
  await win.browser.close().catch(() => {});
  finish(0);
} catch (err) {
  console.error(String(err?.stack || err));
  finish(1);
}
