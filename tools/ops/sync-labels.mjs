#!/usr/bin/env node
/**
 * Makes the repository's labels match .github/labels.json.
 *
 * Labels were whatever GitHub creates for a new repository plus what Dependabot added, and the
 * ones the radar and the pull request rule depend on (regression, needs-decision) did not exist.
 * Now the file is the list: missing labels are created, a changed colour or description is
 * updated, and labels that exist only on GitHub are reported and left in place, because an old
 * issue may still carry one.
 *
 * Usage:
 *   GH_TOKEN=... node tools/ops/sync-labels.mjs          # apply
 *   GH_TOKEN=... node tools/ops/sync-labels.mjs --dry    # say what would change
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

export function desiredLabels() {
  return JSON.parse(fs.readFileSync(path.join(root, '.github', 'labels.json'), 'utf8')).labels;
}

/** What has to change for `current` to match `desired`. Names compare without regard to case, as on GitHub. */
export function plan(current, desired) {
  const have = new Map(current.map((l) => [l.name.toLowerCase(), l]));
  const want = new Set(desired.map((l) => l.name.toLowerCase()));
  const create = [];
  const update = [];
  for (const d of desired) {
    const c = have.get(d.name.toLowerCase());
    if (!c) create.push(d);
    else if (c.name !== d.name || c.color.toLowerCase() !== d.color.toLowerCase() || (c.description || '') !== (d.description || '')) update.push({ from: c.name, ...d });
  }
  const extra = current.filter((l) => !want.has(l.name.toLowerCase())).map((l) => l.name);
  return { create, update, extra };
}

async function api(pathname, { method = 'GET', body, token }) {
  const res = await fetch(`https://api.github.com/${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dota2-mod-manager-labels',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const dry = process.argv.includes('--dry');
  const repo = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const current = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await api(`repos/${repo}/labels?per_page=100&page=${page}`, { token });
    current.push(...batch);
    if (batch.length < 100) break;
  }
  const { create, update, extra } = plan(current, desiredLabels());
  for (const l of create) {
    console.log(`create  ${l.name}`);
    if (!dry) await api(`repos/${repo}/labels`, { method: 'POST', body: l, token });
  }
  for (const l of update) {
    console.log(`update  ${l.from}${l.from !== l.name ? ` -> ${l.name}` : ''}`);
    if (!dry) await api(`repos/${repo}/labels/${encodeURIComponent(l.from)}`, { method: 'PATCH', body: { new_name: l.name, color: l.color, description: l.description }, token });
  }
  for (const name of extra) console.log(`only on GitHub, left alone: ${name}`);
  console.log(`${create.length} created, ${update.length} updated, ${extra.length} not in the file${dry ? ' (dry run)' : ''}`);
}
