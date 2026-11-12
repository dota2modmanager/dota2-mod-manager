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

test('Mace of Aeons idle animates the plates during both hero idle and loadout', async () => {
  const { AnimationClip, Bone, Group, VectorKeyframeTrack } = await import('three');
  const { mergeWearableClips } = await import('../vendor/dota-loadout/src/wearable-clips.js');
  const scene = new Group();
  const staff = new Bone(), plate = new Bone();
  staff.name = 'staff_1';
  plate.name = 'plate_01';
  scene.add(staff);
  staff.add(plate);
  const track = name => new VectorKeyframeTrack(name + '.position', [0, 1], [0, 0, 0, 0, 1, 0]);
  const model = { scene, animations: [new AnimationClip('idle', 1, [track(staff.name), track(plate.name)])] };
  const clips = new Map(['idle', 'aeons_loadout'].map(name => [name, new AnimationClip(name, 1, [])]));
  mergeWearableClips(clips, model, [], [], new Set([staff.name]), bone => bone.name, bone => bone, 'aeons_loadout');
  for (const clip of clips.values()) assert.deepEqual(clip.tracks.map(t => t.name), [plate.uuid + '.position']);
});

test('a clip that carries the hero across the floor keeps him on the spot, and keeps his height and sway', async () => {
  const { AnimationClip, Bone, Group, VectorKeyframeTrack } = await import('three');
  const { holdRootMotion, rootBones } = await import('../vendor/dota-loadout/src/root-motion.js');
  const root = new Group(), pelvis = new Bone(), spine = new Bone(), arm = new Bone();
  pelvis.name = 'pelvis'; spine.name = 'spine'; arm.name = 'arm';
  pelvis.position.set(0, 2.5, 0.1);
  root.add(pelvis); pelvis.add(spine); spine.add(arm);
  const rest = rootBones(root);
  assert.deepEqual([...rest.keys()].filter(key => key.length < 10).sort(), ['pelvis', 'spine']);
  const times = Array.from({ length: 61 }, (_, i) => i / 10);
  const walk = times.flatMap(t => [Math.sin(t * 20) * 0.1, 2.5 + t * 0.2, t * 4]);
  const clip = new AnimationClip('debut', 6, [new VectorKeyframeTrack('pelvis.position', times, walk)]);
  assert.equal(holdRootMotion(clip, rest), true);
  const { values } = clip.tracks[0];
  for (let i = 0; i < values.length; i += 3) {
    assert.ok(Math.abs(values[i + 2] - 0.1) < 1.2, `z ${values[i + 2]}`);
    assert.ok(Math.abs(values[i + 1] - walk[i + 1]) < 1e-5, 'height stays');
  }
  assert.ok(Math.max(...values.filter((_, i) => i % 3 === 0)) > 0.02, 'the sway stays');
  const idle = new AnimationClip('idle', 2, [new VectorKeyframeTrack('pelvis.position', [0, 1, 2], [0, 2.5, 0.1, 0.1, 2.6, 0.2, 0, 2.5, 0.1])]);
  assert.equal(holdRootMotion(idle, rest), false);
  // Marci's debut loop: hardly moves, and all of it 17 metres from her place
  const away = new AnimationClip('loop', 2, [new VectorKeyframeTrack('pelvis.position', [0, 1, 2], [0.7, 2.5, 17.4, 0.8, 2.6, 17.5, 0.7, 2.5, 17.4])]);
  assert.equal(holdRootMotion(away, rest), true);
  assert.deepEqual([...away.tracks[0].values].map(v => +v.toFixed(2)), [-0.05, 2.5, 0.05, 0.05, 2.6, 0.15, -0.05, 2.5, 0.05]);
});
