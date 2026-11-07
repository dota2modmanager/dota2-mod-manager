import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotPoints } from '../src/particle-snapshot.ts';

function resource(snap: Buffer) {
  const head = Buffer.alloc(28);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(1, 12);
  head.write('SNAP', 16);
  head.writeUInt32LE(8, 20);
  head.writeUInt32LE(snap.length, 24);
  return Buffer.concat([head, snap]);
}
const attributes = [{ name: 'position', type: 'float3' }, { name: 'skinning', type: 'skinning' }];
test('SNAP supplies positions and weighted joints from uncompressed data', () => {
  const snap = Buffer.alloc(40);
  snap.writeUInt32LE(0x80000024, 0);
  snap.writeFloatLE(3, 4);
  snap.writeInt16LE(1, 16);
  snap.writeFloatLE(1, 24);
  assert.deepEqual(snapshotPoints(resource(snap), { num_particles: 1, attributes, string_list: ['', 'blade'] }),
    [{ position: [3, 0, 0], weights: [['blade', 1]] }]);
});
test('SNAP expands overlapping block-compressed references', () => {
  const snap = Buffer.from([12, 0, 0, 0, 2, 0, 0, 8, 0]);
  assert.deepEqual(snapshotPoints(resource(snap), { num_particles: 1, attributes: [attributes[0]] }),
    [{ position: [0, 0, 0], weights: [] }]);
});
