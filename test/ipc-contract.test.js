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

/** Files that register handlers: main.js and everything it hands the job to. */
const HANDLER_FILES = [
  'main.js',
  ...fs.readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.startsWith('ipc-') && f.endsWith('.js'))
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
  /* A module can be perfect and still never run. Every src/ipc-*.js has to be required and
   * called from main.js, or its whole set of channels quietly does not exist. */
  const main = read('main.js');
  const missing = [];
  for (const file of HANDLER_FILES) {
    if (!file.startsWith('src/ipc-')) continue;
    const base = path.basename(file, '.js');
    const fn = (read(file).match(/^function (register\w+)/m) || [])[1];
    if (!fn) { missing.push(`${file}: no register function`); continue; }
    if (!main.includes(`/${base}`)) missing.push(`${file}: not required by main.js`);
    else if (!new RegExp(`${fn}\\s*\\(`).test(main)) missing.push(`${file}: ${fn} never called`);
  }
  assert.deepEqual(missing, [], missing.join('; '));
});

test('the channels are worth counting, so a silent emptying of this test is visible', () => {
  // If a rename made the regexes match nothing, every assertion above would pass on empty sets.
  const { found } = handlers();
  assert.ok(found.size > 80, `expected 80+ handlers, found ${found.size}`);
  assert.ok(exposed().size > 80, `expected 80+ exposed channels, found ${exposed().size}`);
});

/*
 * And that the handler can actually run.
 *
 * Everything above reads these files as text. Text is how `blocked is not defined` survived
 * two releases: splitting registerIpc moved the call to `blocked('install')` into ipc-mods.js
 * and left the helper behind in ipc-game.js, so every channel name lined up, every module was
 * wired in, and `mods:install` threw a ReferenceError the moment anybody clicked Install. The
 * renderer awaited a promise that rejected and left the button on "Installing…" forever, which
 * is why it read as a hang rather than an error.
 *
 * So each module is registered for real against a stub of Electron and a context that answers
 * to anything, and every handler is called once. Nothing here cares what a handler returns or
 * which other error it raises against stub data - only that the code in it exists.
 */
test('every handler runs far enough to prove its own names exist', async () => {
  const Module = require('module');
  const registered = new Map();
  const electron = {
    ipcMain: { handle: (ch, fn) => registered.set(ch, fn), on: (ch, fn) => registered.set(ch, fn) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }) },
    shell: { openExternal: () => {}, openPath: () => {}, showItemInFolder: () => {} },
    app: { getVersion: () => '0.0.0', getPath: () => __dirname, quit: () => {} },
    clipboard: { writeText: () => {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    BrowserWindow: class { static getAllWindows() { return []; } },
  };
  // anything asked of the context answers, so a handler gets past its dependencies and into
  // its own body - which is the only part being examined here
  const ctx = new Proxy({}, { get: () => () => undefined, has: () => true });

  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    return request === 'electron' ? electron : load.call(this, request, ...rest);
  };
  const notDefined = [];
  try {
    for (const file of HANDLER_FILES.filter((f) => f.startsWith('src/ipc-'))) {
      const abs = path.join(ROOT, file);
      delete require.cache[require.resolve(abs)];
      const mod = require(abs);
      const register = Object.values(mod).find((v) => typeof v === 'function');
      registered.clear();
      register(ctx);
      assert.ok(registered.size > 0, `${file} registered nothing`);
      for (const [channel, fn] of registered) {
        try {
          await fn({ sender: { send: () => {} } });
        } catch (err) {
          // a stub handing back undefined breaks plenty of handlers, and that is fine. A name
          // the file does not have is not fine, and reads the same to the person clicking.
          if (err instanceof ReferenceError) notDefined.push(`${channel} (${file}): ${err.message}`);
        }
      }
    }
  } finally {
    Module._load = load;
    for (const file of HANDLER_FILES.filter((f) => f.startsWith('src/ipc-'))) {
      delete require.cache[require.resolve(path.join(ROOT, file))];
    }
  }
  assert.deepEqual(notDefined, [], notDefined.join('; '));
});

/*
 * And that main.js hands each module everything the module unpacks.
 *
 * A name a module destructures out of its context and never receives is `undefined`, and the
 * first call on it throws "x is not a function". That is the same failure as `blocked is not
 * defined` wearing a different message, and no linter can see it: the name is a parameter, so
 * it is defined as far as the file is concerned. Only the two sides together tell the truth.
 */
test('every ipc module is handed everything it unpacks', () => {
  const main = read('main.js');

  /** The text between the brace at `from` and the one that closes it. */
  const braced = (src, from) => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth -= 1; if (!depth) return src.slice(from + 1, i); }
    }
    return '';
  };

  /** Top-level keys of an object literal or a destructuring pattern. */
  const keysOf = (raw) => {
    // comments go first: one of these lists has a comma inside a comment, and splitting before
    // stripping cut a name out of the list and hid it from this check while it was being written
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of body) {
      if ('{[('.includes(ch)) depth++;
      if ('}])'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts
      .map((s) => s.trim().split(/[:=]/)[0].trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  };

  const gaps = [];
  for (const file of HANDLER_FILES.filter((f) => f.startsWith('src/ipc-'))) {
    const src = read(file);
    const sig = src.match(/function\s+(register\w+)\s*\(\s*\{/);
    assert.ok(sig, `${file}: no register function taking a context`);
    const wants = keysOf(braced(src, src.indexOf('{', sig.index + sig[0].length - 1)));
    assert.ok(wants.length > 0, `${file}: unpacked nothing, which means this test stopped reading`);

    const callAt = main.indexOf(`${sig[1]}({`);
    assert.ok(callAt > 0, `${file}: ${sig[1]} is never called from main.js`);
    const gives = new Set(keysOf(braced(main, main.indexOf('{', callAt))));

    for (const name of wants) {
      if (!gives.has(name)) gaps.push(`${file} unpacks ${name}, main.js does not pass it`);
    }
  }
  assert.deepEqual(gaps, [], gaps.join('; '));
});
