#!/usr/bin/env node
/**
 * Builds the window's page into out/renderer when it is missing or older than its sources.
 *
 * Everything that starts the app from a checkout goes through here first: `npm start`, the
 * sandbox, the simulation and the end-to-end run. The main process loads the built page and
 * nothing else, so a run on a stale build would test yesterday's interface and pass.
 * electron-builder rebuilds it unconditionally before packing (tools/before-pack.cjs), so an
 * installer never carries an old one either.
 *
 *   node tools/ui-build.mjs           build if stale
 *   node tools/ui-build.mjs --force   build anyway
 *   node tools/ui-build.mjs --tauri   the Tauri shell's copy, out/renderer-tauri (vite.config.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireDeps } from './deps-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_PAGE = path.join(root, 'out', 'renderer', 'index.html');

/** The newest modification time among the files the page is built from. */
function newestSource(projectRoot) {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(path.join(projectRoot, 'renderer'));
  if (fs.existsSync(path.join(projectRoot, 'vendor'))) walk(path.join(projectRoot, 'vendor'));
  for (const f of ['vite.config.mjs', 'package-lock.json']) newest = Math.max(newest, fs.statSync(path.join(projectRoot, f)).mtimeMs);
  return newest;
}

/** Whether out/renderer is missing or older than a source file. */
export function isStale(projectRoot = root) {
  const page = path.join(projectRoot, 'out', 'renderer', 'index.html');
  if (!fs.existsSync(page)) return true;
  return newestSource(projectRoot) > fs.statSync(page).mtimeMs;
}

/* The uninstaller's window (renderer/uninstall.html) is not a Vite page: Electron loads it
 * straight from renderer/, classic scripts and all. The Tauri shell can only load what is in its
 * own folder, so the page and what it links are copied there as they are. Its IPC is a fetch to
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

/** Builds the page. Quiet unless it fails: the tools that call this print their own progress. */
export async function buildUi({ quiet = true } = {}) {
  const { build } = await import('vite');
  await build({ configFile: path.join(root, 'vite.config.mjs'), logLevel: quiet ? 'warn' : 'info' });
}

/** Builds the page when it is stale; returns whether it built. */
export async function ensureUi(opts) {
  if (!isStale()) return false;
  await buildUi(opts);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  requireDeps();
  if (process.argv.includes('--tauri')) {
    process.env.MM_TARGET = 'tauri';
    await buildUi({ quiet: false });
    copyUninstallPage(path.join(root, 'out', 'renderer-tauri'));
    process.exit(0);
  }
  const force = process.argv.includes('--force');
  const built = force ? (await buildUi({ quiet: false }), true) : await ensureUi({ quiet: false });
  if (!built) console.log('out/renderer is up to date');
}
