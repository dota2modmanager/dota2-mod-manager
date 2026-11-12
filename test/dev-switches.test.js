// The table of screenshot switches in CONTRIBUTING.md (#230), checked rather than trusted: a
// switch src/dev-harness.ts reads and the table does not list is one a contributor has to find
// by reading the source, and one the table lists that nothing reads sends them on a search.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

/** The switches the harness reads, in the order it first reads them. */
function harnessReads() {
  return [...new Set([...read('src/dev-harness.ts').matchAll(/env\.(MM_[A-Z_]+)/g)].map((m) => m[1]))];
}

/** The switches the table lists, in its order. */
function tableLists() {
  const text = read('CONTRIBUTING.md');
  const at = text.indexOf('<!-- dev-switches:');
  assert.ok(at !== -1, 'CONTRIBUTING.md has the table, after its dev-switches marker');
  const rows = text.slice(at).split('\n').slice(1);
  const table = rows.slice(0, rows.findIndex((l) => !l.startsWith('|')));
  return table.map((l) => /^\| `(MM_[A-Z_]+)` \|/.exec(l)?.[1]).filter(Boolean);
}

test('every switch the harness reads is in the table, and the table lists nothing else', () => {
  const reads = harnessReads();
  const lists = tableLists();
  assert.ok(reads.length > 10, 'the harness was read');
  assert.deepEqual(reads.filter((s) => !lists.includes(s)), [], 'read by src/dev-harness.ts, missing from CONTRIBUTING.md');
  assert.deepEqual(lists.filter((s) => !reads.includes(s)), [], 'in CONTRIBUTING.md, read by nothing in src/dev-harness.ts');
  assert.equal(new Set(lists).size, lists.length, 'a switch is listed once');
});
