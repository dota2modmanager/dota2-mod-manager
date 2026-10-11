/* The gate in front of every channel (src/window-guard.ts, src/channel-args.ts).
 *
 * Three promises, each held here rather than trusted. A channel cannot exist without an argument
 * check: the registry is compared with every channel the source registers and every one the
 * preload bridges send on. A call from anything but the top frame of the app's own page is
 * refused before its handler runs. And the checks refuse what they are there to refuse - another
 * key in the settings, a file: address handed to the browser, an object with keys nobody sends -
 * while letting through a call of every channel the way the window really makes it, so the gate
 * cannot turn into one that refuses the app itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';

import { CHANNEL_ARGS, WINDOW_SETTINGS, checkArgs } from '../src/channel-args.ts';
import { appPages, createIpcGuard, guardTheApp, pageKey } from '../src/window-guard.ts';
import { registerMiscIpc } from '../src/ipc-misc.ts';
import { registerAgainst, type Handler } from './helpers/fake-electron.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.ts$/.test(e.name)) out.push(rel);
  }
  return out;
}

const registered = new Set<string>();
for (const file of sourceFiles('src')) {
  for (const m of read(file).matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)) registered.add(m[1]);
}
const sent = new Set<string>();
for (const file of ['preload.js', 'preload-uninstall.js']) {
  for (const m of read(file).matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)) sent.add(m[1]);
}

const PAGE = pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).href;
const REMOVAL = pathToFileURL(path.join(ROOT, 'renderer', 'uninstall.html')).href;
const top = (url: string) => ({ senderFrame: { url, parent: null } });

test('every channel the app registers has an argument check, and the registry names no other', () => {
  assert.ok(registered.size > 90, `found ${registered.size} channels in src/, so the scan still works`);
  const missing = [...registered].filter((c) => !Object.hasOwn(CHANNEL_ARGS, c));
  const stale = Object.keys(CHANNEL_ARGS).filter((c) => !registered.has(c));
  assert.deepEqual(missing, [], `add these to src/channel-args.ts: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `these are in src/channel-args.ts but nothing registers them: ${stale.join(', ')}`);
});

test('every channel the preload bridges send on is one with a check', () => {
  assert.ok(sent.size > 90);
  assert.deepEqual([...sent].filter((c) => !Object.hasOwn(CHANNEL_ARGS, c)), []);
});

test('a channel registered through the guard without a check is refused at start, not at the first call', () => {
  const guard = createIpcGuard({ pages: [PAGE], log: () => {} });
  const fake = { handle: () => {}, on: () => {} };
  guard.install(fake as never);
  assert.throws(() => (fake as unknown as { handle: (c: string, f: Handler) => void }).handle('mods:secret', () => 1), /no argument check/);
  assert.throws(() => (fake as unknown as { on: (c: string, f: Handler) => void }).on('mods:secret', () => 1), /no argument check/);
});

test('only the top frame of one of the app\'s pages may call', () => {
  const guard = createIpcGuard({ pages: [PAGE, REMOVAL], log: () => {} });
  assert.equal(guard.refuse(top(PAGE)), null);
  assert.equal(guard.refuse(top(`${PAGE}?x=1#/library`)), null, 'a query or a fragment is the same page');
  assert.equal(guard.refuse(top(REMOVAL)), null);
  assert.match(String(guard.refuse({ senderFrame: { url: PAGE, parent: {} } })), /frame inside/);
  assert.match(String(guard.refuse({ senderFrame: null })), /gone/);
  assert.match(String(guard.refuse({})), /gone/);
  for (const foreign of [
    'https://dota2modmanager.com/',
    'http://localhost:5173/',
    pathToFileURL(path.join(os.tmpdir(), 'index.html')).href,
    pathToFileURL(path.join(ROOT, 'out', 'renderer', 'other.html')).href,
    'data:text/html,<script>window.api</script>',
    'about:blank',
    'not an address',
  ]) assert.match(String(guard.refuse(top(foreign))), /not the app's/, foreign);
});

test('the dev server is the app\'s page only when it is the page the window loads', () => {
  const dev = createIpcGuard({ pages: ['http://localhost:5173/', REMOVAL], log: () => {} });
  assert.equal(dev.refuse(top('http://localhost:5173/')), null);
  assert.match(String(dev.refuse(top('http://localhost:5174/'))), /not the app's/);
  assert.match(String(dev.refuse(top(PAGE))), /not the app's/, 'the built page is not the dev page');
});

test('a file page is compared as Windows compares paths', { skip: process.platform !== 'win32' }, () => {
  const guard = createIpcGuard({ pages: [PAGE], log: () => {} });
  assert.equal(guard.refuse(top(PAGE.toUpperCase().replace('FILE:', 'file:'))), null);
  assert.equal(pageKey(PAGE), pageKey(PAGE.replace(/\//g, '/')));
});

test('a refused call never reaches its handler, and says why in the log', async () => {
  const logged: string[] = [];
  const guard = createIpcGuard({ pages: [PAGE], log: (m) => logged.push(m) });
  const channels = new Map<string, Handler>();
  const fake = { handle: (c: string, f: Handler) => channels.set(c, f), on: (c: string, f: Handler) => channels.set(c, f) };
  guard.install(fake as never);
  let ran = 0;
  (fake as unknown as { handle: (c: string, f: Handler) => void }).handle('mods:remove', () => { ran++; return { ok: true }; });
  (fake as unknown as { on: (c: string, f: Handler) => void }).on('diag:rendererError', () => { ran++; });
  const remove = channels.get('mods:remove') as Handler;
  const report = channels.get('diag:rendererError') as Handler;

  assert.deepEqual(await remove(top(PAGE), 'some-id'), { ok: true });
  assert.equal(ran, 1);
  assert.throws(() => remove(top('https://evil.example/'), 'some-id'), /refused/);
  assert.throws(() => remove(top(PAGE), { id: 'x' }), /refused/);
  assert.throws(() => remove(top(PAGE), 'some-id', 'extra'), /refused/);
  report(top('https://evil.example/'), 'boom');
  report(top(PAGE), 42);
  assert.equal(ran, 1, 'none of the refused calls ran');
  assert.equal(logged.length, 5);
  assert.ok(logged.every((l) => l.startsWith('ipc: refused ')));
});

/* One call of every channel, made the way the window makes it. The gate must let each through:
   a check stricter than the window is a button that stopped working. */
const BYTES = new Uint8Array([1, 2, 3]);
const ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const VALID: Record<string, unknown[][]> = {
  'win:minimize': [[]], 'win:maximize': [[]], 'win:close': [[]], 'win:isMaximized': [[]],
  'app:version': [[]], 'app:notes': [['ru'], ['en']], 'app:notesSeen': [[]],
  'update:install': [[]], 'update:fetchPortable': [[]], 'update:revealPortable': [['C:\\Games\\Dota-2-Mod-Manager-Portable.exe']],
  'beta:state': [[]], 'beta:set': [[true]], 'game:launch': [[]], 'ui:setZoom': [[1.25]],
  'settings:get': [[]], 'settings:detectDota': [[]], 'settings:browseDota': [[]],
  'settings:set': [['discordPresence', false], ['favorites', ['heroes|Arcana|']], ['langPromptSeen', true],
    ['panels', { library: { width: 320 } }], ['panels', null], ['showAdult', true], ['theme', 'ursa'],
    ['toolsPromptSeen', true], ['uiLang', 'en'], ['uiLang', 'ru']],
  'settings:moveLangFiles': [['russian'], [undefined], []],
  'presence:view': [['catalog']], 'account:signIn': [[]], 'account:signOut': [[]],
  'catalog:load': [[false], [true], [undefined], []], 'catalog:terrainAges': [[]],
  'mods:install': [[{ categoryId: 'heroes', name: 'Arcana', styleLabel: null, fileRef: 'heroes/arcana.zip', preview: 'https://example.org/a.jpg' }],
    [{ categoryId: 'heroes', name: 'Arcana', styleLabel: undefined, fileRef: undefined, preview: undefined }]],
  'mods:list': [[]], 'mods:update': [[ID]], 'mods:switchOffStaleTerrains': [[]], 'mods:clearPrePatch': [[ID]],
  'mods:importDialog': [[]], 'mods:importFolderDialog': [[]],
  'mods:importPaths': [[['C:\\Users\\me\\Downloads\\mod.zip', 'D:\\mods\\pak01_dir.vpk']]],
  'mods:importBuffers': [[[{ name: 'mod.vpk', data: BYTES }, { name: 'other.zip', data: BYTES.buffer }]]],
  'mods:exportSingle': [[ID]], 'mods:unpackToFolder': [[ID]], 'mods:masterState': [[]], 'mods:setMaster': [[false]],
  'mods:setEnabled': [[ID, true]], 'mods:setEnabledMany': [[[ID, ID], false]], 'mods:remove': [[ID]], 'mods:removeMany': [[[ID]]],
  'mods:move': [[ID, -1], [ID, 1]], 'mods:reorder': [[ID, 0], [ID, 41]], 'mods:mapsOwner': [[]],
  'mods:externalSetEnabled': [['pak90_dir.vpk', true]], 'mods:externalRemove': [['pak90_dir.vpk']],
  'mods:splitMod': [[ID]], 'mods:splitExternal': [['pak90_dir.vpk']],
  'mods:adoptMod': [[ID, null], [ID, 'data:image/png;base64,AAAA']], 'mods:adoptExternal': [['pak90_dir.vpk', null]],
  'mods:adoptFont': [['Radiance', null]], 'mods:adoptCursor': [[null]],
  'packs:combine': [[{ name: 'My pack', modIds: [ID, ID] }]], 'packs:addMembers': [[ID, [ID]]],
  'packs:setMemberEnabled': [[ID, ID, false]], 'packs:removeMember': [[ID, ID]], 'packs:extractMembers': [[ID, [ID]]], 'packs:disband': [[ID]],
  'presets:list': [[]], 'presets:save': [['Tournament']], 'presets:update': [[ID]], 'presets:rename': [[ID, 'New name']],
  'presets:delete': [[ID]], 'presets:apply': [[ID]], 'presets:resolve': [[ID]], 'presets:exportPlan': [[ID]], 'presets:shareLink': [[ID]],
  'presets:export': [[ID, { skip: [ID], author: 'me', note: 'gg' }]], 'presets:importDialog': [[]],
  'presets:importFile': [['C:\\Users\\me\\Downloads\\build.d2mm']],
  'config:state': [[]], 'config:noticeSeen': [['notice-2026-10']],
  'patch:state': [[]], 'patch:repairState': [[]], 'patch:repairNow': [[]], 'patch:repairSeen': [[]], 'patch:setEnabled': [[true]],
  'schema:refresh': [[]], 'cosmetics:slots': [[]],
  'cosmetics:heroPortraits': [[['1', '2']], [[1, 2]]], 'cosmetics:heroPortraitsByName': [[['npc_dota_hero_axe']]],
  'cosmetics:icons': [[['Shade of the Abyss']]],
  'cosmetics:pick': [['weather', '5810', 'Weather: Ash', ''], ['hero_axe_weapon', 4520, 'Axe', '1,2']],
  'cosmetics:pickSet': [['20510'], [20510]],
  'preview:video': [['heroes|Arcana']], 'preview:frame': [['heroes|Arcana', BYTES]],
  'tools:state': [[]], 'tools:install': [['Source2Viewer']], 'tools:remove': [['Source2Viewer']],
  'arcana:state': [[]], 'arcana:install': [[[255, 0, 128], 'mod'], [[1, 2, 3], 'recolor']],
  'misc:openLangFolder': [[]], 'misc:openToolsFolder': [[], ['Compiler']],
  'misc:openExternal': [['https://dota2modmanager.com/docs/'], ['http://example.org'], [undefined]],
  'misc:cacheSize': [[]], 'misc:clearCache': [[]], 'misc:runTool': [['Compiler']],
  'diag:export': [[]], 'diag:rendererError': [['TypeError: x is undefined']],
  'uninstall:plan': [[]], 'uninstall:run': [[{ revert: true, mods: false, data: false }], [{ revert: true, mods: true, data: true }], [null]], 'uninstall:done': [[true]], 'uninstall:cancel': [[]],
};

test('a call of every channel, as the window makes it, gets through', () => {
  assert.deepEqual(Object.keys(CHANNEL_ARGS).filter((c) => !VALID[c]), [], 'every channel has an example of a real call here');
  for (const [channel, calls] of Object.entries(VALID)) {
    for (const args of calls) assert.equal(checkArgs(channel, args), null, `${channel}(${JSON.stringify(args)})`);
  }
});

/* What a script in the page could try, and the gate refuses. */
const HOSTILE: [string, unknown[], RegExp][] = [
  ['settings:set', ['dotaGamePath', 'C:\\Windows'], /may not set dotaGamePath/],
  ['settings:set', ['account', { id: '1', username: 'beta tester' }], /may not set account/],
  ['settings:set', ['schemaStamp', null], /may not set/],
  ['settings:set', ['__proto__', {}], /may not set/],
  ['settings:set', ['constructor', {}], /may not set/],
  ['settings:set', ['showAdult', 'yes'], /showAdult/],
  ['settings:set', ['uiLang', '../../etc'], /language code/],
  ['settings:set', ['favorites', 'all'], /list/],
  ['misc:openExternal', ['file:///C:/Windows/System32/calc.exe'], /http or https/],
  ['misc:openExternal', ['javascript:alert(1)'], /http or https/],
  ['misc:openExternal', ['ms-settings:'], /http or https/],
  ['misc:openExternal', ['\\\\server\\share\\run.exe'], /address/],
  ['misc:openToolsFolder', [{ toString: () => '../..' }], /string/],
  ['misc:runTool', [''], /string/],
  ['mods:install', [{ categoryId: 'heroes', name: 'x', styleLabel: null, fileRef: 'a', preview: null, dest: 'C:\\' }], /unexpected key dest/],
  ['mods:install', [{ categoryId: 42, name: 'x' }], /categoryId/],
  ['mods:install', ['heroes'], /object/],
  ['mods:remove', [ID, 'extra'], /takes 1/],
  ['mods:remove', [42], /string/],
  ['mods:remove', [''], /string/],
  ['mods:removeMany', [Array.from({ length: 10001 }, () => ID)], /at most/],
  ['mods:importBuffers', [[{ name: 'x.vpk', data: 'not bytes' }]], /bytes/],
  ['mods:importBuffers', [Array.from({ length: 1001 }, () => ({ name: 'x', data: BYTES }))], /at most/],
  ['mods:importPaths', ['C:\\one.zip'], /list/],
  ['mods:move', [ID, 7], /number from -1 to 1/],
  ['mods:reorder', [ID, Number.NaN], /number/],
  ['ui:setZoom', [Infinity], /number/],
  ['arcana:install', [[255, 0, 0], 'everything'], /one of/],
  ['arcana:install', [[255, 0, 0, 9], 'mod'], /at most 3/],
  ['preview:frame', ['k', 'not bytes'], /bytes/],
  ['presets:export', [ID, { skip: [], author: 'me', note: '', path: 'C:\\' }], /unexpected key path/],
  ['uninstall:run', [{ revert: 'yes' }], /revert/],
  ['diag:rendererError', ['x'.repeat(65 * 1024)], /string/],
  ['nonexistent:channel', [], /no argument check/],
];

test('what a script in the page could try is refused before any handler runs', () => {
  for (const [channel, args, why] of HOSTILE) {
    assert.match(String(checkArgs(channel, args)), why, `${channel}(${JSON.stringify(args).slice(0, 80)})`);
  }
});

test('the window may set the keys it has a control for, and no others', () => {
  const settingsFile = read('src/settings.ts');
  for (const key of Object.keys(WINDOW_SETTINGS)) assert.match(settingsFile, new RegExp(`\\b${key}:`), `${key} is a real setting`);
  const set = new Set<string>();
  for (const file of sourceFiles('renderer')) {
    for (const m of read(file).matchAll(/api\.settings\.set\('([^']+)'/g)) set.add(m[1]);
  }
  assert.deepEqual([...set].sort(), Object.keys(WINDOW_SETTINGS).sort(), 'the list is exactly what the window sets');
});

test('no check throws, whatever it is handed', () => {
  const channels = Object.keys(CHANNEL_ARGS);
  fc.assert(fc.property(fc.constantFrom(...channels), fc.array(fc.anything({ withBigInt: true, withTypedArray: true, withMap: true }), { maxLength: 5 }), (channel, args) => {
    const out = checkArgs(channel, args);
    return out === null || typeof out === 'string';
  }), { numRuns: 3000 });
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  assert.match(String(checkArgs('settings:set', ['panels', loop])), /JSON/);
});

test('the browser is asked for two permissions at most, and only by the app\'s pages', () => {
  const guard = createIpcGuard({ pages: [PAGE], log: () => {} });
  let request: ((wc: unknown, p: string, cb: (ok: boolean) => void, d: unknown) => void) | null = null;
  let check: ((wc: unknown, p: string, o: string, d: unknown) => boolean) | null = null;
  guard.permissions({
    setPermissionRequestHandler: (fn: typeof request) => { request = fn; },
    setPermissionCheckHandler: (fn: typeof check) => { check = fn; },
  } as never);
  const ask = (permission: string, url: string) => {
    let answer: boolean | null = null;
    request!({ getURL: () => url }, permission, (ok) => { answer = ok; }, { requestingUrl: url });
    return answer;
  };
  assert.equal(ask('clipboard-sanitized-write', PAGE), true);
  assert.equal(ask('fullscreen', PAGE), true);
  for (const p of ['media', 'geolocation', 'notifications', 'openExternal', 'hid', 'serial', 'usb', 'clipboard-read']) {
    assert.equal(ask(p, PAGE), false, p);
  }
  assert.equal(ask('fullscreen', 'https://evil.example/'), false);
  assert.equal(check!({ getURL: () => PAGE }, 'clipboard-sanitized-write', 'file://', { requestingUrl: PAGE }), true);
  assert.equal(check!({ getURL: () => PAGE }, 'media', 'file://', { requestingUrl: PAGE }), false);
  assert.equal(check!(null, 'fullscreen', '', {}), false);
});

test('every web contents is locked: no webview, no new window, no page but the app\'s', () => {
  const guard = createIpcGuard({ pages: [PAGE], log: () => {} });
  const on = new Map<string, (e: { preventDefault: () => void }, url: string) => void>();
  let opener: (() => { action: string }) | null = null;
  guard.lock({ on: (ev: string, fn: never) => { on.set(ev, fn); }, setWindowOpenHandler: (fn: never) => { opener = fn; } } as never);
  const prevented = (event: string, url = '') => {
    let p = false;
    on.get(event)!({ preventDefault: () => { p = true; } }, url);
    return p;
  };
  assert.equal(prevented('will-attach-webview'), true);
  assert.equal(prevented('will-navigate', 'https://evil.example/'), true);
  assert.equal(prevented('will-navigate', 'file:///C:/Windows/'), true);
  assert.equal(prevented('will-navigate', PAGE), false, 'a reload of the app\'s page goes through');
  assert.deepEqual(opener!(), { action: 'deny' });
});

test('every window the app opens isolates its page and runs it in the sandbox', () => {
  let windows = 0;
  for (const file of sourceFiles('src')) {
    const text = read(file);
    for (const m of text.matchAll(/new BrowserWindow\(\{/g)) {
      windows++;
      const block = text.slice(m.index, text.indexOf('});', m.index));
      assert.match(block, /contextIsolation: true/, file);
      assert.match(block, /nodeIntegration: false/, file);
      assert.match(block, /sandbox: true/, file);
      assert.doesNotMatch(block, /webSecurity: false|webviewTag: true|allowRunningInsecureContent: true|nodeIntegrationInSubFrames: true/, file);
    }
  }
  assert.equal(windows, 2, 'the main window and the removal window');
});

test('the guard is in place before any channel is registered or any window opened', () => {
  const main = read('src/main.ts');
  const start = main.indexOf('async function start()');
  const at = (s: string) => { const i = main.indexOf(s, start); assert.ok(i > 0, s); return i; };
  const installed = at('guardTheApp({ app, ipcMain, session,');
  assert.ok(installed < at('uninstallFlow('), 'before the removal window registers its channels');
  assert.ok(installed < at('registerIpc(ctx)'));
  assert.ok(installed < at("ipcMain.handle('game:launch'"));
  assert.ok(installed < at('createMainWindow('));
});

test('put up whole, the guard wraps the channels, answers permissions and locks new web contents', () => {
  const calls: string[] = [];
  const fake = { handle: () => {}, on: () => {} };
  let created: ((e: unknown, c: unknown) => void) | null = null;
  const guard = guardTheApp({
    app: { isPackaged: true, on: (ev: string, fn: never) => { calls.push(ev); created = fn; } } as never,
    ipcMain: fake as never,
    session: { defaultSession: { setPermissionRequestHandler: () => calls.push('request'), setPermissionCheckHandler: () => calls.push('check') } } as never,
    appRoot: ROOT,
    devUrl: 'http://localhost:5173/',
    log: () => {},
  });
  assert.throws(() => (fake as unknown as { handle: (c: string, f: Handler) => void }).handle('nope', () => 1), /no argument check/);
  assert.deepEqual(calls, ['request', 'check', 'web-contents-created']);
  let locked = 0;
  created!({}, { on: () => { locked++; }, setWindowOpenHandler: () => { locked++; } });
  assert.equal(locked, 3);
  assert.equal(guard.refuse(top(PAGE)), null, 'a packaged app has the built page');
  assert.match(String(guard.refuse(top('http://localhost:5173/'))), /not the app's/, 'and never the dev server');
  assert.deepEqual(appPages({ appRoot: ROOT, isPackaged: false, devUrl: 'http://localhost:5173/' }), ['http://localhost:5173/', REMOVAL]);
});

test('a tool folder opens only when the library installed it, and the browser gets web addresses only', async () => {
  const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-tools-'));
  const opened: string[] = [];
  const external: string[] = [];
  const channels = registerAgainst(() => registerMiscIpc({
    installer: { toolsDir, langFolder: () => toolsDir } as never,
    library: { list: () => [{ files: [{ root: 'tools', relPath: 'Compiler' }] }] } as never,
  }), { shell: { openPath: (p: string) => { opened.push(p); return Promise.resolve(''); }, openExternal: (u: string) => { external.push(u); } } });
  try {
    const open = channels.get('misc:openToolsFolder') as Handler;
    assert.deepEqual(await open({}, 'Compiler'), { ok: true });
    assert.equal(opened.pop(), path.join(toolsDir, 'Compiler'));
    for (const hostile of ['..', '../..', '..\\..\\Windows\\System32\\calc.exe', 'Compiler/../../x', 'Other']) {
      const r = await open({}, hostile);
      assert.ok(r.error, hostile);
    }
    assert.deepEqual(opened, [], 'nothing outside the installed tool was opened');
    assert.deepEqual(await open({}), { ok: true });
    assert.equal(opened.pop(), toolsDir);

    const ext = channels.get('misc:openExternal') as Handler;
    for (const url of ['https://dota2modmanager.com/', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'HTTPS://EXAMPLE.ORG/x', 'not a url']) await ext({}, url);
    assert.deepEqual(external, ['https://dota2modmanager.com/', 'HTTPS://EXAMPLE.ORG/x']);
  } finally {
    fs.rmSync(toolsDir, { recursive: true, force: true });
  }
});

test('the objects the window sends fit their checks: every key it puts in one is a key the check knows', () => {
  /* On 2026-10-11 the removal window's OK button was refused by the gate: renderer/uninstall.js
     sends { revert, mods, data } and the check, written from the handler's type, knew only revert
     and mods. Nothing above caught it, because the examples were written the same way. So the keys
     are read from the code that sends them. */
  const removal = read('renderer/uninstall.js');
  const boxes = removal.slice(removal.indexOf('const boxes = () => ({'), removal.indexOf('});', removal.indexOf('const boxes = () => ({')));
  const keys = [...boxes.matchAll(/^\s*(\w+): !!/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['data', 'mods', 'revert'], 'the removal window still sends its boxes the way this reads them');
  assert.equal(checkArgs('uninstall:run', [Object.fromEntries(keys.map((k) => [k, true]))]), null);

  const install = read('renderer/views/catalog/install.ts');
  const sent = /window\.api\.mods\.install\(\{([^}]*)\}\)/.exec(install)?.[1] || '';
  const fields = sent.split(',').map((f) => f.trim().split(':')[0].trim()).filter(Boolean);
  assert.ok(fields.length >= 4, `read ${fields.join(', ')} from the install call`);
  assert.equal(checkArgs('mods:install', [Object.fromEntries(fields.map((k) => [k, k === 'categoryId' ? 'heroes' : 'x']))]), null, fields.join(', '));
});
