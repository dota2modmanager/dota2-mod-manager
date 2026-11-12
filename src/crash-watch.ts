/* Dota closing seconds after Play, told to the window with the mods that are new since it last
 * ran normally (plan item 10, Discord #support).
 *
 * People who hit a crash at load bring it to Discord as "the game closes", with nothing else to
 * go on. The app knows two things that narrow it down: that the game ran for seconds rather than
 * minutes, and which mods went in after the last session that lasted. Those are the first to
 * switch off. Nothing is switched off on its own: a game closed on purpose looks the same.
 *
 * Only a launch from the app's Play button counts: the app knows then that the player meant to
 * play. The game watch (src/game-watch.ts) asks every few seconds, so the times are rough, and a
 * crash in the first five seconds can go unseen. A session of a minute or more is a normal one,
 * whoever started it.
 */

/** What the window is told after a quick exit. */
export type QuickExit = {
  /** how long the game ran, rounded to seconds */
  seconds: number;
  /** enabled mods installed since the last normal session; empty when there was none to compare */
  suspects: { id: string; name: string }[];
};

/** A run shorter than this after Play is a crash, not a game. */
export const QUICK_MS = 60_000;
/** Steam can take this long to start the game after Play; a start later than that was not ours. */
export const LAUNCH_WINDOW_MS = 5 * 60_000;

/**
 * @param lastGood  when a session last lasted, ms; null before the first one
 * @param setLastGood  remembers it
 * @param mods  the installed mods, for the suspects
 */
export function createCrashWatch({ lastGood, setLastGood, mods, now = Date.now, quickMs = QUICK_MS, launchWindowMs = LAUNCH_WINDOW_MS }: {
  lastGood: () => number | null;
  setLastGood: (at: number) => void;
  mods: () => { id: string; name: string; enabled?: boolean; installedAt?: number }[];
  now?: () => number;
  quickMs?: number;
  launchWindowMs?: number;
}) {
  let launchedAt: number | null = null;
  let startedAt: number | null = null;
  let fromPlay = false;

  /** Mods switched on and installed after the last normal session. */
  function suspects(): QuickExit['suspects'] {
    const since = lastGood();
    if (!since) return [];
    return mods().filter((m) => m.enabled !== false && (m.installedAt || 0) > since).map((m) => ({ id: m.id, name: m.name }));
  }

  return {
    /** Play was pressed. */
    launched(): void { launchedAt = now(); },
    /** The game watch's answer changed; a quick exit after Play comes back as what to tell. */
    running(open: boolean): QuickExit | null {
      const t = now();
      if (open) {
        startedAt = t;
        fromPlay = launchedAt !== null && t - launchedAt <= launchWindowMs;
        launchedAt = null;
        return null;
      }
      if (startedAt === null) return null;
      const ran = t - startedAt;
      startedAt = null;
      if (ran >= quickMs) { setLastGood(t); return null; }
      return fromPlay ? { seconds: Math.round(ran / 1000), suspects: suspects() } : null;
    },
  };
}
