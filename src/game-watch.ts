/* Is Dota open right now, asked every few seconds and told to the window when it changes.
 *
 * While the game runs it holds its paks and gameinfo open, and anything written then either fails
 * halfway on Windows or waits for the next start to be read. The app stays open beside the game
 * (the catalog, favourites and presets are worth browsing with Dota up), so instead of closing it
 * says so: the status bar names it, and the channels that write the game folder answer "close
 * Dota first" (src/feature-gate.ts) from the answer kept here, without asking the system again.
 *
 * The check runs a process list (src/game-upkeep.ts dotaIsRunning), which is async and never
 * holds the main process. It runs every few seconds while the game is closed and every second while
 * it is open, so the app lets go within a second of the game closing; a refusal asks again at once
 * too, so the next click after the game is gone goes through.
 */

/** The watch: the last answer, and the switch that starts and stops asking. */
export interface GameWatch {
  /** The last answer; an answer of "open" also asks again, without waiting for it. */
  running(): boolean;
  start(): void;
  stop(): void;
  /** Ask now, tell the window on a change, and answer. */
  check(): Promise<boolean>;
}

/**
 * @param isRunning  whether the Dota client is running, asked of the system
 * @param send       told the new answer each time it changes
 * @param everyMs    how often to ask while the game is closed
 * @param openMs     how often to ask while it is open
 */
export function createGameWatch({ isRunning, send, everyMs = 5000, openMs = 1000 }: {
  isRunning: () => Promise<boolean>; send: (running: boolean) => void; everyMs?: number; openMs?: number;
}): GameWatch {
  let now = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let on = false;
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

  const next = (): void => {
    if (!on) return;
    timer = setTimeout(() => { void check().finally(next); }, now ? openMs : everyMs);
    timer.unref?.();
  };

  return {
    running: () => {
      if (now) void check();
      return now;
    },
    check,
    start() {
      if (on) return;
      on = true;
      told = false; // a page loaded afresh has not heard the answer yet
      void check().finally(next);
    },
    stop() {
      on = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
