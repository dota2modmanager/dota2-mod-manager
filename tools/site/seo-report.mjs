#!/usr/bin/env node
/**
 * What the search engines are actually seeing, once a week, as a comment on one issue.
 *
 * Reading a webmaster console by hand happens twice and then stops. This pulls the numbers,
 * compares them with last week's, and writes the difference somewhere that arrives by itself.
 * A single number is nearly useless here - "position 14" means nothing without last week's
 * position 21 - so almost everything below is printed as a delta.
 *
 * It is also the page somebody checking this project reads to see how far it reaches: a reviewer,
 * a code-signing programme, anyone deciding whether an unsigned installer is worth trusting. So
 * the comment opens with reach - downloads, update checks, visits from search - before the
 * per-console detail that is mostly for us.
 *
 * Three consoles, one comment. Bing takes a key from a settings page, Google a service account
 * added as a user in Search Console, Yandex an OAuth token. Each reads on its own and prints its
 * own block, so a console nobody has connected yet, or one having a bad morning, costs its
 * section and not the report. Inside Google every table has its own guard for the same reason.
 *
 * Last week's numbers come from last week's comment (see tools/site/seo-state.mjs for why they live
 * there), and this week's are appended to this one as an invisible block.
 *
 * Read-only. Nothing here submits a URL, asks for a recrawl or changes a setting: those are
 * worth doing deliberately, not on a schedule while nobody is looking.
 *
 * Credentials come from the environment and are never printed, including in error messages -
 * an API key in a public build log is a key that has to be rotated.
 *
 * Usage:
 *   node tools/site/seo-report.mjs                            # write seo-report.md
 *   node tools/site/seo-report.mjs --dry                      # print it, touch nothing
 *   SEO_PREVIOUS=last-comment.md node tools/site/seo-report.mjs   # compare against that report
 *   node tools/site/seo-report.mjs --raw GetQueryStats        # dump one Bing method
 *   node tools/site/seo-report.mjs --raw google:sites         # dump one Search Console path
 *   node tools/site/seo-report.mjs --raw yandex:user          # dump one Webmaster path
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeState, previousState, ctr, positionBuckets, countLocs, latestWeekOfQueries } from './seo-state.mjs';
import { googleAccessToken } from '../ops/google-auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const STATE = path.join(root, 'seo-state.json');
const OUT = path.join(root, 'seo-report.md');

const SITE = process.env.SEO_SITE_URL || 'https://dota2modmanager.com';
const HOST = new URL(SITE).hostname;
const REPO = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
const BING_KEY = process.env.BING_API_KEY || '';
const GOOGLE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const YANDEX_TOKEN = process.env.YANDEX_OAUTH_TOKEN || '';
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const rawAt = args.indexOf('--raw');

/** Bing's JSON API: one key, one site, everything as a GET. */
async function bing(method, params = {}) {
  if (!BING_KEY) throw new Error('BING_API_KEY is not set');
  const url = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
  url.searchParams.set('apikey', BING_KEY);
  url.searchParams.set('siteUrl', SITE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok) {
    // The key rides in the query string, so the URL never goes into the message.
    throw new Error(`${method}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`${method}: answer was not JSON (${body.slice(0, 120)})`);
  }
  // Bing wraps everything in { d: ... }, and d is sometimes a list and sometimes an object.
  return json.d ?? json;
}

/**
 * A Google service account key, signed into an access token. No library for this: the exchange
 * is one JWT and one POST, and pulling in a dependency to make a single signature would put a
 * supply chain between us and a weekly report.
 *
 * The account has to be added under Settings, Users and permissions in Search Console before any
 * of this returns anything but 403 - owning the project the key came from grants nothing.
 */
let googleAccess = null;
async function googleToken() {
  if (!googleAccess) googleAccess = await googleAccessToken(GOOGLE_KEY, 'https://www.googleapis.com/auth/webmasters.readonly');
  return googleAccess;
}

/** Any Google API with the token. A body makes it a POST. */
async function googleCall(url, body) {
  const token = await googleToken();
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const where = new URL(url).pathname.split('/').slice(-2).join('/');
  if (!res.ok) throw new Error(`${where}: HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${where}: answer was not JSON (${text.slice(0, 120)})`);
  }
}

/** Search Console v3, which is where searchAnalytics and sitemaps live. */
const google = (pathname, body) => googleCall(`https://www.googleapis.com/webmasters/v3/${pathname}`, body);

/**
 * Which property to read. Search Console keeps a domain property as "sc-domain:example.com" and
 * a URL property as the address with its trailing slash, and asking for the wrong one is a 403,
 * so the list of what the account can see decides rather than a guess in a constant.
 */
async function googleProperty() {
  const { siteEntry = [] } = await google('sites');
  const exact = [`sc-domain:${HOST}`, `${SITE}/`, SITE];
  const found = siteEntry.find((s) => exact.includes(s.siteUrl)) || siteEntry.find((s) => (s.siteUrl || '').includes(HOST));
  if (!found) {
    throw new Error(`the service account can see ${siteEntry.length} properties and none of them is ${HOST}. Add it under Settings, Users and permissions`);
  }
  return found.siteUrl;
}

/** Yandex Webmaster v4. The token is a header, so nothing secret can end up in a logged URL. */
async function yandex(pathname, params = {}) {
  if (!YANDEX_TOKEN) throw new Error('YANDEX_OAUTH_TOKEN is not set');
  const url = new URL(`https://api.webmaster.yandex.net/v4/${pathname}`);
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  const res = await fetch(url, { headers: { Authorization: `OAuth ${YANDEX_TOKEN}`, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${pathname}: answer was not JSON (${text.slice(0, 120)})`);
  }
}

/** The host id is "https:example.com:443", colons and all, and it travels inside a path. */
async function yandexHost() {
  const { user_id: userId } = await yandex('user');
  if (!userId) throw new Error('the token did not resolve to a user');
  const { hosts = [] } = await yandex(`user/${userId}/hosts`);
  const mine = hosts.filter((h) => (h.ascii_host_url || '').includes(HOST));
  // A site is usually listed under several addresses; the main mirror is the one with the data.
  const main = mine.find((h) => h.main_mirror?.host_id === h.host_id) || mine[0];
  if (!main) throw new Error(`the token sees ${hosts.length} sites and none of them is ${HOST}`);
  if (!main.verified) throw new Error(`${HOST} is in the account but not verified`);
  return { userId, hostId: main.host_id };
}

/** GitHub's REST API. Public data, so a token only buys a higher rate limit. */
async function github(pathname) {
  const res = await fetch(`https://api.github.com/${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dota2-mod-manager-seo-report',
      ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/** YYYY-MM-DD, n days back. Both consoles want plain dates and no time. */
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Bing dates arrive as /Date(1723680000000)/. */
const asDate = (v) => {
  const m = typeof v === 'string' && /\/Date\((\d+)/.exec(v);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
};

const num = (v) => (typeof v === 'number' ? v : 0);
const fmt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${v.toFixed(1)}%`);
const safe = (s) => String(s).replace(/\|/g, '/');

/** "1,240 (+180)" - the number, and what it did since last week. */
function delta(now, before) {
  if (before === undefined || before === null) return fmt(now);
  const d = now - before;
  if (Math.abs(d) < 0.005) return `${fmt(now)} (=)`;
  const sign = d > 0 ? '+' : '';
  const rounded = Number.isInteger(now) && Number.isInteger(before) ? fmt(d) : d.toFixed(1);
  return `${fmt(now)} (${sign}${rounded})`;
}

/** A position to one decimal, and how far it moved. Lower is better, so a minus is good news. */
function deltaPos(now, before) {
  const shown = now.toFixed(1);
  if (before === undefined || before === null) return shown;
  const d = now - before;
  if (Math.abs(d) < 0.05) return `${shown} (=)`;
  return `${shown} (${d > 0 ? '+' : ''}${d.toFixed(1)})`;
}

/** "1 page", "3 pages". */
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

/** Just the movement, for a column that sits next to the number itself. */
function movement(now, before) {
  if (before === undefined || before === null) return 'first week';
  const d = now - before;
  if (Math.abs(d) < 0.005) return 'no change';
  const sign = d > 0 ? '+' : '';
  return Number.isInteger(now) && Number.isInteger(before) ? `${sign}${fmt(d)}` : `${sign}${d.toFixed(1)}`;
}

/** Last week: from the comment the workflow hands over, or from a local run's file. */
function loadState() {
  const previous = process.env.SEO_PREVIOUS;
  if (previous) {
    try {
      return previousState(fs.readFileSync(previous, 'utf-8'));
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf-8'));
  } catch {
    return {};
  }
}

/** How many pages the site asks to be indexed, read off its own sitemaps rather than typed in. */
async function sitemapPages() {
  const index = await fetch(`${SITE}/sitemap-index.xml`).then((r) => (r.ok ? r.text() : ''));
  const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!children.length) return countLocs(index) || null;
  let total = 0;
  for (const child of children) {
    total += countLocs(await fetch(child).then((r) => (r.ok ? r.text() : '')));
  }
  return total || null;
}

// ---------------------------------------------------------------------------

// --raw is a hand-run debugging path and stops here. It is the one place that exits rather
// than falling through, because everything below it is the report it does not want to write.
if (rawAt >= 0) {
  const method = args[rawAt + 1];
  if (!method) {
    console.error('--raw needs a method, e.g. --raw GetQueryStats, --raw google:sites, --raw yandex:user');
    process.exit(1);
  }
  let out;
  if (method.startsWith('google:')) {
    const what = method.slice(7);
    // The shapes worth dumping are the ones that need a body, so they get names of their own.
    if (what === 'query' || what === 'country' || what === 'device' || what === 'page') {
      out = await google(`sites/${encodeURIComponent(await googleProperty())}/searchAnalytics/query`, {
        startDate: dayAgo(9),
        endDate: dayAgo(3),
        dimensions: [what],
        rowLimit: 10,
      });
    } else if (what === 'inspect') {
      out = await googleCall('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        inspectionUrl: `${SITE}/`,
        siteUrl: await googleProperty(),
      });
    } else {
      out = await google(what);
    }
  } else if (method.startsWith('yandex:')) {
    // {u} and {h} save looking the ids up by hand: user/{u}/hosts/{h}/summary reads as it runs.
    let where = method.slice(7);
    if (where.includes('{u}') || where.includes('{h}')) {
      const { userId, hostId } = await yandexHost();
      where = where.replaceAll('{u}', userId).replaceAll('{h}', encodeURIComponent(hostId));
    }
    out = await yandex(where);
  } else {
    out = await bing(method);
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 8000));
  process.exit(0);
}

const was = loadState();
const now = { checkedAt: new Date().toISOString().slice(0, 10) };
const lines = [];
const notes = [];
const glance = {};

const sitemapTotal = await sitemapPages().catch(() => null);
now.sitemapPages = sitemapTotal;
const ofSitemap = sitemapTotal ? ` of ${fmt(sitemapTotal)} in the sitemap` : '';
const underCovered = (n) => sitemapTotal && n < sitemapTotal * 0.85;

// --- Reach ------------------------------------------------------------------

/* Downloads and update checks, straight from the release assets. An update check is one request
   for latest.yml, so it counts requests rather than people - but installs that are still in use
   ask for it on every start, which makes it the closest public number there is to "how many
   copies are running". The report says requests, and means requests. */
const reach = [];
try {
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await github(`repos/${REPO}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const count = (match) => releases.reduce((n, r) => n + (r.assets || [])
    .filter((a) => match.test(a.name)).reduce((m, a) => m + num(a.download_count), 0), 0);
  const installer = count(/Setup\.exe$/);
  const portable = count(/Portable\.exe$/);
  const appimage = count(/\.AppImage$/);
  const checks = count(/^latest(-linux)?\.yml$|^portable\.yml$/);
  const latest = releases.find((r) => !r.draft && !r.prerelease);
  const repo = await github(`repos/${REPO}`);

  now.reach = { installer, portable, appimage, checks, stars: repo.stargazers_count, forks: repo.forks_count };
  glance.downloads = installer + portable + appimage;
  glance.releases = releases.filter((r) => !r.draft).length;
  glance.latest = latest?.tag_name;

  reach.push('### Reach');
  reach.push('');
  reach.push('| | total | vs last week |');
  reach.push('|---|---|---|');
  reach.push(`| Installer downloads | ${fmt(installer)} | ${movement(installer, was.reach?.installer)} |`);
  reach.push(`| Portable downloads | ${fmt(portable)} | ${movement(portable, was.reach?.portable)} |`);
  reach.push(`| Linux AppImage downloads | ${fmt(appimage)} | ${movement(appimage, was.reach?.appimage)} |`);
  reach.push(`| Update checks served (requests, not people) | ${fmt(checks)} | ${movement(checks, was.reach?.checks)} |`);
  reach.push(`| Releases | ${fmt(glance.releases)}, latest ${latest?.tag_name || 'n/a'} | |`);
  reach.push(`| GitHub stars / forks | ${fmt(repo.stargazers_count)} / ${fmt(repo.forks_count)} | ${movement(repo.stargazers_count, was.reach?.stars)} |`);
  reach.push('');
  reach.push('Counted from GitHub Releases. The same builds are also served from `cdn.dota2modmanager.com`, which keeps no per-file counter, so these are a floor.');
  reach.push('');
} catch (err) {
  reach.push('### Reach');
  reach.push('');
  reach.push(`Could not read the release counters: \`${err.message}\``);
  reach.push('');
}

// --- Bing -------------------------------------------------------------------

if (!BING_KEY) {
  lines.push('### Bing');
  lines.push('');
  lines.push('No `BING_API_KEY` set, so nothing was read. Add it as a repository secret and this fills in.');
  lines.push('');
} else {
  try {
    /* Traffic. Bing returns a row per day; the last seven are the week, and the seven before
       them are what the week is compared against, so a slow Tuesday does not read as a trend. */
    const traffic = await bing('GetRankAndTrafficStats');
    const rows = (Array.isArray(traffic) ? traffic : [])
      .map((r) => ({ date: asDate(r.Date), clicks: num(r.Clicks), impressions: num(r.Impressions) }))
      .filter((r) => r.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const week = rows.slice(-7);
    const clicks = week.reduce((n, r) => n + r.clicks, 0);
    const impressions = week.reduce((n, r) => n + r.impressions, 0);
    now.bing = { clicks, impressions };
    glance.bing = clicks;

    lines.push('### Bing');
    lines.push('');
    lines.push('| | last 7 days | vs the week before |');
    lines.push('|---|---|---|');
    lines.push(`| Clicks | ${fmt(clicks)} | ${movement(clicks, was.bing?.clicks)} |`);
    lines.push(`| Impressions | ${fmt(impressions)} | ${movement(impressions, was.bing?.impressions)} |`);
    lines.push(`| Click-through rate | ${pct(ctr(clicks, impressions))} | ${was.bing ? movement(ctr(clicks, impressions) ?? 0, ctr(was.bing.clicks, was.bing.impressions)) : 'first week'} |`);
    lines.push('');

    /* Queries. The interesting part is not the top ten, which barely move, but what appeared
       for the first time: those are the pages that just started ranking for something. */
    const queries = await bing('GetQueryStats');
    const list = latestWeekOfQueries((Array.isArray(queries) ? queries : []).map((q) => ({
      date: asDate(q.Date),
      query: q.Query,
      clicks: num(q.Clicks),
      impressions: num(q.Impressions),
      position: num(q.AvgImpressionPosition),
    })));

    /* More queries are kept than are shown, so that "new this week" means new and not "was 61st
       last week". A state read back off an old report's tables had 25, so it stays quiet then. */
    now.queries = Object.fromEntries(list.slice(0, 200).map((q) => [q.query, { i: q.impressions, p: q.position }]));

    if (list.length) {
      lines.push('<details><summary>Top queries</summary>');
      lines.push('');
      lines.push('| Query | Impressions | Clicks | Position (lower is better) |');
      lines.push('|---|---|---|---|');
      for (const q of list.slice(0, 25)) {
        const before = was.queries?.[q.query];
        lines.push(
          `| ${safe(q.query)} | ${delta(q.impressions, before?.i)} | ${fmt(q.clicks)} | ${deltaPos(q.position, before?.p)} |`,
        );
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');

      const fresh = list.slice(0, 60).filter((q) => was.queries && !was.fromTables && !(q.query in was.queries)).slice(0, 15);
      if (fresh.length) {
        lines.push(`**New this week:** ${fresh.map((q) => `\`${q.query}\``).join(', ')}`);
        lines.push('');
      }
      const lost = was.fromTables ? [] : Object.entries(was.queries ?? {})
        .sort((a, b) => b[1].i - a[1].i).slice(0, 25).map(([q]) => q)
        .filter((q) => !(q in now.queries)).slice(0, 15);
      if (lost.length) {
        lines.push(`**Stopped showing:** ${lost.map((q) => `\`${q}\``).join(', ')}`);
        lines.push('');
      }
    }

    /* How much of the site Bing actually holds. */
    /* Field names read off the API rather than guessed: the first version asked for
       CrawledCount and HttpCode404, which do not exist, so both printed a confident zero.
       They are CrawledPages and Code4xx. Dump the shape with --raw before adding more. */
    const crawl = await bing('GetCrawlStats');
    const crawlRows = (Array.isArray(crawl) ? crawl : [])
      .map((r) => ({
        date: asDate(r.Date),
        crawled: num(r.CrawledPages),
        inIndex: num(r.InIndex),
        blocked: num(r.BlockedByRobotsTxt),
        notFound: num(r.Code4xx),
        serverErrors: num(r.Code5xx),
        errors: num(r.CrawlErrors) + num(r.DnsFailures) + num(r.ConnectionTimeout),
      }))
      .filter((r) => r.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const last = crawlRows.at(-1);
    if (last) {
      // Crawling is a rate, so the week's worth of it says more than the last day's.
      const crawledWeek = crawlRows.slice(-7).reduce((n, r) => n + r.crawled, 0);
      now.bingIndex = last.inIndex;
      now.bingCrawled = crawledWeek;

      lines.push('| Crawl | value | vs last week |');
      lines.push('|---|---|---|');
      lines.push(`| In the index | ${fmt(last.inIndex)} | ${movement(last.inIndex, was.bingIndex)} |`);
      lines.push(`| Pages crawled in 7 days | ${fmt(crawledWeek)} | ${movement(crawledWeek, was.bingCrawled)} |`);
      lines.push(`| 4xx | ${fmt(last.notFound)} | |`);
      lines.push(`| 5xx | ${fmt(last.serverErrors)} | |`);
      lines.push(`| Blocked by robots.txt | ${fmt(last.blocked)} | |`);
      lines.push('');

      if (underCovered(last.inIndex)) notes.push(`Bing holds ${fmt(last.inIndex)} pages${ofSitemap}.`);
      if (last.notFound > 0) notes.push(`Bing got 4xx from ${plural(last.notFound, 'page')}.`);
      if (last.serverErrors > 0) notes.push(`Bing got 5xx from ${plural(last.serverErrors, 'page')}, which is ours to fix.`);
      if (last.errors > 0) notes.push(`Bing had ${plural(last.errors, 'crawl failure')} (DNS, timeouts).`);
      if (last.blocked > 0) notes.push(`robots.txt blocked Bing from ${plural(last.blocked, 'page')}.`);
    }
  } catch (err) {
    lines.push('### Bing');
    lines.push('');
    lines.push(`Could not read it: \`${err.message}\``);
    lines.push('');
  }
}

// --- Google -----------------------------------------------------------------

lines.push('### Google');
lines.push('');

if (!GOOGLE_KEY) {
  lines.push('No `GOOGLE_SERVICE_ACCOUNT_JSON` set, so nothing was read. Add the service account key as a repository secret, and add its address as a user in Search Console.');
  lines.push('');
} else {
  try {
    const property = await googleProperty();
    /* Search Console keeps counting a day for two to three more days, so the week that ended
       three days ago is the last one that will not quietly change between reports. The four
       weeks beside it are there because a small site moves a lot from one week to the next. */
    const startDate = dayAgo(9);
    const endDate = dayAgo(3);
    const monthStart = dayAgo(30);
    const analytics = `sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    const ask = (body, range = { startDate, endDate }) => google(analytics, { ...range, ...body });

    /* One guard per table: a dimension Google has nothing for, or a field that changed shape,
       costs that table and not the rest of the section. */
    const block = async (title, fn) => {
      try {
        await fn();
      } catch (err) {
        lines.push(`${title}: could not read it (\`${err.message}\`)`);
        lines.push('');
      }
    };

    const totals = await ask({ dimensions: [] });
    const month = await ask({ dimensions: [] }, { startDate: monthStart, endDate });
    const row = totals.rows?.[0];
    const mrow = month.rows?.[0];
    const clicks = num(row?.clicks);
    const impressions = num(row?.impressions);
    const position = num(row?.position);
    const rate = ctr(clicks, impressions);
    now.google = { clicks, impressions, position, ctr: rate };
    glance.google = clicks;

    lines.push(`| | ${startDate} to ${endDate} | vs the week before | last 28 days |`);
    lines.push('|---|---|---|---|');
    lines.push(`| Clicks | ${fmt(clicks)} | ${movement(clicks, was.google?.clicks)} | ${fmt(num(mrow?.clicks))} |`);
    lines.push(`| Impressions | ${fmt(impressions)} | ${movement(impressions, was.google?.impressions)} | ${fmt(num(mrow?.impressions))} |`);
    const wasRate = typeof was.google?.ctr === 'number' ? was.google.ctr : (was.google ? ctr(was.google.clicks, was.google.impressions) : null);
    lines.push(`| Click-through rate | ${pct(rate)} | ${rate !== null && wasRate !== null ? movement(rate, wasRate) : 'first week'} | ${pct(ctr(num(mrow?.clicks), num(mrow?.impressions)))} |`);
    lines.push(`| Average position (lower is better) | ${position.toFixed(1)} | ${movement(position, was.google?.position)} | ${num(mrow?.position).toFixed(1)} |`);
    lines.push('');

    /* How much of the site Google shows at all. This API has no index count; the honest weekly
       measure is how many pages were put in front of somebody. Indexing itself is checked for
       a handful of pages further down. */
    let pageRows = [];
    await block('Pages', async () => {
      const pages = await ask({ dimensions: ['page'], rowLimit: 1000 });
      pageRows = pages.rows ?? [];
      const shown = pageRows.length;
      now.googlePages = shown;
      lines.push(`Pages shown in results this week: **${fmt(shown)}**${ofSitemap} (${movement(shown, was.googlePages)}).`);
      lines.push('');
      if (shown > 0 && underCovered(shown)) notes.push(`Google showed ${fmt(shown)} pages${ofSitemap}.`);
    });

    let queryRows = [];
    await block('Queries', async () => {
      const queries = await ask({ dimensions: ['query'], rowLimit: 1000 });
      queryRows = (queries.rows ?? []).map((r) => ({
        query: r.keys?.[0],
        clicks: num(r.clicks),
        impressions: num(r.impressions),
        position: num(r.position),
      })).filter((q) => q.query).sort((a, b) => b.impressions - a.impressions);
      now.gQueries = Object.fromEntries(queryRows.slice(0, 200).map((q) => [q.query, { i: q.impressions, p: q.position }]));
      now.gQueryCount = queryRows.length;

      /* Where on the result page the site is, weighted by what people saw. An average of 6.2
         can be half the queries at the top and half on page two; this says which. */
      const countMove = typeof was.gQueryCount === 'number' ? `, ${movement(queryRows.length, was.gQueryCount)} on last week` : '';
      lines.push(`| Where the site shows up (${fmt(queryRows.length)} queries${countMove}) | Queries | Impressions | Clicks |`);
      lines.push('|---|---|---|---|');
      for (const b of positionBuckets(queryRows)) {
        lines.push(`| ${b.label} | ${fmt(b.queries)} | ${fmt(b.impressions)} | ${fmt(b.clicks)} |`);
      }
      lines.push('');

      if (queryRows.length) {
        lines.push('<details><summary>Top queries</summary>');
        lines.push('');
        lines.push('| Query | Impressions | Clicks | Position (lower is better) |');
        lines.push('|---|---|---|---|');
        for (const q of queryRows.slice(0, 25)) {
          const before = was.gQueries?.[q.query];
          lines.push(`| ${safe(q.query)} | ${delta(q.impressions, before?.i)} | ${fmt(q.clicks)} | ${deltaPos(q.position, before?.p)} |`);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');

        const fresh = queryRows.slice(0, 60).filter((q) => was.gQueries && !was.fromTables && !(q.query in was.gQueries)).slice(0, 15);
        if (fresh.length) {
          lines.push(`**New this week:** ${fresh.map((q) => `\`${q.query}\``).join(', ')}`);
          lines.push('');
        }
      } else {
        lines.push('No queries came back for the week, which is what a property that was added days ago looks like.');
        lines.push('');
      }
    });

    await block('Top pages', async () => {
      const top = [...pageRows].sort((a, b) => num(b.clicks) - num(a.clicks)).slice(0, 10);
      if (!top.length) return;
      lines.push('<details><summary>Top pages by clicks</summary>');
      lines.push('');
      lines.push('| Page | Clicks | Impressions | CTR | Position |');
      lines.push('|---|---|---|---|---|');
      for (const p of top) {
        const url = String(p.keys?.[0] || '').replace(SITE, '') || '/';
        lines.push(`| ${safe(url)} | ${fmt(num(p.clicks))} | ${fmt(num(p.impressions))} | ${pct(ctr(num(p.clicks), num(p.impressions)))} | ${num(p.position).toFixed(1)} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    });

    /* Who the audience is. Search Console gives countries as ISO 3166 alpha-3 codes, printed as
       they come rather than through a lookup table that would be one more thing to be wrong. */
    await block('Countries', async () => {
      const countries = await ask({ dimensions: ['country'], rowLimit: 12 });
      const list = (countries.rows ?? []).sort((a, b) => num(b.clicks) - num(a.clicks));
      if (!list.length) return;
      const total = list.reduce((n, r) => n + num(r.clicks), 0) || 1;
      now.googleCountries = Object.fromEntries(list.map((r) => [r.keys?.[0], num(r.clicks)]));
      lines.push('<details><summary>Countries</summary>');
      lines.push('');
      lines.push('| Country | Clicks | Share of clicks | Impressions | vs last week (clicks) |');
      lines.push('|---|---|---|---|---|');
      for (const r of list) {
        const code = String(r.keys?.[0] || '');
        lines.push(`| ${code.toUpperCase()} | ${fmt(num(r.clicks))} | ${((num(r.clicks) / total) * 100).toFixed(0)}% | ${fmt(num(r.impressions))} | ${movement(num(r.clicks), was.googleCountries?.[code])} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    });

    await block('Devices', async () => {
      const devices = await ask({ dimensions: ['device'] });
      const list = devices.rows ?? [];
      if (!list.length) return;
      lines.push('| Device | Clicks | Impressions | CTR | Position |');
      lines.push('|---|---|---|---|---|');
      for (const r of list.sort((a, b) => num(b.clicks) - num(a.clicks))) {
        const name = String(r.keys?.[0] || '').toLowerCase();
        lines.push(`| ${name} | ${fmt(num(r.clicks))} | ${fmt(num(r.impressions))} | ${pct(ctr(num(r.clicks), num(r.impressions)))} | ${num(r.position).toFixed(1)} |`);
      }
      lines.push('');
    });

    /* Whether the sitemap is being read at all, and whether Google objects to anything in it. */
    await block('Sitemaps', async () => {
      const { sitemap = [] } = await google(`sites/${encodeURIComponent(property)}/sitemaps`);
      if (!sitemap.length) {
        notes.push('Search Console has no sitemap on record for the site.');
        return;
      }
      lines.push('| Sitemap | Last read by Google | Errors | Warnings |');
      lines.push('|---|---|---|---|');
      for (const s of sitemap) {
        lines.push(`| ${safe(String(s.path).replace(SITE, ''))} | ${String(s.lastDownloaded || 'never').slice(0, 10)} | ${fmt(num(Number(s.errors)))} | ${fmt(num(Number(s.warnings)))} |`);
        if (Number(s.errors) > 0) notes.push(`Google reports ${s.errors} error(s) in ${s.path}.`);
      }
      lines.push('');
    });

    /* Indexing, asked page by page for the ones that matter most. The inspection API answers one
       address at a time and is rationed, so this is a spot check, not a census. */
    await block('Indexing', async () => {
      const keyPages = ['/', '/ru/', '/facts/', '/docs/'];
      lines.push('| Page | Indexed | Coverage | Last crawled |');
      lines.push('|---|---|---|---|');
      for (const p of keyPages) {
        try {
          const res = await googleCall('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
            inspectionUrl: `${SITE}${p}`,
            siteUrl: property,
          });
          const r = res.inspectionResult?.indexStatusResult || {};
          const verdict = r.verdict === 'PASS' ? 'yes' : (r.verdict ? r.verdict.toLowerCase() : 'n/a');
          lines.push(`| ${p} | ${verdict} | ${safe(r.coverageState || 'n/a')} | ${String(r.lastCrawlTime || 'n/a').slice(0, 10)} |`);
          if (r.verdict && r.verdict !== 'PASS') notes.push(`Google does not have ${p} indexed: ${r.coverageState || r.verdict}.`);
        } catch (err) {
          lines.push(`| ${p} | n/a | could not inspect (\`${safe(err.message).slice(0, 80)}\`) | |`);
        }
      }
      lines.push('');
    });
  } catch (err) {
    lines.push(`Could not read it: \`${err.message}\``);
    lines.push('');
  }
}

// --- Yandex -----------------------------------------------------------------

lines.push('### Yandex');
lines.push('');

if (!YANDEX_TOKEN) {
  lines.push('No `YANDEX_OAUTH_TOKEN` set, so nothing was read. Add the token as a repository secret and this fills in.');
  lines.push('');
} else {
  try {
    const { userId, hostId } = await yandexHost();
    const host = `user/${userId}/hosts/${encodeURIComponent(hostId)}`;
    const dateFrom = dayAgo(8);
    const dateTo = dayAgo(1);

    /* Numbers that are missing print as n/a rather than as zero. Bing taught this the hard way:
       a field name that does not exist reads as a confident nothing and nobody questions it. */
    const summary = await yandex(`${host}/summary`);
    const cell = (v) => (typeof v === 'number' ? fmt(v) : 'n/a');
    const moved = (v, before) => (typeof v === 'number' ? movement(v, before) : '');
    now.yandex = {
      sqi: summary.sqi,
      inSearch: summary.searchable_pages_count,
      excluded: summary.excluded_pages_count,
    };

    lines.push('| | value | vs last week |');
    lines.push('|---|---|---|');
    lines.push(`| Site quality index | ${cell(summary.sqi)} | ${moved(summary.sqi, was.yandex?.sqi)} |`);
    lines.push(`| Pages in search | ${cell(summary.searchable_pages_count)} | ${moved(summary.searchable_pages_count, was.yandex?.inSearch)} |`);
    lines.push(`| Excluded | ${cell(summary.excluded_pages_count)} | ${moved(summary.excluded_pages_count, was.yandex?.excluded)} |`);
    lines.push('');

    const popular = await yandex(`${host}/search-queries/popular`, {
      order_by: 'TOTAL_SHOWS',
      query_indicator: ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'],
      date_from: dateFrom,
      date_to: dateTo,
      limit: 100,
    });
    const list = (popular.queries ?? []).map((q) => ({
      query: q.query_text,
      impressions: num(q.indicators?.TOTAL_SHOWS),
      clicks: num(q.indicators?.TOTAL_CLICKS),
      position: num(q.indicators?.AVG_SHOW_POSITION),
    })).filter((q) => q.query);

    /* Yandex answers per query, not per site, so this is the sum of what came back and the
       table says so. A hundred queries covers a site this size; the label keeps it honest if
       it ever stops covering it. */
    const shows = list.reduce((n, q) => n + q.impressions, 0);
    const clicks = list.reduce((n, q) => n + q.clicks, 0);
    now.yandexTraffic = { shows, clicks };
    now.yQueries = Object.fromEntries(list.slice(0, 100).map((q) => [q.query, { i: q.impressions, p: q.position }]));
    glance.yandex = clicks;

    lines.push(`| Across the top ${list.length} queries, ${dateFrom} to ${dateTo} | | |`);
    lines.push('|---|---|---|');
    lines.push(`| Impressions | ${fmt(shows)} | ${movement(shows, was.yandexTraffic?.shows)} |`);
    lines.push(`| Clicks | ${fmt(clicks)} | ${movement(clicks, was.yandexTraffic?.clicks)} |`);
    lines.push(`| Click-through rate | ${pct(ctr(clicks, shows))} | |`);
    lines.push('');

    if (list.length) {
      lines.push('<details><summary>Top queries</summary>');
      lines.push('');
      lines.push('| Query | Impressions | Clicks | Position (lower is better) |');
      lines.push('|---|---|---|---|');
      for (const q of list.slice(0, 25)) {
        const before = was.yQueries?.[q.query];
        lines.push(`| ${safe(q.query)} | ${delta(q.impressions, before?.i)} | ${fmt(q.clicks)} | ${deltaPos(q.position, before?.p)} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');

      const fresh = list.slice(0, 40).filter((q) => was.yQueries && !was.fromTables && !(q.query in was.yQueries)).slice(0, 15);
      if (fresh.length) {
        lines.push(`**New this week:** ${fresh.map((q) => `\`${q.query}\``).join(', ')}`);
        lines.push('');
      }
    }

    /* Yandex counts its own problems and grades them itself, so they are worth repeating rather
       than re-deriving: FATAL is the site being dropped, CRITICAL is on its way there. */
    for (const [grade, count] of Object.entries(summary.site_problems ?? {})) {
      const noun = { FATAL: 'fatal problem', CRITICAL: 'critical problem', POSSIBLE_PROBLEM: 'possible problem', RECOMMENDATION: 'recommendation' }[grade]
        || `${grade.toLowerCase().replace(/_/g, ' ')} problem`;
      if (num(count) > 0) notes.push(`Yandex lists ${plural(num(count), noun)} under Diagnostics in its console.`);
    }
    if (typeof summary.searchable_pages_count === 'number' && underCovered(summary.searchable_pages_count)) {
      notes.push(`Yandex holds ${fmt(summary.searchable_pages_count)} pages${ofSitemap}.`);
    }
  } catch (err) {
    lines.push(`Could not read it: \`${err.message}\``);
    lines.push('');
  }
}

if (notes.length) {
  lines.push('### Worth a look');
  lines.push('');
  for (const n of notes) lines.push(`- ${n}`);
  lines.push('');
}

/* The top of the comment is the part a stranger reads. Two sentences, then the detail. */
const head = [`## Search, week of ${now.checkedAt}`, ''];
const visits = ['google', 'bing', 'yandex'].filter((k) => typeof glance[k] === 'number');
if (visits.length || typeof glance.downloads === 'number') {
  const parts = [];
  if (visits.length) {
    const total = visits.reduce((n, k) => n + glance[k], 0);
    parts.push(`Search sent **${fmt(total)}** visits to ${HOST} in the last week (${visits.map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${fmt(glance[k])}`).join(', ')}).`);
  }
  if (typeof glance.downloads === 'number') {
    parts.push(`The app has been downloaded **${fmt(glance.downloads)}** times from GitHub across ${fmt(glance.releases)} releases; the latest is ${glance.latest}.`);
  }
  if (sitemapTotal) parts.push(`The site lists ${fmt(sitemapTotal)} pages.`);
  head.push(parts.join(' '));
  head.push('');
}

const report = [...head, ...reach, ...lines].join('\n');
const withState = `${report}\n${encodeState(now)}\n`;

// Ending by falling off the bottom rather than by process.exit: the sockets fetch leaves open
// are still closing, and killing the process out from under them makes libuv complain.
if (dry) {
  console.log(withState);
} else {
  fs.writeFileSync(OUT, withState);
  fs.writeFileSync(STATE, JSON.stringify(now, null, 0));
  console.log(`wrote ${path.relative(root, OUT)} and ${path.relative(root, STATE)}`);
}
