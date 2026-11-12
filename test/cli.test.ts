/* The command line (src/cli.ts, issue #436): what it reads out of a command line, and each command
 * run to its exit code over a real library in a temporary folder. The installer, the catalog and
 * the item table are fakes that record what they were asked: the question is what the command
 * decides and says, not whether a zip unpacks (the installer has its own tests). */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library } from '../src/library.ts';
import { decodePresetLink, encodePresetLink } from '../src/preset-link.ts';
import { CLI_BUSY, CLI_FAILED, CLI_OK, CLI_PARTLY, CLI_USAGE, cliBusy, cliCommand, exitWithCli, runCli } from '../src/cli.ts';
import type { Preset, PresetEntry } from '../src/types.ts';

test('a command line names one command, and an ordinary start names none', () => {
  const base = ['electron.exe', '.', '--write-jail=sandbox', '--user-data-dir=x'];
  assert.equal(cliCommand(base), null);
  assert.equal(cliCommand([...base, 'd2mm://preset/abc']), null, 'a clicked link is the window\'s, not a command');
  assert.deepEqual(cliCommand([...base, '--list']), { run: 'list' });
  assert.deepEqual(cliCommand([...base, '--disable-all', '--headless']), { run: 'disable-all' });
  assert.deepEqual(cliCommand([...base, '--apply', 'd2mm://preset/abc']), { run: 'apply', link: 'd2mm://preset/abc' });
  assert.deepEqual(cliCommand([...base, '--apply=https://dota2modmanager.com/p/#abc']), { run: 'apply', link: 'https://dota2modmanager.com/p/#abc' });
});

test('a command line it cannot run says why, with the usage', () => {
  for (const argv of [['--apply'], ['--apply', '--list'], ['--list', '--disable-all'], ['--headless']]) {
    const r = cliCommand(argv);
    assert.equal(r?.run, 'usage', argv.join(' '));
    assert.match((r as { why: string }).why, /usage: --apply/);
  }
});

function harness(t: TestContext, { catalogHas = [] as string[], installOff = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const log: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    library,
    installer: {
      install: async ({ categoryId, modName, fileRef }: { categoryId: string; modName: string; fileRef: string }) => {
        log.push(`install ${categoryId}/${modName}`);
        return [{ root: 'lang', relPath: `${fileRef}.vpk` }];
      },
      ensureCursorStore: () => {},
      setEnabled: (_files: unknown, on: boolean, id: string) => log.push(`${on ? 'on' : 'off'} ${library.find(id)?.name}`),
      log: () => {},
    },
    schemaService: {
      refreshInBackground: async () => { log.push('table'); },
      settled: async () => { log.push('settled'); },
    },
    presets: {
      importPresetLink: (text: string) => {
        try {
          const d = decodePresetLink(text);
          return { ok: true, preset: library.addSharedPreset({ name: d.name, author: d.author, wanted: d.mods as PresetEntry[] }) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
      catalogIndex: async () => ({
        lookup: (categoryId: string, name: string) => (catalogHas.includes(name)
          ? { categoryId, name, styleLabel: null, fileRef: `${name}.zip`, preview: null } : null),
      }),
      installedFpIndex: () => new Map(),
      packFromRecords: () => null,
      applyPreset: async (p: Preset) => { log.push(`apply ${p.name}`); return []; },
    },
    adoptImportedFiles: () => ({ records: [] }),
    afterDeployMaster: () => log.push('master'),
    disableOtherCursors: () => log.push('cursors'),
    sendProgress: () => {},
    blocked: (name: string) => (installOff && name === 'install' ? { error: 'installing is switched off for now' } : null),
  } as never;
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  const add = (name: string, enabled = true, categoryId = 'heroes') => {
    const rec = library.add({ name, categoryId, styleLabel: null, fileRef: null, preview: null, files: [{ root: 'lang', relPath: `${name}.vpk` }] });
    if (!enabled) library.setEnabled(rec.id, false);
    return rec;
  };
  return { library, log, out, err, deps, io, add };
}

const link = (name: string, mods: string[]) =>
  encodePresetLink({ name, mods: mods.map((m) => ({ kind: 'catalog', categoryId: 'heroes', name: m, styleLabel: null })) as never }).direct;

test('--list prints every mod in My mods, on or off', async (t) => {
  const h = harness(t);
  h.add('Bare Brewmaster');
  h.add('Old Terrain', false, 'terrain');
  assert.equal(await runCli({ run: 'list' }, h.deps, h.io), CLI_OK);
  assert.deepEqual(h.out, ['on \theroes\tBare Brewmaster', 'off\tterrain\tOld Terrain']);
});

test('--disable-all switches every mod off, keeps it in My mods, and waits for the table', async (t) => {
  const h = harness(t);
  h.add('Bare Brewmaster');
  h.add('Already off', false);
  assert.equal(await runCli({ run: 'disable-all' }, h.deps, h.io), CLI_OK);
  assert.deepEqual(h.log, ['off Bare Brewmaster', 'settled']);
  assert.ok(h.library.list().every((r) => r.enabled === false));
  assert.equal(h.library.list().length, 2);
  assert.deepEqual(h.out, ['switched off: 1']);
});

test('--apply installs what the catalog has, puts the preset on, and names what it left out', async (t) => {
  const h = harness(t, { catalogHas: ['Bare Brewmaster'] });
  const code = await runCli({ run: 'apply', link: link('LAN', ['Bare Brewmaster', 'Gone Mod']) }, h.deps, h.io);
  assert.equal(code, CLI_PARTLY, 'done without one of them');
  assert.deepEqual(h.log, ['install heroes/Bare Brewmaster', 'apply LAN', 'master', 'settled']);
  assert.ok(h.library.findByKey('heroes', 'Bare Brewmaster', null));
  assert.equal(h.err.length, 1);
  assert.match(h.err[0], /^Gone Mod: /);
  assert.deepEqual(h.out, ['applied "LAN": 1 mods']);
});

test('--apply with a link that is not one, or with installing switched off, fails with one line', async (t) => {
  const bad = harness(t);
  assert.equal(await runCli({ run: 'apply', link: 'not a link' }, bad.deps, bad.io), CLI_FAILED);
  assert.equal(bad.err.length, 1);
  assert.equal(bad.library.listPresets().length, 0);

  const off = harness(t, { catalogHas: ['Bare Brewmaster'], installOff: true });
  assert.equal(await runCli({ run: 'apply', link: link('LAN', ['Bare Brewmaster']) }, off.deps, off.io), CLI_FAILED);
  assert.deepEqual(off.err, ['installing is switched off for now']);
  assert.deepEqual(off.log, [], 'nothing installed');
});

test('the run exits with its code; a usage line and a second copy exit at once', async (t) => {
  const h = harness(t);
  const codes: number[] = [];
  const app = { exit: (c = 0) => { codes.push(c); } };
  await exitWithCli({ run: 'list' }, h.deps, app, h.io);
  await exitWithCli({ run: 'usage', why: 'one command at a time' }, h.deps, app, h.io);
  cliBusy(app, h.io);
  assert.deepEqual(codes, [CLI_OK, CLI_USAGE, CLI_BUSY]);
  assert.deepEqual(h.err.slice(0, 1), ['one command at a time']);
  assert.match(h.err[1], /already open/);
});
