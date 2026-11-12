// What Steam's own manifest says about Dota right now (issue #427). Pressing Play while Steam is
// still downloading an update queues the update first: the game starts minutes later, on new
// files the mods may not fit yet, and the user sees nothing happen. steamapps/appmanifest_570.acf
// says so before the launch, in one field.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';

/** Steam's StateFlags bits that mean an update is due or under way. */
const UPDATE_REQUIRED = 2;
const FULLY_INSTALLED = 4;
const UPDATE_RUNNING = 256;
const UPDATE_PAUSED = 512;
const UPDATE_STARTED = 1024;
const VALIDATING = 131072;
const DOWNLOADING = 1048576;
const STAGING = 2097152;
const COMMITTING = 4194304;

/** The game's state as Steam last wrote it: its flags, and the bytes of the download under way. */
export interface AppState { flags: number; toDownload: number; downloaded: number }

/** The fields this module reads, out of an appmanifest's text; null when it has no StateFlags. */
export function parseAppManifest(text: string): AppState | null {
  const field = (name: string) => {
    const m = new RegExp(`"${name}"\\s+"(\\d+)"`, 'i').exec(text);
    return m ? Number(m[1]) : null;
  };
  const flags = field('StateFlags');
  if (flags === null) return null;
  return { flags, toDownload: field('BytesToDownload') ?? 0, downloaded: field('BytesDownloaded') ?? 0 };
}

/** Whether Steam has an update for the game that it has not finished. */
export function updatePending(state: AppState): boolean {
  if (!(state.flags & FULLY_INSTALLED)) return true;
  return (state.flags & (UPDATE_REQUIRED | UPDATE_RUNNING | UPDATE_PAUSED | UPDATE_STARTED)) !== 0;
}

/**
 * What Steam is doing to the game's files right now, if anything: its file check (which it can
 * start on its own, and which puts Valve's originals back over the app's edit) or an update. A
 * repair written in the middle of either is overwritten by the next file Steam writes, so the
 * repair waits for it (src/game-repair.ts).
 */
export function steamWork(state: AppState | null): 'validating' | 'updating' | null {
  if (!state) return null;
  if (state.flags & VALIDATING) return 'validating';
  return (state.flags & (UPDATE_RUNNING | UPDATE_STARTED | DOWNLOADING | STAGING | COMMITTING)) ? 'updating' : null;
}

/**
 * The manifest next to a game folder ("<library>/steamapps/common/dota 2 beta/game"), read;
 * null when it is not where Steam keeps it, which a copied or moved game can be.
 */
export function readAppState(gamePath: string | null | undefined, read: (p: string) => string = (p) => fs.readFileSync(p, 'utf-8')): AppState | null {
  if (!gamePath) return null;
  const steamapps = path.resolve(gamePath, '..', '..', '..');
  try { return parseAppManifest(read(path.join(steamapps, 'appmanifest_570.acf'))); } catch { return null; }
}

/** What to tell the user before the launch, or null when Steam is done with the game. */
export function launchWarning(gamePath: string | null | undefined, read?: (p: string) => string): string | null {
  const state = readAppState(gamePath, read);
  if (!state || !updatePending(state)) return null;
  return t('Steam ещё обновляет Dota 2: игра запустится, когда загрузка закончится. После обновления загляни в «Мои моды»');
}
