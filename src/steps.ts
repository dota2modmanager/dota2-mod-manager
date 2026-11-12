/* Work a step at a time.
 *
 * Electron runs the main process's JavaScript on the thread that draws the window, so a build that
 * holds that thread for a second leaves the window black for that second (issue #286). The long
 * jobs (the item table, the game's index, its soundevents) are written as generators that yield
 * between steps of a few dozen milliseconds: run at once with drain where the caller needs the
 * answer before it returns, or a step at a time with the rest of the app let in between
 * (src/schema-build.ts). One body of code either way. */

/** A generator run to its end at once: for a caller that does not wait between the steps. */
export function drain<R>(steps: Generator<unknown, R>): R {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The step a walk yields between pieces of its work. */
export const PAUSE = Symbol('pause');

/**
 * A generator run with the rest of the main process let in between its steps: for a channel the
 * window waits on.
 *
 * With a signal, an abort stops it between two steps (issue #425): the generator is closed, so its
 * `finally` blocks run and a write journal open inside it can roll back, and the promise rejects
 * with the signal's reason. A step is never cut in half.
 */
export async function runSteps<R>(steps: Generator<unknown, R>, signal?: AbortSignal): Promise<R> {
  for (;;) {
    if (signal?.aborted) {
      steps.return(undefined as R);
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    const r = steps.next();
    if (r.done) return r.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
