// tools/deps-check.mjs: a pull that brings a dependency must stop the start with its name,
// not open an empty window (2026-11-03, qrcode-generator).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staleDeps } from '../tools/deps-check.mjs';

function tree(installed: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-deps-'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    packages: {
      '': { dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0', c: '^3.0.0' }, optionalDependencies: { d: '^1.0.0' } },
      'node_modules/a': { version: '1.2.0' },
      'node_modules/b': { version: '2.0.4', dev: true },
      'node_modules/c': { version: '3.1.0', dev: true },
      'node_modules/d': { version: '1.0.0', optional: true },
    },
  }));
  for (const [name, version] of Object.entries(installed)) {
    fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
  return root;
}

test('a checkout whose node_modules matches the lock is fine', () => {
  assert.deepEqual(staleDeps(tree({ a: '1.2.0', b: '2.0.4', c: '3.1.0' })), []);
});

test('a dependency the pull brought and an older version are both named', () => {
  assert.deepEqual(staleDeps(tree({ a: '1.2.0', c: '3.0.0' })), [
    { name: 'b', want: '2.0.4', have: null },
    { name: 'c', want: '3.1.0', have: '3.0.0' },
  ]);
});

test('this checkout matches its own lock', () => {
  assert.deepEqual(staleDeps(), []);
});

test('a local npm dependency is checked against its linked lockfile record', () => {
  const root=tree({ a:'1.2.0', b:'2.0.4', c:'3.1.0' });
  const file=path.join(root,'package-lock.json'),lock=JSON.parse(fs.readFileSync(file,'utf8'));
  lock.packages['node_modules/a']={link:true,resolved:'vendor/a'};lock.packages['vendor/a']={version:'1.2.0'};fs.writeFileSync(file,JSON.stringify(lock));
  assert.deepEqual(staleDeps(root),[]);
  lock.packages['vendor/a'].version='1.3.0';fs.writeFileSync(file,JSON.stringify(lock));
  assert.deepEqual(staleDeps(root),[{name:'a',want:'1.3.0',have:'1.2.0'}]);
});
