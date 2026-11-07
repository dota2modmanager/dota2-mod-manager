#!/usr/bin/env node
/**
 * Are the packages in node_modules the ones package-lock.json names?
 *
 * A `git pull` that brings a new dependency leaves node_modules behind until somebody runs
 * `npm install`. The page then fails to build or loads with an import missing, and the window
 * opens empty with nothing on screen to say why. That happened on 2026-11-03 after
 * qrcode-generator came in with the preset picture. Everything that starts the app from a
 * checkout asks this first and stops with the names and the command to run.
 *
 *   node tools/deps-check.mjs    exit 1 and print what is missing or at another version
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The direct dependencies that are missing from node_modules or at a version the lock does not name. */
export function staleDeps(root = ROOT) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf-8'));
  const pkgs = lock.packages || {};
  const top = pkgs[''] || {};
  const names = Object.keys({ ...top.dependencies, ...top.devDependencies, ...top.optionalDependencies });
  const out = [];
  for (const name of names) {
    const entry = pkgs[`node_modules/${name}`];
    const want = entry?.link ? pkgs[entry.resolved] : entry;
    if (!want || want.optional) continue;
    let have = null;
    try {
      have = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf-8')).version;
    } catch { /* not installed */ }
    if (have !== want.version) out.push({ name, want: want.version, have });
  }
  return out;
}

/** Prints what is stale and exits, or returns quietly when node_modules matches the lock. */
export function requireDeps(root = ROOT) {
  const stale = staleDeps(root);
  if (!stale.length) return;
  console.error('node_modules does not match package-lock.json:');
  for (const d of stale) console.error(`  ${d.name}: ${d.have ? `${d.have} installed` : 'not installed'}, the lock wants ${d.want}`);
  console.error('Run `npm install`, then start again.');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) requireDeps();
