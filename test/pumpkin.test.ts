/* The app's half of the pumpkin's key (src/pumpkin.ts): how a typed key is read, what each answer
 * of the worker turns into, and that a spent key leaves the theme open and the mod in the library.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPumpkin, readings, PRIZE_NAME, beginNightAgain, NIGHT_ROUND } from '../src/pumpkin.ts';

test('a key is read whatever the layout and the dashes', () => {
  assert.deepEqual(readings('abcd-efgh-jkmn-pqrs'), ['ABCDEFGHJKMNPQRS']);
  // the same keys pressed with the keyboard left on Russian
  assert.ok(readings('фисв-уапр-ольт-зйкы').includes('ABCDEFGHJKMNPQRS'));
  // Cyrillic letters that look like Latin ones
  assert.ok(readings('АВСЕ-2345-НКМО-РТХУ').includes('ABCE2345HKMOPTXY'));
  assert.deepEqual(readings('TRICK-OR-HUE'), []);
});

function fake(status: Record<string, number>) {
  const store: Record<string, unknown> = {};
  const imported: string[][] = [];
  const records: Array<{ id: string; name: string; files: Array<{ relPath: string }>; preview?: string | null }> = [];
  const pumpkin = createPumpkin({
    settings: { get: (k) => store[k], set: (k, v) => { store[k] = v; } },
    importVpkPaths: async (paths) => {
      imported.push(paths);
      assert.ok(fs.existsSync(paths[0]));
      records.push({ id: 'r1', name: PRIZE_NAME, files: [{ relPath: 'pak30_dir.vpk' }] });
      return { imported: [{ name: PRIZE_NAME, relPath: 'pak30_dir.vpk' }], errors: [] };
    },
    library: { list: () => records, update: (id, f) => { Object.assign(records.find((r) => r.id === id)!, f); } },
    fetch: (async (url: string, init?: RequestInit) => {
      const p = new URL(url).pathname;
      if (p === '/redeem') {
        const { key } = JSON.parse(String(init!.body));
        return new Response('{}', { status: status[key] ?? 404 });
      }
      if (p === '/mod') return new Response(new Uint8Array([1, 2, 3]));
      if (p === '/mod/preview') return new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'image/png' } });
      return new Response('', { status: 404 });
    }) as typeof fetch,
    host: 'https://pumpkin.test',
  });
  return { pumpkin, store, imported, records };
}

test('a good key opens the bloody night and brings the mod in with its picture', async () => {
  const { pumpkin, store, imported, records } = fake({ ABCDEFGHJKMNPQRS: 200 });
  const answer = await pumpkin.redeem('abcd efgh jkmn pqrs');
  assert.deepEqual(answer, { ok: true, installed: PRIZE_NAME });
  assert.equal(store.blood, true);
  assert.equal(store.bloodKey, 'ABCDEFGHJKMNPQRS');
  assert.match(String(store.pumpkinInstall), /^[0-9a-f]{32}$/);
  assert.equal(imported.length, 1);
  assert.equal(records[0].preview, 'data:image/png;base64,CQ==');
  assert.equal(pumpkin.hasPrize(), true);
});

test('a key another pumpkin ate, and one nobody made, say so and open nothing', async () => {
  const { pumpkin, store } = fake({ ABCDEFGHJKMNPQRS: 409 });
  assert.deepEqual(await pumpkin.redeem('ABCD-EFGH-JKMN-PQRS'), { error: 'used' });
  assert.deepEqual(await pumpkin.redeem('ZZZZ-ZZZZ-ZZZZ-ZZZZ'), { error: 'wrong' });
  assert.deepEqual(await pumpkin.redeem('  '), { error: 'empty' });
  assert.deepEqual(await pumpkin.redeem('TRICK-OR-HUE'), { error: 'wrong' });
  assert.equal(store.blood, undefined);
});

test('the install keeps one name', () => {
  const { pumpkin } = fake({});
  assert.equal(pumpkin.install(), pumpkin.install());
});

test('the prize keeps its own picture: a data address reaches the library row as it is', async () => {
  // 2026-10-26: the record had the picture, previewUrl turned it into a catalog path, and the
  // row showed an empty box
  const { previewUrl } = await import('../renderer/ui/media.ts');
  const pic = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(previewUrl('imported', pic), pic);
  assert.match(previewUrl('heroes', 'x.png'), /\/assets\/previews\/heroes\/x\.png$/);
});

test('a new round of the night starts every install from the beginning, once, and keeps the earned key', () => {
  const data: Record<string, unknown> = { pumpkin: true, secret: true, pumpkinLit: true, blood: true, theme: 'blood', bloodKey: 'ABCDEFGHJKMNPQRS' };
  const settings = { get: (k: string) => data[k], set: (k: string, v: unknown) => { data[k] = v; } };
  assert.equal(beginNightAgain(settings), true);
  assert.deepEqual([data.pumpkin, data.secret, data.pumpkinLit, data.blood, data.theme], [false, false, false, false, 'ursa']);
  assert.equal(data.bloodKey, 'ABCDEFGHJKMNPQRS');
  assert.equal(data.nightRound, NIGHT_ROUND);
  // walked again after the reset: the next start leaves it alone
  data.blood = true;
  data.theme = 'blood';
  assert.equal(beginNightAgain(settings), false);
  assert.equal(data.theme, 'blood');
  // a hero's theme is not touched
  const other: Record<string, unknown> = { theme: 'axe' };
  beginNightAgain({ get: (k) => other[k], set: (k, v) => { other[k] = v; } });
  assert.equal(other.theme, 'axe');
});
