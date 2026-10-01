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
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_PAGE = path.join(root, 'out', 'renderer', 'index.html');

/** The newest modification time among the files the page is built from. */
function newestSource() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(path.join(root, 'renderer'));
  for (const f of ['vite.config.mjs', 'package-lock.json']) newest = Math.max(newest, fs.statSync(path.join(root, f)).mtimeMs);
  return newest;
}

/** Whether out/renderer is missing or older than a source file. */
export function isStale() {
  if (!fs.existsSync(OUT_PAGE)) return true;
  return newestSource() > fs.statSync(OUT_PAGE).mtimeMs;
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
  const force = process.argv.includes('--force');
  const built = force ? (await buildUi({ quiet: false }), true) : await ensureUi({ quiet: false });
  if (!built) console.log('out/renderer is up to date');
}
