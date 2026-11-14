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

// The title bar moves the window by a command, not by -webkit-app-region: WebView2 recomputes the
// regions at every step of a resize, about 900 ms each, so the regions are switched off.
test('a press where the CSS marks the bar draggable moves the window, a second one maximizes it', () => {
  const calls: { cmd: string; args: unknown }[] = [];
  const handlers: Record<string, (e: unknown) => void> = {};
  const styles: string[] = [];
  class Element { drag: string; constructor(drag: string) { this.drag = drag; } }
  const window = {
    __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: (cmd: string, args: unknown) => { calls.push({ cmd, args }); return Promise.resolve(); } },
    addEventListener: () => {},
  };
  const document = {
    readyState: 'complete',
    head: { append: (el: { textContent: string }) => styles.push(el.textContent) },
    createElement: () => ({ textContent: '' }),
    addEventListener: (name: string, cb: (e: unknown) => void) => { handlers[name] = cb; },
  };
  const getComputedStyle = (el: Element) => ({ getPropertyValue: (p: string) => (p === '--drag' ? ` ${el.drag}` : '') });
  vm.runInNewContext(SOURCE, { window, document, Element, getComputedStyle, navigator: { userAgent: 'test' }, btoa, atob, console });
  assert.ok(styles.some((s) => s.includes('-webkit-app-region: no-drag !important')), 'the regions are off');
  const press = (drag: string, detail = 1, button = 0) => {
    let prevented = false;
    handlers.mousedown({ button, detail, target: new Element(drag), preventDefault: () => { prevented = true; } });
    return prevented;
  };
  const drags = () => calls.filter((c) => c.cmd === 'mm_drag').map((c) => c.args);
  assert.equal(press('1'), true);
  press('1', 2);
  press('0');
  press('', 1);
  press('1', 1, 2);
  assert.equal(JSON.stringify(drags()), JSON.stringify([{ toggle: false }, { toggle: true }]));
});
