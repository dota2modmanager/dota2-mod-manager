/**
 * Take a screenshot of the window, and try again when Chromium has no frame to hand over yet.
 *
 * Under xvfb on a CI runner, webContents.capturePage() now and then rejects with UnknownVizError:
 * the compositor has nothing to give at that moment. On 2026-09-15 that failed the Linux start
 * check on a pull request that had not touched the app, after seven green runs in a row. A
 * required check that fails at random for reasons outside the change gets rerun without being
 * read, and then it guards nothing. So a capture gets a few tries, and every failed try goes to
 * the log, which keeps a capture that never works exactly as visible as before.
 * @param capture  the call to make, usually () => win.webContents.capturePage()
 * @param opts.tries  how many times to call it before giving up
 * @param opts.waitMs  the pause between tries
 * @param opts.log  where each failed try is reported
 * @param opts.sleep  the pause itself, replaceable in tests
 * @returns whatever the capture returned
 */
export async function captureWithRetry<T>(capture: () => Promise<T>, {
  tries = 3,
  waitMs = 1500,
  log = () => {},
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: { tries?: number; waitMs?: number; log?: (msg: string) => void; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await capture();
    } catch (err) {
      last = err;
      log(`capture attempt ${attempt} of ${tries} failed: ${err instanceof Error ? err.message : err}`);
      if (attempt < tries) await sleep(waitMs);
    }
  }
  throw last;
}
