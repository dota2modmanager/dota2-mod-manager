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
import os from 'node:os';
import path from 'node:path';
import * as compiler from '../src/ipc-compiler.ts';
import * as creator from '../src/ipc-creator.ts';
import * as diagnostics from '../src/ipc-diagnostics.ts';
// the grid channels look for Steam where it installs by default: not the real one on this machine
import './helpers/no-steam.ts';
import * as game from '../src/ipc-game.ts';
import * as grid from '../src/ipc-grid.ts';
import * as foreign from '../src/ipc-foreign.ts';
import * as library from '../src/ipc-library.ts';
import * as looks from '../src/ipc-looks.ts';
import * as misc from '../src/ipc-misc.ts';
import * as mods from '../src/ipc-mods.ts';
import * as packs from '../src/ipc-packs.ts';
import * as presets from '../src/ipc-presets.ts';
import * as preview3d from '../src/ipc-preview3d.ts';
import * as pumpkin from '../src/ipc-pumpkin.ts';
import * as settings from '../src/ipc-settings.ts';
import * as sounds from '../src/ipc-sounds.ts';
import * as background from '../src/ipc-background.ts';
import * as effects from '../src/ipc-effects.ts';
import * as hud from '../src/ipc-hud.ts';
import * as rank from '../src/ipc-rank.ts';
import * as decor from '../src/ipc-decor.ts';
import * as paint from '../src/ipc-paint.ts';
import * as windowIpc from '../src/ipc-window.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
// what a handler keeps for the user (the author's drafts) goes to a folder of its own, not the checkout
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ipc-run-'));

const MODULES: Record<string, Record<string, unknown>> = {
  'ipc-compiler.ts': compiler, 'ipc-creator.ts': creator, 'ipc-diagnostics.ts': diagnostics, 'ipc-foreign.ts': foreign, 'ipc-game.ts': game, 'ipc-grid.ts': grid, 'ipc-library.ts': library, 'ipc-looks.ts': looks,
  'ipc-misc.ts': misc, 'ipc-mods.ts': mods, 'ipc-packs.ts': packs,
  'ipc-effects.ts': effects, 'ipc-presets.ts': presets, 'ipc-preview3d.ts': preview3d, 'ipc-pumpkin.ts': pumpkin, 'ipc-settings.ts': settings, 'ipc-sounds.ts': sounds, 'ipc-background.ts': background, 'ipc-hud.ts': hud, 'ipc-rank.ts': rank, 'ipc-decor.ts': decor, 'ipc-paint.ts': paint, 'ipc-window.ts': windowIpc,
};

const electron = {
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: { openExternal: () => {}, openPath: () => {}, showItemInFolder: () => {} },
  app: { getVersion: () => '0.0.0', getPath: (name: string) => (name === 'userData' ? USER_DATA : ROOT), quit: () => {} },
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
