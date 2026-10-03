// A support report laid out as text (src/diagnostics.ts gathers it): the one-screen summary,
// with what is wrong first, and REPORT.md with everything in it.
import type { Report } from './diagnostics.ts';

const bytes = (n: number | null | undefined) => (n == null ? '?' : n > 1024 ** 3
  ? `${(n / 1024 ** 3).toFixed(2)} GB`
  : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/* ---------- the short one ----------
 *
 * One screen, plain sentences, no JSON. It exists because the person who reads these first
 * should not have to open four files to find out whether the game is even where the app
 * thinks it is. If nothing is wrong it says so in the first line, which is the answer most
 * of the time.
 */
/** The one-screen summary: what is wrong first, then the basics. */
export function renderSummary(r: Report): string {
  const L: string[] = [];
  const yn = (v: unknown) => (v ? 'yes' : 'no');
  L.push('DOTA 2 MOD MANAGER - SUPPORT SUMMARY');
  L.push(`Generated ${r.generatedAt}`);
  L.push('');

  const broken = r.problems.filter((p) => p.level === 'broken');
  const notes = r.problems.filter((p) => p.level === 'note');
  if (!broken.length && !notes.length) L.push('NOTHING LOOKS WRONG. Every check below passed.');
  else {
    if (broken.length) {
      L.push(`BROKEN (${broken.length}):`);
      for (const p of broken) L.push(`  ! ${p.what}\n      ${p.detail}`);
    }
    if (notes.length) {
      L.push(`${broken.length ? '\n' : ''}WORTH KNOWING (${notes.length}):`);
      for (const p of notes) L.push(`  - ${p.what}\n      ${p.detail}`);
    }
  }

  L.push('');
  L.push('THE BASICS');
  L.push(`  App version      ${r.app.version} on ${r.app.platform}`);
  L.push(`  Interface        ${r.app.uiLang}`);
  L.push(`  Dota found       ${yn(r.dota.pathValid)}${r.dota.path ? `  (${r.dota.path})` : ''}`);
  L.push(`  Mods folder      dota_${r.settings.langSuffix || '?'}`);
  L.push(`  Game mounts      dota_${r.dota.detectedLang?.suffix || '?'}`);
  L.push(`  Game patched     ${yn(r.patchAndSchema?.patched)}`);
  L.push(`  Dota running     ${yn(r.dotaRunning)}`);
  L.push('');
  L.push('WHAT IS INSTALLED');
  L.push(`  Mods             ${r.library.totalRecords} (${r.library.enabled} on, ${r.library.disabled} off)`);
  L.push(`  Packs            ${r.library.packs}`);
  L.push(`  Presets          ${r.library.presets}`);
  L.push(`  Overruled        ${r.library.fileOverlaps ?? '?'}`);
  const cats = Object.entries(r.library.byCategory || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (cats.length) L.push(`  By category      ${cats.map(([c, n]) => `${c} ${n}`).join(', ')}`);
  L.push('');
  L.push('STORAGE');
  L.push(`  Download cache   ${bytes(r.caches.downloadCacheBytes)}`);
  L.push(`  Icon cache       ${bytes(r.caches.iconCacheBytes)}`);
  if (r.disk) L.push(`  Free on drive    ${bytes(r.disk.freeBytes)}`);
  L.push('');
  L.push('Everything above, in full, is in REPORT.md. Send that one to the developer.');
  return L.join('\n');
}

/* ---------- the long one ----------
 *
 * The same data with nothing left out, laid out to be read rather than parsed: whoever is
 * looking at this is trying to work out what happened, and JSON makes that harder than a
 * heading and a table. report.json is still in the zip for anything that wants the raw shape.
 */
/** Everything in the report, laid out to be read: REPORT.md. */
export function renderDetailed(r: Report, files: Record<string, string> = {}): string {
  const L: string[] = [];
  const block = (title: string, obj: unknown) => {
    L.push(`## ${title}`, '', '```json', JSON.stringify(obj, null, 2), '```', '');
  };

  L.push(`# Diagnostic report - Dota 2 Mod Manager ${r.app.version}`, '');
  L.push(`Generated ${r.generatedAt}`, '');

  L.push('## Verdicts', '');
  if (!r.problems.length) L.push('Every check passed.', '');
  for (const p of r.problems) L.push(`- **${p.level === 'broken' ? 'BROKEN' : 'note'}** - ${p.what}. ${p.detail}`);
  L.push('');

  block('App and system', r.app);
  block('Settings', r.settings);
  block('Dota', r.dota);
  block('Patch and item table', r.patchAndSchema);
  block('Library', r.library);
  block('Catalog cache', r.catalogCache);
  block('Caches and disk', { ...r.caches, disk: r.disk });
  block('Download mirrors', r.mirrors);
  if (r.windows) block('Windows', r.windows);
  if (r.displays) block('Displays', r.displays);
  if (r.gpu) block('Graphics card', r.gpu);
  if (r.rendererErrors) block('Errors reported by the interface', r.rendererErrors);
  if (r.updater) block('Updater', r.updater);
  if (r.remoteConfig) block('Remote config', r.remoteConfig);
  if (r.toolchain) block('Source 2 toolchain', r.toolchain);
  if (r.installedMods) {
    L.push('## Installed mods', '', '| # | slot | on | category | name |', '|---|---|---|---|---|');
    for (const m of r.installedMods) {
      L.push(`| ${m.i} | ${m.slot ?? '-'} | ${m.enabled ? 'on' : 'off'} | ${m.categoryId || '-'} | ${String(m.name).replace(/\|/g, '/')} |`);
    }
    L.push('');
  }

  const names = Object.keys(files);
  if (names.length) {
    L.push('## Files in this archive', '');
    for (const n of names) L.push(`- \`${n}\` (${bytes(Buffer.byteLength(files[n], 'utf-8'))})`);
    L.push('');
  }
  return L.join('\n');
}
