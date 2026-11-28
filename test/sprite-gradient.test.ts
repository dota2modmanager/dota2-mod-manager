// A sprite layer that the game replaces with a gradient (vendor/dota-loadout/src/sprite-textures.js): the river's
// waves light one side of their ring only, as RenderDoc showed the game drawing them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpriteTextures } from '../vendor/dota-loadout/src/sprite-textures.js';

const lit = (v: number) => ({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: v });

test("a wave's gradient layer is found with its stops, its quarter turn and its offset", () => {
  // map_riverflow_waves.vpcf's additive renderer, as the game's files have it
  const spec = resolveSpriteTextures({
    m_vecTexturesInput: [
      { m_hTexture: 'materials/particle/particle_ring_fade.vtex', m_TextureControls: { m_flFinalTextureOffsetV: lit(0.05) } },
      {
        m_bReplaceTextureWithGradient: true,
        m_Gradient: { m_Stops: [{ m_flPosition: 0.447028, m_Color: [1, 1, 1] }, { m_flPosition: 0, m_Color: [150, 150, 150] }, { m_flPosition: 0.157623, m_Color: [255, 255, 255] }] },
        m_TextureControls: { m_flFinalTextureUVRotation: lit(90), m_flFinalTextureOffsetV: lit(0.3) },
      },
      { m_hTexture: 'materials/particle/beam_turb_noise.vtex' },
    ],
  });
  assert.equal(spec.path, 'materials/particle/particle_ring_fade.vtex');
  assert.deepEqual(spec.gradient?.stops.map((s: { at: number }) => s.at), [0, 0.157623, 0.447028]);
  assert.equal(spec.gradient?.turns, 1);
  assert.deepEqual(spec.gradient?.offset, [0, 0.3]);
});

test('a renderer without a gradient layer has none, and an empty gradient counts as none', () => {
  assert.equal(resolveSpriteTextures({ m_hTexture: 'materials/particle/particle_glow_05.vtex' }).gradient, null);
  assert.equal(resolveSpriteTextures({ m_vecTexturesInput: [{ m_hTexture: 'a.vtex', m_bReplaceTextureWithGradient: true, m_Gradient: { m_Stops: [] } }] }).gradient, null);
});
