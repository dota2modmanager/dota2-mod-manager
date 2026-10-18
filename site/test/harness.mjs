/**
 * What the site's browser tests and tools/look.mjs share: a server over dist/, a browser, the
 * two screens the site is read on, and the checks that need a real layout to answer.
 *
 * The site had a build check (tools/check-build.mjs) and nothing that ever opened a page. The
 * download menu at the foot of the landing then shipped cut in half by the panel it sits in,
 * with the line under the button painted across it, and the only way anybody found out was by
 * pressing it. Everything here exists to press things.
 *
 * The browser is the one already on the machine, not one downloaded for the tests: Chrome, or
 * Edge where there is no Chrome, or whatever SITE_BROWSER points at. GitHub's Ubuntu runners
 * carry Chrome, Windows always has Edge, and playwright-core is the driver without the 150 MB
 * of browsers the full package fetches on install.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(SITE, 'dist');
export const OUT = path.join(SITE, 'test-output');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.sig': 'application/octet-stream',
};

/**
 * Serve dist/ the way Cloudflare Pages does for this site: a folder answers with its
 * index.html, anything missing gets 404.html with a 404. Port 0 picks a free one.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function serveDist(dir = DIST) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`no built site in ${dir}: run npm run build in site/ first`);
  }
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, rel);
    // nothing outside dist/, whatever the request says
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        res.writeHead(308, { Location: `${rel}/` }).end();
        return;
      }
      if (err) {
        res.writeHead(404, { 'Content-Type': TYPES['.html'] });
        fs.createReadStream(path.join(dir, '404.html')).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

/** Chrome, then Edge, unless SITE_BROWSER names an executable. */
export async function launch() {
  const exe = process.env.SITE_BROWSER;
  if (exe) return chromium.launch({ executablePath: exe });
  const tried = [];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      tried.push(`${channel}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error(`no browser to test the site in. Install Chrome or set SITE_BROWSER.\n${tried.join('\n')}`);
}

/**
 * The two ways the site is read. The phone is an Android one on purpose: the download menu marks
 * the file for the reader's system, and an Android phone must be marked as neither Windows nor
 * Linux even though its user agent says Linux.
 */
export const SCREENS = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
};

/**
 * A page with everything that can go wrong on it written down: console errors, uncaught
 * exceptions, requests to this site that failed, and content security policy refusals, which
 * the browser only reports to the console. Requests to anywhere else are refused so the tests
 * never depend on GitHub or YouTube being up; `online` lets tools/look.mjs see the real thing.
 */
export async function openPage(browser, base, screen, { motion = 'no-preference', online = false } = {}) {
  const context = await browser.newContext({ ...SCREENS[screen], reducedMotion: motion });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(base) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) {
      problems.push(`request failed: ${r.url().slice(base.length)} (${r.failure()?.errorText})`);
    }
  });
  page.on('response', (r) => {
    if (r.url().startsWith(base) && r.status() >= 400 && r.request().resourceType() !== 'document') {
      problems.push(`${r.status()}: ${r.url().slice(base.length)}`);
    }
  });
  if (!online) {
    // the web only: the preset page's d2mm:// is the browser's to refuse, and refusing it here
    // cancelled the page's own load
    await context.route((url) => /^https?:/.test(url.href) && !url.href.startsWith(base), (route) => route.abort('blockedbyclient'));
  }
  return { context, page, problems };
}

/**
 * Console noise from refusing the outside world, which is the harness's doing and not the page's.
 */
export const isOffline = (line) => /ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/.test(line);

/** Every page the build wrote, as site paths: "/", "/docs/vpk/", "/404.html". */
export function builtPages(dir = DIST) {
  const pages = [];
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const p = String(rel).split(path.sep).join('/');
    if (!p.endsWith('.html')) continue;
    pages.push(p === 'index.html' ? '/' : p.endsWith('/index.html') ? `/${p.slice(0, -'index.html'.length)}` : `/${p}`);
  }
  return pages.sort();
}

/**
 * One page of each kind the site has, in both languages. A hero page and a catalog page are the
 * same template 120 and 37 times over, so the first of each stands for the rest; the guides are
 * all different and all listed.
 */
export function samplePages(dir = DIST) {
  const all = builtPages(dir);
  const first = (prefix) => all.find((p) => p.startsWith(prefix) && p !== prefix && p.split('/').length === prefix.split('/').length + 1);
  const en = [
    '/', '/docs/', '/catalog/', '/heroes/', '/facts/', '/transparency/', '/privacy/', '/terms/', '/code-signing/',
    first('/heroes/'), first('/catalog/'),
    ...all.filter((p) => /^\/docs\/[^/]+\/$/.test(p)),
  ].filter(Boolean);
  return [...en, ...en.map((p) => `/ru${p}`).filter((p) => all.includes(p)), '/p/', '/404.html'];
}

/**
 * Things on the page that stick out past the screen's edge. `overflow-x: clip` on <body> and on
 * the footer hides the scrollbar such a thing would cause, which is exactly why this has to look
 * for it: on a phone the text is simply cut off and nothing says so. The footer's last three
 * links spent months like that. Being inside something that scrolls sideways (a wide table, the
 * code blocks) is fine, since a thumb can reach it; being inside something that merely clips is
 * not. Decoration nobody reads (aria-hidden) does not count.
 */
export function findOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll') {
          const r = a.getBoundingClientRect();
          return r.left >= -1 && r.right <= vw + 1;
        }
      }
      return false;
    };
    for (const el of document.body.querySelectorAll('*')) {
      // the skip link waits off the left edge until it is focused, on purpose
      if (el.closest('[aria-hidden="true"]') || el.matches('.skip:not(:focus)')) continue;
      // inside a closed <details> a menu still has a box, but nobody sees it
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (clipped(el)) continue;
      const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].join('.')}` : '');
      out.push(`${name} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
    }
    // the innermost offender is the one to fix; its ancestors only stick out because it does
    return out.slice(-8);
  });
}

/**
 * Whether each element is the thing a click at its middle would land on. A menu that is drawn
 * under a neighbour, cut off by its container or off the screen fails this, and a visual check
 * on a screenshot is how that went unnoticed.
 * @returns {Promise<string[]>} one line per element that something else covers
 */
export function findCovered(page, selector) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      // left out on purpose at this width (display: none), which is not the same as covered
      if (!el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { out.push(`${sel} has no size`); continue; }
      const x = r.left + r.width / 2;
      const y = r.top + Math.min(r.height / 2, 12);
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        out.push(`"${el.textContent.trim().slice(0, 40)}" is off screen at ${Math.round(x)},${Math.round(y)}`);
        continue;
      }
      const top = document.elementFromPoint(x, y);
      if (top !== el && !el.contains(top)) {
        const who = top ? top.tagName.toLowerCase() + (top.className ? `.${String(top.className).trim().replace(/\s+/g, '.')}` : '') : 'nothing';
        out.push(`"${el.textContent.trim().slice(0, 40)}" is under ${who}`);
      }
    }
    return out;
  }, selector);
}

/**
 * Card grids whose last row is one card left at the left edge. The landing's seven cards made
 * three, three and one; the one is supposed to sit in the middle of its row.
 * @returns {Promise<string[]>}
 */
export function findLoneCards(page) {
  return page.evaluate(() => {
    const out = [];
    for (const grid of document.querySelectorAll('.cards')) {
      const items = [...grid.children].filter((c) => c.checkVisibility());
      const rows = new Map();
      for (const c of items) {
        const top = Math.round(c.getBoundingClientRect().top);
        rows.set(top, [...(rows.get(top) ?? []), c]);
      }
      const sizes = [...rows.values()].map((r) => r.length);
      if (sizes.length < 2 || sizes.at(-1) !== 1 || Math.max(...sizes) < 2) continue;
      const g = grid.getBoundingClientRect();
      const r = [...rows.values()].at(-1)[0].getBoundingClientRect();
      const off = Math.round(r.left + r.width / 2 - (g.left + g.width / 2));
      if (Math.abs(off) > 2) out.push(`a grid of ${items.length} leaves its last card ${off} px off the middle`);
    }
    return out;
  });
}

/** A screenshot named for the test that failed, so a red run in CI comes with a picture. */
export async function snap(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name.replace(/[^a-z0-9-]+/gi, '_')}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}
