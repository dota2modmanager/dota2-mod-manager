/* d2mm:// links: a preset link clicked anywhere on the system, and on Linux, telling the desktop
 * that this program opens them.
 *
 * Nothing installs from a link. It parks in the Presets tab exactly like a dropped file, and the
 * user decides. A link reaches the app three ways: on the command line of a cold start, from a
 * second copy started with it, which hands it to the first and quits, and on macOS as an
 * open-url event.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { SCHEME } from './preset-link.ts';

/** The first d2mm:// link on a command line, if there is one. */
export function firstLink(argv: readonly unknown[] | null | undefined): string | undefined {
  return (argv || []).find((a): a is string => typeof a === 'string' && a.startsWith(`${SCHEME}://`));
}

/** The part of a link the preset importer reads: what follows d2mm://preset/. */
function presetCode(url: string): string {
  return url.replace(new RegExp(`^${SCHEME}://preset/`), '');
}

/** What a window has to be able to do for a link to reach it. */
type LinkWindow = { isDestroyed(): boolean; show(): void; focus(): void; webContents: { send(channel: string, ...args: unknown[]): void } };

/**
 * Take a link in: the preset is parked, and the window comes forward and is told what arrived.
 * Anything that is not a d2mm:// link is ignored.
 */
export function handleDeepLink(url: string | null | undefined, { importPresetLink, win }: {
  importPresetLink: (code: string) => unknown;
  win: () => LinkWindow | null | undefined;
}): void {
  if (!url || !url.startsWith(`${SCHEME}://`)) return;
  const res = importPresetLink(presetCode(url));
  const w = win();
  if (w && !w.isDestroyed()) {
    w.show();
    w.focus();
    w.webContents.send('preset-link', res);
  }
}

/** The name of the .desktop file, its icon and the running window's class, all one word. */
const APP_ID = 'dota2-mod-manager';

/** The .desktop file for `exe`: the program, and the scheme and file type it opens. */
export function desktopEntry(exe: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Dota 2 Mod Manager',
    'Comment=Mods for Dota 2, without the file juggling',
    // %u passes the clicked link through; the quotes are for a path with a space in it
    `Exec="${exe}" %u`,
    `Icon=${APP_ID}`,
    // what Electron names the window (package.json desktopName): without it the dock cannot tell
    // the running window belongs to this entry, and shows a generic icon beside it
    `StartupWMClass=${APP_ID}`,
    'Categories=Game;',
    'Terminal=false',
    `MimeType=x-scheme-handler/${SCHEME};application/x-d2mm;`,
    '',
  ].join('\n');
}

/* Linux has to be told this program exists before it can send it a link.
 *
 * On Windows the installer registers the scheme and on macOS the bundle declares it, but an
 * AppImage is one file somebody copied into a folder, and the session knows nothing about it.
 * The convention is a .desktop file in ~/.local/share/applications describing the program and
 * the schemes it handles, pointing at the file the user actually ran, which is what $APPIMAGE
 * holds. setAsDefaultProtocolClient then has something to point d2mm:// at.
 *
 * Best effort on purpose. A read-only home, a distribution with no update-desktop-database, a
 * desktop environment that ignores the directory: each of those ends with the app running
 * normally and preset links opening nothing, which is where Linux stood before this existed.
 */
/** Write the .desktop file on Linux when it is missing or says something else; elsewhere, nothing. */
export function installDesktopEntry({ platform, exe, home, diag, icon, refresh = defaultRefresh }: {
  platform: string; exe: string; home: string; diag: (msg: string) => void;
  /** the app's own PNG. Icon= names a theme icon, and inside an AppImage nothing provides one */
  icon?: string;
  /** tells the desktop to reread the folder; missing on a minimal system, and harmless then */
  refresh?: (dir: string) => void;
}): void {
  if (platform !== 'linux') return;
  if (icon) installIcon(icon, home, diag);
  try {
    const dir = path.join(home, '.local', 'share', 'applications');
    const file = path.join(dir, `${APP_ID}.desktop`);
    const entry = desktopEntry(exe);
    if (holds(file, Buffer.from(entry))) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, entry);
    refresh(dir);
    diag(`desktop entry written: ${file}`);
  } catch (e) {
    diag(`desktop entry skipped: ${(e as Error).message}`);
  }
}

/* Whether `file` already says exactly `want`. One read, no existsSync before it: a check and then a
 * use is a race CodeQL rightly flags, and a missing file is simply one that says something else. */
function holds(file: string, want: Buffer): boolean {
  try { return fs.readFileSync(file).equals(want); } catch { return false; }
}

/* The icon goes where the freedesktop icon theme spec looks first for a user's own programs. The
 * size folder has to be the picture's real size, or a strict theme lookup skips it. Copied again
 * whenever it differs, so a release with a new icon replaces the old one. */
function installIcon(src: string, home: string, diag: (msg: string) => void): void {
  try {
    const dir = path.join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');
    const file = path.join(dir, `${APP_ID}.png`);
    const want = fs.readFileSync(src);
    if (holds(file, want)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, want);
    diag(`desktop icon written: ${file}`);
  } catch (e) {
    diag(`desktop icon skipped: ${(e as Error).message}`);
  }
}

function defaultRefresh(dir: string): void {
  execFile('update-desktop-database', [dir], () => {});
}
