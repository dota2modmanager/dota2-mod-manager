/* The particles of the 3D preview: which systems a hero and its items bring (src/particle-spec.ts)
 * and what the window makes of a system's tree (renderer/catalog/preview3d/particle-def.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroLoadoutParticles, itemParticles, modelAttachments, particleDef, particleTextures } from '../src/particle-spec.ts';
import { coverGain } from '../renderer/catalog/preview3d/particles.ts';
import { particleSpec, range, vec } from '../renderer/catalog/preview3d/particle-def.ts';
import type { ParticleDef } from '../renderer/api/preview3d.ts';

test('an item’s particles are its first style’s particle_create systems, not the Dire’s or a courier’s', () => {
  const block = `"visuals"
{
\t"asset_modifier0" { "type" "particle_create" "modifier" "Particles/Econ/Items/Jugg/Glow.vpcf" }
\t"asset_modifier1" { "type" "particle_create" "modifier" "particles/econ/dire.vpcf" "dire_only" "1" }
\t"asset_modifier2" { "type" "particle_create" "modifier" "particles/econ/style1.vpcf" "style" "1" }
\t"asset_modifier3" { "type" "particle_create" "modifier" "particles/econ/fly.vpcf" "flying_courier_only" "1" }
\t"asset_modifier4" { "type" "particle_create" "modifier" "particles/econ/lvl2.vpcf" "required_arcana_level" "2" }
\t"asset_modifier5" { "type" "particle" "asset" "particles/a.vpcf" "modifier" "particles/b.vpcf" }
\t"asset_modifier6" { "type" "particle_create" "modifier" "../../escape.vpcf" }
}`;
  assert.deepEqual(itemParticles(block), ['particles/econ/items/jugg/glow.vpcf']);
});

test('a hero’s own loadout particles come out of its RenderablePortrait block', () => {
  const script = `"npc_dota_hero_crystal_maiden"
{
\t"RenderablePortrait"
\t{
\t\t"Particles"
\t\t{
\t\t\t"particles/units/heroes/hero_crystalmaiden/maiden_loadout.vpcf"\t\t"loadout"
\t\t\t"particles/units/heroes/hero_crystalmaiden/maiden_ambient.vpcf"\t\t"ambient"
\t\t}
\t}
}`;
  assert.deepEqual(heroLoadoutParticles(script), ['particles/units/heroes/hero_crystalmaiden/maiden_loadout.vpcf']);
  assert.deepEqual(heroLoadoutParticles('"x" {}'), []);
});

test('a file the reader cannot take is no system and no attachments, not an error', () => {
  assert.equal(particleDef(() => null, 'particles/x.vpcf'), null);
  assert.equal(particleDef(() => Buffer.from('junk'), 'particles/x.vpcf'), null);
  assert.equal(particleDef(() => { throw new Error('never read'); }, 'particles/x.vpcf', { left: 0 }), null);
  assert.deepEqual(modelAttachments(null), []);
  assert.deepEqual(modelAttachments(Buffer.from('junk')), []);
});

test('a number or a vector in any of the forms the file writes it', () => {
  assert.deepEqual(range(3, 1), [3, 3]);
  assert.deepEqual(range({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: 12 }, 1), [12, 12]);
  assert.deepEqual(range({ m_flRandomMin: 1, m_flRandomMax: 4 }, 0), [1, 4]);
  assert.deepEqual(range({ m_nType: 'PF_TYPE_CONTROL_POINT_COMPONENT' }, 5), [5, 5]);
  assert.deepEqual(vec([1, 2, 3, 4]), [1, 2, 3]);
  assert.deepEqual(vec({ m_vLiteralValue: [0, 0, 9] }), [0, 0, 9]);
  assert.deepEqual(vec('no', [1, 1, 1]), [1, 1, 1]);
});

const def = (tree: ParticleDef['tree'], children: ParticleDef[] = []): ParticleDef => ({ path: 'particles/t.vpcf', tree, children });

test('a snow burst: its emitter, lifetime, colour, spawn ring, movement and fades', () => {
  const s = particleSpec(def({
    m_nMaxParticles: 2000,
    m_Emitters: [{ _class: 'C_OP_ContinuousEmitter', m_flEmitRate: 1200, m_flEmissionDuration: 0.35 }],
    m_Initializers: [
      { _class: 'C_INIT_RandomLifeTime', m_fLifetimeMin: 1, m_fLifetimeMax: 2 },
      { _class: 'C_INIT_RandomColor', m_ColorMin: [255, 0, 0, 255], m_ColorMax: [0, 0, 255, 255] },
      { _class: 'C_INIT_RingWave', m_nControlPointNumber: 1, m_flInitialRadius: 50, m_flInitialSpeedMax: 550 },
    ],
    m_Operators: [
      { _class: 'C_OP_BasicMovement', m_Gravity: [0, 0, -200], m_fDrag: 0.1 },
      { _class: 'C_OP_FadeOutSimple', m_flFadeOutTime: 0.5 },
      { _class: 'C_OP_Decay' },
    ],
    m_Renderers: [{ _class: 'C_OP_RenderSprites', m_nOutputBlendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ADD', m_flOverbrightFactor: 9 }],
  }));
  assert.deepEqual([s.max, s.rate, s.duration, s.burst], [400, 1200, 0.35, 0]);
  assert.deepEqual(s.life, [1, 2]);
  assert.deepEqual(s.colors, [[1, 0, 0], [0, 0, 1]]);
  assert.deepEqual([s.spawn.cp, s.spawn.ring], [1, { radius: 50, speed: [0, 550] }]);
  assert.deepEqual([s.gravity, s.drag, s.fadeOut], [[0, 0, -200], 0.1, 0.5]);
  assert.deepEqual([s.draw, s.bright, s.mortal], ['add', 4, true]);
});

test('a glow whose only decay waits for the effect to stop lives on, at its constant colour’s alpha', () => {
  const s = particleSpec(def({
    m_flConstantLifespan: 0.1, m_ConstantColor: [213, 159, 100, 51],
    m_Emitters: [{ _class: 'C_OP_InstantaneousEmitter', m_nParticlesToEmit: { m_flLiteralValue: 12 } }],
    m_Operators: [{ _class: 'C_OP_Decay', m_nOpEndCapState: 'PARTICLE_ENDCAP_ENDCAP_ON' }],
    m_Renderers: [{ _class: 'C_OP_RenderSprites' }],
  }));
  assert.equal(s.burst, 12);
  assert.equal(s.mortal, false);
  assert.deepEqual(s.alpha, [0.2, 0.2]);
  assert.equal(s.draw, 'blend');
});

test('control points: an attachment on the item or the hero, a point set off another, and the children inherit them', () => {
  const s = particleSpec(def({
    m_controlPointConfigurations: [{ m_drivers: [
      { m_iControlPoint: 0, m_iAttachType: 'PATTACH_POINT_FOLLOW', m_attachmentName: 'attach_sword', m_entityName: 'self' },
      { m_iControlPoint: 2, m_iAttachType: 'PATTACH_ABSORIGIN_FOLLOW', m_attachmentName: 'attach_hitloc', m_entityName: 'parent' },
    ] }],
    m_PreEmissionOperators: [{ _class: 'C_OP_SetSingleControlPointPosition', m_nCP1: 1, m_vecCP1Pos: [100, 0, 0] }],
  }, [def({ m_Renderers: [{ _class: 'C_OP_RenderTrails' }] })]));
  assert.deepEqual(s.cps.get(0), { entity: 'self', attachment: 'attach_sword' });
  // an origin attachment follows the entity, not the point
  assert.deepEqual(s.cps.get(2), { entity: 'parent', attachment: null });
  assert.deepEqual(s.cps.get(1), { entity: 'parent', attachment: null, world: [100, 0, 0], from: 0 });
  assert.equal(s.draw, 'none');
  assert.deepEqual(s.children[0].cps.get(0), { entity: 'self', attachment: 'attach_sword' });
  assert.equal(s.children[0].draw, 'blend');
});

test('a sprite draws the texture its first input names, and a MOD2X renderer is left out', () => {
  const tex = (t: string, blend = 'PARTICLE_OUTPUT_BLEND_MODE_ADD') => ({ _class: 'C_OP_RenderSprites', m_nOutputBlendMode: blend, m_vecTexturesInput: [{ m_hTexture: t }] });
  const s = particleSpec(def({ m_Renderers: [tex('materials/particle/darken.vtex', 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X'), tex('Materials/Particle/Snow.vtex')] }));
  assert.deepEqual([s.draw, s.texture], ['add', 'materials/particle/snow.vtex']);
  // the textures to export: each system's and its children's, once, and nothing that is not a texture path
  const tree = def({ m_Renderers: [tex('materials/particle/snow.vtex')] }, [def({ m_Renderers: [tex('materials/particle/snow.vtex'), tex('../x.vtex')] }), def({ m_Renderers: [tex('materials/particle/glow.vtex')] })]);
  assert.deepEqual(particleTextures(tree), ['materials/particle/snow.vtex', 'materials/particle/glow.vtex']);
});

test('an untextured cloud is dimmed by how much of the frame it covers, at its largest', () => {
  const base = { rate: 0, burst: 10, life: [1, 1] as [number, number], max: 100, radius: [5, 5] as [number, number], size: { from: 1, to: 1, start: 0, end: 1 } };
  assert.equal(coverGain(base), 1, 'a few specks stay as bright as written');
  const snow = { ...base, burst: 200, radius: [10, 10] as [number, number], size: { from: 12, to: 1, start: 0, end: 1 } };
  assert.ok(coverGain(snow) < 0.1, 'a burst that starts twelve times its size is a dome, and dimmed');
  assert.ok(coverGain({ ...snow, size: { from: 1, to: 1, start: 0, end: 1 } }) > coverGain(snow));
});
