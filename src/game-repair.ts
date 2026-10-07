/* Putting the game back after something else changed it (src/game-upkeep.ts runs this at start
 * and hands it to the patch watcher). A Dota patch overwrites the patched gameinfo and moves the
 * item table; Steam's file check puts back files a font or cursor mod replaced. Repaired once at
 * start for a game that changed while the app was closed, and again the moment
 * src/patch-watch.ts sees a patch land. Never while Dota is running: it holds those files open,
 * so a write would half-succeed. The app says it is waiting and tries again after the game exits.
 */
import { gameStamp } from './patch-watch.ts';
import { errorText } from './error-text.ts';
import type { Settings } from './settings.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { createSchemaService } from './schema-service.ts';
import type { createUpdateImpact } from './update-impact.ts';

/** What the app did about the last Dota patch, shown as a banner in My mods. */
export type PatchRepair = {
  state: 'idle' | 'waiting' | 'done' | 'failed';
  healed?: string[];
  error?: string | null;
  reason?: unknown;
  at?: number;
  /** the mods whose files this patch changed (src/update-impact.ts), by name */
  touched?: { build: string | null; mods: string[] };
};

/** A mod Steam's file check took away that the app could not put back from what it holds. */
export type Stuck = { id: string; name: string };

/** How long a repair waits for Dota to close before it looks again. */
export const REPAIR_RETRY_MS = 20000;

/** The repair, over the services src/game-upkeep.ts already holds. */
export function createGameRepair({ settings, installer, library, schemaService, updateImpact = null, diag, send, isRunning, retryMs = REPAIR_RETRY_MS, now = Date.now }: {
  settings: Pick<Settings, 'get' | 'set'>;
  installer: Pick<Installer, 'lostToVerify' | 'restoreDeployed'>;
  library: Pick<Library, 'list'>;
  schemaService: Pick<ReturnType<typeof createSchemaService>, 'heal'>;
  /** which mods the patch reached; left out, nobody is told */
  updateImpact?: Pick<ReturnType<typeof createUpdateImpact>, 'check'> | null;
  diag: (msg: string) => void;
  /** tells the window what the repair did */
  send: (repair: PatchRepair) => void;
  isRunning: () => Promise<boolean>;
  retryMs?: number;
  now?: () => number;
}) {
  let verifyStuck: Stuck[] = [];
  let patchRepair: PatchRepair = { state: 'idle' };
  let timer: ReturnType<typeof setTimeout> | null = null;

  /* Put back what Steam's file check took away.
   *
   * Only fonts and cursors can be taken: they overwrite files Valve ships. What can be restored
   * from what the app already holds is restored without a word: it is the state the user asked
   * for, and they did not ask Steam to undo it. What would need downloading is left alone and
   * reported instead. Starting a download at launch because a file changed is not something to do
   * behind somebody's back. */
  /** Restore what can be restored; answers how many mods came back. */
  function restoreAfterVerify(): number {
    const lost = installer.lostToVerify(library.list());
    if (!lost.length) return 0;
    const stuck: Stuck[] = [];
    let restored = 0;
    for (const rec of lost) {
      try {
        const from = installer.restoreDeployed(rec);
        if (from) { restored++; diag(`restored after verify: ${rec.name} (from ${from})`); }
        else stuck.push({ id: rec.id, name: rec.name });
      } catch (err) {
        diag(`restore failed for ${rec.name}: ${errorText(err)}`);
        stuck.push({ id: rec.id, name: rec.name });
      }
    }
    verifyStuck = stuck;
    return restored;
  }

  /** The item table and the search-path patch put back, and the files Steam took; what came of it. */
  function heal(): { healed: string[]; error: string | null } {
    const healed: string[] = [];
    let error: string | null = null;
    try {
      const res = schemaService.heal();
      if (res.healed) healed.push(...res.healed);
      if (res.error) error = res.error;
    } catch (err) {
      error = errorText(err);
    }
    try {
      if (restoreAfterVerify()) healed.push('files');
    } catch (err) {
      diag(`restore after verify skipped: ${errorText(err)}`);
    }
    return { healed, error };
  }

  /* Which of the installed mods the patch reached, by name, for the banner that reports the patch.
   * Read after the repair: it reads the game's new index, and nothing about it is worth failing the
   * repair over. */
  function touched(): PatchRepair['touched'] | undefined {
    if (!updateImpact) return undefined;
    try {
      const reached = updateImpact.check();
      if (!reached) return undefined;
      const names = new Map(library.list().map((r) => [r.id, r.name]));
      return { build: reached.to, mods: reached.ids.map((id) => names.get(id) || id) };
    } catch (err) {
      diag(`update impact skipped: ${errorText(err)}`);
      return undefined;
    }
  }

  function setPatchRepair(next: PatchRepair): void {
    patchRepair = next;
    send(patchRepair);
  }

  /* Everything the app puts back after the game changed underneath it: the patch and the item
   * table (schemaService.heal), and fonts and cursors (restoreAfterVerify). The watcher calls this
   * when a patch lands, which is the moment that matters: Steam patches the game in the
   * background, and most people press Play in Steam rather than here. */
  /** Repair after a patch, or wait for Dota to close first. */
  async function repairAfterPatch(reason?: unknown): Promise<void> {
    const game = settings.get('dotaGamePath');
    if (!game) return;
    if (timer) clearTimeout(timer);
    timer = null;

    if (await isRunning()) {
      diag('Dota patched while the game is running - repair deferred');
      setPatchRepair({ state: 'waiting', reason, at: now() });
      timer = setTimeout(() => { void repairAfterPatch(reason); }, retryMs);
      return;
    }

    const { healed, error } = heal();
    // remembered only now: a stamp stored before a failed repair would make the next start think
    // there is nothing to fix
    settings.set('gameStamp', gameStamp(game));
    diag(`repair after patch: ${healed.join(',') || 'nothing to do'}${error ? ` error=${error}` : ''}`);
    const hit = touched();
    setPatchRepair({ state: error ? 'failed' : 'done', healed, error, at: now(), ...(hit ? { touched: hit } : {}) });
  }

  /* The same repair at start, before the window exists, for a game patched while the app was
   * closed. It runs either way; the build stamp only decides whether the user is told about it,
   * and is handed to the watcher to compare against. */
  function repairAtStart(): void {
    const { healed, error } = heal();
    if (healed.some((h) => h !== 'files')) diag(`schema healed: ${healed.filter((h) => h !== 'files').join(',')}`);
    if (error) diag(`schema heal failed: ${error}`);
    const hit = touched();
    try {
      const stamp = gameStamp(settings.get('dotaGamePath'));
      const known = settings.get('gameStamp');
      // a patch that reached a mod is told about even when the build stamp missed it
      const changed = Boolean(stamp && known && stamp !== known);
      if (changed || hit) {
        if (changed) diag(`Dota changed while the app was closed: ${known} -> ${stamp}`);
        patchRepair = { state: error ? 'failed' : 'done', healed, error, at: now(), ...(hit ? { touched: hit } : {}) };
      }
      if (stamp) settings.set('gameStamp', stamp);
    } catch (e) {
      diag(`build check skipped: ${errorText(e)}`);
    }
  }

  return {
    restoreAfterVerify,
    repairAfterPatch,
    repairAtStart,
    setPatchRepair,
    /** stop waiting for Dota to close, when the app is quitting */
    stop: () => { if (timer) clearTimeout(timer); timer = null; },
    verifyStuck: () => verifyStuck,
    patchRepair: () => patchRepair,
  };
}
