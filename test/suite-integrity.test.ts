/* The tests, held to what makes them tests.
 *
 * A green run says the tests ran. Three ways it says that while proving nothing, each of which needs
 * no bug in the app to happen: a test with no assertion in it passes whatever the code does; a test
 * file the runner's glob does not match is never run at all (a .mjs, a .tsx, a name without
 * ".test."); and a test skipped for good is reported as a pass by every summary that counts fails.
 * test/mutate.test.js and tools/mutate.mjs ask whether the assertions are strong enough; this asks
 * whether they are there.
 *
 * The files are parsed with TypeScript, not searched with a pattern: a regular expression inside a
 * test, with a bracket or a quote in it, is exactly what a hand-written scanner trips on. An
 * assertion counts wherever the test reaches it: in its own body, in a helper defined in the file
 * or in test/helpers/, or in a function the test hands its body to (withJail(async () => ...)).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

/** An assertion: assert(...), assert.x(...), t.assert.x(...), fc.assert(...), or t.plan(n). */
const ASSERTION = /^(?:[\w$]+\.)?assert(?:\.[\w$]+)*$|^[\w$]+\.plan$/;
/** The runner's own words for leaving a test out. */
const LEFT_OUT = /^(?:test|it|describe|suite)\.(?:skip|todo|only)$/;

type Parsed = { file: string; source: ts.SourceFile };

const parse = (file: string, text = fs.readFileSync(file, 'utf8')): Parsed =>
  ({ file, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS) });

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Every function in a file that has a name: declarations, and arrows or function expressions bound to a const. */
function namedFunctions(parsed: Parsed): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  walk(parsed.source, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) out.set(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) out.set(n.name.text, n.initializer);
  });
  return out;
}

/**
 * Which named functions reach an assertion, worked out to a fixed point: a function asserts when
 * its body holds an assertion or a call to one that does.
 */
function assertingNames(functions: Map<string, ts.Node>, known = new Set<string>()): Set<string> {
  const asserting = new Set(known);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of functions) {
      if (!asserting.has(name) && reaches(body, asserting)) { asserting.add(name); grew = true; }
    }
  }
  return asserting;
}

/** Whether anything under `node` is an assertion or a call to a function that makes one. */
function reaches(node: ts.Node, asserting: Set<string>): boolean {
  let found = false;
  walk(node, (n) => {
    if (found || !ts.isCallExpression(n)) return;
    const callee = n.expression.getText();
    if (ASSERTION.test(callee)) found = true;
    else if (ts.isIdentifier(n.expression) && asserting.has(n.expression.text)) found = true;
  });
  return found;
}

/** The functions every test file may lean on: whatever test/helpers/ defines that asserts. */
function helperAssertions(): Set<string> {
  const helpers = new Map<string, ts.Node>();
  const dir = path.join(TEST_DIR, 'helpers');
  for (const f of fs.readdirSync(dir).filter((n) => /\.[jt]s$/.test(n))) {
    for (const [name, body] of namedFunctions(parse(path.join(dir, f)))) helpers.set(name, body);
  }
  return assertingNames(helpers);
}

type Finding = { tests: number; silent: string[]; leftOut: string[] };

/** Every test(...) call in one file, and which of them never reach an assertion or are left out for good. */
function examine(parsed: Parsed, fromHelpers: Set<string>): Finding {
  const asserting = assertingNames(namedFunctions(parsed), fromHelpers);
  const out: Finding = { tests: 0, silent: [], leftOut: [] };
  walk(parsed.source, (n) => {
    if (!ts.isCallExpression(n)) return;
    const callee = n.expression.getText();
    const line = parsed.source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const where = `${path.relative(ROOT, parsed.file).replace(/\\/g, '/')}:${line}`;
    if (LEFT_OUT.test(callee)) { out.leftOut.push(`${where} ${callee}`); return; }
    if (callee !== 'test' && callee !== 'it') return;
    out.tests++;
    const [title, ...rest] = n.arguments;
    const name = title && ts.isStringLiteralLike(title) ? title.text : title ? title.getText() : '';
    // { skip: true } or { skip: 'some reason' } leaves a test out on every machine; a condition does not
    for (const arg of rest) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop) || !/^(skip|todo|only)$/.test(prop.name.getText())) continue;
        const v = prop.initializer;
        if (v.kind === ts.SyntaxKind.TrueKeyword || ts.isStringLiteralLike(v)) out.leftOut.push(`${where} ${name}: ${prop.getText()}`);
      }
    }
    const body = rest.find((a) => !ts.isObjectLiteralExpression(a));
    if (!body || !reaches(body, asserting)) out.silent.push(`${where} ${name}`);
  });
  return out;
}

/** Every file under test/, helpers and fixtures aside. */
function testTree(dir = TEST_DIR): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['helpers', 'fixtures'].includes(e.name)) out.push(...testTree(full)); } else out.push(full);
  }
  return out;
}

const testFiles = testTree().filter((f) => /\.test\.\w+$/.test(f));

test('every test reaches an assertion', () => {
  const fromHelpers = helperAssertions();
  let tests = 0;
  const silent: string[] = [];
  for (const file of testFiles) {
    const found = examine(parse(file), fromHelpers);
    tests += found.tests;
    silent.push(...found.silent);
  }
  assert.ok(tests > 1000, `found ${tests} tests, so the scan still finds them`);
  assert.deepEqual(silent, [], `these pass whatever the code does:\n${silent.join('\n')}`);
});

test('no test is left out on every machine', () => {
  const fromHelpers = helperAssertions();
  const leftOut = testFiles.flatMap((file) => examine(parse(file), fromHelpers).leftOut);
  assert.deepEqual(leftOut, [], `skip, todo and only belong behind a condition:\n${leftOut.join('\n')}`);
});

test('every test file is one the runner picks up, and has a test in it', () => {
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test as string;
  assert.match(script, /"test\/\*\*\/\*\.test\.js"/);
  assert.match(script, /"test\/\*\*\/\*\.test\.ts"/);
  const unmatched = testFiles.filter((f) => !/\.test\.(js|ts)$/.test(f));
  assert.deepEqual(unmatched, [], 'npm test runs *.test.js and *.test.ts only; these would never run');
  // a file that looks like a test by its folder but not by its name is never run either
  const stray = testTree().filter((f) => /\.(js|ts|mjs|cjs|tsx)$/.test(f) && !/\.test\.\w+$/.test(f) && !/tsconfig/.test(f));
  assert.deepEqual(stray, [], 'a file in test/ that is not *.test.* and not under helpers/ or fixtures/');
  const fromHelpers = helperAssertions();
  const empty = testFiles.filter((f) => examine(parse(f), fromHelpers).tests === 0);
  assert.deepEqual(empty, [], 'a test file with no test in it');
  assert.ok(testFiles.length > 100);
});

test('the scan itself catches what it is there to catch', () => {
  const look = (text: string) => examine(parse(path.join(TEST_DIR, 'synthetic.test.ts'), text), new Set(['fromHelper']));
  assert.deepEqual(look("test('a', () => { const x = 1; void x; });").silent.length, 1, 'no assertion at all');
  assert.deepEqual(look("const helper = () => 1;\ntest('a', () => { helper(); });").silent.length, 1, 'a helper that asserts nothing');
  assert.deepEqual(look("function deep() { assert.ok(1); }\nconst helper = () => deep();\ntest('a', () => helper());").silent, [], 'a helper two calls away');
  assert.deepEqual(look("test('a', withJail(async () => { assert.equal(1, 1); }));").silent, [], 'a body handed to a wrapper');
  assert.deepEqual(look("test('a', () => fromHelper());").silent, [], 'a helper from test/helpers');
  assert.deepEqual(look("test('a', (t) => { t.assert.ok(true); });").silent, []);
  assert.deepEqual(look("test('a', () => fc.assert(fc.property(fc.nat(), () => true)));").silent, []);
  assert.deepEqual(look("test('a /(x)\"', () => { const r = /[)'\"]/; assert.match('x', r); });").silent, [], 'brackets and quotes in a regex');
  assert.equal(look("test.skip('a', () => assert.ok(1));").leftOut.length, 1);
  assert.equal(look("test('a', { skip: true }, () => assert.ok(1));").leftOut.length, 1);
  assert.equal(look("test('a', { skip: 'later' }, () => assert.ok(1));").leftOut.length, 1);
  assert.equal(look("test('a', { skip: process.platform === 'win32' }, () => assert.ok(1));").leftOut.length, 0, 'a condition is fine');
  assert.equal(look("test.only('a', () => assert.ok(1));").leftOut.length, 1);
});
