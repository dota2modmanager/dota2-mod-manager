/**
 * The changelog as a page (/changes/): CHANGELOG.md and CHANGELOG.ru.md, read when the site is
 * built, which are the same files the app's "What's new" window and every GitHub release show.
 * Nobody writes this page; a release writes it.
 *
 * Only released versions appear. A section is written in the release PR, which lands on main a
 * few minutes before its tag, and the site deploys on every push to main, so a section for a
 * version still waiting for its tag would otherwise be on the page first. The newest published
 * release on GitHub is the cut-off, and its dates come from the same answer. A build with no
 * network falls back to the version in package.json and prints no dates.
 *
 * The markdown is only ever the shapes the changelog uses, the same ones the app renders
 * (renderer/ui/notes-markdown.ts): "### heading", "- bullet", paragraphs split by a blank line,
 * **bold** and `code` inside a line, plus the odd [link](https://...). Everything is escaped
 * before any of it becomes a tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths';
import { appVersion } from './schema';
import type { Lang } from '../i18n/ui';

const RELEASES = 'https://api.github.com/repos/dota2modmanager/dota2-mod-manager/releases?per_page=100';

export interface Release {
  version: string;
  /** "v2-14-0": the anchor, a dot-free id */
  id: string;
  /** when GitHub published it, or null for a build that could not ask */
  date: string | null;
  html: string;
  /** the language the notes are in: a Russian page falls back to English for a missing section */
  lang: Lang;
  /** its ### headings as plain text, the ones about something new first: an older release
      folded on the page is summed up by them */
  topics: string[];
}

/* the headings every release has; they say nothing about what this one brought */
const ROUTINE = /^(fixed|fixes|thanks|smaller things|исправлено|спасибо|по мелочи)$/i;

export function topicsOf(md: string): string[] {
  const all = [...md.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].replace(/\*\*|`/g, '').trim());
  return [...all.filter((h) => !ROUTINE.test(h)), ...all.filter((h) => ROUTINE.test(h))];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One section's markdown as HTML. A ### heading becomes an h3, under the page's h2 per version. */
export function notesHtml(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  const out: string[] = [];
  let list: string[] | null = null;
  let para = false;
  const closeList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); para = false; continue; }
    if (line.startsWith('###')) { closeList(); para = false; out.push(`<h3>${inline(line.replace(/^#+\s*/, ''))}</h3>`); continue; }
    if (line.startsWith('- ')) { para = false; (list ||= []).push(`<li>${inline(line.slice(2))}</li>`); continue; }
    // a wrapped bullet or paragraph line continues whatever came before it
    if (list) list[list.length - 1] = list[list.length - 1].replace(/<\/li>$/, ` ${inline(line)}</li>`);
    else if (para) out[out.length - 1] = out[out.length - 1].replace(/<\/p>$/, ` ${inline(line)}</p>`);
    else { out.push(`<p>${inline(line)}</p>`); para = true; }
  }
  closeList();
  return out.join('');
}

/**
 * "## 2.14.0" sections, in the file's order (newest first), and the paragraph above the first.
 * A beta's section ("## 2.8.0-beta.1") ends the one before it and is left out: a beta went to a
 * few testers, and the release that followed it says what everybody got.
 */
export function parseChangelog(text: string): { intro: string; sections: Array<{ version: string; body: string }> } {
  const parts = text.replace(/\r\n/g, '\n').split(/^## (\S+)[ \t]*$/m);
  const intro = parts[0].replace(/^# .*$/m, '').trim();
  const sections = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (/^\d+\.\d+\.\d+$/.test(parts[i])) sections.push({ version: parts[i], body: parts[i + 1].trim() });
  }
  return { intro, sections };
}

const num = (v: string) => v.split('.').map(Number);
/** -1, 0 or 1, as a sort would want: 2.10.0 is newer than 2.9.0 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Version -> publication date, for every published stable release; null when GitHub is out of reach. */
let published: Promise<Map<string, string> | null> | null = null;
function publishedReleases() {
  published ||= fetch(RELEASES, { headers: { 'User-Agent': 'dota2modmanager-site' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      if (!Array.isArray(list)) return null;
      const out = new Map<string, string>();
      for (const r of list) {
        const v = /^v(\d+\.\d+\.\d+)$/.exec(String(r?.tag_name ?? ''))?.[1];
        if (v && !r.draft && !r.prerelease && r.published_at) out.set(v, r.published_at);
      }
      return out.size ? out : null;
    })
    .catch(() => null);
  return published;
}

const read = (name: string) => fs.readFileSync(path.join(REPO_ROOT, name), 'utf-8');

/** The page's releases in a language, newest first, and the changelog's own first paragraph. */
export async function releases(lang: Lang): Promise<{ intro: string; list: Release[] }> {
  const en = parseChangelog(read('CHANGELOG.md'));
  const own = lang === 'ru' ? parseChangelog(read('CHANGELOG.ru.md')) : en;
  const ownBody = new Map(own.sections.map((s) => [s.version, s.body]));
  const dates = await publishedReleases();
  const newest = dates ? [...dates.keys()].sort(compareVersions).at(-1)! : appVersion();
  const list = en.sections
    .filter((s) => compareVersions(s.version, newest) <= 0)
    .map((s) => {
      const body = ownBody.get(s.version);
      return {
        version: s.version,
        id: `v${s.version.replace(/\./g, '-')}`,
        date: dates?.get(s.version) ?? null,
        html: notesHtml(body ?? s.body),
        lang: body ? lang : ('en' as Lang),
        topics: topicsOf(body ?? s.body),
      };
    });
  return { intro: own.intro, list };
}
