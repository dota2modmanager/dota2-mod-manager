/* window.api as preload.js builds it, against the type the window's TypeScript reads it through
 * (renderer/api/). test/ipc-contract.test.js holds the other two sides together - every channel
 * preload reaches has a handler - and this holds the third: a name the type lacks cannot be called
 * from TypeScript, and a name the bridge lacks is a TypeError the compiler said nothing about. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

/** The object preload.js hands to exposeInMainWorld, built in a sandbox with Electron stubbed out. */
function bridge() {
  let api = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name, obj) => { if (name === 'api') api = obj; } },
    ipcRenderer: { invoke() {}, send() {}, on() {} },
    webUtils: { getPathForFile() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8'), {
    require: (m) => (m === 'electron' ? electron : require(m)),
  });
  return api;
}

/** "group.method" for every function on the bridge, and "method" for the ones at its top. */
function namesOf(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') out.push(prefix + k);
    else if (v && typeof v === 'object') out.push(...namesOf(v, `${prefix}${k}.`));
  }
  return out.sort();
}

/** The same names, read off the Api type by the compiler. */
function typedNames() {
  const entry = path.join(ROOT, 'renderer', 'api', 'index.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, allowJs: true, checkJs: false, noEmit: true, strict: true, skipLibCheck: true, types: [],
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(entry);
  const decl = file.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'Api');
  assert.ok(decl, 'renderer/api/index.ts no longer declares interface Api');
  const walk = (type, prefix) => checker.getPropertiesOfType(type).flatMap((p) => {
    const t = checker.getTypeOfSymbolAtLocation(p, decl);
    return t.getCallSignatures().length ? [prefix + p.name] : walk(t, `${prefix}${p.name}.`);
  });
  return walk(checker.getTypeAtLocation(decl.name), '').sort();
}

test('the sandbox sees the bridge preload.js builds', () => {
  // proof the comparison below is not two empty lists agreeing
  const names = namesOf(bridge());
  assert.ok(names.length > 80, `only ${names.length} functions found on the bridge`);
  assert.ok(names.includes('mods.install') && names.includes('onProgress'));
});

test('every function on window.api has a type, and every typed one is on the bridge', () => {
  const real = namesOf(bridge());
  const typed = typedNames();
  assert.deepEqual(
    { untyped: real.filter((n) => !typed.includes(n)), notOnBridge: typed.filter((n) => !real.includes(n)) },
    { untyped: [], notOnBridge: [] },
  );
});
