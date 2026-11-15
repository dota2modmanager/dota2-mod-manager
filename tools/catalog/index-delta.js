#!/usr/bin/env node
// What the scheduled catalog run should call its commit.
//
// That workflow runs every half hour and pushes when the upstream catalog moved, which is
// around a hundred and twenty commits so far, every one of them titled "Update mod
// fingerprints and hero pages". A quarter of this repository's history says nothing about
// itself. Line-broken files (tools/catalog/json-lines.js) fixed the diff; this fixes the subject.
//
// It compares two versions of fingerprints.json and counts mods, not fingerprints: two
// catalog entries that ship the same file share one fingerprint, so counting keys would
// under-report the day a mod is re-uploaded under a second name.
//
// Usage:  node tools/catalog/index-delta.js <before.json> <after.json>
// Prints one line. Nothing here fails the build: an unreadable file gives the neutral
// message, because a bot that cannot describe its commit should still make it.
const fs = require('fs');

/** Every catalog identity the map knows, as "category|name|style". */
function identities(index) {
  const out = new Set();
  const add = (m) => out.add(`${m.categoryId}|${m.name}|${m.styleLabel ?? ''}`);
  for (const list of Object.values(index?.mods ?? {})) for (const m of list ?? []) add(m);
  for (const f of index?.fonts ?? []) add(f);
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object|null} before  the committed index, or null when there was not one
 * @param {object|null} after   the index the run just wrote
 * @returns {string} the commit subject, without the [skip ci] marker
 */
function deltaMessage(before, after) {
  // No previous version to compare against - the file was unreadable, or `git show` had
  // nothing to show. Every mod would look new, and a subject claiming 1,300 arrivals on a
  // run that added two is the failure this whole file exists to avoid.
  if (!before || !after) return 'Refresh the catalog index';

  const was = identities(before);
  const now = identities(after);
  const added = [...now].filter((k) => !was.has(k)).length;
  const gone = [...was].filter((k) => !now.has(k)).length;

  if (added && gone) return `Index ${plural(added, 'new mod', 'new mods')}, drop ${gone} that left the catalog`;
  if (added) return `Index ${plural(added, 'new mod', 'new mods')} from the catalog`;
  if (gone) return `Drop ${plural(gone, 'mod', 'mods')} the catalog no longer has`;
  // Same mods, changed contents: somebody re-uploaded an archive, or only the hero pages and
  // previews moved. Both are real, neither is countable in mods.
  return 'Refresh the catalog index';
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
};

if (require.main === module) {
  const [before, after] = process.argv.slice(2);
  process.stdout.write(`${deltaMessage(readJson(before), readJson(after))}\n`);
}

module.exports = { deltaMessage, identities };
