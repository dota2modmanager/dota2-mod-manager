/* Builds of the item table in the background, one at a time (src/schema-service.ts runs them,
 * src/schema-build.ts is what they build). */
import fs from 'node:fs';
import { PAUSE } from './steps.ts';
import type { BuildStep, BuildYield, Refreshed } from './schema-build.ts';

/**
 * Builds in the background, one at a time and in order. A build asked for while one runs stops
 * that one before it writes anything, since its list of picks is out of date already, and builds
 * once more from what the library holds then; everybody waiting gets the result of the build that
 * wrote. A build run in place in between (heal, the patch switch) does the same, through `ran`.
 * @param steps    a build of the table, a step at a time
 * @param onBuild  each step of a build in the background, and null when it ends
 */
export function createBackgroundBuilds(steps: () => Generator<BuildYield, Refreshed, boolean | undefined>, onBuild: (step: BuildStep | null) => void) {
  let generation = 0;
  let chain: Promise<void> = Promise.resolve();
  const waiting: { gen: number; resolve: (r: Refreshed) => void }[] = [];
  function settle(gen: number, result: Refreshed) {
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].gen > gen) continue;
      waiting[i].resolve(result);
      waiting.splice(i, 1);
    }
  }
  return {
    /** A build that ran in place, all at once: its result answers everybody waiting on an older one. */
    ran(result: Refreshed): Refreshed {
      settle(++generation, result);
      return result;
    },

    /** A build in the background: answers once the table is written, by this build or a newer one. */
    inBackground(): Promise<Refreshed> {
      const gen = ++generation;
      const answer = new Promise<Refreshed>((resolve) => waiting.push({ gen, resolve }));
      chain = chain.then(async () => {
        if (gen !== generation) return; // a newer request is behind this one
        const run = steps();
        let wrote: boolean | undefined;
        try {
          for (;;) {
            const r = run.next(wrote);
            wrote = undefined;
            if (r.done) { settle(gen, r.value); return; }
            const step = r.value;
            if (step !== PAUSE && 'write' in step) {
              // the pak written without holding the thread; one that fails is tried again in
              // place by deploySteps, whose error is then the build's
              try { await fs.promises.writeFile(step.write, step.data); wrote = true; } catch { wrote = false; }
            } else {
              if (step !== PAUSE) onBuild(step);
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (gen !== generation) { run.return({ ok: true, superseded: true }); return; }
          }
        } catch (err) {
          settle(gen, { ok: false, error: String((err as Error)?.message || err) });
        } finally {
          onBuild(null);
        }
      });
      return answer;
    },

    /** Stop the build in the background before it writes, and answer everybody waiting with that
     *  (issue #425). False when there was none to stop. The game keeps the table it had. */
    cancel(): boolean {
      if (!waiting.length) return false;
      settle(++generation, { ok: true, cancelled: true });
      return true;
    },

    /** Whether a build is running or asked for and has not answered: quitting waits (src/quit-after-build.ts). */
    busy: () => waiting.length > 0,

    /** Resolves once no build is running or asked for: the Play button waits on it. */
    async settled(): Promise<void> {
      for (let last = null as Promise<void> | null; last !== chain;) {
        last = chain;
        await last;
      }
    },
  };
}
