// The map's meshes merged off the window's thread (renderer/catalog/decor/merge-worker.ts): what a
// message brings is not trusted to name things, and the merge still comes out as it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, type Geo, type Job } from '../renderer/catalog/decor/merge-worker.ts';

/** One triangle: positions as floats, an index of three, in one buffer. */
function oneTriangle(): { buffers: ArrayBuffer[]; geos: Geo[] } {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint32Array([0, 1, 2]);
  const buf = new ArrayBuffer(pos.byteLength + idx.byteLength);
  new Float32Array(buf, 0, 9).set(pos);
  new Uint32Array(buf, pos.byteLength, 3).set(idx);
  return {
    buffers: [buf],
    geos: [{
      attrs: { position: { buf: 0, kind: 'f32', offset: 0, stride: 3, size: 3, normalized: false, count: 3 } },
      index: { buf: 0, kind: 'u32', offset: pos.byteLength / 4, length: 3 },
      count: 3,
    }],
  };
}

test('two parts merge into one mesh, moved by their matrices, a mirrored one turned round', () => {
  const { buffers, geos } = oneTriangle();
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  const job: Job = { id: 7, parts: [{ geo: 0, matrix: id, flip: false }, { geo: 0, matrix: moved, flip: true }] };
  const out = merge(buffers, geos, job);
  assert.equal(out.id, 7);
  // the attributes come back as pairs, not as properties named by the message
  assert.ok(Array.isArray(out.attrs));
  assert.deepEqual(out.attrs.map(([name]) => name), ['position']);
  const pos = out.attrs[0][1].array;
  assert.deepEqual([...pos.slice(9, 12)], [10, 0, 0]);
  assert.deepEqual([...out.index], [0, 1, 2, 3, 5, 4]);
});

test('a kind the merge has no array for is refused, not looked up as a property', () => {
  const { buffers, geos } = oneTriangle();
  const bad = { ...geos[0], attrs: { position: { ...geos[0].attrs.position, kind: 'constructor' as never } } };
  assert.throws(() => merge(buffers, [bad], { id: 1, parts: [{ geo: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], flip: false }] }), /no buffer/);
});

test('an attribute named like an object property stays an attribute and touches no prototype', () => {
  const { buffers, geos } = oneTriangle();
  const g: Geo = { ...geos[0], attrs: { ...geos[0].attrs, ['__proto__']: geos[0].attrs.position } };
  const out = merge(buffers, [g], { id: 2, parts: [{ geo: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], flip: false }] });
  assert.equal(({} as Record<string, unknown>).array, undefined);
  assert.ok(out.attrs.some(([name]) => name === 'position'));
});
