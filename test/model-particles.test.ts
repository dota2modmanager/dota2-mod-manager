/* A model that brings its own particles (src/model-particles.ts): the key values as the game's own
 * models write them, on any text a model can have there. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyValuesWithParticles } from '../src/model-particles.ts';

const HEAD = '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->';
const row = (p: string) => `name = resource:"${p}"`;

test('a model with no key values gets a text of its own', () => {
  const t = keyValuesWithParticles('', ['particles/a.vpcf']);
  assert.ok(t.startsWith('<!-- kv3'));
  assert.ok(t.includes(row('particles/a.vpcf')) && t.includes('config = "preview"'));
});

test('other key values stay, and the list goes inside the block', () => {
  const t = keyValuesWithParticles(`${HEAD}\n{\n\tmovement_speed = 300\n}\n`, ['particles/a.vpcf']);
  assert.ok(t.includes('movement_speed = 300'));
  assert.ok(t.indexOf('particle_cfg_list') > t.indexOf('movement_speed'));
  assert.ok(t.trimEnd().endsWith('}'));
});

test('a list already there is replaced, not stacked', () => {
  const old = `${HEAD}\n{\n\tparticle_cfg_list = \n\t[\n\t\t{\n\t\t\tname = resource:"particles/old.vpcf"\n\t\t\tconfig = "preview"\n\t\t},\n\t]\n}\n`;
  const t = keyValuesWithParticles(old, ['particles/a.vpcf', 'particles/b.vpcf']);
  assert.ok(!t.includes('particles/old.vpcf'));
  assert.equal(t.match(/particle_cfg_list/g)?.length, 1);
  assert.ok(t.includes(row('particles/a.vpcf')) && t.includes(row('particles/b.vpcf')));
});
