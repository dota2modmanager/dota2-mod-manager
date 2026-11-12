/* The "Check" window of My mods (renderer/library/install-check.ts). */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.L = (strings, ...values) => strings.reduce((s, part, i) => s + part + (i < values.length ? values[i] : ''), '');
const load = () => import('../renderer/library/install-check.ts');

const clean = {
  masterOff: false, tableOff: 0, matched: 0, nearLimit: null, conflicts: null, foreign: null, vanillaBad: false,
  mounted: null, stranded: [], launchLang: null, minify: null, prelaunch: false, stuck: [], updates: [], delisted: [],
  repair: { state: 'idle' },
};
const facts = { gameFound: true, folder: 'russian', dotaRunning: false, enabled: 3, total: 4, slots: 3, slotCeil: 98 };

test('a clean install says every line is fine, and what to try when mods still do not show', async () => {
  const { installChecks, checkAdvice } = await load();
  const lines = installChecks(clean, facts);
  assert.ok(lines.every((l) => l.level === 'ok'), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.text.includes('dota_russian')));
  assert.match(checkAdvice(lines), /закрой Dota/);
});

test('each reason the banners know shows as a line of its own, and the advice points at them', async () => {
  const { installChecks, checkAdvice } = await load();
  const b = { ...clean, mounted: { mounted: 'english', folder: 'russian' }, stranded: [{ suffix: 'dutch', modFiles: 2 }], tableOff: 4, delisted: ['X'] };
  const lines = installChecks(b, { ...facts, dotaRunning: true });
  const bad = lines.filter((l) => l.level === 'bad').map((l) => l.text);
  assert.equal(bad.length, 3, bad.join(' | '));
  assert.ok(bad[0].includes('dota_english'));
  assert.ok(lines.some((l) => l.level === 'warn' && /Убраны из каталога: 1/.test(l.text)));
  assert.ok(lines.some((l) => l.level === 'warn' && /Dota запущена/.test(l.text)));
  assert.match(checkAdvice(lines), /над списком модов/);
});

test('no game, nothing else to say', async () => {
  const { installChecks } = await load();
  const lines = installChecks(clean, { ...facts, gameFound: false });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'bad');
});
