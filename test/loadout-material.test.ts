/* An NTRO material in the 3D preview: its textures are eight-byte ids of RERL entries. Read as
 * string offsets they threw, and 8300 of the game's 15372 hero and wearable materials (Abaddon's
 * whole body among them) reached the preview as the exporter's see-through stand-in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resource, rerl } from './helpers/kv3-build.ts';
import { resourceId } from '../src/resource.ts';
import { readLoadoutMaterial, loadoutDescriptor } from '../src/loadout-material.ts';

type Struct = { id: number; name: string; size: number; base: number; fields: [string, number][] };

function ntroBlock(structs: Struct[]): Buffer {
  const fieldCount = structs.reduce((a, s) => a + s.fields.length, 0);
  const listAt = 20;
  const fieldsAt = listAt + structs.length * 40;
  const textAt = fieldsAt + fieldCount * 24;
  const names: Buffer[] = [];
  let textEnd = textAt;
  const name = (s: string) => { const at = textEnd; names.push(Buffer.from(`${s}\0`)); textEnd += s.length + 1; return at; };
  const ntro = Buffer.alloc(textAt);
  ntro.writeUInt32LE(4, 0); ntro.writeUInt32LE(listAt - 4, 4); ntro.writeUInt32LE(structs.length, 8);
  let f = fieldsAt;
  structs.forEach((s, i) => {
    const e = listAt + i * 40;
    ntro.writeUInt32LE(s.id, e + 4);
    ntro.writeUInt32LE(name(s.name) - (e + 8), e + 8);
    ntro.writeUInt16LE(s.size, e + 20);
    ntro.writeUInt32LE(s.base, e + 24);
    ntro.writeUInt32LE(f - (e + 28), e + 28);
    ntro.writeUInt32LE(s.fields.length, e + 32);
    for (const [fname, off] of s.fields) {
      ntro.writeUInt32LE(name(fname) - f, f);
      ntro.writeInt16LE(off, f + 6);
      f += 24;
    }
  });
  return Buffer.concat([ntro, ...names]);
}

/** hero.vfx with one int switch and two textures, laid out as the game's abaddon_body.vmat_c is. */
function ntroMaterial(): Buffer {
  const structs: Struct[] = [
    { id: 1, name: 'MaterialParam_t', size: 4, base: 0, fields: [['m_name', 0]] },
    { id: 2, name: 'MaterialParamInt_t', size: 8, base: 1, fields: [['m_nValue', 4]] },
    { id: 3, name: 'MaterialParamTexture_t', size: 16, base: 1, fields: [['m_pValue', 8]] },
    { id: 4, name: 'MaterialResourceData_t', size: 24, base: 0, fields: [['m_shaderName', 0], ['m_intParams', 8], ['m_textureParams', 16]] },
  ];
  const textures = ['materials/models/heroes/abaddon/abaddon_body_color_psd.vtex', 'materials/models/heroes/abaddon/abaddon_body_masks1_tga.vtex'];
  // root (24) | one int (8) | two textures (32) | strings
  const data = Buffer.alloc(24 + 8 + 32);
  const strings: Buffer[] = [];
  let end = data.length;
  const str = (s: string) => { const at = end; strings.push(Buffer.from(`${s}\0`)); end += s.length + 1; return at; };
  data.writeUInt32LE(str('hero.vfx') - 0, 0);
  data.writeUInt32LE(24 - 8, 8); data.writeUInt32LE(1, 12);
  data.writeUInt32LE(32 - 16, 16); data.writeUInt32LE(2, 20);
  data.writeUInt32LE(str('F_MASKS_1') - 24, 24); data.writeInt32LE(1, 28);
  ['g_tColor', 'g_tMasks1'].forEach((n, i) => {
    const at = 32 + i * 16;
    data.writeUInt32LE(str(n) - at, at);
    data.writeBigUInt64LE(resourceId(textures[i]), at + 8);
  });
  return resource([['RERL', rerl(['materials/other.vtex', ...textures])], ['NTRO', ntroBlock(structs)], ['DATA', Buffer.concat([data, ...strings])]]);
}

test('an NTRO material names its textures through RERL, and keeps its shader and switches', () => {
  const m = readLoadoutMaterial(ntroMaterial());
  assert.ok(m, 'the material is read, not dropped');
  assert.equal(m.shader, 'hero.vfx');
  assert.equal(m.ints.F_MASKS_1, 1);
  assert.equal(m.textures.g_tColor, 'materials/models/heroes/abaddon/abaddon_body_color_psd.vtex');
  assert.equal(m.textures.g_tMasks1, 'materials/models/heroes/abaddon/abaddon_body_masks1_tga.vtex');
  // a hero material read is drawn by the hero shader, not as a translucent stand-in
  assert.equal(loadoutDescriptor(m).translucent, false);
  // the game's own masks, in the Workshop's layout, which the renderer reads in its own order unless told
  assert.equal(loadoutDescriptor(m).workshopMasks, true);
  assert.equal(loadoutDescriptor(m).selfIllum, false, 'self-illumination only where F_SELF_ILLUM is on');
});
