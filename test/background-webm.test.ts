/* The WebM the window lays out for a menu background (renderer/catalog/background/webm.ts): read
 * back element by element, the way a player finds its way through one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { muxWebm, type Frame } from '../renderer/catalog/background/webm.ts';

/** One element: its id, where its body starts and how long it is. */
function readEl(b: Uint8Array, at: number): { id: number; body: number; size: number; end: number } {
  const len = (first: number) => { let n = 1; for (let m = 0x80; !(first & m); m >>= 1) n++; return n; };
  const idLen = len(b[at]);
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i];
  const sAt = at + idLen;
  const sLen = len(b[sAt]);
  let size = b[sAt] & (0xff >> sLen);
  for (let i = 1; i < sLen; i++) size = size * 256 + b[sAt + i];
  const body = sAt + sLen;
  return { id, body, size, end: body + size };
}
const each = (b: Uint8Array, from: number, to: number) => {
  const out: ReturnType<typeof readEl>[] = [];
  for (let at = from; at < to;) { const e = readEl(b, at); out.push(e); at = e.end; }
  return out;
};
const uintOf = (b: Uint8Array, e: { body: number; size: number }) => { let n = 0; for (let i = 0; i < e.size; i++) n = n * 256 + b[e.body + i]; return n; };

const frames = (n: number, keyEvery: number, stepUs = 100_000): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ data: Uint8Array.from([i, i, i]), time: i * stepUs, key: i % keyEvery === 0 }));

test('a webm header, the clip’s length in milliseconds and one VP9 track of the size given', () => {
  const b = muxWebm({ width: 1920, height: 1080, frames: frames(10, 5), duration: 1_000_000 });
  const [ebml, segment] = each(b, 0, b.length);
  assert.equal(ebml.id, 0x1a45dfa3);
  assert.equal(segment.id, 0x18538067);
  assert.equal(segment.end, b.length);
  assert.match(new TextDecoder().decode(b.subarray(ebml.body, ebml.end)), /webm/);
  const top = each(b, segment.body, segment.end);
  assert.deepEqual(top.map((e) => e.id.toString(16)), ['114d9b74', '1549a966', '1654ae6b', '1f43b675', '1f43b675', '1c53bb6b']);
  const info = each(b, top[1].body, top[1].end);
  const duration = info.find((e) => e.id === 0x4489)!;
  assert.equal(new DataView(b.buffer, b.byteOffset + duration.body, 8).getFloat64(0), 1000);
  assert.match(new TextDecoder().decode(b.subarray(top[2].body, top[2].end)), /V_VP9/);
});

test('a cluster opens at each key frame, its blocks timed from it, the key flag on its first', () => {
  const b = muxWebm({ width: 64, height: 36, frames: frames(6, 3), duration: 600_000 });
  const segment = each(b, 0, b.length)[1];
  const clusters = each(b, segment.body, segment.end).filter((e) => e.id === 0x1f43b675);
  const seen = clusters.map((c) => {
    const parts = each(b, c.body, c.end);
    const time = uintOf(b, parts[0]);
    const blocks = parts.slice(1).map((p) => ({ rel: new DataView(b.buffer, b.byteOffset + p.body + 1, 2).getInt16(0), key: b[p.body + 3] === 0x80 }));
    return { time, blocks };
  });
  assert.deepEqual(seen, [
    { time: 0, blocks: [{ rel: 0, key: true }, { rel: 100, key: false }, { rel: 200, key: false }] },
    { time: 300, blocks: [{ rel: 0, key: true }, { rel: 100, key: false }, { rel: 200, key: false }] },
  ]);
});

test('the cues and the seek head point at the very bytes they name', () => {
  const b = muxWebm({ width: 64, height: 36, frames: frames(9, 3), duration: 900_000 });
  const segment = each(b, 0, b.length)[1];
  const top = each(b, segment.body, segment.end);
  // where each top element starts, counted from the segment's data
  let at = segment.body;
  const offsets = top.map((e) => { const o = at - segment.body; at = e.end; return { id: e.id, o }; });
  const cues = top.find((e) => e.id === 0x1c53bb6b)!;
  const points = each(b, cues.body, cues.end).map((p) => {
    const [time, pos] = each(b, p.body, p.end);
    const cluster = each(b, pos.body, pos.end).find((x) => x.id === 0xf1)!;
    return { time: uintOf(b, time), at: uintOf(b, cluster) };
  });
  assert.deepEqual(points, offsets.filter((x) => x.id === 0x1f43b675).map((x, i) => ({ time: i * 300, at: x.o })));
  const seeks = each(b, top[0].body, top[0].end).map((s) => {
    const [id, pos] = each(b, s.body, s.end);
    return { id: uintOf(b, id), at: uintOf(b, pos) };
  });
  assert.deepEqual(seeks, offsets.filter((x) => [0x1549a966, 0x1654ae6b, 0x1c53bb6b].includes(x.id)).map((x) => ({ id: x.id, at: x.o })));
});

test('a clip that does not start on a key frame, or goes 30 s without one, is refused', () => {
  assert.throws(() => muxWebm({ width: 2, height: 2, frames: [{ data: new Uint8Array(1), time: 0, key: false }], duration: 1 }), /key frame/);
  assert.throws(() => muxWebm({ width: 2, height: 2, frames: frames(2, 99, 31_000_000), duration: 62_000_000 }), /30 s/);
});
