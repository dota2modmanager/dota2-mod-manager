import * as THREE from 'three';
export function mergeWearableClips(clips,model,sequences,heroSequences,heroBones,boneKey,resolve,previewIdle){
 for(const clip of model.animations){
  const own=sequences.find(s=>s.name===clip.name),targets=new Set();if(clips.has(clip.name))targets.add(clip.name);
  if(own?.activity&&!own.modifiers?.length)for(const row of heroSequences)if(row.activity===own.activity&&!row.modifiers?.length&&clips.has(row.name))targets.add(row.name);
  // Desktop exports the wearable's selected idle/loadout clip separately.
  // Its name need not match the hero's clip, and the packet may lack activity metadata.
  if (previewIdle && model.animations.length === 1
      && !/bind_?pose|^@/i.test(clip.name) && clips.has(previewIdle)) targets.add(previewIdle);
  const tracks=extraOnly=>clip.tracks.flatMap(track=>{const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=model.studioTrackNodes?.get(parsed.nodeName)||model.scene.getObjectByName(parsed.nodeName)||model.scene.getObjectByProperty('uuid',parsed.nodeName);if(!node||extraOnly&&heroBones.has(boneKey(node)))return [];const target=resolve(node);if(!target)return [];const copy=track.clone();copy.name=target.uuid+track.name.slice(track.name.lastIndexOf('.'));return [copy];});
  for(const name of targets){const existing=clips.get(name),names=new Set(existing.tracks.map(t=>t.name));existing.tracks.push(...tracks(true).filter(t=>!names.has(t.name)));existing.resetDuration();}
  if(!clips.has(clip.name)){const ownTracks=tracks(false);if(ownTracks.length)clips.set(clip.name,new THREE.AnimationClip(clip.name,clip.duration,ownTracks));}
 }
}
