/* Quitting waits for the item table being written.
 *
 * A look switched on or off is written into the game by a build in the background, a few seconds
 * for a library of several hundred picks. The window closed in those seconds took the build with
 * it: the game kept the table from before, so a look off on screen was on in the game, and twice
 * in a row the app was closed within seconds of a change (J0nathan550, 2026-10-29). The next start
 * builds it again (schemaPending), but only if it stays open long enough. So the app stays, without
 * its window, until the build has written, and no longer than LIMIT_MS for one that hangs. When no
 * build is running nothing is held: the updater's quit-and-install goes through as it always did.
 */

/** The longest a quit waits for a build: a whole library is about three seconds of work. */
export const LIMIT_MS = 30_000;

type QuitEvent = { preventDefault(): void };

/**
 * @param app      what of Electron's app this needs
 * @param busy     whether a build is running or asked for (schemaService.busy)
 * @param settled  resolves once none is (schemaService.settled)
 */
export function quitAfterBuild(app: { on(event: 'before-quit', fn: (e: QuitEvent) => void): unknown; quit(): void },
  { busy, settled, log = () => {}, limitMs = LIMIT_MS }: {
    busy: () => boolean; settled: () => Promise<void>; log?: (msg: string) => void; limitMs?: number;
  }): void {
  let waited = false;
  app.on('before-quit', (e) => {
    if (waited || !busy()) return;
    e.preventDefault();
    waited = true;
    log('quit: waiting for the item table to be written');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => { timer = setTimeout(resolve, limitMs); });
    void Promise.race([settled(), limit]).finally(() => { clearTimeout(timer); app.quit(); });
  });
}
