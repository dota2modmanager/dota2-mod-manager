import { SceneSource, effectSource, readGlb, writeGlb, type EffectPacket, type NativeAttachment } from 'dota-loadout/studio';
import type { Attachment, ParticleDef, LoadoutResources } from '../../api/preview3d.ts';
import type { PacketTexture } from './loadout-textures.ts';

export const ownerOf=(part:number):string=>part<0?'hero':`part-${part}`;
export function loadoutAttachments(rows:Attachment[]):Record<string,NativeAttachment>{
  return Object.fromEntries(rows.map(a=>[a.name,{bones:a.bones??[a.bone],offsets:a.offsets??[a.offset],rotations:a.rotations??[a.rotation],weights:a.weights??[1],ignoreRotation:a.ignoreRotation??false}]));
}

// Isolate the model-particle layer from the Windows crash seen on Claszian Apostasy.
const VOID_TENTACLE = 'models/items/faceless_void/faceless_void_arcana/fv_arcana_tentacle_b.vmdl';

/** Keep the resource tree intact: child groups, delay, disabled/endcap flags and snapshots. */
export function loadoutPacket(def:ParticleDef,resources?:LoadoutResources):EffectPacket{
  const definitions:EffectPacket['definitions']={};
  const walk=(d:ParticleDef)=>{
    definitions[d.path]=structuredClone(d.tree);
    // Older saved packets in the editor used an inlined-only child tree.
    definitions[d.path].m_Children??=d.children.map(c=>({m_ChildRef:c.path,m_nChildGroupID:c.childGroup??0,m_flDelay:c.delay??0,m_bEndCap:c.endcap??false}));
    d.children.forEach(walk);
  };walk(def);
  const blade = /^particles\/econ\/items\/phantom_assassin\/[^/]+\/pa_arcana_blade_ambient_([ab])\.vpcf$/i.exec(def.path);
  const snapshot = def.tree.m_hSnapshot;
  if (blade && typeof snapshot === 'string' && !resources?.snapshots[snapshot.toLowerCase().replace(/_c$/, '')]) {
    definitions[def.path].m_studioBladeSide = blade[1].toLowerCase();
  }
  const models: NonNullable<EffectPacket['models']> = {};
  const missing = [...(resources?.missing ?? [])];
  for (const tree of Object.values(definitions)) {
    if (!Array.isArray(tree.m_Renderers)) continue;
    tree.m_Renderers = tree.m_Renderers.filter(renderer => {
      if (!renderer || typeof renderer !== 'object' || Array.isArray(renderer)) return true;
      if (renderer._class !== 'C_OP_RenderModels' || !Array.isArray(renderer.m_ModelList)) return true;
      renderer.m_ModelList = renderer.m_ModelList.filter(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.m_model !== 'string') return true;
        const path = row.m_model.toLowerCase().replace(/_c$/, '');
        if (path === VOID_TENTACLE) {
          const disabled = path + ' (disabled for crash isolation)';
          if (!missing.includes(disabled)) missing.push(disabled);
          return false;
        }
        const model = resources?.models[path];
        if (model) models[path] = model;
        return true;
      });
      return renderer.m_ModelList.length > 0;
    });
  }
  return {root:def.path,definitions,snapshots:resources?.snapshots??{},materials:resources?.materials??{},models,missing};
}
export function loadoutEffects(source:SceneSource,particles:{part:number;def:ParticleDef}[],textures:Record<string,PacketTexture>,resources?:LoadoutResources){
  for(const {part}of particles)if(part>=0)source.owners.set(ownerOf(part),ownerOf(part));
  return effectSource(source,particles.map(({part,def},i)=>({effectId:`native-${i}`,scope:part<0?'hero':'item',itemId:ownerOf(part),packet:{...loadoutPacket(def,resources),textures}})));
}

/** Remove hidden meshes before the runtime measures bounds or samples particle surfaces. */
export function visibleGlb(bytes:Uint8Array,hidden:string[]):Uint8Array{
  if(!hidden.length)return bytes;
  const parsed=readGlb(bytes),keys=new Set(hidden.map(x=>x.toLowerCase()));
  for(const node of parsed.json.nodes??[]){
    const mesh=parsed.json.meshes?.[node.mesh];
    if(keys.has(String(node.name).toLowerCase())||keys.has(String(mesh?.name).toLowerCase()))delete node.mesh;
  }
  return writeGlb(parsed);
}

/** A neutral carrier only for the isolated effect editor, never substituted for a hero. */
export function effectCarrier():Uint8Array{
  const positions=new Float32Array([-1,0,0,1,0,0,0,2,0]);
  return writeGlb({json:{asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{name:'effect-carrier'}],buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[-1,0,0],max:[1,2,0]}]},bin:new Uint8Array(positions.buffer)});
}
