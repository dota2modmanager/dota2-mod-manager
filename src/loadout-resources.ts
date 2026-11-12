/* Complete effect dependencies for the real loadout runtime, shared by hero and recolor views. */
import { references } from './resource.ts';
import { dataTree, type ParticleDef, type Json } from './particle-spec.ts';
import { snapshotPoints } from './particle-snapshot.ts';
import { embedGlb, readGlb, writeGlb } from './glb-embed.ts';
import { modelSkinMaterials } from './model-skin.ts';
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

/** The models the effects' renderers draw. Others a tree names (a hero's body to emit from) cost a full export and draw nothing. */
export function drawnModels(defs:ParticleDef[]):Set<string>{
  const out=new Set<string>();
  const visit=(def:ParticleDef)=>{
    const renderers=(def.tree as {m_Renderers?:unknown}).m_Renderers;
    if(Array.isArray(renderers))for(const renderer of renderers as {_class?:string;m_ModelList?:{m_model?:unknown}[]}[]){
      if(renderer?._class!=='C_OP_RenderModels'||!Array.isArray(renderer.m_ModelList))continue;
      for(const row of renderer.m_ModelList)if(typeof row?.m_model==='string')out.add(plain(row.m_model));
    }
    def.children.forEach(visit);
  };
  defs.forEach(visit);
  return out;
}

/** Resolve effects and their children into a local resource packet. */
export async function loadoutResources(defs:ParticleDef[],read:(p:string)=>Buffer|null,glb:Exporter):Promise<LoadoutResources>{
  const out:LoadoutResources={snapshots:{},materials:{},models:{},sheets:{},missing:[]},seen=new Set<string>(),queue:string[]=[],models:string[]=[],drawn=drawnModels(defs);
  const visit=(def:ParticleDef)=>{queue.push(...resourcePaths(def.tree));def.children.forEach(visit);};defs.forEach(visit);
  for(let i=0;i<queue.length;i++){
    const p=plain(queue[i]);if(!safe(p)||seen.has(p)||(p.endsWith('.vmdl')&&!drawn.has(p)))continue;seen.add(p);
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
  models: { file: string; model: string; skin?: number }[], read: (path: string) => Buffer | null,
  glb: Exporter, onMissing?: (model: string) => void,
): Promise<(Buffer | null)[]> {
  const prepared = models.map(({ file, model, skin }) => {
    try {
      const glb = readGlb(embedGlb(file));
      const materials = modelMaterials(model, read);
      const json = glb.json as typeof glb.json & {
        materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
        textures?: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }[];
      };
      const key = (name: string) => plain(name.replace(/\\/g, '/')).replace(/\.vmat$/, '');
      const base = (name: string) => key(name).split('/').at(-1);
      const missingColor = new Set<string>();
      const swaps = skin ? modelSkinMaterials(read(plain(model) + '_c'), skin) : new Map<string, string>();
      const names = [...new Set([...materials.keys(), ...[...swaps.keys()].map(plain)])];
      for (const material of json.materials ?? []) {
        const index = material.pbrMetallicRoughness?.baseColorTexture?.index;
        const texture = index === undefined ? undefined : json.textures?.[index];
        const image = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
        const name = material.name ?? '';
        const aliases = names.filter(path => base(path) === base(name));
        const found = names.find(path => key(path) === key(name)) ?? (aliases.length === 1 ? aliases[0] : undefined);
        if (!found) continue;
        const alternate = swaps.get(found) ?? swaps.get(found + '_c');
        const path = alternate && plain(alternate);
        const native = path && safe(path) ? readLoadoutMaterial(read(path + '_c')) : null;
        if (native?.textures.g_tColor) {
          materials.set(found, native);
          missingColor.add(found);
        } else if (image === undefined || !json.images?.[image]) missingColor.add(found);
      }
      // A model's references name every material set it has; the masks of the sets it does not wear were most of a body's weight.
      const worn = new Set((json.materials ?? []).map(material => base(material.name ?? '')));
      for (const path of materials.keys()) if (!worn.has(base(path))) materials.delete(path);
      return { model, glb, materials, missingColor };
    } catch (error) {
      if (!onMissing) throw error;
      onMissing(model);
      return null;
    }
  });
  const roles = (recoverColor: boolean) => recoverColor ? { ...LOADOUT_MASKS, color: 'g_tColor' } : LOADOUT_MASKS;
  const wanted = [...new Set(prepared.flatMap(row => row ? [...row.materials].flatMap(([path, material]) =>
    Object.values(roles(row.missingColor.has(path))).flatMap(key => material.textures[key] ? [plain(material.textures[key])] : [])) : []))];
  const textures = glb.sprites && wanted.length ? await glb.sprites(wanted) : {};
  return prepared.map(row => {
    if (!row) return null;
    const { glb: { json, bin }, model, missingColor } = row;
    const materials: Record<string, unknown> = {};
    for (const [path, material] of row.materials) {
      const images: Record<string, { mime: string; data: string }> = {};
      for (const [field, key] of Object.entries(roles(missingColor.has(path)))) {
        const asset = material.textures[key];
        const bytes = asset ? textures[plain(asset)] : null;
        if (bytes) images[field] = { mime: 'image/png', data: bytes.toString('base64') };
      }
      materials[path] = { descriptor: loadoutDescriptor(material), images };
    }
    const meta = json as typeof json & { extras?: Record<string, unknown> };
    meta.extras = { ...meta.extras, dotaStudio: { sourceModel: model, materials } };
    return writeGlb(meta, bin);
  });
}

/**
 * Every texture the preview's materials of these models sample, colour included, as the sprites
 * export names them. Read off the game's own materials, before any model is exported, so the
 * pictures can be fetched while the models are (src/hero-preview.ts): they waited behind them.
 */
export function loadoutTexturePaths(models: string[], read: (path: string) => Buffer | null): string[] {
  const roles = Object.values({ ...LOADOUT_MASKS, color: 'g_tColor' });
  return [...new Set(models.flatMap((model) => [...modelMaterials(model, read).values()]
    .flatMap((m) => roles.flatMap((key) => (m.textures[key] ? [plain(m.textures[key])] : [])))))];
}
