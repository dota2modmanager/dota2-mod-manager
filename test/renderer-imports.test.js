/* The renderer is ES modules loaded by a browser, and nothing here ever loads them.
 *
 * The unit tests are CommonJS in Node and never touch renderer/. eslint checks that a name a
 * file uses exists in that file, and stops there: it does not resolve `./ui/toast.js` or ask
 * whether that file exports `toast`. So a moved file or a renamed export is invisible to every
 * check this project has, right up until the window opens and the browser refuses the module -
 * at which point the screen is blank and nothing in the log says why.
 *
 * That is the same class of failure as the one that took installing away for two releases:
 * code that cannot run, shipped because nothing ran it. These two checks are the cheap half of
 * the answer. The expensive half is starting the app in CI, which this project does not do yet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');

/* Every module under renderer/, as absolute paths: the plain modules and, since the window moved to
 * TypeScript, the .ts and .tsx ones, which import the plain modules and are imported by them.
 * TypeScript checks its own files' imports as well; what it does not check is a .js file importing
 * one, which is the half this reads. */
function rendererFiles(dir = RENDERER, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'public') rendererFiles(p, out); }
    else if (/\.(js|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = rendererFiles();
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** What a module exports by name. `*` means it re-exports something wholesale. */
function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  const DECLARED = /export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of src.matchAll(DECLARED)) out.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)/.exec(t);
      out.add(as ? as[1] : t.split(/\s+/)[0]);
    }
  }
  if (/export\s+default/.test(src)) out.add('default');
  if (/export\s*\*\s*from/.test(src)) out.add('*');
  return out;
}

test('every relative import in the renderer points at a file that is there', () => {
  const broken = [];
  let checked = 0;
  const STATIC = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
  const DYNAMIC = /import\(['"](\.[^'"]+)['"]\)/g;
  for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [STATIC, DYNAMIC]) {
      for (const m of src.matchAll(re)) {
        checked++;
        const target = path.resolve(path.dirname(file), m[1]);
        if (!fs.existsSync(target)) broken.push(`${rel(file)} imports ${m[1]}, which is not there`);
      }
    }
  }
  assert.ok(checked > 100, `expected the renderer to have imports; found ${checked}`);
  assert.deepEqual(broken, [], broken.join('; '));
});

test('every name the renderer imports is a name the other file exports', () => {
  // A browser refuses the whole module graph over one of these, so the window comes up blank.
  const missing = [];
  let checked = 0;
  for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      if (!fs.existsSync(target)) continue; // the test above owns that failure
      const have = exportsOf(target);
      if (have.has('*')) continue; // re-exports: this check cannot follow them
      for (const part of m[1].split(',')) {
        const t = part.trim();
        // a type is gone by the time the browser loads the file, and TypeScript checks it
        if (!t || t.startsWith('type ')) continue;
        checked++;
        const name = t.split(/\s+as\s+/)[0].trim();
        if (!have.has(name)) missing.push(`${rel(file)} imports ${name} from ${m[2]}, which does not export it`);
      }
    }
  }
  assert.ok(checked > 100, `expected named imports to check; found ${checked}`);
  assert.deepEqual(missing, [], missing.join('; '));
});

test('the scripts index.html loads are files that exist', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const missing = [];
  let checked = 0;
  for (const m of html.matchAll(/src="([^"]+\.js)"/g)) {
    if (/^https?:/.test(m[1])) continue;
    checked++;
    if (!fs.existsSync(path.join(RENDERER, m[1]))) missing.push(`index.html loads ${m[1]}, which is not there`);
  }
  assert.ok(checked > 0, 'index.html loads no scripts, so this test stopped reading');
  assert.deepEqual(missing, [], missing.join('; '));
});
