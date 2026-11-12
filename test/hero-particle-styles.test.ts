import test from 'node:test';
import assert from 'node:assert/strict';
import { styleParticleRoots } from '../src/hero-particle-styles.ts';
const prefix='particles/econ/items/spectre/spectre_arcana/';
test('Spectre v2 does not render both the first and second head ambience',()=>{
  const roots=styleParticleRoots([
    {path:prefix+'spectre_arcana_ambient_head.vpcf',config:'preview'},
    {path:prefix+'spectre_arcana_pedestal.vpcf',config:''},
    {path:prefix+'spectre_arcana_tiny_spark.vpcf',config:'ambient'},
  ],[
    prefix+'spectre_arcana_ambient_v2_head.vpcf',
    prefix+'spectre_arcana_pedestal_v2.vpcf',
  ],1);
  assert.deepEqual([...roots.keys()], [
    prefix+'spectre_arcana_tiny_spark.vpcf',
    prefix+'spectre_arcana_ambient_v2_head.vpcf',
    prefix+'spectre_arcana_pedestal_v2.vpcf',
  ]);
});
test('style 0 continues to emit model particles',()=>{
  const roots=styleParticleRoots([{path:'a_ambient_head.vpcf',config:'preview'}],['a_ambient_v2_head.vpcf'],0);
  assert.deepEqual([...roots.keys()],['a_ambient_head.vpcf','a_ambient_v2_head.vpcf']);
});
