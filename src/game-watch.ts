/* Is Dota open right now, asked every few seconds and told to the window when it changes.
 *
 * While the game runs it holds its paks and gameinfo open, and anything written then either fails
 * halfway on Windows or waits for the next start to be read. The app stays open beside the game
 * (the catalog, favourites and presets are worth browsing with Dota up), so instead of closing it
 * says so: the status bar names it, and the channels that write the game folder answer "close
 * Dota first" (src/feature-gate.ts) from the answer kept here, without asking the system again.
 *
 * The check runs a process list (src/game-upkeep.ts dotaIsRunning), which is async and never
 * holds the main process.
 */

/** The watch: the last answer, and the switch that starts and stops asking. */
export interface GameWatch {
  running(): boolean;
  start(): void;
  stop(): void;
  /** Ask now, tell the window on a change, and answer. */
  check(): Promise<boolean>;
}

/**
 * @param isRunning  whether the Dota client is running, asked of the system
 * @param send       told the new answer each time it changes
 * @param everyMs    how often to ask
 */
export function createGameWatch({ isRunning, send, everyMs = 5000 }: {
  isRunning: () => Promise<boolean>; send: (running: boolean) => void; everyMs?: number;
}): GameWatch {
  let now = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let asking = false;
  let told = false;

  const check = async (): Promise<boolean> => {
    if (asking) return now;
    asking = true;
    try {
      const next = await isRunning().catch(() => false);
      if (next !== now || !told) { now = next; told = true; send(now); }
      return now;
    } finally {
      asking = false;
    }
  };

  return {
    running: () => now,
    check,
    start() {
      if (timer) return;
      told = false; // a page loaded afresh has not heard the answer yet
      void check();
      timer = setInterval(() => { void check(); }, everyMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
