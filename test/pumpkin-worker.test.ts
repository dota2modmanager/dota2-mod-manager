/* The pumpkin's keys (tools/pumpkin-worker/worker.mjs), against a real SQLite with the worker's own
 * schema standing in for D1. The point of the worker is that a key posted in a channel works once:
 * these hold it to that, and to a chase being needed before a key is handed out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { newKey, plainKey, makeTicket } from '../tools/pumpkin-worker/worker.mjs';

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'pumpkin-worker', 'schema.sql'), 'utf8');

/** D1's prepare/bind/first/run over node:sqlite. */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return {
    sql: db,
    prepare(sql: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = a; return st; },
        async first() { return db.prepare(sql).get(...(args as never[])) ?? null; },
        async run() { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      };
      return st;
    },
  };
}

function setup() {
  const DB = d1();
  const objects = new Map([['necrophos-scream.vpk', new Uint8Array([1, 2, 3])]]);
  const env = {
    TICKET_SECRET: 'ticket-secret', ADDR_SALT: 'salt', DB,
    PRIZE: { async get(name: string) { const b = objects.get(name); return b ? { body: b, size: b.length, httpMetadata: {}, customMetadata: {} } : null; } },
  };
  const call = (method: string, p: string, body?: unknown, ip = '1.2.3.4') => worker.fetch(new Request(`https://pumpkin.test${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: 'https://dota2modmanager.com' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { env, call, DB };
}

const INSTALL_A = 'a'.repeat(32);
const INSTALL_B = 'b'.repeat(32);

/** A ticket from `ago` milliseconds back, as if the chase began then. */
const oldTicket = (env: object, ago: number) => makeTicket(env, Date.now() - ago);

test('keys are 16 characters of an alphabet without look-alikes', () => {
  for (let i = 0; i < 200; i++) {
    const k = newKey();
    assert.match(k, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
  }
  assert.equal(plainKey('abcd-efgh ijkl-mnop'), 'ABCDEFGHIJKLMNOP');
});

test('a key is handed out only after a chase long enough to have been run', async () => {
  const { env, call } = setup();
  const fresh = await (await call('POST', '/ticket')).json();
  assert.equal((await call('POST', '/claim', { ticket: fresh.ticket })).status, 425);
  assert.equal((await call('POST', '/claim', { ticket: 'forged.ticket' })).status, 400);
  const res = await call('POST', '/claim', { ticket: await oldTicket(env, 20000) });
  assert.equal(res.status, 200);
  assert.match((await res.json()).key, /^\w{4}-\w{4}-\w{4}-\w{4}$/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://dota2modmanager.com');
});

test('one chase is one key, and one address gets a few a day at most', async () => {
  const { env, call } = setup();
  const t = await oldTicket(env, 20000);
  assert.equal((await call('POST', '/claim', { ticket: t })).status, 200);
  assert.equal((await call('POST', '/claim', { ticket: t })).status, 409);
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/claim', { ticket: await oldTicket(env, 20000) })).status, 200);
  assert.equal((await call('POST', '/claim', { ticket: await oldTicket(env, 20000) })).status, 429);
  assert.equal((await call('POST', '/claim', { ticket: await oldTicket(env, 20000) }, '5.6.7.8')).status, 200);
});

test('a key opens one pumpkin: the first install keeps it, any other is turned away', async () => {
  const { env, call } = setup();
  const { key } = await (await call('POST', '/claim', { ticket: await oldTicket(env, 20000) })).json();
  // typed the way people type: lower case, no dashes
  assert.equal((await call('POST', '/redeem', { key: key.toLowerCase().replace(/-/g, ''), install: INSTALL_A })).status, 200);
  // the same install again (a reinstall, a second click) still has it
  assert.equal((await call('POST', '/redeem', { key, install: INSTALL_A })).status, 200);
  const other = await call('POST', '/redeem', { key, install: INSTALL_B });
  assert.equal(other.status, 409);
  assert.equal((await other.json()).error, 'used');
  assert.equal((await call('POST', '/redeem', { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', install: INSTALL_A })).status, 404);
  assert.equal((await call('POST', '/redeem', { key, install: 'not-an-install' })).status, 400);
});

test('the prize goes only to the install that spent the key', async () => {
  const { env, call } = setup();
  const { key } = await (await call('POST', '/claim', { ticket: await oldTicket(env, 20000) })).json();
  assert.equal((await call('GET', `/mod?key=${key}&install=${INSTALL_A}`)).status, 403);
  await call('POST', '/redeem', { key, install: INSTALL_A });
  const ok = await call('GET', `/mod?key=${key}&install=${INSTALL_A}`);
  assert.equal(ok.status, 200);
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
  assert.equal((await call('GET', `/mod?key=${key}&install=${INSTALL_B}`)).status, 403);
});
