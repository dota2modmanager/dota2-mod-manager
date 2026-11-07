/* Complete effect dependencies for the real loadout runtime, shared by hero and recolor views. */
import { references } from './resource.ts';
import { dataTree, type ParticleDef, type Json } from './particle-spec.ts';
import { snapshotPoints } from './particle-snapshot.ts';
import { embedGlb, readGlb, writeGlb } from './glb-embed.ts';
import { loadoutSheet } from './loadout-sheet.ts';
import { readLoadoutMaterial, loadoutDescriptor, LOADOUT_MASKS } from './loadout-material.ts';
import type { LoadoutResources } from '../renderer/api/preview3d.ts';
import type { createModelGlb } from './model-glb.ts';

type Exporter=Pick<ReturnType<typeof createModelGlb>,'glbs'> & Partial<Pick<ReturnType<typeof createModelGlb>,'sprites'>>;
const plain=(path:string)=>path.toLowerCase().replace(/_c$/,'');
const safe=(p:string)=>/^(?:models|materials|particles)\/[\w/.-]+\.(?:vpcf|vmat|vtex|vmdl|vsnap|vmesh)$/.test(p)&&!p.split('/').includes('..');
/** Collect native dependency paths without allowing arbitrary files or parent-directory traversal. */
export function resourcePaths(value:Json):string[]{
  if(typeof value==='string')return safe(plain(value))?[plain(value)]:[];
  if(Array.isArray(value))return value.flatMap(resourcePaths);
  return value&&typeof value==='object'?Object.values(value).flatMap(resourcePaths):[];
}

/** Resolve effects and their children into a local resource packet. */
export async function loadoutResources(defs:ParticleDef[],read:(p:string)=>Buffer|null,glb:Exporter):Promise<LoadoutResources>{
  const out:LoadoutResources={snapshots:{},materials:{},models:{},sheets:{},missing:[]},seen=new Set<string>(),queue:string[]=[],models:string[]=[];
  const visit=(def:ParticleDef)=>{queue.push(...resourcePaths(def.tree));def.children.forEach(visit);};defs.forEach(visit);
  for(let i=0;i<queue.length;i++){
    const p=plain(queue[i]);if(!safe(p)||seen.has(p))continue;seen.add(p);
    if(seen.size>1024){out.missing.push('Effect dependency limit exceeded');break;}
    const file=read(p+'_c');if(!file){out.missing.push(p);continue;}
    if(p.endsWith('.vsnap')){
      const data=dataTree(file);
      try{const points=data?snapshotPoints(file,data):[];if(!points.length){out.missing.push(p);continue;}
        const snapshot:Record<string,unknown>={position:points.map(x=>x.position),skinning:points.map(x=>x.weights)};
        for(const key of ['color','normal','alpha','radius'] as const)if(points.some(x=>x[key]!==undefined))snapshot[key]=points.map(x=>x[key]??(key==='color'?[1,1,1]:key==='normal'?[0,0,1]:key==='alpha'?1:1));
        out.snapshots[p]=snapshot;
      }catch{out.missing.push(p);}
    }else if(p.endsWith('.vtex'))out.sheets[p]=loadoutSheet(file);
    else if(p.endsWith('.vmat')){const m=readLoadoutMaterial(file);if(m){out.materials[p]=m;queue.push(...Object.values(m.textures));}else out.missing.push(p);}
    else if(p.endsWith('.vmdl'))models.push(p);
    try{queue.push(...references(file).map(plain).filter(path => safe(path) && !path.endsWith('.vmdl')));}catch{ /* Definitions above still carry most resource references. */ }
  }
  if (models.length) {
    const files = await glb.glbs(models, 'all', true);
    const available = models.flatMap(model => {
      const file = files[model];
      if (file) return [{ file, model }];
      out.missing.push(model);
      return [];
    });
    const prepared = await loadoutModels(available, read, glb, model => out.missing.push(model));
    available.forEach(({ model }, index) => {
      const bytes = prepared[index];
      if (bytes) out.models[model] = { data: bytes.toString('base64') };
    });
  }
  return out;
}

/** Add native material descriptors to exported GLBs. */
export async function loadoutModel(file:string,model:string,read:(p:string)=>Buffer|null,glb:Exporter):Promise<Buffer>{
  const [bytes] = await loadoutModels([{ file, model }], read, glb);
  return bytes!;
}

function modelMaterials(model: string, read: (path: string) => Buffer | null) {
  const seen = new Set<string>(), queue = [plain(model)];
  const found=new Map<string,NonNullable<ReturnType<typeof readLoadoutMaterial>>>();
  for(let i=0;i<queue.length&&seen.size<256;i++){
    const p=plain(queue[i]);if(!safe(p)||seen.has(p))continue;seen.add(p);const bytes=read(p+'_c');if(!bytes)continue;
    if(p.endsWith('.vmat')){const m=readLoadoutMaterial(bytes);if(m)found.set(p,m);}
    else try{queue.push(...references(bytes).filter(x=>/\.(vmat|vmesh)(?:_c)?$/.test(x)));}catch{ /* No referenced meshes. */ }
  }
  return found;
}

/** Export all material masks together so VRF opens the game archive once per batch. */
export async function loadoutModels(
  models: { file: string; model: string }[], read: (path: string) => Buffer | null,
  glb: Exporter, onMissing?: (model: string) => void,
): Promise<(Buffer | null)[]> {
  const found = models.map(({ model }) => modelMaterials(model, read));
  const wanted=[...new Set(found.flatMap(map => [...map.values()]).flatMap(m=>Object.values(LOADOUT_MASKS).flatMap(k=>m.textures[k]??[])))];
  const textures=glb.sprites&&wanted.length?await glb.sprites(wanted):{};
  return models.map(({ file, model }, index) => {
    try {
      const { json, bin } = readGlb(embedGlb(file));
      const materials: Record<string, unknown> = {};
      for (const [path, material] of found[index]) {
        const images: Record<string, { mime: string; data: string }> = {};
        for (const [field, key] of Object.entries(LOADOUT_MASKS)) {
          const bytes = textures[material.textures[key]];
          if (bytes) images[field] = { mime: 'image/png', data: bytes.toString('base64') };
        }
        materials[path] = { descriptor: loadoutDescriptor(material), images };
      }
      const meta = json as typeof json & { extras?: Record<string, unknown> };
      meta.extras = { ...meta.extras, dotaStudio: { sourceModel: model, materials } };
      return writeGlb(meta, bin);
    } catch (error) {
      if (!onMissing) throw error;
      onMissing(model);
      return null;
    }
  });
}
