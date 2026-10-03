/* Every IPC handler can actually run.
 *
 * test/ipc-contract.test.js reads these files as text. Text is how `blocked is not defined`
 * survived two releases: splitting registerIpc moved the call to `blocked('install')` into
 * ipc-mods.js and left the helper behind in ipc-game.js, so every channel name lined up, every
 * module was wired in, and `mods:install` threw a ReferenceError the moment anybody clicked
 * Install. The renderer awaited a promise that rejected and left the button on "Installing…"
 * forever, which is why it read as a hang rather than an error.
 *
 * So each module is registered for real against a fake Electron and a context that answers to
 * anything, and every handler is called once. Nothing here cares what a handler returns or which
 * other error it raises against stub data, only that the code in it exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as diagnostics from '../src/ipc-diagnostics.ts';
import * as game from '../src/ipc-game.ts';
import * as foreign from '../src/ipc-foreign.ts';
import * as library from '../src/ipc-library.ts';
import * as misc from '../src/ipc-misc.ts';
import * as mods from '../src/ipc-mods.ts';
import * as packs from '../src/ipc-packs.ts';
import * as presets from '../src/ipc-presets.ts';
import * as settings from '../src/ipc-settings.ts';
import * as windowIpc from '../src/ipc-window.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const MODULES: Record<string, Record<string, unknown>> = {
  'ipc-diagnostics.ts': diagnostics, 'ipc-foreign.ts': foreign, 'ipc-game.ts': game, 'ipc-library.ts': library,
  'ipc-misc.ts': misc, 'ipc-mods.ts': mods, 'ipc-packs.ts': packs,
  'ipc-presets.ts': presets, 'ipc-settings.ts': settings, 'ipc-window.ts': windowIpc,
};

const electron = {
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: { openExternal: () => {}, openPath: () => {}, showItemInFolder: () => {} },
  app: { getVersion: () => '0.0.0', getPath: () => ROOT, quit: () => {} },
  clipboard: { writeText: () => {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  BrowserWindow: class { static getAllWindows() { return []; } },
};

test('the list below is every ipc module there is', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /^ipc-.+\.[jt]s$/.test(f));
  assert.deepEqual(files.sort(), Object.keys(MODULES).sort(), 'a new src/ipc-* module goes into MODULES here');
});

test('every handler runs far enough to prove its own names exist', async () => {
  // anything asked of the context answers, so a handler gets past its dependencies and into
  // its own body, which is the only part being examined here
  const ctx = new Proxy({}, { get: () => () => undefined, has: () => true });
  const notDefined: string[] = [];
  for (const [file, mod] of Object.entries(MODULES)) {
    const register = Object.values(mod).find((v) => typeof v === 'function') as ((c: unknown) => void) | undefined;
    assert.ok(register, `${file} exports no register function`);
    const channels = registerAgainst(() => register(ctx), electron);
    assert.ok(channels.size > 0, `${file} registered nothing`);
    for (const [channel, fn] of channels) {
      try {
        await fn({ sender: { send: () => {} } });
      } catch (err) {
        // a stub handing back undefined breaks plenty of handlers, and that is fine. A name
        // the file does not have is not fine, and reads the same to the person clicking.
        if (err instanceof ReferenceError) notDefined.push(`${channel} (${file}): ${err.message}`);
      }
    }
  }
  assert.deepEqual(notDefined, [], notDefined.join('; '));
});
