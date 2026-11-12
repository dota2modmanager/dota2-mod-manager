/* A model put under a plain hero's path with its attachments numbered as the plain model's
 * (src/model-attachments.ts).
 *
 * The promise: online the server names an attachment by its number in the plain model, so each
 * number gets the model's attachment of the plain name; one the model has not got stands in on
 * its hitloc under that name; the model's own extras go after; a model already in order, or one
 * that cannot be read, is handed back untouched. Acolyte of the Lost Arts had Invoker's orbs first
 * of seven where the plain model has them at 6, 7 and 8, and in a lobby they sat at his feet. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { attachedAs, attachmentNames } from '../src/model-attachments.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { encodeKv3, resource } from './helpers/kv3-build.ts';

const model = (names: string[]) => resource([
  ['MDAT', encodeKv3({ obj: [['m_attachments', { objs: names.map((n) => [['key', { str: n }], ['value', { obj: [['m_name', { str: n }], ['m_influenceNames', { arr: [{ str: `bone_${n}` }] }]] }]]) }]] })],
  ['DATA', encodeKv3({ obj: [['m_name', { str: 'a model' }]] })],
]);

/** Each attachment's name, its m_name and the bone it hangs on. */
function read(file: Buffer) {
  const kv = readKv3(resourceBlock(file, 'MDAT').data);
  const get = (n: Kv3Node | undefined, k: string) => (n?.kind === 'object' ? n.members.get(k) : undefined);
  const str = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');
  const list = get(kv.root, 'm_attachments');
  return (list?.kind === 'array' ? list.items : []).map((a) => {
    const bones = get(get(a, 'value'), 'm_influenceNames');
    return `${str(get(a, 'key'))}=${str(get(get(a, 'value'), 'm_name'))}@${bones?.kind === 'array' ? str(bones.items[0]) : ''}`;
  });
}

test('the persona body takes the plain model\'s numbers, with stand-ins on its hitloc', () => {
  const plain = model(['attach_attack2', 'attach_attack1', 'chain_L', 'attach_hitloc', 'attach_orb2', 'attach_orb1', 'attach_orb3']);
  const persona = model(['attach_orb1', 'attach_orb2', 'attach_orb3', 'attach_attack1', 'attach_attack2', 'attach_hitloc', 'pelvis']);
  const fixed = attachedAs(persona, plain);
  assert.deepEqual(attachmentNames(fixed).slice(0, 7), attachmentNames(plain));
  assert.deepEqual(read(fixed), [
    'attach_attack2=attach_attack2@bone_attach_attack2',
    'attach_attack1=attach_attack1@bone_attach_attack1',
    'chain_L=chain_L@bone_attach_hitloc',
    'attach_hitloc=attach_hitloc@bone_attach_hitloc',
    'attach_orb2=attach_orb2@bone_attach_orb2',
    'attach_orb1=attach_orb1@bone_attach_orb1',
    'attach_orb3=attach_orb3@bone_attach_orb3',
    'pelvis=pelvis@bone_pelvis',
  ]);
});

test('a model in order already, or one without attachments to read, comes back as it was', () => {
  const plain = model(['a', 'b']);
  const same = model(['a', 'b', 'extra']);
  assert.equal(attachedAs(same, plain), same);
  const broken = Buffer.from('not a model');
  assert.equal(attachedAs(broken, plain), broken);
  assert.equal(attachedAs(same, broken), same);
});
