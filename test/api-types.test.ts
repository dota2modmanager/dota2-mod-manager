// window.api as src-tauri/src/page/api.js builds it, against the type the window's TypeScript reads
// it through (renderer/api/). test/rust-channels.test.ts holds every channel to its Rust handler;
// this holds the names: one the type lacks cannot be called from TypeScript, and one api.js lacks
// is a TypeError the compiler said nothing about, a button that does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The object api.js leaves on window, built in a sandbox over a bridge that does nothing. */
function bridge(): Record<string, unknown> {
  const window: Record<string, unknown> = {
    __mm: { invoke: () => Promise.resolve(), send() {}, on() {}, pathOf: () => '' },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'page', 'api.js'), 'utf8'), { window });
  return window.api as Record<string, unknown>;
}

/** "group.method" for every function on the bridge, and "method" for the ones at its top. */
function namesOf(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') out.push(prefix + k);
    else if (v && typeof v === 'object') out.push(...namesOf(v as Record<string, unknown>, `${prefix}${k}.`));
  }
  return out.sort();
}

/** The same names, read off the Api type by the compiler. */
function typedNames(): string[] {
  const entry = path.join(ROOT, 'renderer', 'api', 'index.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, allowJs: true, checkJs: false, noEmit: true, strict: true, skipLibCheck: true, types: [],
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(entry)!;
  const decl = file.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'Api');
  assert.ok(decl, 'renderer/api/index.ts no longer declares interface Api');
  const walk = (type: ts.Type, prefix: string): string[] => checker.getPropertiesOfType(type).flatMap((p) => {
    const t = checker.getTypeOfSymbolAtLocation(p, decl);
    return t.getCallSignatures().length ? [prefix + p.name] : walk(t, `${prefix}${p.name}.`);
  });
  return walk(checker.getTypeAtLocation(decl.name), '').sort();
}

test('the sandbox sees the api api.js builds', () => {
  // proof the comparison below is not two empty lists agreeing
  const names = namesOf(bridge());
  assert.ok(names.length > 80, `only ${names.length} functions found on window.api`);
  assert.ok(names.includes('mods.install') && names.includes('onProgress'));
});

test('every function on window.api has a type, and every typed one is on window.api', () => {
  const real = namesOf(bridge());
  const typed = typedNames();
  assert.deepEqual(
    { untyped: real.filter((n) => !typed.includes(n)), notOnBridge: typed.filter((n) => !real.includes(n)) },
    { untyped: [], notOnBridge: [] },
  );
});
