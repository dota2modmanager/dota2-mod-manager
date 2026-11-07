import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpriteTextures } from '../vendor/dota-loadout/src/sprite-textures.js';

test('Spectre alpha-cloud shader reads the visible texture after a blank UV-only slot', () => {
  const result = resolveSpriteTextures({ m_vecTexturesInput: [
    { m_TextureControls: { m_flFinalTextureUVRotation: { m_flLiteralValue: 90 } } },
    { m_hTexture: 'materials/particle/tile/tile_clouds_01.vtex', m_nTextureType: 'SPRITECARD_TEXTURE_UVDISTORTION' },
    { m_hTexture: 'materials/particle/alpha/alpha_cloud.vtex' },
  ] });
  assert.equal(result.path, 'materials/particle/alpha/alpha_cloud.vtex');
  assert.equal(result.alphaFromLuma, true);
});

test('particle sprite with only UV transform is not replaced with an arbitrary glow', () => {
  assert.equal(resolveSpriteTextures({m_vecTexturesInput:[{}]}).path, null);
});

test('normal particle sprite keeps the original texture', () => {
  const path = 'materials/particle/softglow_tra.vtex';
  assert.equal(resolveSpriteTextures({m_vecTexturesInput:[{m_hTexture:path}]}).path,path);
});

test('alpha mask in later sprite input is retained for blending', () => {
  const result = resolveSpriteTextures({m_vecTexturesInput:[
    {m_hTexture:'materials/particle/tile/tile_clouds_01.vtex'},
    {m_hTexture:'materials/particle/alpha/alpha_cloud.vtex'},
  ]});
  assert.equal(result.path,'materials/particle/tile/tile_clouds_01.vtex');
  assert.equal(result.maskPath,'materials/particle/alpha/alpha_cloud.vtex');
});

test('UV distortion is never used as sprite colour', () => {
  const result = resolveSpriteTextures({m_vecTexturesInput:[
    {m_hTexture:'materials/particle/dust/dust_01.vtex'},
    {m_hTexture:'materials/particle/warp/uv_warp_01.vtex',m_nTextureType:'SPRITECARD_TEXTURE_UVDISTORTION'},
  ]});
  assert.match(result.path,/dust_01/);
  assert.equal(result.maskPath,null);
});
