import test from 'node:test';
import assert from 'node:assert/strict';
import {wearableBoneOwners} from '../vendor/dota-loadout/src/wearable-bones.js';

test('Sven/Tinker: removing a sword or cannon does not leave stale global bone bindings',()=>{
  const hero={root:{name:'hero-root'}}, inverse={root:12};
  const {attach,detach}=wearableBoneOwners(hero,inverse,new Set(['root']));
  const first={localBones:[{bone:{name:'sword-A'},inverse:1,keys:['weapon0_0','weapon_r']}]};
  const second={localBones:[{bone:{name:'sword-B'},inverse:2,keys:['weapon0_0','weapon_r']}]};
  attach(first);assert.equal(hero.weapon0_0.name,'sword-A');
  attach(second);assert.equal(hero.weapon0_0.name,'sword-B');
  detach(second);assert.equal(hero.weapon0_0.name,'sword-A');
  detach(first);assert.equal('weapon0_0' in hero,false);
  assert.equal(hero.root.name,'hero-root');assert.equal(inverse.root,12);
});
test('Timbersaw: repeated refits cannot duplicate a joint owner',()=>{
  const bones={},inverses={},service=wearableBoneOwners(bones,inverses,new Set());
  const claw={localBones:[{bone:{name:'clamp'},inverse:3,keys:['clamp_l']}]};
  service.attach(claw);service.attach(claw);service.detach({...claw});
  assert.equal(bones.clamp_l,undefined);
});
test('hero bone bindings cannot be replaced by an item of the same name',()=>{
  const own={root:{name:'hero'}},inverse={root:9};
  const s=wearableBoneOwners(own,inverse,new Set(['root']));
  const w={localBones:[{bone:{name:'false-root'},inverse:5,keys:['root']}]};
  s.attach(w);s.detach(w);
  assert.equal(own.root.name,'hero');assert.equal(inverse.root,9);
});
