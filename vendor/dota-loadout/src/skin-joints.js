// A wearable's exported skin can contain the hero's entire authoring rig.
// Only weighted joints and their ancestors belong to this wearable. Registering
// unused bones lets a head's placeholder tail rig capture the real tail later.
export function activeSkinJoints(mesh,attachmentBones=[]) {
  const bones=mesh.skeleton.bones,index=mesh.geometry.getAttribute('skinIndex'),weight=mesh.geometry.getAttribute('skinWeight');
  if(!index||!weight)return new Set(bones.map((_,i)=>i));
  const needed=new Set(),lookup=new Map(bones.map((b,i)=>[b,i]));
  const include=i=>{while(i!==undefined&&!needed.has(i)){needed.add(i);i=lookup.get(bones[i].parent);}};
  for(let v=0;v<index.count;v++)for(let c=0;c<Math.min(index.itemSize,weight.itemSize);c++){
    if(weight.getComponent(v,c)<=0)continue;
    let i=index.getComponent(v,c);if(!Number.isInteger(i)||i<0||i>=bones.length)throw Error('Invalid wearable skin joint');
    include(i);
  }
  for(const name of attachmentBones){const i=bones.findIndex(b=>String(b.userData?.studioSourceName||b.name).toLowerCase()===name.toLowerCase());if(i>=0)include(i);}
  return needed;
}

export const attachmentSkinBones=rows=>Object.values(rows??{}).flatMap(row=>(row.bones??[]).filter((_,i)=>(row.weights?.[i]??(i===0?1:0))>0));
// The particle entity 'self_with_wearables' resolves attachments across the entire
// equipped loadout, not only the particle's owner. Spectre's arcana effects use it
// for head, skirt and shoulder points. Keep 'parent' tied to the hero alone.
export const resolveModelAttachment=(rows,name,owner,entity='self')=>{
  const find=key=>{const values=rows[key];if(!values)return null;
    return values[name]??Object.entries(values).find(([k])=>k.toLowerCase()===String(name).toLowerCase())?.[1]??null;};
  if(entity==='parent')return find('hero');
  const own=find(owner);if(own)return own;
  if(entity==='self_with_wearables')for(const key of Object.keys(rows)){
    if(key!=='hero'&&key!==owner&&key!=='pedestal'){
      const at=find(key);if(at)return at;
    }
  }
  return find('hero');
};
