/**
 * index.json for the community presets: every published preset with its likes and dislikes, the
 * one file the app reads (crates/mm-core/src/presets/community_presets.rs). Run by
 * .github/workflows/community-presets.yml on a checkout of the branch:
 *
 *   node tools/ops/presets-worker/index.mjs <branch checkout>
 *
 * The records go through as the worker signed them; this only counts and leaves out. A file that
 * does not parse, a preset a maintainer listed in hidden.json, and a vote for a preset that is no
 * longer there are skipped. The output is the same bytes for the same input, so a run with nothing
 * new commits nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = /^[0-9a-f]{16}-[0-9a-z]{6}$/;
const USER = /^[0-9a-f]{16}$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

/**
 * The index from what is in the branch: `presets` maps an id to its {record, sig} file, `votes`
 * a user key to that person's votes, `hidden` the ids taken down.
 */
export function buildIndex({ presets, votes, hidden }) {
  const out = [];
  const hide = new Set(Array.isArray(hidden) ? hidden.filter((h) => typeof h === 'string') : []);
  for (const [id, file] of Object.entries(presets)) {
    if (!ID.test(id) || hide.has(id) || !file || typeof file.record !== 'string' || typeof file.sig !== 'string') continue;
    let rec;
    try {
      rec = JSON.parse(file.record);
    } catch {
      continue;
    }
    // the file's name and the signed id must agree, or a renamed file would carry another's votes
    if (rec?.id !== id) continue;
    out.push({ id, created: String(rec.created || ''), record: file.record, sig: file.sig, up: 0, down: 0 });
  }
  const byId = new Map(out.map((p) => [p.id, p]));
  for (const [user, list] of Object.entries(votes)) {
    if (!USER.test(user) || !list || typeof list !== 'object' || Array.isArray(list)) continue;
    for (const [id, v] of Object.entries(list)) {
      const p = byId.get(id);
      // your own preset's votes were refused by the worker; one written by hand is not counted either
      if (!p || id.startsWith(`${user}-`)) continue;
      if (v === 1) p.up++;
      else if (v === -1) p.down++;
    }
  }
  out.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1));
  return { version: 1, presets: out.map(({ created, ...p }) => p) };
}

/** Read the branch checkout at `dir` and write its index.json; answers how many presets it holds. */
export function writeIndex(dir) {
  const presets = {};
  for (const f of jsonFiles(path.join(dir, 'presets'))) presets[f.slice(0, -5)] = readJson(path.join(dir, 'presets', f));
  const votes = {};
  for (const f of jsonFiles(path.join(dir, 'votes'))) votes[f.slice(0, -5)] = readJson(path.join(dir, 'votes', f));
  const index = buildIndex({ presets, votes, hidden: readJson(path.join(dir, 'hidden.json')) });
  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  return index.presets.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node index.mjs <branch checkout>');
    process.exit(2);
  }
  console.log(`index.json: ${writeIndex(dir)} presets`);
}
