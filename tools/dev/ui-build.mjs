#!/usr/bin/env node
/**
 * Builds the window's page into out/renderer-tauri, which the Tauri shell embeds, and copies the
 * uninstaller's page beside it.
 *
 * Everything that starts the app from a checkout runs this first (`npm start`, the sandbox, the
 * end-to-end run), and `tauri build` does too (tauri.conf.json beforeBuildCommand). It builds
 * every time: the shell embeds the page and nothing else, so a run on a stale build would test
 * yesterday's interface and pass.
 *
 *   node tools/dev/ui-build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireDeps } from './deps-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(root, 'out', 'renderer-tauri');

/* The uninstaller's window (renderer/uninstall.html) is not a Vite page: classic scripts and all.
 * The Tauri shell can only load what is in its own folder, so the page and what it links are
 * copied there as they are. Its IPC is a fetch to
 * ipc.localhost, which the page's connect-src has to name, as vite.config.mjs does for the main page. */
export const UNINSTALL_PAGE = [
  'uninstall.html', 'uninstall.js', 'i18n.js',
  'locales/zh-CN-catalog.js', 'locales/zh-CN-library.js', 'locales/zh-CN-app.js',
  'styles/fonts.css', 'styles/themes.css', 'styles/tokens.css', 'styles/base.css', 'styles/controls.css', 'styles/modal.css',
  'fonts',
];
export function copyUninstallPage(outDir, projectRoot = root) {
  const from = path.join(projectRoot, 'renderer');
  for (const rel of UNINSTALL_PAGE) {
    fs.cpSync(path.join(from, rel), path.join(outDir, rel), { recursive: true });
  }
  const page = path.join(outDir, 'uninstall.html');
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes("connect-src 'none'")) throw new Error('uninstall.html: the policy changed, see copyUninstallPage');
  fs.writeFileSync(page, html.replace("connect-src 'none'", 'connect-src ipc: http://ipc.localhost'));
}

/** Builds the page and the uninstaller's copy beside it. */
export async function buildUi({ quiet = true } = {}) {
  const { build } = await import('vite');
  await build({ configFile: path.join(root, 'vite.config.mjs'), logLevel: quiet ? 'warn' : 'info' });
  copyUninstallPage(OUT_DIR);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  requireDeps();
  await buildUi({ quiet: false });
}
