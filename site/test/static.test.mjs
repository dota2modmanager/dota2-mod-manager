/**
 * The built pages read as files, without a browser: every link lands on a page that exists,
 * every page says what it is, and every page has its twin in the other language.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, builtPages } from './harness.mjs';

const SITE = 'https://dota2modmanager.com';
const pages = builtPages();
const html = new Map(pages.map((p) => [p, fs.readFileSync(path.join(DIST, p.endsWith('/') ? `${p}index.html` : p), 'utf-8')]));

/** The site path a link points at, or null when it leaves the site. */
function local(href, from) {
  if (/^(mailto:|tel:|data:|javascript:)/.test(href)) return null;
  if (/^https?:\/\//.test(href) && !href.startsWith(`${SITE}/`)) return null;
  const u = new URL(href, `${SITE}${from}`);
  return { path: decodeURIComponent(u.pathname), hash: decodeURIComponent(u.hash.slice(1)) };
}

/** Whether a site path is something the build wrote: a page, or a file next to them. */
function exists(p) {
  if (html.has(p)) return true;
  const file = path.join(DIST, p);
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

const ids = (body) => new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('every link on the site lands on something the build wrote', () => {
  const broken = [];
  for (const [from, body] of html) {
    const refs = [
      ...[...body.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]),
      ...[...body.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])),
      ...[...body.matchAll(/<meta property="og:image" content="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !ids(body).has(ref.slice(1))) broken.push(`${from}: ${ref} names no element on the page`);
        continue;
      }
      const to = local(ref.replaceAll('&amp;', '&'), from);
      if (!to) continue;
      if (!exists(to.path)) { broken.push(`${from}: ${ref}`); continue; }
      if (to.hash && html.has(to.path) && !ids(html.get(to.path)).has(to.hash)) {
        broken.push(`${from}: ${ref} names no element on ${to.path}`);
      }
    }
  }
  assert.deepEqual([...new Set(broken)].slice(0, 30), []);
});

test('every page says what it is: language, title, description, one heading', () => {
  const bad = [];
  for (const [p, body] of html) {
    if (p.startsWith('/mirror/')) continue;
    if (!/<html lang="(en|ru)"/.test(body)) bad.push(`${p}: no lang on <html>`);
    if (!/<title>[^<]{3,}<\/title>/.test(body)) bad.push(`${p}: no title`);
    // a page kept out of search (the shared-build page) has no snippet to describe
    const listed = !/<meta name="robots" content="noindex/.test(body);
    if (listed && !/<meta name="description" content="[^"]{20,}"/.test(body)) bad.push(`${p}: no description`);
    const h1 = body.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1 !== 1) bad.push(`${p}: ${h1} <h1>`);
    if (!/<meta name="viewport"/.test(body)) bad.push(`${p}: no viewport`);
  }
  assert.deepEqual(bad.slice(0, 30), []);
});

test('no id is used twice on one page', () => {
  const bad = [];
  for (const [p, body] of html) {
    const seen = new Set();
    for (const [, id] of body.matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(id)) bad.push(`${p}: #${id}`);
      seen.add(id);
    }
  }
  assert.deepEqual(bad.slice(0, 30), []);
});

test('every picture has words for a screen reader and a size for the layout', () => {
  const bad = [];
  for (const [p, body] of html) {
    for (const [tag] of body.matchAll(/<img\b[^>]*>/g)) {
      const src = /\ssrc="([^"]+)"/.exec(tag)?.[1] ?? '?';
      if (!/\salt="/.test(tag)) bad.push(`${p}: ${src} has no alt`);
      // a picture without its size is a page that jumps as it loads
      if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) bad.push(`${p}: ${src} has no width and height`);
    }
  }
  assert.deepEqual(bad.slice(0, 30), []);
});

test('every English page has a Russian twin and the other way round', () => {
  const solo = ['/404.html', '/p/'];
  const en = pages.filter((p) => !p.startsWith('/ru/') && !solo.includes(p) && !p.startsWith('/mirror/'));
  const ru = pages.filter((p) => p.startsWith('/ru/'));
  const missing = [
    ...en.filter((p) => !html.has(`/ru${p}`)).map((p) => `no /ru${p}`),
    ...ru.filter((p) => !html.has(p.slice(3))).map((p) => `no ${p.slice(3)}`),
  ];
  assert.deepEqual(missing, []);
});

test('a page in one language links to its own twin from the header', () => {
  const bad = [];
  for (const [p, body] of html) {
    const m = /<a class="lang" href="([^"]+)"/.exec(body);
    if (!m) continue;
    const to = local(m[1], p);
    if (!to || !html.has(to.path)) bad.push(`${p}: the language switch goes to ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});
