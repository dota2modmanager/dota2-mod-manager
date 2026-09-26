/**
 * The privacy policy and the terms, taken from the repository when the site is built.
 *
 * The privacy policy is PRIVACY.md and its Russian twin PRIVACY.ru.md, the same text the
 * repository keeps next to the code it describes, so the site never shows a second, older copy.
 * The pages import the Markdown and hand the rendered HTML here. Its links are written for
 * GitHub, relative to the repository root, and are pointed back there; the two privacy files
 * point at each other's page on the site.
 *
 * The terms are still docs/terms/index.html, written in July 2026 for the Discord application,
 * which holds an English and a Russian article. This lifts the one for a language into the site's
 * layout, the way tools/preset-page.mjs carries the preset page over, without its back link,
 * because the site has a header of its own.
 *
 * A heading that goes missing from either source fails the build here, rather than leaving a page
 * without a title on the site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths';
import type { Lang } from '../i18n/ui';

export interface LegalDoc {
  title: string;
  /** A line under the heading, when the source has one (the terms carry their date there). */
  date?: string;
  /** The text without its heading. Our own files, so it is used as HTML. */
  body: string;
  /** The first paragraph as plain text, cut for a meta description. */
  description: string;
}

const REPO = 'https://github.com/dota2modmanager/dota2-mod-manager/blob/main/';
/** Repository files that are pages on the site as well, so a link between them stays on the site. */
const SITE_PAGES: Record<string, string> = {
  'PRIVACY.md': '/privacy/',
  'PRIVACY.ru.md': '/ru/privacy/',
  'docs/code-signing-policy.md': '/code-signing/',
  'docs/code-signing-policy.ru.md': '/ru/code-signing/',
};

/**
 * A repository Markdown file (PRIVACY.md, docs/code-signing-policy.md and their Russian twins),
 * rendered by Astro, made into a page. `source` is its path from the repository root.
 */
export function fromMarkdown(html: string, source: string): LegalDoc {
  const heading = between(html, '<h1', '</h1>');
  const title = textOf(heading.slice(heading.indexOf('>') + 1));
  if (!title) throw new Error(`${source} has no heading`);
  const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const body = cut(html, '<h1', '</h1>')
    // links relative to the file, like [SECURITY.md](../SECURITY.md) from docs/; an address with a
    // scheme (https:, mailto:) or a fragment is left alone
    .replace(/href="([^"]*)"/g, (whole, target: string) => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return whole;
      const url = new URL(target, `https://repo.invalid/${dir}`);
      const file = decodeURIComponent(url.pathname.slice(1));
      return `href="${SITE_PAGES[file] ? SITE_PAGES[file] + url.hash : REPO + file + url.hash}"`;
    })
    .trim();
  // a translation opens by naming the file it translates, which is not what the page is about
  return { title, body, description: describe(body, (text) => !/\b[\w.-]+\.md\b/.test(text)) };
}

/** The terms, from docs/terms/index.html, in one language. */
export function terms(lang: Lang): LegalDoc {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'terms', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const article = new RegExp(`<article data-lang="${lang}">([\\s\\S]*?)</article>`).exec(html);
  if (!article) throw new Error(`docs/terms/index.html has no article for "${lang}"`);
  const title = (/<h1>([^<]+)<\/h1>/.exec(article[1]) || [])[1];
  const date = (/<div class="date">([^<]+)<\/div>/.exec(article[1]) || [])[1];
  if (!title || !date) throw new Error(`docs/terms/index.html (${lang}) lost its heading or its date line`);
  const body = cut(cut(cut(article[1], '<h1>', '</h1>'), '<div class="date">', '</div>'), '<a class="back"', '</a>').trim();
  return { title, date, body, description: describe(body) };
}

/* The first paragraph that suits a description, as plain text of search-result length. The
   Russian privacy file opens by saying it is a translation, which is not what the page is about. */
function describe(body: string, suits: (text: string) => boolean = () => true): string {
  let at = 0;
  for (;;) {
    const from = body.indexOf('<p>', at);
    if (from < 0) return '';
    const to = body.indexOf('</p>', from);
    const text = textOf(body.slice(from + 3, to < 0 ? undefined : to));
    at = to < 0 ? body.length : to;
    if (text && suits(text)) return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, '')}…` : text;
  }
}

/* Known elements of our own files are taken out by position rather than by a pattern. They are
   not markup being cleaned, and a pattern-based removal reads to CodeQL as a sanitizer that could
   leave half a tag behind. */
function cut(html: string, open: string, close: string): string {
  const from = html.indexOf(open);
  if (from < 0) return html;
  const to = html.indexOf(close, from);
  return to < 0 ? html : html.slice(0, from) + html.slice(to + close.length);
}

function between(html: string, open: string, close: string): string {
  const from = html.indexOf(open);
  if (from < 0) return '';
  const to = html.indexOf(close, from);
  return to < 0 ? '' : html.slice(from + open.length, to);
}

/* Plain text: everything between a < and the next > is skipped, so no bracket can survive into
   the result whatever the markup looks like. */
function textOf(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}
