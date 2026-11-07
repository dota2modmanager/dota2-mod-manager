import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildHero } from 'dota-loadout';
import { SceneSource } from 'dota-loadout/studio';
import { animatedLoadoutModel } from './fixtures/loadout-model.ts';
import { loadoutEffects, loadoutAttachments, loadoutPacket, visibleGlb } from '../renderer/catalog/preview3d/loadout-source.ts';
import type { ParticleDef } from '../renderer/api/preview3d.ts';

const def=():ParticleDef=>({path:'particles/bound.vpcf',children:[],tree:{m_flConstantLifespan:10,m_controlPointConfigurations:[{m_name:'preview',m_drivers:[{m_iControlPoint:0,m_iAttachType:'PATTACH_POINT_FOLLOW',m_attachmentName:'tip'}]}],m_Emitters:[{_class:'C_OP_InstantaneousEmitter',m_nParticlesToEmit:1}],m_Initializers:[{_class:'C_INIT_CreateWithinSphere',m_fRadiusMax:0}],m_Operators:[{_class:'C_OP_PositionLock',m_nControlPointNumber:0,m_bLockRot:true}]}});
const attachments=()=>loadoutAttachments([{name:'tip',bone:'hand',offset:[0,0,0],rotation:[0,0,0,1]}]);
const light=():Record<string,{value:unknown}>=>Object.fromEntries([...['uLightDir','uAmbientDir','uUp'].map(k=>[k,{value:new THREE.Vector3(0,1,0)}]),...['uLightColor','uAmbientColor','uAmbientTint','uShadowColor'].map(k=>[k,{value:new THREE.Color(1,1,1)}])]);

// GLTFLoader's progress event is a browser class; Node's fetch works for the actual blob GLB.
if(!globalThis.ProgressEvent)Object.defineProperty(globalThis,'ProgressEvent',{value:class extends Event{constructor(type:string,options:object){super(type);Object.assign(this,options);}},configurable:true});

test('real loadout engine moves an attached particle with the animated bone every frame',async()=>{
  const source=new SceneSource();source.addGlb(animatedLoadoutModel(),{key:'hero',owner:'hero'});source.manifest.attachments.hero=attachments();
  const hero=await buildHero(source.manifest,source.url,new THREE.LoadingManager(),{value:0},light());
  try{
    await hero.studioEffects(loadoutEffects(source,[{part:-1,def:def()}],{}));
    const camera=new THREE.PerspectiveCamera();hero.update(.01,camera);
    assert.equal(hero.effects[0].sim.particles.length,1);
    const start=hero.effects[0].sim.particles[0].pos.clone();
    for(let i=0;i<20;i++)hero.update(.02,camera);
    const end=hero.effects[0].sim.particles[0].pos;
    assert.ok(end.distanceTo(start)>10,'particle follows the hand instead of remaining at its spawn point');
    assert.ok(end.distanceTo(hero.effects[0].sim.cps.get(0)!.pos)<.01);
  }finally{hero.dispose();source.dispose();}
});

test('full particle packets retain child metadata and do not mutate the editor definition',()=>{
  const root=def();root.children=[{...def(),path:'particles/child.vpcf',delay:.2,childGroup:7}];
  const packet=loadoutPacket(root);
  assert.deepEqual(packet.definitions[root.path].m_Children,[{m_ChildRef:'particles/child.vpcf',m_nChildGroupID:7,m_flDelay:.2,m_bEndCap:false}]);
  assert.equal(root.tree.m_Children,undefined);
  const source=new SceneSource();source.owners.set('part-0','part-0');
  const out=loadoutEffects(source,[{part:0,def:root}],{});
  assert.equal(out.effects[0].owner,'part-0');
  assert.equal((out.systems['studio/0/particles/bound'].m_Children as {m_ChildRef:string}[])[0].m_ChildRef,'studio/0/particles/child');source.dispose();
});

test('weighted attachment inputs and hidden mesh exclusion survive the desktop boundary',()=>{
  const rows=loadoutAttachments([{name:'tip',bone:'hand',offset:[1,2,3],rotation:[0,0,0,1],bones:['hand','other'],offsets:[[1,2,3],[4,5,6]],rotations:[[0,0,0,1],[0,0,0,1]],weights:[.25,.75],ignoreRotation:true}]);
  assert.deepEqual(rows.tip.weights,[.25,.75]);assert.equal(rows.tip.ignoreRotation,true);
  const bytes=animatedLoadoutModel();assert.notDeepEqual(visibleGlb(bytes,['triangle']),bytes);assert.equal(visibleGlb(bytes,[]),bytes);
});

test('snapshot particles use the current skinned pose, including after effects are replaced',async()=>{
 const source=new SceneSource();source.addGlb(animatedLoadoutModel(),{key:'hero',owner:'hero'});
 const hero=await buildHero(source.manifest,source.url,new THREE.LoadingManager(),{value:0},light());
 try{
  const d=def();d.tree.m_hSnapshot='particles/hand.vsnap';d.tree.m_Initializers=[{_class:'C_INIT_InitSkinnedPositionFromCPSnapshot'}];d.tree.m_Operators=[{_class:'C_OP_SnapshotSkinToBones'}];
  const resources={snapshots:{'particles/hand.vsnap':{position:[[0,0,0]],skinning:[[['hand',1]]]}},materials:{},models:{},sheets:{},missing:[]};
  const patch=loadoutEffects(source,[{part:-1,def:d}],{},resources);await hero.studioEffects(patch);
  const camera=new THREE.PerspectiveCamera();hero.update(.01,camera);const sim=hero.effects[0].sim,start=sim.particles[0].pos.clone();
  for(let i=0;i<20;i++)hero.update(.02,camera);assert.ok(sim.particles[0].pos.distanceTo(start)>10);
  await hero.studioEffects(patch);hero.update(.01,camera);assert.equal(hero.effects.length,1);assert.notEqual(hero.effects[0].sim,sim);
 }finally{hero.dispose();source.dispose();}
});

test('explicit parent drivers choose the hero attachment when a wearable has the same name',async()=>{
 const source=new SceneSource();source.addGlb(animatedLoadoutModel(),{key:'hero',owner:'hero'});source.addGlb(animatedLoadoutModel(),{key:'part-0',owner:'part-0',itemId:'part-0'});
 source.manifest.attachments.hero=attachments();source.manifest.attachments['part-0']=loadoutAttachments([{name:'tip',bone:'hand',offset:[100,0,0],rotation:[0,0,0,1]}]);
 const hero=await buildHero(source.manifest,source.url,new THREE.LoadingManager(),{value:0},light());
 try{
  const parent=def(),self=def();parent.tree.m_controlPointConfigurations=[{m_name:'preview',m_drivers:[{m_iControlPoint:0,m_iAttachType:'PATTACH_POINT_FOLLOW',m_entityName:'parent',m_attachmentName:'tip'}]}];
  await hero.studioEffects(loadoutEffects(source,[{part:0,def:parent},{part:0,def:self}],{}));hero.update(.01,new THREE.PerspectiveCamera());
  assert.ok(Math.abs(hero.effects[0].sim.cps.get(0)!.pos.distanceTo(hero.effects[1].sim.cps.get(0)!.pos)-100)<.001);
 }finally{hero.dispose();source.dispose();}
});

test('model particles only receive their own resources and Void tentacles can be isolated', () => {
  const root = def();
  const tentacle = 'models/items/faceless_void/faceless_void_arcana/fv_arcana_tentacle_b.vmdl';
  const other = 'models/other.vmdl';
  root.tree.m_Renderers = [
    { _class: 'C_OP_RenderModels', m_ModelList: [{ m_model: tentacle }] },
    { _class: 'C_OP_RenderSprites' },
    { _class: 'C_OP_RenderModels', m_ModelList: [{ m_model: other }] },
  ];
  const resources = { models: { [tentacle]: { data: 'a' }, [other]: { data: 'b' }, 'models/unrelated.vmdl': { data: 'c' } }, snapshots: {}, materials: {}, sheets: {}, missing: [] };
  const packet = loadoutPacket(root, resources);
  assert.deepEqual(Object.keys(packet.models!), [other]);
  assert.deepEqual(packet.definitions[root.path].m_Renderers, root.tree.m_Renderers.slice(1));
  assert.equal(root.tree.m_Renderers.length, 3);
});

test('Manifold Paradox blade surface fallback is selected only without the native snapshot', () => {
  const root = def();
  root.path = 'particles/econ/items/phantom_assassin/phantom_assassin_arcana_elder_smith/pa_arcana_blade_ambient_b.vpcf';
  const snapshot = 'particles/models/heroes/phantom_assassin/pa_arcana_weapon_b.vsnap';
  root.tree.m_hSnapshot = snapshot;
  const resources = { models: {}, snapshots: {}, materials: {}, sheets: {}, missing: [] };
  assert.equal(loadoutPacket(root, resources).definitions[root.path].m_studioBladeSide, 'b');
  assert.equal(loadoutPacket(root, { ...resources, snapshots: { [snapshot]: { position: [[0, 0, 0]] } } }).definitions[root.path].m_studioBladeSide, undefined);
});

test('a missing weapon attachment falls back to the valid weapon CP instead of the hero origin', async () => {
  const source = new SceneSource();
  source.addGlb(animatedLoadoutModel(), { key: 'hero', owner: 'hero' });
  source.manifest.attachments['part-0'] = attachments();
  const hero = await buildHero(source.manifest, source.url, new THREE.LoadingManager(), {value:0}, light());
  try {
    const root = def();
    root.tree.m_controlPointConfigurations = [{ m_name: 'preview', m_drivers: [
      { m_iControlPoint: 0, m_iAttachType: 'PATTACH_POINT_FOLLOW', m_attachmentName: 'tip' },
      { m_iControlPoint: 10, m_iAttachType: 'PATTACH_POINT_FOLLOW', m_attachmentName: 'missing-gem' },
    ] }];
    await hero.studioEffects(loadoutEffects(source, [{ part: 0, def: root }], {}));
    hero.update(.01, new THREE.PerspectiveCamera());
    const cps = hero.effects[0].sim.cps;
    assert.ok(cps.get(0)!.pos.length() > 1);
    assert.deepEqual(cps.get(10)!.pos.toArray(), cps.get(0)!.pos.toArray());
  } finally { hero.dispose(); source.dispose(); }
});
