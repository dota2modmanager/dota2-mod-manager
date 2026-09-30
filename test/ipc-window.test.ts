/* The window and update channels, against a stand-in for Electron.
 *
 * These handlers are registered at startup and used minutes later, so anything they capture at
 * registration is whatever it was before the app had done anything. `win` is handed over as a
 * getter for exactly that reason. `portableUpdate` was not, and the version a portable copy is
 * offered is learned when the update check finds one: the download button answered "no update"
 * every time from 2.3.0 until this was noticed on 2026-09-19.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerWindowIpc } from '../src/ipc-window.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Register src/ipc-window.ts against a fake Electron, and hand back its channels. */
function register(ctx: ReturnType<typeof stand>['ctx']) {
  return registerAgainst(() => registerWindowIpc(ctx as never), {
    shell: { openExternal: () => {}, openPath: () => {}, showItemInFolder: () => {} },
    app: { getVersion: () => '2.6.12' },
  });
}

function stand({ portable = true } = {}) {
  const asked: string[] = [];
  let version: string | null = null; // nothing is known at registration, which is the whole point
  const ctx = {
    IS_PORTABLE: portable,
    autoUpdater: { checkForUpdates: async () => {} },
    clampZoom: () => {},
    diag: () => {},
    portableUpdate: () => version,
    portableUpdater: {
      portableDir: () => path.join(ROOT, 'dist'),
      fetchBeside: async (v: string) => { asked.push(v); return { name: `Dota-2-Mod-Manager-Portable-${v}.exe`, path: `C:/dl/${v}.exe` }; },
    },
    releaseNotes: () => '',
    sendProgress: () => {},
    settings: { get: () => null, set: () => {} },
    win: () => ({ minimize: () => {}, isMaximized: () => false }),
  };
  return { ctx, asked, found: (v: string) => { version = v; } };
}

test('the portable download button uses the version the update check found afterwards', async () => {
  const s = stand();
  const channels = register(s.ctx);
  const fetchPortable = channels.get('update:fetchPortable');
  assert.ok(fetchPortable, 'update:fetchPortable is not registered');

  // before the check has found anything: there is nothing to fetch, and the app says so
  const before = await fetchPortable({});
  assert.ok(before.error, 'nothing found yet, so there is nothing to fetch');
  assert.deepEqual(s.asked, []);

  s.found('2.7.0');
  const out = await fetchPortable({});
  assert.deepEqual(s.asked, ['2.7.0'], 'the handler still holds the version it had at registration, which is none');
  assert.equal(out.ok, true);
  assert.match(out.name, /2\.7\.0/);
});

test('an installed build is told this is not a portable copy', async () => {
  const s = stand({ portable: false });
  s.found('2.7.0');
  const channels = register(s.ctx);
  const out = await channels.get('update:fetchPortable')!({});
  assert.ok(out.error, 'an installed build has nothing to fetch beside itself');
  assert.deepEqual(s.asked, []);
});

test('revealing a downloaded copy refuses a path that is not the folder we wrote into', async () => {
  const s = stand();
  const channels = register(s.ctx);
  const reveal = channels.get('update:revealPortable');
  assert.ok(reveal, 'update:revealPortable is not registered');
  assert.ok((await reveal({}, 'C:/somewhere/else/evil.exe')).error, 'a path outside our own folder is refused');
  assert.deepEqual(await reveal({}, path.join(ROOT, 'dist', 'Dota-2-Mod-Manager-Portable.exe')), { ok: true });
});
