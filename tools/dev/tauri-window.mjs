/**
 * The Tauri build started and attached to with playwright-core, for the tools that drive the
 * window: tools/dev/tauri-shot.mjs, tools/site/site-shots.mjs, tools/site/site-tour.mjs and
 * tools/mods/effect-pictures.mjs.
 *
 * WebView2 is Chromium, so it opens a DevTools port when WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
 * asks, and playwright-core attaches to it over CDP. Only a debug build listens: a release build
 * drops every WEBVIEW2_ switch at start (src-tauri/src/main.rs), so this runs `cargo build`
 * output. Nothing is downloaded: playwright-core comes from site/node_modules.
 *
 *   const w = await openWindow({ args: ['--user-data-dir=...', '--write-jail=...'] });
 *   await w.page.click(...); await w.close();
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const root = path.resolve(import.meta.dirname, '../..');

/** The debug build of the shell, or null when there is none. */
export function shellExe() {
  const dir = path.join(root, 'target', 'debug');
  const names = process.platform === 'win32' ? ['dota2-mod-manager.exe', 'Dota 2 Mod Manager.exe'] : ['dota2-mod-manager'];
  return names.map((n) => path.join(dir, n)).find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Start the shell with `args` and attach to its window. `webviewData` is WebView2's own profile
 * folder, kept beside the run so it never touches the installed app's. `size` sets the page's
 * viewport, which is what a screenshot takes. Throws when there is no build or no window.
 */
export async function openWindow({ args, webviewData, size, cwd = root, attachFor = 30_000 }) {
  const exe = shellExe();
  if (!exe) throw new Error(`no debug build in ${path.join(root, 'target', 'debug')}: cargo build -p dota2-mod-manager`);
  if (!webviewData) {
    const jail = args.find((a) => a.startsWith('--write-jail='))?.slice('--write-jail='.length);
    webviewData = path.join(jail ? path.resolve(cwd, jail) : root, 'webview2');
  }
  const { chromium } = createRequire(path.join(root, 'site', 'package.json'))('playwright-core');
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(exe, args, {
    cwd,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
    },
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  const log = [];
  child.stderr.on('data', (d) => { log.push(String(d)); if (process.env.MM_TRACE) process.stderr.write(d); });
  // the uninstaller reads the exit code as the answer (src-tauri/src/uninstall.rs)
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  let gone = false;
  exited.then(() => { gone = true; });

  let browser;
  const until = Date.now() + attachFor;
  for (;;) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {
      if (gone || Date.now() > until) {
        try { child.kill(); } catch { /* gone */ }
        throw new Error(`the window never opened a DevTools port\n${log.join('').split('\n').slice(-30).join('\n')}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  if (size) await page.setViewportSize(size);
  const close = async () => {
    await browser.close().catch(() => {});
    try { child.kill(); } catch { /* gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  };
  return { page, browser, child, exited, log, close };
}
