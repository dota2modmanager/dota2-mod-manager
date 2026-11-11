/* What the app sees of the game after Play: whether Dota is open (src/game-watch.ts, for the
 * status bar and the channels that write the game) and whether it closed seconds after Play
 * (src/crash-watch.ts). The two share one answer from the system, asked by the game watch. Play
 * itself is src/ipc-launch.ts. */
import { createGameWatch, type GameWatch } from './game-watch.ts';
import { createCrashWatch } from './crash-watch.ts';
import { dotaIsRunning } from './game-upkeep.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';

/**
 * Both watches over one process check.
 * @param send  to the window, when there is one
 * @returns the game watch, which the gate asks, and `launched`, which Play calls
 */
export function watchGame({ settings, library, diag, send, isRunning = () => dotaIsRunning() }: {
  settings: Pick<Settings, 'get' | 'set'>;
  library: Pick<Library, 'list'>;
  diag: (msg: string) => void;
  send: (channel: string, value: unknown) => void;
  isRunning?: () => Promise<boolean>;
}): { gameWatch: GameWatch; launched: () => void } {
  const crashWatch = createCrashWatch({
    lastGood: () => settings.get('lastGoodGameAt') ?? null, setLastGood: (at) => settings.set('lastGoodGameAt', at), mods: () => library.list(),
  });
  const gameWatch = createGameWatch({ isRunning, send: (running) => {
    send('game:running', running);
    const exit = crashWatch.running(running);
    if (exit) { diag(`Dota closed ${exit.seconds}s after Play; new since the last game: ${exit.suspects.length}`); send('game:quickExit', exit); }
  } });
  return { gameWatch, launched: () => crashWatch.launched() };
}
