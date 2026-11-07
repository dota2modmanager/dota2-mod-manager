/* Native Dota material inputs for the bundled loadout shader. PBR metalness is not a substitute
 * for Source's self-illumination, rim, diffuse and specular masks. */
import { readKv3 } from './kv3.ts';
import { kvJson } from './particle-spec.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';
import type { Json } from './particle-spec.ts';

/** Native shader parameters stay separate so zero-valued flags and packed masks survive export. */
export interface NativeMaterial { shader: string; floats: Record<string,number>; ints: Record<string,number>; vectors: Record<string,number[]>; textures: Record<string,string> }

/** Legacy materials still use NTRO: follow the field offsets recorded in the resource itself. */
function ntro(file: Buffer): Record<string,Json> {
  const block = resourceBlock(file, 'NTRO').data, data = resourceBlock(file, 'DATA').data;
  const cstr = (b:Buffer, at:number) => { if(at<0||at>=b.length) throw Error('NTRO string out of range'); const end=b.indexOf(0,at); if(end<0) throw Error('NTRO string unterminated'); return b.toString('utf8',at,end); };
  const structs = new Map<string,{size:number;id:number;base:number;fields:Map<string,number>}>();
  const start=4+block.readUInt32LE(4), count=block.readUInt32LE(8);
  if(count>256) throw Error('NTRO struct limit');
  for(let i=0;i<count;i++){
    const at=start+i*40, fields=new Map<string,number>(), first=at+28+block.readUInt32LE(at+28), n=block.readUInt32LE(at+32);
    if(n>256) throw Error('NTRO field limit');
    for(let j=0;j<n;j++){const p=first+j*24;fields.set(cstr(block,p+block.readUInt32LE(p)),block.readInt16LE(p+6));}
    structs.set(cstr(block,at+8+block.readUInt32LE(at+8)),{size:block.readUInt16LE(at+20),id:block.readUInt32LE(at+4),base:block.readUInt32LE(at+24),fields});
  }
  const byId=new Map([...structs.values()].map(s=>[s.id,s]));
  for(const s of structs.values()){const visited=new Set<number>();for(let b=byId.get(s.base);b&&!visited.has(b.id);b=byId.get(b.base)){visited.add(b.id);for(const [name,offset]of b.fields)if(!s.fields.has(name))s.fields.set(name,offset);}}
  const root=structs.get('MaterialResourceData_t'); if(!root) throw Error('No material struct');
  const out:Record<string,Json>={};
  const shader=root.fields.get('m_shaderName');if(shader!==undefined)out.m_shaderName=cstr(data,shader+data.readUInt32LE(shader));
  for(const [field,type] of [['m_intParams','Int'],['m_floatParams','Float'],['m_vectorParams','Vector'],['m_textureParams','Texture']]){
    const at=root.fields.get(field), row=structs.get(`MaterialParam${type}_t`);
    if(at===undefined||!row)continue;
    const name=row.fields.get('m_name'), value=row.fields.get('m_nValue')??row.fields.get('m_flValue')??row.fields.get('m_value')??row.fields.get('m_pValue');
    if(name===undefined||value===undefined)continue;
    const first=at+data.readUInt32LE(at), n=data.readUInt32LE(at+4);if(n>4096)throw Error('NTRO parameter limit');
    const rows:Json[]=[];
    for(let i=0;i<n;i++){const p=first+i*row.size,v=p+value;rows.push({m_name:cstr(data,p+name+data.readUInt32LE(p+name)),m_value:type==='Texture'?cstr(data,v+data.readUInt32LE(v)):type==='Vector'?Array.from({length:4},(_,k)=>data.readFloatLE(v+k*4)):type==='Int'?data.readInt32LE(v):data.readFloatLE(v)});}
    out[field]=rows;
  }
  return out;
}

/** Accept both current KV3 and older NTRO materials from the installed game. */
export function readLoadoutMaterial(file:Buffer|null):NativeMaterial|null {
  if(!file)return null;
  try{
    const tree=resourceBlocks(file).some(b=>b.name==='NTRO')?ntro(file):(()=>{const kv=readKv3(resourceBlock(file,'DATA').data);return kvJson(kv,kv.root);})();
    if(!tree||typeof tree!=='object'||Array.isArray(tree))return null;
    const out:NativeMaterial={shader:String(tree.m_shaderName??''),floats:{},ints:{},vectors:{},textures:{}};
    for(const [field,kind] of [['m_floatParams','floats'],['m_intParams','ints'],['m_vectorParams','vectors'],['m_textureParams','textures']] as const){
      for(const row of Array.isArray(tree[field])?tree[field]:[]){
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.m_name!=='string')continue;
        const value=row.m_value??row.m_nValue??row.m_flValue??row.m_pValue;
        if((kind==='floats'||kind==='ints')&&typeof value==='number')out[kind][row.m_name]=value;
        else if(kind==='vectors'&&Array.isArray(value))out.vectors[row.m_name]=value.map(Number);
        else if(kind==='vectors'&&value&&typeof value==='object'&&!Array.isArray(value))out.vectors[row.m_name]=['x','y','z','w'].map(k=>Number(value[k]??1));
        else if(kind==='textures'&&typeof value==='string')out.textures[row.m_name]=value.replace(/_c$/,'');
      }
    }
    return out;
  }catch{return null;}
}

/** Channel layout is the native hero.vfx layout used by dota-loadout. */
export function loadoutDescriptor(m:NativeMaterial):Record<string,unknown>{
  const f=(k:string,d=0)=>m.floats[k]??d, v=(k:string,d=[1,1,1])=>m.vectors[k]?.slice(0,d.length)??d;
  return {detailMode:m.ints.F_DETAIL??0,detailBlend:f('g_flDetailBlendFactor',1),detailScale:v('g_vDetailTexCoordScale',[1,1]),detailTint:v('g_vDetail1ColorTint'),rimColor:v('g_vRimLightColor'),rimScale:f('g_flRimLightScale'),specColor:v('g_vSpecularColor'),specScale:f('g_flSpecularScale',1),specExponent:f('g_flSpecularExponent',16),alphaTest:m.ints.F_ALPHA_TEST?f('g_flAlphaTestReference',.5):0,translucent:!!m.ints.F_TRANSLUCENT,additive:!!m.ints.F_ADDITIVE_BLEND,cloak:m.ints.F_ENABLE_CLOAK?f('g_flMaterialCloakFactor'):0};
}
/** Texture roles the loadout shader reads from GLB extras instead of glTF's PBR channels. */
export const LOADOUT_MASKS:Record<string,string>={masks:'g_tMasks1',specular:'g_tMasks2',normal:'g_tNormal',detail:'g_tDetail',fresnel:'g_tFresnelWarp',diffuseWarp:'g_tDiffuseWarp'};
