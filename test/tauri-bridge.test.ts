// The Tauri bridge (src-tauri/src/bridge.js) tells the shell the page has loaded only once the
// page's own scripts have run and the bridge listens for the shell's events: told any earlier,
// a d2mm:// link the app was started by reached no subscriber and the mod's window never opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'bridge.js'), 'utf8');

function page(readyState: string) {
  const calls: string[] = [];
  const onLoad: (() => void)[] = [];
  let release: () => void = () => {};
  const listening = new Promise<void>((r) => { release = r; });
  const window: Record<string, unknown> = {
    __TAURI_INTERNALS__: {
      transformCallback: () => 1,
      invoke: (cmd: string, args: { event?: string }) => {
        calls.push(args?.event ? `${cmd} ${args.event}` : cmd);
        // the listener is registered a moment later, as Tauri answers
        return args?.event === 'mm' ? listening : Promise.resolve();
      },
    },
    addEventListener: (name: string, cb: () => void) => { if (name === 'load') onLoad.push(cb); },
  };
  const document = { readyState, addEventListener: () => {} };
  vm.runInNewContext(SOURCE, { window, document, navigator: { userAgent: 'test' }, btoa, atob, console });
  return { calls, load: () => onLoad.forEach((cb) => cb()), release };
}

const tick = () => new Promise((r) => setImmediate(r));

test('the page is said to be loaded after its load event and once the events are listened to', async () => {
  const p = page('loading');
  await tick();
  assert.ok(!p.calls.includes('mm_loaded'), 'not before the page loaded');
  p.load();
  await tick();
  assert.ok(!p.calls.includes('mm_loaded'), 'not before the listener is in place');
  p.release();
  await tick();
  assert.equal(p.calls.filter((c) => c === 'mm_loaded').length, 1);
  assert.ok(p.calls.indexOf('plugin:event|listen mm') < p.calls.indexOf('mm_loaded'));
});

test('a page that has already loaded is told so at once', async () => {
  const p = page('complete');
  p.release();
  await tick();
  assert.deepEqual(p.calls.filter((c) => c === 'mm_loaded'), ['mm_loaded']);
});
