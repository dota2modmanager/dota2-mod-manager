/* A big answer crosses to the window in slices and comes out the same (src/large-answer.ts + preload.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createLargeAnswers } from '../src/large-answer.ts';

/** preload.js as the window runs it, with its invoke answered by `invoke`. */
function preloadApi(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>) {
  let api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  const electron = { contextBridge: { exposeInMainWorld: (_: string, value: typeof api) => { api = value; } }, ipcRenderer: { invoke, on() {}, send() {} }, webUtils: {} };
  vm.runInNewContext(fs.readFileSync('preload.js', 'utf8'), { require: () => electron, Uint8Array, TextDecoder, Promise, Object, Array, ArrayBuffer, console });
  return api;
}

test('a big answer is left behind and named, the small parts travel as they are', () => {
  const large = createLargeAnswers({ smallest: 10, slice: 4 });
  const bytes = new Uint8Array(25).fill(7);
  const small = new Uint8Array(3);
  const packed = large.pack({ ok: true, body: bytes, sprites: { a: small }, list: [{ data: 'x'.repeat(20) }, 'short'] }) as Record<string, any>;
  assert.equal(packed.ok, true);
  assert.deepEqual(packed.body, { $large: 1, size: 25, text: false });
  assert.equal(packed.sprites.a, small);
  assert.deepEqual(packed.list[0].data, { $large: 2, size: 20, text: true });
  assert.equal(packed.list[1], 'short');
  assert.equal(large.waiting, 2);
});

test('the last slice lets a piece go, and a piece nobody fetched goes after a while', () => {
  let time = 0;
  const large = createLargeAnswers({ smallest: 1, slice: 4, now: () => time });
  const packed = large.pack({ a: new Uint8Array(6), b: new Uint8Array(6) }) as unknown as Record<string, { $large: number }>;
  assert.equal(large.slice(packed.a.$large, 0)?.byteLength, 4);
  assert.equal(large.slice(packed.a.$large, 4)?.byteLength, 2);
  assert.equal(large.slice(packed.a.$large, 0), null);
  time += 6 * 60 * 1000;
  large.pack({});
  assert.equal(large.waiting, 0);
});

test('the window gets back what the main process answered, across the real preload', async () => {
  const large = createLargeAnswers({ smallest: 8, slice: 5 });
  const body = Uint8Array.from({ length: 23 }, (_, i) => i);
  const text = 'base64+text/'.repeat(4);
  let slices = 0;
  const api = preloadApi(async (channel, ...args) => {
    if (channel === 'preview3d:models') return large.pack({ ok: true, body, resources: { models: { m: { data: text } } }, parts: [{ glb: new Uint8Array(2) }], clip: null });
    assert.equal(channel, 'preview3d:slice');
    slices++;
    return large.slice(args[0] as number, args[1] as number);
  });
  const got = await api.preview3d.models('magnataur', []) as Record<string, any>;
  assert.deepEqual([...got.body], [...body]);
  assert.equal(got.resources.models.m.data, text);
  assert.equal(got.parts[0].glb.byteLength, 2);
  assert.equal(got.clip, null);
  assert.equal(got.ok, true);
  assert.ok(slices >= 5);
  assert.equal(large.waiting, 0);
});

test('an answer of bytes alone comes back as bytes, and a lost piece fails the call', async () => {
  const large = createLargeAnswers({ smallest: 8, slice: 5 });
  const api = preloadApi(async (channel, ...args) => channel === 'preview3d:motions' ? large.pack(new Uint8Array(12).fill(3)) : channel === 'preview3d:slice' ? large.slice(args[0] as number, args[1] as number) : { $large: 99, size: 9, text: false });
  assert.deepEqual([...await api.preview3d.motions('x') as Uint8Array], new Array(12).fill(3));
  await assert.rejects(api.preview3d.effect('x'));
});
