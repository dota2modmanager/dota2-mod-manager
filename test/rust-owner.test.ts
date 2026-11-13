/* The Rust owner (crates/mm-core/src/owner.rs) against the TypeScript main process, channel by
 * channel: both run over twin copies of one state (test/helpers/owner-twins.ts), are handed the
 * same calls and the same answers from the shell, and must answer, ask and write the same.
 *
 * Skips where mm-cli is not built or the sandbox is not seeded (npm run sandbox:seed), as on CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CLI, SANDBOX_GAME, baseState, blind, readJson, startRs, startTs, tmpRoot, tree, twins, type Proc, type Reply, type Twin } from './helpers/owner-twins.ts';

const skip = (!fs.existsSync(CLI) && 'mm-cli is not built (cargo build -p mm-cli)') || (!fs.existsSync(SANDBOX_GAME) && 'no sandbox (npm run sandbox:seed)');

type Step = { call: [string, ...unknown[]]; reply?: Reply; note?: string };

/** The settings a process wrote that are its own clock or its own build, not the state compared. */
const VOLATILE = ['lastSeenVersion', 'gameStamp', 'windowBounds'];
const settingsOf = (t: Twin) => {
  const s = (readJson(path.join(t.ud, 'settings.json')) ?? {}) as Record<string, unknown>;
  for (const k of VOLATILE) delete s[k];
  return blind(s, t);
};

/** Run one script on both sides; compare each answer, what each asked, and the files after. */
async function compare(name: string, base: Twin, steps: Step[]): Promise<void> {
  const [a, b] = twins(base, tmpRoot(name));
  const procs: [Proc, Proc] = [startTs(a), startRs(b)];
  try {
    const [tsChannels, rsChannels] = await Promise.all(procs.map((p) => p.ready));
    for (const s of steps) assert.ok(rsChannels.includes(s.call[0]), `${s.call[0]} is not the owner's`);
    assert.ok(steps.every((s) => tsChannels.includes(s.call[0])), 'every channel is the host\'s too');
    for (const [k, s] of steps.entries()) {
      const label = `${name} ${k} ${s.note ?? s.call[0]}`;
      const got = [];
      for (const [p, t] of [[procs[0], a], [procs[1], b]] as const) {
        p.asked = [];
        // <ROOT> in a call or in the shell's answer is this copy's folder
        const here = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).split('<ROOT>').join(JSON.stringify(t.root).slice(1, -1)));
        p.reply = (m, x) => here((s.reply ?? (() => null))(m, x));
        const r = await p.invoke(s.call[0], here(s.call.slice(1)) as unknown[]);
        got.push(blind({ answer: r, asked: p.asked }, t));
      }
      assert.deepEqual(got[1], got[0], label);
    }
    assert.deepEqual(settingsOf(b), settingsOf(a), `${name}: settings.json`);
    assert.deepEqual(readJson(path.join(b.ud, 'manifest.json')), readJson(path.join(a.ud, 'manifest.json')), `${name}: the library`);
    assert.deepEqual(tree(b.game), tree(a.game), `${name}: the game folder`);
  } finally {
    await Promise.all(procs.map((p) => p.stop()));
  }
}

const open = (filePaths: string[] | null) => (m: string) => (m === 'dialog.open' ? (filePaths ? { canceled: false, filePaths } : { canceled: true, filePaths: [] }) : null);

test('settings, the beta switch, the support prompt and the account answer as the TypeScript does', { skip }, async () => {
  const base = baseState(path.join(tmpRoot('settings-base'), 'b'), { uiLang: 'ru' });
  await compare('settings', base, [
    { call: ['settings:get'] },
    { call: ['settings:get'], note: 'the migrations are told once' },
    { call: ['settings:set', 'uiLang', 'en'] },
    { call: ['settings:set', 'downloadProxy', 'socks://x'] },
    { call: ['settings:set', 'downloadProxy', ' http://127.0.0.1:8080 '] },
    { call: ['settings:set', 'downloadProxy', ''] },
    { call: ['settings:set', 'countDownloads', false] },
    { call: ['support:state'] },
    { call: ['support:state'], note: 'counted once a run' },
    { call: ['support:choose', 'later'] },
    { call: ['support:state'] },
    { call: ['beta:state'] },
    { call: ['beta:set', true] },
    { call: ['beta:set', 'yes'] },
    { call: ['presence:view', 'library'] },
    { call: ['account:signOut'] },
    { call: ['settings:moveLangFiles', 'english'] },
    { call: ['settings:browseDota'], reply: open(null), note: 'cancelled' },
    { call: ['settings:browseDota'], reply: open(['<ROOT>/ud']), note: 'not a game' },
    { call: ['settings:browseDota'], reply: open(['<ROOT>']), note: 'the folder above game' },
    { call: ['settings:set', 'langFolderLock', 'russian'] },
    { call: ['settings:get'] },
  ]);
});
