/* The changelog section for one version, for the "What's new" window.
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

/**
 * The notes for `version` in the interface's language when there is a translation.
 * @param appPath  where the build's files are (app.getAppPath())
 * @returns markdown, or null when this version has no section anywhere
 */
export function releaseNotes(version: string, lang: string, appPath: string): string | null {
  const files = lang === 'ru' ? ['CHANGELOG.ru.md', 'CHANGELOG.md'] : ['CHANGELOG.md'];
  for (const name of files) {
    let text: string;
    try { text = fs.readFileSync(path.join(appPath, name), 'utf-8'); } catch { continue; }
    const body = changelogSection(text, version);
    if (body) return body;
  }
  return null;
}
