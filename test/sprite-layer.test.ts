// A sprite layer the card is multiplied by part way (vendor/dota-loadout/src/sprite-textures.js multiplyLayer):
// the river's waves break into patches by a noise, as RenderDoc showed the game drawing them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpriteTextures } from '../vendor/dota-loadout/src/sprite-textures.js';

const lit = (v: number) => ({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: v });
const age = (k: number) => ({ m_nType: 'PF_TYPE_COLLECTION_AGE', m_nMapType: 'PF_MAP_TYPE_MULT', m_flMultFactor: k });

// map_riverflow_waves.vpcf's additive renderer, as the game's files have it
const waves = {
  m_vecTexturesInput: [
    { m_hTexture: 'materials/particle/particle_ring_fade.vtex', m_TextureControls: { m_flFinalTextureOffsetV: lit(0.05) } },
    { m_bReplaceTextureWithGradient: true, m_Gradient: { m_Stops: [{ m_flPosition: 0, m_Color: [150, 150, 150] }] } },
    {
      m_hTexture: 'materials/particle/beam_turb_noise.vtex',
      m_flTextureBlend: lit(0.6),
      m_TextureControls: {
        m_flFinalTextureOffsetV: age(0.3), m_flFinalTextureScaleU: lit(0.6), m_flFinalTextureScaleV: lit(0.6),
        m_bRandomizeOffsets: true, m_nPerParticleScale: 'SPRITECARD_TEXTURE_PP_SCALE_SHADER_EXTRA_DATA1',
      },
    },
    { m_hTexture: 'materials/particle/tile/tile_noise_plasma.vtex', m_flTextureBlend: lit(0.3), m_bEnabled: false },
  ],
};

test("the waves' noise is found with its blend, scale, scroll, random offsets and per-particle scale", () => {
  const spec = resolveSpriteTextures(waves);
  assert.equal(spec.path, 'materials/particle/particle_ring_fade.vtex');
  assert.deepEqual(spec.multiply, {
    path: 'materials/particle/beam_turb_noise.vtex', blend: 0.6, scale: [0.6, 0.6], offset: [0, 0], rate: [0, 0.3], random: true, field: 39,
  });
});

test('a layer switched off is not drawn, and a layer blended other than by multiplying is left out', () => {
  const off = { m_vecTexturesInput: [waves.m_vecTexturesInput[0], waves.m_vecTexturesInput[3]] };
  assert.equal(resolveSpriteTextures(off).multiply, null);
  const add = { m_vecTexturesInput: [waves.m_vecTexturesInput[0], { ...waves.m_vecTexturesInput[2], m_nTextureBlendMode: 'SPRITECARD_TEXTURE_BLEND_ADD' }] };
  assert.equal(resolveSpriteTextures(add).multiply, null);
  // the colour layer itself is never its own multiplied layer
  assert.equal(resolveSpriteTextures({ m_vecTexturesInput: [waves.m_vecTexturesInput[2]] }).multiply, null);
});
