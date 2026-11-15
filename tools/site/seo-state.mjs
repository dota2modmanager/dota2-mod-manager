/**
 * What the weekly search report remembers, and where it keeps it.
 *
 * The report compares every number with last week's, and for a month it compared nothing: every
 * row said "first week". The workflow saved the numbers to the Actions cache and had no step that
 * ever restored them, and even a restore would have missed - GitHub evicts a cache nobody has
 * touched for seven days, and the report runs every seven days, so the entry is gone by the time
 * the next run looks for it.
 *
 * So the numbers now travel inside the comment itself, as a compressed block in an HTML comment
 * at the end. The issue is already the history; the state becomes part of it, never expires, and
 * costs no commit. The next run reads the newest report and takes its block.
 *
 * Reports posted before the block existed have none, so for them the headline numbers are read
 * back out of their own tables. That is the only reason the table parser exists, and it only
 * needs to be right about the rows this script itself writes.
 */
import zlib from 'node:zlib';

const MARK = 'seo-state:v1';

/** The state as a comment line nobody reading the issue will see. */
export function encodeState(state) {
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(state))).toString('base64');
  return `<!-- ${MARK} ${packed} -->`;
}

/** The state out of a report that carries the block, or null. */
export function decodeState(body) {
  const m = /<!--\s*seo-state:v1\s+([A-Za-z0-9+/=]+)\s*-->/.exec(String(body || ''));
  if (!m) return null;
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.from(m[1], 'base64')).toString('utf8'));
  } catch {
    return null;
  }
}

/** "14,311" and "1,240 (+180)" both mean the first number. */
const firstNumber = (cell) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(cell || ''));
  return m ? Number(m[0].replace(/,/g, '')) : undefined;
};

/** The text between one "### Name" heading and the next. */
function section(body, name) {
  const parts = String(body || '').split(/^### /m);
  const hit = parts.find((p) => p.startsWith(`${name}\n`) || p.startsWith(`${name}\r\n`));
  return hit || '';
}

/** Rows of every markdown table in a block, as arrays of trimmed cells. */
function rows(block) {
  return block.split(/\r?\n/)
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

const cellOf = (table, label) => {
  const row = table.find((r) => r[0] === label || r[0].startsWith(`${label} (`));
  return row ? firstNumber(row[1]) : undefined;
};

/** Query rows inside a "Top queries" fold: query, impressions, clicks, position. */
function queries(block) {
  const fold = /<details><summary>Top queries<\/summary>([\s\S]*?)<\/details>/.exec(block);
  if (!fold) return undefined;
  const out = {};
  for (const r of rows(fold[1])) {
    if (r.length < 4 || r[0] === 'Query') continue;
    const i = firstNumber(r[1]);
    const p = firstNumber(r[3]);
    if (i !== undefined && p !== undefined) out[r[0]] = { i, p };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The headline numbers of a report written before the state block, read off its tables.
 * Anything a row does not say is left out rather than guessed, so it compares as "first week".
 */
export function stateFromTables(body) {
  const text = String(body || '');
  if (!/^## Search, week of/m.test(text)) return null;
  const state = {};

  const bing = section(text, 'Bing');
  if (bing) {
    const t = rows(bing);
    const clicks = cellOf(t, 'Clicks');
    const impressions = cellOf(t, 'Impressions');
    if (clicks !== undefined && impressions !== undefined) state.bing = { clicks, impressions };
    const inIndex = cellOf(t, 'In the index');
    if (inIndex !== undefined) state.bingIndex = inIndex;
    const crawled = cellOf(t, 'Pages crawled in 7 days');
    if (crawled !== undefined) state.bingCrawled = crawled;
    const q = queries(bing);
    if (q) state.queries = q;
  }

  const google = section(text, 'Google');
  if (google) {
    const t = rows(google);
    const clicks = cellOf(t, 'Clicks');
    const impressions = cellOf(t, 'Impressions');
    const position = cellOf(t, 'Average position');
    if (clicks !== undefined && impressions !== undefined) {
      state.google = { clicks, impressions, ...(position !== undefined ? { position } : {}) };
    }
    const pages = /Pages shown in results this week: \*\*([\d,]+)\*\*/.exec(google);
    if (pages) state.googlePages = Number(pages[1].replace(/,/g, ''));
    const q = queries(google);
    if (q) state.gQueries = q;
  }

  const yandex = section(text, 'Yandex');
  if (yandex) {
    const t = rows(yandex);
    const sqi = cellOf(t, 'Site quality index');
    const inSearch = cellOf(t, 'Pages in search');
    const excluded = cellOf(t, 'Excluded');
    if (sqi !== undefined || inSearch !== undefined) state.yandex = { sqi, inSearch, excluded };
    const shows = cellOf(t, 'Impressions');
    const clicks = cellOf(t, 'Clicks');
    if (shows !== undefined && clicks !== undefined) state.yandexTraffic = { shows, clicks };
    const q = queries(yandex);
    if (q) state.yQueries = q;
  }

  // Marked, because those tables held 25 queries picked by clicks: next to a list of 60 picked by
  // impressions, most of the difference is the cut and not the week, so "new this week" stays quiet.
  return Object.keys(state).length ? { ...state, fromTables: true } : null;
}

/** Last week's numbers from last week's report, whichever way it kept them. */
export function previousState(body) {
  return decodeState(body) || stateFromTables(body) || {};
}

/** Click-through rate as a percentage with one decimal, or null when nothing was shown. */
export function ctr(clicks, impressions) {
  if (!impressions) return null;
  return Math.round((clicks / impressions) * 1000) / 10;
}

/**
 * How the queries are spread over the result page. An average position of 6.2 can be ten
 * queries at 1 and ten at 11; the buckets say which, weighted by what people actually saw.
 */
export function positionBuckets(list) {
  const buckets = [
    { label: 'Top 3', upTo: 3.5 },
    { label: '4 to 10 (page one)', upTo: 10.5 },
    { label: '11 to 20 (page two)', upTo: 20.5 },
    { label: '21 and below', upTo: Infinity },
  ].map((b) => ({ ...b, queries: 0, impressions: 0, clicks: 0 }));
  for (const q of list || []) {
    const b = buckets.find((x) => (q.position || 0) < x.upTo);
    b.queries++;
    b.impressions += q.impressions || 0;
    b.clicks += q.clicks || 0;
  }
  return buckets.map(({ upTo, ...b }) => b);
}

/**
 * Bing's query stats as one week. The API answers with a row per query per week going back
 * months, so the same query arrives several times, and the first report printed "dota 2 mods"
 * four times with a different number each. Only the latest seven days count; a query that
 * appears twice inside them is added up, its position weighted by how often each row was shown.
 */
export function latestWeekOfQueries(rows) {
  const dated = (rows || []).filter((r) => r.query && r.date);
  const latest = dated.reduce((m, r) => (r.date > m ? r.date : m), '');
  if (!latest) return [];
  const from = new Date(Date.parse(latest) - 6 * 86400000).toISOString().slice(0, 10);
  const byQuery = new Map();
  for (const r of dated) {
    if (r.date < from) continue;
    const acc = byQuery.get(r.query) || { query: r.query, clicks: 0, impressions: 0, weighted: 0 };
    acc.clicks += r.clicks || 0;
    acc.impressions += r.impressions || 0;
    acc.weighted += (r.position || 0) * (r.impressions || 0);
    byQuery.set(r.query, acc);
  }
  return [...byQuery.values()]
    .map(({ weighted, ...q }) => ({ ...q, position: q.impressions ? weighted / q.impressions : 0 }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** How many addresses a sitemap lists. */
export function countLocs(xml) {
  return (String(xml || '').match(/<loc>/g) || []).length;
}
