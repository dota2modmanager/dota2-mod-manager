import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calibrateCosmicFxRenderer} from '../vendor/dota-loadout/src/tinker-cosmic-fx-calibration.js';

const lit = (x, fallback=undefined) => (x && typeof x === 'object' ? x.m_flLiteralValue : x) ?? fallback;
const make = (texture, bright=1, scale=1, opts={}) => ({
  _class:'C_OP_RenderSprites',
  m_vecTexturesInput:[{m_hTexture:`materials/particle/${texture}`}],
  m_nOutputBlendMode:'PARTICLE_OUTPUT_BLEND_MODE_ADD',
  m_flOverbrightFactor:{m_nType:'PF_TYPE_LITERAL',m_flLiteralValue:bright},
  m_flRadiusScale:{m_nType:'PF_TYPE_LITERAL',m_flLiteralValue:scale},
  ...opts,
});
const sys = n => `particles/econ/items/tinker/tinker_cosmic/${n}.vpcf`;

test('Cosmic weapon solid additive circle loses excessive gain, gets feathered, stays visible',()=>{
 const orig=make('primitives/primitive_circle_solid.vtex',10,1.7);
 const r=calibrateCosmicFxRenderer(orig,sys('tinker_cosmic_weapon_ambient_blob'));
 assert.notEqual(r,orig);
 assert.equal(lit(r.m_flOverbrightFactor),1.05);
 assert.equal(lit(r.m_flRadiusScale),1.7*.48);
 assert.equal(lit(r.m_flAlphaScale),.48);
 assert.equal(r.studioSoftDisc,true);
 assert.equal(lit(orig.m_flOverbrightFactor),10);
});
test('Three shoulder lens flares are independently toned down but not disabled',()=>{
 for (const [tex,bright] of [['lens_flare/pro_flares/pro_flares.vtex',4],['particle_flares/combined_flare.vtex',3],['particle_flares/anam_white_bloom.vtex',4]]) {
  const r=calibrateCosmicFxRenderer(make(tex,bright,1),sys('tinker_cosmic_shoulder_ambient_flare'));
  assert.equal(lit(r.m_flOverbrightFactor),1.05);
  assert.equal(lit(r.m_flRadiusScale),.72);
  assert.equal(lit(r.m_flAlphaScale),.54);
  assert.equal(r.studioSoftDisc,undefined);
 }
});
test('Weapon and offhand cores are smaller and retain their textures',()=>{
 for(const name of ['tinker_cosmic_weapon_ambient_light','tinker_cosmic_offhand_ambient_light']) {
  const r=calibrateCosmicFxRenderer(make('particle_glow_05.vtex',2,2.5),sys(name));
  assert.equal(lit(r.m_flOverbrightFactor),1.25);
  assert.equal(lit(r.m_flRadiusScale),1.75);
  assert.equal(lit(r.m_flAlphaScale),.8);
  assert.match(r.m_vecTexturesInput[0].m_hTexture,/particle_glow_05/);
 }
});
test('Mod2x and animated shader modulation use original renderer parameters',()=>{
 const src=make('light_glow_01.vtex',8,1,{m_nOutputBlendMode:'PARTICLE_OUTPUT_BLEND_MODE_MOD2X'});
 assert.equal(calibrateCosmicFxRenderer(src,sys('tinker_cosmic_weapon_ambient_light')),src);
});
test('Spectre, Sven, PA, Timbersaw and other Tinker item particles are entirely unchanged',()=>{
 const src=make('primitives/primitive_circle_solid.vtex',10,1.7);
 for(const p of ['particles/items/spectre/spectre_arcana.vpcf','particles/econ/items/sven/sven_weapon.vpcf','particles/econ/items/phantom_assassin/pa_arcana.vpcf','particles/econ/items/shredder/shredder_weapon.vpcf','particles/units/heroes/hero_tinker/tinker_rearm.vpcf']){
  assert.equal(calibrateCosmicFxRenderer(src,p),src,p);
 }
});
test('renderer connects the calibration to per-system particle source and soft edge shader',()=>{
 const src=fs.readFileSync(new URL('../vendor/dota-loadout/src/fx.js',import.meta.url),'utf8');
 assert.match(src,/const r = calibrateCosmicFxRenderer\(original, sim\?\.def\?\._path\)/);
 assert.match(src,/uniform bool studioSoftDisc/);
 assert.match(src,/if \(studioSoftDisc\) a \*= 1\.0 - smoothstep/);
 assert.match(src,/studioSoftDisc: \{ value: r\.studioSoftDisc === true \}/);
});

test('the Interstellar Astrarium shoulder flare caps the captured scale of 30', () => {
  const renderer = {
    _class: 'C_OP_RenderSprites',
    m_vecTexturesInput: [{ m_hTexture: 'materials/particle/particle_flares/aircraft_white.vtex' }],
    m_flRadiusScale: { m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: 30 },
    m_flOverbrightFactor: 4,
  };
  const tuned = calibrateCosmicFxRenderer(renderer, 'tinker_cosmic_shoulder_ambient_triangle.vpcf');
  assert.equal(tuned.m_flRadiusScale.m_flLiteralValue, 1.5);
  assert.equal(tuned.m_flOverbrightFactor, 1.2);
  assert.equal(renderer.m_flRadiusScale.m_flLiteralValue, 30);
});
