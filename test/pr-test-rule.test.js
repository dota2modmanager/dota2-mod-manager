/* The pull request rule: a fix brings its test, or says why it cannot.
 *
 * The cases come from this repository's own history, where 19 of 41 fix commits between 2026-08-15
 * and 2026-09-15 touched no test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../tools/pr-test-rule.mjs');

test('a fix that changes no test is refused, with what to do about it', async () => {
  const { judge } = await load();
  const r = judge({
    title: 'Fix the install handler after the IPC split',
    commits: [{ message: 'Fix the install handler after the IPC split' }],
    files: ['src/ipc-mods.js'],
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /nothing under test\/ changed/);
  assert.match(r.reason, /No-Test-Because:/);
});

test('the same fix with its test passes', async () => {
  const { judge } = await load();
  const r = judge({
    title: 'Fix the install handler after the IPC split',
    commits: [{ message: 'Fix the install handler after the IPC split' }],
    files: ['src/ipc-mods.js', 'test/ipc-contract.test.js'],
  });
  assert.equal(r.ok, true);
});

test('a fix with nothing to test says why, in a commit or in the description', async () => {
  const { judge } = await load();
  const inCommit = judge({ title: 'Fix a typo in the Russian changelog', commits: [{ message: 'Fix a typo in the Russian changelog\n\nNo-Test-Because: a spelling change in prose' }], files: ['CHANGELOG.ru.md'] });
  assert.equal(inCommit.ok, true);
  assert.match(inCommit.reason, /a spelling change in prose/);

  const inBody = judge({ title: 'Fix a typo', body: 'No-Test-Because: text only', commits: [{ message: 'Fix a typo' }], files: ['README.md'] });
  assert.equal(inBody.ok, true);

  const empty = judge({ title: 'Fix a typo', body: 'No-Test-Because:   ', commits: [{ message: 'Fix a typo' }], files: ['README.md'] });
  assert.equal(empty.ok, false, 'a trailer with no reason is not a reason');
});

test('a label marks a fix even when the words do not', async () => {
  const { judge } = await load();
  const r = judge({ title: 'Put the signature list back together from the live file', labels: ['regression'], commits: [{ message: 'Put the signature list back together' }], files: ['src/patcher.ts'] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /labelled regression/);
});

test('a change that is not a fix is not asked for a test by this rule', async () => {
  const { judge } = await load();
  const r = judge({ title: 'List where the project is mentioned', commits: [{ message: 'List where the project is mentioned' }], files: ['MENTIONS.md'] });
  assert.equal(r.ok, true);
});

test('a word inside another word is not a fix, and Dependabot is left alone', async () => {
  const { judge } = await load();
  assert.equal(judge({ title: 'Prefix every log line with the time', commits: [{ message: 'Prefix every log line with the time' }], files: ['src/log.js'] }).ok, true);
  assert.equal(judge({ title: 'deps: bump electron from 43.4.0 to 44.3.0', author: 'dependabot[bot]', commits: [{ message: 'fix: bump' }], files: ['package.json'] }).ok, true);
});
