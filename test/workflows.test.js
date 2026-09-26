/* The workflows, held to the rules nobody should have to remember.
 *
 * Each of these was a real gap on 2026-09-15, found by reading the repository the way an outside
 * reviewer does: 33 of 33 actions referenced by a movable tag, 4 of 9 workflows with no statement of
 * what their token may do, a release workflow that built any tag whether or not its commit had
 * passed, a list of required checks written in a comment, and a personal token the catalog bot
 * pushed with that expired the same day. None of them needs a person to notice, so none of them is
 * left to one.
 *
 * The files are read as text rather than parsed: the tests and tools of this project use no
 * dependencies, and every rule below is about a line that is either there or not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.github', 'workflows');
const workflows = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
/* A Windows checkout turns every newline into CRLF, and the rules below are written against a bare
   newline. Without this the Windows job failed on files that were fine, which is how the pull request
   adding these tests merged with that job red. */
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('there are workflows to check', () => {
  assert.ok(workflows.length >= 9, `found ${workflows.length} workflow files`);
});

test('every action is pinned to a full commit SHA, with its version beside it', () => {
  /* A tag like v7 can be moved to other code by whoever controls the action, and the next run
     executes it with this repository's secrets. A SHA cannot move. The comment keeps it readable
     and is what Dependabot updates the pin by. */
  const bad = [];
  for (const f of workflows) {
    read(f).split('\n').forEach((line, i) => {
      const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(#\s*(\S+))?/.exec(line);
      if (!m || m[1].startsWith('./') || m[1].startsWith('docker://')) return;
      if (!/@[0-9a-f]{40}$/.test(m[1])) bad.push(`${f}:${i + 1} ${m[1]} is not pinned to a commit`);
      else if (!m[3]) bad.push(`${f}:${i + 1} ${m[1]} has no "# vX" comment naming the version`);
    });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every workflow says what its token may do', () => {
  /* Without a top-level permissions block the token gets whatever the repository default is, and
     the next step somebody adds inherits it. A job that needs more asks for it by itself. */
  const bad = workflows.filter((f) => !/^permissions:/m.test(read(f)));
  assert.deepEqual(bad, [], `no top-level permissions: ${bad.join(', ')}`);
});

test('no workflow lets every job write: a job that needs to write asks for it itself', () => {
  /* OpenSSF Scorecard's first run on 2026-09-15 found two: codeql.yml gave security-events: write
     and fingerprints.yml gave contents: write to the whole workflow. Every job added to either file
     would have inherited it without anybody deciding so. */
  const bad = [];
  for (const f of workflows) {
    const m = /^permissions:([^\n]*)\n((?:[ \t]+[^\n]*\n|[ \t]*#[^\n]*\n)*)/m.exec(read(f));
    if (!m) continue;
    const inline = m[1].trim();
    if (inline && !/^(read-all|\{\s*\})$/.test(inline)) bad.push(`${f}: permissions: ${inline}`);
    for (const line of m[2].split('\n')) {
      if (/^\s+[\w-]+:\s*write\b/.test(line)) bad.push(`${f}: top-level ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every secret a workflow reads is in the registry, and the registry lists nothing unused', () => {
  const registry = json('.github/credentials.json').secrets;
  const used = new Map();
  for (const f of workflows) {
    for (const m of read(f).matchAll(/secrets\.([A-Z0-9_]+)/g)) {
      if (m[1] === 'GITHUB_TOKEN') continue;
      used.set(m[1], [...(used.get(m[1]) || []), f]);
    }
  }
  const unlisted = [...used.keys()].filter((name) => !registry[name]).map((name) => `${name} (${[...new Set(used.get(name))].join(', ')})`);
  const unused = Object.keys(registry).filter((name) => !used.has(name));
  assert.deepEqual(unlisted, [], `read by a workflow but missing from .github/credentials.json: ${unlisted.join(', ')}`);
  assert.deepEqual(unused, [], `listed in .github/credentials.json but no workflow reads it: ${unused.join(', ')}`);
});

test('every secret in the registry reaches the daily check, so none is reported missing while it is set', () => {
  /* VIRUSTOTAL_API_KEY was added to the registry and to tools/check-credentials.mjs, the secret was
     created, and the morning check still called it missing: radar.yml passes each secret into that
     step by hand, and this one had not been added to the list. A secret nobody hands over cannot
     be checked, and the radar says "not set" about a key that is set. */
  const step = read('radar.yml').split('run: node tools/check-credentials.mjs')[0];
  const env = step.slice(step.lastIndexOf('env:'));
  const registry = Object.keys(json('.github/credentials.json').secrets);
  const absent = registry.filter((name) => !env.includes(`${name}: \${{ secrets.${name} }}`));
  assert.deepEqual(absent, [], `listed in .github/credentials.json but not handed to check-credentials.mjs in radar.yml: ${absent.join(', ')}`);
});

test('the registry says what each secret is, when it expires and how to replace it', () => {
  const registry = json('.github/credentials.json').secrets;
  const bad = [];
  for (const [name, s] of Object.entries(registry)) {
    for (const field of ['what', 'kind', 'expires', 'rotate']) {
      if (typeof s[field] !== 'string' || !s[field].trim()) bad.push(`${name}: no ${field}`);
    }
    if (s.expires && !/^(never|unknown|\d{4}-\d{2}-\d{2})$/.test(s.expires)) bad.push(`${name}: expires "${s.expires}" is not a date, never or unknown`);
    /* The one kind that is refused. A personal token expires on a schedule nobody watches and can
       do anything the account can; the catalog bot's ran out on 2026-09-15. */
    if (/personal/i.test(s.kind) || /(^|_)PAT$|PERSONAL/.test(name)) bad.push(`${name}: personal access tokens are not used here, use a deploy key or the workflow token`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('release.yml builds nothing before the gate says the commit passed', () => {
  const text = read('release.yml');
  const build = /\n {2}build:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(text);
  assert.ok(build, 'release.yml has no build job');
  assert.match(build[1], /(?:^|\n) {4}needs:\s*(\[\s*)?gate\b/, 'the build job does not wait for the gate');
  const gate = /\n {2}gate:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(text);
  assert.ok(gate, 'release.yml has no gate job');
  assert.match(gate[1], /node tools\/release-gate\.mjs/, 'the gate job does not run tools/release-gate.mjs');
  assert.match(gate[1], /checks:\s*read/, 'the gate cannot read check runs without checks: read');
});

test('release.yml shows a release to nobody until both builds on it installed a mod', () => {
  /* Until 2026-09-15 the release was public the moment it was created, and the update file, the
     mirror and the Discord post followed before anything had started the build that was going
     out. A draft is invisible to /releases/latest, so no installed copy can update to it. */
  const text = read('release.yml');
  const job = (name) => (new RegExp(`\\n {2}${name}:\\n([\\s\\S]*?)(?=\\n {2}[a-z][\\w-]*:\\n|$)`).exec(text) || [])[1] || '';
  const needs = (body) => {
    const m = /(?:^|\n) {4}needs:\s*(\[[^\]]*\]|[\w-]+)/.exec(body);
    return m ? m[1].replace(/[[\]\s]/g, '').split(',') : [];
  };
  assert.match(job('build'), /gh release create[^\n]*--draft/, 'the build job opens the release in public instead of as a draft');
  // electron-builder publishes a release it has to create itself, unless it is told to make a draft
  assert.equal((text.match(/EP_DRAFT: 'true'/g) || []).length, 2, 'an electron-builder step without EP_DRAFT can publish the release');
  // Every file is fingerprinted and signed for before anything tries it (2026-09-16).
  const checksums = job('checksums');
  assert.ok(checksums, 'release.yml has no checksums job');
  for (const n of ['build', 'linux']) assert.ok(needs(checksums).includes(n), `checksums does not wait for ${n} to put its files on the draft`);
  assert.match(checksums, /id-token: write/, 'checksums cannot sign without id-token: write');
  assert.match(checksums, /attestations: write/, 'checksums cannot store an attestation without attestations: write');
  assert.match(checksums, /actions\/attest-build-provenance@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+subject-checksums: SHA256SUMS/, 'the provenance attestation does not cover every file in SHA256SUMS');
  assert.match(checksums, /gh release upload[^\n]*SHA256SUMS[^\n]*SHA256SUMS\.intoto\.jsonl/, 'SHA256SUMS and its signed bundle do not go on the release');
  for (const [name, after] of [['try-windows', 'build'], ['try-linux', 'linux']]) {
    const body = job(name);
    assert.ok(body, `release.yml has no ${name} job`);
    assert.match(body, /node tools\/e2e\.mjs --app /, `${name} does not click through the build it downloaded`);
    assert.ok(needs(body).includes(after), `${name} does not wait for ${after} to put its build on the draft`);
    assert.ok(needs(body).includes('checksums'), `${name} can try a file before it was fingerprinted`);
    assert.match(body, /not the one SHA256SUMS lists/, `${name} does not check its download against SHA256SUMS`);
  }
  const publish = job('publish');
  assert.ok(publish, 'release.yml has no publish job');
  for (const n of ['checksums', 'try-windows', 'try-linux']) assert.ok(needs(publish).includes(n), `publish does not wait for ${n}`);
  assert.match(publish, /-F draft=false/, 'the publish job does not take the release out of draft');
  for (const n of ['mirror-update', 'notify']) assert.ok(needs(job(n)).includes('publish'), `${n} can run before the release is public`);
  // the API call, not the words: comments and error messages above publish name the endpoint on purpose
  assert.ok(!/repos\/\$REPO\/releases\/latest/.test(text.split(/\n {2}publish:\n/)[0]), 'a job before publish asks /releases/latest, which cannot show a draft');
});

test('a beta tag is published as a prerelease, and never as the latest release', () => {
  /* Everybody on the stable channel follows /releases/latest. A beta that took that endpoint would
     be handed to every installed copy, which is the opposite of a beta. */
  const yml = read('release.yml');
  assert.match(yml, /\*-beta\.\*\) echo 'beta=true'/, 'nothing decides what a beta tag looks like');
  assert.match(yml, /-F prerelease=true -f make_latest=false/, 'a beta is published like a release');
  assert.match(yml, /tools\/release-state\.js missing/, 'the files are not checked against the one list tools/release-state.js keeps');
  assert.match(yml, /is a beta - installed copies follow that endpoint/, 'nothing checks that the stable endpoint was left alone');
});

test('the beta feed goes on the draft, fingerprinted with everything else, for a beta and a release alike', () => {
  /* electron-builder writes latest.yml and latest-linux.yml whatever the version says, and a tester
     reads beta.yml. Until 2026-09-26 the copy was made after publishing: v2.8.0-beta.1 came out
     without it, and on 2.7.1 the job making it was skipped. A published release is immutable and
     cannot gain a file, so the copy is made on the draft, before SHA256SUMS, and uploaded with it. */
  const jobs = read('release.yml').split(/\n {2}(?=[a-z][\w-]*:\n)/);
  const checksums = jobs.find((j) => j.startsWith('checksums:')) || '';
  const at = (s) => checksums.indexOf(s);
  const copy = at('- name: Give the beta channel its feed');
  assert.ok(copy > 0, 'nothing gives the beta channel its feed');
  assert.ok(at('- name: Download every file on the draft') < copy && copy < at('- name: Write SHA256SUMS'),
    'the feed is copied before the files are on the runner, or after they were fingerprinted');
  const step = checksums.slice(copy, at('- name: Write the SBOM'));
  assert.doesNotMatch(step, /if: /, 'only one kind of release gets the beta feed');
  assert.match(step, /cp release\/latest\.yml release\/beta\.yml/);
  assert.match(step, /cp release\/latest-linux\.yml release\/beta-linux\.yml/, 'Linux testers would be offered nothing');
  assert.match(checksums, /gh release upload[^\n]*SHA256SUMS[\s\S]{0,200}release\/beta\.yml release\/beta-linux\.yml/, 'the beta feed is made and never uploaded');
  assert.ok(!jobs.some((j) => j.startsWith('beta-feed:')), 'a job still adds the beta feed after publishing');
});

test('the update mirror is brought to what GitHub serves, a beta included, and a beta is not announced', () => {
  /* A tester whose GitHub is down needs the second route as much as anybody. --current puts the
     whole folder in the state GitHub is in rather than uploading one version, so a run that was
     skipped once is made good by the next one, and checks what it serves by version and size. */
  const jobs = read('release.yml').split(/\n {2}(?=[a-z][\w-]*:\n)/);
  const mirror = jobs.find((j) => j.startsWith('mirror-update:')) || '';
  assert.ok(mirror, 'no mirror-update job');
  assert.equal(/needs\.gate\.outputs\.beta != 'true'/.test(mirror), false, 'a beta has no second route');
  assert.match(mirror, /node tools\/r2-release\.mjs --current/, 'the mirror is given one version rather than the state GitHub is in');
  assert.doesNotMatch(mirror, /continue-on-error/, 'a mirror that failed would look like one that worked');

  const notify = jobs.find((j) => j.startsWith('notify:')) || '';
  assert.match(notify, /needs\.gate\.outputs\.beta != 'true'/, 'a beta would be announced to everybody');
});

test('RELEASING.md names every job release.yml runs', () => {
  /* The runbook gets read on the day a release went wrong, which is the worst day to find it
     describing a workflow that has changed since. */
  const jobs = [...(read('release.yml').split(/\njobs:\n/)[1] || '').matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
  assert.ok(jobs.length >= 8, `found only ${jobs.length} jobs in release.yml`);
  const doc = fs.readFileSync(path.join(ROOT, 'RELEASING.md'), 'utf8');
  const missing = jobs.filter((j) => !doc.includes(`\`${j}\``));
  assert.deepEqual(missing, [], `RELEASING.md does not mention: ${missing.join(', ')}`);
});

test('every required check also runs in the merge queue', () => {
  /* main has a merge queue since 2026-09-23. It tests a pull request again on top of the newest
     main and waits for every required check there; a workflow that does not listen to
     merge_group never reports, and the whole queue stalls behind it. Checked on a probe
     repository before it was switched on: CodeQL, a skipped pull-request-only job and the code
     scanning rule all let a queued change through. */
  const required = json('.github/required-checks.json');
  const prOnly = new Set(required.pullRequestOnly);
  const found = new Map();
  for (const file of workflows) {
    const text = read(file);
    for (const m of text.matchAll(/\n {2}([\w-]+):\n {4}name: ([^\n]+)\n((?: {4}[^\n]*\n)*)/g)) {
      const name = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (required.branch.includes(name)) found.set(name, { file, text, body: m[3] });
    }
    for (const m of text.matchAll(/\n {2}([\w-]+):\n((?: {4}[^\n]*\n)*)/g)) {
      if (required.branch.includes(m[1]) && !/^ {4}name:/m.test(m[2])) found.set(m[1], { file, text, body: m[2] });
    }
  }
  for (const name of required.branch) {
    const job = found.get(name);
    assert.ok(job, `no workflow has a job that reports "${name}"`);
    assert.match(job.text, /\n {2}merge_group:/, `${job.file} reports "${name}" but does not run in the merge queue`);
    if (prOnly.has(name)) {
      assert.match(job.body, /if: github\.event_name == 'pull_request'/,
        `"${name}" reads the pull request, so it has to skip itself in the merge queue`);
    }
  }
});

test('a dependency update queues itself to merge only when it is minor or patch, and only through the checks', () => {
  /* Majors changed the runtime and the site generator under the project twice in a month
     (Electron 43 to 44, Astro 5 to 7), and the Astro one built green while the site came out
     broken. A merge that is not limited to minor and patch, or that skips the required checks,
     would put the next one straight into main. */
  const text = read('dependency-updates.yml');
  assert.match(text, /user\.login == 'dependabot\[bot\]'/, 'the policy does not check that Dependabot opened the pull request');
  assert.match(text, /github\.actor == 'dependabot\[bot\]'/, 'a person pushing to a Dependabot branch could set off the merge');
  const step = /\n {6}- name:[^\n]*\n((?: {8}[^\n]*\n)*? {8}run: gh pr merge[^\n]*)/.exec(text);
  assert.ok(step, 'no step merges the update');
  assert.match(step[1], /--auto\b/, 'the merge does not wait for the required checks');
  assert.ok(!/--admin/.test(step[1]), 'the merge goes around the required checks');
  const cond = /if: ([^\n]*)/.exec(step[1]);
  assert.ok(cond, 'the merge step runs for every update');
  assert.ok(/semver-minor/.test(cond[1]) && /semver-patch/.test(cond[1]) && !/semver-major|!=/.test(cond[1]),
    `the merge step is not limited to minor and patch updates: ${cond[1]}`);
});

test('every required check is a job that exists, under the name GitHub will show', () => {
  /* The ruleset waits for a check by name. Rename the job, or turn it into a matrix, and a merge
     waits for ever for a check that no longer exists; the comment in test.yml was the only thing
     that remembered this. */
  const names = new Set();
  for (const f of workflows) {
    const text = read(f);
    const jobs = text.split(/\njobs:\n/)[1] || '';
    for (const m of jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)) names.add(m[1]);
    for (const m of jobs.matchAll(/^ {4}name:\s*['"]?(.+?)['"]?\s*$/gm)) names.add(m[1]);
  }
  const checks = json('.github/required-checks.json');
  const missing = [...new Set([...checks.branch, ...checks.release])].filter((n) => !names.has(n));
  assert.deepEqual(missing, [], `required but no job is called that: ${missing.join(', ')}`);
});

test('CI runs the same gate as a person and the commit hook', () => {
  const pkg = json('package.json');
  assert.ok(pkg.scripts.verify, 'package.json has no verify script');
  assert.match(pkg.scripts.verify, /lint/, 'npm run verify does not lint');
  assert.match(pkg.scripts.verify, /test:coverage/, 'npm run verify does not run the suite with its coverage floor');
  assert.match(read('test.yml'), /npm run verify/, 'test.yml runs its own list of steps instead of npm run verify');
});

test('a job with no checkout tells gh which repository it means', () => {
  /* gh finds the repository in the .git of the working directory, and a job that never checked
     the code out has none: "fatal: not a git repository". That failed the publish job of 2.7.1
     and of 2.8.0-beta.1 on its last step, after the release was public, and everything after it
     was skipped. gh pr takes the pull request's own address, which carries the repository. */
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((n) => /\.ya?ml$/.test(n))) {
    const body = read(f).replace(/\r\n/g, '\n').split(/\njobs:\n/)[1] || '';
    for (const job of body.split(/\n(?= {2}[\w-]+:\n)/)) {
      if (/uses: actions\/checkout@/.test(job)) continue;
      const name = (/^\s*([\w-]+):/.exec(job) || [])[1];
      for (const line of job.split('\n')) {
        if (/^\s*#/.test(line) || !/\bgh (workflow|release|run|issue|label|secret|variable|cache)\b/.test(line)) continue;
        if (!/--repo\b|\s-R\s/.test(line)) bad.push(`${f} ${name}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('the release asks for the antivirus check by name, because the event never comes', () => {
  /* virustotal.yml listens for `release: published`, and that event is never raised: the release
     is published by a workflow using GITHUB_TOKEN, and GitHub refuses to start workflows from
     events its own token created. On its first chance, 2.7.0, it did not run, and the changelog
     of that release said every release is scanned. */
  const jobs = read('release.yml').split(/\n {2}(?=[a-z][\w-]*:\n)/);
  const job = jobs.find((j) => j.startsWith('antivirus:')) || '';
  assert.match(job, /gh workflow run virustotal\.yml --repo "\$REPO" -f tag="\$TAG"/,
    'nothing starts the antivirus check, or it starts it without saying which repository');
  assert.match(job, /needs: \[gate, publish\]/, 'the check is asked for before there is a release to check');
  assert.match(job, /permissions:\s*\n\s*actions: write/, 'starting another workflow needs actions: write');
  // not a step of publish: a failed request there skipped mirror-update and notify on 2.7.1
  const publish = jobs.find((j) => j.startsWith('publish:')) || '';
  assert.doesNotMatch(publish, /gh workflow run/, 'a failed request would fail publish and skip the mirror');
  assert.match(read('virustotal.yml'), /workflow_dispatch:[\s\S]{0,200}tag:/,
    'virustotal.yml no longer takes the tag it is asked about');
});

/** The jobs of release.yml by name, and the jobs each one waits for. */
function releaseJobs() {
  const text = read('release.yml');
  const body = text.split(/\njobs:\n/)[1] || '';
  const jobs = new Map();
  for (const part of body.split(/\n(?= {2}[a-z][\w-]*:\n)/)) {
    const name = (/^ {2}([a-z][\w-]*):\n/.exec(`\n${part}`.slice(1)) || /^\s*([a-z][\w-]*):/.exec(part) || [])[1];
    if (!name) continue;
    const m = /(?:^|\n) {4}needs:\s*(\[[^\]]*\]|[\w-]+)/.exec(part);
    jobs.set(name, { text: part, needs: m ? m[1].replace(/[[\]\s]/g, '').split(',') : [] });
  }
  // every job that runs once the release is public: publish's own later steps are dealt with apart
  const after = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, j] of jobs) {
      if (after.has(name) || name === 'publish') continue;
      if (j.needs.some((n) => n === 'publish' || after.has(n))) { after.add(name); grew = true; }
    }
  }
  return { jobs, after };
}

test('nothing after publishing adds, replaces or removes a file of the release', () => {
  /* Releases are immutable: once one is out its files and its tag are fixed, and an upload after
     publishing fails. Two did exactly that until 2026-09-26 (the beta feed, twice). Every file goes
     on the draft, and the draft is checked for every file before it is published. */
  const { jobs, after } = releaseJobs();
  const publish = jobs.get('publish').text;
  const out = publish.indexOf('- name: Publish the draft');
  assert.ok(out > 0, 'publish has no step that publishes');
  const check = publish.indexOf('- name: Check the draft carries every file');
  assert.ok(check > 0 && check < out, 'the draft is published without being checked for every file first');
  assert.match(publish.slice(check, out), /node tools\/release-state\.js missing/);
  const bad = [];
  const writes = /gh release (upload|delete-asset|delete)\b|--clobber|releases\/assets\/[^\n]*(DELETE|PATCH)|uploads\.github\.com/;
  for (const line of publish.slice(out).split('\n')) if (writes.test(line)) bad.push(`publish: ${line.trim()}`);
  for (const name of after) {
    for (const line of jobs.get(name).text.split('\n')) if (writes.test(line)) bad.push(`${name}: ${line.trim()}`);
  }
  const watch = fs.readFileSync(path.join(ROOT, 'tools', 'release-watch.mjs'), 'utf8');
  if (/uploads\.github\.com|releases\/assets/.test(watch)) bad.push('tools/release-watch.mjs touches release files');
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('a job after publishing runs whatever another one did', () => {
  /* On 2.7.1 one failed step after publishing skipped every job after it: the mirror and the
     Discord post never happened. A job may wait for another to finish, never for it to succeed. */
  const { jobs, after } = releaseJobs();
  const bad = [];
  for (const name of after) {
    const j = jobs.get(name);
    const waits = j.needs.filter((n) => after.has(n));
    if (!waits.length) continue;
    const cond = (/\n {4}if: ([^\n]*)/.exec(j.text) || [])[1] || '';
    if (!/always\(\)/.test(cond) || !/needs\.publish\.result == 'success'/.test(cond)) {
      bad.push(`${name} waits for ${waits.join(', ')} and is skipped when that fails: its if needs always() and needs.publish.result == 'success'`);
    }
  }
  assert.ok(after.has('notify') && after.has('mirror-update') && after.has('antivirus'), 'the jobs after publishing are not where this test looks');
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('a post to Discord fails on a refusal, and asks again before it does', () => {
  /* curl without --fail exits 0 on any answer, so a deleted webhook answering 404 would have left
     the job green and the release unannounced, with nothing to say so. */
  const bad = [];
  for (const f of workflows) {
    read(f).split('\n').forEach((line, i) => {
      if (!/\bcurl\b/.test(line) || !/WEBHOOK/.test(line + (read(f).split('\n')[i + 1] || ''))) return;
      const call = `${line} ${read(f).split('\n')[i + 1] || ''}`;
      if (!/--fail/.test(call) || !/--retry\b/.test(call)) bad.push(`${f}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('the gate checks what publishing will need, before anything is built', () => {
  /* Every secret a job after publishing reads is handed to the preflight in the gate, so a missing
     or refused one stops the release while it is still a tag. */
  const { jobs, after } = releaseJobs();
  const gate = jobs.get('gate').text;
  const step = gate.slice(gate.indexOf('- name: Check that everything after publishing will work'));
  assert.match(step, /run: node tools\/release-preflight\.mjs/, 'the gate does not run the preflight');
  assert.match(gate, /actions: read/, 'the preflight cannot see whether the workflows it relies on are switched on');
  const needed = new Set();
  for (const name of after) for (const m of jobs.get(name).text.matchAll(/secrets\.([A-Z0-9_]+)/g)) needed.add(m[1]);
  const missing = [...needed].filter((n) => !step.includes(`secrets.${n}`));
  assert.deepEqual(missing, [], `read after publishing but not checked before building: ${missing.join(', ')}`);
});

test('what a release left undone is put right without anybody starting it', () => {
  /* 2.7.1 left the mirror on 2.7.0 for days: the run was red and nobody re-ran the job. */
  const text = read('release-watch.yml');
  assert.match(text, /workflow_run:\n\s+workflows: \[Release\]\n\s+types: \[completed\]/, 'the watch does not run when a release run ends');
  assert.match(text, /schedule:\n\s+- cron:/, 'the watch does not run on its own either');
  assert.match(text, /concurrency:\n\s+group: release-watch\n\s+cancel-in-progress: false/, 'two watches could repair the mirror at once');
  assert.match(text, /node tools\/release-watch\.mjs --repair/, 'the watch looks and repairs nothing');
  const watch = fs.readFileSync(path.join(ROOT, 'tools', 'release-watch.mjs'), 'utf8');
  assert.match(watch, /'--current'/, 'the watch does not bring the mirror up to date');
  assert.match(watch, /postToDiscord\(stable\)/, 'the watch does not send a post the release run did not');
  assert.match(watch, /virustotal\.yml\/dispatches/, 'the watch does not ask for an antivirus check nothing ran');
  assert.match(read('virustotal.yml'), /run-name: VirusTotal \$\{\{ inputs\.tag/, 'the watch cannot tell which release an antivirus run was for');
});

/**
 * Lines GitHub's YAML parser would refuse, found without a YAML library. A `run: |` block holds
 * every line indented deeper than its first one; a line less indented ends it, and has to be a key,
 * a list item or a comment of the level it falls back to. Text that is none of those makes the whole
 * file unreadable, and the workflow does not start at all.
 * @returns {string[]} "line: text" for each line that breaks the file
 */
function yamlShapeProblems(text) {
  const bad = [];
  let block = null; // { parent, content } while inside a block scalar
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    if (block) {
      if (block.content === null) block.content = indent > block.parent ? indent : -1;
      if (block.content >= 0 && indent >= block.content) return;
      block = null;
    }
    const body = line.trimStart();
    if (/\t/.test(line.slice(0, indent))) bad.push(`${i + 1}: a tab in the indentation`);
    const shaped = body.startsWith('#') || body === '-' || body.startsWith('- ')
      || /^[^\s#'"{[\]][^:]*:(\s|$)/.test(body) || /^(['"]).*\1:(\s|$)/.test(body);
    if (!shaped) bad.push(`${i + 1}: ${body.slice(0, 70)}`);
    if (/^(?:- )?[^#\s][^:]*:\s*[|>][-+0-9]*\s*(#.*)?$/.test(body) || /^- [|>][-+0-9]*\s*$/.test(body)) {
      block = { parent: indent + (body.startsWith('- ') ? 2 : 0), content: null };
    }
  });
  return bad;
}

test('actionlint reads every workflow in the required job, from a download checked against its hash', () => {
  /* The shape check below is this suite's own and knows one kind of break. actionlint parses the
     files as GitHub does, checks expressions and needs, and runs shellcheck on each run block. It
     sits in the `test` job, which every pull request and the merge queue have to pass. */
  const job = read('test.yml').split(/\n {2}windows:\n/)[0];
  assert.match(job, /- name: Check the workflows with actionlint/, 'nothing runs actionlint');
  assert.match(job, /ACTIONLINT_SHA256: [0-9a-f]{64}\n/, 'the binary is not pinned by its hash');
  assert.match(job, /sha256sum -c -/, 'the download runs without being checked against the hash');
  assert.match(job, /\.\/actionlint\b/, 'the binary is downloaded and never run');
  assert.doesNotMatch(job, /-shellcheck=(\s|$)/, 'the run blocks are not handed to shellcheck');
  assert.match(read('test.yml'), /\n {2}merge_group:/, 'the merge queue would not run it');
});

test('every workflow is YAML GitHub can read', () => {
  /* On 2026-09-26 an edit put a printf with real line breaks into release.yml: two lines at column
     zero in the middle of a run block. Every test above reads the file as text and passed; OpenSSF
     Scorecard could not parse it, and the next tag would have started no release at all, because
     GitHub refuses a workflow file it cannot read before running a single job. */
  const bad = [];
  for (const f of workflows) for (const p of yamlShapeProblems(read(f))) bad.push(`${f}:${p}`);
  assert.deepEqual(bad, [], bad.join('\n'));
  // and the check knows the break when it sees it: the step as it was merged
  const merged = [
    'jobs:',
    '  notify:',
    '    steps:',
    '      - name: Note in the release that it was announced',
    '        run: |',
    "          if ! grep -qF 'x' body.md; then",
    "            printf '",
    '',
    '<!-- announced in Discord -->',
    "' >> body.md",
    '          fi',
  ].join('\n');
  assert.deepEqual(yamlShapeProblems(merged), ['9: <!-- announced in Discord -->', "10: ' >> body.md", '11: fi']);
});

test('no commit on main has its analysis cancelled by the next one', () => {
  /* One group per ref with cancel-in-progress cancelled the analysis of #134 and #145 when the next
     merge landed: a red cross on main that meant nothing, and a commit Scorecard's SAST check
     counts as never analysed. A pull request may still replace its own older run. */
  const text = read('codeql.yml');
  const block = (/\nconcurrency:\n((?: {2}[^\n]*\n)+)/.exec(text) || [])[1] || '';
  assert.match(block, /group: [^\n]*github\.sha/, 'commits on main share a group, so one waits on or cancels another');
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/, 'a push to main can cancel an analysis still running');
});

test('the old address is published only when docs/ changes, and never cancelled by the next push', () => {
  /* GitHub's own branch build ran on every push to main and cancelled itself when merges landed
     close together: #155 carries a red cross for a signpost that had not changed. */
  const text = read('pages.yml');
  assert.match(text, /push:\n\s+branches: \[main\]\n\s+paths:\n\s+- 'docs\/\*\*'/, 'the signpost is rebuilt on pushes that do not touch it');
  assert.match(text, /concurrency:\n\s+group: pages\n\s+cancel-in-progress: false/, 'a publish can cancel the one before it');
  assert.match(text, /actions\/upload-pages-artifact@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+path: docs\n/, 'something other than docs/ would be published');
});

