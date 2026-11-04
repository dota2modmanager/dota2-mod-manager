/* The changelog for the "What's new" window and Home.
 *
 * Not only the version now running: a fix shipped an hour after a big release would otherwise
 * replace that release's notes before anybody had read them. So the notes run from the start of
 * this line (3.0.0 for 3.0.1, 3.1.0 for 3.1.2) up to now, newest first, and further back to the
 * version the user last saw, for whoever skipped a few. Each version under its own heading once
 * there is more than one.
 *
 * The same files CI puts on the release page ship inside the build (package.json, build.files),
 * so the window works offline and needs no GitHub call. A Russian interface reads
 * CHANGELOG.ru.md first and falls back to the English one for a version it has no section for.
 *
 * A heading is "## <version>" followed by anything that cannot continue a version, so "2.8.0"
 * does not find "## 2.8.0-beta.1". release.yml and tools/release-state.js look sections up the
 * same way, and test/release-contract.test.js holds the three to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cmpVersion } from './remote-config-format.ts';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The section's text for `version` out of one changelog, or null when it has none. */
export function changelogSection(text: string, version: string): string | null {
  const head = new RegExp(`^## ${escapeRe(version)}(?:[^-0-9A-Za-z.].*)?$`, 'm');
  const m = head.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim() || null;
}

/** The release versions a changelog has a heading for, betas left out. */
export function changelogVersions(text: string): string[] {
  return [...text.matchAll(/^## (\d+\.\d+\.\d+)(?:[^-0-9A-Za-z.].*)?$/gm)].map((m) => m[1]);
}

/** The versions whose notes go with `version`: its line from x.y.0, and anything newer than `seen`. */
export function notesRange(versions: string[], version: string, seen: string | null): string[] {
  const [major, minor] = version.split('.');
  const lineStart = `${major}.${minor}.0`;
  const wanted = versions.filter((v) => cmpVersion(v, version) <= 0
    && (cmpVersion(v, lineStart) >= 0 || (seen != null && cmpVersion(v, seen) > 0)));
  // the running version even when it is a beta, which changelogVersions leaves out; newest first
  const all = [...new Set([...(versions.includes(version) ? [] : [version]), ...wanted])];
  return all.sort((a, b) => cmpVersion(b, a));
}

/**
 * The notes for `version` in the interface's language when there is a translation, with the
 * versions before it that go with it (notesRange), each under "## <version>" when there are several.
 * @param appPath  where the build's files are (app.getAppPath())
 * @param seen     the version whose notes the user saw last, or null
 * @returns markdown, or null when this version has no section anywhere
 */
export function releaseNotes(version: string, lang: string, appPath: string, seen: string | null = null): string | null {
  const files = (lang === 'ru' ? ['CHANGELOG.ru.md', 'CHANGELOG.md'] : ['CHANGELOG.md']).map((name) => {
    try { return fs.readFileSync(path.join(appPath, name), 'utf-8'); } catch { return ''; }
  });
  const section = (v: string) => files.map((text) => changelogSection(text, v)).find(Boolean) || null;
  if (!section(version)) return null;
  const parts = notesRange(changelogVersions(files.at(-1) || ''), version, seen)
    .map((v) => [v, section(v)] as const).filter(([, body]) => body);
  return parts.length === 1 ? parts[0][1] : parts.map(([v, body]) => `## ${v}\n\n${body}`).join('\n\n');
}
