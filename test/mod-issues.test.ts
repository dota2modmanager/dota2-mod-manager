/* Catalog mods the signed config marks as misbehaving (src/remote-config-format.ts `issues`): what
 * the file may say, and what src/remote-config.ts hands the window for the card's "!" and the
 * mod's window. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteConfig, normalize } from '../src/remote-config.ts';

function config(t: TestContext, raw: unknown, today = '2026-11-04') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-issues-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'remote-config.json'), JSON.stringify(raw));
  return createRemoteConfig({ userDataDir: dir, appVersion: () => '2.20.0', now: () => Date.parse(`${today}T12:00:00Z`) });
}

test('an issue needs a category, a mod and some words; anything else is dropped', () => {
  const out = normalize({
    issues: [
      { cat: 'heroes', mod: 'Pudge Arcana', ru: 'Артефакты на спине', en: 'Artifacts on the back', until: '2026-12-01' },
      { cat: 'heroes', mod: 'No words' },
      { mod: 'No category', en: 'x' },
      'not an object',
      { cat: 'effects', mod: 'Bad day', en: 'kept, with no end', until: 'soon' },
    ],
  });
  assert.deepEqual(out.issues, [
    { cat: 'heroes', mod: 'Pudge Arcana', ru: 'Артефакты на спине', en: 'Artifacts on the back', until: '2026-12-01' },
    { cat: 'effects', mod: 'Bad day', ru: '', en: 'kept, with no end', until: null },
  ]);
  assert.deepEqual(normalize({}).issues, [], 'a file that says nothing marks nothing');
  assert.equal(normalize({ issues: Array.from({ length: 300 }, (_, i) => ({ cat: 'c', mod: `m${i}`, en: 'x' })) }).issues.length, 100);
});

test('the window gets the issues still in date, in the language it reads', (t) => {
  const cfg = config(t, {
    issues: [
      { cat: 'heroes', mod: 'Pudge Arcana', ru: 'Артефакты на спине', en: 'Artifacts on the back', until: '2026-11-04' },
      { cat: 'heroes', mod: 'Old', en: 'fixed long ago', until: '2026-11-03' },
      { cat: 'effects', mod: 'English only', en: 'only English' },
    ],
  });
  assert.deepEqual(cfg.issues('ru'), [
    { cat: 'heroes', mod: 'Pudge Arcana', text: 'Артефакты на спине' },
    { cat: 'effects', mod: 'English only', text: 'only English' },
  ]);
  assert.equal(cfg.issues('en')[0].text, 'Artifacts on the back');
});
