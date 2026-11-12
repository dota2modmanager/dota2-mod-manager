import test from 'node:test';
import assert from 'node:assert/strict';
import { readGlb, writeGlb } from '../src/glb-embed.ts';
import { hidePreviewOnlyMeshes, selectStyleMeshes, styleFamily, syncArcanaStyles } from '../src/model-style-meshes.ts';

function variantGlb() {
  return writeGlb({
    asset: { version: '2.0' },
    materials: [
      { name: 'spectre_arcana_hair' },
      { name: 'spectre_arcana_hair_alt' },
    ],
    meshes: [
      { name: 'models/spectre.vmdl_c.head', primitives: [{ material: 0 }] },
      { name: 'models/spectre.vmdl_c.head_copy', primitives: [{ material: 0 }] },
      { name: 'models/spectre.vmdl_c.head_alt', primitives: [{ material: 1 }] },
      { name: 'unrelated', primitives: [] },
    ],
    nodes: [{ name: 'head', mesh: 0 }, { name: 'head_copy', mesh: 1 }, { name: 'head_alt', mesh: 2 }, { name: 'empty', mesh: 3 }],
  } as never, Buffer.alloc(0));
}

const retained = (bytes: Uint8Array) => readGlb(Buffer.from(bytes)).json as unknown as { nodes: { mesh?: number }[] };

test('Spectre style 1 hides duplicate and alt meshes, keeping the original', () => {
  assert.deepEqual(retained(selectStyleMeshes(variantGlb(), 0)).nodes.map(n => n.mesh), [0, undefined, undefined, 3]);
});

test('Spectre style 2 selects alt geometry instead of drawing the first style too', () => {
  assert.deepEqual(retained(selectStyleMeshes(variantGlb(), 1)).nodes.map(n => n.mesh), [undefined, undefined, 2, 3]);
});

test('models with no matching alternate material do not lose their copy meshes', () => {
  const bytes = writeGlb({ asset: { version: '2.0' }, materials: [{ name: 'main' }], meshes: [{ name: 'head_copy', primitives: [{ material: 0 }] }], nodes: [{ mesh: 0 }] } as never, Buffer.alloc(0));
  assert.deepEqual(selectStyleMeshes(bytes, 1), bytes);
});

test('arcana style on the head carries to sibling pieces, but explicit base style wins', () => {
  const parts = [
    { model: 'models/items/spectre/spectre_arcana/head.vmdl', style: 1 },
    { model: 'models/items/spectre/spectre_arcana/shoulder.vmdl' },
    { model: 'models/items/spectre/spectre_arcana/weapon.vmdl', explicitBaseStyle: true },
    { model: 'models/items/spectre/different_set/weapon.vmdl' },
  ] as { model: string; style?: number; explicitBaseStyle?: boolean }[];
  syncArcanaStyles(parts);
  assert.deepEqual(parts.map(p => p.style), [1, 1, undefined, undefined]);
});


test('cinematic dissolve blades are hidden in regular hero preview, ordinary weapons remain', () => {
  const bytes=writeGlb({asset:{version:'2.0'},materials:[
    {name:'spectre_body'}, {name:'spectre_arcana_landing_page_blade_dissolve'},
    {name:'weapon_glow'},
  ],meshes:[
    {name:'body',primitives:[{material:0}]},
    {name:'blade_01',primitives:[{material:1}]},
    {name:'real_weapon',primitives:[{material:2}]},
  ],nodes:[{mesh:0},{mesh:1},{mesh:2}]} as never,Buffer.alloc(0));
  assert.deepEqual(retained(hidePreviewOnlyMeshes(bytes)).nodes.map(n=>n.mesh), [0,undefined,2]);
});

test('style family has exact item directory boundaries', () => {
  assert.equal(styleFamily('models/items/spectre/arcana/head.vmdl'), 'models/items/spectre/arcana/');
  assert.equal(styleFamily('models/items/spectre/other_set/head.vmdl'), 'models/items/spectre/other_set/');
  assert.equal(styleFamily('models/heroes/spectre/spectre.vmdl'), '');
});
