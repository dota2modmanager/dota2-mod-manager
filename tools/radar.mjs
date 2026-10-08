#!/usr/bin/env node
/**
 * The radar: everything that is waiting on a person, in one place that keeps itself current.
 *
 * On 2026-09-15 an outside review read this repository as half abandoned. Nothing was broken
 * that day; things were simply waiting and nobody was reminded. Four pull requests had sat for
 * days, six CodeQL alerts were open, issue #3 had said "first week" for a month because its
 * script lost its memory, SECURITY.md sent reporters to a feature that was switched off, and the
 * personal token the catalog bot pushed with expired the same evening. Each of those was
 * visible to anyone who looked. None of them told anybody.
 *
 * So once a day this reads what GitHub and the repository know, rewrites the body of one pinned
 * issue ("Project status") with what needs a decision, what is red, what is about to expire and
 * what is worth a look, and, when something has waited longer than CONTRIBUTING.md and
 * SECURITY.md promise, sends the maintainer one Discord message. It never closes, labels or
 * comments on anybody's issue: a bot closing people's reports reads worse than silence.
 *
 * The decisions are pure functions over plain data (evaluate, renderIssue, renderDiscord) and are
 * tested against fixtures in test/radar.test.js. The part that talks to GitHub is thin on purpose.
 *
 * Two security lists stay out of reach. The workflow token cannot read Dependabot or secret
 * scanning alerts: a dry run on 2026-09-16 got neither, and the credential registry refuses
 * personal tokens. Vulnerable dependencies come from `npm audit` instead, which reads the same
 * advisory database from the lockfile and needs no token. Leaked secrets have no substitute here:
 * push protection refuses the known kinds at the door, and GitHub emails the owner about the rest.
 *
 * Usage:
 *   GH_TOKEN=... node tools/radar.mjs            # update the issue, alert when overdue
 *   GH_TOKEN=... node tools/radar.mjs --dry      # print both, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const TITLE = 'Project status';
/* The OpenSSF Best Practices entry this repository answers, see docs/openssf-answers.md. The
   site fills a criterion whose answer is still a question mark from .bestpractices.json and
   never touches one that is already saved, so the file and the entry drift apart silently and
   the only sign is a percentage nobody is watching. */
export const BADGE_PROJECT = 14721;
export const MARK = '<!-- radar:v1 -->';

/**
 * What the project promises, in one place. CONTRIBUTING.md and SECURITY.md state the two
 * response times in words, and test/radar.test.js fails when the words and these numbers differ.
 */
export const POLICY = {
  responseHours: 72, // first maintainer reply on an issue
  securityHours: 48, // first reply on a vulnerability report
  waitingDays: 3, // a pull request or a security alert open this long wants a decision
  expiryWarnDays: 14,
  expiryAlertDays: 3,
  docsReviewDays: 30,
  unreleasedDays: 7,
  goodFirstIssues: 3,
  searchReportDays: 8,
  silenceFloorHours: 24, // never call a scheduled job silent sooner than this; see the silence check
};

const HOUR = 3600000;
const DAY = 24 * HOUR;

export const hoursSince = (when, now) => (now - new Date(when).getTime()) / HOUR;

export function fmtAge(hours) {
  if (!Number.isFinite(hours)) return 'ever';
  if (hours < 48) return `${Math.max(1, Math.round(hours))} hours`;
  return `${Math.round(hours / 24)} days`;
}

export function fmtInterval(hours) {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours === 24) return 'day';
  if (hours === 168) return 'week';
  if (hours < 24) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * How often a cron expression fires, roughly, in hours. Only the shapes this repository uses need
 * to be right; anything else falls back to a day, which errs toward noticing a silence late
 * rather than raising a false one.
 */
export function cronIntervalHours(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  const step = (field) => {
    const m = /^\*\/(\d+)$/.exec(field);
    return m ? Number(m[1]) : null;
  };
  if (dow !== '*') return 168;
  if (dom !== '*' || mon !== '*') return 720;
  if (hour === '*') {
    const s = step(min);
    return s ? s / 60 : 1;
  }
  const hs = step(hour);
  if (hs) return hs;
  if (hour.includes(',')) return 24 / hour.split(',').length;
  return 24;
}

/** Scheduled workflows and how often each should run, read from the workflow files themselves. */
export function schedulesFrom(files) {
  const out = [];
  for (const { file, text } of files) {
    const hours = [...String(text).matchAll(/cron:\s*['"]([^'"]+)['"]/g)]
      .map((m) => cronIntervalHours(m[1]))
      .filter(Boolean);
    if (!hours.length) continue;
    const name = ((/^name:\s*(.+)$/m.exec(text) || [])[1] || file).trim().replace(/^['"]|['"]$/g, '');
    out.push({ file, name, intervalHours: Math.min(...hours) });
  }
  return out;
}

/**
 * Workflows that only start when a release is published. They never run on main, so the radar has
 * to look at their last run wherever it happened, or a red one is invisible.
 * @param {Array<{file: string, text: string}>} files
 * @returns {string[]} the workflow paths
 */
export function releaseTriggered(files) {
  return files
    .filter(({ text }) => {
      const on = String(text).split(/\n(?=[a-z])/).find((block) => block.startsWith('on:')) || '';
      return /^ {2}release:/m.test(on);
    })
    .map(({ file }) => file);
}

export function lastGoneOver(decisionsText) {
  const m = /Last gone over on (\d{4}-\d{2}-\d{2})/.exec(decisionsText || '');
  return m ? m[1] : null;
}

const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const isBot = (login) => /\[bot\]$/.test(login || '');

/**
 * Since when an issue has been waiting on the maintainer, or null when it is not. The last
 * word decides: a report nobody from the project has answered waits from when it was opened,
 * and a thread where someone replied after the maintainer waits from that reply. An issue the
 * maintainer opened and nobody else has touched is backlog, not a question.
 */
export function waitingSince(issue, comments) {
  const last = (comments || []).filter((c) => !isBot(c.user && c.user.login)).pop();
  if (last) return MAINTAINER.has(last.author_association) ? null : last.created_at;
  if (MAINTAINER.has(issue.author_association) || isBot(issue.user && issue.user.login)) return null;
  return issue.created_at;
}

/**
 * The issues the incident write-ups answer: the `Issue` row in each file under docs/incidents/.
 * @param {string[]} texts  the files' contents
 * @returns {number[]}
 */
export function incidentIssues(texts) {
  const named = new Set();
  for (const text of texts) {
    const row = text.match(/^\| Issue \| (.+) \|\s*$/m);
    if (row) for (const m of row[1].matchAll(/#(\d+)/g)) named.add(Number(m[1]));
  }
  return [...named].sort((a, b) => a - b);
}

/**
 * One entry per vulnerable package in an `npm audit --json` report (format 2), by name.
 * @param {{vulnerabilities?: Record<string, any>}} report
 * @returns {Array<{name: string, severity: string, direct: boolean, title: string|null, url: string|undefined, through: string[], fix: string|null}>}
 */
export function auditFindings(report) {
  return Object.values((report && report.vulnerabilities) || {}).map((v) => {
    const via = v.via || [];
    // an advisory of its own is an object; a package that is only vulnerable through another names it
    const advisory = via.find((x) => x && typeof x === 'object') || null;
    const fix = v.fixAvailable;
    return {
      name: v.name,
      severity: v.severity || 'unrated',
      direct: Boolean(v.isDirect),
      title: advisory ? advisory.title : null,
      url: advisory ? advisory.url : undefined,
      through: via.filter((x) => typeof x === 'string'),
      fix: fix === true ? 'npm audit fix'
        : fix && typeof fix === 'object' ? `${fix.name} ${fix.version}${fix.isSemVerMajor ? ', a major update' : ''}`
          : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The advisories this project decided to live with, from an osv-scanner.toml beside a lockfile.
 *
 * One list answers two readers. OpenSSF Scorecard's Vulnerabilities check runs OSV-Scanner, which
 * skips what that file lists, and the radar stops asking for a decision on the same entries. Each
 * entry has a date it runs out on, so an accepted risk comes back as a question by itself rather
 * than staying accepted because nobody looked again. Only what the radar needs from the format is
 * read: [[IgnoredVulns]] tables with id, ignoreUntil and reason.
 * @param {string|null} toml
 * @returns {Array<{id: string, until: string|null, reason: string}>}
 */
export function acceptedAdvisories(toml) {
  const out = [];
  for (const block of String(toml || '').split(/^\s*\[\[IgnoredVulns\]\]\s*$/m).slice(1)) {
    const table = block.split(/^\s*\[/m)[0];
    const get = (key) => {
      const m = new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|([^\\s#]+))`, 'm').exec(table);
      return m ? (m[1] ?? m[2]) : null;
    };
    const id = get('id');
    if (id) out.push({ id, until: get('ignoreUntil'), reason: get('reason') || '' });
  }
  return out;
}

/**
 * Which findings an accepted advisory covers: the package it names, and every package that is
 * vulnerable only through covered ones (npm audit lists the whole chain up to a direct dependency).
 * @returns {Map<string, {id: string, until: string|null, reason: string, expired: boolean}>} package name -> the entry
 */
export function acceptedFindings(found, accepted, now = Date.now()) {
  const byName = new Map(found.map((f) => [f.name, f]));
  const own = new Map();
  for (const f of found) {
    const entry = accepted.find((a) => f.url && f.url.endsWith(`/${a.id}`));
    if (entry) own.set(f.name, { ...entry, expired: Boolean(entry.until) && Date.parse(entry.until) < now });
  }
  /* The advisories a package is vulnerable through, followed down the chain. npm audit's chain can
     loop (app-builder-lib through dmg-builder, dmg-builder through app-builder-lib), so each name is
     visited once. A name the report does not list is a root nobody accepted. */
  const roots = (name, seen) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const f = byName.get(name);
    if (!f) return [name];
    return [...(f.url ? [f.name] : []), ...f.through.flatMap((n) => roots(n, seen))];
  };
  const out = new Map();
  for (const f of found) {
    const r = roots(f.name, new Set());
    if (!r.length || !r.every((n) => own.has(n))) continue;
    const entries = r.map((n) => own.get(n));
    out.set(f.name, { ...entries[0], expired: entries.some((e) => e.expired) });
  }
  return out;
}

/**
 * What the branch rule on main enforces, set against what the repository says it should.
 * @param {Array<{type: string, parameters?: any}>} rules  GET repos/:repo/rules/branches/main
 * @param {string[]} listed  the "branch" list in .github/required-checks.json
 * @returns {{missing: string[], extra: string[], codeScanning: boolean}}
 */
export function branchRuleGaps(rules, listed) {
  const required = rules
    .filter((r) => r.type === 'required_status_checks')
    .flatMap((r) => ((r.parameters && r.parameters.required_status_checks) || []).map((c) => c.context));
  const codeScanning = rules.some((r) => r.type === 'code_scanning'
    && ((r.parameters && r.parameters.code_scanning_tools) || []).some((tool) => tool.tool === 'CodeQL'));
  return {
    missing: listed.filter((name) => !required.includes(name)),
    extra: required.filter((name) => !listed.includes(name)),
    codeScanning,
  };
}

/**
 * The whole judgement. `data` is what the IO layer gathered; nothing here reads the network or
 * the clock except through `now`. Every item says whether it is overdue (`overdue: true`), which
 * is what decides whether the maintainer gets a message.
 */
/**
 * Where the badge entry and this repository disagree about their own answers.
 *
 * `behind` is a criterion this repository answers and the entry has not taken: the robot on the
 * form fills blanks only, so an answer written here after somebody pressed it never arrives.
 * `disagree` is worse and rarer: both sides have an answer and they are different, which means
 * somebody edited one of them by hand.
 *
 * @param {object} answers  .bestpractices.json
 * @param {object} entry    the project's JSON from bestpractices.dev
 * @returns {{behind: string[], disagree: string[]}}
 */
export function badgeDrift(answers, entry) {
  const behind = [];
  const disagree = [];
  for (const [key, ours] of Object.entries(answers || {})) {
    if (!key.endsWith('_status')) continue;
    const id = key.slice(0, -'_status'.length);
    const theirs = (entry || {})[key];
    // a criterion the entry does not carry at all belongs to a level nobody has opened yet
    if (theirs === undefined) continue;
    if (theirs === null || theirs === '' || theirs === '?') behind.push(id);
    else if (theirs !== ours) disagree.push(`${id}: the entry says ${theirs}, this repository says ${ours}`);
  }
  return { behind: behind.sort(), disagree: disagree.sort() };
}

export function evaluate(data, now = Date.now(), policy = POLICY) {
  const r = { decide: [], red: [], expiring: [], look: [], fine: [] };

  for (const pr of data.pulls || []) {
    const h = hoursSince(pr.created_at, now);
    r.decide.push({
      title: `PR #${pr.number}: ${pr.title}`,
      url: pr.html_url,
      detail: `by ${(pr.user && pr.user.login) || 'unknown'}${pr.draft ? ', draft' : ''}, open ${fmtAge(h)}`,
      overdue: !pr.draft && h > policy.waitingDays * 24,
    });
  }
  if (!(data.pulls || []).length) r.fine.push('No open pull requests');

  let waiting = 0;
  for (const issue of data.issues || []) {
    if (!issue.waitingSince) continue;
    waiting++;
    const h = hoursSince(issue.waitingSince, now);
    r.decide.push({
      title: `Issue #${issue.number}: ${issue.title}`,
      url: issue.html_url,
      detail: `no reply from the project for ${fmtAge(h)}`,
      overdue: h > policy.responseHours,
    });
  }
  if (!waiting) r.fine.push('No issue is waiting on a reply');

  /* A regression is something that worked and stopped. Closing the issue fixes it once; the write-up
     in docs/incidents/ says why nothing caught it and names what does now, and test/incidents.test.js
     keeps those names true. A closed regression that no write-up names is a job left half done. */
  const written = new Set(data.incidentIssues || []);
  let unwritten = 0;
  for (const issue of data.regressions || []) {
    if (issue.state !== 'closed' || written.has(issue.number)) continue;
    unwritten++;
    const h = hoursSince(issue.closed_at, now);
    r.decide.push({
      title: `Regression #${issue.number} has no incident write-up: ${issue.title}`,
      url: issue.html_url,
      detail: `closed ${fmtAge(h)} ago; add a file to docs/incidents/ with #${issue.number} in its Issue row`,
      overdue: h > policy.waitingDays * 24,
    });
  }
  if ((data.regressions || []).length && !unwritten) r.fine.push('Every closed regression has an incident write-up');

  if (data.codeScanning === 'unreadable') {
    r.look.push({ title: 'Code scanning alerts could not be read', detail: 'the workflow token needs security-events: read', overdue: false });
  } else {
    /* Scorecard reports into the same list as CodeQL, but its findings are about how the project
       is run, and several describe work with a plan rather than a mistake to fix this week: no
       fuzzing, no paid signing certificate. One overdue decision each would turn the radar red
       every morning for things nobody can close by Friday, and a radar that is always red is not
       read. So they are counted on one line, and every other tool's alert stays a decision. */
    const all = data.codeScanning || [];
    const scorecard = all.filter((a) => a.tool && /scorecard/i.test(a.tool.name || ''));
    const alerts = all.filter((a) => !scorecard.includes(a));
    for (const a of alerts) {
      const h = hoursSince(a.created_at, now);
      const where = a.most_recent_instance && a.most_recent_instance.location ? a.most_recent_instance.location.path : 'unknown file';
      r.decide.push({
        title: `Code scanning #${a.number}: ${(a.rule && (a.rule.description || a.rule.id)) || 'alert'}`,
        url: a.html_url,
        detail: `${(a.rule && a.rule.security_severity_level) || (a.rule && a.rule.severity) || 'unrated'} in ${where}, open ${fmtAge(h)}`,
        overdue: h > policy.waitingDays * 24,
      });
    }
    if (!alerts.length) r.fine.push('No open code scanning alerts');
    if (scorecard.length) {
      const checks = [...new Set(scorecard.map((a) => (a.rule && a.rule.id) || 'unknown'))].sort();
      r.look.push({
        title: `Scorecard has ${scorecard.length} open finding${scorecard.length === 1 ? '' : 's'}`,
        url: data.scorecardUrl,
        detail: checks.join(', '),
        overdue: false,
      });
    }
  }

  /* The badge questionnaire against the file this repository keeps it in. Nothing here is red:
     an entry a couple of answers behind is a form nobody pressed Save on, not an outage. */
  if (data.badge === 'unreadable') {
    r.look.push({ title: 'The OpenSSF badge entry could not be read', detail: 'bestpractices.dev did not answer', overdue: false });
  } else if (data.badge) {
    const drift = badgeDrift(data.answers, data.badge);
    const url = `https://www.bestpractices.dev/en/projects/${BADGE_PROJECT}`;
    if (drift.behind.length) {
      r.decide.push({
        title: `${drift.behind.length} answer${drift.behind.length === 1 ? '' : 's'} in .bestpractices.json ${drift.behind.length === 1 ? 'is' : 'are'} not on the badge entry`,
        url: `${url}/edit`,
        detail: `${drift.behind.join(', ')}: open the form and press "Save (and continue)" with the robot, which fills answers the entry does not have`,
        overdue: false,
      });
    }
    if (drift.disagree.length) {
      r.decide.push({
        title: `The badge entry and this repository disagree about ${drift.disagree.length} criteri${drift.disagree.length === 1 ? 'on' : 'a'}`,
        url: `${url}/edit`,
        detail: `${drift.disagree.join('; ')}: the robot never overwrites a saved answer, so one of the two was edited by hand`,
        overdue: false,
      });
    }
    if (!drift.behind.length && !drift.disagree.length) {
      const level = data.badge.badge_level || 'none';
      const silver = data.badge.badge_percentage_1;
      r.fine.push(`Badge entry matches this repository: ${level}${typeof silver === 'number' ? `, silver at ${silver}%` : ''}`);
    }
  }

  /* Known vulnerabilities in what the app and the site install, from npm audit (the top of this
     file says why not from Dependabot's list). A report carries no dates, so nothing here goes
     overdue on its own: Dependabot opens a pull request for anything with a fixed version, and
     that pull request is listed above with its own clock. What stays here is a decision. */
  for (const [where, report] of Object.entries(data.audit || {})) {
    if (report === 'unreadable') {
      r.look.push({ title: `npm audit could not run for the ${where}`, detail: 'the registry did not answer, or the lockfile is missing', overdue: false });
      continue;
    }
    const found = auditFindings(report);
    const minor = found.filter((f) => f.severity === 'low' || f.severity === 'info');
    const covered = acceptedFindings(found, (data.accepted && data.accepted[where]) || [], now);
    for (const f of found.filter((x) => !minor.includes(x))) {
      const ok = covered.get(f.name);
      if (ok && !ok.expired) {
        r.fine.push(`${f.name} (${where}): ${ok.id} accepted until ${ok.until || 'further notice'} in osv-scanner.toml`);
        continue;
      }
      const what = f.title || `through ${f.through.join(', ')}`;
      r.decide.push({
        title: `${f.name} has a ${f.severity} vulnerability (${where})`,
        url: f.url,
        detail: `${what}; ${f.direct ? 'a direct dependency' : 'pulled in by another package'}; ${f.fix ? `fixed by ${f.fix}` : 'no fixed version yet'}${ok ? `; accepted in osv-scanner.toml until ${ok.until}, which has passed` : ''}`,
        overdue: false,
      });
    }
    if (minor.length) {
      r.look.push({ title: `${minor.length} low-severity advisor${minor.length === 1 ? 'y' : 'ies'} in the ${where}`, detail: minor.map((f) => f.name).join(', '), overdue: false });
    }
    if (!found.length) r.fine.push(`npm audit finds nothing in the ${where}`);
  }

  /* The branch rule is GitHub's copy of .github/required-checks.json, and nothing held the two
     together: a check dropped from the rule stops blocking merges without a word. The rule also
     said nothing about what CodeQL finds, only that it ran, so on 2026-09-16 pull request #62
     merged with a new high-severity alert and its fix landed on a branch nobody would merge. */
  if (data.branchRules === 'unreadable') {
    r.look.push({ title: 'The branch rule on main could not be read', detail: 'GET rules/branches/main did not answer', overdue: false });
  } else if (Array.isArray(data.branchRules)) {
    const gaps = branchRuleGaps(data.branchRules, data.requiredChecks || []);
    const checks = (n) => `${n} check${n === 1 ? '' : 's'}`;
    if (gaps.missing.length) {
      r.red.push({ title: `main merges without ${checks(gaps.missing.length)} the repository requires`, url: data.rulesUrl, detail: `${gaps.missing.join(', ')}: add them to the main ruleset`, overdue: true });
    }
    if (gaps.extra.length) {
      r.red.push({ title: `main waits for ${checks(gaps.extra.length)} the repository does not list`, url: data.rulesUrl, detail: `${gaps.extra.join(', ')}: no job reports it, so no pull request can merge`, overdue: true });
    }
    if (!gaps.codeScanning) {
      r.decide.push({ title: 'main merges pull requests that add high-severity code scanning alerts', url: data.rulesUrl, detail: 'add "Require code scanning results" to the main ruleset: CodeQL, security alerts High or higher', overdue: false });
    }
    if (!gaps.missing.length && !gaps.extra.length) {
      r.fine.push(`main requires the ${checks((data.requiredChecks || []).length)} the repository lists${gaps.codeScanning ? ', and a CodeQL result with no new high alert' : ''}`);
    }
  }

  if (data.privateReporting === false) {
    r.red.push({ title: 'Private vulnerability reporting is switched off', detail: 'SECURITY.md sends reporters to it', url: data.securitySettingsUrl, overdue: true });
  } else if (data.privateReporting === true) {
    r.fine.push('Private vulnerability reporting is on');
  }

  let late = 0;
  for (const w of data.workflows || []) {
    if (w.state && w.state !== 'active') {
      r.red.push({ title: `${w.name} is ${w.state.replace(/_/g, ' ')}`, url: w.url, detail: 'GitHub stopped running it', overdue: true });
      continue;
    }
    if (w.lastRun && w.lastRun.conclusion === 'failure') {
      const where = w.lastRun.branch && w.lastRun.branch !== 'main' ? ` on ${w.lastRun.branch}` : ' on main';
      r.red.push({ title: `${w.name} failed${where}`, url: w.lastRun.url, detail: `last run ${String(w.lastRun.created_at).slice(0, 10)}`, overdue: true });
    }
    /* A workflow nothing schedules is only ever started by something else, and when that
       something is an event GitHub refuses to raise (a release published by a workflow token, for
       one) the file sits active and correct and never runs. Nothing above notices: it has no
       schedule to be late for and no failed run to report. */
    if (!w.intervalHours && w.onRelease && !w.lastRun) {
      r.red.push({
        title: `${w.name} has never run, and it is meant to run on a release`,
        url: w.url,
        detail: 'a release published by a workflow raises no event: start it by name from release.yml',
        overdue: true,
      });
    }
    if (w.intervalHours) {
      /* GitHub starts scheduled runs when it can, not when the cron says: in September 2026 the
         30-minute catalog job actually ran every five or six hours. Twice the interval is the
         allowance, but never less than a day, or a busy afternoon at GitHub reads as a dead job
         and the radar cries wolf every morning until nobody reads it. A workflow with no run yet
         is measured from when it was added, so one committed today is new rather than silent: on
         its own first run the radar reported itself as never having run. */
      const allowance = Math.max(w.intervalHours * 2, policy.silenceFloorHours) + 1;
      const from = w.lastRun ? w.lastRun.created_at : w.created_at;
      const since = from ? hoursSince(from, now) : Infinity;
      if (since > allowance) {
        late++;
        const title = w.lastRun ? `${w.name} has not run for ${fmtAge(since)}` : `${w.name} has not run once in the ${fmtAge(since)} since it was added`;
        r.red.push({ title, url: w.url, detail: `it is scheduled every ${fmtInterval(w.intervalHours)}`, overdue: true });
      }
    }
  }
  if ((data.workflows || []).length && !late) r.fine.push('Every scheduled workflow ran on time');

  /* What tools/check-credentials.mjs found this morning, when it ran: a secret that fails or is
     missing is red whatever its date says, and a date a service reports wins over a typed one. A
     secret proven to work today is not a question to answer, even with no date on record: if it
     stops, it is red here the same morning. */
  const live = data.credentialStatus || null;
  const unknown = [];
  let next = null;
  let working = 0;
  for (const [name, s] of Object.entries(data.credentials || {})) {
    const check = live ? live[name] : null;
    if (check && check.state === 'failed') {
      r.red.push({ title: `${name} no longer works`, detail: `${check.detail}. To replace it: ${s.rotate}`, overdue: true });
      continue;
    }
    if (check && check.state === 'missing') {
      /* A secret marked optional in the registry is one the job that reads it can do without: it
         says so and skips. That is a decision for whoever can create the key, not a breakage to
         be messaged about every morning until they do. */
      const line = { title: `${name} is not set`, detail: `${s.what}. To set it: ${s.rotate}`, overdue: !s.optional };
      if (s.optional) r.decide.push({ ...line, title: `${name} is not set, and the job that reads it skips` });
      else r.red.push(line);
      continue;
    }
    if (check && check.state === 'ok') working++;
    const expires = (check && check.expires) || s.expires;
    if (expires === 'unknown') {
      if (!check || check.state !== 'ok') unknown.push(name);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      const days = (new Date(`${expires}T00:00:00Z`).getTime() - now) / DAY;
      if (days <= policy.expiryWarnDays) {
        r.expiring.push({
          title: `${name} ${days < 0 ? 'expired on' : 'expires on'} ${expires}`,
          detail: `${s.what}. To replace it: ${s.rotate}`,
          overdue: days <= policy.expiryAlertDays,
        });
      } else if (!next || expires < next.expires) {
        next = { name, expires };
      }
    }
  }
  if (live) r.fine.push(`${working} of ${Object.keys(data.credentials || {}).length} secrets checked today and working`);
  if (unknown.length) {
    r.look.push({ title: `No expiry date recorded for ${unknown.length} secret${unknown.length === 1 ? '' : 's'}`, detail: `${unknown.join(', ')}: check each dashboard and write the date into .github/credentials.json`, overdue: false });
  }
  if (next && !r.expiring.length) r.fine.push(`Nothing expires within ${policy.expiryWarnDays} days; next is ${next.name} on ${next.expires}`);

  if (data.searchReportAt === null) {
    r.look.push({ title: 'No weekly search report found on issue #3', detail: 'seo.yml posts it every Monday', overdue: false });
  } else if (data.searchReportAt) {
    const h = hoursSince(data.searchReportAt, now);
    if (h > policy.searchReportDays * 24) r.red.push({ title: `The weekly search report is ${fmtAge(h)} old`, url: data.searchIssueUrl, detail: 'seo.yml posts one every Monday', overdue: true });
    else r.fine.push(`Search report posted ${String(data.searchReportAt).slice(0, 10)}`);
  }

  if (data.unreleased && data.unreleased.count) {
    const h = hoursSince(data.unreleased.oldest, now);
    const line = `${data.unreleased.count} commit${data.unreleased.count === 1 ? '' : 's'} on main since ${data.unreleased.tag}, the oldest ${fmtAge(h)} old`;
    if (h > policy.unreleasedDays * 24) r.look.push({ title: 'Unreleased work', detail: line, overdue: false });
    else r.fine.push(line);
  }

  if (data.decisionsReviewed) {
    const h = hoursSince(`${data.decisionsReviewed}T00:00:00Z`, now);
    if (h > policy.docsReviewDays * 24) r.look.push({ title: 'DECISIONS.md is due a read-through', detail: `last gone over on ${data.decisionsReviewed}`, overdue: false });
  }

  if (typeof data.goodFirstIssues === 'number' && data.goodFirstIssues < policy.goodFirstIssues) {
    r.look.push({ title: `Only ${data.goodFirstIssues} good first issue${data.goodFirstIssues === 1 ? '' : 's'} open`, detail: `keep at least ${policy.goodFirstIssues}, so a newcomer has somewhere to start`, overdue: false });
  }

  if (typeof data.communityHealth === 'number' && data.communityHealth < 100) {
    r.look.push({ title: `Community profile at ${data.communityHealth}%`, detail: 'a file GitHub looks for is missing', overdue: false });
  }

  for (const list of ['decide', 'red', 'expiring', 'look']) r[list].sort((a, b) => Number(b.overdue) - Number(a.overdue));
  r.overdue = [...r.decide, ...r.red, ...r.expiring].filter((x) => x.overdue);
  return r;
}

const bullet = (x) => `- ${x.url ? `[${x.title}](${x.url})` : x.title}${x.detail ? ` · ${x.detail}` : ''}${x.overdue ? ' · **overdue**' : ''}`;

/** The body of the pinned issue. */
export function renderIssue(result, now, meta = {}) {
  const when = new Date(now).toISOString().replace('T', ' ').slice(0, 16);
  const section = (title, items, empty) => [`### ${title} (${items.length})`, '', ...(items.length ? items.map(bullet) : [`_${empty}_`]), ''];
  return [
    MARK,
    `Updated **${when} UTC** by [radar.yml](${meta.workflowUrl || '../actions/workflows/radar.yml'}). Everything here is read from GitHub and from files in this repository; nobody edits this text by hand.`,
    '',
    `The project answers an issue within ${POLICY.responseHours} hours and a vulnerability report within ${POLICY.securityHours} ([CONTRIBUTING.md](../blob/main/CONTRIBUTING.md#response-times), [SECURITY.md](../blob/main/SECURITY.md)). A pull request or security alert open longer than ${POLICY.waitingDays} days is marked overdue, and the maintainer is messaged about it.`,
    '',
    ...section('Needs a decision', result.decide, 'Nothing is waiting.'),
    ...section('Red', result.red, 'Nothing is failing.'),
    ...section('Expiring', result.expiring, 'Nothing expires soon.'),
    ...section('Worth a look', result.look, 'Nothing else.'),
    '### In order',
    '',
    ...(result.fine.length ? result.fine.map((x) => `- ${x}`) : ['_Nothing to report._']),
    '',
  ].join('\n');
}

/** The Discord message, or null when nothing is overdue. Discord caps content at 2000 characters. */
export function renderDiscord(result, meta = {}) {
  if (!result.overdue.length) return null;
  const head = `**Radar: ${result.overdue.length} overdue**${meta.issueUrl ? ` · ${meta.issueUrl}` : ''}`;
  const lines = [];
  let used = head.length;
  for (const [i, x] of result.overdue.entries()) {
    const line = `- ${x.title}${x.detail ? ` (${x.detail})` : ''}${x.url ? ` <${x.url}>` : ''}`;
    if (used + line.length + 40 > 1900) {
      lines.push(`- and ${result.overdue.length - i} more on the issue`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return [head, ...lines].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Talking to GitHub. Thin on purpose: everything worth testing is above.

async function api(pathname, { method = 'GET', body, token, allow = [] } = {}) {
  const res = await fetch(pathname.startsWith('https://') ? pathname : `https://api.github.com/${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dota2-mod-manager-radar',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow.includes(res.status)) return { status: res.status };
  if (!res.ok) throw new Error(`${method} ${pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? {} : res.json();
}

/** A file's text, or null when it is not there. */
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** npm audit from the lockfile alone: nothing installed, no token. 'unreadable' when npm could not answer. */
function audit(dir) {
  const args = ['audit', '--json', '--package-lock-only'];
  // npm is npm.cmd on Windows, which Node starts only through a shell, and a shell takes one string
  const run = process.platform === 'win32'
    ? spawnSync(`npm ${args.join(' ')}`, { cwd: dir, encoding: 'utf8', shell: true })
    : spawnSync('npm', args, { cwd: dir, encoding: 'utf8' });
  try {
    const report = JSON.parse(run.stdout);
    return report && report.vulnerabilities ? report : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

async function gather(repo, token, now) {
  const files = fs.readdirSync(path.join(root, '.github', 'workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: `.github/workflows/${f}`, text: fs.readFileSync(path.join(root, '.github', 'workflows', f), 'utf8') }));
  const schedules = new Map(schedulesFrom(files).map((s) => [s.file, s.intervalHours]));
  const onRelease = new Set(releaseTriggered(files));

  const pulls = await api(`repos/${repo}/pulls?state=open&per_page=100`, { token });
  const openIssues = (await api(`repos/${repo}/issues?state=open&per_page=100`, { token })).filter((i) => !i.pull_request);
  const rules = await api(`repos/${repo}/rules/branches/main`, { token, allow: [403, 404] });
  const regressions = (await api(`repos/${repo}/issues?labels=regression&state=all&per_page=100`, { token })).filter((i) => !i.pull_request);
  const incidentsDir = path.join(root, 'docs', 'incidents');
  const incidentTexts = fs.readdirSync(incidentsDir).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(incidentsDir, f), 'utf8'));

  const issues = [];
  let searchIssue = null;
  let radarIssue = null;
  for (const issue of openIssues) {
    if (issue.title === TITLE) { radarIssue = issue; continue; }
    if (issue.title === 'Search visibility') { searchIssue = issue; continue; }
    const comments = issue.comments ? await api(`repos/${repo}/issues/${issue.number}/comments?per_page=100`, { token }) : [];
    issues.push({ ...issue, waitingSince: waitingSince(issue, comments) });
  }

  let searchReportAt;
  if (searchIssue) {
    const comments = await api(`repos/${repo}/issues/${searchIssue.number}/comments?per_page=100`, { token });
    const reports = comments.filter((c) => isBot(c.user && c.user.login) && /^## Search, week of/.test(c.body || ''));
    searchReportAt = reports.length ? reports[reports.length - 1].created_at : null;
  }

  /* The badge entry, from the site rather than from GitHub: no token, and a failure is a line to
     look at rather than a run that dies. */
  let badge = 'unreadable';
  try {
    const res = await fetch(`https://www.bestpractices.dev/projects/${BADGE_PROJECT}.json`, {
      headers: { 'User-Agent': 'dota2-mod-manager-radar' },
    });
    if (res.ok) badge = await res.json();
  } catch { /* offline, or the site is down: the line says so */ }
  const answers = JSON.parse(fs.readFileSync(path.join(root, '.bestpractices.json'), 'utf8'));

  const scanning = await api(`repos/${repo}/code-scanning/alerts?state=open&per_page=100`, { token, allow: [403, 404] });
  const codeScanning = Array.isArray(scanning) ? scanning : 'unreadable';

  const pvr = await api(`repos/${repo}/private-vulnerability-reporting`, { token, allow: [403, 404] });
  const community = await api(`repos/${repo}/community/profile`, { token, allow: [403, 404] });

  const workflows = [];
  const listed = await api(`repos/${repo}/actions/workflows?per_page=100`, { token });
  for (const w of listed.workflows || []) {
    if (!w.path || !w.path.startsWith('.github/workflows/')) continue; // Dependabot and Pages run as dynamic workflows
    const runs = await api(`repos/${repo}/actions/workflows/${w.id}/runs?branch=main&status=completed&per_page=1`, { token });
    let last = (runs.workflow_runs || [])[0];
    if (!last && onRelease.has(w.path)) {
      // published from a tag, so nothing of it is ever on main
      const any = await api(`repos/${repo}/actions/workflows/${w.id}/runs?status=completed&per_page=1`, { token });
      last = (any.workflow_runs || [])[0];
    }
    workflows.push({
      name: w.name,
      state: w.state,
      url: w.html_url,
      intervalHours: schedules.get(w.path) || null,
      onRelease: onRelease.has(w.path),
      created_at: w.created_at,
      lastRun: last ? { conclusion: last.conclusion, created_at: last.created_at, url: last.html_url, branch: last.head_branch } : null,
    });
  }

  let unreleased = null;
  const latest = await api(`repos/${repo}/releases/latest`, { token, allow: [404] });
  if (latest && latest.tag_name) {
    const cmp = await api(`repos/${repo}/compare/${latest.tag_name}...main`, { token });
    const own = (cmp.commits || []).filter((c) => !isBot(c.author && c.author.login) && !/\[skip ci\]/.test(c.commit.message));
    if (own.length) unreleased = { tag: latest.tag_name, count: own.length, oldest: own[0].commit.committer.date };
  }

  const credentials = JSON.parse(fs.readFileSync(path.join(root, '.github', 'credentials.json'), 'utf8')).secrets;
  // written a step earlier by tools/check-credentials.mjs; absent on a run without it
  const statusFile = path.join(root, 'credentials-status.json');
  const credentialStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')).results : null;
  const decisionsReviewed = lastGoneOver(fs.readFileSync(path.join(root, 'DECISIONS.md'), 'utf8'));

  return {
    radarIssue,
    data: {
      pulls,
      issues,
      regressions,
      incidentIssues: incidentIssues(incidentTexts),
      branchRules: Array.isArray(rules) ? rules : 'unreadable',
      requiredChecks: JSON.parse(fs.readFileSync(path.join(root, '.github', 'required-checks.json'), 'utf8')).branch,
      rulesUrl: `https://github.com/${repo}/settings/rules`,
      codeScanning,
      audit: { app: audit(root), site: audit(path.join(root, 'site')) },
      accepted: { app: acceptedAdvisories(readOr(path.join(root, 'osv-scanner.toml'))), site: acceptedAdvisories(readOr(path.join(root, 'site', 'osv-scanner.toml'))) },
      scorecardUrl: `https://github.com/${repo}/security/code-scanning?query=tool%3AScorecard+is%3Aopen`,
      badge,
      answers,
      privateReporting: typeof pvr.enabled === 'boolean' ? pvr.enabled : undefined,
      securitySettingsUrl: `https://github.com/${repo}/settings/security_analysis`,
      communityHealth: community.health_percentage,
      workflows,
      credentials,
      credentialStatus,
      searchReportAt,
      searchIssueUrl: searchIssue ? searchIssue.html_url : undefined,
      unreleased,
      decisionsReviewed,
      goodFirstIssues: openIssues.filter((i) => (i.labels || []).some((l) => l.name === 'good first issue')).length,
      now,
    },
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const dry = process.argv.includes('--dry');
  const repo = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const now = Date.now();
  const { radarIssue, data } = await gather(repo, token, now);
  const result = evaluate(data, now);
  const meta = { workflowUrl: `https://github.com/${repo}/actions/workflows/radar.yml`, issueUrl: radarIssue ? radarIssue.html_url : `https://github.com/${repo}/issues` };
  const body = renderIssue(result, now, meta);
  const message = renderDiscord(result, meta);

  if (dry) {
    console.log(body);
    console.log(message ? `\n--- Discord ---\n${message}` : '\n--- Discord: nothing overdue, no message ---');
  } else {
    let issue = radarIssue;
    if (issue) {
      await api(`repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: { body }, token });
    } else {
      issue = await api(`repos/${repo}/issues`, { method: 'POST', body: { title: TITLE, body }, token });
      try {
        await api('graphql', { method: 'POST', token, body: { query: 'mutation($id: ID!) { pinIssue(input: {issueId: $id}) { issue { number } } }', variables: { id: issue.node_id } } });
      } catch (err) {
        console.log(`::warning::created #${issue.number} but could not pin it: ${err.message}`);
      }
    }
    console.log(`updated #${issue.number}: ${result.overdue.length} overdue, ${result.decide.length} waiting, ${result.red.length} red`);

    const webhook = process.env.RADAR_DISCORD_WEBHOOK || '';
    if (message && webhook) {
      // The address is a credential: it never goes into the log, including in an error.
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.replace(meta.issueUrl, issue.html_url), username: 'Radar', allowed_mentions: { parse: [] } }),
      });
      console.log(res.ok ? 'sent the overdue list to Discord' : `::warning::Discord answered HTTP ${res.status}`);
    } else if (message) {
      console.log('::warning::something is overdue and RADAR_DISCORD_WEBHOOK is not set, so nobody was messaged');
    }
  }
}
