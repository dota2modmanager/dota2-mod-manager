#!/usr/bin/env node
/**
 * The licences of every Rust crate compiled into the app, written beside the page the shell
 * embeds (out/renderer-tauri/THIRD-PARTY-LICENSES-RUST.md), so they ship inside the binary the
 * way the page's own THIRD-PARTY-LICENSES.md does (vite.config.mjs). NOTICE points at both.
 *
 * The crates are what `cargo metadata` resolves for the shell on this machine's platform,
 * following normal dependencies only: build scripts and dev-dependencies never reach the binary.
 * Each crate's licence files are read from its own source folder; crates that carry the same
 * text are listed under it once.
 *
 *   node tools/dev/rust-licenses.mjs [--out <file>]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const SHELL = 'dota2-mod-manager';
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

/** The host's target triple, so the graph is the one this build compiles. */
function host() {
  const v = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  return v.match(/^host: (\S+)/m)[1];
}

/** The packages the shell's binary is built from, its own workspace crates excluded. */
export function shipped(meta) {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const start = meta.packages.find((p) => p.name === SHELL);
  if (!start) throw new Error(`no ${SHELL} package in the workspace`);
  const seen = new Set();
  const todo = [start.id];
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id)?.deps || []) {
      if (d.dep_kinds.some((k) => k.kind === null)) todo.push(d.pkg);
    }
  }
  const members = new Set(meta.workspace_members);
  return [...seen].filter((id) => !members.has(id)).map((id) => byId.get(id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** A crate's licence texts, read from the folder its Cargo.toml is in. */
function texts(pkg) {
  const dir = path.dirname(pkg.manifest_path);
  const files = fs.readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim());
}

export function render(pkgs) {
  const groups = new Map();
  const bare = [];
  for (const p of pkgs) {
    const t = texts(p);
    const label = `${p.name} ${p.version} (${p.license || p.license_file || 'no licence named'})${p.repository ? ` ${p.repository}` : ''}`;
    if (!t.length) { bare.push(label); continue; }
    for (const text of t) {
      const key = createHash('sha256').update(text).digest('hex');
      if (!groups.has(key)) groups.set(key, { text, crates: [] });
      if (!groups.get(key).crates.includes(label)) groups.get(key).crates.push(label);
    }
  }
  const out = [
    '# Rust crates in Dota 2 Mod Manager',
    '',
    `The app's binary is compiled from these ${pkgs.length} crates. Each licence text below is followed by the crates it came with.`,
    '',
  ];
  for (const { text, crates } of groups.values()) {
    out.push('---', '', '```', text.replace(/```/g, "'''"), '```', '', ...crates.map((c) => `- ${c}`), '');
  }
  if (bare.length) {
    out.push('---', '', 'These crates name their licence in Cargo.toml and carry no licence file of their own:', '', ...bare.map((c) => `- ${c}`), '');
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = i === -1 ? path.join(root, 'out', 'renderer-tauri', 'THIRD-PARTY-LICENSES-RUST.md') : path.resolve(process.argv[i + 1]);
  const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', host()], {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  }));
  const pkgs = shipped(meta);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(pkgs));
  console.log(`${pkgs.length} crates -> ${path.relative(root, out)}`);
}
