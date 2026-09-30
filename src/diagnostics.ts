// A support report a user can send instead of a round of screenshots: Dota's own path and
// language settings, the app's settings and installed mods, the patch/schema state, a
// listing of the mod folder's pak files, and the app's own recent log.
//
// Pure data in, pure data out - no Electron here, no zip - so src/ipc-diagnostics.ts decides how
// it is packaged (the diag:export handler) and this stays exercisable on its own.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as gamelang from './gamelang.ts';
import { validateGamePath } from './steam.ts';
import { mirrorHealth } from './net.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';
import type { Catalog } from './catalog.ts';
import type { Icons } from './icons.ts';
import type { SchemaState } from './schema-service.ts';
import type { LibFile, LibRecord } from './types.ts';

/** One thing the report says is wrong, and what to do about it. Two levels on purpose; see findProblems. */
export interface Problem { level: 'broken' | 'note'; what: string; detail: string }

/** What of the installer a report asks: which mods are overruled, the download cache, a record's slot. */
export interface ReportInstaller {
  coverage(mods: { key: string; name: string; files: LibFile[] }[]): { size: number };
  downloadCacheSize(): number;
  slotNumber(rec: LibRecord): number | null;
}

/** The patch and item-table state, as the schema service reports it, or why it could not be read. */
type PatchState = Partial<SchemaState>;

/** Facts only the main process can answer, handed in so this module stays free of Electron. */
export interface ReportExtra {
  dotaRunning?: boolean; windows?: unknown; rendererErrors?: unknown; updater?: unknown;
  remoteConfig?: unknown; toolchain?: unknown; displays?: unknown; gpu?: unknown;
}

/** The support report: what report.json holds, and what the two renderings read. */
export interface Report {
  generatedAt: string;
  app: { version: string; platform: string; electron?: string; chrome?: string; node: string; uiLang: string };
  settings: Record<string, unknown> & { langSuffix?: string | null; dotaGamePath: string | null };
  dota: {
    path: string | null; pathValid: boolean;
    detectedLang: gamelang.LangDetection | null;
    bootLanguages: { ui: string | null; audio: string | null } | null;
    steamLanguage: string | null;
    langFolders: gamelang.LangFolder[];
    activeVoiceInstalled: boolean;
    minifyDetected: boolean;
  };
  patchAndSchema: PatchState | null;
  /** the same shape net.ts keeps, so a check here cannot read a field it does not have */
  mirrors: ReturnType<typeof mirrorHealth>;
  library: {
    totalRecords: number; byCategory: Record<string, number>; enabled: number; disabled: number;
    packs: number; withSchemaEdits: number; presets: number; fileOverlaps: number | null;
  };
  catalogCache: { fetchedAt: number | null };
  caches: { downloadCacheBytes: number | null; iconCacheBytes: number | null };
  disk: { freeBytes: number; totalBytes: number } | null;
  installedMods: { i: number; slot: number | null; name: string; categoryId: string | null; enabled: boolean; kind: string; files: number }[];
  dotaRunning: boolean;
  windows: unknown; rendererErrors: unknown; updater: unknown; remoteConfig: unknown; toolchain: unknown;
  displays: unknown; gpu: unknown;
  problems: Problem[];
}

/** One row of a folder listing: its shape, never its bytes. */
type Listed = { name: string; size: number; mtime: number; dir: boolean };

// Nothing about a folder listing that matters for troubleshooting needs the file's bytes,
// only its shape - names, sizes, when they last changed.
export function listFolder(dir: string): Listed[] | null {
  try {
    return fs.readdirSync(dir).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null; // missing or unreadable folder is itself worth knowing
  }
}

function redactHome<T extends string | null | undefined>(dir: T, home: string = os.homedir()): T | string {
  if (!dir || !home) return dir;

  const compareDir = process.platform === 'win32' ? dir.toLowerCase() : dir;
  const compareHome = process.platform === 'win32' ? home.toLowerCase() : home;

  if (compareDir !== compareHome && !compareDir.startsWith(`${compareHome}${path.sep}`)) {
    return dir;
  }

  return process.platform === 'win32'
    ? `%USERPROFILE%${dir.slice(home.length)}`
    : `~${dir.slice(home.length)}`;
}

function folderListingText(dir: string, filter?: ((f: Listed) => boolean) | null, home?: string): string {
  const list = listFolder(dir);
  if (!list) return `${redactHome(dir, home)}\n(not found or unreadable)`;
  const rows = filter ? list.filter(filter) : list;
  const lines = rows.map((f) =>
    `${f.dir ? 'DIR ' : '    '}${String(f.size).padStart(10)}  ${new Date(f.mtime).toISOString()}  ${f.name}`);
  return `${redactHome(dir, home)}\n\n${lines.join('\n') || '(empty)'}`;
}

// The last chunk of a log file - a support conversation is almost always about what just
// happened, not the file's whole history.
/** The last `maxBytes` of a log file, or null when it cannot be read. */
export function tailLog(file: string, maxBytes: number): string | null {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Everything a support report carries, gathered from the running services.
 * @param deps.home  the home directory to hide, for a test that cannot have one
 * @param deps.extra facts only the main process can answer: whether Dota is
 *   running, the open windows, errors the interface has reported, the updater's state, the
 *   remote config and the toolchain. Passed in so this module stays free of Electron.
 * @returns report: the structured data to write as report.json;
 *   files: extra plain-text files to include verbatim, keyed by name inside the zip
 */
export function buildReport({ settings, library, installer, schemaService, catalog, icons, app, extra = {}, home }: {
  settings: Pick<Settings, 'all'>; library: Pick<Library, 'list' | 'listPresets'>; installer: ReportInstaller;
  schemaService: { state(): PatchState }; catalog: Pick<Catalog, 'cacheInfo'>; icons?: Pick<Icons, 'size'> | null;
  app: { version: string; logFile?: string; userDataDir?: string; updateError?: string | null }; extra?: ReportExtra; home?: string;
}): { report: Report; files: Record<string, string> } {
  const s = settings.all();
  const game = s.dotaGamePath;
  const gameValid = validateGamePath(game);
  const active = s.langSuffix;

  const records = library.list();
  const byCategory: Record<string, number> = {};
  for (const r of records) byCategory[r.categoryId] = (byCategory[r.categoryId] || 0) + 1;

  const report: Omit<Report, 'problems'> = {
    generatedAt: new Date().toISOString(),
    app: {
      version: app.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      uiLang: s.uiLang,
    },
    settings: {
      ...s,
      // the OAuth token never touches disk (see discord-auth.ts) - what's left is fine to
      // send, but the Discord id and the avatar picture add nothing to a bug report
      dotaGamePath: redactHome(s.dotaGamePath, home),
      account: s.account ? { signedIn: true, username: s.account.username || null } : null,
    },
    dota: {
      path: redactHome(game, home) || null,
      pathValid: gameValid,
      detectedLang: gameValid && game ? gamelang.detectLangSuffix(game) : null,
      bootLanguages: gameValid ? gamelang.bootLanguages(game) : null,
      steamLanguage: gameValid ? gamelang.steamLanguage(game) : null,
      langFolders: gameValid ? gamelang.langFolders(game) : [],
      activeVoiceInstalled: gameValid && !!game && !!active ? gamelang.voiceInstalled(game, active) : false,
      minifyDetected: !!(gameValid && game && fs.existsSync(path.join(game, 'dota_minify'))),
    },
    patchAndSchema: (() => {
      try { return schemaService.state(); } catch (err) { return { error: String((err as Error)?.message || err) }; }
    })(),
    // which download mirrors have been failing this session: "it won't download" is one of
    // the commonest reports, and this says whether the bytes or the route are the problem
    mirrors: (() => {
      try { return mirrorHealth(); } catch { return []; }
    })(),
    library: {
      totalRecords: records.length,
      byCategory,
      enabled: records.filter((r) => r.enabled !== false).length,
      disabled: records.filter((r) => r.enabled === false).length,
      packs: records.filter((r) => r.kind === 'pack').length,
      withSchemaEdits: records.filter((r) => Array.isArray(r.schema) && r.schema.length).length,
      presets: library.listPresets().length,
      // How many switched-on mods have their files supplied by another mod. This asked the
      // installer for `libraryConflicts`, which has never existed, so the number was silently
      // null in every report ever sent. The function is `coverage`, and it wants enabled mods
      // keyed, because two copies of one mod in two slots share a name and are exactly the
      // case worth counting.
      fileOverlaps: (() => {
        try {
          const enabled = records
            .filter((r) => r.enabled !== false)
            .map((r) => ({ key: r.id, name: r.name, files: r.files || [] }));
          return installer.coverage(enabled).size;
        } catch { return null; }
      })(),
    },
    catalogCache: catalog.cacheInfo(),
    caches: {
      downloadCacheBytes: installer.downloadCacheSize(),
      iconCacheBytes: icons ? icons.size() : null,
    },
    // Room on the drive the game is on. "The install failed" and "there is no space" look
    // identical from the outside, and this tells the two apart in one line.
    disk: (() => {
      try {
        const st = fs.statfsSync(gameValid && game ? game : os.homedir());
        return { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize };
      } catch { return null; }
    })(),
    // Every mod, in load order, one line each. The counts above say how many; this says which,
    // which is the question as soon as the counts look wrong.
    installedMods: records
      .map((r) => ({
        i: 0,
        slot: (() => { try { return installer.slotNumber(r); } catch { return null; } })(),
        name: r.name,
        categoryId: r.categoryId || null,
        enabled: r.enabled !== false,
        kind: r.kind || 'mod',
        files: (r.files || []).length,
      }))
      .sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9))
      .map((m, i) => ({ ...m, i: i + 1 })),
    // Handed in by whoever is running: the main process knows these, this module must not
    // reach for Electron to find them out.
    dotaRunning: !!extra.dotaRunning,
    windows: extra.windows || null,
    rendererErrors: extra.rendererErrors || null,
    updater: extra.updater || null,
    remoteConfig: extra.remoteConfig || null,
    toolchain: extra.toolchain || null,
    /* Both of these were collected and thrown away. ipc-diagnostics.js gathered the displays
     * from 2026-09-04, for the complaint that a list "stops scrolling partway", and this object
     * copied `extra` field by field without them - so no report ever carried the one thing that
     * question needed, and the change that added them was checked by reading the code that
     * collected them rather than the file that came out. The graphics card went the same way
     * on the day it was added, and that is how the first one turned up. */
    displays: extra.displays || null,
    gpu: extra.gpu || null,
  };

  // What the app itself thinks is wrong, worked out here rather than left for a human to
  // spot in four hundred lines of JSON. This is the part of the report that is actually read.
  const full: Report = { ...report, problems: findProblems(report, { app }) };

  const files: Record<string, string> = {};
  if (gameValid && game && active) {
    files['mod-folder-listing.txt'] = folderListingText(path.join(game, `dota_${active}`));
    files['dota-pak-listing.txt'] = folderListingText(
      path.join(game, 'dota'),
      (f) => /^pak\d+_/i.test(f.name) || /gameinfo/i.test(f.name)
    );
    // The two files our patch edits, verbatim. When mods mount but do nothing, the answer is
    // almost always in here, and describing them second-hand has never once been enough.
    for (const name of ['gameinfo.gi', 'gameinfo_branchspecific.gi']) {
      const text = tailLog(path.join(game, 'dota', name), 64 * 1024);
      if (text) files[`dota/${name}`] = text;
    }
    const boot = tailLog(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 16 * 1024);
    if (boot) files['dota/boot.vcfg'] = boot;
    // Dota's own console log, when the user has ever run with -condebug. Usually absent, and
    // the one time it is there it is the only place the game says why it refused something.
    const con = tailLog(path.join(game, 'dota', 'console.log'), 256 * 1024);
    if (con) files['dota/console.log'] = con;
  }
  if (app.logFile) {
    const tail = tailLog(app.logFile, 400 * 1024);
    if (tail) files['app.log'] = tail;
    // the rotation, because the interesting line is often just before the restart
    const prev = tailLog(`${app.logFile}.1`, 200 * 1024);
    if (prev) files['app.previous.log'] = prev;
  }
  if (app.userDataDir) {
    files['userdata-listing.txt'] = folderListingText(app.userDataDir, null, home);
    files['downloads-listing.txt'] = folderListingText(path.join(app.userDataDir, 'downloads'), null, home);
    files['backups-listing.txt'] = folderListingText(path.join(app.userDataDir, 'backups'), null, home);
  }

  return { report: full, files };
}

/* ---------- what is wrong, said out loud ----------
 *
 * Every check answers one question a support conversation actually starts with, and each one
 * carries what to do about it. Severity is only two levels on purpose: something is broken,
 * or something is worth knowing. A third level would just be a place to hide things in.
 */
export function findProblems(r: Omit<Report, 'problems'>, { app }: { app?: { updateError?: string | null } } = {}): Problem[] {
  const out: Problem[] = [];
  const add = (level: Problem['level'], what: string, detail: string) => out.push({ level, what, detail });

  if (!r.dota.path) add('broken', 'Dota 2 not found', 'The app has no game path, so nothing can be installed.');
  else if (!r.dota.pathValid) add('broken', 'The game path does not point at Dota 2', `Set to ${r.dota.path}, which has no dota folder inside it.`);

  if (r.dota.pathValid) {
    const mounted = r.dota.detectedLang?.suffix;
    if (mounted && r.settings.langSuffix && mounted !== r.settings.langSuffix) {
      add('broken', 'Mods are in a folder the game does not mount',
        `The game mounts dota_${mounted}; the app is installing into dota_${r.settings.langSuffix}.`);
    }
    const stranded = (r.dota.langFolders || []).filter((f) => f.suffix !== r.settings.langSuffix && f.modFiles > 0);
    for (const f of stranded) {
      add('note', `${f.modFiles} mod file(s) left behind in dota_${f.suffix}`, 'They are not loaded from there.');
    }
    if (!r.dota.activeVoiceInstalled) {
      add('note', `Voice pack for ${r.settings.langSuffix} is not installed in Steam`,
        'The folder the app uses is the one the game mounts; without the voice pack Steam may re-point it.');
    }
  }

  const ps = r.patchAndSchema || {};
  if (ps.error) add('broken', 'The patch/schema state could not be read', String(ps.error));
  else {
    if (ps.patched === false) add('broken', 'The game is not patched', 'Search paths are untouched, so no mod folder is mounted.');
    /* Mods with item-table edits are on, and the table in the game is missing or older than the
       one they need. This used to ask for two fields nothing ever set, so it never fired. */
    if (ps.enabled && ps.mods && (!ps.deployed || ps.stale)) {
      add('note', 'Item-table edits are pending', 'Mods that add effects or icons will show the model only.');
    }
  }

  if (r.library.fileOverlaps) {
    add('note', `${r.library.fileOverlaps} mod(s) are overruled by another mod`, 'Expected when mods share files; the load order decides.');
  }

  const bad = (r.mirrors || []).filter((m) => m.fails > 0);
  if (bad.length === (r.mirrors || []).length && bad.length) {
    add('broken', 'Every download mirror is failing', bad.map((m) => `${m.host}: ${m.fails}`).join(', '));
  } else if (bad.length) {
    add('note', `${bad.length} download mirror(s) failing`, bad.map((m) => `${m.host}: ${m.fails}`).join(', '));
  }

  if (r.dotaRunning) add('note', 'Dota 2 is running', 'The app does not write to the game folder while it is.');
  if (r.disk && r.disk.freeBytes != null && r.disk.freeBytes < 2 * 1024 ** 3) {
    add('broken', 'Less than 2 GB free on the game drive', `${(r.disk.freeBytes / 1024 ** 3).toFixed(1)} GB left.`);
  }
  if (app?.updateError) add('note', 'The updater reported a problem', String(app.updateError));

  return out;
}

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

