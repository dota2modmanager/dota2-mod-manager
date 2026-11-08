import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSpriteTextures} from '../vendor/dota-loadout/src/sprite-textures.js';
import {calibratePreviewMaterial} from '../vendor/dota-loadout/studio/material-calibration.mjs';
import {blobAppearance} from '../vendor/dota-loadout/src/blob-appearance.js';
import fs from 'node:fs';

test('Tinker lens flare with opaque PNG alpha uses RGB coverage rather than a white quad',()=>{
 const r={m_vecTexturesInput:[{m_hTexture:'materials/particle/lens_flare/pro_flares/pro_flares.vtex',m_nTextureChannels:'SPRITECARD_TEXTURE_CHANNEL_MIX_A'}]};
 const p=resolveSpriteTextures(r);
 assert.equal(p.alphaChannelFromLuma,true);assert.equal(p.channel,'SPRITECARD_TEXTURE_CHANNEL_MIX_A');
});
test('Tinker combined flare and anam bloom also use RGB coverage',()=>{
 for(const name of ['combined_flare','anam_white_bloom']){
  const p=resolveSpriteTextures({m_vecTexturesInput:[{m_hTexture:`materials/particle/particle_flares/${name}.vtex`,m_nTextureChannels:'SPRITECARD_TEXTURE_CHANNEL_MIX_A'}]});
  assert.equal(p.alphaChannelFromLuma,true,name);
 }
});
test('other flares with real alpha are unchanged',()=>{
 const p=resolveSpriteTextures({m_vecTexturesInput:[{m_hTexture:'materials/particle/softglow_tra.vtex',m_nTextureChannels:'SPRITECARD_TEXTURE_CHANNEL_MIX_A'}]});
 assert.equal(p.alphaChannelFromLuma,false);
});
test('normal sprite alpha and Spectre alpha cloud stay unchanged',()=>{
 const p=resolveSpriteTextures({m_vecTexturesInput:[{m_hTexture:'materials/particle/alpha/alpha_cloud.vtex'}]});
 assert.equal(p.alphaChannelFromLuma,false);assert.equal(p.alphaFromLuma,true);
});
test('Tinker native hero gain is reduced but geometry and other material fields unchanged',()=>{
 const original={specScale:17,rimScale:5,normal:'normal.png',masks:'mask.png',specular:'spec.png',baseColor:[1,1,1,1]};
 for (const name of ['head','shoulders','back','weapon','offhand']) {
  const p=calibratePreviewMaterial(original,`materials/models/items/tinker/tinker_cosmic/${name}/tinker_cosmic_${name}.vmat`);
  assert.equal(p.specScale,2.2);assert.equal(p.rimScale,2);assert.deepEqual(p.baseColor,original.baseColor);assert.equal(p.specular,original.specular);
 }
 assert.equal(original.specScale,17);
});
test('Sven, Phantom Assassin and other heroes retain their material parameters',()=>{
 const m={specScale:17,rimScale:5};
 assert.equal(calibratePreviewMaterial(m,'materials/models/items/sven/weapon.vmat'),m);
 assert.equal(calibratePreviewMaterial(m,'materials/models/items/tinker/default/tinker_weapon.vmat'),m);
});
test('renderer consumes the encoded alpha channel recovery flag',()=>{
 const text=fs.readFileSync(new URL('../vendor/dota-loadout/src/fx.js',import.meta.url),'utf8');
 assert.match(text,/alphaChannelFromLuma: \{ value: !!texInfo\.alphaChannelFromLuma \}/);
 assert.match(text,/alphaChannelFromLuma \? l : t\.a/);
});

test('Tinker weapon ice blob is transparent and non-metallic instead of chrome',()=>{
 const t=blobAppearance('studio/2/materials/models/items/tinker/tinker_cosmic/weapon/tinker_cosmic_weapon_blob.vmat',{vectors:{g_vSpecularColor:[0.75,0.56,1,1]}});
 assert.deepEqual(t.tint.slice(0,3),[0.75,0.56,1]);
 assert.equal(t.metalness,0);assert.equal(t.clearcoat,0);assert.ok(t.opacity<0.9);
});
test('other heroes keep their current blob appearance',()=>{
 const t=blobAppearance('materials/models/particle/sphere_fire2.vmat',{});
 assert.equal(t.metalness,0.35);assert.equal(t.clearcoat,1);assert.equal(t.opacity,0.9);
});

test('preview preserves diffuse color when a reflective material has no cube', async () => {
 const {heroMaterial}=await import('../vendor/dota-loadout/src/material.js');
 const descriptor={previewLighting:true,expectsReflectionCube:true};
 const fallback=heroMaterial(descriptor,()=>null,{value:0},{});
 const reflected=heroMaterial({...descriptor,cube:'environment'},()=>null,{value:0},{},()=>null);
 const native=heroMaterial({...descriptor,previewLighting:false},()=>null,{value:0},{});
 assert.equal(fallback.userData.hero.uMetalness.value,0.45);
 assert.equal(reflected.userData.hero.uMetalness.value,1);
 assert.equal(native.userData.hero.uMetalness.value,1);
 for(const material of [fallback,reflected,native]) material.dispose();
});
