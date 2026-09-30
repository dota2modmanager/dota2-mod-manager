/* The answers this project proposes for its OpenSSF Best Practices badge.
 *
 * `.bestpractices.json` is read by bestpractices.dev out of this repository and offered in the
 * form for the maintainer to accept, so it is a public claim about how this project is run. A
 * claim that names a file which no longer exists, or a number nothing measures any more, is worse
 * than an unanswered question. These hold it to the repository as it is.
 *
 * docs/openssf-answers.md is the same answers in prose, for reading; the two must name the same
 * criteria or one of them is out of date.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const answers = JSON.parse(fs.readFileSync(path.join(ROOT, '.bestpractices.json'), 'utf8'));
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'openssf-answers.md'), 'utf8');

const criteria = [...new Set(Object.keys(answers).map((k) => k.replace(/_(status|justification)$/, '')))];
const statusOf = (id) => answers[`${id}_status`];
const why = (id) => answers[`${id}_justification`] || '';

test('every criterion carries both a status and the reason for it', () => {
  assert.equal(criteria.length, 115, 'passing has 67 criteria and silver 55, seven of them the '
    + 'same ones: 115 answers. One was added or dropped here');
  const wrong = [];
  for (const id of criteria) {
    if (!['Met', 'Unmet', 'N/A'].includes(statusOf(id))) wrong.push(`${id}: status "${statusOf(id)}"`);
    if (why(id).trim().length < 12) wrong.push(`${id}: no reason worth reading`);
  }
  assert.deepEqual(wrong, []);
});

test('nothing is claimed under a name the badge does not use', () => {
  /* The site keys every field as <criterion>_status and <criterion>_justification. A typo in an id
     is silently ignored there, which would leave a question unanswered while this file looks full. */
  const stray = Object.keys(answers).filter((k) => !/_(status|justification)$/.test(k));
  assert.deepEqual(stray, [], `not a badge field: ${stray.join(', ')}`);
  const odd = criteria.filter((id) => !/^[a-z][a-z0-9_]*$/.test(id));
  assert.deepEqual(odd, [], `not a criterion id: ${odd.join(', ')}`);
});

test('every file a reason names is in the repository', () => {
  /* The justifications point at CONTRIBUTING.md, the workflows, the credential registry and the
     rest. A reason that links a file somebody deleted is a claim about a guard that is gone. */
  const missing = [];
  for (const id of criteria) {
    for (const m of why(id).matchAll(/blob\/main\/([^\s)]+)/g)) {
      const file = m[1].replace(/[.,]$/, '');
      if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${id}: ${file}`);
    }
    for (const m of why(id).matchAll(/tree\/main\/([^\s)]+)/g)) {
      const dir = m[1].replace(/[.,]$/, '');
      if (!fs.existsSync(path.join(ROOT, dir))) missing.push(`${id}: ${dir}`);
    }
  }
  assert.deepEqual(missing, []);
});

/* Criteria marked met_url_required in the badge's own criteria.yml: answered Met without a link
   they do not count, and the entry sits one percent short with nothing saying which one. That is
   how vulnerability_report_private held the badge back on 2026-09-19. */
const NEEDS_URL = [
  // passing
  'contribution', 'contribution_requirements', 'license_location', 'release_notes',
  'report_process', 'report_archive', 'vulnerability_report_process', 'vulnerability_report_private',
  // silver
  'dco', 'governance', 'code_of_conduct', 'roles_responsibilities', 'access_continuity',
  'bus_factor', 'documentation_roadmap', 'documentation_architecture', 'documentation_security',
  'documentation_quick_start', 'documentation_achievements', 'vulnerability_report_credit',
  'vulnerability_response_process', 'coding_standards', 'external_dependencies', 'assurance_case',
];

test('every criterion that has to carry a link carries one', () => {
  // the link is asked of an answer claiming the criterion is met, not of one that admits it is not
  const short = NEEDS_URL.filter((id) => statusOf(id) === 'Met' && !/https?:\/\//.test(why(id)));
  assert.deepEqual(short, [], `answered Met without the link the badge requires: ${short.join(', ')}`);
});

/* The silver level, by id. That form starts empty and fills itself from this file, so a criterion
   missing here is a question nobody answers rather than a question somebody sees. */
const SILVER = [
  'achieve_passing', 'contribution_requirements', 'dco', 'governance', 'code_of_conduct',
  'roles_responsibilities', 'access_continuity', 'bus_factor', 'documentation_roadmap',
  'documentation_architecture', 'documentation_security', 'documentation_quick_start',
  'documentation_current', 'documentation_achievements', 'accessibility_best_practices',
  'internationalization', 'sites_password_security', 'maintenance_or_update', 'report_tracker',
  'vulnerability_report_credit', 'vulnerability_response_process', 'coding_standards',
  'coding_standards_enforced', 'build_standard_variables', 'build_preserve_debug',
  'build_non_recursive', 'build_repeatable', 'installation_common',
  'installation_standard_variables', 'installation_development_quick', 'external_dependencies',
  'dependency_monitoring', 'updateable_reused_components', 'interfaces_current',
  'automated_integration_testing', 'regression_tests_added50', 'test_statement_coverage80',
  'test_policy_mandated', 'tests_documented_added', 'warnings_strict', 'implement_secure_design',
  'crypto_weaknesses', 'crypto_algorithm_agility', 'crypto_credential_agility',
  'crypto_used_network', 'crypto_tls12', 'crypto_certificate_verification',
  'crypto_verification_private', 'signed_releases', 'version_tags_signed', 'input_validation',
  'hardening', 'assurance_case', 'static_analysis_common_vulnerabilities', 'dynamic_analysis_unsafe',
];

test('the silver level is answered in full', () => {
  assert.equal(SILVER.length, 55);
  const unanswered = SILVER.filter((id) => !criteria.includes(id));
  assert.deepEqual(unanswered, [], `silver criteria with no answer here: ${unanswered.join(', ')}`);
});

test('the silver answers that are not Met are the ones this project cannot write its way out of', () => {
  /* Every one left is a SHOULD or a SUGGESTED and may stay that way. access_continuity, the MUST,
     was Unmet until 2026-09-23, while one person could release; it turned Met when the repository
     moved into an organization both maintainers own. If a MUST shows up here again, silver is
     gone, and that is not something to fix by editing this list. */
  const notMet = SILVER.filter((id) => !['Met', 'N/A'].includes(statusOf(id))).sort();
  assert.deepEqual(notMet, ['bus_factor', 'crypto_algorithm_agility', 'dco', 'version_tags_signed']);
  assert.match(why('access_continuity'), /GOVERNANCE\.md/,
    'the continuity answer has to point at where it is explained');
});

test('the prose and the machine-readable answers cover the same criteria', () => {
  const inDoc = new Set([...doc.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map((m) => m[1]));
  const onlyDoc = [...inDoc].filter((id) => !criteria.includes(id));
  const onlyJson = criteria.filter((id) => !inDoc.has(id));
  assert.deepEqual(onlyDoc, [], `in docs/openssf-answers.md but not in .bestpractices.json: ${onlyDoc.join(', ')}`);
  assert.deepEqual(onlyJson, [], `in .bestpractices.json but not in docs/openssf-answers.md: ${onlyJson.join(', ')}`);
});

test('the counted claims match what the repository counts', () => {
  /* Two numbers in the answers are measured elsewhere in this repository, and both have gone stale
     in documents before: the number of test files and the coverage the ratchet holds. */
  const files = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => /\.test\.(js|ts)$/.test(f)).length;
  // a floor, like ARCHITECTURE.md's: an exact number conflicted between every two open pull
  // requests that each added a test file
  const said = /more than (\d+) test files on node:test/.exec(why('test'));
  assert.ok(said, 'the test criterion stopped saying how many test files there are');
  assert.ok(files > Number(said[1]), `the answer says more than ${said[1]} test files and test/ has ${files}`);

  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'coverage-baseline.json'), 'utf8'));
  const floor = /floor of (\d+)% of lines/.exec(why('test_most'));
  assert.ok(floor, 'the coverage criterion stopped naming the floor the gate holds');
  assert.equal(Number(floor[1]), baseline.global.lines,
    'the floor in the answer is not the floor in .github/coverage-baseline.json');

  /* Silver asks for 80% of statements. Claiming that while holding a floor below it would be a
     claim nothing enforces, so the answer points at the gate and the gate has to agree. */
  const refuses = /refuses anything under (\d+)%/.exec(why('test_statement_coverage80'));
  assert.ok(refuses, 'the statement-coverage answer stopped naming what the gate refuses');
  assert.equal(Number(refuses[1]), baseline.global.lines, 'the answer and the gate disagree');
  assert.ok(baseline.global.lines >= 80, 'silver wants 80% of statements; the floor is lower');
});
