/* The app's window (src/main-window.ts): it fits the screen it opens on, it shows the app's own
 * page and nothing else, and Ctrl +/-/0 scale the content without zooming the chrome.
 *
 * The lock is the part that matters most. The preload hands window.api to whatever page the
 * window holds, so a window that could be navigated would hand the install and run-tool channels
 * to whoever wrote the page it went to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { clampZoom, createMainWindow, windowFit, workAreaFrom, ZOOM_MAX, ZOOM_MIN } from '../src/main-window.ts';
import { withElectron } from './helpers/fake-electron.ts';

const ROOT = path.join(path.sep, 'app');

type Listener = (...args: any[]) => unknown;

/** A BrowserWindow that keeps what it was asked and lets a test fire its events. */
class FakeWindow {
  static last: FakeWindow;
  options: Record<string, any>;
  loaded = '';
  events = new Map<string, Listener>();
  page = new Map<string, Listener>();
  sent: unknown[][] = [];
  openHandler: Listener = () => null;
  webContents = {
    on: (name: string, fn: Listener) => { this.page.set(name, fn); },
    send: (...a: unknown[]) => { this.sent.push(a); },
    setWindowOpenHandler: (fn: Listener) => { this.openHandler = fn; },
  };
  constructor(options: Record<string, any>) { this.options = options; FakeWindow.last = this; }
  loadFile(file: string) { this.loaded = file; }
  on(name: string, fn: Listener) { this.events.set(name, fn); }
}

function open({ uiScale = 1 as unknown, workArea = null as { width: number; height: number } | null, noScreen = false } = {}) {
  const store = new Map<string, unknown>([['uiScale', uiScale]]);
  const opened: string[] = [];
  const said: string[] = [];
  withElectron({
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => { if (noScreen) throw new Error('no display'); return { workAreaSize: { width: 1366, height: 728 } }; } },
    shell: { openExternal: async (url: string) => { opened.push(url); } },
  }, () => createMainWindow({
    appRoot: ROOT,
    settings: { get: ((k: string) => store.get(k)) as never, set: ((k: string, v: unknown) => { store.set(k, v); }) as never },
    diag: (m) => said.push(m),
    workArea,
  }));
  const w = FakeWindow.last;
  /** Fire a page event with a preventable event object; answers whether it was prevented. */
  const fire = (name: string, ...args: unknown[]) => {
    let prevented = false;
    w.page.get(name)!({ preventDefault: () => { prevented = true; } }, ...args);
    return prevented;
  };
  return { w, fire, store, opened, said };
}

test('the window opens on the app page, with the preload isolated from it', () => {
  const { w } = open();
  assert.equal(w.loaded, path.join(ROOT, 'renderer', 'index.html'));
  assert.equal(w.options.webPreferences.preload, path.join(ROOT, 'preload.js'));
  assert.equal(w.options.webPreferences.contextIsolation, true);
  assert.equal(w.options.webPreferences.nodeIntegration, false);
});

test('the window cannot be navigated away, and a web link goes to the browser instead', () => {
  const { fire, opened, said } = open();
  const self = pathToFileURL(path.join(ROOT, 'renderer', 'index.html')).href;
  assert.equal(fire('will-navigate', self), false, 'a reload of its own page is allowed');
  assert.equal(fire('will-navigate', 'https://example.com/guide'), true);
  assert.equal(fire('will-navigate', 'file:///C:/somewhere/else.html'), true);
  assert.deepEqual(opened, ['https://example.com/guide'], 'only the web link is handed to the browser');
  assert.equal(said.length, 2, 'both refusals are in the log');
});

test('window.open is refused, and a webview cannot be attached', () => {
  const { w, fire, opened } = open();
  assert.deepEqual(w.openHandler({ url: 'https://dota2modmanager.com/' }), { action: 'deny' });
  assert.deepEqual(w.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://dota2modmanager.com/']);
  assert.equal(fire('will-attach-webview'), true);
});

test('Ctrl +, - and 0 scale the content within its range and remember it', () => {
  const { w, fire, store } = open({ uiScale: 1.55 });
  const key = (k: string, extra = {}) => fire('before-input-event', { type: 'keyDown', control: true, alt: false, key: k, ...extra });
  assert.equal(key('='), true);
  assert.equal(store.get('uiScale'), ZOOM_MAX, 'not past the top of the range');
  assert.equal(key('-'), true);
  assert.ok(Math.abs((store.get('uiScale') as number) - 1.55) < 1e-9);
  assert.equal(key('0'), true);
  assert.equal(store.get('uiScale'), 1);
  assert.deepEqual(w.sent.map((m) => m[0]), ['ui:zoom', 'ui:zoom', 'ui:zoom'], 'the page is told each time');
  assert.equal(key('s'), false, 'Ctrl+S is left to the page');
  assert.equal(key('=', { alt: true }), false, 'AltGr on some layouts reads as Ctrl+Alt');
  assert.equal(key('=', { type: 'keyUp' }), false);
});

test('the title bar is told when the window is maximized and back', () => {
  const { w } = open();
  w.events.get('maximize')!();
  w.events.get('unmaximize')!();
  assert.deepEqual(w.sent, [['win:maximized', true], ['win:maximized', false]]);
});

test('the window fits a small screen, minimums included, and the designed size needs no screen at all', () => {
  assert.deepEqual(windowFit({ width: 1366, height: 728 }), { width: 1360, height: 728, minWidth: 1020, minHeight: 640 });
  assert.deepEqual(windowFit({ width: 1000, height: 600 }), { width: 1000, height: 600, minWidth: 1000, minHeight: 600 });
  assert.deepEqual(windowFit(null), { width: 1360, height: 860, minWidth: 1020, minHeight: 640 });
  assert.equal(open({ workArea: { width: 1093, height: 582 } }).w.options.height, 582, 'MM_WORKAREA stands in for the screen');
  assert.equal(open().w.options.height, 728, 'otherwise the primary display is asked');
  assert.equal(open({ noScreen: true }).w.options.height, 860, 'and a display that will not answer is the designed size');
});

test('a work area is read from "WxH" and nothing else', () => {
  assert.deepEqual(workAreaFrom('1366x728'), { width: 1366, height: 728 });
  assert.equal(workAreaFrom('1366 x 728'), null);
  assert.equal(workAreaFrom(undefined), null);
});

test('a scale out of range, or not a number, becomes one the layout can take', () => {
  assert.equal(clampZoom(5), ZOOM_MAX);
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom('1.2'), 1.2);
  assert.equal(clampZoom('big'), 1);
  assert.equal(clampZoom(-1), 1);
});
