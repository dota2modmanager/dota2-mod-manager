/* Keeping the game folder the way the user left it, while other programs change it underneath.
 *
 * Three things change a Dota install without asking the app. The game's audio language decides
 * which folder the engine mounts, so mods have to follow it. Steam's file check puts back files a
 * font or cursor mod replaced. A Dota patch overwrites the patched gameinfo and moves the item
 * table. This module answers all three: once at start, before the window opens, and again the
 * moment src/patch-watch.ts sees a patch land.
 *
 * Nothing is written while Dota is running. It holds gameinfo and its paks open, so a write would
 * half-succeed, and the client has already read the files anyway. The app says it is waiting and
 * tries again after the game exits.
 */
import { execFile } from 'node:child_process';

import * as gamelang from './gamelang.ts';
import { errorText } from './error-text.ts';
import type { Settings } from './settings.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { createSchemaService } from './schema-service.ts';
import type { createUpdateImpact } from './update-impact.ts';
import { createGameRepair, REPAIR_RETRY_MS, type PatchRepair } from './game-repair.ts';

/** Mods moved into the folder the game mounts, told to the user once in Settings. */
type LangMigration = { from: string; to: string; moved: number };

/* Dota reads boot.vcfg once at startup and rewrites it on exit, so language changes must be made
 * while it is closed or the game would just overwrite them.
 *
 * Two answers to one question, because Windows and Linux have nothing in common here: one filters
 * a table by image name, the other matches a process name exactly (pgrep -f would also match the
 * Steam command line that mentions the game, and every browser tab about it). A missing tool
 * answers "not running", which is what this returned on any non-Windows machine before there was
 * a second branch at all. */
/** Whether the Dota client is running on this machine right now. */
export function dotaIsRunning({ platform = process.platform, run = execFile as RunCommand } = {}): Promise<boolean> {
  const [cmd, args, hit] = platform === 'win32'
    ? ['tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH'], /dota2\.exe/i] as const
    : ['pgrep', ['-x', 'dota2'], /\d/] as const;
  return new Promise((resolve) => {
    run(cmd, [...args], (err, stdout) => {
      resolve(!err && hit.test(String(stdout || '')));
    });
  });
}

/** execFile's shape, as far as dotaIsRunning uses it. */
type RunCommand = (cmd: string, args: string[], done: (err: Error | null, stdout: string | Buffer) => void) => unknown;

/** One step of the work done at start: its name for the log, and the work. */
type Step = { name: string; run: () => unknown };

/** Run each step in order; one that throws is logged as skipped and the rest still run. */
export async function runSteps(steps: Step[], diag: (msg: string) => void): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (e) {
      diag(`${step.name} skipped: ${errorText(e)}`);
    }
  }
}

export function createGameUpkeep({
  settings, installer, library, schemaService, updateImpact = null, rebuildGenerated, reconcileCursors, diag, send,
  isRunning = () => dotaIsRunning(), findGame, validGame, retryMs = REPAIR_RETRY_MS, now = Date.now,
}: {
  settings: Pick<Settings, 'get' | 'set'>;
  installer: Pick<Installer, 'lostToVerify' | 'restoreDeployed' | 'migrateLegacyPriorityPaks' | 'migrateSlotZones' | 'mergeMultiPartRecords' | 'sweepStaged'>;
  library: Library;
  schemaService: Pick<ReturnType<typeof createSchemaService>, 'heal' | 'migrate' | 'migrateCosmeticSettings'>;
  /** which mods a patch reached (src/update-impact.ts) */
  updateImpact?: Pick<ReturnType<typeof createUpdateImpact>, 'check' | 'clear'> | null;
  /** builds again, from the new files, the mods the app built out of the game's (src/arcana-service.ts) */
  rebuildGenerated?: (ids: string[]) => string[];
  /** puts the switched-on cursor set back on disk (src/cursors.ts) */
  reconcileCursors: () => void;
  diag: (msg: string) => void;
  /** tells the window what the repair did */
  send: (repair: PatchRepair) => void;
  isRunning?: () => Promise<boolean>;
  /** looks for a Dota install on this machine (src/steam.ts) */
  findGame: () => Promise<string | null>;
  /** whether a folder really is one */
  validGame: (p: string | null | undefined) => boolean;
  retryMs?: number;
  now?: () => number;
}) {
  // The folder mods are installed into, decided by the game's own audio language rather than by
  // us: Korean audio means dota_koreana, Chinese means dota_schinese, and English borrows
  // dota_russian because it has no folder of its own (see keepModFolder).
  let langFolder = gamelang.FALLBACK_FOLDER;
  let langMigration: LangMigration | null = null;
  let slotMigration: { moved: number } | null = null;
  const repair = createGameRepair({ settings, installer, library, schemaService, updateImpact, rebuildGenerated, diag, send, isRunning, retryMs, now });

  /* Auto-detect on first run, and re-detect whenever the saved path stopped being a Dota install:
   * a library moved to another drive leaves the old tree behind, and writing mods into it looks
   * like success and changes nothing in the game. */
  async function checkGamePath(): Promise<void> {
    const stale = settings.get('dotaGamePath');
    if (validGame(stale)) return;
    const found = await findGame();
    if (found) {
      if (stale && stale !== found) diag(`game path ${stale} is no longer an install, moved to ${found}`);
      settings.set('dotaGamePath', found);
    } else if (stale) {
      // Nothing valid anywhere. Forget the dead path rather than keep it: every write after this
      // refuses without a path, and refusing is the honest answer here.
      diag(`game path ${stale} is not an install and Dota was not found; clearing it`);
      settings.set('dotaGamePath', null);
    }
  }

  /* Mods follow the game's audio language instead of the game following us.
   *
   * The engine mounts the folder named by that language, so the mod folder is not a preference,
   * it is a consequence of a setting somewhere else. Three of Dota's four voice languages have a
   * folder, so somebody playing with Korean or Chinese speech keeps it and their mods go into
   * dota_koreana or dota_schinese. Nothing is asked and nothing is changed.
   *
   * English is the one that has to move, because it has no folder at all and Valve's gameinfo
   * mounts no language path for it. Those users get dota_russian written into the audio setting,
   * and they hear no difference: Steam decides what is downloaded and Dota decides what is
   * mounted, so a folder with no voice pack in it mounts with our mods and the speech keeps
   * coming out of dota/pak01, in English.
   *
   * The text language stays untouched. It is the one the user picked when they installed the
   * game, and nothing about mods depends on it.
   *
   * Dota rewrites boot.vcfg when it exits, so a running game means we try again next launch. */
  async function keepModFolder(): Promise<void> {
    const game = settings.get('dotaGamePath');
    if (!game) return;
    const lang = gamelang.detectLangSuffix(game);
    const launched = gamelang.launchLanguage(game);
    const chosen = gamelang.modFolderFor(launched, lang.suffix);
    langFolder = chosen.suffix;

    /* A launch option is not ours to overrule. While `-language X` is set the engine reads
     * dota_X whatever boot.vcfg says, so the app follows it instead of setting the voice language
     * back on every start and leaving mods in a folder nobody mounts. That is also the
     * arrangement that lets this run alongside Minify: it puts the parameter there, and both sets
     * of mods end up in the one folder the game reads. */
    if (chosen.followed) {
      diag(`launch option -language ${langFolder}: following it instead of setting the voice language`);
    } else if (lang.suffix !== langFolder) {
      if (await isRunning()) {
        diag(`audio language is ${lang.suffix}, Dota is running - leaving boot.vcfg alone`);
        return;
      }
      gamelang.writeBootLanguages(game, { audio: langFolder });
      diag(`audio language ${lang.suffix} -> ${langFolder}`);
    }
    gamelang.ensureLangFolder(game, langFolder);
    // whatever the mods were following before: our own last setting, and the folder the game was
    // mounting until a moment ago
    let moved = 0;
    const from = new Set([settings.get('langSuffix'), lang.suffix].filter((s): s is string => !!s && s !== langFolder));
    for (const old of from) moved += gamelang.moveLangFolder(game, old, langFolder);
    if (moved) {
      langMigration = { from: [...from][0], to: langFolder, moved };
      diag(`mods moved into dota_${langFolder}: ${moved} files from ${[...from].join(', ')}`);
    }
    settings.set('langSuffix', langFolder);
  }

  /* The load order in two parts, once: the categories that load first in 02-29, the rest from 30
   * (src/slot-zones.ts). Renames files the game holds open while it runs, so it waits for a start
   * with Dota closed; a failure puts everything back and tries next time. */
  async function layoutSlotsOnce(): Promise<void> {
    if (settings.get('slotZones') === 1) return;
    if (await isRunning()) {
      diag('load order layout: Dota is running, trying on the next start');
      return;
    }
    const r = installer.migrateSlotZones(library);
    settings.set('slotZones', 1);
    if (r && r.moved) {
      slotMigration = { moved: r.moved };
      diag(`load order layout: ${r.moved} mod(s) moved into their part of the order`);
    }
  }

  /** Everything put right before the window opens, each step on its own. */
  async function atStart(): Promise<void> {
    await checkGamePath();
    await runSteps([
      // put the mods where the game will look for them, and make the game look there
      { name: 'lang folder sync', run: keepModFolder },
      // repair "!pakNN" files left by versions before 1.0.4 (the game ignored them)
      { name: 'legacy pak migration', run: () => installer.migrateLegacyPriorityPaks(library) },
      { name: 'load order layout', run: layoutSlotsOnce },
      // fold imports that predate single-file merging (pakNN_dir.vpk + pakNN_000.vpk)
      { name: 'multi-part merge', run: () => installer.mergeMultiPartRecords(library) },
      // put the switched-on cursor set back on disk, and stash a copy of sets installed before
      // they could be switched off at all
      { name: 'cursor reconcile', run: reconcileCursors },
      // finish what a killed process could not: a file a transaction had parked while it worked
      {
        name: 'staged sweep',
        run: () => {
          const swept = installer.sweepStaged();
          if (swept.restored || swept.dropped) diag(`staged files: ${swept.restored} restored, ${swept.dropped} dropped`);
        },
      },
      // one-time sweep of mods installed before the schema engine existed: they still carry a
      // stale item table and a stale localization copy inside their VPK
      {
        name: 'schema migrate',
        run: () => {
          const m = schemaService.migrate();
          if (m.changed) diag(`schema migrate: ${m.changed}/${m.scanned} mods cleaned, ${m.deltas} blocks, ~${m.freedMB} MB freed`);
        },
      },
      // cosmetic picks used to live in settings.json; move them into library records so they can
      // be toggled, deleted and shared like any other mod
      { name: 'cosmetic migrate', run: () => schemaService.migrateCosmeticSettings() },
      // a Dota update overwrites the patched gameinfo and moves the item table: put both back
      // before the user gets a chance to launch the game with a half-applied setup
      { name: 'repair at start', run: repair.repairAtStart },
    ], diag);
  }

  return {
    atStart,
    keepModFolder,
    restoreAfterVerify: repair.restoreAfterVerify,
    repairAfterPatch: repair.repairAfterPatch,
    setPatchRepair: repair.setPatchRepair,
    /** stop waiting for Dota to close, when the app is quitting */
    stop: repair.stop,
    langFolder: () => langFolder,
    /** the move Settings tells the user about, handed over once */
    takeLangMigration: () => { const m = langMigration; langMigration = null; return m; },
    takeSlotMigration: () => { const m = slotMigration; slotMigration = null; return m; },
    verifyStuck: repair.verifyStuck,
    patchRepair: repair.patchRepair,
  };
}

export { REPAIR_RETRY_MS } from './game-repair.ts';
export type { PatchRepair, Stuck } from './game-repair.ts';
