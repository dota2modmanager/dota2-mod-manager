// A model made to wear one of its material sets by default (src/model-skin.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withSkin } from '../src/model-skin.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';

const DEFAULT = 'materials/models/courier/baby_rosh/babyroshan_alt_default.vmat';
const SILVER = 'materials/models/courier/baby_rosh/babyroshan_alt_silver.vmat';
const OTHER = 'materials/models/courier/baby_rosh/babyroshan_alt_eyes.vmat';

const mesh = (mats: string[]) => encodeKv3({ obj: [['m_sceneObjects', { objs: [[['m_drawCalls', { objs: mats.map((m): [string, V][] => [['m_material', { str: m }]]) }]]] }]] });
const group = (name: string, mats: string[]): [string, V][] => [['m_name', { str: name }], ['m_materials', { arr: mats.map((m) => ({ str: m })) }]];

/** Collector's Baby Roshan 2018's model in small: two meshes, and sets 0 to 2 for its body. */
const MODEL = resource([
  ['MDAT', mesh([DEFAULT, OTHER])],
  ['MDAT', mesh([DEFAULT])],
  ['DATA', encodeKv3({ obj: [['m_materialGroups', { objs: [
    group('0', [DEFAULT, OTHER]),
    group('1', ['materials/models/courier/baby_rosh/babyroshan_alt_gold.vmat', OTHER]),
    group('2', [SILVER, OTHER]),
  ] }]] })],
]);

const strings = (n: Kv3Node | undefined, out: string[] = []): string[] => {
  if (n?.kind === 'object') for (const v of n.members.values()) strings(v, out);
  else if (n?.kind === 'array') for (const v of n.items) strings(v, out);
  else if (n?.kind === 'string') out.push(n.value);
  return out;
};
const block = (file: Buffer, name: string, nth = 0) => readKv3(resourceBlock(file, name, nth).data).root;

test("a model wears the item's material set by default: every mesh draws with it, and set 0 is it", () => {
  const out = withSkin(MODEL, 2);
  assert.ok(out);
  assert.deepEqual(strings(block(out, 'MDAT', 0)), [SILVER, OTHER], 'what the set does not change stays');
  assert.deepEqual(strings(block(out, 'MDAT', 1)), [SILVER], 'the second mesh as well');
  assert.deepEqual(strings(block(out, 'DATA')), ['0', SILVER, OTHER, '1', 'materials/models/courier/baby_rosh/babyroshan_alt_gold.vmat', OTHER, '2', SILVER, OTHER],
    'set 0 keeps its name and place, with the chosen materials');
});

test('the first set is the model as it is, and a set it has not got is refused', () => {
  assert.equal(withSkin(MODEL, 0), MODEL);
  assert.equal(withSkin(MODEL, 3), null);
  assert.equal(withSkin(Buffer.from('not a resource'), 2), null);
});
