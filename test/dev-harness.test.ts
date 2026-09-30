/* The screenshot harness (src/dev-harness.ts). The release starts the installer it just built with
 * MM_SHOT and MM_EVAL and reads what comes out (tools/e2e.mjs), so a harness that quietly skipped
 * a step or wrote nothing would pass an installer nobody looked at. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachDevHarness, takeShot, type DrivenWindow } from '../src/dev-harness.ts';

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-harness-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A window that answers the harness and keeps a log of what it was made to do. */
function fakeWindow({ evalAnswer = { ok: true } as unknown, failOn = '' } = {}) {
  const log: string[] = [];
  const once = new Map<string, () => void>();
  const win = {
    show: () => log.push('show'),
    focus: () => log.push('focus'),
    webContents: {
      once: (name: string, fn: () => void) => { once.set(name, fn); },
      executeJavaScript: async (js: string) => {
        if (failOn && js.includes(failOn)) throw new Error(`page threw on ${failOn}`);
        log.push(`js ${js.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
        return js.includes('async') ? evalAnswer : null;
      },
      sendInputEvent: (e: { type: string }) => log.push(`input ${e.type}`),
      send: (channel: string, payload: unknown) => log.push(`send ${channel} ${JSON.stringify(payload)}`),
      capturePage: async () => ({ toPNG: () => Buffer.from('png bytes'), getSize: () => ({ width: 1360, height: 860 }) }),
    },
  };
  return { win: win as unknown as DrivenWindow, log, once };
}

const now = async () => {};

test('the steps run in the order a person would take them, and the picture is written', async (t) => {
  const dir = tmp(t);
  const shot = path.join(dir, 'shot.png');
  const w = fakeWindow({ evalAnswer: { rows: 3 } });
  const said: string[] = [];
  await takeShot(w.win, {
    MM_SHOT: shot, MM_VIEW: 'library', MM_CAT: 'heroes', MM_CLICK: '#a||#b', MM_HOVER: '10,20',
    MM_UPDATE: 'portable:2.9.0', MM_EVAL: 'return 1',
  }, { diag: (m) => said.push(m), wait: now });

  assert.deepEqual(w.log.slice(0, 2), ['show', 'focus']);
  const js = w.log.filter((l) => l.startsWith('js '));
  assert.match(js[0], /data-view="library"/);
  assert.match(js[1], /data-cat="heroes"/);
  assert.match(js[2], /"#a"/);
  assert.match(js[3], /"#b"/);
  assert.equal(w.log.filter((l) => l === 'input mouseMove').length, 2, 'the hover lands twice');
  assert.ok(w.log.includes('send update {"type":"portable","version":"2.9.0"}'));
  assert.equal(fs.readFileSync(shot, 'utf8'), 'png bytes');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${shot}.eval.json`, 'utf8')), { rows: 3 });
  assert.equal(said.at(-1), 'capture done 1360x860');
});

test('a quiet run never brings the window forward', async (t) => {
  const w = fakeWindow();
  await takeShot(w.win, { MM_SHOT: path.join(tmp(t), 's.png'), MM_QUIET: '1' }, { diag: () => {}, wait: now });
  assert.ok(!w.log.includes('show'));
});

test('a drag presses, moves in twelve steps and releases', async (t) => {
  const w = fakeWindow();
  await takeShot(w.win, { MM_SHOT: path.join(tmp(t), 's.png'), MM_DRAG: '0,0,120,0' }, { diag: () => {}, wait: now });
  const inputs = w.log.filter((l) => l.startsWith('input'));
  assert.equal(inputs[0], 'input mouseDown');
  assert.equal(inputs.filter((l) => l === 'input mouseMove').length, 12);
  assert.equal(inputs.at(-1), 'input mouseUp');
});

test('a step that throws leaves the reason beside where the picture would be', async (t) => {
  const shot = path.join(tmp(t), 's.png');
  const w = fakeWindow({ failOn: 'data-view' });
  await takeShot(w.win, { MM_SHOT: shot, MM_VIEW: 'library' }, { diag: () => {}, wait: now });
  assert.equal(fs.existsSync(shot), false);
  assert.match(fs.readFileSync(`${shot}.err.txt`, 'utf8'), /page threw on data-view/);
});

test('with no switch set nothing is attached, and MM_SHOT waits for the page', async (t) => {
  const idle = fakeWindow();
  attachDevHarness(idle.win, { env: {}, diag: () => {}, appRoot: '/nowhere', quit: () => {} });
  assert.equal(idle.once.size, 0);

  const shot = path.join(tmp(t), 's.png');
  const w = fakeWindow();
  const waited: number[] = [];
  attachDevHarness(w.win, { env: { MM_SHOT: shot }, diag: () => {}, appRoot: '/nowhere', quit: () => {}, wait: async (ms) => { waited.push(ms); } });
  assert.equal(fs.existsSync(shot), false, 'nothing before the page has loaded');
  w.once.get('did-finish-load')!();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(waited[0], 7000, 'the page gets its seconds to settle first');
  assert.ok(fs.existsSync(shot));
});
