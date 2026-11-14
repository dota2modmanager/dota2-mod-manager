#!/usr/bin/env node
/**
 * The Tauri build, started on the sandbox and looked at: a screenshot, the page's console errors,
 * and how long each step took. MM_SHOT's counterpart for the Rust shell (src-tauri/).
 *
 * WebView2 is Chromium, so it opens a DevTools port when asked (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)
 * and playwright-core attaches to it over CDP. Nothing is downloaded: playwright-core comes from
 * site/node_modules, and the browser is the window itself.
 *
 *   node tools/tauri-shot.mjs [--out shot.png] [--click "sel1||key:Escape||sel2"] [--wait 8000] [--release]
 *       [--eval "js expression"]   printed after the shot
 *       [--uninstall]              the uninstaller's run: its window, and the exit code it ends with
 *
 * Always on the sandbox (npm run sandbox:seed) and always with --write-jail=sandbox.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const out = path.resolve(arg('out', path.join(root, 'e2e-output', 'tauri.png')));
const wait = Number(arg('wait', '8000'));
const profile = process.argv.includes('--release') ? 'release' : 'debug';
// cargo names the binary after the crate; `tauri build` renames it to mainBinaryName (tauri.conf.json)
const exe = [
  path.join(root, 'target', profile, process.platform === 'win32' ? 'dota2-mod-manager.exe' : 'dota2-mod-manager'),
  path.join(root, 'target', profile, process.platform === 'win32' ? 'Dota 2 Mod Manager.exe' : 'Dota 2 Mod Manager'),
].find((p) => fs.existsSync(p)) || path.join(root, 'target', profile, 'dota2-mod-manager');
const port = 9300 + Math.floor(Math.random() * 500);

if (!fs.existsSync(exe)) { console.error(`no build at ${exe}: cargo build -p dota2-mod-manager${profile === 'release' ? ' --release' : ''}`); process.exit(1); }
if (!fs.existsSync(path.join(root, 'sandbox', 'userdata'))) { console.error('no sandbox: npm run sandbox:seed'); process.exit(1); }

const require = createRequire(path.join(root, 'site', 'package.json'));
const { chromium } = require('playwright-core');

const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
// --link d2mm://...: started by a link, as a click in the browser starts it
const link = arg('link');
const uninstall = process.argv.includes('--uninstall');
const child = spawn(exe, ['--user-data-dir=sandbox/userdata', '--write-jail=sandbox', ...(link ? [link] : []), ...(uninstall ? ['--uninstall'] : [])], {
  cwd: root,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'sandbox', 'webview2'),
  },
  stdio: ['ignore', 'inherit', 'pipe'],
});
const hostLog = [];
child.stderr.on('data', (d) => { hostLog.push(String(d)); if (process.env.MM_TRACE) process.stderr.write(d); });
// the uninstaller reads the exit code as the answer (build/installer.nsh)
const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

let browser;
const finish = (code) => {
  try { child.kill(); } catch { /* gone */ }
  if (code) console.error(hostLog.join('').split('\n').slice(-40).join('\n'));
  process.exit(code);
};
setTimeout(() => { console.error('timed out'); finish(2); }, 120_000).unref();

try {
  for (let i = 0; ; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {
      if (i > 150) throw new Error('the window never opened a DevTools port');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log(`attached ${since()}`);
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].waitForEvent('page');
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  // runs in the page, where window and document are
  // eslint-disable-next-line no-undef
  await page.waitForFunction(() => (window.api || window.uninstall) && document.querySelector('#root, #app, main, body > div'), null, { timeout: 30_000 });
  console.log(`page has its bridge ${since()}`);
  await page.waitForTimeout(wait);
  const js = arg('eval');
  if (uninstall) {
    // the shot before the clicks: a click that answers ends the run, and the window with it
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`shot ${out} ${since()}`);
    if (js) console.log(JSON.stringify(await page.evaluate(js), null, 2));
    for (const sel of (arg('click') || '').split('||').filter(Boolean)) {
      if (sel.startsWith('key:')) await page.keyboard.press(sel.slice(4)).catch(() => {});
      else await page.click(sel, { timeout: 10_000 }).catch(() => {});
    }
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 15_000))]);
    console.log(`exit code: ${code}`);
    console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'console: no errors');
    await browser.close().catch(() => {});
    finish(0);
  }
  for (const sel of (arg('click') || '').split('||').filter(Boolean)) {
    if (sel.startsWith('key:')) await page.keyboard.press(sel.slice(4));
    else await page.click(sel, { timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`shot ${out} ${since()}`);
  if (js) console.log(JSON.stringify(await page.evaluate(js), null, 2));
  console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'console: no errors');
  await browser.close().catch(() => {});
  finish(0);
} catch (err) {
  console.error(String(err?.stack || err));
  finish(1);
}
