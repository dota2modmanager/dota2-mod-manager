/* The wire between the window and the process behind it, checked as a contract.
 *
 * There are three sides to every channel and nothing made them agree: preload.js says what the
 * renderer may call, some module in src/ registers the handler, and the screens call through
 * whatever name preload happens to expose. Get any two out of step and the failure is a
 * TypeError at the moment somebody clicks, which is exactly where nobody is looking.
 *
 * It has already cost time twice. Splitting registerIpc out of main.js gave one module the
 * window as a value rather than a getter, so win:isMaximized threw on its first call; and a
 * probe written against `api.schema.refresh` - a name preload does not have - looked like a
 * regression for several minutes because a renderer-side TypeError and a main-side handler
 * failure read almost the same.
 *
 * So: every channel the renderer can reach has a handler, every handler is reachable, and no
 * channel is registered twice. None of this needs the app running.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Files that register handlers: the main process and everything it hands the job to. */
const HANDLER_FILES = [
  'src/main.ts',
  ...fs.readdirSync(path.join(ROOT, 'src'))
    .filter((f) => /^ipc-.+\.[jt]s$/.test(f))
    .map((f) => `src/${f}`),
  'src/uninstall-window.ts',
];

const CHANNEL = /['"]([a-z][a-zA-Z]*:[a-zA-Z]+)['"]/;

/** Every channel name passed to ipcMain.handle or ipcMain.on, with the file it came from. */
function handlers() {
  const found = new Map();
  const dupes = [];
  for (const file of HANDLER_FILES) {
    for (const m of read(file).matchAll(/ipcMain\.(?:handle|on)\(\s*([^,)]+)/g)) {
      const name = (m[1].match(CHANNEL) || [])[1];
      if (!name) continue;
      if (found.has(name)) dupes.push({ name, first: found.get(name), again: file });
      else found.set(name, file);
    }
  }
  return { found, dupes };
}

/** Every channel the renderer can reach through the preload bridge. */
function exposed() {
  const out = new Map();
  const src = read('preload.js');
  for (const m of src.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*([^,)]+)/g)) {
    const name = (m[1].match(CHANNEL) || [])[1];
    if (name) out.set(name, 'preload.js');
  }
  // the uninstall window has a bridge of its own
  for (const m of read('preload-uninstall.js').matchAll(/ipcRenderer\.(?:invoke|send)\(\s*([^,)]+)/g)) {
    const name = (m[1].match(CHANNEL) || [])[1];
    if (name) out.set(name, 'preload-uninstall.js');
  }
  return out;
}

/* Channels the main process pushes to the window rather than answering. They are sent with
 * webContents.send and listened for with ipcRenderer.on, so neither side above sees them. */
const PUSH_ONLY = new Set(
  [...read('preload.js').matchAll(/ipcRenderer\.on\(\s*['"]([a-z][\w-]*)['"]/g)].map((m) => m[1]),
);

test('every channel the renderer can call has a handler behind it', () => {
  const { found } = handlers();
  const gaps = [...exposed()].filter(([name]) => !found.has(name));
  assert.deepEqual(gaps, [], gaps.length
    ? `exposed with nothing to answer: ${gaps.map(([n, f]) => `${n} (${f})`).join(', ')}`
    : '');
});

test('every handler is reachable from the renderer', () => {
  /* A handler nothing can call is either dead or a channel somebody forgot to expose, and the
   * second is the expensive one: the feature looks written and does nothing. */
  const { found } = handlers();
  const reach = exposed();
  const orphans = [...found].filter(([name]) => !reach.has(name) && !PUSH_ONLY.has(name));
  assert.deepEqual(orphans, [], orphans.length
    ? `registered but unreachable: ${orphans.map(([n, f]) => `${n} (${f})`).join(', ')}`
    : '');
});

test('no channel is registered twice', () => {
  /* ipcMain.handle throws on a second registration for the same name, so this would be a crash
   * at startup - but only on the path that reaches both, which after the split is easy to miss
   * while moving handlers between files. */
  const { dupes } = handlers();
  assert.deepEqual(dupes, [], dupes.length
    ? dupes.map((d) => `${d.name}: ${d.first} and ${d.again}`).join('; ')
    : '');
});

test('the split left every ipc module wired into main', () => {
  /* A module can be perfect and still never run. Every src/ipc-*.ts has to be imported and
   * called from src/ipc.ts, and src/main.ts has to call that, or a whole set of channels quietly
   * does not exist. */
  const registry = read('src/ipc.ts');
  const missing = [];
  if (!/^import \{ registerIpc \} from '\.\/ipc\.ts';/m.test(read('src/main.ts')) || !/registerIpc\(ctx\)/.test(read('src/main.ts'))) {
    missing.push('src/main.ts does not import and call registerIpc');
  }
  for (const file of HANDLER_FILES) {
    if (!file.startsWith('src/ipc-')) continue;
    const base = path.basename(file).replace(/\.[jt]s$/, '');
    const fn = (read(file).match(/^(?:export )?function (register\w+)/m) || [])[1];
    if (!fn) { missing.push(`${file}: no register function`); continue; }
    if (!registry.includes(`/${base}.ts'`)) missing.push(`${file}: not imported by src/ipc.ts`);
    else if (!new RegExp(`${fn}\\s*\\(`).test(registry)) missing.push(`${file}: ${fn} never called`);
  }
  assert.deepEqual(missing, [], missing.join('; '));
});

test('the channels are worth counting, so a silent emptying of this test is visible', () => {
  // If a rename made the regexes match nothing, every assertion above would pass on empty sets.
  // the modules first: when they moved from .js to .ts, a filter still asking for .js found none
  assert.ok(HANDLER_FILES.filter((f) => f.startsWith('src/ipc-')).length >= 9, 'the nine src/ipc-* modules were found');
  const { found } = handlers();
  assert.ok(found.size > 80, `expected 80+ handlers, found ${found.size}`);
  assert.ok(exposed().size > 80, `expected 80+ exposed channels, found ${exposed().size}`);
});

/* That each handler can actually run is test/ipc-handlers-run.test.ts: it has to import the
 * modules as TypeScript for their coverage to count, and this file reads them as text. */

/*
 * And that the main process hands each module everything the module unpacks.
 *
 * A name a module destructures out of its context and never receives is `undefined`, and the
 * first call on it throws "x is not a function". That is the same failure as `blocked is not
 * defined` wearing a different message, and no linter can see it: the name is a parameter, so
 * it is defined as far as the file is concerned.
 *
 * This used to be read off the text of main.js, name by name. Since 2026-09-30 the type checker
 * holds it: each module takes a Pick of AppContext (src/app-context.ts), so it cannot unpack a
 * name outside that Pick, and src/main.ts builds one `ctx: AppContext` and hands the same object
 * to src/ipc.ts, which hands it to every module, so it cannot leave a name out. What is read here
 * is that the chain still has that shape; a module handed a hand-made object instead would slip
 * past the checker's guarantee.
 */
test('every ipc module is handed everything it unpacks', () => {
  const main = read('src/main.ts');
  assert.match(main, /const ctx: AppContext = \{/, 'src/main.ts no longer builds one typed context');
  assert.match(main, /registerIpc\(ctx\);/, 'src/main.ts does not hand src/ipc.ts the whole context');
  const registry = read('src/ipc.ts');
  assert.match(registry, /export function registerIpc\(ctx: AppContext\): void/, 'src/ipc.ts no longer takes the whole context');
  const gaps = [];
  for (const file of HANDLER_FILES.filter((f) => f.startsWith('src/ipc-'))) {
    const src = read(file);
    const sig = src.match(/export function (register\w+)\(\{[\s\S]*?\}: Pick<AppContext, [^>]+>\): void/);
    if (!sig) { gaps.push(`${file}: its register function no longer takes a Pick of AppContext`); continue; }
    if (!new RegExp(`${sig[1]}\\(ctx\\);`).test(registry)) gaps.push(`${file}: src/ipc.ts does not hand ${sig[1]} the whole context`);
  }
  assert.deepEqual(gaps, [], gaps.join('; '));
});
