/* The command line (issue #436): put a preset on, list the mods, or switch them all off, with no
 * window. For scripts, LAN setups and Steam Deck desktop mode.
 *
 *   dota2-mod-manager --apply "d2mm://preset/..."   install the preset's mods and put it on
 *   dota2-mod-manager --list                        every mod in My mods, on or off
 *   dota2-mod-manager --disable-all                 every mod and look off, kept in My mods
 *
 * `--headless` may go along with any of them and changes nothing: none of them opens a window.
 * The run goes through what the window uses (src/preset-install.ts, the installer, the library),
 * so the write jail, the file journal and the remote switches hold here too. It starts after the
 * game folder has been put right (src/game-upkeep.ts), the way a window would find it.
 *
 * Exit codes: 0 done; 1 failed, one line on stderr; 2 done without some of it, one line per thing
 * left out; 3 the app is already open; 64 a command line it does not understand.
 */
import { FileTx } from './file-tx.ts';
import { createPresetInstall, touchesSchema, type PresetInstallDeps } from './preset-install.ts';
import { errorText } from './error-text.ts';
import type { Preset, PresetEntry } from './types.ts';

/** What the command line asked for. */
export type CliCommand = { run: 'apply'; link: string } | { run: 'list' } | { run: 'disable-all' };

/** Exit code: done. */
export const CLI_OK = 0;
/** Exit code: failed, one line on stderr. */
export const CLI_FAILED = 1;
/** Exit code: done without some of it, one stderr line per thing left out. */
export const CLI_PARTLY = 2;
/** Exit code: the app is already open and holds the library. */
export const CLI_BUSY = 3;
/** Exit code: a command line it does not understand. */
export const CLI_USAGE = 64;

const USAGE = 'usage: --apply <d2mm://preset/... link> | --list | --disable-all [--headless]';

/**
 * The command in a command line, null when it holds none (an ordinary start), or why it cannot
 * be run. Everything else on the line (Electron's and Chromium's switches, --write-jail, the
 * app folder) is left to whoever reads it.
 */
export function cliCommand(argv: readonly string[]): CliCommand | { run: 'usage'; why: string } | null {
  const found: CliCommand[] = [];
  let headless = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') found.push({ run: 'list' });
    else if (a === '--disable-all') found.push({ run: 'disable-all' });
    else if (a === '--headless') headless = true;
    else if (a === '--apply' || a.startsWith('--apply=')) {
      const link = a === '--apply' ? argv[i + 1] : a.slice('--apply='.length);
      if (a === '--apply') i++;
      if (!link || link.startsWith('--')) return { run: 'usage', why: `--apply needs a preset link. ${USAGE}` };
      found.push({ run: 'apply', link });
    }
  }
  if (found.length > 1) return { run: 'usage', why: `one command at a time. ${USAGE}` };
  if (found.length) return found[0];
  return headless ? { run: 'usage', why: `--headless alone has nothing to do. ${USAGE}` } : null;
}

/** Where the run's lines go: stdout for answers, stderr for what went wrong. */
export interface CliOut { out(line: string): void; err(line: string): void }

/** What a run needs on top of the preset flows: the table build to wait for before exiting. */
export type CliDeps = PresetInstallDeps & { schemaService: PresetInstallDeps['schemaService'] & { settled(): Promise<unknown> } };

/**
 * Run one command to the end, the item table included.
 * @returns the exit code
 */
export async function runCli(cmd: CliCommand, deps: CliDeps, io: CliOut): Promise<number> {
  const { library, installer, schemaService, presets, blocked } = deps;
  const finish = async (errors: string[]): Promise<number> => {
    await schemaService.settled();
    for (const e of errors) io.err(e);
    return errors.length ? CLI_PARTLY : CLI_OK;
  };

  if (cmd.run === 'list') {
    for (const r of library.list()) {
      const style = r.styleLabel ? ` (${r.styleLabel})` : '';
      io.out(`${r.enabled === false ? 'off' : 'on '}\t${r.categoryId}\t${r.name}${style}`);
    }
    return CLI_OK;
  }

  if (cmd.run === 'disable-all') {
    const errors: string[] = [];
    let changed = 0;
    let schemaTouched = false;
    for (const rec of library.list()) {
      if (rec.enabled === false) continue;
      try {
        FileTx.run(() => {
          installer.setEnabled(rec.files, false, rec.id);
          library.setEnabled(rec.id, false);
        }, installer.log);
        if (touchesSchema(rec) || rec.categoryId === 'cosmetic') schemaTouched = true;
        changed++;
      } catch (err) {
        errors.push(`${rec.name}: ${errorText(err)}`);
      }
    }
    if (schemaTouched) await schemaService.refreshInBackground();
    io.out(`switched off: ${changed}`);
    return finish(errors);
  }

  const stop = blocked('install');
  if (stop) { io.err(stop.error); return CLI_FAILED; }
  const parked = presets.importPresetLink(cmd.link);
  if ('error' in parked) { io.err(parked.error); return CLI_FAILED; }
  const preset = parked.preset as Preset & { wanted: PresetEntry[] };
  const r = await createPresetInstall(deps).resolve(preset);
  if ('error' in r) { io.err(r.error.split('\n')[0]); return CLI_FAILED; }
  io.out(`applied "${preset.name}": ${r.installed} mods`);
  return finish(r.errors);
}

const stdio: CliOut = {
  out: (line) => { process.stdout.write(`${line}\n`); },
  err: (line) => { process.stderr.write(`${line}\n`); },
};

/** Run the command line's command and exit with its code. A line it cannot read exits at once. */
export async function exitWithCli(
  cmd: NonNullable<ReturnType<typeof cliCommand>>, deps: CliDeps, app: { exit(code?: number): void }, io: CliOut = stdio,
): Promise<void> {
  if (cmd.run === 'usage') { io.err(cmd.why); app.exit(CLI_USAGE); return; }
  // what the window shows on its progress bar, said as it happens
  const sendProgress: CliDeps['sendProgress'] = (evt) => { if (evt.type === 'stage') io.out(`${evt.label}: ${evt.stage}`); };
  let code = CLI_FAILED;
  try {
    code = await runCli(cmd, { ...deps, sendProgress }, io);
  } catch (err) {
    io.err(errorText(err));
  }
  app.exit(code);
}

/** A second copy started with a command: the open one holds the library, so it says so and goes. */
export function cliBusy(app: { exit(code?: number): void }, io: CliOut = stdio): void {
  io.err('Dota 2 Mod Manager is already open: close it, then run the command again');
  app.exit(CLI_BUSY);
}
