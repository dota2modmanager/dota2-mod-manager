/* What a published release has to carry and what the update mirror has to hold (tools/release-state.js),
 * the lists release.yml checks the draft against and tools/release-watch.mjs repairs the mirror by. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const state = require('../tools/release-state.js');
const { currentPlan } = require('../tools/mirror-plan.js');

const rel = (tag, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: /-/.test(tag), published_at: '2026-09-27T10:00:00Z', body: '',
  assets: state.BINARIES.map((name, i) => ({ name, size: 100 + i + (/-/.test(tag) ? 50 : 0) })), ...extra,
});

test('every release carries the beta feed and the proof, a beta included', () => {
  for (const name of ['latest.yml', 'latest-linux.yml', 'portable.yml', 'beta.yml', 'beta-linux.yml', 'SHA256SUMS', 'SHA256SUMS.intoto.jsonl']) {
    assert.ok(state.REQUIRED_ASSETS.includes(name), name);
  }
  // 2.7.1 as it went out: the beta feed was to be added after publishing, and never was
  const shipped = ['Dota-2-Mod-Manager-Portable.exe', 'Dota-2-Mod-Manager-Setup.exe', 'Dota-2-Mod-Manager-Setup.exe.blockmap',
    'Dota-2-Mod-Manager.AppImage', 'dota2-mod-manager.cdx.json', 'latest-linux.yml', 'latest.yml', 'portable.yml', 'SHA256SUMS', 'SHA256SUMS.intoto.jsonl'];
  assert.deepEqual(state.missingAssets(shipped), ['beta.yml', 'beta-linux.yml']);
  assert.deepEqual(state.missingAssets([...shipped, 'beta.yml', 'beta-linux.yml']), []);
});

test('versions sort the way semantic versioning says, a beta before its release', () => {
  const sorted = ['2.8.0', '2.7.1', '2.8.0-beta.10', '2.8.0-beta.2', '2.10.0', '2.8.0-beta.1'].sort(state.compareVersions);
  assert.deepEqual(sorted, ['2.7.1', '2.8.0-beta.1', '2.8.0-beta.2', '2.8.0-beta.10', '2.8.0', '2.10.0']);
  assert.equal(state.compareVersions('v2.7.1', '2.7.1'), 0);
  assert.equal(state.parseVersion('not a version'), null);
});

test('the heads: the newest release, and a beta only when it is newer than that release', () => {
  const heads = state.channelHeads([rel('v2.7.1'), rel('v2.8.0-beta.1'), rel('v2.8.0-beta.2', { draft: true }), rel('v2.7.0')]);
  assert.equal(heads.stable.tag_name, 'v2.7.1');
  assert.equal(heads.beta.tag_name, 'v2.8.0-beta.1', 'a draft is nobody\'s');
  const after = state.channelHeads([rel('v2.8.0'), rel('v2.8.0-beta.1'), rel('v2.7.1')]);
  assert.equal(after.stable.tag_name, 'v2.8.0');
  assert.equal(after.beta, null, 'the release that replaced the beta is what a tester reads');
  assert.deepEqual(state.channelHeads([]), { stable: null, beta: null });
});

test('the mirror holds the release, and the beta beside it under -beta names', () => {
  const want = state.mirrorExpectation(state.channelHeads([rel('v2.7.1'), rel('v2.8.0-beta.1')]));
  const by = Object.fromEntries(want.map((w) => [w.name, w]));
  assert.equal(by['latest.yml'].version, '2.7.1');
  assert.equal(by['portable.yml'].version, '2.7.1');
  assert.equal(by['beta.yml'].version, '2.8.0-beta.1');
  assert.equal(by['beta-linux.yml'].version, '2.8.0-beta.1');
  assert.equal(by['Dota-2-Mod-Manager-Setup.exe'].size, 100);
  assert.equal(by['Dota-2-Mod-Manager-Setup-beta.exe'].size, 150);
  assert.equal(by['Dota-2-Mod-Manager-beta.AppImage'].size, 152);

  const plain = state.mirrorExpectation(state.channelHeads([rel('v2.8.0')])).map((w) => w.name);
  assert.equal(plain.some((n) => n.includes('-beta')), false, 'no beta, no -beta files');
  assert.equal(state.mirrorExpectation({ stable: null, beta: null }).length, 0);
});

test('drift is read by version and by size, which an answer of 200 never told apart', () => {
  // the mirror on 2026-09-26: 2.7.0 everywhere while 2.7.1 and a beta were out
  const want = state.mirrorExpectation(state.channelHeads([rel('v2.7.1'), rel('v2.8.0-beta.1')]));
  const seen = new Map(want.map((w) => [w.name, w.version ? { status: 200, version: '2.7.0' } : { status: 200, size: 1 }]));
  seen.set('Dota-2-Mod-Manager-Setup-beta.exe', { status: 404 });
  const drift = state.mirrorDrift(want, seen);
  assert.ok(drift.includes('latest.yml announces 2.7.0, and 2.7.1 is out'));
  assert.ok(drift.includes('beta.yml announces 2.7.0, and 2.8.0-beta.1 is out'));
  assert.ok(drift.includes('Dota-2-Mod-Manager-Setup-beta.exe is not on the mirror (HTTP 404)'));
  assert.ok(drift.some((d) => /Dota-2-Mod-Manager-Setup\.exe is 1 bytes/.test(d)));

  const right = new Map(want.map((w) => [w.name, { status: 200, version: w.version || null, size: w.size || null }]));
  assert.deepEqual(state.mirrorDrift(want, right), []);
  assert.equal(state.feedVersion('version: 2.8.0-beta.1\nfiles:\n'), '2.8.0-beta.1');
  assert.equal(state.feedVersion("version: '2.7.1'"), '2.7.1');
  assert.equal(state.feedVersion('nothing'), null);
});

test('one plan puts the whole folder right: the release, and a newer beta over the beta feed', () => {
  const plan = currentPlan('2.7.1', '2.8.0-beta.1');
  const by = new Map(plan.uploads.map((u) => [u.name, u]));
  assert.equal(by.get('latest.yml').version, '2.7.1');
  assert.equal(by.get('beta.yml').version, '2.8.0-beta.1', 'the beta feed is the beta\'s, not the release\'s copy');
  assert.equal(by.get('beta.yml').retarget, true, 'and asks for the -beta binaries');
  assert.equal(by.get('Dota-2-Mod-Manager-Setup-beta.exe').asset, 'Dota-2-Mod-Manager-Setup.exe');
  assert.equal(plan.uploads.filter((u) => u.name === 'beta.yml').length, 1);
  assert.ok(plan.keep.has('updates/Dota-2-Mod-Manager-Setup.exe') && plan.keep.has('updates/Dota-2-Mod-Manager-Setup-beta.exe'),
    'neither the release nor the beta is cleared out by the other');

  const alone = currentPlan('2.8.0', null);
  assert.equal(alone.uploads.find((u) => u.name === 'beta.yml').asset, 'latest.yml', 'with no beta out, testers read the release');
  assert.equal([...alone.keep].some((k) => k.includes('-beta')), false, 'and the old beta\'s binaries go');
});

test('the Discord post is cut by characters, and never loses its link', () => {
  const long = 'Ж'.repeat(5000);
  const post = state.discordPayload({ name: '2.8.0', url: 'https://example.com/r', notes: long });
  const text = post.embeds[0].description;
  assert.ok(text.length < 4096, 'under the limit Discord sets');
  assert.ok(!text.includes('�'), 'no letter cut in half');
  assert.ok(text.endsWith('[**Open Release Page**](https://example.com/r)'));
  assert.equal(post.embeds[0].title, '2.8.0');
  assert.match(state.discordPayload({ name: 'x', url: 'u', notes: '' }).embeds[0].description, /^A new release has been published!/);
  assert.equal(state.discordPayload({ name: 'x', url: 'u', notes: `Notes.\n${state.ANNOUNCED}` }).embeds[0].description.includes('announced'), false,
    'the hidden line stays out of the post');
  assert.equal(state.discordPayload({ name: 'x', url: 'u', notes: `Notes.\n\n${state.SIGNING_POLICY}\n` }).embeds[0].description,
    'Notes.\n\n[**Open Release Page**](u)', 'the policy line belongs to the release page, not the post');
});

test('every release page ends with the code signing policy, on both roads the notes take', () => {
  // the draft gets it when it opens, and notify when it finds the page empty; the post drops it
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const lines = workflow.split('\n').filter((l) => l.includes(`echo '${state.SIGNING_POLICY}'; } >> notes.md`));
  assert.equal(lines.length, 2, 'release.yml appends the policy line in both notes steps');
});

test('the changelog section is the one release.yml puts on the page', () => {
  const log = '# Changelog\n\n## 2.8.0-beta.1\n\nBeta notes.\n\n## 2.8.0\n\nThe release.\n\n## 2.7.1\n\nOlder.\n';
  assert.equal(state.changelogSection(log, '2.8.0'), 'The release.');
  assert.equal(state.changelogSection(log, '2.8.0-beta.1'), 'Beta notes.');
  assert.equal(state.changelogSection(log, '2.8.1'), '');
  assert.equal(state.changelogSection('## 2.8.0\r\n\r\nWindows lines.\r\n', '2.8.0'), 'Windows lines.');
});

test('what the watch holds a release to: published after it began, announced once, scanned', async () => {
  assert.equal(state.watched(rel('v2.8.0')), true);
  assert.equal(state.watched(rel('v2.7.1', { published_at: '2026-09-24T12:58:26Z' })), false, '2.7.1 went out unannounced on purpose');
  assert.equal(state.announced({ body: `x\n\n${state.ANNOUNCED}\n` }), true);
  assert.equal(state.announced({ body: 'x' }), false);
  // the notes as tools/virustotal.mjs writes them, so the two cannot drift apart unnoticed
  const { withReport, reportSection } = await import('../tools/virustotal.mjs');
  const body = withReport('Notes.', reportSection([{ name: 'a.exe', url: 'u', flagged: 0, engines: 72 }]));
  assert.equal(state.scanned({ body }), true);
  assert.equal(state.scanned({ body: 'Notes.' }), false);
  assert.equal(state.scanned({ body: null }), false);
});
