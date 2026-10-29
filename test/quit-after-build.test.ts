/* Quitting waits for the item table being written (src/quit-after-build.ts): the window closed in
 * the seconds a build takes left the game a change behind what My mods showed. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { quitAfterBuild } from '../src/quit-after-build.ts';
import { createBackgroundBuilds } from '../src/schema-build.ts';

function fakeApp() {
  let handler: ((e: { preventDefault(): void }) => void) | null = null;
  const app = {
    quits: 0,
    on: (_: 'before-quit', fn: (e: { preventDefault(): void }) => void) => { handler = fn; },
    quit: () => { app.quits++; app.press(); },
    /** what Electron does on a quit: before-quit, and the app goes unless it was held */
    press: () => { let held = false; handler!({ preventDefault: () => { held = true; } }); return held; },
  };
  return app;
}

test('a quit while the table is written waits for it, then quits by itself', async () => {
  const app = fakeApp();
  let done: () => void = () => {};
  let busy = true;
  quitAfterBuild(app, { busy: () => busy, settled: () => new Promise<void>((r) => { done = () => { busy = false; r(); }; }) });
  assert.equal(app.press(), true, 'held: the build would have gone with the window');
  assert.equal(app.quits, 0);
  done();
  await new Promise((r) => setImmediate(r));
  assert.equal(app.quits, 1, 'and gone once it wrote');
});

test('with no build running a quit is not held, so the updater installs as before', () => {
  const app = fakeApp();
  quitAfterBuild(app, { busy: () => false, settled: async () => {} });
  assert.equal(app.press(), false);
});

test('a build that hangs keeps the app no longer than the limit', async () => {
  const app = fakeApp();
  quitAfterBuild(app, { busy: () => true, settled: () => new Promise<void>(() => {}), limitMs: 10 });
  assert.equal(app.press(), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(app.quits, 1, 'and the second quit is not held again');
});

test('the builds say they are busy from the ask until the answer', async () => {
  const builds = createBackgroundBuilds(function* () { return { ok: true }; }, () => {});
  assert.equal(builds.busy(), false);
  const answer = builds.inBackground();
  assert.equal(builds.busy(), true);
  await answer;
  assert.equal(builds.busy(), false);
});
